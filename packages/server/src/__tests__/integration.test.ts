import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import type { GameAction } from '../../../shared/src/index';
import type { PlayerView } from '../../../shared/src/index';
import { buildServer, type ServerHandle } from '../host';

function connect(port: number): Promise<ClientSocket> {
  const c = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
  return new Promise((resolve, reject) => {
    c.on('connect', () => resolve(c));
    c.on('connect_error', reject);
  });
}

function emitAck<T = Record<string, unknown>>(c: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => c.emit(event, payload, resolve));
}

function waitFor<T>(fn: () => T | undefined | null, timeoutMs = 8000, stepMs = 50): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const h = setInterval(() => {
      const v = fn();
      if (v !== undefined && v !== null) {
        clearInterval(h);
        resolve(v);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(h);
        reject(new Error('waitFor timeout'));
      }
    }, stepMs);
  });
}

describe('服务器集成', () => {
  let server: ServerHandle;
  let port: number;
  let c0: ClientSocket;
  let c1: ClientSocket;
  let roomCode: string;
  let token1: string;
  let seat0 = 0;
  let seat1 = 0;

  // c0 收到的全部 payload（隐私断言用）
  const c0Payloads: unknown[] = [];

  beforeAll(async () => {
    server = buildServer({});
    await server.listen(0);
    port = (server.httpServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    await server.close();
  });

  it('建房、加入、开局', async () => {
    c0 = await connect(port);
    c0.onAny((event, ...args) => {
      if (event === 'room:state' || event === 'game:event') c0Payloads.push(args[0]);
    });
    const created = await emitAck<{ ok: boolean; roomCode: string; seat: number; token: string }>(c0, 'room:create', { name: '甲' });
    expect(created.ok).toBe(true);
    roomCode = created.roomCode;
    seat0 = created.seat;
    expect(seat0).toBe(0);

    c1 = await connect(port);
    const joined = await emitAck<{ ok: boolean; seat: number; token: string }>(c1, 'room:join', { roomCode, name: '乙' });
    expect(joined.ok).toBe(true);
    seat1 = joined.seat;
    token1 = joined.token;

    const started = await emitAck<{ ok: boolean }>(c0, 'game:start', {});
    expect(started.ok).toBe(true);
    await waitFor(() => (server.rooms.get(roomCode)!.state.phase === 'playing' ? true : undefined));
    const state = server.rooms.get(roomCode)!.state;
    expect(state.players.filter((p) => p !== null)).toHaveLength(2);
    expect(state.round!.phase).toBe('defense_window');
  });

  it('完整打完一回合并进入摊牌', async () => {
    const room = () => server.rooms.get(roomCode)!;
    const state = () => room().state;
    const cOf = (seat: number) => (seat === seat0 ? c0 : c1);
    const act = async (seat: number, action: GameAction) => {
      const res = await emitAck<{ ok: boolean; error?: string }>(cOf(seat), 'game:action', { action });
      if (!res.ok) throw new Error(`seat${seat} ${action.t}: ${res.error}`);
    };
    const passAll = async () => {
      for (const p of state().players) {
        if (p && p.status === 'active' && !p.defensePassed) await act(p.seat, { t: 'pass_defense' });
      }
    };

    await passAll();
    await waitFor(() => (state().round!.phase === 'opening' ? true : undefined));

    // 开局者出 2 张押 1
    const opener = state().round!.openerSeat;
    const hand = state().secret!.hands[opener];
    await act(opener, { t: 'play', cardIds: hand.slice(0, 2).map((c) => c.id), bet: 1 });
    expect(state().round!.phase).toBe('rotation');

    // 另一位跟牌
    const voter = state().players.find((p) => p!.status === 'active' && p!.battlefield.length === 0)!.seat;
    const hand2 = state().secret!.hands[voter];
    await act(voter, { t: 'play', cardIds: hand2.slice(0, 2).map((c) => c.id), bet: 1 });

    // 双方按轮转顺序同意 → 摊牌
    for (let i = 0; i < 2; i++) {
      const turn = state().round!.turnSeat;
      await act(turn, { t: 'agree_end', agree: true });
    }
    await waitFor(() => (state().round!.phase === 'settlement' ? true : undefined));
    const result = state().round!.result!;
    expect(result.voidRound).toBe(false);
    expect(result.entries).toHaveLength(2);
    expect(result.winnerSeat).not.toBeNull();
    expect(state().round!.pot).toBe(0);
    expect(state().round!.deadlineAt).toBe(0);
    expect(room().timer).toBeNull();
  });

  it('结算不挂自动计时，断线重连保留本人的准备快照', async () => {
    const a = await connect(port);
    const b = await connect(port);
    const c = await connect(port);
    const clients = new Map<number, ClientSocket>();

    const created = await emitAck<{ ok: boolean; roomCode: string; seat: number; token: string }>(a, 'room:create', { name: '准备甲' });
    expect(created.ok).toBe(true);
    const code = created.roomCode;
    clients.set(created.seat, a);
    const joinedB = await emitAck<{ ok: boolean; seat: number; token: string }>(b, 'room:join', { roomCode: code, name: '准备乙' });
    const joinedC = await emitAck<{ ok: boolean; seat: number; token: string }>(c, 'room:join', { roomCode: code, name: '准备丙' });
    expect(joinedB.ok).toBe(true);
    expect(joinedC.ok).toBe(true);
    clients.set(joinedB.seat, b);
    clients.set(joinedC.seat, c);
    expect((await emitAck<{ ok: boolean }>(a, 'game:start', {})).ok).toBe(true);

    const room = () => server.rooms.get(code)!;
    const act = async (seat: number, action: GameAction) => {
      const res = await emitAck<{ ok: boolean; error?: string }>(clients.get(seat)!, 'game:action', { action });
      if (!res.ok) throw new Error(`seat${seat} ${action.t}: ${res.error}`);
    };
    for (const p of room().state.players) {
      if (p?.status === 'active' && !p.defensePassed) await act(p.seat, { t: 'pass_defense' });
    }
    for (let i = 0; i < 3; i++) {
      const seat = room().state.round!.turnSeat;
      const hand = room().state.secret!.hands[seat];
      await act(seat, { t: 'play', cardIds: [hand[0].id], bet: 0 });
    }
    for (let i = 0; i < 3; i++) {
      await act(room().state.round!.turnSeat, { t: 'agree_end', agree: true });
    }
    expect(room().state.round!.phase).toBe('settlement');
    expect(room().state.round!.deadlineAt).toBe(0);
    expect(room().timer).toBeNull();

    const readySeat = joinedB.seat;
    await act(readySeat, { t: 'ready_next', agree: true });
    expect(room().state.players[readySeat]!.nextReady).toBe(true);
    expect(room().state.round!.phase).toBe('settlement');

    b.disconnect();
    await waitFor(() => (room().state.players[readySeat]!.connected === false ? true : undefined));
    const b2 = await connect(port);
    const rejoin = await emitAck<{ ok: boolean; view: PlayerView }>(b2, 'room:rejoin', { roomCode: code, token: joinedB.token });
    expect(rejoin.ok).toBe(true);
    expect(rejoin.view.you.nextReady).toBe(true);
    expect(rejoin.view.you.legalActions.canReadyNext).toBe(true);
    expect(rejoin.view.players.find((p) => p.seat === readySeat)!.nextReady).toBe(true);
    expect(rejoin.view.roundPhase).toBe('settlement');
    expect(rejoin.view.result).not.toBeNull();

    b2.disconnect();
    a.disconnect();
    c.disconnect();
  });

  it('隐私：c0 的推送里从不含对手的私有手牌', async () => {
    const room = server.rooms.get(roomCode)!;
    const opponent = seat0 === 0 ? seat1 : seat0;
    // 对手"未公开"的手牌 = 当前手牌 - 曾亮出的最大牌
    const revealedIds = new Set(room.state.players[opponent]!.playSegments.flatMap((s0) => (s0.top ? [s0.top.id] : [])));
    const privateIds = room.state.secret!.hands[opponent].map((c) => c.id).filter((id) => !revealedIds.has(id));
    expect(privateIds.length).toBeGreaterThan(0);
    const stream = JSON.stringify(c0Payloads);
    for (const id of privateIds) {
      expect(stream.includes(id)).toBe(false);
    }
    // 自己的手牌在（自己的视图里可见）
    const ownIds = room.state.secret!.hands[seat0].map((c) => c.id);
    expect(ownIds.some((id) => stream.includes(id))).toBe(true);
  });

  it('断线重连：手牌与状态无缝恢复', async () => {
    const before = server.rooms.get(roomCode)!.state.secret!.hands[seat1].map((c) => c.id);
    const phaseBefore = server.rooms.get(roomCode)!.state.phase;

    c1.disconnect();
    await waitFor(() => (server.rooms.get(roomCode)!.state.players[seat1]!.connected === false ? true : undefined));

    const c1b = await connect(port);
    const res = await emitAck<{ ok: boolean; seat: number; view: PlayerView }>(c1b, 'room:rejoin', { roomCode, token: token1 });
    expect(res.ok).toBe(true);
    expect(res.seat).toBe(seat1);
    expect(res.view.you.hand.map((c) => c.id)).toEqual(before);
    expect(res.view.phase).toBe(phaseBefore);
    expect(res.view.recentEvents.length).toBeGreaterThan(0);
    // 服务器侧座位恢复在线
    await waitFor(() => (server.rooms.get(roomCode)!.state.players[seat1]!.connected === true ? true : undefined));
    c1b.disconnect();
  });

  it('非法操作被拒绝（中文错误）', async () => {
    const res = await emitAck<{ ok: boolean; error: string }>(c0, 'game:action', { action: { t: 'fold' } });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
