import { addBot, startGame } from '../net/socket';
import { renderHandTypes, toggleDrawer } from '../components/drawer';
import type { PlayerView } from '../../../shared/src/index';

export function mountRoom(root: HTMLElement, view: PlayerView) {
  const isHost = view.isHost;
  const canStart = isHost && view.players.filter((p) => p.status !== 'out').length >= 2;

  root.innerHTML = `
    <div id="room">
      <div class="title" style="font-size:40px">城 堡</div>
      <div class="subtitle">把房间码告诉朋友，输入即可加入</div>
      <div class="code-big" id="copy-code" title="点击复制">${view.code}</div>
      <div class="seat-grid">
        ${Array.from({ length: 6 }, (_, i) => {
          const p = view.players[i];
          if (!p) return `<div class="cell empty">空位</div>`;
          const marks = [
            p.isHost ? '<span class="host">房主</span>' : '',
            p.isBot ? '电脑' : '',
            p.seat === view.you.seat ? '（你）' : '',
          ].join(' ');
          return `<div class="cell">
            <div class="name">${p.name}</div>
            <div class="meta">${marks || '&nbsp;'}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="row" style="display:flex;gap:10px">
        ${isHost ? '<button id="btn-bot" class="ghost">+ 电脑玩家</button>' : ''}
        ${isHost ? `<button id="btn-start" class="primary" ${canStart ? '' : 'disabled'}>开始游戏</button>` : '<div class="loading">等待房主开始…</div>'}
        <button id="btn-types" class="ghost">牌型总表</button>
        <button id="btn-leave" class="ghost">离开</button>
      </div>
      <div class="loading">初始 100 筹码 · 底注 1 · 筹码归零淘汰</div>
    </div>
    <div id="drawer"></div>
  `;

  renderHandTypes(root.querySelector('#drawer')!);
  root.querySelector('#btn-types')!.addEventListener('click', () => toggleDrawer());

  root.querySelector('#copy-code')!.addEventListener('click', () => {
    void navigator.clipboard?.writeText(view.code);
    const el = root.querySelector('#copy-code')!;
    el.animate([{ filter: 'brightness(2)' }, { filter: 'brightness(1)' }], { duration: 400 });
  });

  root.querySelector('#btn-start')?.addEventListener('click', () => void startGame());
  root.querySelector('#btn-bot')?.addEventListener('click', () => void addBot());
  root.querySelector('#btn-leave')!.addEventListener('click', () => {
    sessionStorage.clear();
    location.href = '/';
  });
}
