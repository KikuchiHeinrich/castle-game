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

/** 一段出牌：本次打出几张 + 亮出的最大牌（仅 1 张的段不亮牌，top 为 null） */
export interface PlaySegment {
  count: number;
  top: Card | null;
}

export type PlayerStatus = 'idle' | 'active' | 'folded' | 'defended' | 'out';
export type RoundPhase = 'defense_window' | 'opening' | 'rotation' | 'settlement';

/** 房间自定义参数（建房时定，整局固定；时长 0 = 不限时） */
export interface RoomSettings {
  startChips: number; // 初始筹码
  ante: number; // 每回合底注
  defenseMs: number; // 防守窗口时长
  turnMs: number; // 宣战/轮转单人时长
  idleMs: number; // 全桌无动作兜底
}

export const DEFAULT_SETTINGS: RoomSettings = {
  startChips: 100,
  ante: 1,
  defenseMs: 20_000,
  turnMs: 60_000,
  idleMs: 180_000,
};

export interface Player {
  seat: number;
  name: string;
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
  | { t: 'round_start'; roundNo: number; declarerSeat: number; pot: number }
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
