import { describe, expect, it } from 'vitest';
import {
  Card,
  bestHand,
  normalizeSettings,
  tick,
  GameAction,
  GameState,
  HAND_SIZE,
  addPlayer,
  applyAction,
  createGameState,
  startGame,
} from '../index';

const T0 = 1_000_000;
const START = 100;

/**
 * 结算（胜负判定 + 筹码分配）的行为规范。
 *
 * 牌桌上的钱来自三处：底注（回合开始扣）、押注（出牌/加注扣）、防守托管（声明时扣）。
 * 这里逐条钉住：谁赢奖池、托管的去向、奖池里到底装了谁的钱、每个人的净变化。
 */

function newGame(n = 2, seed = 7): GameState {
  const s0 = createGameState('SET1', { startChips: START, ante: 1, chipMultiplier: 1 });
  for (let i = 0; i < n; i++) addPlayer(s0, `P${i}`);
  const g = startGame(s0, 0, seed, T0);
  if (!g.ok) throw new Error(g.error);
  return g.state;
}

function act(s: GameState, seat: number, action: GameAction, now = T0 + 1000): GameState {
  const r = applyAction(s, seat, action, now);
  if (!r.ok) throw new Error(`seat${seat} ${action.t}: ${r.error}`);
  return r.state;
}

/** 测试白盒：把指定座位的手牌换成指定牌，其余随机补足，保持 52 张完整 */
function setHands(s: GameState, spec: Record<number, string[]>) {
  const all: Card[] = [...s.secret!.deck];
  for (const p of s.players) if (p) all.push(...s.secret!.hands[p.seat]);
  const used = new Set<string>();
  const picked: Record<number, Card[]> = {};
  for (const [seatStr, ids] of Object.entries(spec)) {
    const cards: Card[] = [];
    for (const id of ids) {
      if (used.has(id)) throw new Error(`dup ${id}`);
      const i = all.findIndex((c) => c.id === id);
      if (i < 0) throw new Error(`no card ${id}`);
      used.add(id);
      cards.push(all.splice(i, 1)[0]);
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

/** 所有能表态的人都选择不防守，进入宣战；返回新状态与开出第一手牌的座位 */
function toOpening(s: GameState): { s: GameState; opener: number } {
  const seats = s.players.filter((p) => p !== null).map((p) => p!.seat);
  let st = s;
  for (const seat of seats) {
    const p = st.players[seat]!;
    if (p.status === 'active' && !p.defensePassed) st = act(st, seat, { t: 'pass_defense' });
  }
  if (st.round!.phase !== 'opening') throw new Error(`期望进入宣战，实际是 ${st.round!.phase}`);
  return { s: st, opener: st.round!.turnSeat };
}

function held(s: GameState): number {
  return s.players.reduce((n, p) => n + (p ? p.chips + p.escrow : 0), 0) + (s.round?.pot ?? 0);
}

describe('结算：进攻方赢走奖池', () => {
  it('另一方弃牌，胜者拿到的奖池 = 双方底注 + 双方押注；净变化只算别人的投入', () => {
    const g = toOpening(newGame(2));
    let s = g.s;
    const opener = g.opener;
    const other = s.players.find((p) => p && p.seat !== opener)!.seat;

    s = act(s, opener, { t: 'play', cardIds: s.secret!.hands[opener].slice(0, 6).map((c) => c.id), bet: 6 });
    s = act(s, other, { t: 'fold' });

    const r = s.round!.result!;
    expect(r.voidRound).toBe(false);
    expect(r.winnerSeat).toBe(opener);
    // 奖池 = 底注 1×2 + 胜者押 6 = 8（弃牌者没有押注）
    expect(r.potAmount).toBe(8);

    const w = s.players[opener]!;
    const f = s.players[other]!;
    expect(w.chips).toBe(START - 1 - 6 + 8);
    expect(f.chips).toBe(START - 1);

    // 净变化才是玩家真正"赚/亏"的数：胜者 +1（对手只丢了底注），败者 −1
    expect(r.chipDeltas[String(opener)]).toBe(1);
    expect(r.chipDeltas[String(other)]).toBe(-1);

    // 净变化之和必须为 0，且筹码总量守恒
    const sum = Object.values(r.chipDeltas).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
    expect(held(s)).toBe(START * 2);
  });

  it('净变化与播报的奖金不同：奖池里含胜者自己的投入', () => {
    const g = toOpening(newGame(2));
    let s = g.s;
    const opener = g.opener;
    const other = s.players.find((p) => p && p.seat !== opener)!.seat;
    s = act(s, opener, { t: 'play', cardIds: s.secret!.hands[opener].slice(0, 3).map((c) => c.id), bet: 3 });
    s = act(s, other, {
      t: 'play',
      cardIds: s.secret!.hands[other].slice(0, 3).map((c) => c.id),
      bet: 3,
    });
    s = act(s, opener, { t: 'agree_end', agree: true });
    s = act(s, other, { t: 'agree_end', agree: true });

    const r = s.round!.result!;
    expect(r.potAmount).toBe(8); // 1+1 底注 + 3+3 押注
    const winner = r.winnerSeat!;
    const loser = s.players.find((p) => p && p.seat !== winner)!.seat;
    // 赢家净 +4（正好等于对手的底注 1 + 押注 3），输家净 −4
    expect(r.chipDeltas[String(winner)]).toBe(4);
    expect(r.chipDeltas[String(loser)]).toBe(-4);
    expect(r.potAmount).toBeGreaterThan(r.chipDeltas[String(winner)]);
    expect(held(s)).toBe(START * 2);
  });
});

describe('结算：防守者的托管去向', () => {
  it('防守牌型为全场最大 → 只收回托管，奖池仍归进攻方，且奖池里不含他的托管', () => {
    let s = newGame(2);
    const d = s.round!.declarerSeat;
    const o = s.players.find((p) => p && p.seat !== d)!.seat;
    setHands(s, { [d]: ['♠A', '♦A'], [o]: ['♣2', '♣3'] });

    s = act(s, d, { t: 'declare_defense', cardIds: ['♠A', '♦A'] }); // 2 张 = 总投入 2（含底注），托管 1
    s = act(s, o, { t: 'pass_defense' });
    s = act(s, o, { t: 'play', cardIds: ['♣2', '♣3'], bet: 2 });

    const r = s.round!.result!;
    expect(r.winnerSeat).toBe(o); // 奖池只归非防守者
    expect(r.escrowReturns[String(d)]).toBe(1); // 全场最大 → 收回托管（2 − 底注 1）
    expect(r.escrowForfeits[String(d)]).toBeUndefined();
    // 奖池 = 底注 1×2 + 进攻方押 2；防守方的托管不在里面
    expect(r.potAmount).toBe(4);

    expect(s.players[d]!.chips).toBe(START - 2 + 1); // 总投入 2（底注 1 + 托管 1），收回托管 1
    expect(s.players[o]!.chips).toBe(START - 1 - 2 + 4);
    expect(r.chipDeltas[String(d)]).toBe(-1);
    expect(r.chipDeltas[String(o)]).toBe(1);
    expect(held(s)).toBe(START * 2);
  });

  it('防守牌型弱于全场最大 → 托管罚没进奖池，被进攻方一并赢走', () => {
    let s = newGame(2);
    const d = s.round!.declarerSeat;
    const o = s.players.find((p) => p && p.seat !== d)!.seat;
    setHands(s, { [d]: ['♣2', '♣3'], [o]: ['♠A', '♦A'] });

    s = act(s, d, { t: 'declare_defense', cardIds: ['♣2', '♣3'] }); // 托管 1（2 − 底注）
    s = act(s, o, { t: 'pass_defense' });
    s = act(s, o, { t: 'play', cardIds: ['♠A', '♦A'], bet: 2 });

    const r = s.round!.result!;
    expect(r.winnerSeat).toBe(o);
    expect(r.escrowReturns[String(d)]).toBeUndefined();
    expect(r.escrowForfeits[String(d)]).toBe(1);
    // 奖池 = 底注 2 + 进攻方押 2 + 罚没的托管 1
    expect(r.potAmount).toBe(5);
    expect(s.players[d]!.chips).toBe(START - 2); // 总投入 2 全部损失
    expect(r.chipDeltas[String(d)]).toBe(-2);
    expect(r.chipDeltas[String(o)]).toBe(2);
    expect(held(s)).toBe(START * 2);
  });
});

describe('结算：胜负判定的判据', () => {
  /** 两方都不防守，各自打出指定牌，然后双方同意摊牌 */
  function showdownWith(handA: string[], handB: string[]) {
    const g = toOpening(newGame(2));
    let s = g.s;
    const a = g.opener; // a 是开出牌的一方
    const b = s.players.find((p) => p && p.seat !== a)!.seat;
    setHands(s, { [a]: handA, [b]: handB });
    // 押注上限 = 出牌数 × 倍数，且后手不能低于场上最大押注 → 两边押一样多
    const betA = Math.min(handA.length, handB.length);
    const betB = betA;
    s = act(s, a, { t: 'play', cardIds: handA, bet: betA });
    s = act(s, b, { t: 'play', cardIds: handB, bet: betB });
    s = act(s, a, { t: 'agree_end', agree: true });
    s = act(s, b, { t: 'agree_end', agree: true });
    return { s, a, b, r: s.round!.result! };
  }

  it('掺水规则：同一牌型下杂牌少的赢，哪怕对方的牌点更大', () => {
    // A 是干净的一对 9（两张），B 是一对 9 外加一张 A（A 属于没用上的杂牌）
    // 只看牌点/花色的话 B 的花色更大，但按"② 杂牌少者胜"该 A 赢
    const { a, b, r } = showdownWith(['♥9', '♣9'], ['♠9', '♦9', '♠A']);
    const ea = r.entries.find((e) => e.seat === a)!;
    const eb = r.entries.find((e) => e.seat === b)!;
    expect(ea.typeRank).toBe(eb.typeRank);
    expect(ea.junk).toBe(0);
    expect(eb.junk).toBe(1);
    expect(r.winnerSeat).toBe(a);
  });

  it('杂牌数按整个出战区算：六张里凑四同花，剩两张就是两张杂牌', () => {
    const { a, b, r } = showdownWith(['♠A', '♠K', '♠Q', '♠J', '♥2', '♦3'], ['♥A', '♥K', '♥Q', '♥J']);
    const ea = r.entries.find((e) => e.seat === a)!;
    const eb = r.entries.find((e) => e.seat === b)!;
    // 两边都是"四同花顺"，牌点相同、花色 ♠ 更大，但 A 掺了 2 张杂牌
    expect(ea.typeRank).toBe(eb.typeRank);
    expect(ea.junk).toBe(2);
    expect(eb.junk).toBe(0);
    expect(r.winnerSeat).toBe(b);
  });

  it('牌型大的赢（一对 胜过 高牌）', () => {
    const { a, b, r } = showdownWith(['♠K', '♦K'], ['♠A']);
    expect(r.winnerSeat).toBe(a);
    const ea = r.entries.find((e) => e.seat === a)!;
    const eb = r.entries.find((e) => e.seat === b)!;
    expect(ea.typeRank).toBeGreaterThan(eb.typeRank);
  });

  it('牌型相同时杂牌少的赢（干净一对 胜过 掺了一张的一对）', () => {
    const { a, b, r } = showdownWith(['♠K', '♦K'], ['♠9', '♦9', '♣2']);
    const ea = r.entries.find((e) => e.seat === a)!;
    const eb = r.entries.find((e) => e.seat === b)!;
    expect(ea.typeRank).toBe(eb.typeRank); // 都是"单剑·一对"
    expect(ea.junk).toBe(0);
    expect(eb.junk).toBe(1);
    expect(r.winnerSeat).toBe(a);
  });

  it('牌型与杂牌都相同时比最大牌（对 K 胜过 对 9）', () => {
    const { a, b, r } = showdownWith(['♠K', '♦K'], ['♥9', '♣9']);
    const ea = r.entries.find((e) => e.seat === a)!;
    const eb = r.entries.find((e) => e.seat === b)!;
    expect(ea.typeRank).toBe(eb.typeRank);
    expect(ea.junk).toBe(eb.junk);
    expect(bestHand(ea.cards)!.keyRank).toBeGreaterThan(bestHand(eb.cards)!.keyRank);
    expect(r.winnerSeat).toBe(a);
  });

  it('牌型、杂牌、最大牌全相同时比花色（黑桃 > 梅花 > 红桃 > 方片）', () => {
    const { a, b, r } = showdownWith(['♠K', '♥K'], ['♣K', '♦K']);
    const ea = r.entries.find((e) => e.seat === a)!;
    const eb = r.entries.find((e) => e.seat === b)!;
    expect(ea.typeRank).toBe(eb.typeRank);
    expect(ea.junk).toBe(eb.junk);
    const ha = bestHand(ea.cards)!;
    const hb = bestHand(eb.cards)!;
    expect(ha.keyRank).toBe(hb.keyRank);
    expect(ha.keySuit).toBeGreaterThan(hb.keySuit); // ♠(3) > ♣(2)
    expect(r.winnerSeat).toBe(a);
  });

  it('摊牌结果按牌型从大到小排序，且胜者一定是非防守者', () => {
    const { a, r } = showdownWith(['♠K', '♦K', '♥K'], ['♠7']);
    expect(r.entries[0].seat).toBe(a);
    for (let i = 1; i < r.entries.length; i++) {
      const prev = r.entries[i - 1];
      const cur = r.entries[i];
      expect(prev.typeRank >= cur.typeRank).toBe(true);
    }
  });
});

describe('结算：回合作废', () => {
  it('全员防守 → 无人竞夺，注金与托管全额退还，人人净变化为 0', () => {
    let s = newGame(2);
    const d = s.round!.declarerSeat;
    const o = s.players.find((p) => p && p.seat !== d)!.seat;
    s = act(s, d, { t: 'declare_defense', cardIds: s.secret!.hands[d].slice(0, 2).map((c) => c.id) });
    s = act(s, o, { t: 'declare_defense', cardIds: s.secret!.hands[o].slice(0, 2).map((c) => c.id) });

    const r = s.round!.result!;
    expect(r.voidRound).toBe(true);
    expect(r.winnerSeat).toBeNull();
    expect(r.anteRefunds[String(d)]).toBe(1);
    expect(r.escrowReturns[String(d)]).toBe(1); // 2 张 − 底注 1
    expect(r.escrowReturns[String(o)]).toBe(1);
    expect(s.players[d]!.chips).toBe(START);
    expect(s.players[o]!.chips).toBe(START);
    expect(r.chipDeltas[String(d)]).toBe(0);
    expect(r.chipDeltas[String(o)]).toBe(0);
    expect(held(s)).toBe(START * 2);
  });

  it('其余人全部弃牌 → 开牌者独得奖池，弃牌者只损失底注', () => {
    // 3 人局：开牌者出牌后另外两人弃牌 → 场上只剩一个进攻方，他直接收池
    const g = toOpening(newGame(3));
    let s = g.s;
    const opener = g.opener;
    const others = s.players.filter((p) => p && p.seat !== opener).map((p) => p!.seat);
    s = act(s, opener, { t: 'play', cardIds: s.secret!.hands[opener].slice(0, 2).map((c) => c.id), bet: 2 });
    // 弃牌要按轮转顺序来，不能按座位号顺序
    while (s.round!.phase === 'rotation') s = act(s, s.round!.turnSeat, { t: 'fold' });

    const r = s.round!.result!;
    expect(r.voidRound).toBe(false);
    expect(r.winnerSeat).toBe(opener);
    // 奖池 = 3 份底注 + 进攻方押 2
    expect(r.potAmount).toBe(5);
    expect(r.chipDeltas[String(opener)]).toBe(2); // 赢走另外两人的底注
    for (const seat of others) expect(r.chipDeltas[String(seat)]).toBe(-1);
    expect(Object.values(r.chipDeltas).reduce((a, b) => a + b, 0)).toBe(0);
    expect(held(s)).toBe(START * 3);
  });
});

describe('结算：淘汰', () => {
  it('筹码归零即出局，且被记录进结果与人名单', () => {
    const g = toOpening(newGame(2));
    let s = g.s;
    const opener = g.opener;
    const other = s.players.find((p) => p && p.seat !== opener)!.seat;
    // 把败者掏到只剩 3 个筹码（挪给对手，保持筹码总量不变）
    s.players[opener]!.chips += s.players[other]!.chips - 3;
    s.players[other]!.chips = 3;
    s = act(s, opener, { t: 'play', cardIds: s.secret!.hands[opener].slice(0, 2).map((c) => c.id), bet: 2 });
    s = act(s, other, { t: 'play', cardIds: s.secret!.hands[other].slice(0, 3).map((c) => c.id), bet: 2 });
    s = act(s, opener, { t: 'agree_end', agree: true });
    s = act(s, other, { t: 'agree_end', agree: true });

    const r = s.round!.result!;
    const loser = s.players.find((p) => p && p.seat !== r.winnerSeat)!;
    if (loser.chips <= 0) {
      expect(r.eliminated).toContain(loser.seat);
      expect(loser.status).toBe('out');
    }
    expect(held(s)).toBe(START * 2);
  });
});

describe('房间参数：摊牌展示时长', () => {
  it('按自定义的 settlementMs 决定什么时候开下一回合', () => {
    const s0 = createGameState('SMT1', { startChips: START, ante: 1, settlementMs: 1_000 });
    addPlayer(s0, 'P0');
    addPlayer(s0, 'P1');
    const g = startGame(s0, 0, 7, T0);
    if (!g.ok) throw new Error(g.error);

    let s = g.state;
    const seats = s.players.filter((p) => p !== null).map((p) => p!.seat);
    for (const seat of seats) {
      const p = s.players[seat]!;
      if (p.status === 'active' && !p.defensePassed) s = act(s, seat, { t: 'pass_defense' });
    }
    const opener = s.round!.turnSeat;
    const other = seats.find((x) => x !== opener)!;
    s = act(s, opener, { t: 'play', cardIds: s.secret!.hands[opener].slice(0, 2).map((c) => c.id), bet: 1 });
    s = act(s, other, { t: 'fold' });

    expect(s.round!.phase).toBe('settlement');
    const at = s.round!.deadlineAt;
    expect(at).toBe(T0 + 1000 + 1_000);

    // 还没到点：仍停在结算
    expect(tick(s, at - 1).state.round!.phase).toBe('settlement');
    // 到点：进入下一回合
    const next = tick(s, at + 1).state;
    expect(next.round!.roundNo).toBe(2);
    expect(next.round!.phase).toBe('defense_window');
  });
});

describe('赛制：底注递增与回合上限', () => {
  function newCfg(settings: Record<string, number>): GameState {
    const s0 = createGameState('CFG2', { startChips: 40, ante: 1, ...settings });
    addPlayer(s0, 'P0');
    addPlayer(s0, 'P1');
    const g = startGame(s0, 0, 7, T0);
    if (!g.ok) throw new Error(g.error);
    return g.state;
  }

  it('底注按间隔递增，并记录在本回合状态里', () => {
    let s = newCfg({ anteRamp: 3 });
    expect(s.round!.ante).toBe(1);
    // 每 3 回合 +1：第 1~3 回合底注 1，第 4~6 回合底注 2……
    const expectAnte = (roundNo: number) => 1 + Math.floor((roundNo - 1) / 3);
    let round = 1;
    while (round < 10 && s.phase === 'playing') {
      // 每回合：双方不防守 → 开牌者出牌 → 另一方弃牌 → 结算 → 下一回合
      const seats = s.players.filter((p) => p !== null).map((p) => p!.seat);
      for (const seat of seats) {
        const p = s.players[seat]!;
        if (p.status === 'active' && !p.defensePassed) s = act(s, seat, { t: 'pass_defense' });
      }
      const opener = s.round!.turnSeat;
      const other = seats.find((x) => x !== opener)!;
      s = act(s, opener, { t: 'play', cardIds: s.secret!.hands[opener].slice(0, 1).map((c) => c.id), bet: 1 });
      if (s.round!.phase === 'rotation') s = act(s, other, { t: 'fold' });
      s = tick(s, s.round!.deadlineAt + 1).state; // 结算结束 → 下一回合
      if (s.phase !== 'playing') break;
      round = s.round!.roundNo;
      expect(s.round!.ante, `第 ${round} 回合底注`).toBe(expectAnte(round));
    }
    expect(round).toBeGreaterThan(3); // 确实推进了几个回合
  });

  it('anteRamp = 0 时底注恒定', () => {
    let s = newCfg({ anteRamp: 0 });
    const seats = s.players.filter((p) => p !== null).map((p) => p!.seat);
    for (const seat of seats) {
      const p = s.players[seat]!;
      if (p.status === 'active' && !p.defensePassed) s = act(s, seat, { t: 'pass_defense' });
    }
    const opener = s.round!.turnSeat;
    const other = seats.find((x) => x !== opener)!;
    s = act(s, opener, { t: 'play', cardIds: s.secret!.hands[opener].slice(0, 1).map((c) => c.id), bet: 1 });
    s = act(s, other, { t: 'fold' });
    s = tick(s, s.round!.deadlineAt + 1).state;
    expect(s.round!.ante).toBe(1);
  });

  /** 打完一整回合：全员不防守 → 开牌者出 1 张押 1 → 其余人弃牌 → 结算推进 */
  function playOneRound(s0: GameState): GameState {
    let s = s0;
    if (s.phase !== 'playing' || !s.round) return s;
    const seats = s.players.filter((p) => p !== null).map((p) => p!.seat);
    for (const seat of seats) {
      if (s.phase !== 'playing' || s.round!.phase !== 'defense_window') break;
      const p = s.players[seat]!;
      if (p.status === 'active' && !p.defensePassed) s = act(s, seat, { t: 'pass_defense' });
    }
    const phaseOf = (st: GameState) => (st.phase === 'playing' ? st.round?.phase : undefined);
    if (phaseOf(s) === 'opening') {
      const opener = s.round!.turnSeat;
      s = act(s, opener, { t: 'play', cardIds: s.secret!.hands[opener].slice(0, 1).map((c) => c.id), bet: 1 });
      let guard = 0;
      while (phaseOf(s) === 'rotation' && guard++ < 8) s = act(s, s.round!.turnSeat, { t: 'fold' });
    }
    if (phaseOf(s) === 'settlement') s = tick(s, s.round!.deadlineAt + 1).state;
    return s;
  }

  it('到了回合上限就以筹码最多者结束对局', () => {
    let s = newCfg({ maxRounds: 2, anteRamp: 0 });
    for (let i = 0; i < 8 && s.phase === 'playing'; i++) s = playOneRound(s);
    expect(s.phase).toBe('gameover');
    // 打满 maxRounds 个回合后由筹码最多者判胜；round 对象停在最后一个已打完的回合
    expect(s.round!.roundNo).toBe(2);
    const leader = s.players.filter((p) => p !== null).reduce((a, b) => (b!.chips > a!.chips ? b : a))!;
    expect(s.winnerSeat).toBe(leader.seat);
  });

  it('回合上限为 0 时不触发（交回淘汰制）', () => {
    const s = newCfg({ maxRounds: 0 });
    expect(s.round!.roundNo).toBe(1);
    expect(normalizeSettings({ maxRounds: 0 }).maxRounds).toBe(0);
    expect(normalizeSettings({ anteRamp: 0 }).anteRamp).toBe(0);
  });
});

describe('协议层：空动作被拒绝', () => {
  /** 让双方都出过牌，这样"加注/加牌"才有合法的前置条件（出战区非空、轮到自己） */
  function bothPlayed() {
    const g = toOpening(newGame(2));
    let s = g.s;
    const opener = g.opener;
    const other = s.players.find((p) => p && p.seat !== opener)!.seat;
    s = act(s, opener, { t: 'play', cardIds: s.secret!.hands[opener].slice(0, 1).map((c) => c.id), bet: 1 });
    s = act(s, other, { t: 'play', cardIds: s.secret!.hands[other].slice(0, 1).map((c) => c.id), bet: 1 });
    return { s, opener, other };
  }

  it('加注 0 会被引擎拒绝（它什么也不改变，却会清空全桌的同意）', () => {
    const { s, opener } = bothPlayed();
    expect(s.round!.turnSeat).toBe(opener);
    const r = applyAction(s, opener, { t: 'add_chips', betDelta: 0 }, T0 + 2000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('至少 1');
  });

  it('加牌时不补筹码（betDelta 0）是合法的——那是抬高押注上限，不是空动作', () => {
    const { s, opener } = bothPlayed();
    const r = applyAction(s, opener, { t: 'add_cards', cardIds: s.secret!.hands[opener].slice(0, 1).map((c) => c.id), betDelta: 0 }, T0 + 2000);
    expect(r.ok).toBe(true);
  });
});
