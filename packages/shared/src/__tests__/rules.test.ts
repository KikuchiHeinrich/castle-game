import { describe, expect, it } from 'vitest';
import { Card, GameAction, GameEvent, GameState, ANTE, HAND_SIZE, MAX_PLAYERS, START_CHIPS, addPlayer, applyAction, bestHand, createGameState, normalizeSettings, rematch, startGame, tick } from '../index';

const T0 = 1_000_000;
const TURN_MS = 60_000; // 与 DEFAULT_SETTINGS.turnMs 一致

function newGame(n = 3, seed = 7): { s: GameState; declarerSeat: number; events: GameEvent[] } {
  let s = createGameState('TST1');
  for (let i = 0; i < n; i++) {
    const r = addPlayer(s, `P${i}`);
    if (!r.ok) throw new Error(r.error);
  }
  const g = startGame(s, 0, seed, T0);
  if (!g.ok) throw new Error(g.error);
  return { s: g.state, declarerSeat: g.state.round!.declarerSeat, events: g.events };
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
const survivorsOf = (s: GameState) => s.players.filter((p) => p && p.status !== 'out');
const readyAll = (s0: GameState, agree = true): GameState => {
  let s = s0;
  for (const p of survivorsOf(s)) s = act(s, p!.seat, { t: 'ready_next', agree });
  return s;
};
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
    const { s, events } = newGame(3);
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
    const deal = events.find((ev) => ev.t === 'deal');
    expect(deal?.t === 'deal' ? deal.counts : null).toEqual([[0, 6], [1, 6], [2, 6]]);
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

    expect(s.round!.deadlineAt).toBe(0);
    s = act(s, declarerSeat, { t: 'ready_next', agree: true });
    s = act(s, other1, { t: 'ready_next', agree: true });
    expect(s.round!.phase).toBe('settlement'); // 弃牌者仍是存活玩家，必须明确准备
    expect(seatOf(s, other2).nextReady).toBe(false);

    seatOf(s, other2).connected = false;
    const frozen = tick(s, T0 + 10_000_000);
    expect(frozen.state.round!.roundNo).toBe(1);
    expect(frozen.state.round!.phase).toBe('settlement');
    expect(frozen.events).toHaveLength(0);
    expect(seatOf(frozen.state, other2).nextReady).toBe(false);

    s = act(s, other2, { t: 'ready_next', agree: true });
    expect(s.round!.roundNo).toBe(2);
    expect(s.round!.declarerSeat).toBe(declarerSeat); // 上回合胜者开局
    expect(s.round!.phase).toBe('defense_window');
    expect(s.round!.pot).toBe(3);
    expect(cardTotal(s)).toBe(52);
    for (const p of s.players) {
      expect(p!.battlefield).toHaveLength(0);
      expect(s.secret!.hands[p!.seat]).toHaveLength(HAND_SIZE);
      expect(p!.status).toBe('active');
      expect(p!.nextReady).toBe(false);
    }
  });

  it('同一对子先比杂牌：纯低对战胜带杂高对', () => {
    const { s: s0, declarerSeat } = newGame(2);
    let s = s0;
    const other = nextVoterOf(s, declarerSeat);
    replaceHands(s, {
      [declarerSeat]: ['♠K', '♥K', '♦4', '♣5', '♥6', '♦7'],
      [other]: ['♠A', '♥A', '♦2', '♣7', '♥4', '♦5'],
    });

    for (const seat of [declarerSeat, other]) s = act(s, seat, { t: 'pass_defense' });
    s = act(s, declarerSeat, { t: 'play', cardIds: ['♠K', '♥K'], bet: 0 });
    s = act(s, other, { t: 'play', cardIds: ['♠A', '♥A', '♦2', '♣7'], bet: 0 });
    s = act(s, declarerSeat, { t: 'agree_end', agree: true });
    s = act(s, other, { t: 'agree_end', agree: true });

    expect(s.round!.phase).toBe('settlement');
    const result = s.round!.result!;
    expect(result.winnerSeat).toBe(declarerSeat);
    expect(result.entries.map((e) => e.seat)).toEqual([declarerSeat, other]);
    expect(result.entries[0].typeRank).toBe(2);
    expect(result.entries[0].junk).toBe(0);
    expect(bestHand(result.entries[0].cards)!.keyRank).toBe(13);
    expect(result.entries[0].usedIds).toHaveLength(2);
    expect(result.entries[1].typeRank).toBe(2);
    expect(result.entries[1].junk).toBe(2);
    expect(bestHand(result.entries[1].cards)!.keyRank).toBe(14);
    expect(result.entries[1].usedIds).toHaveLength(2);
    expect(seatOf(s, declarerSeat).chips).toBe(START_CHIPS - ANTE + 2);
    expect(seatOf(s, other).chips).toBe(START_CHIPS - ANTE);
  });
});

describe('结算准备', () => {
  function settledVoidGame(): GameState {
    const { s: s0 } = newGame(3);
    let s = s0;
    for (const p of survivorsOf(s)) {
      s = act(s, p!.seat, { t: 'declare_defense', cardIds: [s.secret!.hands[p!.seat][0].id], escrow: 1 });
    }
    expect(s.round!.phase).toBe('settlement');
    return s;
  }

  it('支持部分准备、取消与全员准备；next_ready 事件公开', () => {
    let s = settledVoidGame();

    const first = applyAction(s, 0, { t: 'ready_next', agree: true }, T0 + 2000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.events.some((e) => e.t === 'next_ready' && e.seat === 0 && e.agree)).toBe(true);
    s = first.state;
    expect(seatOf(s, 0).nextReady).toBe(true);
    expect(s.round!.phase).toBe('settlement');

    s = act(s, 0, { t: 'ready_next', agree: false });
    expect(seatOf(s, 0).nextReady).toBe(false);
    expect(s.round!.phase).toBe('settlement');

    s = act(s, 0, { t: 'ready_next', agree: true });
    s = act(s, 1, { t: 'ready_next', agree: true });
    expect(s.round!.phase).toBe('settlement');
    expect(seatOf(s, 2).nextReady).toBe(false);

    s = act(s, 2, { t: 'ready_next', agree: true });
    expect(s.round!.roundNo).toBe(2);
    expect(s.round!.phase).toBe('defense_window');
    for (const p of s.players) expect(p!.nextReady).toBe(false);
  });

  it('已淘汰玩家不参与全员准备，也不再能准备', () => {
    let s = settledVoidGame();
    seatOf(s, 2).status = 'out';
    seatOf(s, 2).chips = 0;

    s = act(s, 0, { t: 'ready_next', agree: true });
    s = act(s, 1, { t: 'ready_next', agree: true });
    expect(s.round!.roundNo).toBe(2);
    expect(seatOf(s, 2).status).toBe('out');
    expect(seatOf(s, 2).nextReady).toBe(false);
  });

  it('只有结算阶段接受准备操作', () => {
    const { s } = newGame(3);
    expect(tryAct(s, 0, { t: 'ready_next', agree: true })).toContain('结算准备阶段');
    const settled = settledVoidGame();
    expect(tryAct(settled, 0, { t: 'agree_end', agree: true })).toContain('现在不能表态');
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
    s = readyAll(s);
    expect(s.round!.roundNo).toBe(2);
    expect(s.round!.pot).toBe(3);
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

    // 全员明确准备后进入第二回合：a 底注后 0 筹码，弃牌后归零淘汰 → 终局
    s = readyAll(s);
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
    expect(s.phase).toBe('gameover');
    expect(s.winnerSeat).toBe(opener);
    expect(s.round!.result).not.toBeNull();
    expect(t2.events.map((e) => e.t)).toEqual(expect.arrayContaining(['fold', 'showdown', 'eliminated', 'winner', 'game_over']));

    const frozen = tick(s, T0 + 10_000_000);
    expect(frozen.state.phase).toBe('gameover');
    expect(frozen.state.round!.result).toEqual(s.round!.result);
    expect(frozen.events).toHaveLength(0);

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

    s = readyAll(s);
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

  it('deal 只报告新补牌：四家为 2,2,0,2，继承牌保留且最终仍为 6 张', () => {
    const { s: s0 } = newGame(4, 13);
    const foldedSeat = 2;
    let s = s0;

    for (let i = 0; i < 4; i++) s = act(s, i, { t: 'pass_defense' });
    for (let i = 0; i < 4; i++) {
      const seat = s.round!.turnSeat;
      if (seat === foldedSeat) {
        s = act(s, seat, { t: 'fold' });
      } else {
        const ids = s.secret!.hands[seat].slice(0, 2).map((c) => c.id);
        s = act(s, seat, { t: 'play', cardIds: ids, bet: 0 });
      }
    }
    expect(s.players.filter((p) => p?.status === 'active')).toHaveLength(3);
    expect(s.players[foldedSeat]!.status).toBe('folded');

    for (let i = 0; i < 3; i++) {
      s = act(s, s.round!.turnSeat, { t: 'agree_end', agree: true });
    }
    expect(s.round!.phase).toBe('settlement');

    const inherited = new Map<number, string[]>();
    for (const p of s.players) {
      if (p) inherited.set(p.seat, s.secret!.hands[p.seat].map((c) => c.id));
    }

    let deal: Extract<GameEvent, { t: 'deal' }> | null = null;
    for (const p of survivorsOf(s)) {
      const res = applyAction(s, p!.seat, { t: 'ready_next', agree: true }, T0 + 5000);
      if (!res.ok) throw new Error(res.error);
      s = res.state;
      deal = res.events.find((ev): ev is Extract<GameEvent, { t: 'deal' }> => ev.t === 'deal') ?? deal;
    }

    expect(deal).not.toBeNull();
    expect(deal!.counts).toEqual([[0, 2], [1, 2], [2, 0], [3, 2]]);
    expect(inherited.get(foldedSeat)).toHaveLength(HAND_SIZE);
    for (const p of s.players) {
      if (!p) continue;
      const now = new Set(s.secret!.hands[p.seat].map((c) => c.id));
      const kept = inherited.get(p.seat)!;
      expect(s.secret!.hands[p.seat]).toHaveLength(HAND_SIZE);
      for (const id of kept) expect(now.has(id)).toBe(true);
      const dealt = deal!.counts.find(([seat]) => seat === p.seat)![1];
      expect(dealt).toBe(HAND_SIZE - kept.length);
    }
    expect(cardTotal(s)).toBe(52);
  });
});

describe('杂项校验', () => {
  it(`房间最多 ${MAX_PLAYERS} 人，第五个真人和电脑都被拒绝`, () => {
    expect(MAX_PLAYERS).toBe(4);
    const s = createGameState('CAP1');
    for (let i = 0; i < MAX_PLAYERS; i++) {
      expect(addPlayer(s, `P${i}`).ok).toBe(true);
    }
    const human = addPlayer(s, '第五人');
    const bot = addPlayer(s, '第五电脑', true);
    expect(human).toEqual({ ok: false, error: `房间已满（最多 ${MAX_PLAYERS} 人）` });
    expect(bot.ok).toBe(false);
    expect(s.players.filter(Boolean)).toHaveLength(MAX_PLAYERS);
  });

  it('错误的时机与角色被拒绝', () => {
    const { s, declarerSeat } = newGame(3);
    expect(tryAct(s, declarerSeat, { t: 'force_close_defense' })).toBeNull(); // 宣战者可以提前开始
    const { s: s2, declarerSeat: d2 } = newGame(3);
    const notDeclarer = nextVoterOf(s2, d2);
    expect(tryAct(s2, notDeclarer, { t: 'force_close_defense' })).toContain('只有宣战者');
    expect(tryAct(s2, notDeclarer, { t: 'declare_defense', cardIds: [], escrow: 0 })).toContain('至少打出一张');
    const hisCard = s2.secret!.hands[notDeclarer][0].id;
    expect(tryAct(s2, notDeclarer, { t: 'declare_defense', cardIds: [hisCard], escrow: 200 })).toContain('超过你的筹码');
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
