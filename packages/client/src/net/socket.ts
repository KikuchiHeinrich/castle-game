import { io, Socket } from 'socket.io-client';
import type { GameAction, GameEvent, PlayerView, RoomSettings } from '../../../shared/src/index';
import { getState, patchUI, setScreen, setView, toast } from '../store';
import { enqueueEvent, resetQueue } from '../anim';
import { planViewCursor, type ViewApplyMode } from './cursor';

export interface AckResult {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

let socket: Socket | null = null;
/**
 * Live events are held until the room snapshot that belongs to them arrives.
 * The server commits events first and the snapshot second; resolving hand cards,
 * showdown result or readiness before that snapshot makes the presentation read
 * the previous round (and loses the initial deal while the table is still mounting).
 */
let pendingEvents: { seq: number; ev: GameEvent; gap: boolean }[] = [];

const SS_TOKEN = 'castle.token';
const SS_ROOM = 'castle.room';

/**
 * 应用权威快照。
 * 服务端 commit() 先广播 game:event 再广播 room:state，所以正常广播的快照里 eventSeq
 * 与本地游标一致，这时不能重置演出；只有换房、序号回退、回合回退（重开对局）与重连
 * 基线才接管游标。判定集中在 net/cursor.ts，便于回归测试。
 * 服务端随快照补发的 recentEvents 不在这里补播：重连只按最新快照落地，
 * 不重放历史回合的人物动作与飞牌。
 */
function applyView(view: PlayerView, mode: ViewApplyMode = 'broadcast') {
  const st = getState();
  const plan = planViewCursor(st.view, view, st.lastEventSeq, mode);
  if (plan.reset) {
    st.lastEventSeq = plan.lastEventSeq;
    resetQueue(plan.reason ?? 'snapshot');
  }
  setView(view);
}

export function savedSession(): { token: string; roomCode: string } | null {
  const token = sessionStorage.getItem(SS_TOKEN);
  const roomCode = sessionStorage.getItem(SS_ROOM);
  return token && roomCode ? { token, roomCode } : null;
}

export function saveSession(roomCode: string, token: string) {
  sessionStorage.setItem(SS_TOKEN, token);
  sessionStorage.setItem(SS_ROOM, roomCode);
}

export function clearSession() {
  sessionStorage.removeItem(SS_TOKEN);
  sessionStorage.removeItem(SS_ROOM);
}

export function connect(onView: () => void): Socket {
  if (socket) return socket;
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    patchUI({ connected: true });
    const sess = savedSession();
    if (!sess) return;
    socket!.emit('room:rejoin', { roomCode: sess.roomCode, token: sess.token }, (res: AckResult) => {
      if (!res.ok) {
        // 只有仍是同一个会话时才清；迟到的失败回包不能注销新房间的登录态
        const now = savedSession();
        if (now?.roomCode === sess.roomCode && now.token === sess.token) clearSession();
        return;
      }
      const view = res.view as PlayerView | undefined;
      const now = savedSession();
      // 防串房：回包必须仍对应当前会话与同一个房间，否则丢弃（不能把旧房间状态写进新局）
      if (!view || !now || now.roomCode !== sess.roomCode || view.code !== sess.roomCode) return;
      // A reconnect baseline never replays history. Drop any live events that were
      // waiting for a snapshot from the connection that went away.
      pendingEvents = [];
      // 重连按最新快照落地一次：游标明确设到快照事件序号，后续真实动作才不会被判成缺口
      applyView(view, 'rejoin');
      onView();
    });
  });

  socket.on('disconnect', () => {
    pendingEvents = [];
    patchUI({ connected: false });
    toast('连接断开，重连中…');
  });

  socket.on('room:state', (view: PlayerView) => {
    const batch = pendingEvents;
    pendingEvents = [];
    applyView(view);
    const gap = batch.some((item) => item.gap);
    if (gap) {
      // One missing event makes a sequential story incomplete. Keep the latest
      // snapshot as the source of truth and present its completed state directly.
      resetQueue('gap');
      return;
    }
    for (const item of batch) enqueueEvent(item.ev);
  });

  socket.on('game:event', (tagged: { seq: number; ev: GameEvent }) => {
    const st = getState();
    if (tagged.seq <= st.lastEventSeq) return; // 过期事件
    const gap = tagged.seq > st.lastEventSeq + 1;
    st.lastEventSeq = tagged.seq;
    pendingEvents.push({ seq: tagged.seq, ev: tagged.ev, gap });
  });

  return socket;
}

/** 带超时的 ack 请求 */
export function request<T extends AckResult>(event: string, payload: unknown = {}, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve) => {
    const s = connect(() => {});
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve({ ok: false, error: '服务器没有响应，稍后再试' } as T);
      }
    }, timeoutMs);
    s.emit(event, payload, (res: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(res);
    });
  });
}

// ---- 高层动作 ----

export async function createRoom(name: string, settings?: Partial<RoomSettings>, avatar?: string) {
  const res = await request<{ ok: boolean; error?: string; roomCode: string; seat: number; token: string }>('room:create', { name, settings, avatar });
  if (!res.ok) return toast(res.error ?? '创建失败');
  saveSession(res.roomCode, res.token);
  setScreen('room');
}

export async function joinRoom(roomCode: string, name: string, avatar?: string) {
  const res = await request<{ ok: boolean; error?: string; roomCode: string; seat: number; token: string }>('room:join', { roomCode, name, avatar });
  if (!res.ok) return toast(res.error ?? '加入失败');
  saveSession(res.roomCode, res.token);
  setScreen('room');
}

export async function gameAction(action: GameAction) {
  const res = await request('game:action', { action });
  if (!res.ok) toast(res.error!);
  return res.ok;
}

export async function startGame() {
  const res = await request('game:start');
  if (!res.ok) toast(res.error!);
}

export async function addBot() {
  const res = await request('room:add_bot');
  if (!res.ok) toast(res.error!);
}

export async function rematch() {
  const res = await request('game:rematch');
  if (!res.ok) toast(res.error!);
}
