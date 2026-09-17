import {
  GameAction,
  GameState,
  addCardsBetRange,
  addPlayer,
  legalActions,
} from '../../shared/src/index';
import { Room } from './rooms';

/**
 * 开发/补位用机器人：按当前合法操作随机行动，倾向于"同意结束"保证对局能推进。
 *
 * 决策逻辑抽成纯函数 `planBotAction`，一是便于测试，二是为了把
 * 「轮不到机器人」和「轮到机器人但一个合法动作都没有」区分开：
 * 后者必须重挂定时器，否则机器人会永久停摆、整局卡死。
 */

/** 机器人的决策结果 */
export type BotPlan =
  /** 该机器人行动了 */
  | { kind: 'act'; seat: number; action: GameAction }
  /** 现在没有机器人需要行动（轮到玩家 / 大厅 / 已结束） */
  | { kind: 'idle' }
  /** 有机器人该行动，但当前状态下它一个合法动作都选不出来 */
  | { kind: 'stuck'; seat: number };

function aliveBotSeats(s: GameState): number[] {
  return s.players.filter((p) => p?.isBot && p.status !== 'out').map((p) => p!.seat);
}

/**
 * 给定状态，算出机器人此刻要做什么。
 *
 * 出牌阶段的候选动作排成「先按性格挑一个，取不到就沿兜底链往下退」：
 * 补牌 → 加注 → 首次出牌 → 同意收手 → 弃牌。
 * 这样即便对手把押注抬到机器人补不起（`canAddCards` 为真但
 * `addCardsBetRange` 返回 null），它也一定会退到弃牌，而不是什么都不做。
 */
export function planBotAction(s: GameState, rand: () => number = Math.random): BotPlan {
  if (s.phase !== 'playing') return { kind: 'idle' };
  const r = s.round;
  if (!r) return { kind: 'idle' };

  const bots = aliveBotSeats(s);
  if (bots.length === 0) return { kind: 'idle' };

  const secret = s.secret;
  if (!secret) return { kind: 'idle' };
  const handOf = (seat: number) => secret.hands[seat] ?? [];
  const pick = (seat: number, n: number) => handOf(seat).slice(0, n).map((c) => c.id);

  if (r.phase === 'defense_window') {
    const seat = bots.find((b) => s.players[b]?.status === 'active' && !s.players[b]?.defensePassed);
    if (seat === undefined) return { kind: 'idle' }; // 机器人都已表态
    const hand = handOf(seat);
    const chips = s.players[seat]!.chips;
    // 防守的合法约束是「牌数 ≤ 托管 ≤ 筹码」，所以牌数也不能超过筹码；
    // 早期版本先按牌数取托管再 max 回牌数，筹码不足时会给出托管超过筹码的非法动作
    const maxCards = Math.min(hand.length, chips);
    let action: GameAction;
    if (rand() < 0.25 && maxCards >= 1) {
      const n = Math.min(maxCards, 1 + Math.floor(rand() * 3));
      const escrow = Math.min(n + Math.floor(rand() * 3), chips);
      action = { t: 'declare_defense', cardIds: pick(seat, n), escrow };
    } else {
      action = { t: 'pass_defense' };
    }
    return { kind: 'act', seat, action };
  }

  if (r.phase !== 'opening' && r.phase !== 'rotation') return { kind: 'idle' };

  const seat = r.turnSeat;
  const p = s.players[seat];
  if (!p?.isBot) return { kind: 'idle' }; // 轮到玩家：等玩家

  const la = legalActions(s, seat);
  const hand = handOf(seat);
  const mult = s.settings.chipMultiplier;

  const tryAgree = (): GameAction | null => (la.canAgree ? { t: 'agree_end', agree: true } : null);

  const tryAddCards = (): GameAction | null => {
    if (!la.canAddCards) return null;
    // 加得越多押注上限越高：从多到少试，先看能不能一次补够
    for (let n = Math.min(hand.length, 4); n >= 1; n--) {
      const range = addCardsBetRange(
        { betTotal: p.betTotal, chips: p.chips, battlefieldCount: p.battlefield.length },
        n,
        r.maxBet,
        mult,
      );
      if (!range) continue;
      // 只补到下限（够跟注就收），别把筹码一股脑压上去
      const delta = Math.min(range.max, range.min);
      if (delta < 0) continue;
      return { t: 'add_cards', cardIds: pick(seat, n), betDelta: delta };
    }
    return null;
  };

  const tryAddChips = (): GameAction | null => {
    if (!la.canAddChips) return null;
    const { min, max } = la.canAddChips;
    // 至少加 1 个筹码：加注 0 是空动作，还会把全桌的同意清掉
    const lo = Math.max(1, min);
    if (max < lo) return null;
    const delta = Math.min(max, lo + Math.floor(rand() * (max - lo + 1)));
    return { t: 'add_chips', betDelta: delta };
  };

  const tryPlay = (): GameAction | null => {
    if (!la.canPlay) return null;
    // 首选"无人押注时也至少押 1"，免得出现毫无意义的 0 押注；
    // 但引擎只要求 bet ≥ maxBet、bet ≤ 出牌数×倍数、bet ≤ 筹码，
    // 所以筹码为 0 时押 0 是合法的。第一次选不出来就退回严格合法的下限，
    // 否则 0 筹码的机器人会一直选不出动作。
    for (const lo of [Math.max(r.maxBet, 1), r.maxBet]) {
      for (let n = 1; n <= hand.length; n++) {
        const hi = Math.min(n * mult, p.chips);
        if (hi >= lo) {
          const bet = lo + Math.floor(rand() * (hi - lo + 1));
          return { t: 'play', cardIds: pick(seat, n), bet };
        }
      }
    }
    return null;
  };

  const tryFold = (): GameAction | null => (la.canFold ? { t: 'fold' } : null);

  // 先按"性格"随机挑一个想做的，取不到就沿兜底链往下退
  const roll = rand();
  const chain =
    r.phase === 'rotation' && roll < 0.55
      ? [tryAgree, tryAddCards, tryAddChips, tryPlay, tryFold]
      : r.phase === 'rotation' && roll < 0.75
        ? [tryAddCards, tryAddChips, tryPlay, tryAgree, tryFold]
        : [tryPlay, tryAddCards, tryAddChips, tryAgree, tryFold];

  for (const attempt of chain) {
    const action = attempt();
    if (action) return { kind: 'act', seat, action };
  }

  // 一个合法动作都选不出来：交给调用方重挂定时器等状态变化
  return { kind: 'stuck', seat };
}

export class BotDriver {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    /** 返回 true 表示动作被引擎接受；false 表示被拒（该动作不该再被当作可选） */
    private apply: (room: Room, seat: number, action: GameAction) => boolean,
    private rand: () => number = Math.random,
  ) {}

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  forget(code: string) {
    const t = this.timers.get(code);
    if (t) clearTimeout(t);
    this.timers.delete(code);
  }

  /** 每次 commit 后调用：若场上有需要行动的机器人，安排思考 */
  kick(room: Room) {
    if (this.timers.has(room.code)) return;
    this.schedule(room, 600 + this.rand() * 1400);
  }

  /** 安排一次「思考」；每个房间同时只挂一个定时器 */
  private schedule(room: Room, delay: number) {
    const t = setTimeout(() => {
      this.timers.delete(room.code);
      this.actOnce(room);
    }, delay);
    this.timers.set(room.code, t);
  }

  private actOnce(room: Room) {
    const plan = planBotAction(room.state, this.rand);
    if (plan.kind === 'act') {
      if (this.apply(room, plan.seat, plan.action)) return;
      // 动作被引擎拒绝：绝不能就此沉默——定时器已经清掉了，而没人会再 kick，
      // 这个房间就再也没人推进。重挂一次，等状态变化或换个决策。
      this.schedule(room, 800);
      return;
    }
    if (plan.kind === 'stuck') {
      // 同理：有机器人该动却选不出动作，也要重挂，不能停摆。
      this.schedule(room, 800);
    }
  }
}

export function addBot(room: Room, index: number): { ok: boolean; error?: string } {
  return addPlayer(room.state, `${index + 1}`, true);
}
