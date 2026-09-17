import { GameState, RoundPhase } from './types';
import { getPlayer } from './seating';

/**
 * 某座位此刻的合法操作（服务端校验与前端按钮渲染共用同一份逻辑）。
 * 押注上限是累计概念：总押注 ≤ 出战区牌数；押注还受剩余筹码约束。
 */
export interface LegalActions {
  roundPhase: RoundPhase | null;
  isYourTurn: boolean;
  canDeclareDefense: boolean; // 防守窗口：宣布防守
  canPassDefense: boolean; // 防守窗口：表态不防守
  canForceCloseDefense: boolean; // 宣战者：提前关闭防守窗口
  canPlay: boolean; // 出战区为空时首次出牌（opening/rotation 均可）
  canAddCards: boolean; // rotation：加牌
  canAddChips: { min: number; max: number } | null; // rotation：只加筹码的范围
  canFold: boolean;
  canAgree: boolean;
  maxBet: number;
  cardCap: number; // 当前押注上限 = 出战区牌数
  handCount: number;
  chips: number; // 剩余可自由支配的筹码（已押部分已扣除）
}

export function emptyLegal(phase: RoundPhase | null): LegalActions {
  return {
    roundPhase: phase,
    isYourTurn: false,
    canDeclareDefense: false,
    canPassDefense: false,
    canForceCloseDefense: false,
    canPlay: false,
    canAddCards: false,
    canAddChips: null,
    canFold: false,
    canAgree: false,
    maxBet: 0,
    cardCap: 0,
    handCount: 0,
    chips: 0,
  };
}

export function legalActions(s: GameState, seat: number): LegalActions {
  const p = getPlayer(s, seat);
  const r = s.round;
  if (!p || s.phase !== 'playing' || !r || p.status === 'out') return emptyLegal(null);

  const base = emptyLegal(r.phase);
  base.handCount = s.secret!.hands[seat].length;
  base.chips = p.chips;

  if (r.phase === 'defense_window') {
    if (p.status === 'active') {
      base.canDeclareDefense = !p.defensePassed;
      base.canPassDefense = !p.defensePassed;
    }
    base.canForceCloseDefense = seat === r.declarerSeat;
    return base;
  }

  if (r.phase === 'settlement') return base;

  // opening / rotation
  base.maxBet = r.maxBet;
  base.cardCap = p.battlefield.length;
  base.isYourTurn = r.turnSeat === seat;

  if (p.status !== 'active') return base; // 已防守/弃牌者无可操作项

  if (!base.isYourTurn) return base;

  base.canPlay = p.battlefield.length === 0 && base.handCount >= 1;
  // 弃牌只在轮转阶段合法（宣战阶段庄家必须开局，见 rules.ts 的 fold 分支）。
  // 这里必须与 applyAction 的校验保持一致，否则前端会亮出一个点了会被拒的按钮、
  // 机器人也会挑到"看似合法实则被拒"的动作，进而整局卡住。
  base.canFold = r.phase === 'rotation';

  if (p.battlefield.length >= 1) {
    base.canAddCards = base.handCount >= 1;
    const min = Math.max(0, r.maxBet - p.betTotal);
    const max = Math.min(p.chips, p.battlefield.length * s.settings.chipMultiplier - p.betTotal);
    // max >= 1：加注 0 是空动作，而且 applyAddChips 会 resetAgrees
    // 把全桌的"同意结束"清掉——等于白送对手一次反悔机会。所以直接不列为可选。
    // （这种情况一定同时 canAgree，玩家不会因此无路可走。）
    base.canAddChips = max >= min && max >= 1 ? { min, max } : null;
    base.canAgree = p.battlefield.length >= 1 && p.betTotal >= r.maxBet;
  } else {
    // 出战区为空：rotation 中首次出牌须押 ≥ maxBet，检查是否凑得出
    base.canPlay = base.canPlay && canAffordBet(base.handCount, p.chips, r.maxBet, s.settings.chipMultiplier);
  }
  return base;
}

/** 用 n 张牌（押注 ≤ n×倍数）与 chips 筹码能否凑出 ≥ target 的押注 */
export function canAffordBet(nCards: number, chips: number, target: number, mult = 1): boolean {
  return Math.min(nCards * mult, chips) >= target;
}

/** 加 n 张牌后允许的押注增量范围 [min, max]，不合法返回 null */
export function addCardsBetRange(p: { betTotal: number; chips: number; battlefieldCount: number }, n: number, maxBet: number, mult = 1): { min: number; max: number } | null {
  const min = Math.max(0, maxBet - p.betTotal);
  const max = Math.min(p.chips, (p.battlefieldCount + n) * mult - p.betTotal);
  if (max < min || max < 0) return null;
  return { min, max };
}
