import { io, Socket } from 'socket.io-client';
import type { GameAction, GameEvent, PlayerView, RoomSettings } from '../../../shared/src/index';
import { getState, setScreen, setView, toast } from '../store';
import { enqueueEvent } from '../anim';

export interface AckResult {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

let socket: Socket | null = null;

const SS_TOKEN = 'castle.token';
const SS_ROOM = 'castle.room';

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
    const sess = savedSession();
    if (sess) {
      socket!.emit('room:rejoin', { roomCode: sess.roomCode, token: sess.token }, (res: AckResult) => {
        if (res.ok) {
          setView(res.view as PlayerView);
          onView();
        } else {
          clearSession();
        }
      });
    }
  });

  socket.on('disconnect', () => toast('连接断开，重连中…'));

  socket.on('room:state', (view: PlayerView) => {
    setView(view);
  });

  socket.on('game:event', (tagged: { seq: number; ev: GameEvent }) => {
    const st = getState();
    if (tagged.seq <= st.lastEventSeq) return; // 过期事件
    const gap = tagged.seq > st.lastEventSeq + 1;
    st.lastEventSeq = tagged.seq;
    enqueueEvent(tagged.ev, gap);
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
