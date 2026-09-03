import {
  GameAction,
  GameState,
  addCardsBetRange,
  addPlayer,
  legalActions,
} from '../../shared/src/index';
import { Room } from './rooms';

/**
 * 开发/补位用机器人：按当前合法操作随机行动。
 * 倾向于经常"同意结束"，保证对局能推进。
 */
export class BotDriver {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private apply: (room: Room, seat: number, action: GameAction) => void,
    private rand: () => number = Math.random,
  ) {}

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  forget(code: string) {
    const t = this.timers.get(code);
    if (t) clearTimeout(t);
    this.timers.delete(code);
  }

  /** 每次 commit 后调用：若场上有需要行动的机器人，安排思考 */
  kick(room: Room) {
    if (this.timers.has(room.code)) return;
    const s = room.state;
    if (s.phase !== 'playing') {
      if (s.phase === 'lobby' && s.players.some((p) => p?.isBot)) {
        // 大厅阶段无需行动
      }
      return;
    }
    const delay = 600 + this.rand() * 1400;
    const t = setTimeout(() => {
      this.timers.delete(room.code);
      this.actOnce(room);
    }, delay);
    this.timers.set(room.code, t);
  }

  private aliveBotSeats(s: GameState): number[] {
    return s.players.filter((p) => p?.isBot && p.status !== 'out').map((p) => p!.seat);
  }

  private actOnce(room: Room) {
    const s = room.state;
    const bots = this.aliveBotSeats(s);
    if (bots.length === 0) return;
    const r = s.round;

    let seat = -1;
    let action: GameAction | null = null;

    if (!r) return;

    if (r.phase === 'defense_window') {
      seat = bots.find((b) => s.players[b]?.status === 'active' && !s.players[b]?.defensePassed) ?? -1;
      if (seat < 0) return;
      const hand = s.secret!.hands[seat];
      if (this.rand() < 0.25 && hand.length >= 1) {
        const n = Math.min(hand.length, 1 + Math.floor(this.rand() * 3));
        const cardIds = hand.slice(0, n).map((c) => c.id);
        const escrow = Math.min(n + Math.floor(this.rand() * 3), s.players[seat]!.chips);
        action = { t: 'declare_defense', cardIds, escrow: Math.max(escrow, n) };
      } else {
        action = { t: 'pass_defense' };
      }
    } else if (r.phase === 'opening' || r.phase === 'rotation') {
      seat = r.turnSeat;
      const p = s.players[seat];
      if (!p?.isBot) return;
      const la = legalActions(s, seat);
      const hand = s.secret!.hands[seat];
      const pick = (n: number) => hand.slice(0, n).map((c) => c.id);

      if (r.phase === 'rotation' && la.canAgree && this.rand() < 0.55) {
        action = { t: 'agree_end', agree: true };
      } else if (r.phase === 'rotation' && la.canAddChips && this.rand() < 0.3) {
        const { min, max } = la.canAddChips;
        action = { t: 'add_chips', betDelta: min + Math.floor(this.rand() * (max - min + 1)) };
      } else if (r.phase === 'rotation' && la.canAddCards && this.rand() < 0.5) {
        const n = Math.min(hand.length, 1 + Math.floor(this.rand() * 2));
        const range = addCardsBetRange({ betTotal: p.betTotal, chips: p.chips, battlefieldCount: p.battlefield.length }, n, r.maxBet);
        if (range) {
          const delta = Math.min(range.max, range.min + Math.floor(this.rand() * 2));
          action = { t: 'add_cards', cardIds: pick(n), betDelta: Math.max(0, delta) };
        }
      } else if (la.canPlay) {
        for (let n = 1; n <= hand.length; n++) {
          const lo = r.maxBet;
          const hi = Math.min(n, p.chips);
          if (hi >= lo) {
            const bet = lo + Math.floor(this.rand() * (hi - lo + 1));
            action = { t: 'play', cardIds: pick(n), bet };
            break;
          }
        }
      } else if (la.canFold) {
        action = { t: 'fold' };
      }
    }

    if (!action || seat < 0) return;
    this.apply(room, seat, action);
  }
}

export function addBot(room: Room, index: number): { ok: boolean; error?: string } {
  return addPlayer(room.state, `${index + 1}`, true);
}
