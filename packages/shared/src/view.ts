import { Card, GameEvent, GameState, PlaySegment, Player, PlayerStatus, RoundPhase, ShowdownResult } from './types';
import { allPlayers, getPlayer } from './seating';
import { LegalActions, emptyLegal, legalActions } from './legal';

/**
 * 每玩家状态视图——服务器只 emit 这个函数的输出，绝不透出 secret
 * （牌堆、RNG 种子、他人手牌）。view.test.ts 有结构性断言锁死。
 */
export interface PublicPlayer {
  seat: number;
  name: string;
  avatar: string;
  chips: number;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  away: boolean;
  status: PlayerStatus;
  betTotal: number;
  invested: number;
  escrow: number;
  handCount: number;
  battlefieldCount: number;
  playSegments: PlaySegment[]; // 出牌段（全为公开信息）
  agreeEnd: boolean;
  lastAction: string;
}

export interface YouView {
  seat: number;
  name: string;
  avatar: string;
  chips: number;
  isHost: boolean;
  status: PlayerStatus;
  hand: Card[]; // 只有自己有真实手牌
  battlefield: Card[];
  playSegments: PlaySegment[];
  betTotal: number;
  invested: number;
  escrow: number;
  agreeEnd: boolean;
  defensePassed: boolean;
  lastAction: string;
  away: boolean;
  legalActions: LegalActions;
}

export interface PlayerView {
  code: string;
  phase: GameState['phase'];
  settings: GameState['settings'];
  stateSeq: number;
  eventSeq: number;
  isHost: boolean;
  players: PublicPlayer[];
  pot: number;
  deckCount: number;
  roundNo: number | null;
  roundPhase: RoundPhase | null;
  declarerSeat: number | null;
  openerSeat: number | null;
  turnSeat: number | null;
  maxBet: number;
  agreeSeats: number[];
  deadlineAt: number;
  you: YouView;
  result: ShowdownResult | null; // 仅 settlement 阶段存在（全员明牌）
  winnerSeat: number | null;
  recentEvents: GameEvent[]; // 重连补发：本座位未消费的最近事件（公开信息）
}

export function buildPlayerView(s: GameState, seat: number, recentEvents: GameEvent[] = []): PlayerView | null {
  const me = getPlayer(s, seat);
  if (!me) return null;

  const r = s.round;
  const pub = (p: Player): PublicPlayer => ({
    seat: p.seat,
    name: p.name,
    avatar: p.avatar,
    chips: p.chips,
    isHost: p.isHost,
    isBot: p.isBot,
    connected: p.connected,
    away: p.away,
    status: p.status,
    betTotal: p.betTotal,
    invested: p.invested,
    escrow: p.escrow,
    handCount: s.secret?.hands[p.seat]?.length ?? 0,
    battlefieldCount: p.battlefield.length,
    playSegments: p.playSegments.map((s0) => ({ ...s0 })),
    agreeEnd: p.agreeEnd,
    lastAction: p.lastAction,
  });

  return {
    code: s.code,
    phase: s.phase,
    settings: { ...s.settings },
    stateSeq: s.stateSeq,
    eventSeq: s.eventSeq,
    isHost: me.isHost,
    players: allPlayers(s).map(pub),
    pot: r?.pot ?? 0,
    deckCount: s.secret?.deck.length ?? 52,
    roundNo: r?.roundNo ?? null,
    roundPhase: r?.phase ?? null,
    declarerSeat: r?.declarerSeat ?? null,
    openerSeat: r?.openerSeat ?? null,
    turnSeat: r?.turnSeat ?? null,
    maxBet: r?.maxBet ?? 0,
    agreeSeats: allPlayers(s).filter((p) => p.agreeEnd).map((p) => p.seat),
    deadlineAt: r?.deadlineAt ?? 0,
    you: {
      seat: me.seat,
      name: me.name,
      avatar: me.avatar,
      chips: me.chips,
      isHost: me.isHost,
      status: me.status,
      hand: s.secret ? [...(s.secret.hands[seat] ?? [])] : [],
      battlefield: [...me.battlefield],
      playSegments: me.playSegments.map((s0) => ({ ...s0 })),
      betTotal: me.betTotal,
      invested: me.invested,
      escrow: me.escrow,
      agreeEnd: me.agreeEnd,
      defensePassed: me.defensePassed,
      lastAction: me.lastAction,
      away: me.away,
      legalActions: s.phase === 'playing' ? legalActions(s, seat) : emptyLegal(null),
    },
    result: r?.result ?? null,
    winnerSeat: s.winnerSeat,
    recentEvents,
  };
}
