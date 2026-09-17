import { Card, Suit, compareHandValue, HandValue } from './types';
import { makeHandValue } from './handTypes';

/**
 * 牌型判定器。
 *
 * evaluateSubset：给一个 ≤6 张的牌组，判定它能构成的"最高牌型"——
 * 从位次 22 往下逐个检查，首个命中即分类（位次主导比较元组，数学上安全）。
 *
 * 实现默认值（规则文本未覆盖处，改动只动本文件）：
 * - A 用作低顺（A2345）时，该顺子的"最大牌"取顺子顶（即 5）；其余场合 A 一律按 14。
 * - 高牌的牌型用牌只有最大的一张，其余全是杂牌。
 */

type Key = { rank: number; suit: Suit };

/** 取 (有效点数, 花色) 最大的那张牌作为牌型"最大牌"（规则③④） */
function keyOf(cards: Card[], lowA = false): Key {
  let best: Card = cards[0];
  for (const c of cards) {
    const bc = cmpCard(best, c, lowA);
    if (bc < 0) best = c;
  }
  return { rank: eff(best.rank, lowA), suit: best.suit };
}

function eff(rank: number, lowA: boolean): number {
  return rank === 1 ? (lowA ? 1 : 14) : rank;
}

function cmpCard(a: Card, b: Card, lowA: boolean): number {
  const ra = eff(a.rank, lowA);
  const rb = eff(b.rank, lowA);
  if (ra !== rb) return ra - rb;
  return a.suit - b.suit;
}

/** 同点数的多张牌里取花色最大的一张 */
function bestByRank(cards: Card[], rank: number): Card {
  let best: Card | null = null;
  for (const c of cards) {
    if (c.rank !== rank) continue;
    if (!best || c.suit > best.suit) best = c;
  }
  return best!;
}

// ---------- 预处理 ----------

interface Ctx {
  byRank: Map<number, Card[]>;
  bySuit: Map<Suit, Card[]>;
  ranks: number[]; // 含 A 双重身份：1 与 14
  hasAce: boolean;
}

function preprocess(cards: Card[]): Ctx {
  const byRank = new Map<number, Card[]>();
  const bySuit = new Map<Suit, Card[]>();
  let hasAce = false;
  for (const c of cards) {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank)!.push(c);
    if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
    bySuit.get(c.suit)!.push(c);
    if (c.rank === 1) hasAce = true;
  }
  const ranks = [...byRank.keys()];
  if (hasAce) ranks.push(14);
  return { byRank, bySuit, ranks, hasAce };
}

/** 原始同点数分组（A 不合并身份） */
function rawGroups(ctx: Ctx): Map<number, Card[]> {
  return ctx.byRank;
}

// ---------- 顺子 / 同花 ----------

/** 在 pool 中找长度 L 的最大顺子（A 可高可低），返回顶点与用牌 */
function findStraight(pool: Card[], L: number): { top: number; used: Card[] } | null {
  const rankSet = new Set<number>();
  for (const c of pool) {
    rankSet.add(c.rank);
    if (c.rank === 1) rankSet.add(14);
  }
  for (let top = 14; top >= L; top--) {
    let ok = true;
    for (let r = top - L + 1; r <= top; r++) {
      if (!rankSet.has(r)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const used: Card[] = [];
    for (let r = top - L + 1; r <= top; r++) {
      const real = r === 14 ? 1 : r;
      used.push(bestByRank(pool, real));
    }
    return { top, used };
  }
  return null;
}

/** 同花顺族：任一花色内找长度 L 的顺子 */
function evalStraightFlush(cards: Card[], ctx: Ctx, L: number, typeRank: number): HandValue | null {
  let best: HandValue | null = null;
  for (const [suit, cs] of ctx.bySuit) {
    if (cs.length < L) continue;
    const s = findStraight(cs, L);
    if (!s) continue;
    const hv = makeHandValue(typeRank, cards.length - L, s.top, suit, s.used.map((c) => c.id));
    if (!best || compareHandValue(hv, best) > 0) best = hv;
  }
  return best;
}

/** 普通顺子族（跨花色） */
function evalStraight(cards: Card[], L: number, typeRank: number): HandValue | null {
  const s = findStraight(cards, L);
  if (!s) return null;
  const topCard = s.used[s.used.length - 1]; // used 按升序 push，最后一张即顶
  return makeHandValue(typeRank, cards.length - L, s.top, topCard.suit, s.used.map((c) => c.id));
}

/** 同花族：任一花色 ≥L 张，取该花色点数最高的 L 张 */
function evalFlush(cards: Card[], ctx: Ctx, L: number, typeRank: number): HandValue | null {
  let best: HandValue | null = null;
  for (const cs of ctx.bySuit.values()) {
    if (cs.length < L) continue;
    const sorted = [...cs].sort((a, b) => cmpCard(b, a, false));
    const used = sorted.slice(0, L);
    const k = keyOf(used);
    const hv = makeHandValue(typeRank, cards.length - L, k.rank, k.suit, used.map((c) => c.id));
    if (!best || compareHandValue(hv, best) > 0) best = hv;
  }
  return best;
}

// ---------- 点数计数族 ----------

function pairRanks(ctx: Ctx): number[] {
  const out: number[] = [];
  for (const [rank, cs] of rawGroups(ctx)) if (cs.length >= 2) out.push(rank);
  return out.sort((a, b) => b - a); // 大到小
}

function takeGroup(ctx: Ctx, rank: number, n: number): Card[] {
  const cs = [...rawGroups(ctx).get(rank)!].sort((a, b) => b.suit - a.suit);
  return cs.slice(0, n);
}

/** 4+2 使徒 */
function evalFourTwo(cards: Card[], ctx: Ctx): HandValue | null {
  const groups = rawGroups(ctx);
  let quad = -1;
  for (const [rank, cs] of groups) if (cs.length >= 4) quad = rank;
  if (quad < 0) return null;
  const pairs = pairRanks(ctx).filter((r) => r !== quad);
  if (pairs.length === 0) return null;
  const used = [...takeGroup(ctx, quad, 4), ...takeGroup(ctx, pairs[0], 2)];
  const k = keyOf(used);
  return makeHandValue(21, cards.length - 6, k.rank, k.suit, used.map((c) => c.id));
}

/** 3+3 龙王 */
function evalTwoTrips(cards: Card[], ctx: Ctx): HandValue | null {
  const trips = [...rawGroups(ctx).entries()].filter(([, cs]) => cs.length >= 3).map(([r]) => r).sort((a, b) => b - a);
  if (trips.length < 2) return null;
  const used = [...takeGroup(ctx, trips[0], 3), ...takeGroup(ctx, trips[1], 3)];
  const k = keyOf(used);
  return makeHandValue(20, cards.length - 6, k.rank, k.suit, used.map((c) => c.id));
}

/** 三连对 正义：三个相邻点数各一对（6 张恰好各 2） */
function evalTripleConsecutivePairs(cards: Card[], ctx: Ctx): HandValue | null {
  const has = (r: number) => (rawGroups(ctx).get(r)?.length ?? 0) >= 2;
  for (let top = 13; top >= 3; top--) {
    if (has(top) && has(top - 1) && has(top - 2)) {
      const used = [...takeGroup(ctx, top, 2), ...takeGroup(ctx, top - 1, 2), ...takeGroup(ctx, top - 2, 2)];
      const k = keyOf(used);
      return makeHandValue(18, cards.length - 6, k.rank, k.suit, used.map((c) => c.id));
    }
  }
  return null;
}

/** 四条 贤者 */
function evalQuads(cards: Card[], ctx: Ctx, typeRank: number): HandValue | null {
  const groups = rawGroups(ctx);
  let quad = -1;
  for (const [rank, cs] of groups) if (cs.length >= 4) quad = rank;
  if (quad < 0) return null;
  const used = takeGroup(ctx, quad, 4);
  const k = keyOf(used);
  return makeHandValue(typeRank, cards.length - 4, k.rank, k.suit, used.map((c) => c.id));
}

/** 三对 大剑（不要求相邻） */
function evalThreePairs(cards: Card[], ctx: Ctx): HandValue | null {
  const pairs = pairRanks(ctx);
  if (pairs.length < 3) return null;
  const used = [...takeGroup(ctx, pairs[0], 2), ...takeGroup(ctx, pairs[1], 2), ...takeGroup(ctx, pairs[2], 2)];
  const k = keyOf(used);
  return makeHandValue(13, cards.length - 6, k.rank, k.suit, used.map((c) => c.id));
}

/** 葫芦 龙：三条 + 一对 */
function evalFullHouse(cards: Card[], ctx: Ctx): HandValue | null {
  const trips = [...rawGroups(ctx).entries()].filter(([, cs]) => cs.length >= 3).map(([r]) => r).sort((a, b) => b - a);
  if (trips.length === 0) return null;
  const pairs = pairRanks(ctx).filter((r) => r !== trips[0]);
  if (pairs.length === 0) return null;
  const used = [...takeGroup(ctx, trips[0], 3), ...takeGroup(ctx, pairs[0], 2)];
  const k = keyOf(used);
  return makeHandValue(12, cards.length - 5, k.rank, k.suit, used.map((c) => c.id));
}

/** 三条 骑士 */
function evalTrips(cards: Card[], ctx: Ctx, typeRank: number): HandValue | null {
  const trips = [...rawGroups(ctx).entries()].filter(([, cs]) => cs.length >= 3).map(([r]) => r).sort((a, b) => b - a);
  if (trips.length === 0) return null;
  const used = takeGroup(ctx, trips[0], 3);
  const k = keyOf(used);
  return makeHandValue(typeRank, cards.length - 3, k.rank, k.suit, used.map((c) => c.id));
}

/** 两对 双剑 / 一对 单剑 */
function evalPairs(cards: Card[], ctx: Ctx, typeRank: number): HandValue | null {
  const pairs = pairRanks(ctx);
  const need = typeRank === 5 ? 2 : 1;
  if (pairs.length < need) return null;
  const used: Card[] = [];
  for (let i = 0; i < need; i++) used.push(...takeGroup(ctx, pairs[i], 2));
  const k = keyOf(used);
  return makeHandValue(typeRank, cards.length - need * 2, k.rank, k.suit, used.map((c) => c.id));
}

/** 高牌 散兵：牌型用牌只有最大的一张 */
function evalHighCard(cards: Card[]): HandValue {
  const k = keyOf(cards);
  const top = cards.reduce((a, b) => (cmpCard(a, b, false) >= 0 ? a : b));
  return makeHandValue(1, cards.length - 1, k.rank, k.suit, [top.id]);
}

// ---------- 主入口 ----------

/** 判定一个 ≤6 张牌组能构成的最高牌型（从位次 22 向下首个命中） */
export function evaluateSubset(cards: Card[]): HandValue | null {
  if (cards.length === 0 || cards.length > 6) return null;
  const ctx = preprocess(cards);

  const checks: (null | HandValue)[] = [
    evalStraightFlush(cards, ctx, 6, 22), // 暴君
    evalFourTwo(cards, ctx), // 使徒
    evalTwoTrips(cards, ctx), // 龙王
    evalStraightFlush(cards, ctx, 5, 19), // 皇帝
    evalTripleConsecutivePairs(cards, ctx), // 正义
    evalQuads(cards, ctx, 17), // 贤者
    evalFlush(cards, ctx, 6, 16), // 灾难
    evalStraight(cards, 6, 15), // 魔导
    evalStraightFlush(cards, ctx, 4, 14), // 公爵
    evalThreePairs(cards, ctx), // 大剑
    evalFullHouse(cards, ctx), // 龙
    evalFlush(cards, ctx, 5, 11), // 海啸
    evalStraight(cards, 5, 10), // 博士
    evalStraightFlush(cards, ctx, 3, 9), // 领主
    evalTrips(cards, ctx, 8), // 骑士
    evalStraight(cards, 4, 7), // 学者
    evalFlush(cards, ctx, 4, 6), // 洪水
    evalPairs(cards, ctx, 5), // 双剑
    evalStraight(cards, 3, 4), // 术士
    evalFlush(cards, ctx, 3, 3), // 浪花
    evalPairs(cards, ctx, 2), // 单剑
  ];
  for (const hv of checks) if (hv) return hv;
  return evalHighCard(cards); // 散兵
}

/** 出战区的最终牌型：全部非空子集中比较元组最大者（≤63 个子集） */
export function bestHand(battlefield: Card[]): HandValue | null {
  const n = battlefield.length;
  if (n === 0) return null;
  let best: HandValue | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    const sub: Card[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sub.push(battlefield[i]);
    const hv = evaluateSubset(sub);
    if (hv && (!best || compareHandValue(hv, best) > 0)) best = hv;
  }
  return best;
}

/** 展示用：给定牌组在 bestHand 意义下的"组牌建议"（即 bestHand 用到的子集） */
export function bestHandCards(battlefield: Card[]): { hand: HandValue; used: Card[] } | null {
  const hand = bestHand(battlefield);
  if (!hand) return null;
  const byId = new Map(battlefield.map((c) => [c.id, c]));
  return { hand, used: hand.usedIds.map((id) => byId.get(id)!) };
}

/**
 * 出战区里"没用上"的牌数 = 杂牌数，也就是"掺水"规则真正要比的东西。
 *
 * 为什么不能直接用 bestHand().junk：bestHand 是在**子集**里挑最好的组合，
 * 而子集里每张牌都被用上了，所以它的 junk 恒为 0。结果就是
 * 「① 牌型排名 → ② 杂牌少者胜 → ③ 最大牌 → ④ 花色」里的第 ② 步永远轮不到，
 * 干净的牌型打不过"掺了杂牌但花色更大"的同一个牌型——这条规则等于失效。
 * 杂牌数必须按**整个出战区**减去实际用掉的牌来算。
 */
export function battlefieldJunk(battlefield: Card[]): number {
  const hv = bestHand(battlefield);
  if (!hv) return 0;
  return battlefield.length - hv.usedIds.length;
}

/**
 * 两个出战区之间比较大小（摊牌用）：
 * ① 牌型排名 → ② 杂牌少者胜 → ③ 牌型内最大牌 → ④ 花色。
 * 返回 > 0 表示 a 更大。
 */
export function compareBattlefields(a: Card[], b: Card[]): number {
  const ha = bestHand(a);
  const hb = bestHand(b);
  if (!ha && !hb) return 0;
  if (!ha) return -1;
  if (!hb) return 1;
  if (ha.typeRank !== hb.typeRank) return ha.typeRank - hb.typeRank;
  const ja = battlefieldJunk(a);
  const jb = battlefieldJunk(b);
  if (ja !== jb) return jb - ja;
  if (ha.keyRank !== hb.keyRank) return ha.keyRank - hb.keyRank;
  return ha.keySuit - hb.keySuit;
}
