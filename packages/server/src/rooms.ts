import { randomBytes } from 'node:crypto';
import { GameEvent, GameState, createGameState } from '../../shared/src/index';

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 无易混淆字符

export interface TaggedEvent {
  seq: number;
  ev: GameEvent;
}

export interface Room {
  code: string;
  state: GameState;
  socketSeats: Map<string, number>; // socketId -> seat
  seatSockets: Map<number, Set<string>>; // seat -> socketIds
  eventLog: TaggedEvent[]; // 重连补发用
  timer: NodeJS.Timeout | null; // 阶段超时
  emptySince: number | null;
  createdAt: number;
}

function makeCode(existing: Set<string>): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomBytes(1)[0] % CODE_ALPHABET.length];
    if (!existing.has(code)) return code;
  }
}

export class RoomManager {
  private map = new Map<string, Room>();

  create(now = Date.now()): Room {
    const room: Room = {
      code: makeCode(new Set(this.map.keys())),
      state: createGameState(''),
      socketSeats: new Map(),
      seatSockets: new Map(),
      eventLog: [],
      timer: null,
      emptySince: now,
      createdAt: now,
    };
    room.state.code = room.code;
    this.map.set(room.code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.map.get(String(code || '').toUpperCase());
  }

  all(): Room[] {
    return [...this.map.values()];
  }

  destroy(code: string) {
    const room = this.map.get(code);
    if (!room) return;
    if (room.timer) clearTimeout(room.timer);
    this.map.delete(code);
  }

  /** 每 60s 调一次：清掉空置超 10 分钟的房间，防内存泄漏 */
  sweep(now = Date.now()) {
    for (const room of this.all()) {
      if (room.socketSeats.size === 0) {
        if (room.emptySince === null) room.emptySince = now;
        if (now - room.emptySince > 10 * 60_000) this.destroy(room.code);
      } else {
        room.emptySince = null;
      }
    }
  }
}

export interface Session {
  token: string;
  code: string;
  seat: number;
}

export class SessionStore {
  private map = new Map<string, Session>();

  issue(code: string, seat: number): string {
    const token = randomBytes(16).toString('hex');
    this.map.set(token, { token, code, seat });
    return token;
  }

  lookup(token: string): Session | undefined {
    return this.map.get(String(token || ''));
  }

  dropSeat(code: string, seat: number) {
    for (const [token, s] of this.map) {
      if (s.code === code && s.seat === seat) this.map.delete(token);
    }
  }
}
