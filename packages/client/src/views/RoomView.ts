import { addBot, startGame } from '../net/socket';
import { renderHandTypes, toggleDrawer } from '../components/drawer';
import { tutorialActive } from '../components/tutorial';
import { avatarSVG } from '../components/pixelAvatar';
import type { PlayerView } from '../../../shared/src/index';

export function mountRoom(root: HTMLElement, view: PlayerView) {
  const isHost = view.isHost;
  // 教学局：房主自动加教官机器人并开局
  if (tutorialActive() && isHost && view.players.length === 1) {
    void (async () => {
      await addBot();
      await startGame();
    })();
  }
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
            <div class="name">${p.isBot ? avatarSVG(p.avatar, 'happy', 1.5) : ''}${p.name}</div>
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
      <div class="loading" id="room-settings"></div>
    </div>
    <div id="drawer"></div>
  `;

  renderHandTypes(root.querySelector('#drawer')!);
  // 本局实际生效的参数（原来这里写死了"初始 100 筹码 · 底注 1"）
  const sec = (ms: number) => (ms === 0 ? '不限时' : `${Math.round(ms / 1000)}s`);
  const st = view.settings;
  root.querySelector('#room-settings')!.innerHTML =
    `初始 <b>${st.startChips}</b> 筹码 · 底注 <b>${st.ante}</b> · 筹码倍数 <b>×${st.chipMultiplier}</b>` +
    `<br/>赛制：回合上限 <b>${st.maxRounds > 0 ? st.maxRounds + ' 回合' : '无上限'}</b> · ` +
    `底注递增 <b>${st.anteRamp > 0 ? `每 ${st.anteRamp} 回合 +1` : '不递增'}</b>` +
    `<br/>限时：防守宣言 <b>${sec(st.defenseMs)}</b> · 每人行动 <b>${sec(st.turnMs)}</b> · ` +
    `摊牌展示 <b>${st.settlementMs === 0 ? '不等待' : sec(st.settlementMs)}</b> · 全桌兜底 <b>${sec(st.idleMs)}</b>` +
    `<br/>筹码归零淘汰，最后存活者胜`;
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
