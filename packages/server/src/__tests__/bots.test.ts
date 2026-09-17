import { describe, expect, it } from 'vitest';
import {
  Card,
  DEFAULT_SETTINGS,
  GameState,
  addPlayer,
  applyAction,
  createGameState,
  legalActions,
  startGame,
  tick,
} from '../../../shared/src/index';
import { planBotAction } from '../bots';

const T0 = 1_000_000;

/** 一局 1 人 + 1 机器人的对局（机器人坐 1 号位） */
function botGame(): GameState {
  let s = createGameState('BOT1');
  addPlayer(s, '玩家');
  addPlayer(s, '电脑1', true);
  const g = startGame(s, 0, 7, T0);
  if (!g.ok) throw new Error(g.error);
  return g.state;
}

/** 白盒：把状态直接摆成「机器人轮到行动」的样子，省去一整局的推演 */
function rigRotation(
  s: GameState,
  opts: {
    botBattlefield: number;
    botBet: number;
    botChips: number;
    botHand: number;
    humanBattlefield: number;
    maxBet: number;
  },
): void {
  const r = s.round!;
  r.phase = 'rotation';
  r.turnSeat = 1;
  r.maxBet = opts.maxBet;
  r.pot = 20;

  const human = s.players[0]!;
  const bot = s.players[1]!;

  const all: Card[] = [...s.secret!.deck, ...s.secret!.hands[0], ...s.secret!.hands[1]];
  const take = (n: number) => all.splice(0, n);

  human.status = 'active';
  human.battlefield = take(opts.humanBattlefield);
  human.betTotal = opts.maxBet;
  human.playSegments = [{ count: opts.humanBattlefield, top: human.battlefield[0] ?? null }];

  bot.status = 'active';
  bot.battlefield = take(opts.botBattlefield);
  bot.betTotal = opts.botBet;
  bot.chips = opts.botChips;
  bot.playSegments = [{ count: opts.botBattlefield, top: bot.battlefield[0] ?? null }];

  s.secret!.hands[1] = take(opts.botHand);
  s.secret!.hands[0] = take(6);
  s.secret!.deck = all;
}

describe('机器人决策：绝不停摆', () => {
  it('对手把押注抬到机器人补不起时，仍然要给出动作（弃牌），而不是沉默', () => {
    const s = botGame();
    // 机器人：出战 1 张、押 1；手上还剩 3 张；方片/黑桃全部倍率 1
    // 对手：出战 6 张、押 6 → 机器人加满 3 张也只有上限 4，补不到 6
    rigRotation(s, {
      botBattlefield: 1,
      botBet: 1,
      botChips: 100,
      botHand: 3,
      humanBattlefield: 6,
      maxBet: 6,
    });

    const la = legalActions(s, 1);
    // 先确认这确实是"卡死态"：有加牌可用，但加不满；加注与同意都不可用
    expect(la.canAddCards).toBe(true);
    expect(la.canAddChips).toBeNull();
    expect(la.canAgree).toBe(false);
    expect(la.canPlay).toBe(false);
    expect(la.canFold).toBe(true);

    // 各种"性格"随机值下都必须选出动作
    for (const roll of [0, 0.1, 0.5, 0.6, 0.7, 0.9, 0.999]) {
      const plan = planBotAction(s, () => roll);
      expect(plan.kind).toBe('act');
      if (plan.kind === 'act') expect(plan.action.t).toBe('fold');
    }
  });

  it('只要轮到机器人且它还在场，就永远选得出动作（不同意 stuck）', () => {
    // 各种"押注差 / 手牌数 / 筹码数"组合下扫一遍
    for (const botBattlefield of [1, 2, 3]) {
      for (const botBet of [0, 1]) {
        for (const botChips of [0, 1, 3, 50]) {
          for (const botHand of [1, 2, 4]) {
            for (const humanBattlefield of [1, 4, 6]) {
              const s = botGame();
              rigRotation(s, {
                botBattlefield,
                botBet: Math.min(botBet, botBattlefield),
                botChips,
                botHand,
                humanBattlefield,
                maxBet: humanBattlefield,
              });
              const plan = planBotAction(s, () => 0.5);
              const ctx = `bf=${botBattlefield} bet=${botBet} chips=${botChips} hand=${botHand} maxBet=${humanBattlefield}`;
              expect(plan.kind, ctx).toBe('act');
            }
          }
        }
      }
    }
  });

  it('轮到玩家时返回 idle，不重挂（等玩家操作后由 kick 唤醒）', () => {
    const s = botGame();
    rigRotation(s, { botBattlefield: 2, botBet: 2, botChips: 50, botHand: 4, humanBattlefield: 3, maxBet: 3 });
    s.round!.turnSeat = 0;
    expect(planBotAction(s, () => 0.5).kind).toBe('idle');
  });

  it('防守窗口里未表态的机器人一定会表态', () => {
    const s = botGame();
    s.round!.phase = 'defense_window';
    s.players[1]!.status = 'active';
    s.players[1]!.defensePassed = false;
    const plan = planBotAction(s, () => 0.5);
    expect(plan.kind).toBe('act');
    if (plan.kind === 'act') expect(['pass_defense', 'declare_defense']).toContain(plan.action.t);
  });

  it('机器人不会押超过自己筹码或牌数上限的注', () => {
    const s = botGame();
    rigRotation(s, { botBattlefield: 0, botBet: 0, botChips: 3, botHand: 6, humanBattlefield: 2, maxBet: 2 });
    s.round!.phase = 'opening';
    s.round!.turnSeat = 1;
    s.players[1]!.battlefield = [];
    s.players[1]!.betTotal = 0;
    s.players[1]!.playSegments = [];
    const mult = DEFAULT_SETTINGS.chipMultiplier;
    for (const roll of [0, 0.3, 0.6, 0.9]) {
      const plan = planBotAction(s, () => roll);
      expect(plan.kind).toBe('act');
      if (plan.kind === 'act' && plan.action.t === 'play') {
        expect(plan.action.bet).toBeLessThanOrEqual(Math.min(plan.action.cardIds.length * mult, 3));
        expect(plan.action.bet).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('机器人整局自我对局', () => {
  /** 线性同余，保证测试可复现 */
  function seeded(seed: number) {
    let x = seed >>> 0;
    return () => {
      x = (x * 1664525 + 1013904223) >>> 0;
      return x / 0x100000000;
    };
  }

  it.each([20250322, 7, 991, 4242, 123456])(
    '三个机器人互相对局能自己打完，且全程不会选不出动作（种子 %i）',
    (seed) => {
    let s = createGameState('BOT2');
    // 少发点筹码，整局几十回合就能分出胜负；否则随机机器人能磨两千多个回合
    s.settings = { ...s.settings, startChips: 20, ante: 1 };
    addPlayer(s, 'B1', true);
    addPlayer(s, 'B2', true);
    addPlayer(s, 'B3', true);
    const g = startGame(s, 0, seed, T0);
    if (!g.ok) throw new Error(g.error);
    s = g.state;

    const rand = seeded(12345);
    let now = T0;
    let idleStreak = 0;

    // 筹码守恒：任意时刻「玩家筹码 + 托管 + 奖池」必须等于初始总量。
    // 结算/托管/作废退款任何一处算错，这里都会立刻炸出来。
    const TOTAL = 20 * 3;
    const held = (st: GameState) =>
      st.players.reduce((n, p) => n + (p ? p.chips + p.escrow : 0), 0) + (st.round?.pot ?? 0);
    const where = (st: GameState) => `round ${st.round?.roundNo} phase ${st.round?.phase}`;
    expect(held(s), where(s)).toBe(TOTAL);

    for (let step = 0; step < 8000 && s.phase === 'playing'; step++) {
      const plan = planBotAction(s, rand);

      if (plan.kind === 'stuck') {
        throw new Error(`机器人选不出动作而停摆：seat=${plan.seat} phase=${s.round?.phase}`);
      }

      if (plan.kind === 'idle') {
        // 完全没机器人要动：只能靠超时兜底推进，用于确认状态机能自愈
        idleStreak++;
        expect(idleStreak, '连续无动作次数过多，状态机疑似卡住').toBeLessThan(20);
        now += 5_000;
        s = tick(s, now).state;
        expect(held(s), `tick @ ${where(s)}`).toBe(TOTAL);
        continue;
      }

      idleStreak = 0;
      const r = applyAction(s, plan.seat, plan.action, now);
      if (!r.ok) throw new Error(`机器人给出了非法动作 ${plan.action.t}：${r.error}`);
      s = r.state;
      expect(held(s), `${plan.action.t} @ ${where(s)}`).toBe(TOTAL);
      now += 400;
    }

    expect(s.phase).toBe('gameover');
    expect(held(s), `终局 @ ${where(s)}`).toBe(TOTAL);
    },
  );
});
