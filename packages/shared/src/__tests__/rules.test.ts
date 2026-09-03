import { describe, expect, it } from 'vitest';
import { Card, GameAction, GameState, ANTE, HAND_SIZE, START_CHIPS, TIMING, addPlayer, applyAction, createGameState, rematch, startGame, tick } from '../index';

const T0 = 1_000_000;

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

    s = act(s, d, { t: 'declare_defense', cardIds: ['♠A', '♠K', '♠Q', '♠J', '♠10'], escrow: 5 });
    expect(seatOf(s, d).status).toBe('defended');
    expect(seatOf(s, d).chips).toBe(START_CHIPS - ANTE - 5);
    expect(seatOf(s, d).revealedTops[0].id).toBe('♠A'); // 亮最大牌

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
    expect(result.escrowReturns[String(d)]).toBe(5);
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

    s = act(s, declarerSeat, { t: 'declare_defense', cardIds: ['♥2'], escrow: 1 });
    s = act(s, a, { t: 'pass_defense' });
    s = act(s, b, { t: 'pass_defense' });
    s = act(s, a, { t: 'play', cardIds: ['♠A', '♥A'], bet: 2 });
    s = act(s, b, { t: 'fold' });
    expect(s.round!.phase).toBe('settlement');
    const result = s.round!.result!;
    expect(result.winnerSeat).toBe(a);
    expect(result.potAmount).toBe(3 + 2 + 1);
    expect(result.escrowForfeits[String(declarerSeat)]).toBe(1);
    expect(seatOf(s, declarerSeat).chips).toBe(START_CHIPS - ANTE - 1);
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
    s = act(s, declarerSeat, { t: 'declare_defense', cardIds: ['♥2'], escrow: 1 });
    s = act(s, a, { t: 'declare_defense', cardIds: ['♠A'], escrow: 1 });
    s = act(s, b, { t: 'declare_defense', cardIds: ['♣7'], escrow: 1 });
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
    const t1 = tick(s, T0 + 1000 + TIMING.openingMs + 1);
    s = t1.state;
    expect(s.round!.phase).toBe('rotation');
    expect(s.players[declarerSeat]!.battlefield).toHaveLength(1);
    expect(s.players[declarerSeat]!.betTotal).toBe(0);

    // 每个 tick 只推进一个超时自动动作；连续 tick 直至全员同意摊牌
    for (let i = 2; i <= 10; i++) {
      s = tick(s, T0 + 1000 + TIMING.openingMs + TIMING.turnMs * i + 1).state;
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
    const t = tick(s, T0 + 2000 + TIMING.turnMs + 1);
    s = t.state;
    const pa = seatOf(s, a);
    expect(pa.battlefield).toHaveLength(3);
    expect(pa.betTotal).toBe(3);
    // 双方已押满 → 后续超时自动同意 → 摊牌
    let phase = s.round!.phase;
    for (let i = 2; i <= 10 && phase !== 'settlement'; i++) {
      s = tick(s, T0 + 2000 + TIMING.turnMs * i + 1).state;
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
      s = tick(s, T0 + 3000 + TIMING.turnMs * i + 1).state;
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
    const t2 = tick(s, T0 + 6000 + TIMING.turnMs + 1);
    s = t2.state;
    // 自动弃牌 → 只剩一人 → 立即摊牌结算 → 0 筹码淘汰
    expect(['folded', 'out']).toContain(seatOf(s, a).status);
    expect(s.round!.phase).toBe('settlement');
    expect(seatOf(s, a).chips).toBe(0);

    const t3 = tick(s, T0 + 6000 + TIMING.turnMs + TIMING.settlementMs + 1);
    s = t3.state;
    expect(s.phase).toBe('gameover');
    expect(s.winnerSeat).toBe(opener);

    const r = rematch(s, opener);
    expect(r.ok).toBe(true);
    expect(s.phase).toBe('lobby');
    expect(seatOf(s, opener).chips).toBe(START_CHIPS);
  });
});

describe('杂项校验', () => {
  it('错误的时机与角色被拒绝', () => {
    const { s, declarerSeat } = newGame(3);
    expect(tryAct(s, declarerSeat, { t: 'force_close_defense' })).toBeNull(); // 宣战者可以提前开始
    const { s: s2, declarerSeat: d2 } = newGame(3);
    const notDeclarer = nextVoterOf(s2, d2);
    expect(tryAct(s2, notDeclarer, { t: 'force_close_defense' })).toContain('只有宣战者');
    expect(tryAct(s2, notDeclarer, { t: 'declare_defense', cardIds: [], escrow: 0 })).toContain('至少打出一张');
    expect(tryAct(s2, notDeclarer, { t: 'declare_defense', cardIds: ['♠A'], escrow: 200 })).toContain('超过你的筹码');
  });

  it('防守声明后本回合被锁定', () => {
    const { s: s0, declarerSeat } = newGame(3);
    let s = s0;
    const a = nextVoterOf(s0, declarerSeat);
    replaceHands(s0, { [a]: ['♥K', '♣K', '♠5', '♣4', '♦3', '♥2'] });
    s = act(s, a, { t: 'declare_defense', cardIds: ['♥K', '♣K'], escrow: 2 });
    expect(tryAct(s, a, { t: 'fold' })).toContain('现在不能弃牌'); // 还在防守窗口
    expect(tryAct(s, a, { t: 'declare_defense', cardIds: ['♠5'], escrow: 1 })).toContain('表态');
  });
});
