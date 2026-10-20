import { describe, expect, it } from 'vitest';
import {
  HAND_SIZE,
  addPlayer,
  applyAction,
  bestHand,
  compareHandValue,
  createGameState,
  evaluateSubset,
  startGame,
  type Card,
  type GameAction,
  type GameState,
  type ShowdownEntry,
} from '../../../shared/src/index';
import {
  buildSettlementSequence,
  seatLayout,
  type SettlementPlayer,
  type SettlementSequence,
  type SettlementStep,
} from '../presentation';

type CriterionStep = Extract<SettlementStep, { kind: 'criterion' }>;
type EscrowStep = Extract<SettlementStep, { kind: 'escrow' }>;
type PayoutStep = Extract<SettlementStep, { kind: 'payout' }>;
type VerdictStep = Extract<SettlementStep, { kind: 'verdict' }>;
type ReadyStep = Extract<SettlementStep, { kind: 'ready' }>;

const T0 = 1_000_000;

function newGame(count: number, seed = 7): GameState {
  const state = createGameState(`PRS${count}`);
  for (let index = 0; index < count; index += 1) {
    const joined = addPlayer(state, `P${index}`);
    if (!joined.ok) throw new Error(joined.error);
  }
  const started = startGame(state, 0, seed, T0);
  if (!started.ok) throw new Error(started.error);
  return started.state;
}

function act(state: GameState, seat: number, action: GameAction): GameState {
  const result = applyAction(state, seat, action, T0 + 1_000);
  if (!result.ok) throw new Error(`seat ${seat} ${action.t}: ${result.error}`);
  return result.state;
}

/** Test-only deck surgery: put known cards in hands and keep all 52 cards intact. */
function replaceHands(state: GameState, spec: Record<number, string[]>): void {
  const all: Card[] = [...state.secret!.deck];
  for (const player of state.players) {
    if (player) all.push(...state.secret!.hands[player.seat]);
  }
  const used = new Set<string>();
  const picked: Record<number, Card[]> = {};
  for (const [seatText, ids] of Object.entries(spec)) {
    const cards: Card[] = [];
    for (const id of ids) {
      if (used.has(id)) throw new Error(`duplicate card ${id}`);
      const index = all.findIndex((card) => card.id === id);
      if (index < 0) throw new Error(`card ${id} is not in the deck or hands`);
      used.add(id);
      cards.push(all.splice(index, 1)[0]);
    }
    picked[Number(seatText)] = cards;
  }
  for (const player of state.players) {
    if (!player) continue;
    const wanted = picked[player.seat];
    if (wanted) {
      while (wanted.length < HAND_SIZE && all.length > 0) wanted.push(all.pop()!);
      state.secret!.hands[player.seat] = wanted;
    } else {
      state.secret!.hands[player.seat] = all.splice(0, HAND_SIZE);
    }
  }
  state.secret!.deck = all;
}

function settlementPlayers(state: GameState): SettlementPlayer[] {
  const players: SettlementPlayer[] = [];
  for (const player of state.players) {
    if (!player) continue;
    players.push({
      seat: player.seat,
      name: player.name,
      status: player.status,
      chips: player.chips,
    });
  }
  return players;
}

function resultOf(state: GameState) {
  const result = state.round?.result;
  if (!result) throw new Error('round has no settlement result');
  return result;
}

function sequenceFor(state: GameState, youSeat: number): SettlementSequence {
  const result = resultOf(state);
  return buildSettlementSequence(
    result,
    settlementPlayers(state),
    youSeat,
    result.entries,
  );
}

function criterionSteps(
  sequence: SettlementSequence,
  scope: 'field' | 'prize',
): CriterionStep[] {
  return sequence.steps.filter(
    (step): step is CriterionStep =>
      step.kind === 'criterion' && step.scope === scope,
  );
}

function escrowStep(sequence: SettlementSequence): EscrowStep {
  const step = sequence.steps.find(
    (item): item is EscrowStep => item.kind === 'escrow',
  );
  if (!step) throw new Error('missing escrow step');
  return step;
}

function verdictStep(sequence: SettlementSequence): VerdictStep {
  const step = sequence.steps.find(
    (item): item is VerdictStep => item.kind === 'verdict',
  );
  if (!step) throw new Error('missing verdict step');
  return step;
}

function readyStep(sequence: SettlementSequence): ReadyStep {
  const step = sequence.steps.find(
    (item): item is ReadyStep => item.kind === 'ready',
  );
  if (!step) throw new Error('missing ready step');
  return step;
}

function payoutFor(sequence: SettlementSequence, seat: number): PayoutStep {
  const step = sequence.steps.find(
    (item): item is PayoutStep =>
      item.kind === 'payout' && item.seat === seat,
  );
  if (!step) throw new Error(`missing payout for seat ${seat}`);
  return step;
}

function assertRevealPrelude(
  sequence: SettlementSequence,
  entries: ShowdownEntry[],
): void {
  const firstComparison = sequence.steps.findIndex(
    (step) =>
      step.kind === 'criterion' ||
      step.kind === 'escrow' ||
      step.kind === 'verdict',
  );
  expect(firstComparison).toBeGreaterThan(-1);
  const prelude = sequence.steps.slice(0, firstComparison);

  for (const entry of entries) {
    const seatSteps = prelude.filter(
      (step) => 'seat' in step && step.seat === entry.seat,
    );
    expect(seatSteps.map((step) => step.kind)).toEqual([
      'reveal-start',
      ...entry.cards.map(() => 'reveal-card'),
      'reveal-hold',
    ]);
    const revealCards = seatSteps.filter(
      (step): step is Extract<SettlementStep, { kind: 'reveal-card' }> =>
        step.kind === 'reveal-card',
    );
    expect(revealCards.map((step) => step.cardIndex)).toEqual(
      entry.cards.map((_, index) => index),
    );
    expect(revealCards.every((step) => step.seat === entry.seat)).toBe(true);
    for (const step of revealCards) {
      expect(step.entry.cards[step.cardIndex]?.id).toBe(
        entry.cards[step.cardIndex].id,
      );
    }
  }

  const afterComparisons = sequence.steps.slice(firstComparison);
  expect(
    afterComparisons.some(
      (step) =>
        step.kind === 'reveal-start' ||
        step.kind === 'reveal-card' ||
        step.kind === 'reveal-hold',
    ),
  ).toBe(false);
}

/**
 * Drive a real engine round to settlement. `plays` contains the battlefield
 * cards for each active player; `defenderSeat` declares defense first.
 */
function playRound(
  state: GameState,
  plays: Record<number, string[]>,
  defenderSeat: number | null = null,
): GameState {
  let current = state;
  const activeSeats: number[] = [];
  for (const player of current.players) {
    if (player?.status === 'active') activeSeats.push(player.seat);
  }
  const attackers = activeSeats.filter((seat) => seat !== defenderSeat);

  if (defenderSeat !== null) {
    const cards = plays[defenderSeat];
    if (!cards || cards.length === 0) throw new Error('defender has no cards');
    current = act(current, defenderSeat, {
      t: 'declare_defense',
      cardIds: cards,
      escrow: cards.length,
    });
  }

  for (const seat of attackers) {
    current = act(current, seat, { t: 'pass_defense' });
  }
  if (current.round?.phase !== 'opening') {
    throw new Error(`expected opening, got ${current.round?.phase}`);
  }

  for (let index = 0; index < attackers.length; index += 1) {
    const seat = current.round!.turnSeat;
    const cards = plays[seat];
    if (!cards || cards.length === 0) {
      throw new Error(`no battlefield cards for seat ${seat}`);
    }
    current = act(current, seat, { t: 'play', cardIds: cards, bet: 0 });
  }

  for (let index = 0; index < attackers.length; index += 1) {
    const seat = current.round!.turnSeat;
    current = act(current, seat, { t: 'agree_end', agree: true });
  }

  if (!current.round?.result) throw new Error('round did not settle');
  return current;
}

function defenderRound(): GameState {
  const state = newGame(3);
  replaceHands(state, {
    0: ['♠K', '♥K', '♦2', '♦3', '♦4', '♦5'],
    1: ['♠Q', '♥Q', '♣2', '♣3', '♣4', '♣5'],
    2: ['♠A', '♥A', '♦6', '♦7', '♦8', '♦9'],
  });
  return playRound(
    state,
    {
      0: ['♠K', '♥K'],
      1: ['♠Q', '♥Q'],
      2: ['♠A', '♥A'],
    },
    2,
  );
}

function junkRound(): GameState {
  const state = newGame(2);
  replaceHands(state, {
    0: ['♠9', '♥9', '♦4', '♦5', '♦6', '♦7'],
    1: ['♣9', '♦9', '♠2', '♥3', '♣4', '♣5'],
  });
  return playRound(state, {
    0: ['♠9', '♥9'],
    1: ['♣9', '♦9', '♠2', '♥3'],
  });
}

function keyTieRound(): GameState {
  const state = newGame(3);
  replaceHands(state, {
    0: ['♠K', '♦2', '♦3', '♦4', '♦5', '♦6'],
    1: ['♥K', '♣2', '♣3', '♣4', '♣5', '♣6'],
    2: ['♥Q', '♠2', '♠3', '♠4', '♠5', '♠6'],
  });
  return playRound(state, {
    0: ['♠K'],
    1: ['♥K'],
    2: ['♥Q'],
  });
}

function wheelStraightRound(): GameState {
  const state = newGame(2);
  replaceHands(state, {
    0: ['♠A', '♥2', '♣3', '♦4', '♥5', '♦6'],
    1: ['♠5', '♥6', '♣7', '♦8', '♠9', '♣10'],
  });
  return playRound(state, {
    0: ['♠A', '♥2', '♣3', '♦4', '♥5'],
    1: ['♠5', '♥6', '♣7', '♦8', '♠9'],
  });
}

function fourHandRound(): GameState {
  const state = newGame(4);
  replaceHands(state, {
    0: ['♠7', '♥7', '♣7', '♦2', '♦3', '♥4'],
    1: ['♠5', '♥5', '♣4', '♦4', '♣2', '♣3'],
    2: ['♠Q', '♥Q', '♦6', '♦7', '♦8', '♦9'],
    3: ['♠A', '♥2', '♣6', '♦10', '♣8', '♦J'],
  });
  return playRound(state, {
    0: ['♠7', '♥7', '♣7'],
    1: ['♠5', '♥5', '♣4', '♦4'],
    2: ['♠Q', '♥Q'],
    3: ['♠A'],
  });
}

function eliminationRound(): GameState {
  const state = newGame(3);
  replaceHands(state, {
    0: ['♠A', '♥A', '♦2', '♦3', '♦4', '♦5'],
    1: ['♠K', '♥K', '♣2', '♣3', '♣4', '♣5'],
    2: ['♠Q', '♥Q', '♦6', '♦7', '♦8', '♦9'],
  });
  state.players[2]!.chips = 0;
  return playRound(state, {
    0: ['♠A', '♥A'],
    1: ['♠K', '♥K'],
    2: ['♠Q', '♥Q'],
  });
}

function terminalRound(): GameState {
  const state = newGame(2);
  replaceHands(state, {
    0: ['♠A', '♥A', '♦2', '♦3', '♦4', '♦5'],
    1: ['♠K', '♥K', '♣2', '♣3', '♣4', '♣5'],
  });
  state.players[1]!.chips = 0;
  return playRound(state, {
    0: ['♠A', '♥A'],
    1: ['♠K', '♥K'],
  });
}

function voidWithFoldedPlayer(): GameState {
  const state = newGame(3);
  state.players[2]!.status = 'folded';
  let current = state;
  for (const seat of [0, 1]) {
    const card = current.secret!.hands[seat][0];
    current = act(current, seat, {
      t: 'declare_defense',
      cardIds: [card.id],
      escrow: 1,
    });
  }
  return current;
}

describe('seatLayout', () => {
  it('maps relative seats +1, +2 and +3 to left, top and right from every seat', () => {
    const seats = [0, 1, 2, 3];
    const roles = ['self', 'left', 'top', 'right'] as const;
    for (let youSeat = 0; youSeat < 4; youSeat += 1) {
      const expected = roles.map((role, relative) => ({
        seat: (youSeat + relative) % 4,
        role,
        relative,
      }));
      expect(seatLayout(youSeat, seats)).toEqual(expected);
    }
  });

  it('puts a sole opponent on top even when the physical gap is two seats', () => {
    expect(seatLayout(0, [0, 2])).toEqual([
      { seat: 0, role: 'self', relative: 0 },
      { seat: 2, role: 'top', relative: 2 },
    ]);
    expect(seatLayout(1, [1, 3])).toEqual([
      { seat: 1, role: 'self', relative: 0 },
      { seat: 3, role: 'top', relative: 2 },
    ]);
    expect(seatLayout(0, [0, 1])).toEqual([
      { seat: 0, role: 'self', relative: 0 },
      { seat: 1, role: 'top', relative: 1 },
    ]);
  });

  it('keeps sparse seat ids unique and stable', () => {
    const sparse = [0, 1, 3];
    const fromZero = seatLayout(0, sparse);
    expect(fromZero).toEqual([
      { seat: 0, role: 'self', relative: 0 },
      { seat: 1, role: 'left', relative: 1 },
      { seat: 3, role: 'right', relative: 3 },
    ]);
    expect(new Set(fromZero.map((entry) => entry.role)).size).toBe(
      fromZero.length,
    );
    expect(seatLayout(0, [0, 1, 1, 3])).toEqual(fromZero);
    expect(seatLayout(0, sparse)).toEqual(fromZero);

    const fromOne = seatLayout(1, sparse);
    expect(fromOne).toEqual([
      { seat: 1, role: 'self', relative: 0 },
      { seat: 3, role: 'top', relative: 2 },
      { seat: 0, role: 'right', relative: 3 },
    ]);
    expect(new Set(fromOne.map((entry) => entry.role)).size).toBe(
      fromOne.length,
    );
  });
});

describe('buildSettlementSequence with real showdown entries', () => {
  it('reveals every card one at a time, holds, then starts comparisons', () => {
    const state = junkRound();
    const result = resultOf(state);
    const sequence = sequenceFor(state, 0);

    assertRevealPrelude(sequence, result.entries);
    expect(
      sequence.steps.filter((step) => step.kind === 'reveal-card'),
    ).toHaveLength(
      result.entries.reduce((total, entry) => total + entry.cards.length, 0),
    );
    expect(
      sequence.steps.filter(
        (step) => step.kind === 'reveal-start' || step.kind === 'reveal-hold',
      ),
    ).toHaveLength(result.entries.length * 2);
  });

  it('uses authoritative usedIds and junk, and lets criterion two decide same pairs', () => {
    const state = junkRound();
    const result = resultOf(state);
    const sequence = sequenceFor(state, 0);
    const authoritative = result.entries.find((entry) => entry.seat === 1)!;

    expect(authoritative.typeRank).toBe(2);
    expect(authoritative.junk).toBe(2);
    const usedCards = authoritative.cards.filter((card) =>
      authoritative.usedIds.includes(card.id),
    );
    expect(usedCards).toHaveLength(2);
    expect(evaluateSubset(usedCards)?.junk).toBe(0);

    const value = sequence.values.get(1)!;
    expect(value.typeRank).toBe(authoritative.typeRank);
    expect(value.junk).toBe(authoritative.junk);
    expect(value.usedIds).toEqual(authoritative.usedIds);

    expect(criterionSteps(sequence, 'field')).toHaveLength(0);
    expect(
      sequence.steps.some((step) => step.kind === 'escrow'),
    ).toBe(false);
    const prize = criterionSteps(sequence, 'prize');
    const first = prize.find((step) => step.round === 1)!;
    const second = prize.find((step) => step.round === 2)!;
    expect(first.survivors).toEqual([0, 1]);
    expect(second.survivors).toEqual([0]);
    expect(second.rows.find((row) => row.seat === 0)?.value).toContain(
      '0 张',
    );
    expect(second.rows.find((row) => row.seat === 1)?.value).toContain(
      '2 张',
    );
    expect(new Set(prize.map((step) => step.round)).size).toBe(prize.length);
    expect(sequence.fieldMaxSeat).toBe(result.entries[0].seat);
    expect(result.entries[0].seat).toBe(result.winnerSeat);
    expect(sequence.winnerSeat).toBe(0);
  });

  it('resolves key-rank and suit ties only after the earlier criteria tie', () => {
    const state = keyTieRound();
    const sequence = sequenceFor(state, 0);
    const prize = criterionSteps(sequence, 'prize');

    expect(criterionSteps(sequence, 'field')).toHaveLength(0);
    expect(
      sequence.steps.some((step) => step.kind === 'escrow'),
    ).toBe(false);
    expect(prize.map((step) => [step.round, step.survivors])).toEqual([
      [1, [0, 1, 2]],
      [2, [0, 1, 2]],
      [3, [0, 1]],
      [4, [0]],
    ]);
    expect(
      prize[2].rows.find((row) => row.seat === 0)?.comparisonCard?.rank,
    ).toBe(13);
    expect(
      prize[2].rows.find((row) => row.seat === 2)?.comparisonCard?.rank,
    ).toBe(12);
    expect(
      prize[3].rows.find((row) => row.seat === 0)?.comparisonCard?.suit,
    ).toBe(3);
    expect(
      prize[3].rows.find((row) => row.seat === 1)?.comparisonCard?.suit,
    ).toBe(1);
    expect(prize.at(-1)?.survivors).toEqual([0]);
    expect(sequence.winnerSeat).toBe(0);
  });

  it('shows the actual five as the comparison card for an A-low straight', () => {
    const state = wheelStraightRound();
    const sequence = sequenceFor(state, 0);
    const wheelValue = sequence.values.get(0)!;
    expect(criterionSteps(sequence, 'field')).toHaveLength(0);
    expect(
      sequence.steps.some((step) => step.kind === 'escrow'),
    ).toBe(false);
    const prize = criterionSteps(sequence, 'prize');
    const pointRound = prize.find((step) => step.round === 3)!;
    const wheelRow = pointRound.rows.find((row) => row.seat === 0)!;

    expect(wheelValue.keyRank).toBe(5);
    expect(wheelValue.keySuit).toBe(1);
    expect(wheelRow.comparisonCard?.id).toBe('♥5');
    expect(wheelRow.comparisonCard?.rank).toBe(5);
    expect(wheelRow.comparisonCard?.id).not.toBe('♠A');
    expect(pointRound.survivors).toEqual([1]);
    expect(sequence.winnerSeat).toBe(1);
  });

  it('matches compareHandValue order and authoritative values for four players', () => {
    const state = fourHandRound();
    const result = resultOf(state);
    const sequence = sequenceFor(state, 0);
    const sortedSeats = [...result.entries]
      .sort((left, right) =>
        compareHandValue(bestHand(right.cards)!, bestHand(left.cards)!),
      )
      .map((entry) => entry.seat);

    expect(result.entries.map((entry) => entry.seat)).toEqual(sortedSeats);
    expect(result.entries.map((entry) => entry.seat)).toEqual([0, 1, 2, 3]);
    expect(criterionSteps(sequence, 'field')).toHaveLength(0);
    expect(
      sequence.steps.some((step) => step.kind === 'escrow'),
    ).toBe(false);
    expect(criterionSteps(sequence, 'prize').length).toBeGreaterThan(0);
    expect(sequence.winnerSeat).toBe(result.winnerSeat);
    expect(sequence.prizeCandidates[0]).toBe(result.winnerSeat);
    expect(sequence.fieldMaxSeat).toBe(result.entries[0].seat);
    expect(readyStep(sequence).seats).toEqual([0, 1, 2, 3]);

    for (const entry of result.entries) {
      const hand = bestHand(entry.cards)!;
      const value = sequence.values.get(entry.seat)!;
      expect(value.typeRank).toBe(hand.typeRank);
      expect(value.junk).toBe(hand.junk);
      expect(value.keyRank).toBe(hand.keyRank);
      expect(value.keySuit).toBe(hand.keySuit);
      expect(value.usedIds).toEqual(hand.usedIds);
    }
  });

  it('keeps the defender field max separate from the attacker prize winner and escrow', () => {
    const state = defenderRound();
    const result = resultOf(state);
    const sequence = sequenceFor(state, 0);
    const field = criterionSteps(sequence, 'field');
    const prize = criterionSteps(sequence, 'prize');

    expect(result.entries.map((entry) => entry.seat)).toEqual([2, 0, 1]);
    expect(sequence.defenderSeats).toEqual([2]);
    expect(sequence.fieldMaxSeat).toBe(2);
    expect(sequence.winnerSeat).toBe(0);
    expect(sequence.prizeCandidates).toEqual([0, 1]);
    expect(field.at(-1)?.survivors).toEqual([2]);
    expect(prize.at(-1)?.survivors).toEqual([0]);
    expect(field.length).toBeGreaterThan(0);
    expect(prize.length).toBeGreaterThan(0);
    const comparisonKeys = [...field, ...prize].map(
      (step) => `${step.scope}:${step.round}`,
    );
    expect(new Set(comparisonKeys).size).toBe(comparisonKeys.length);
    expect(prize.every((step) => step.rows.every((row) => row.seat !== 2))).toBe(
      true,
    );

    const escrow = escrowStep(sequence);
    expect(escrow.fieldMaxSeat).toBe(2);
    expect(escrow.escrowReturns).toEqual([[2, 2]]);
    expect(escrow.escrowForfeits).toEqual([]);

    const verdict = verdictStep(sequence);
    expect(verdict.winnerSeat).toBe(0);
    expect(verdict.fieldMaxSeat).toBe(2);
    expect(verdict.potAmount).toBe(result.potAmount);
    expect(verdict.note).toContain('P2');
    expect(verdict.note).toContain('P0');
    expect(verdict.note).toContain('奖池');
    expect(verdict.note).not.toContain('P0 未取得');

    const winnerPayout = payoutFor(sequence, 0);
    expect(winnerPayout.potWon).toBe(result.potAmount);
    expect(winnerPayout.escrowReturn).toBe(0);
    const defenderPayout = payoutFor(sequence, 2);
    expect(defenderPayout.potWon).toBe(0);
    expect(defenderPayout.escrowReturn).toBe(2);
    expect(defenderPayout.delta).toBe(2);
    expect(readyStep(sequence).seats).toEqual([0, 1, 2]);
  });

  it('still reveals and pays a player eliminated while the game continues', () => {
    const state = eliminationRound();
    const result = resultOf(state);
    const sequence = sequenceFor(state, 0);

    expect(state.phase).toBe('playing');
    expect(result.eliminated).toEqual([2]);
    expect(settlementPlayers(state).find((player) => player.seat === 2)?.status).toBe(
      'out',
    );
    expect(sequence.participants).toEqual([0, 1, 2]);
    assertRevealPrelude(sequence, result.entries);
    expect(
      sequence.steps.filter(
        (step) => step.kind === 'reveal-card' && step.seat === 2,
      ),
    ).toHaveLength(result.entries.find((entry) => entry.seat === 2)!.cards.length);
    expect(payoutFor(sequence, 2).potWon).toBe(0);
    expect(sequence.survivors).toEqual([0, 1]);
    expect(readyStep(sequence).seats).toEqual([0, 1]);
  });

  it('keeps both final participants visible when the backend ends the game immediately', () => {
    const state = terminalRound();
    const result = resultOf(state);
    const sequence = sequenceFor(state, 0);

    expect(state.phase).toBe('gameover');
    expect(state.round?.phase).toBe('settlement');
    expect(result.eliminated).toEqual([1]);
    expect(sequence.participants).toEqual([0, 1]);
    expect(sequence.revealOrder).toEqual([0, 1]);
    assertRevealPrelude(sequence, result.entries);
    expect(payoutFor(sequence, 0).potWon).toBe(result.potAmount);
    expect(payoutFor(sequence, 1).potWon).toBe(0);
    expect(sequence.survivors).toEqual([0]);
    expect(readyStep(sequence).seats).toEqual([0]);
  });

  it('refunds a void round, has no winner, and pays folded participants', () => {
    const state = voidWithFoldedPlayer();
    const result = resultOf(state);
    const sequence = sequenceFor(state, 0);

    expect(result.voidRound).toBe(true);
    expect(result.winnerSeat).toBeNull();
    expect(result.potAmount).toBe(0);
    expect(result.anteRefunds).toEqual({ '0': 1, '1': 1, '2': 1 });
    expect(sequence.participants).toEqual([0, 1, 2]);
    expect(
      sequence.steps.some(
        (step) => step.kind === 'payout' && step.potWon > 0,
      ),
    ).toBe(false);
    expect(verdictStep(sequence).winnerSeat).toBeNull();
    expect(verdictStep(sequence).potAmount).toBe(0);
    expect(readyStep(sequence).seats).toEqual([0, 1, 2]);

    const payouts = sequence.steps.filter(
      (step): step is PayoutStep => step.kind === 'payout',
    );
    expect(payouts.map((step) => step.seat)).toEqual([0, 1, 2]);
    for (const payout of payouts) expect(payout.anteRefund).toBe(1);
    expect(payoutFor(sequence, 0).escrowReturn).toBe(1);
    expect(payoutFor(sequence, 1).escrowReturn).toBe(1);
    expect(payoutFor(sequence, 2).escrowReturn).toBe(0);
    expect(payoutFor(sequence, 2).delta).toBe(1);
    const foldedNoEntry = sequence.steps.find(
      (step) => step.kind === 'no-entry' && step.seat === 2,
    );
    expect(foldedNoEntry?.kind).toBe('no-entry');
    if (foldedNoEntry?.kind !== 'no-entry') {
      throw new Error('missing no-entry step for the folded seat');
    }
    expect(foldedNoEntry.reason).toContain('弃牌');
  });
});
