import {
  Card,
  DEFAULT_SETTINGS,
  GameAction,
  GameEvent,
  GameState,
  Player,
  RoomSettings,
  RoundState,
  ShowdownEntry,
  ShowdownResult,
  compareHandValue,
} from './types';
import { buildDeck, rngInt, shuffle } from './deck';
import { bestHand } from './evaluator';
import { allPlayers, getPlayer, nextVoter, survivors, voters } from './seating';

// ============ 常量 ============

export const TIMING = {
  settlementMs: 5_000, // 摊牌展示（固定）
};
export const START_CHIPS = 100;
export const ANTE = 1;
export const HAND_SIZE = 6;
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;

/** 建房参数规范化（服务端与客户端共用）：越界/非法值落回默认 */
export function normalizeSettings(p: Partial<RoomSettings> = {}): RoomSettings {
  const clampMs = (v: unknown, def: number, loSec: number, hiSec: number) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return def;
    if (n === 0) return 0; // 不限时
    return Math.min(hiSec * 1000, Math.max(loSec * 1000, n * 1000));
  };
  const clampNum = (v: unknown, def: number, lo: number, hi: number) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, n));
  };
  return {
    startChips: clampNum(p.startChips, DEFAULT_SETTINGS.startChips, 10, 100_000),
    ante: clampNum(p.ante, DEFAULT_SETTINGS.ante, 1, 1000),
    defenseMs: clampMs(p.defenseMs, DEFAULT_SETTINGS.defenseMs, 5, 600),
    turnMs: clampMs(p.turnMs, DEFAULT_SETTINGS.turnMs, 10, 1200),
    idleMs: clampMs(p.idleMs, DEFAULT_SETTINGS.idleMs, 30, 3600),
    chipMultiplier: clampNum(p.chipMultiplier, DEFAULT_SETTINGS.chipMultiplier, 1, 5),
  };
}

// ============ 基础操作 ============

export function createGameState(code: string, settings?: Partial<RoomSettings>): GameState {
  return {
    code,
    phase: 'lobby',
    settings: normalizeSettings(settings),
    players: [],
    hostSeat: 0,
    round: null,
    secret: null,
    lastWinnerSeat: null,
    winnerSeat: null,
    eventSeq: 0,
    stateSeq: 0,
  };
}

export function addPlayer(s: GameState, name: string, isBot = false, avatar = 'shirley'): { ok: true; seat: number } | { ok: false; error: string } {
  if (s.phase !== 'lobby') return { ok: false, error: '对局已开始，无法加入' };
  const clean = name.trim().slice(0, 12);
  if (!clean) return { ok: false, error: '昵称不能为空' };
  const count = s.players.filter((p) => p !== null).length;
  if (count >= MAX_PLAYERS) return { ok: false, error: '房间已满（最多 6 人）' };
  // 座位号稳定：填第一个空位，不重排（重连 token 按座位号索引）
  let seat = s.players.findIndex((p) => p === null);
  if (seat === -1) seat = s.players.length;
  const player: Player = {
    seat,
    name: isBot ? `电脑${clean}` : clean,
    avatar: isBot ? 'shirley' : avatar,
    chips: s.settings.startChips,
    isHost: seat === 0,
    isBot,
    connected: !isBot,
    away: false,
    status: 'idle',
    betTotal: 0,
    invested: 0,
    battlefield: [],
    playSegments: [],
    escrow: 0,
    defensePassed: false,
    agreeEnd: false,
    lastAction: '',
  };
  s.players[seat] = player;
  if (player.isHost) s.hostSeat = seat;
  return { ok: true, seat };
}

export function removePlayer(s: GameState, seat: number): { ok: boolean; error?: string } {
  if (s.phase !== 'lobby') return { ok: false, error: '对局中无法离座' };
  const p = getPlayer(s, seat);
  if (!p) return { ok: false, error: '座位不存在' };
  s.players[seat] = null; // 置空不重排，其他座位号保持不变
  if (!s.players.some((pl) => pl?.isHost)) {
    const first = s.players.findIndex((pl) => pl !== null);
    if (first >= 0) s.players[first]!.isHost = true;
  }
  s.hostSeat = s.players.findIndex((pl) => pl?.isHost);
  return { ok: true };
}

export function startGame(s: GameState, seat: number, seed: number, now: number): { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string } {
  const p = getPlayer(s, seat);
  if (!p?.isHost) return { ok: false, error: '只有房主才能开始游戏' };
  if (s.phase !== 'lobby') return { ok: false, error: '游戏已开始' };
  if (s.players.length < MIN_PLAYERS) return { ok: false, error: `至少需要 ${MIN_PLAYERS} 名玩家` };
  s.phase = 'playing';
  for (const pl of allPlayers(s)) {
    pl.chips = s.settings.startChips;
    pl.status = 'active';
    pl.betTotal = 0;
    pl.invested = 0;
    pl.battlefield = [];
    pl.playSegments = [];
    pl.escrow = 0;
    pl.defensePassed = false;
    pl.agreeEnd = false;
    pl.lastAction = '';
  }
  s.secret = { seed, deck: buildDeck(), hands: s.players.map(() => []) };
  s.winnerSeat = null;
  s.lastWinnerSeat = null;
  const events: GameEvent[] = [];
  push(s, events, { t: 'game_started', seats: allPlayers(s).map((pl) => pl.seat) });
  newRound(s, now, events);
  return { ok: true, state: s, events };
}

export function rematch(s: GameState, seat: number): { ok: boolean; error?: string } {
  const p = getPlayer(s, seat);
  if (!p?.isHost) return { ok: false, error: '只有房主才能再来一局' };
  if (s.phase !== 'gameover') return { ok: false, error: '本局尚未结束' };
  s.phase = 'lobby';
  s.round = null;
  s.secret = null;
  s.winnerSeat = null;
  s.lastWinnerSeat = null;
  for (const pl of allPlayers(s)) {
    pl.chips = s.settings.startChips;
    pl.status = 'idle';
    pl.betTotal = 0;
    pl.invested = 0;
    pl.battlefield = [];
    pl.playSegments = [];
    pl.escrow = 0;
    pl.defensePassed = false;
    pl.agreeEnd = false;
    pl.lastAction = '';
  }
  return { ok: true };
}

// ============ 工具 ============

function push(s: GameState, events: GameEvent[], ev: GameEvent) {
  s.eventSeq++;
  events.push(ev);
}

/** 阶段截止时刻；ms=0 表示不限时 */
function deadline(now: number, ms: number): number {
  return ms > 0 ? now + ms : Number.MAX_SAFE_INTEGER;
}

/** 出牌段只有 1 张时不亮牌——单张出牌等于摊牌，没有隐藏信息 */
function segmentTop(cards: Card[]): Card | null {
  return cards.length >= 2 ? topCard(cards) : null;
}

function topCard(cards: Card[]): Card {
  let best = cards[0];
  for (const c of cards) {
    const rc = c.rank === 1 ? 14 : c.rank;
    const bc = best.rank === 1 ? 14 : best.rank;
    if (rc > bc || (rc === bc && c.suit > best.suit)) best = c;
  }
  return best;
}

function lowestFirst(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.rank - b.rank || a.suit - b.suit);
}

/** 从手牌中按 id 取出子集（保持给定顺序），不全部命中返回 null */
function takeFromHand(s: GameState, seat: number, cardIds: string[]): Card[] | null {
  const hand = s.secret!.hands[seat];
  const byId = new Map(hand.map((c) => [c.id, c]));
  const picked: Card[] = [];
  for (const id of cardIds) {
    const c = byId.get(id);
    if (!c) return null;
    picked.push(c);
    byId.delete(id);
  }
  return picked;
}

function removeFromHand(s: GameState, seat: number, cards: Card[]) {
  const hand = s.secret!.hands[seat];
  const ids = new Set(cards.map((c) => c.id));
  s.secret!.hands[seat] = hand.filter((c) => !ids.has(c.id));
}

function updateMaxBet(s: GameState) {
  const r = s.round!;
  r.maxBet = voters(s).reduce((m, p) => Math.max(m, p.betTotal), 0);
}

// ============ 回合推进 ============

function newRound(s: GameState, now: number, events: GameEvent[]) {
  const alive = survivors(s);
  const roundNo = (s.round?.roundNo ?? 0) + 1;
  // ---- 备战：所有牌回牌堆，重洗，补发 6 张 ----
  const deck = s.secret!.deck;
  for (const p of allPlayers(s)) {
    deck.push(...p.battlefield);
    p.battlefield = [];
    p.playSegments = [];
    deck.push(...s.secret!.hands[p.seat]);
    s.secret!.hands[p.seat] = [];
    p.betTotal = 0;
    p.invested = 0;
    p.escrow = 0;
    p.defensePassed = false;
    p.agreeEnd = false;
    p.lastAction = '';
    if (p.status !== 'out') p.status = 'active';
  }
  const shuffled = shuffle(deck, s.secret!.seed);
  s.secret!.seed = shuffled.seed;
  for (const p of alive) {
    s.secret!.hands[p.seat] = shuffled.arr.splice(0, HAND_SIZE);
  }
  s.secret!.deck = shuffled.arr;

  // ---- 底注 ----
  const ante = s.settings.ante;
  let pot = 0;
  for (const p of alive) {
    p.chips -= ante;
    p.invested = ante;
    pot += ante;
  }

  // ---- 宣战者 ----
  let declarer: number;
  if (s.lastWinnerSeat !== null && getPlayer(s, s.lastWinnerSeat)?.status !== 'out') {
    declarer = s.lastWinnerSeat;
  } else {
    const r = rngInt(s.secret!.seed, alive.length);
    s.secret!.seed = r.next;
    declarer = alive[r.v].seat;
  }

  const round: RoundState = {
    roundNo,
    phase: 'defense_window',
    declarerSeat: declarer,
    openerSeat: declarer,
    turnSeat: declarer,
    pot,
    maxBet: 0,
    deadlineAt: deadline(now, s.settings.defenseMs),
    lastActionAt: now,
    result: null,
  };
  s.round = round;
  push(s, events, { t: 'round_start', roundNo, declarerSeat: declarer, pot });
  push(s, events, { t: 'deal', counts: alive.map((p) => [p.seat, s.secret!.hands[p.seat].length] as [number, number]) });
}

/** 防守窗口收口：未表态者视为不防守；全员防守则作废回合 */
function closeDefenseWindow(s: GameState, now: number, events: GameEvent[]) {
  const r = s.round!;
  for (const p of voters(s)) {
    if (!p.defensePassed) {
      p.defensePassed = true;
      p.lastAction = '不防守';
      push(s, events, { t: 'defense_passed', seat: p.seat });
    }
  }
  push(s, events, { t: 'defense_window_closed' });
  if (voters(s).length === 0) {
    voidRound(s, now, events, '全员防守，无人竞夺奖池');
    return;
  }
  const declarer = getPlayer(s, r.declarerSeat)!;
  r.openerSeat = declarer.status === 'active' ? r.declarerSeat : nextVoter(s, r.declarerSeat)!;
  r.turnSeat = r.openerSeat;
  r.phase = 'opening';
  r.deadlineAt = deadline(now, s.settings.turnMs);
  r.lastActionAt = now;
}

function voidRound(s: GameState, now: number, events: GameEvent[], reason: string) {
  const r = s.round!;
  const anteRefunds: Record<string, number> = {};
  const escrowReturns: Record<string, number> = {};
  // 退还本回合所有投入（底注 + 押注）
  for (const p of allPlayers(s)) {
    if (p.invested > 0) {
      p.chips += p.invested;
      r.pot -= p.invested;
      anteRefunds[String(p.seat)] = p.invested;
      p.invested = 0;
    }
  }
  r.pot = Math.max(0, r.pot);
  for (const p of allPlayers(s)) {
    if (p.escrow > 0) {
      p.chips += p.escrow;
      escrowReturns[String(p.seat)] = p.escrow;
      p.escrow = 0;
    }
  }
  const result: ShowdownResult = {
    voidRound: true,
    entries: [],
    winnerSeat: null,
    potAmount: 0,
    escrowReturns,
    escrowForfeits: {},
    chipDeltas: {},
    anteRefunds,
    eliminated: [],
  };
  r.result = result;
  r.phase = 'settlement';
  r.deadlineAt = now + TIMING.settlementMs;
  push(s, events, { t: 'round_void', reason });
  push(s, events, { t: 'winner', seat: null, pot: 0, result });
}

/** 轮转提前结束判定：投票者 ≤1 时进入摊牌/作废 */
function checkRoundEnd(s: GameState, now: number, events: GameEvent[]): boolean {
  const v = voters(s);
  if (v.length === 0) {
    voidRound(s, now, events, '无人留在场中');
    return true;
  }
  if (v.length === 1) {
    doShowdown(s, now, events);
    return true;
  }
  return false;
}

// ============ 摊牌与结算 ============

function doShowdown(s: GameState, now: number, events: GameEvent[]) {
  const r = s.round!;
  updateMaxBet(s);

  // 有牌型可比的参赛者：未弃牌（含防守者）且出战区非空
  const contenders = allPlayers(s)
    .filter((p) => p.status === 'active' || p.status === 'defended')
    .filter((p) => p.battlefield.length >= 1);
  const entries: ShowdownEntry[] = contenders
    .map((p) => {
      const hv = bestHand(p.battlefield)!;
      return {
        seat: p.seat,
        cards: [...p.battlefield],
        usedIds: hv.usedIds,
        handName: hv.name,
        handAlias: hv.alias,
        typeRank: hv.typeRank,
        junk: hv.junk,
      };
    })
    .sort((a, b) => {
      const ha = bestHand(a.cards)!;
      const hb = bestHand(b.cards)!;
      return compareHandValue(hb, ha);
    });

  const attackers = entries.filter((e) => getPlayer(s, e.seat)!.status === 'active');
  const defenders = entries.filter((e) => getPlayer(s, e.seat)!.status === 'defended');

  // 无人能以牌型竞夺奖池 → 回合作废
  if (attackers.length === 0) {
    voidRound(s, now, events, '场上没有可比较的进攻牌型');
    return;
  }

  const fieldMax = entries[0];
  const winner = attackers[0];
  const wp = getPlayer(s, winner.seat)!;

  const escrowReturns: Record<string, number> = {};
  const escrowForfeits: Record<string, number> = {};
  const chipDeltas: Record<string, number> = {};

  // 防守结算：牌型为全场最大 → 收回托管；否则托管进奖池
  for (const d of defenders) {
    const dp = getPlayer(s, d.seat)!;
    const isFieldMax = d.seat === fieldMax.seat;
    if (isFieldMax) {
      dp.chips += dp.escrow;
      escrowReturns[String(d.seat)] = dp.escrow;
      chipDeltas[String(d.seat)] = (chipDeltas[String(d.seat)] ?? 0) + dp.escrow;
    } else {
      r.pot += dp.escrow;
      escrowForfeits[String(d.seat)] = dp.escrow;
    }
    dp.escrow = 0;
  }

  // 胜者独吞奖池
  wp.chips += r.pot;
  chipDeltas[String(wp.seat)] = (chipDeltas[String(wp.seat)] ?? 0) + r.pot;
  const potAmount = r.pot;
  r.pot = 0;

  // 淘汰与终局
  const eliminated: number[] = [];
  for (const p of allPlayers(s)) {
    if (p.status !== 'out' && p.chips <= 0) {
      p.status = 'out';
      p.lastAction = '筹码归零';
      eliminated.push(p.seat);
      push(s, events, { t: 'eliminated', seat: p.seat });
    }
  }
  s.lastWinnerSeat = wp.seat;

  const result: ShowdownResult = {
    voidRound: false,
    entries,
    winnerSeat: wp.seat,
    potAmount,
    escrowReturns,
    escrowForfeits,
    chipDeltas,
    anteRefunds: {},
    eliminated,
  };
  r.result = result;
  r.phase = 'settlement';
  r.deadlineAt = now + TIMING.settlementMs;

  push(s, events, { t: 'showdown', entries });
  push(s, events, { t: 'winner', seat: wp.seat, pot: potAmount, result });

  if (survivors(s).length <= 1) {
    s.winnerSeat = survivors(s)[0]?.seat ?? wp.seat;
    push(s, events, { t: 'game_over', winnerSeat: s.winnerSeat });
  }
}

// ============ 行为实现（内部，已校验） ============

function applyPlay(s: GameState, seat: number, cards: Card[], bet: number, now: number, events: GameEvent[]) {
  const r = s.round!;
  const p = getPlayer(s, seat)!;
  removeFromHand(s, seat, cards);
  p.battlefield = cards;
  const top = segmentTop(cards);
  p.playSegments = [{ count: cards.length, top }];
  p.betTotal = bet;
  p.chips -= bet;
  p.invested += bet;
  r.pot += bet; // 押注即入池
  p.lastAction = `出战 ${cards.length} 张 · 押 ${bet}`;
  push(s, events, { t: 'play', seat, cardCount: cards.length, bet, revealedTop: top });
  resetAgrees(s, events);
  updateMaxBet(s);
  if (r.phase === 'opening') {
    r.phase = 'rotation';
  }
  afterBettingAction(s, now, events);
}

function applyAddCards(s: GameState, seat: number, cards: Card[], betDelta: number, now: number, events: GameEvent[]) {
  const r = s.round!;
  const p = getPlayer(s, seat)!;
  removeFromHand(s, seat, cards);
  p.battlefield.push(...cards);
  const segTop = segmentTop(cards);
  p.playSegments.push({ count: cards.length, top: segTop });
  p.betTotal += betDelta;
  p.chips -= betDelta;
  p.invested += betDelta;
  r.pot += betDelta;
  p.lastAction = `加牌 ${cards.length} 张${betDelta > 0 ? ` · 加注 ${betDelta}` : ''}`;
  push(s, events, { t: 'add_cards', seat, cardCount: cards.length, betDelta, revealedTop: segTop });
  resetAgrees(s, events);
  updateMaxBet(s);
  afterBettingAction(s, now, events);
}

function applyAddChips(s: GameState, seat: number, betDelta: number, now: number, events: GameEvent[]) {
  const r = s.round!;
  const p = getPlayer(s, seat)!;
  p.betTotal += betDelta;
  p.chips -= betDelta;
  p.invested += betDelta;
  r.pot += betDelta;
  p.lastAction = `加注 ${betDelta}`;
  push(s, events, { t: 'add_chips', seat, betDelta, betTotal: p.betTotal });
  resetAgrees(s, events);
  updateMaxBet(s);
  afterBettingAction(s, now, events);
}

function afterBettingAction(s: GameState, now: number, events: GameEvent[]) {
  const r = s.round!;
  r.lastActionAt = now;
  if (checkRoundEnd(s, now, events)) return;
  r.turnSeat = nextVoter(s, r.turnSeat)!;
  r.deadlineAt = deadline(now, s.settings.turnMs);
}

function resetAgrees(s: GameState, events: GameEvent[]) {
  let any = false;
  for (const p of allPlayers(s)) {
    if (p.agreeEnd) {
      p.agreeEnd = false;
      any = true;
    }
  }
  if (any) push(s, events, { t: 'agree_reset' });
}

function applyFold(s: GameState, seat: number, now: number, events: GameEvent[]) {
  const r = s.round!;
  const p = getPlayer(s, seat)!;
  // 已押筹码早已随押注入池；弃牌即放弃，出战区牌作废（回合结束统一回牌堆）
  p.status = 'folded';
  p.lastAction = '弃牌';
  push(s, events, { t: 'fold', seat });
  r.lastActionAt = now;
  updateMaxBet(s);
  if (checkRoundEnd(s, now, events)) return;
  r.turnSeat = nextVoter(s, r.turnSeat)!;
  r.deadlineAt = deadline(now, s.settings.turnMs);
}

function applyAgree(s: GameState, seat: number, agree: boolean, now: number, events: GameEvent[]) {
  const r = s.round!;
  const p = getPlayer(s, seat)!;
  p.agreeEnd = agree;
  p.lastAction = agree ? '同意结束' : '不同意';
  push(s, events, { t: 'agree', seat, agree });
  r.lastActionAt = now;
  const vs = voters(s);
  if (vs.length >= 2 && vs.every((v) => v.agreeEnd)) {
    doShowdown(s, now, events);
    return;
  }
  r.turnSeat = nextVoter(s, r.turnSeat)!;
  r.deadlineAt = deadline(now, s.settings.turnMs);
}

// ============ 对外动作入口 ============

export function applyAction(s0: GameState, seat: number, action: GameAction, now: number): { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string } {
  const s = structuredClone(s0);
  const events: GameEvent[] = [];
  const err = (error: string) => ({ ok: false as const, error });

  if (s.phase !== 'playing' || !s.round || !s.secret) return err('当前不在对局中');
  const p = getPlayer(s, seat);
  const r = s.round;
  if (!p || p.status === 'out') return err('你已出局');

  switch (action.t) {
    case 'declare_defense': {
      if (r.phase !== 'defense_window') return err('现在不是防守声明阶段');
      if (p.status !== 'active') return err('你已表态过本回合');
      if (p.defensePassed) return err('你已选择不防守');
      const cards = takeFromHand(s, seat, action.cardIds);
      if (!cards || cards.length === 0) return err('防守须至少打出一张手牌');
      const escrow = Math.floor(action.escrow);
      if (!Number.isFinite(escrow) || escrow < cards.length) return err('托管筹码不能少于防守牌数');
      if (escrow > p.chips) return err('托管筹码超过你的筹码');
      removeFromHand(s, seat, cards);
      p.status = 'defended';
      p.escrow = escrow;
      p.chips -= escrow;
      p.battlefield = cards;
      const defTop = segmentTop(cards);
      p.playSegments = [{ count: cards.length, top: defTop }];
      p.lastAction = `防守 ${cards.length} 张 · 托管 ${escrow}`;
      push(s, events, { t: 'defense_declared', seat, cardCount: cards.length, escrow, revealedTop: defTop });
      if (voters(s).every((v) => v.defensePassed)) closeDefenseWindow(s, now, events);
      break;
    }
    case 'pass_defense': {
      if (r.phase !== 'defense_window') return err('现在不是防守声明阶段');
      if (p.status !== 'active' || p.defensePassed) return err('你已表态过本回合');
      p.defensePassed = true;
      p.lastAction = '不防守';
      push(s, events, { t: 'defense_passed', seat });
      if (voters(s).every((v) => v.defensePassed)) closeDefenseWindow(s, now, events);
      break;
    }
    case 'force_close_defense': {
      if (r.phase !== 'defense_window') return err('现在不是防守声明阶段');
      if (seat !== r.declarerSeat) return err('只有宣战者能提前开始');
      closeDefenseWindow(s, now, events);
      break;
    }
    case 'play': {
      if (r.phase !== 'opening' && r.phase !== 'rotation') return err('现在不能出牌');
      if (r.turnSeat !== seat) return err('还没轮到你');
      if (p.status !== 'active') return err('你不能出牌');
      if (p.battlefield.length > 0) return err('你的出战区已有牌，请选择加牌');
      const cards = takeFromHand(s, seat, action.cardIds);
      if (!cards || cards.length === 0) return err('请至少选择一张手牌');
      const bet = Math.floor(action.bet);
      if (!Number.isFinite(bet) || bet < 0) return err('押注不合法');
      if (bet < r.maxBet) return err(`押注须 ≥ 场上最大押注 ${r.maxBet}`);
      if (bet > cards.length * s.settings.chipMultiplier) return err(`押注不能超过出牌数 × 筹码倍数（${cards.length}×${s.settings.chipMultiplier}）`);
      if (bet > p.chips) return err('筹码不足');
      applyPlay(s, seat, cards, bet, now, events);
      break;
    }
    case 'add_cards': {
      if (r.phase !== 'rotation') return err('现在不能加牌');
      if (r.turnSeat !== seat) return err('还没轮到你');
      if (p.status !== 'active') return err('你不能操作');
      if (p.battlefield.length === 0) return err('你的出战区为空，请先出牌');
      const cards = takeFromHand(s, seat, action.cardIds);
      if (!cards || cards.length === 0) return err('请至少选择一张手牌');
      const delta = Math.floor(action.betDelta);
      if (!Number.isFinite(delta) || delta < 0) return err('加注不合法');
      const newBet = p.betTotal + delta;
      if (newBet > (p.battlefield.length + cards.length) * s.settings.chipMultiplier) return err('押注超过出战区牌数上限');
      if (newBet < r.maxBet) return err(`押注须 ≥ 场上最大押注 ${r.maxBet}`);
      if (delta > p.chips) return err('筹码不足');
      applyAddCards(s, seat, cards, delta, now, events);
      break;
    }
    case 'add_chips': {
      if (r.phase !== 'rotation') return err('现在不能加注');
      if (r.turnSeat !== seat) return err('还没轮到你');
      if (p.status !== 'active') return err('你不能操作');
      if (p.battlefield.length === 0) return err('你的出战区为空');
      const delta = Math.floor(action.betDelta);
      if (!Number.isFinite(delta) || delta < 0) return err('加注不合法');
      const newBet = p.betTotal + delta;
      if (newBet > p.battlefield.length * s.settings.chipMultiplier) return err('押注不能超过出战区牌数上限');
      if (newBet < r.maxBet) return err(`押注须 ≥ 场上最大押注 ${r.maxBet}，不能免费过牌`);
      if (delta > p.chips) return err('筹码不足');
      applyAddChips(s, seat, delta, now, events);
      break;
    }
    case 'fold': {
      if (r.phase !== 'rotation') return err('现在不能弃牌');
      if (r.turnSeat !== seat) return err('还没轮到你');
      if (p.status !== 'active') return err('你不能操作');
      applyFold(s, seat, now, events);
      break;
    }
    case 'agree_end': {
      if (r.phase !== 'rotation') return err('现在不能表态');
      if (r.turnSeat !== seat) return err('还没轮到你');
      if (p.status !== 'active') return err('你不能操作');
      if (p.battlefield.length === 0) return err('你还未出牌，不能表态');
      if (p.betTotal < r.maxBet) return err('押注未达场上最大押注，不能表态');
      applyAgree(s, seat, action.agree, now, events);
      break;
    }
  }
  s.stateSeq++;
  return { ok: true, state: s, events };
}

// ============ 超时 tick（纯函数，虚拟时钟可测） ============

export function tick(s0: GameState, now: number): { state: GameState; events: GameEvent[] } {
  const s = structuredClone(s0);
  const events: GameEvent[] = [];
  for (let guard = 0; guard < 16; guard++) {
    if (s.phase !== 'playing' || !s.round || !s.secret) break;
    const r = s.round;
    if (r.phase === 'settlement') {
      if (now < r.deadlineAt) break;
      if (s.winnerSeat !== null) {
        s.phase = 'gameover';
        break;
      }
      newRound(s, now, events);
      continue;
    }
    if (now < r.deadlineAt) {
      if (r.phase === 'rotation' && s.settings.idleMs > 0 && now - r.lastActionAt >= s.settings.idleMs) {
        // 全桌无动作兜底：全体视为同意，进入摊牌
        for (const v of voters(s)) v.agreeEnd = true;
        doShowdown(s, now, events);
        continue;
      }
      break;
    }
    if (r.phase === 'defense_window') {
      closeDefenseWindow(s, now, events);
      continue;
    }
    if (r.phase === 'opening') {
      autoMinimalPlay(s, now, events);
      continue;
    }
    if (r.phase === 'rotation') {
      autoAct(s, now, events);
      continue;
    }
  }
  s.stateSeq++;
  return { state: s, events };
}

/** 开局超时：自动最小开局（出最小的牌、押场上最大押注） */
function autoMinimalPlay(s: GameState, now: number, events: GameEvent[]) {
  const r = s.round!;
  const seat = r.turnSeat;
  const hand = s.secret!.hands[seat];
  const sorted = lowestFirst(hand);
  for (let n = 1; n <= sorted.length; n++) {
    if (Math.min(n * s.settings.chipMultiplier, getPlayer(s, seat)!.chips) >= r.maxBet) {
      applyPlay(s, seat, sorted.slice(0, n), r.maxBet, now, events);
      return;
    }
  }
  // 凑不出最小开局：过牌式开局（押 0，出 1 张）都不行则只能出 1 张押 0
  applyPlay(s, seat, sorted.slice(0, 1), Math.min(r.maxBet, 0), now, events);
}

/** 轮转超时自动动作：同意 → 补筹码 → 加牌补齐 → 弃牌 */
function autoAct(s: GameState, now: number, events: GameEvent[]) {
  const r = s.round!;
  const seat = r.turnSeat;
  const p = getPlayer(s, seat)!;
  const hand = s.secret!.hands[seat];

  if (p.battlefield.length >= 1 && p.betTotal >= r.maxBet) {
    applyAgree(s, seat, true, now, events);
    return;
  }
  if (p.battlefield.length === 0) {
    const sorted = lowestFirst(hand);
    for (let n = 1; n <= sorted.length; n++) {
      if (Math.min(n * s.settings.chipMultiplier, p.chips) >= r.maxBet) {
        applyPlay(s, seat, sorted.slice(0, n), r.maxBet, now, events);
        return;
      }
    }
    applyFold(s, seat, now, events);
    return;
  }
  // 已有出战区但押注不足
  const need = r.maxBet - p.betTotal;
  if (p.chips >= need && p.betTotal + need <= p.battlefield.length * s.settings.chipMultiplier) {
    applyAddChips(s, seat, need, now, events);
    return;
  }
  const sorted = lowestFirst(hand);
  for (let n = 1; n <= sorted.length; n++) {
    const newBet = p.betTotal + Math.min(p.chips, (p.battlefield.length + n) * s.settings.chipMultiplier - p.betTotal);
    if (newBet >= r.maxBet && p.chips >= need) {
      applyAddCards(s, seat, sorted.slice(0, n), need, now, events);
      return;
    }
  }
  applyFold(s, seat, now, events);
}
