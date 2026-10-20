import {
  SUIT_CHARS,
  SUIT_NAMES,
  cardLabel,
  evaluateSubset,
  type Card,
  type HandValue,
  type ShowdownEntry,
  type ShowdownResult,
} from '../../shared/src/index';

export type SeatRole = 'self' | 'top' | 'left' | 'right';

export interface SeatLayoutEntry {
  seat: number;
  role: SeatRole;
  relative: number;
}

export interface SettlementPlayer {
  seat: number;
  name: string;
  status: string;
  chips: number;
}

export interface CriterionRow {
  seat: number;
  value: string;
  reason: string;
  survives: boolean;
  comparisonCard: Card | null;
}

export type SettlementStep =
  | { kind: 'reveal-start'; seat: number; entry: ShowdownEntry }
  | { kind: 'reveal-card'; seat: number; entry: ShowdownEntry; cardIndex: number }
  | { kind: 'reveal-hold'; seat: number; entry: ShowdownEntry }
  | { kind: 'no-entry'; seat: number; reason: string }
  | {
      kind: 'criterion';
      scope: 'field' | 'prize';
      round: number;
      label: string;
      rule: string;
      rows: CriterionRow[];
      survivors: number[];
      eliminated: number[];
    }
  | {
      kind: 'escrow';
      fieldMaxSeat: number | null;
      escrowReturns: [number, number][];
      escrowForfeits: [number, number][];
      note: string;
    }
  | {
      kind: 'verdict';
      winnerSeat: number | null;
      fieldMaxSeat: number | null;
      potAmount: number;
      note: string;
      escrowReturns: [number, number][];
      escrowForfeits: [number, number][];
    }
  | {
      kind: 'payout';
      seat: number;
      delta: number;
      potWon: number;
      escrowReturn: number;
      escrowForfeit: number;
      anteRefund: number;
      chips: number;
    }
  | { kind: 'ready'; seats: number[] };

export interface SettlementSequence {
  result: ShowdownResult;
  entries: ShowdownEntry[];
  players: SettlementPlayer[];
  participants: number[];
  revealOrder: number[];
  survivors: number[];
  defenderSeats: number[];
  prizeCandidates: number[];
  fieldMaxSeat: number | null;
  winnerSeat: number | null;
  values: Map<number, HandValue>;
  steps: SettlementStep[];
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Stable relative table order: self first, then clockwise opponents. */
export function relativeSeatOrder(youSeat: number, seats: number[], maxPlayers = 4): number[] {
  const unique = [...new Set(seats)];
  return [...unique].sort(
    (a, b) =>
      positiveModulo(a - youSeat, maxPlayers) - positiveModulo(b - youSeat, maxPlayers),
  );
}

/**
 * Four fixed seats around the same table. The first three opponents clockwise from self
 * occupy top, left and right; a two-player game uses only top.
 */
export function seatLayout(youSeat: number, seats: number[], maxPlayers = 4): SeatLayoutEntry[] {
  const order = relativeSeatOrder(youSeat, seats, maxPlayers);
  const opponents = order.filter((seat) => seat !== youSeat);
  if (opponents.length === 1) return [{ seat: youSeat, role: 'self', relative: 0 }, { seat: opponents[0], role: 'top', relative: positiveModulo(opponents[0] - youSeat, maxPlayers) }];
  const roleByRelative = new Map<number, SeatRole>([
    [1, 'left'],
    [2, 'top'],
    [3, 'right'],
  ]);
  let opponent = 0;
  return order.slice(0, maxPlayers).map((seat) => {
    if (seat === youSeat) return { seat, role: 'self', relative: 0 };
    const relative = positiveModulo(seat - youSeat, maxPlayers);
    const role = roleByRelative.get(relative) ?? (opponent === 0 ? 'left' : 'right');
    opponent += 1;
    return {
      seat,
      role,
      relative,
    };
  });
}

const effectiveRank = (rank: number) => (rank === 1 ? 14 : rank);

function comparisonCard(entry: ShowdownEntry, value: HandValue): Card | null {
  const used = entry.cards.filter((card) => entry.usedIds.includes(card.id));
  return (
    used.find(
      (card) => effectiveRank(card.rank) === value.keyRank && card.suit === value.keySuit,
    ) ??
    used.find((card) => effectiveRank(card.rank) === value.keyRank) ??
    used.find((card) => card.suit === value.keySuit) ??
    null
  );
}

function entryValue(entry: ShowdownEntry): HandValue | null {
  const used = entry.cards.filter((card) => entry.usedIds.includes(card.id));
  const value = evaluateSubset(used.length > 0 ? used : entry.cards);
  if (!value) return null;
  return {
    ...value,
    typeRank: entry.typeRank,
    junk: entry.junk,
    name: entry.handName,
    alias: entry.handAlias,
    usedIds: entry.usedIds,
  };
}

function criterionRound(
  round: number,
  candidates: ShowdownEntry[],
  values: Map<number, HandValue>,
  scope: 'field' | 'prize',
  prizeSeats: Set<number>,
): { round: 1 | 2 | 3 | 4; scope: 'field' | 'prize'; label: string; rule: string; rows: CriterionRow[]; survivors: number[] } {
  const metric = (entry: ShowdownEntry): number => {
    const value = values.get(entry.seat)!;
    if (round === 1) return value.typeRank;
    if (round === 2) return -value.junk;
    if (round === 3) return value.keyRank;
    return value.keySuit;
  };
  const best = Math.max(...candidates.map(metric));
  const survivors = candidates.filter((entry) => metric(entry) === best);
  const survivorSeats = new Set(survivors.map((entry) => entry.seat));
  const baseLabel =
    round === 1
      ? '① 牌型位次'
      : round === 2
        ? '② 杂牌数'
        : round === 3
          ? '③ 组成牌最大点数'
          : '④ 组成牌最大花色';
  const label = `${scope === 'field' ? '全场最大' : '奖池竞夺'} · ${baseLabel}`;
  const rule =
    round === 1
      ? '牌型位次高者保留'
      : round === 2
        ? '杂牌少者保留'
        : round === 3
          ? '组成牌最大点数高者保留'
          : '组成牌最大花色高者保留（黑桃 > 梅花 > 红桃 > 方片）';

  const rows = candidates.map((entry): CriterionRow => {
    const value = values.get(entry.seat)!;
    const card = round >= 3 ? comparisonCard(entry, value) : null;
    const survives = survivorSeats.has(entry.seat);
    let text =
      round === 1
        ? `${value.typeRank}/22 · ${entry.handAlias} / ${entry.handName}`
        : round === 2
          ? `${value.junk} 张`
          : round === 3
            ? `点数 ${value.keyRank}${card ? ` · ${cardLabel(card)}` : ''}`
            : `${SUIT_CHARS[value.keySuit]} ${SUIT_NAMES[value.keySuit]}${card ? ` · ${cardLabel(card)}` : ''}`;
    if (survives && survivors.length === candidates.length) text += ' · 并列保留';
    else if (survives) text += ' · 保留';
    else {
      const bestValue = values.get(survivors[0].seat)!;
      text +=
        round === 1
          ? ` · 低于 ${bestValue.typeRank}/22`
          : round === 2
            ? ` · 多于 ${bestValue.junk} 张`
            : round === 3
              ? ` · 低于 ${bestValue.keyRank}`
              : ` · 花色低于 ${SUIT_CHARS[bestValue.keySuit]} ${SUIT_NAMES[bestValue.keySuit]}`;
    }
    const reason = survives
      ? '保留进入下一项'
      : scope === 'field' && prizeSeats.has(entry.seat)
        ? '退出全场最大比较 · 仍可争夺奖池'
        : scope === 'field'
          ? '退出全场最大比较'
          : '退出奖池竞夺';
    return { seat: entry.seat, value: text, reason, survives, comparisonCard: card };
  });

  return { round: round as 1 | 2 | 3 | 4, scope, label, rule, rows, survivors: survivors.map((entry) => entry.seat) };
}

function bySeatMap(values: Record<string, number>, seats: number[]): [number, number][] {
  return seats
    .map((seat) => [seat, values[String(seat)] ?? 0] as [number, number])
    .filter(([, amount]) => amount > 0);
}

/**
 * Builds the complete public settlement story from authoritative result data.
 * Every reveal, comparison, payout and readiness step is explicit so rendering can
 * advance one step at a time without reading the final result early.
 */
export function buildSettlementSequence(
  result: ShowdownResult,
  players: SettlementPlayer[],
  youSeat: number,
  entries: ShowdownEntry[] = result.entries,
): SettlementSequence {
  const playerBySeat = new Map(players.map((player) => [player.seat, player]));
  const name = (seat: number | null) =>
    seat === null ? '无人' : (playerBySeat.get(seat)?.name ?? `座位 ${seat}`);
  const survivors = players
    .filter((player) => player.status !== 'out')
    .sort(
      (a, b) =>
        positiveModulo(a.seat - youSeat, 4) - positiveModulo(b.seat - youSeat, 4),
    )
    .map((player) => player.seat);
  const entryBySeat = new Map(entries.map((entry) => [entry.seat, entry]));
  const values = new Map<number, HandValue>();
  for (const entry of entries) {
    const value = entryValue(entry);
    if (value) values.set(entry.seat, value);
  }
  const defenderSeats = [
    ...new Set([
      ...Object.keys(result.escrowReturns).map(Number),
      ...Object.keys(result.escrowForfeits).map(Number),
    ]),
  ].filter((seat) => entryBySeat.has(seat));
  const defenderSet = new Set(defenderSeats);
  const prizeCandidates = entries.filter((entry) => !defenderSet.has(entry.seat));
  const prizeSeats = new Set(prizeCandidates.map((entry) => entry.seat));
  const participantSet = new Set<number>([
    ...survivors,
    ...entries.map((entry) => entry.seat),
    ...result.eliminated,
    ...Object.keys(result.escrowReturns).map(Number),
    ...Object.keys(result.escrowForfeits).map(Number),
    ...Object.keys(result.chipDeltas).map(Number),
    ...Object.keys(result.anteRefunds).map(Number),
  ]);
  const participants = relativeSeatOrder(youSeat, [...participantSet], 4);
  const revealOrder = participants;

  const steps: SettlementStep[] = [];
  for (const seat of revealOrder) {
    const entry = entryBySeat.get(seat);
    if (!entry) {
      const status = playerBySeat.get(seat)?.status;
      steps.push({
        kind: 'no-entry',
        seat,
        reason:
          status === 'folded'
            ? '已弃牌，不参与这次牌型比较'
            : status === 'out'
              ? '已出局'
              : '没有可比较的出战牌',
      });
      continue;
    }
    steps.push({ kind: 'reveal-start', seat, entry });
    entry.cards.forEach((_card, cardIndex) => {
      steps.push({ kind: 'reveal-card', seat, entry, cardIndex });
    });
    steps.push({ kind: 'reveal-hold', seat, entry });
  }

  let fieldCandidates = entries.filter((entry) => values.has(entry.seat));
  const hasDefenders = defenderSeats.length > 0;
  if (hasDefenders) {
    for (let round = 1; round <= 4 && fieldCandidates.length > 1; round += 1) {
      const criterion = criterionRound(round, fieldCandidates, values, 'field', prizeSeats);
      steps.push({
        kind: 'criterion',
        scope: criterion.scope,
        round: criterion.round,
        label: criterion.label,
        rule: criterion.rule,
        rows: criterion.rows,
        survivors: criterion.survivors,
        eliminated: criterion.rows.filter((row) => !row.survives).map((row) => row.seat),
      });
      fieldCandidates = fieldCandidates.filter((entry) => criterion.survivors.includes(entry.seat));
    }
  }

  const fieldMaxSeat = hasDefenders
    ? fieldCandidates[0]?.seat ?? entries[0]?.seat ?? null
    : entries[0]?.seat ?? null;
  const winnerSeat = result.winnerSeat;
  const escrowReturns = bySeatMap(result.escrowReturns, participants);
  const escrowForfeits = bySeatMap(result.escrowForfeits, participants);
  const escrowNote = [
    escrowReturns.length > 0
      ? `全场最大防守者退回托管：${escrowReturns
          .map(([seat, amount]) => `${name(seat)} +${amount}`)
          .join('、')}`
      : '',
    escrowForfeits.length > 0
      ? `未取得全场最大的防守托管罚没入池：${escrowForfeits
          .map(([seat, amount]) => `${name(seat)} −${amount}`)
          .join('、')}`
      : '',
  ]
    .filter(Boolean)
    .join('；');
  if (hasDefenders) {
    steps.push({
      kind: 'escrow',
      fieldMaxSeat,
      escrowReturns,
      escrowForfeits,
      note: escrowNote,
    });
  }

  const prizeAlreadySettled =
    hasDefenders && fieldMaxSeat !== null && prizeSeats.has(fieldMaxSeat);
  if (!prizeAlreadySettled) {
    let prizeRun = [...prizeCandidates];
    for (let round = 1; round <= 4 && prizeRun.length > 1; round += 1) {
      const criterion = criterionRound(round, prizeRun, values, 'prize', prizeSeats);
      steps.push({
        kind: 'criterion',
        scope: criterion.scope,
        round: criterion.round,
        label: criterion.label,
        rule: criterion.rule,
        rows: criterion.rows,
        survivors: criterion.survivors,
        eliminated: criterion.rows.filter((row) => !row.survives).map((row) => row.seat),
      });
      prizeRun = prizeRun.filter((entry) => criterion.survivors.includes(entry.seat));
    }
  }

  let note = result.voidRound ? '本回合无人竞夺，投入按规则退回。' : `${name(winnerSeat)} 获得奖池。`;
  if (!result.voidRound && fieldMaxSeat !== null && fieldMaxSeat !== winnerSeat) {
    const top = name(fieldMaxSeat);
    const returned = result.escrowReturns[String(fieldMaxSeat)] ?? 0;
    note =
      returned > 0
        ? `${top} 取得场上最大牌型，防守托管 ${returned} 退回；奖池归进攻者中最大者 ${name(winnerSeat)}。`
        : `${top} 取得场上最大牌型；奖池归进攻者中最大者 ${name(winnerSeat)}。`;
  } else if (!result.voidRound && escrowForfeits.length > 0) note += ` ${escrowNote}`;
  steps.push({
    kind: 'verdict',
    winnerSeat,
    fieldMaxSeat,
    potAmount: result.potAmount,
    note,
    escrowReturns,
    escrowForfeits,
  });

  for (const seat of participants) {
    const player = playerBySeat.get(seat);
    const potWon = winnerSeat === seat ? result.potAmount : 0;
    const escrowReturn = result.escrowReturns[String(seat)] ?? 0;
    const escrowForfeit = result.escrowForfeits[String(seat)] ?? 0;
    const anteRefund = result.anteRefunds[String(seat)] ?? 0;
    steps.push({
      kind: 'payout',
      seat,
      delta: potWon + escrowReturn + anteRefund - escrowForfeit,
      potWon,
      escrowReturn,
      escrowForfeit,
      anteRefund,
      chips: player?.chips ?? 0,
    });
  }
  steps.push({ kind: 'ready', seats: survivors });

  return {
    result,
    entries,
    players,
    participants,
    revealOrder,
    survivors,
    defenderSeats,
    prizeCandidates: prizeCandidates.map((entry) => entry.seat),
    fieldMaxSeat,
    winnerSeat,
    values,
    steps,
  };
}

export function settlementCaption(
  step: SettlementStep,
  sequence: SettlementSequence,
): string {
  const name = (seat: number | null) =>
    seat === null
      ? '无人'
      : (sequence.players.find((player) => player.seat === seat)?.name ?? `座位 ${seat}`);
  switch (step.kind) {
    case 'reveal-start':
      return `亮牌：${name(step.seat)} · 逐张翻开 ${step.entry.cards.length} 张`;
    case 'reveal-card': {
      const card = step.entry.cards[step.cardIndex];
      return `${name(step.seat)} · 第 ${step.cardIndex + 1}/${step.entry.cards.length} 张${
        card ? ` · ${cardLabel(card)}` : ''
      }`;
    }
    case 'reveal-hold':
      return `${name(step.seat)} · ${step.entry.handAlias} / ${step.entry.handName} · 用 ${step.entry.usedIds.length} 张，杂牌 ${step.entry.junk} 张`;
    case 'no-entry':
      return `${name(step.seat)} · ${step.reason}`;
    case 'criterion':
      return `${step.label} · ${step.rule}`;
    case 'escrow':
      return `托管判定 · ${step.note}`;
    case 'verdict':
      return step.winnerSeat === null
        ? '比较完成 · 回合作废'
        : `比较完成 · ${name(step.winnerSeat)} 获得奖池 ${step.potAmount}`;
    case 'payout':
      return `筹码分配：${name(step.seat)} ${step.delta >= 0 ? '+' : ''}${step.delta} → ${step.chips}`;
    case 'ready':
      return '等待每位仍在局中的玩家确认继续';
  }
}
