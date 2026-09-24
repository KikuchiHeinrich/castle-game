import { describe, expect, it } from 'vitest';
import { Card, DEFAULT_SETTINGS, GameAction, GameState, ANTE, HAND_SIZE, START_CHIPS, TIMING, addPlayer, applyAction, createGameState, normalizeSettings, rematch, SETTINGS_RANGE, startGame, tick } from '../index';

const T0 = 1_000_000;
const TURN_MS = 60_000; // 与 DEFAULT_SETTINGS.turnMs 一致

function newGame(n = 3, seed = 7): { s: GameState; declarerSeat: number } {
  let s = createGameState('TST1');
  for (let i = 0; i < n; i++) {
    const r = addPlayer(s, `P${i}`);
    if (!r.ok) throw new Error(r.error);
  }
  const g = startGame(s, 0, seed, T0);
  if (!g.ok) throw new Error(g.error);
  return { s: g.state, declarerSeat: g.state.round!.declarerSeat };
}

function act(s: GameState, seat: number, action: GameAction, now = T0 + 1000): GameState {
  const r = applyAction(s, seat, action, now);
  if (!r.ok) throw new Error(`seat${seat} ${action.t}: ${r.error}`);
  return r.state;
}

function tryAct(s: GameState, seat: number, action: GameAction, now = T0 + 1000): string | null {
  const r = applyAction(s, seat, action, now);
  return r.ok ? null : r.error;
}

/** 测试白盒：从"牌堆+全部手牌"中收集指定牌替换各座位手牌，其余随机补足 6 张，保持 52 张完整 */
function replaceHands(s: GameState, spec: Record<number, string[]>) {
  const all: Card[] = [...s.secret!.deck];
  for (const p of s.players) if (p) all.push(...s.secret!.hands[p.seat]);
  const used = new Set<string>();
  const picked: Record<number, Card[]> = {};
  for (const [seatStr, ids] of Object.entries(spec)) {
    const cards: Card[] = [];
    for (const id of ids) {
      if (used.has(id)) throw new Error(`dup card ${id}`);
      const idx = all.findIndex((c) => c.id === id);
      if (idx < 0) throw new Error(`card ${id} not found`);
      used.add(id);
      cards.push(all.splice(idx, 1)[0]);
    }
    picked[Number(seatStr)] = cards;
  }
  for (const p of s.players) {
    if (!p) continue;
    const want = picked[p.seat];
    if (want) {
      while (want.length < HAND_SIZE) want.push(all.pop()!);
      s.secret!.hands[p.seat] = want;
    } else {
      s.secret!.hands[p.seat] = all.splice(0, HAND_SIZE);
    }
  }
  s.secret!.deck = all;
}

function cardTotal(s: GameState): number {
  let n = s.secret!.deck.length;
  for (const p of s.players) {
    if (!p) continue;
    n += p.battlefield.length;
    n += (s.secret!.hands[p.seat] ?? []).length;
  }
  return n;
}

const seatOf = (s: GameState, i: number) => s.players[i]!;
const nextVoterOf = (s: GameState, from: number): number => {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (from + i) % n;
    if (s.players[seat]?.status === 'active') return seat;
  }
  throw new Error('no voter');
};

describe('房间设置单位', () => {
  it('时长按毫秒归一化，大厅各个"回合限时"选项互不相同', () => {
    // 单位回归：曾把入参当秒乘 1000，导致 30 秒/60 秒/5 分钟全被夹成同一个值
    expect(normalizeSettings({ turnMs: 30_000 }).turnMs).toBe(30_000);
    expect(normalizeSettings({ turnMs: 60_000 }).turnMs).toBe(60_000);
    expect(normalizeSettings({ turnMs: 300_000 }).turnMs).toBe(300_000);
    expect(new Set([30_000, 60_000, 120_000, 300_000].map((v) => normalizeSettings({ turnMs: v }).turnMs)).size).toBe(4);
    // 0 = 不限时；超范围夹到上下限
    expect(normalizeSettings({ turnMs: 0 }).turnMs).toBe(0);
    expect(normalizeSettings({ turnMs: 1 }).turnMs).toBe(10_000);
    expect(normalizeSettings({ turnMs: 99_999_999 }).turnMs).toBe(1_200_000);
    // 教学局用的时长要原样保留，不能被夹走
    const tut = normalizeSettings({ turnMs: 300_000, defenseMs: 240_000, idleMs: 900_000 });
    expect(tut).toMatchObject({ turnMs: 300_000, defenseMs: 240_000, idleMs: 900_000 });
    // 缺省时回落到 DEFAULT_SETTINGS
    expect(normalizeSettings({}).turnMs).toBe(DEFAULT_SETTINGS.turnMs);
  });

  it('初始筹码与各阶段限时都能逐项自定义', () => {
    const s = normalizeSettings({
      startChips: 37,
      defenseMs: 45_000,
      turnMs: 90_000,
      settlementMs: 9_000,
      idleMs: 600_000,
    });
    expect(s).toMatchObject({
      startChips: 37,
      defenseMs: 45_000,
      turnMs: 90_000,
      settlementMs: 9_000,
      idleMs: 600_000,
    });
    // 摊牌展示：0 = 不等待，立刻开下一回合（不是"无限等"）
    expect(normalizeSettings({ settlementMs: 0 }).settlementMs).toBe(0);
    expect(normalizeSettings({ settlementMs: 999_999 }).settlementMs).toBe(60_000);
  });

  it('SETTINGS_RANGE 与 normalizeSettings 的夹紧区间一致（防止前后端各处写一份而走散）', () => {
    const r = SETTINGS_RANGE;
    for (const [key, range] of Object.entries(r)) {
      const k = key as keyof typeof r;
      const below = normalizeSettings({ [k]: range.lo - 1 } as never)[k];
      const above = normalizeSettings({ [k]: range.hi + 1 } as never)[k];
      expect(below, `${key} 下界`).toBe(range.lo);
      expect(above, `${key} 上界`).toBe(range.hi);
    }
    // 0 是合法的"不限时 / 不等待"，不能被夹成下界
    expect(normalizeSettings({ turnMs: 0 }).turnMs).toBe(0);
    expect(normalizeSettings({ defenseMs: 0 }).defenseMs).toBe(0);
    expect(normalizeSettings({ idleMs: 0 }).idleMs).toBe(0);
  });
});

describe('开局', () => {
  it('发牌 6 张、扣底注、进入防守窗口', () => {
    const { s } = newGame(3);
    expect(s.phase).toBe('playing');
    expect(s.round!.phase).toBe('defense_window');
    expect(s.round!.pot).toBe(3 * ANTE);
    for (const p of s.players) {
      expect(p!.chips).toBe(START_CHIPS - ANTE);
      expect(p!.invested).toBe(ANTE);
      expect(s.secret!.hands[p!.seat]).toHaveLength(HAND_SIZE);
    }
    expect(cardTotal(s)).toBe(52);
    expect(s.secret!.deck.length).toBe(52 - 3 * HAND_SIZE);
  });
});

describe('全流程：宣战 → 跟牌 → 弃牌 → 同意 → 摊牌 → 备战', () => {
  it('一对 A 胜一对 K，赢家独吞奖池', () => {
    const { s: s0, declarerSeat } = newGame(3);
    let s = s0;
    const other1 = nextVoterOf(s, declarerSeat);
    const other2 = nextVoterOf(s, other1);

    replaceHands(s, {
      [declarerSeat]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [other1]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'],
      [other2]: ['♠6', '♣7', '♦4', '♣5', '♠9', '♣J'],
    });

    for (const seat of [declarerSeat, other1, other2]) s = act(s, seat, { t: 'pass_defense' });
    expect(s.round!.phase).toBe('opening');
    expect(s.round!.openerSeat).toBe(declarerSeat);

    s = act(s, declarerSeat, { t: 'play', cardIds: ['♠A', '♥A'], bet: 1 });
    expect(s.round!.phase).toBe('rotation');
    expect(s.round!.pot).toBe(3 + 1);
    expect(s.round!.maxBet).toBe(1);
    expect(s.round!.turnSeat).toBe(other1);

    s = act(s, other1, { t: 'play', cardIds: ['♥K', '♣K'], bet: 1 });
    expect(s.round!.turnSeat).toBe(other2);

    s = act(s, other2, { t: 'fold' });
    expect(seatOf(s, other2).status).toBe('folded');
    expect(s.round!.pot).toBe(5); // 押注即时入池（3 底注 + 1 + 1），弃牌不重复计入

    s = act(s, declarerSeat, { t: 'agree_end', agree: true });
    expect(s.round!.phase).toBe('rotation'); // 还差一人
    s = act(s, other1, { t: 'agree_end', agree: true });
    expect(s.round!.phase).toBe('settlement');

    const result = s.round!.result!;
    expect(result.voidRound).toBe(false);
    expect(result.winnerSeat).toBe(declarerSeat);
    expect(result.potAmount).toBe(5);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].seat).toBe(declarerSeat);
    expect(result.entries[0].handName).toBe('一对');

    expect(seatOf(s, declarerSeat).chips).toBe(START_CHIPS - ANTE - 1 + 5);
    expect(seatOf(s, other1).chips).toBe(START_CHIPS - ANTE - 1);
    expect(seatOf(s, other2).chips).toBe(START_CHIPS - ANTE);
    expect(s.lastWinnerSeat).toBe(declarerSeat);

    const t = tick(s, T0 + 1000 + TIMING.settlementMs + 1);
    s = t.state;
    expect(s.round!.roundNo).toBe(2);
    expect(s.round!.declarerSeat).toBe(declarerSeat); // 上回合胜者开局
    expect(s.round!.phase).toBe('defense_window');
    expect(s.round!.pot).toBe(3);
    expect(cardTotal(s)).toBe(52);
    for (const p of s.players) {
      expect(p!.battlefield).toHaveLength(0);
      expect(s.secret!.hands[p!.seat]).toHaveLength(HAND_SIZE);
      expect(p!.status).toBe('active');
    }
  });
});

describe('防守', () => {
  it('防守者牌型全场最大 → 收回托管、不碰奖池；奖池归非防守者', () => {
    const { s: s0, declarerSeat } = newGame(3);
    let s = s0;
    const d = declarerSeat; // 宣战者本人防守（允许）
    const a = nextVoterOf(s, d);
    const b = nextVoterOf(s, a);

    replaceHands(s, {
      [d]: ['♠A', '♠K', '♠Q', '♠J', '♠10', '♥3'], // 皇帝（五同花顺）
      [a]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'],
      [b]: ['♠6', '♣7', '♦4', '♣5', '♠9', '♣J'],
    });

    s = act(s, d, { t: 'declare_defense', cardIds: ['♠A', '♠K', '♠Q', '♠J', '♠10'] }); // 总投入 5（含底注），托管 4
    expect(seatOf(s, d).status).toBe('defended');
    expect(seatOf(s, d).chips).toBe(START_CHIPS - 5); // 底注 1 + 托管 4
    expect(seatOf(s, d).playSegments[0].top!.id).toBe("♠A"); // 亮最大牌

    s = act(s, a, { t: 'pass_defense' });
    s = act(s, b, { t: 'pass_defense' });
    expect(s.round!.phase).toBe('opening');
    expect(s.round!.openerSeat).toBe(a); // 宣战者防守了 → 下家开局

    s = act(s, a, { t: 'play', cardIds: ['♥K', '♣K'], bet: 1 });
    s = act(s, b, { t: 'fold' });
    expect(s.round!.phase).toBe('settlement');
    const result = s.round!.result!;
    expect(result.winnerSeat).toBe(a);
    expect(result.potAmount).toBe(3 + 1);
    expect(result.escrowReturns[String(d)]).toBe(4);
    expect(seatOf(s, d).chips).toBe(START_CHIPS - ANTE);
    expect(seatOf(s, a).chips).toBe(START_CHIPS - ANTE - 1 + 4);
  });

  it('防守者牌型弱于场上最大 → 托管进奖池', () => {
    const { s: s0, declarerSeat } = newGame(3);
    let s = s0;
    const a = nextVoterOf(s, declarerSeat);
    const b = nextVoterOf(s, a);

    replaceHands(s, {
      [declarerSeat]: ['♥2', '♦6', '♣9', '♠J', '♥5', '♦10'],
      [a]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [b]: ['♠6', '♣7', '♦4', '♣5', '♠9', '♣J'],
    });

    s = act(s, declarerSeat, { t: 'declare_defense', cardIds: ['♥2', '♦6'] }); // 托管 1（2 − 底注）
    s = act(s, a, { t: 'pass_defense' });
    s = act(s, b, { t: 'pass_defense' });
    s = act(s, a, { t: 'play', cardIds: ['♠A', '♥A'], bet: 2 });
    s = act(s, b, { t: 'fold' });
    expect(s.round!.phase).toBe('settlement');
    const result = s.round!.result!;
    expect(result.winnerSeat).toBe(a);
    expect(result.potAmount).toBe(3 + 2 + 1);
    expect(result.escrowForfeits[String(declarerSeat)]).toBe(1);
    expect(seatOf(s, declarerSeat).chips).toBe(START_CHIPS - 2); // 总投入 2 全损
  });

  it('全员防守 → 回合作废，底注与托管全退', () => {
    const { s: s0, declarerSeat } = newGame(3);
    let s = s0;
    const a = nextVoterOf(s, declarerSeat);
    const b = nextVoterOf(s, a);
    replaceHands(s, {
      [declarerSeat]: ['♥2', '♦6', '♣9', '♠J', '♥5', '♦10'],
      [a]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [b]: ['♠6', '♣7', '♦4', '♣5', '♠9', '♣J'],
    });
    s = act(s, declarerSeat, { t: 'declare_defense', cardIds: ['♥2'] });
    s = act(s, a, { t: 'declare_defense', cardIds: ['♠A'] });
    s = act(s, b, { t: 'declare_defense', cardIds: ['♣7'] });
    expect(s.round!.phase).toBe('settlement');
    expect(s.round!.result!.voidRound).toBe(true);
    for (const p of s.players) expect(p!.chips).toBe(START_CHIPS);
    const t = tick(s, T0 + 1000 + TIMING.settlementMs + 1);
    expect(t.state.round!.roundNo).toBe(2);
    expect(t.state.round!.pot).toBe(3);
  });
});

describe('押注规则', () => {
  function openRound(s0: GameState, declarerSeat: number, cardIds: string[], bet: number): GameState {
    let s = s0;
    const n = s.players.length;
    for (let i = 0; i < n; i++) s = act(s, i, { t: 'pass_defense' });
    s = act(s, declarerSeat, { t: 'play', cardIds, bet });
    return s;
  }

  it('押注不能超过出牌数、不能低于场上最大押注；加牌/加注受牌数上限约束', () => {
    const { s: s0, declarerSeat } = newGame(3);
    const a = nextVoterOf(s0, declarerSeat);
    const b = nextVoterOf(s0, a);
    replaceHands(s0, {
      [declarerSeat]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [a]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'],
      [b]: ['♠6', '♣7', '♦4', '♣5', '♠9', '♣J'],
    });
    let s = openRound(s0, declarerSeat, ['♠A', '♥A', '♦K'], 3);

    expect(tryAct(s, a, { t: 'play', cardIds: ['♥K', '♣K'], bet: 4 })).toContain('押注不能超过出牌数');
    expect(tryAct(s, a, { t: 'play', cardIds: ['♥K', '♣K'], bet: 2 })).toContain('押注须 ≥');
    expect(tryAct(s, a, { t: 'agree_end', agree: true })).toContain('你还未出牌');
    expect(tryAct(s, a, { t: 'add_chips', betDelta: 1 })).toContain('出战区为空');
    s = act(s, a, { t: 'play', cardIds: ['♥K', '♣K', '♠5', '♣4'], bet: 3 });
    expect(s.round!.maxBet).toBe(3);
    expect(s.round!.pot).toBe(3 + 3 + 3);

    s = act(s, b, { t: 'play', cardIds: ['♠6', '♣7', '♦4'], bet: 3 });
    // 轮回宣战者：加牌不加注（已押满）
    s = act(s, declarerSeat, { t: 'add_cards', cardIds: ['♣Q'], betDelta: 0 });
    expect(seatOf(s, declarerSeat).battlefield).toHaveLength(4);
    expect(seatOf(s, declarerSeat).betTotal).toBe(3);
    // a 出了 4 张牌，押注可补到 4
    s = act(s, a, { t: 'add_chips', betDelta: 1 });
    expect(seatOf(s, a).betTotal).toBe(4);
    expect(s.round!.maxBet).toBe(4);
    expect(tryAct(s, b, { t: 'add_chips', betDelta: 2 })).toContain('超过出战区牌数');
    expect(s.round!.pot).toBe(3 + 3 + 3 + 3 + 1);
  });

  it('加注会重置同意状态', () => {
    const { s: s0, declarerSeat } = newGame(3);
    const a = nextVoterOf(s0, declarerSeat);
    const b = nextVoterOf(s0, a);
    replaceHands(s0, {
      [declarerSeat]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [a]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'],
      [b]: ['♠6', '♣7', '♦4', '♣5', '♠9', '♣J'],
    });
    let s = openRound(s0, declarerSeat, ['♠A', '♥A'], 1);
    s = act(s, a, { t: 'play', cardIds: ['♥K', '♣K'], bet: 1 });
    s = act(s, b, { t: 'fold' });
    s = act(s, declarerSeat, { t: 'agree_end', agree: true });
    s = act(s, a, { t: 'add_chips', betDelta: 1 });
    expect(s.players[declarerSeat]!.agreeEnd).toBe(false);
  });
});

describe('超时自动动作（虚拟时钟）', () => {
  it('开局超时自动最小开局；全员已押满则逐个自动同意直至摊牌', () => {
    const { s: s0, declarerSeat } = newGame(3);
    let s = s0;
    replaceHands(s, {
      [declarerSeat]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
    });
    for (let i = 0; i < 3; i++) s = act(s, i, { t: 'pass_defense' }, T0 + 1000);

    // 宣战者超时 → 自动出 1 张最小牌（♥3）押 0
    const t1 = tick(s, T0 + 1000 + TURN_MS + 1);
    s = t1.state;
    expect(s.round!.phase).toBe('rotation');
    expect(s.players[declarerSeat]!.battlefield).toHaveLength(1);
    expect(s.players[declarerSeat]!.betTotal).toBe(0);

    // 每个 tick 只推进一个超时自动动作；连续 tick 直至全员同意摊牌
    for (let i = 2; i <= 10; i++) {
      s = tick(s, T0 + 1000 + TURN_MS + TURN_MS * i + 1).state;
      if (s.round!.phase === 'settlement') break;
    }
    expect(s.round!.phase).toBe('settlement');
    expect(s.round!.result!.voidRound).toBe(false);
  });

  it('轮转超时：押注不足者自动出牌补齐到场上最大押注', () => {
    const { s: s0, declarerSeat } = newGame(2);
    const a = nextVoterOf(s0, declarerSeat);
    replaceHands(s0, {
      [declarerSeat]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [a]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'],
    });
    let s = s0;
    for (let i = 0; i < 2; i++) s = act(s, i, { t: 'pass_defense' }, T0 + 1000);
    s = act(s, declarerSeat, { t: 'play', cardIds: ['♠A', '♥A', '♦K'], bet: 3 }, T0 + 2000);

    // a 超时：出战区为空，自动出最小的 3 张押 3
    const t = tick(s, T0 + 2000 + TURN_MS + 1);
    s = t.state;
    const pa = seatOf(s, a);
    expect(pa.battlefield).toHaveLength(3);
    expect(pa.betTotal).toBe(3);
    // 双方已押满 → 后续超时自动同意 → 摊牌
    let phase = s.round!.phase;
    for (let i = 2; i <= 10 && phase !== 'settlement'; i++) {
      s = tick(s, T0 + 2000 + TURN_MS * i + 1).state;
      phase = s.round!.phase;
    }
    expect(phase).toBe('settlement');
  });

  it('全桌挂机 90 秒兜底进入摊牌', () => {
    const { s: s0, declarerSeat } = newGame(2);
    let s = s0;
    replaceHands(s0, {
      [declarerSeat]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [nextVoterOf(s0, declarerSeat)]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'],
    });
    for (let i = 0; i < 2; i++) s = act(s, i, { t: 'pass_defense' }, T0 + 1000);
    s = act(s, declarerSeat, { t: 'play', cardIds: ['♠A', '♥A'], bet: 2 }, T0 + 2000);
    s = act(s, nextVoterOf(s, declarerSeat), { t: 'play', cardIds: ['♥K', '♣K'], bet: 2 }, T0 + 3000);
    // 后续超时自动同意，逐 tick 推进到摊牌
    let phase = s.round!.phase;
    for (let i = 1; i <= 10 && phase !== 'settlement'; i++) {
      s = tick(s, T0 + 3000 + TURN_MS * i + 1).state;
      phase = s.round!.phase;
    }
    expect(phase).toBe('settlement');
  });
});

describe('淘汰与终局', () => {
  it('筹码归零淘汰，最后存活者获胜；可再来一局', () => {
    const { s: s0, declarerSeat } = newGame(2);
    const a = nextVoterOf(s0, declarerSeat);
    replaceHands(s0, {
      [declarerSeat]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [a]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'],
    });
    let s = s0;
    seatOf(s, a).chips = 1; // a 只剩 1 筹码（底注已扣）

    for (let i = 0; i < 2; i++) s = act(s, i, { t: 'pass_defense' }, T0 + 1000);
    s = act(s, declarerSeat, { t: 'play', cardIds: ['♠A', '♥A', '♦K', '♣Q'], bet: 4 }, T0 + 2000);
    // a 押不起 4（只剩 1 筹码），只能弃牌
    s = act(s, a, { t: 'fold' }, T0 + 3000);
    expect(s.round!.phase).toBe('settlement');
    expect(s.round!.result!.winnerSeat).toBe(declarerSeat);
    expect(seatOf(s, declarerSeat).chips).toBe(START_CHIPS - ANTE - 4 + (2 + 4));
    expect(seatOf(s, a).chips).toBe(1); // 弃牌不退款，仍是 1，未归零

    // 第二回合：a 底注后 0 筹码，弃牌后归零淘汰 → 终局
    let t = tick(s, T0 + 3000 + TIMING.settlementMs + 1);
    s = t.state;
    expect(s.round!.roundNo).toBe(2);
    expect(seatOf(s, a).chips).toBe(0);
    const opener = s.round!.declarerSeat;
    expect(opener).toBe(declarerSeat);
    replaceHands(s, {
      [opener]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [opener === 0 ? 1 : 0]: ['♠5', '♥9', '♦J', '♣2', '♥4', '♦8'],
    });
    for (let i = 0; i < 2; i++) s = act(s, i, { t: 'pass_defense' }, T0 + 5000);
    s = act(s, opener, { t: 'play', cardIds: ['♠A', '♥A'], bet: 2 }, T0 + 6000);
    const err = tryAct(s, a, { t: 'play', cardIds: ['♠5'], bet: 0 });
    expect(err).toContain('押注须 ≥');
    const t2 = tick(s, T0 + 6000 + TURN_MS + 1);
    s = t2.state;
    // 自动弃牌 → 只剩一人 → 立即摊牌结算 → 0 筹码淘汰
    expect(['folded', 'out']).toContain(seatOf(s, a).status);
    expect(s.round!.phase).toBe('settlement');
    expect(seatOf(s, a).chips).toBe(0);

    const t3 = tick(s, T0 + 6000 + TURN_MS + TIMING.settlementMs + 1);
    s = t3.state;
    expect(s.phase).toBe('gameover');
    expect(s.winnerSeat).toBe(opener);

    const r = rematch(s, opener);
    expect(r.ok).toBe(true);
    expect(s.phase).toBe('lobby');
    expect(seatOf(s, opener).chips).toBe(START_CHIPS);
  });
});

describe('房间自定义参数', () => {
  it('初始筹码与底注生效', () => {
    let s = createGameState('CFG1', { startChips: 50, ante: 2 });
    for (let i = 0; i < 3; i++) addPlayer(s, `P${i}`);
    const g = startGame(s, 0, 7, T0);
    if (!g.ok) throw new Error(g.error);
    s = g.state;
    for (const p of s.players) expect(p!.chips).toBe(48); // 50 - 底注 2
    expect(s.round!.pot).toBe(6);
  });

  it('不限时（turnMs=0）不会触发超时自动动作', () => {
    const { s: s0 } = newGame(2);
    let s = { ...s0, settings: { ...s0.settings, defenseMs: 0, turnMs: 0 } };
    s = act(s, 0, { t: 'pass_defense' }, T0 + 1000);
    s = act(s, 1, { t: 'pass_defense' }, T0 + 1000);
    expect(s.round!.phase).toBe('opening');
    // 十分钟后依旧不超时
    const t = tick(s, T0 + 600_000);
    expect(t.state.round!.phase).toBe('opening');
    expect(t.events).toHaveLength(0);
  });

  it('normalizeSettings 兜底非法值', () => {
    const st = normalizeSettings({ startChips: -5, ante: 99999, turnMs: 1 } as never);
    expect(st.startChips).toBe(10);
    expect(st.ante).toBe(1000);
    expect(st.turnMs).toBe(10_000);
  });
});

describe('单张出牌不明牌', () => {
  it('首段单张出战不亮牌；加多张牌恢复亮牌', () => {
    const { s: s0, declarerSeat } = newGame(2);
    const a = nextVoterOf(s0, declarerSeat);
    replaceHands(s0, {
      [declarerSeat]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [a]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'],
    });
    let s = s0;
    for (let i = 0; i < 2; i++) s = act(s, i, { t: 'pass_defense' }, T0 + 1000);
    s = act(s, declarerSeat, { t: 'play', cardIds: ['♦K'], bet: 1 }, T0 + 2000);
    expect(seatOf(s, declarerSeat).playSegments).toHaveLength(1);
    expect(seatOf(s, declarerSeat).playSegments[0].top).toBeNull(); // 单张不明牌
    expect(seatOf(s, declarerSeat).battlefield).toHaveLength(1);

    s = act(s, a, { t: 'play', cardIds: ['♥K', '♣K'], bet: 1 }, T0 + 3000);
    expect(seatOf(s, a).playSegments[0].top!.id).toBe('♣K'); // 两张起亮最大牌（♣ > ♥）

    s = act(s, declarerSeat, { t: 'add_cards', cardIds: ['♠A', '♥A'], betDelta: 0 }, T0 + 4000);
    const tops = seatOf(s, declarerSeat).playSegments;
    expect(tops).toHaveLength(2); // 两个出牌段
    expect(tops[0].top).toBeNull(); // 首段单张保持隐藏
    expect(tops[1].top!.id).toBe('♠A'); // 本段 2 张 → 亮最大 ♠A
  });
});

describe('筹码倍数', () => {
  it('倍数 2 时，2 张牌最多押 4', () => {
    let s = createGameState('MUL1', { chipMultiplier: 2 });
    for (let i = 0; i < 2; i++) addPlayer(s, `P${i}`);
    const g = startGame(s, 0, 7, T0);
    if (!g.ok) throw new Error(g.error);
    s = g.state;
    const d = s.round!.declarerSeat;
    const a = nextVoterOf(s, d);
    replaceHands(s, {
      [d]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [a]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'],
    });
    for (let i = 0; i < 2; i++) s = act(s, i, { t: 'pass_defense' }, T0 + 1000);
    // 2 张牌 ×2 倍 = 押 4 合法；押 5 拒绝
    s = act(s, d, { t: 'play', cardIds: ['♠A', '♥A'], bet: 4 }, T0 + 2000);
    expect(seatOf(s, d).betTotal).toBe(4);
    const err = tryAct(s, a, { t: 'play', cardIds: ['♥K', '♣K', '♠5'], bet: 7 });
    expect(err).toContain('不能超过出牌数 × 筹码倍数');
    s = act(s, a, { t: 'play', cardIds: ['♥K', '♣K', '♠5'], bet: 6 }, T0 + 3000);
    expect(s.round!.maxBet).toBe(6);
  });
});

describe('备战继承手牌', () => {
  it('未使用手牌保留到下一回合，只补足 6 张', () => {
    const { s: s0, declarerSeat } = newGame(3);
    let s = s0;
    const other1 = nextVoterOf(s, declarerSeat);
    const other2 = nextVoterOf(s, other1);
    replaceHands(s, {
      [declarerSeat]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [other1]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'],
      [other2]: ['♠6', '♣7', '♦4', '♣5', '♠9', '♣J'],
    });
    for (const seat of [declarerSeat, other1, other2]) s = act(s, seat, { t: 'pass_defense' });
    s = act(s, declarerSeat, { t: 'play', cardIds: ['♠A', '♥A'], bet: 1 });
    s = act(s, other1, { t: 'play', cardIds: ['♥K', '♣K'], bet: 1 });
    s = act(s, other2, { t: 'fold' });
    s = act(s, declarerSeat, { t: 'agree_end', agree: true });
    s = act(s, other1, { t: 'agree_end', agree: true });

    // 记录各家未使用手牌
    const kept: Record<number, string[]> = {};
    for (const p of s.players) {
      if (!p) continue;
      kept[p.seat] = s.secret!.hands[p.seat].map((c) => c.id);
    }

    const t = tick(s, T0 + 1000 + TIMING.settlementMs + 1);
    s = t.state;
    expect(s.round!.roundNo).toBe(2);
    // 上一回合没用过的牌必须还在手里
    for (const p of s.players) {
      if (!p) continue;
      const now = new Set(s.secret!.hands[p.seat].map((c) => c.id));
      expect(s.secret!.hands[p.seat]).toHaveLength(HAND_SIZE);
      for (const id of kept[p.seat]) expect(now.has(id)).toBe(true);
    }
    expect(cardTotal(s)).toBe(52);
  });
});

describe('杂项校验', () => {
  it('错误的时机与角色被拒绝', () => {
    const { s, declarerSeat } = newGame(3);
    expect(tryAct(s, declarerSeat, { t: 'force_close_defense' })).toBeNull(); // 宣战者可以提前开始
    const { s: s2, declarerSeat: d2 } = newGame(3);
    const notDeclarer = nextVoterOf(s2, d2);
    expect(tryAct(s2, notDeclarer, { t: 'force_close_defense' })).toContain('只有宣战者');
    expect(tryAct(s2, notDeclarer, { t: 'declare_defense', cardIds: [] })).toContain('至少打出一张');
    const hisCard = s2.secret!.hands[notDeclarer][0].id;
    seatOf(s2, notDeclarer).chips = 0; // 身无分文：2 张（需另付 1）付不起，1 张 ≤ 底注不用再付
    expect(tryAct(s2, notDeclarer, { t: 'declare_defense', cardIds: [hisCard, s2.secret!.hands[notDeclarer][1].id] })).toContain('筹码不够');
    expect(tryAct(s2, notDeclarer, { t: 'declare_defense', cardIds: [hisCard] })).toBeNull();
  });

  it('防守声明后本回合被锁定', () => {
    const { s: s0, declarerSeat } = newGame(3);
    let s = s0;
    const a = nextVoterOf(s0, declarerSeat);
    replaceHands(s0, { [a]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'] });
    s = act(s, a, { t: 'declare_defense', cardIds: ['♥K', '♣K'] });
    expect(tryAct(s, a, { t: 'fold' })).toContain('现在不能弃牌'); // 还在防守窗口
    expect(tryAct(s, a, { t: 'declare_defense', cardIds: ['♠5'] })).toContain('表态');
  });
});

describe('付不起底注的玩家在回合开始即淘汰', () => {
  // ante=3 固定不递增；打完第 1 回合后人为把筹码改成 <3，模拟破产玩家进入下一回合
  function playOneRound(seed = 7): { s: GameState; winnerSeat: number } {
    let s = createGameState('TST2', { ante: 3, anteRamp: 0, settlementMs: 5_000, defenseMs: 20_000, turnMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      const r = addPlayer(s, `P${i}`);
      if (!r.ok) throw new Error(r.error);
    }
    const g = startGame(s, 0, seed, T0);
    if (!g.ok) throw new Error(g.error);
    s = g.state;
    const declarer = s.round!.declarerSeat;
    const a = nextVoterOf(s, declarer);
    const b = nextVoterOf(s, a);
    replaceHands(s, {
      [declarer]: ['♠A', '♥A', '♦K', '♣Q', '♦9', '♥3'],
      [a]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'],
      [b]: ['♠6', '♣7', '♦4', '♣5', '♠9', '♣J'],
    });
    for (const seat of [declarer, a, b]) s = act(s, seat, { t: 'pass_defense' }, T0 + 1000);
    s = act(s, declarer, { t: 'play', cardIds: ['♠A', '♥A'], bet: 1 }, T0 + 2000);
    s = act(s, a, { t: 'fold' }, T0 + 3000);
    s = act(s, b, { t: 'fold' }, T0 + 4000);
    expect(s.round!.phase).toBe('settlement');
    return { s, winnerSeat: declarer };
  }

  it('破产玩家不再被扣底注、不发牌、手牌回牌堆', () => {
    const { s: s0 } = playOneRound();
    const broke = (s0.round!.result!.winnerSeat! + 1) % 3; // 任选一个输家
    seatOf(s0, broke)!.chips = 2; // < 底注 3
    const t = tick(s0, T0 + 5000 + TIMING.settlementMs + 1);
    const s = t.state;
    expect(s.round!.roundNo).toBe(2);
    expect(seatOf(s, broke).status).toBe('out');
    expect(seatOf(s, broke).chips).toBe(2); // 不再被扣，更不会变负数
    expect(seatOf(s, broke).lastAction).toBe('筹码付不起底注');
    expect(s.round!.pot).toBe(3 * 2); // 奖池只含两名付得起底注的玩家
    expect(s.secret!.hands[broke]).toHaveLength(0); // 不发牌
    expect(cardTotal(s)).toBe(52); // 出局者手牌回牌堆，总牌数守恒
    expect(t.events).toContainEqual({ t: 'eliminated', seat: broke });
    expect(s.phase).toBe('playing'); // 还有 2 人，游戏继续
  });

  it('只剩一人付得起底注 → 直接终局，该玩家获胜', () => {
    const { s: s0, winnerSeat } = playOneRound();
    const others = [0, 1, 2].filter((i) => i !== winnerSeat);
    seatOf(s0, others[0]).chips = 1;
    seatOf(s0, others[1]).chips = 2;
    const t = tick(s0, T0 + 5000 + TIMING.settlementMs + 1);
    const s = t.state;
    expect(s.phase).toBe('gameover');
    expect(s.winnerSeat).toBe(winnerSeat);
    expect(t.events.at(-1)).toEqual({ t: 'game_over', winnerSeat });
  });

  it('全员付不起底注的极端情形 → 破产者中筹码最多者获胜', () => {
    const { s: s0 } = playOneRound();
    for (const p of s0.players) if (p) p.chips = 1;
    seatOf(s0, 2).chips = 2; // 三人都 <3，座位 2 相对最多
    const t = tick(s0, T0 + 5000 + TIMING.settlementMs + 1);
    expect(t.state.phase).toBe('gameover');
    expect(t.state.winnerSeat).toBe(2);
  });
});
