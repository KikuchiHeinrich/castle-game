import { createServer as createHttpServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import path from 'node:path';
import express, { Express, Request, Response } from 'express';
import { Server as IOServer, Socket } from 'socket.io';
import {
  GameAction,
  GameEvent,
  RoomSettings,
  addPlayer,
  buildPlayerView,
  startGame,
  applyAction,
  rematch,
  removePlayer,
  tick,
  randomSeed,
} from '../../shared/src/index';
import { Room, RoomManager, SessionStore } from './rooms';
import { BotDriver, addBot } from './bots';

const SWEEP_MS = 60_000;

export interface ServerHandle {
  app: Express;
  httpServer: HttpServer;
  io: IOServer;
  rooms: RoomManager;
  sessions: SessionStore;
  bots: BotDriver;
  listen(port: number): Promise<void>;
  close(): Promise<void>;
}

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; error: string }) => void;

export function buildServer(opts: { clientDist?: string } = {}): ServerHandle {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new IOServer(httpServer, {
    pingInterval: 20_000,
    pingTimeout: 25_000,
    perMessageDeflate: false,
  });
  const rooms = new RoomManager();
  const sessions = new SessionStore();

  // ---- 静态托管 + 健康检查（生产） ----
  app.get('/healthz', (_req: Request, res: Response) => res.status(200).send('ok'));
  if (opts.clientDist) {
    app.use(express.static(opts.clientDist));
    app.use((req: Request, res: Response, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/socket.io')) return next();
      res.sendFile(path.join(opts.clientDist!, 'index.html'));
    });
  }

  // ---- 广播与提交 ----

  function broadcastState(room: Room) {
    for (const [socketId, seat] of room.socketSeats) {
      const view = buildPlayerView(room.state, seat);
      if (view) io.in(socketId).emit('room:state', view);
    }
  }

  function commit(room: Room, events: GameEvent[]) {
    const base = room.state.eventSeq - events.length;
    const tagged = events.map((ev, i) => ({ seq: base + 1 + i, ev }));
    room.eventLog.push(...tagged);
    if (room.eventLog.length > 200) room.eventLog.splice(0, room.eventLog.length - 200);
    for (const t of tagged) io.in(room.code).emit('game:event', t);
    broadcastState(room);
    schedule(room);
    bots.kick(room);
  }

  function applyAndCommit(room: Room, seat: number, action: GameAction, ack?: Ack) {
    const res = applyAction(room.state, seat, action, Date.now());
    if (!res.ok) {
      ack?.({ ok: false, error: res.error });
      return;
    }
    room.state = res.state;
    ack?.({ ok: true });
    commit(room, res.events);
  }

  // ---- 阶段超时 ----

  function schedule(room: Room) {
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    const s = room.state;
    if (s.phase !== 'playing' || !s.round) return;
    const delay = Math.min(2 ** 31 - 5, Math.max(300, s.round.deadlineAt - Date.now())); // 不限时(~Infinity)时挂起到上限
    room.timer = setTimeout(() => {
      room.timer = null;
      if (rooms.get(room.code) !== room) return;
      const res = tick(room.state, Date.now());
      room.state = res.state;
      commit(room, res.events);
    }, delay);
  }

  // ---- 机器人 ----

  const bots = new BotDriver((room, seat, action) => applyAndCommit(room, seat, action));

  // ---- 连接管理 ----

  function bindSocket(room: Room, socket: Socket, seat: number, ack?: Ack) {
    // 同一座位的旧连接（旧标签页）先解绑，保证一条连接一个身份
    for (const [sid, st] of [...room.socketSeats]) {
      if (st === seat && sid !== socket.id) {
        room.socketSeats.delete(sid);
        room.seatSockets.get(seat)?.delete(sid);
      }
    }
    room.socketSeats.set(socket.id, seat);
    if (!room.seatSockets.has(seat)) room.seatSockets.set(seat, new Set());
    room.seatSockets.get(seat)!.add(socket.id);
    void socket.join(room.code);
    const p = room.state.players[seat];
    if (p) {
      p.connected = true;
      p.away = false;
    }
    const token = sessions.issue(room.code, seat);
    const recentEvents = room.eventLog.slice(-40).map((t) => t.ev);
    const view = buildPlayerView(room.state, seat, recentEvents);
    ack?.({ ok: true, roomCode: room.code, seat, token, view });
    broadcastState(room);
    schedule(room);
  }

  function unbindSocket(room: Room, socket: Socket) {
    const seat = room.socketSeats.get(socket.id);
    if (seat === undefined) return;
    room.socketSeats.delete(socket.id);
    room.seatSockets.get(seat)?.delete(socket.id);
    const p = room.state.players[seat];
    if (!p) return;
    if ((room.seatSockets.get(seat)?.size ?? 0) === 0) {
      p.connected = false;
      if (room.state.phase === 'lobby') {
        // 大厅离座：座位号不变（置空），该座位会话作废
        removePlayer(room.state, seat);
        sessions.dropSeat(room.code, seat);
      }
    }
  }

  io.on('connection', (socket: Socket) => {
    let joinedRoom: Room | null = null;

    const err = (ack: Ack | undefined, error: string) => ack?.({ ok: false, error });

    socket.on('room:create', ({ name, settings, avatar }: { name: string; settings?: Partial<RoomSettings>; avatar?: string }, ack: Ack) => {
      const room = rooms.create(settings);
      const r = addPlayer(room.state, String(name ?? ''), false, String(avatar ?? 'shirley'));
      if (!r.ok) {
        rooms.destroy(room.code);
        return err(ack, r.error);
      }
      joinedRoom = room;
      bindSocket(room, socket, r.seat, ack);
    });

    socket.on('room:join', ({ roomCode, name, avatar }: { roomCode: string; name: string; avatar?: string }, ack: Ack) => {
      const room = rooms.get(String(roomCode ?? ''));
      if (!room) return err(ack, '房间不存在，检查一下房间码');
      if (room.state.phase !== 'lobby') return err(ack, '对局已开始，无法加入');
      const r = addPlayer(room.state, String(name ?? ''), false, String(avatar ?? 'shirley'));
      if (!r.ok) return err(ack, r.error);
      joinedRoom = room;
      bindSocket(room, socket, r.seat, ack);
    });

    socket.on('room:rejoin', ({ roomCode, token }: { roomCode: string; token: string }, ack: Ack) => {
      const room = rooms.get(String(roomCode ?? ''));
      const sess = sessions.lookup(String(token ?? ''));
      if (!room) return err(ack, '房间已解散');
      if (!sess || sess.code !== room.code) return err(ack, '会话已失效，请重新加入');
      const p = room.state.players[sess.seat];
      if (!p) return err(ack, '座位不存在');
      joinedRoom = room;
      bindSocket(room, socket, sess.seat, ack);
    });

    socket.on('room:add_bot', (_payload: unknown, ack: Ack) => {
      const seat = joinedRoom?.socketSeats.get(socket.id);
      const room = joinedRoom;
      if (!room || seat === undefined) return err(ack, '未加入房间');
      if (room.state.players[seat]?.isHost !== true) return err(ack, '只有房主能添加电脑玩家');
      if (room.state.phase !== 'lobby') return err(ack, '对局已开始');
      const r = addBot(room, room.state.players.filter((p) => p?.isBot).length);
      if (!r.ok) return err(ack, r.error!);
      ack?.({ ok: true });
      broadcastState(room);
    });

    socket.on('game:start', (_payload: unknown, ack: Ack) => {
      const room = joinedRoom;
      const seat = room?.socketSeats.get(socket.id);
      if (!room || seat === undefined) return err(ack, '未加入房间');
      const seed = randomSeed();
      const res = startGame(room.state, seat, seed, Date.now());
      if (!res.ok) return err(ack, res.error);
      ack?.({ ok: true });
      commit(room, res.events);
    });

    socket.on('game:action', ({ action }: { action: GameAction }, ack: Ack) => {
      const room = joinedRoom;
      const seat = room?.socketSeats.get(socket.id);
      if (!room || seat === undefined) return err(ack, '未加入房间');
      applyAndCommit(room, seat, action, ack);
    });

    socket.on('game:rematch', (_payload: unknown, ack: Ack) => {
      const room = joinedRoom;
      const seat = room?.socketSeats.get(socket.id);
      if (!room || seat === undefined) return err(ack, '未加入房间');
      const r = rematch(room.state, seat);
      if (!r.ok) return err(ack, r.error!);
      ack?.({ ok: true });
      broadcastState(room);
      bots.forget(room.code);
    });

    socket.on('disconnect', () => {
      if (joinedRoom) {
        unbindSocket(joinedRoom, socket);
        broadcastState(joinedRoom);
      }
    });
  });

  const sweepTimer = setInterval(() => rooms.sweep(Date.now()), SWEEP_MS);
  sweepTimer.unref?.();

  return {
    app,
    httpServer,
    io,
    rooms,
    sessions,
    bots,
    listen(port: number) {
      return new Promise((resolve) => {
        httpServer.listen(port, () => resolve());
      });
    },
    close() {
      clearInterval(sweepTimer);
      bots.dispose();
      for (const room of rooms.all()) {
        if (room.timer) clearTimeout(room.timer);
      }
      return new Promise((resolve) => io.close(() => resolve()));
    },
  };
}
