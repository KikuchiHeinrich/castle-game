import './styles/base.css';
import './styles/card.css';
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
    // 场景切换：重挂载（freshIds 保留：首轮发牌与进入牌桌同时发生，setView 自会维护）
    if (currentScreen === 'table') unmountTable();
    currentScreen = screen;
    resetQueue();
    patchUI({ selected: [], bet: null });
    if (screen === 'lobby') {
      setScreen('lobby');
      mountLobby(app);
    } else if (screen === 'room') {
      setScreen('room');
      roomSig = '';
    } else {
      setScreen('table');
      mountTable(app);
      render();
    }
    return;
  }

  if (screen === 'room' && view) {
    // 只有座位名单变化才重挂房间页（避免抽屉状态/滚动丢失）
    const sig = view.players.map((p) => `${p.seat}:${p.name}:${p.isHost}:${p.isBot}`).join('|');
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
