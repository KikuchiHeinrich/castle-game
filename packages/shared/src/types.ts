// ============ 基础牌面 ============

/** 花色：0方片 < 1红桃 < 2梅花 < 3黑桃（数值即花色大小） */
export type Suit = 0 | 1 | 2 | 3;

export const SUIT_NAMES = ['方片', '红桃', '梅花', '黑桃'] as const;
export const SUIT_CHARS = ['♦', '♥', '♣', '♠'] as const;
export const RANK_CHARS = ['?', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

export interface Card {
  id: string; // 如 '♠A'，52 张全唯一
  suit: Suit;
  rank: number; // 1..13，A=1
}

export function cardLabel(c: Card): string {
  return `${SUIT_CHARS[c.suit]}${RANK_CHARS[c.rank]}`;
}

/** 规则③④的"有效点数"：A 一般按 14 计；唯一例外是 A 用作低顺（A2345）时记 1（由 evaluator 显式传 lowA） */
export function effectiveRank(rank: number, lowA = false): number {
  if (rank === 1) return lowA ? 1 : 14;
  return rank;
}

// ============ 牌型 ============

export interface HandValue {
  typeRank: number; // 1..22，见 handTypes.ts
  junk: number; // 杂牌数（掺水规则，少者胜）
  keyRank: number; // 规则③：牌型组成牌中最大牌点数（A 低顺时取顺子顶，如 A2345→5）
  keySuit: Suit; // 规则④：该最大牌的花色
  usedIds: string[]; // 牌型用牌（其余出战区牌即杂牌）
  name: string; // 中文名，如 '三同花'
  alias: string; // 别称，如 '浪花'
}

/** 严格全序比较：①牌型排名 ②杂牌少者胜 ③最大牌点数 ④花色。相等的两张牌必是同一张牌 */
export function compareHandValue(a: HandValue, b: HandValue): number {
  if (a.typeRank !== b.typeRank) return a.typeRank - b.typeRank;
  if (a.junk !== b.junk) return b.junk - a.junk;
  if (a.keyRank !== b.keyRank) return a.keyRank - b.keyRank;
  return a.keySuit - b.keySuit;
}

// ============ 玩家 / 回合 ============

export type PlayerStatus = 'idle' | 'active' | 'folded' | 'defended' | 'out';
export type RoundPhase = 'defense_window' | 'opening' | 'rotation' | 'settlement';

/** 房间自定义参数（建房时定，整局固定；时长 0 = 不限时） */
export interface RoomSettings {
  startChips: number; // 初始筹码
  ante: number; // 每回合底注
  defenseMs: number; // 防守宣言阶段时长（0 = 不限时）
  turnMs: number; // 宣战 / 跟牌：每人行动时长（0 = 不限时）
  /** 摊牌展示时长：等这么久再开下一回合（0 = 不等待，立刻继续） */
  settlementMs: number;
  /** 底注递增间隔：每这么多回合底注 +1（0 = 不递增）。用于加速收敛 */
  anteRamp: number;
  /**
   * 回合上限：打到这个回合数仍未分出胜负时，筹码最多者获胜（0 = 无上限）。
   * 必须有这个上限——底注只是加大步长、奖池全额返还，筹码本身是无漂移的
   * 随机游走，纯靠淘汰可能要几百回合，一局能拖一个小时。
   */
  maxRounds: number;
  idleMs: number; // 全桌无动作兜底（0 = 不限时）
  chipMultiplier: number; // 筹码倍数：押注上限 = 出战区牌数 × 倍数
}

export const DEFAULT_SETTINGS: RoomSettings = {
  startChips: 100,
  ante: 1,
  defenseMs: 20_000,
  turnMs: 60_000,
  settlementMs: 5_000,
  anteRamp: 3,
  maxRounds: 30,
  idleMs: 180_000,
  chipMultiplier: 1,
};

/**
 * 各设置项的合法区间，前后端共用：客户端据此限制输入，服务端据此夹紧。
 * 时长项的 lo 是"有效的最小值"；0 是额外允许的特例，含义是"不限时"
 * （摊牌展示的 0 是"不等待"）。客户端要按同样的规则回显，别把玩家填的 0 夹成 lo。
 */
export const SETTINGS_RANGE = {
  startChips: { lo: 10, hi: 100_000, step: 10 },
  ante: { lo: 1, hi: 1_000, step: 1 },
  defenseMs: { lo: 5_000, hi: 600_000, step: 5_000 },
  turnMs: { lo: 10_000, hi: 1_200_000, step: 5_000 },
  settlementMs: { lo: 0, hi: 60_000, step: 1_000 },
  anteRamp: { lo: 0, hi: 50, step: 1 },
  maxRounds: { lo: 0, hi: 999, step: 5 },
  idleMs: { lo: 30_000, hi: 3_600_000, step: 10_000 },
  chipMultiplier: { lo: 1, hi: 5, step: 1 },
} as const;

/** 出牌段：本次打出几张 + 亮出的最大牌（仅 1 张的段不亮牌，top 为 null） */
export interface PlaySegment {
  count: number;
  top: Card | null;
}

export interface Player {
  seat: number;
  name: string;
  avatar: string; // 形象 id（pixelAvatar 角色表）
  chips: number;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  away: boolean; // 断线托管中
  // ---- 以下为回合内状态，newRound 时重置 ----
  status: PlayerStatus;
  betTotal: number; // 累计押注（已从筹码扣除、已入奖池）
  invested: number; // 本回合已投入奖池总额（底注 + 押注），作废回合退款用
  battlefield: Card[]; // 出战区
  playSegments: PlaySegment[]; // 出牌段记录：每段张数 + 该段亮出的最大牌（单张段不亮）
  escrow: number; // 防守托管筹码（不进奖池）
  defensePassed: boolean; // 防守窗口表态"不防守"
  agreeEnd: boolean;
  lastAction: string; // 中文，用于座位 HUD
}

export interface ShowdownEntry {
  seat: number;
  cards: Card[];
  usedIds: string[];
  handName: string;
  handAlias: string;
  typeRank: number;
  junk: number;
}

export interface ShowdownResult {
  voidRound: boolean; // 无人有资格竞夺奖池，回合作废
  entries: ShowdownEntry[]; // 按大小降序
  winnerSeat: number | null; // 奖池获得者（非防守者中最大）
  potAmount: number;
  escrowReturns: Record<string, number>; // seatId(字符串) -> 退还托管
  escrowForfeits: Record<string, number>; // seatId(字符串) -> 罚没入池托管
  chipDeltas: Record<string, number>;
  anteRefunds: Record<string, number>; // 作废回合的底注退还
  eliminated: number[];
}

export interface RoundState {
  roundNo: number;
  phase: RoundPhase;
  declarerSeat: number; // 宣战者（庄）
  openerSeat: number; // 开局者
  turnSeat: number; // 轮转中当前行动者
  pot: number;
  /** 本回合实际底注（受底注递增影响，会逐段变大） */
  ante: number;
  maxBet: number; // 未弃牌且未防守玩家的累计押注最大值
  deadlineAt: number; // 毫秒时间戳，0=无
  lastActionAt: number;
  result: ShowdownResult | null;
}

export interface Secret {
  seed: number;
  deck: Card[]; // 牌堆余量
  hands: Card[][]; // 按座位索引
}

export interface GameState {
  code: string;
  phase: 'lobby' | 'playing' | 'gameover';
  settings: RoomSettings;
  players: (Player | null)[]; // 按座位索引，开死后长度固定
  hostSeat: number;
  round: RoundState | null;
  secret: Secret | null; // 绝不进 PlayerView
  lastWinnerSeat: number | null; // 下回合宣战者
  winnerSeat: number | null; // 终局胜者
  eventSeq: number;
  stateSeq: number;
}

// ============ 行动 ============

export type GameAction =
  | { t: 'declare_defense'; cardIds: string[]; escrow: number }
  | { t: 'pass_defense' }
  | { t: 'force_close_defense' }
  | { t: 'play'; cardIds: string[]; bet: number }
  | { t: 'add_cards'; cardIds: string[]; betDelta: number }
  | { t: 'add_chips'; betDelta: number }
  | { t: 'fold' }
  | { t: 'agree_end'; agree: boolean };

export type ActionResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string };

// ============ 事件（驱动前端动画，内容全为公开信息） ============

export type GameEvent =
  | { t: 'game_started'; seats: number[] }
  | { t: 'round_start'; roundNo: number; declarerSeat: number; pot: number; ante: number }
  | { t: 'deal'; counts: [number, number][] } // [seat, 张数]
  | { t: 'defense_declared'; seat: number; cardCount: number; escrow: number; revealedTop: Card | null }
  | { t: 'defense_passed'; seat: number }
  | { t: 'defense_window_closed' }
  | { t: 'round_void'; reason: string }
  | { t: 'play'; seat: number; cardCount: number; bet: number; revealedTop: Card | null }
  | { t: 'add_cards'; seat: number; cardCount: number; betDelta: number; revealedTop: Card | null }
  | { t: 'add_chips'; seat: number; betDelta: number; betTotal: number }
  | { t: 'fold'; seat: number }
  | { t: 'agree'; seat: number; agree: boolean }
  | { t: 'agree_reset' }
  | { t: 'showdown'; entries: ShowdownEntry[] }
  | {
      t: 'winner';
      seat: number | null; // null = 作废回合无人得池
      pot: number;
      result: ShowdownResult;
    }
  | { t: 'eliminated'; seat: number }
  | { t: 'game_over'; winnerSeat: number };
