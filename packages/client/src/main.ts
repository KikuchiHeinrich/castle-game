import './styles/base.css';
import './styles/card.css';
import './styles/sprite.css';
import './styles/screens.css';
import './styles/table.css';

import { connect, savedSession } from './net/socket';
import { getState, setScreen, subscribe, patchUI } from './store';
import { mountLobby } from './views/LobbyView';
import { mountRoom } from './views/RoomView';
import { mountTable, render, unmountTable } from './views/TableView';
import { resetQueue } from './anim';

const app = document.getElementById('app')!;
let currentScreen = '';
let roomSig = '';

/** 房间页只在座位名单/房主/电脑变化时重挂，避免抽屉与滚动状态丢失 */
function roomSignature(view: NonNullable<ReturnType<typeof getState>['view']>): string {
  return view.players.map((p) => `${p.seat}:${p.name}:${p.isHost}:${p.isBot}:${p.avatar}`).join('|');
}

function showToast() {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  const t = getState().ui.toast;
  if (!t) {
    el.classList.remove('show');
    return;
  }
  el.textContent = t.msg;
  el.className = `show ${t.kind}`;
}

function route() {
  const st = getState();
  const view = st.view;
  const sess = savedSession();

  let screen: 'lobby' | 'room' | 'table' = 'lobby';
  if (view && sess) {
    if (view.phase === 'lobby') screen = 'room';
    else screen = 'table';
  }

  if (screen !== currentScreen) {
    const leavingTable = currentScreen === 'table';
    // 场景切换：离开牌桌才清空演出；进入牌桌时保留已暂存的 live 事件，
    // 这样开局发牌不会因为 room → table 的挂载而丢失。
    if (leavingTable) unmountTable();
    currentScreen = screen;
    if (screen !== 'table' && !leavingTable) resetQueue();
    patchUI({ selected: [], bet: null, escrow: null });
    if (screen === 'lobby') {
      setScreen('lobby');
      mountLobby(app);
    } else if (screen === 'room') {
      setScreen('room');
      roomSig = view ? roomSignature(view) : '';
      if (view) mountRoom(app, view); // 首次切到房间页立即挂载，不等下一帧
    } else {
      setScreen('table');
      mountTable(app);
      render();
    }
    return;
  }

  if (screen === 'room' && view) {
    // 只有座位名单变化才重挂房间页（避免抽屉状态/滚动丢失）
    const sig = roomSignature(view);
    if (sig !== roomSig) {
      roomSig = sig;
      mountRoom(app, view);
    }
    return;
  }

  if (screen === 'table') {
    render();
  }
}

subscribe(() => {
  showToast();
  route();
});

connect(() => {
  // 重连成功后触发一次重渲染
  resetQueue();
  currentScreen = '';
  route();
});

route();
