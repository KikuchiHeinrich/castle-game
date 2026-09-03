import type { RoomSettings } from '../../../shared/src/index';
import { PLAYER_CHARS, avatarSVG } from '../components/pixelAvatar';
import { createRoom, joinRoom } from '../net/socket';
import { getState, saveName } from '../store';
import { renderHandTypes, toggleDrawer } from '../components/drawer';
import { startTutorial } from '../components/tutorial';
import { sfx } from '../components/sfx';

export function mountLobby(root: HTMLElement) {
  const ui = getState().ui;
  const savedAvatar = localStorage.getItem('castle.avatar') ?? PLAYER_CHARS[0].id;

  root.innerHTML = `
    <div id="lobby">
      <div class="title">城 堡</div>
      <div class="subtitle">原创扑克筹码博弈 · 2~6 人在线对战 · 出牌即押注，杂牌会掺水</div>
      <div class="menu pixel-panel">
        <div class="row">
          <input id="name" type="text" maxlength="12" placeholder="你的昵称" value="${ui.name.replace(/"/g, '')}" style="width:180px" />
        </div>
        <div class="row" id="avatar-row">
          ${PLAYER_CHARS.map(
            (c) =>
              `<div class="avatar-pick ${c.id === savedAvatar ? 'sel' : ''}" data-id="${c.id}" title="${c.name}">${avatarSVG(c.id, 'happy', 2)}<span>${c.name}</span></div>`,
          ).join('')}
        </div>
        <div class="row">
          <button id="btn-create" class="primary">创建房间</button>
          <button id="btn-tutorial">🧙 新手教学局</button>
        </div>
        <div class="row">
          <input id="code" type="text" maxlength="4" placeholder="房间码" value="${ui.joinCode}" style="width:110px;text-transform:uppercase" />
          <button id="btn-join">加入</button>
        </div>
        <details id="cfg" style="width:100%">
          <summary style="cursor:pointer;color:var(--dim);font-size:12px">⚙ 自定义参数（可选）</summary>
          <div class="cfg-row"><span>回合限时</span>
            <select id="cfg-turn">
              <option value="30">30 秒</option>
              <option value="60" selected>60 秒</option>
              <option value="120">120 秒</option>
              <option value="300">5 分钟</option>
              <option value="0">不限时</option>
            </select>
          </div>
          <div class="cfg-row"><span>初始筹码</span>
            <select id="cfg-chips">
              <option value="50">50</option>
              <option value="100" selected>100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
          </div>
          <div class="cfg-row"><span>每回合底注</span>
            <select id="cfg-ante">
              <option value="1" selected>1</option>
              <option value="2">2</option>
              <option value="5">5</option>
            </select>
          </div>
          <div class="cfg-row"><span>筹码倍数</span>
            <select id="cfg-mult">
              <option value="1" selected>×1（牌数=上限）</option>
              <option value="2">×2（大注快攻）</option>
              <option value="3">×3（疯狂模式）</option>
            </select>
          </div>
          <div class="cfg-note">筹码倍数：押注上限 = 出战区牌数 × 倍数，越高越刺激；不限时建议熟悉规则后再用</div>
        </details>
      </div>
      <div class="row">
        <button id="btn-types" class="ghost">牌型总表</button>
      </div>
      <div class="loading">建议手机/电脑都开一个页面试玩 · 一台设备可开多个标签页扮演多人</div>
    </div>
    <div id="drawer"></div>
  `;

  renderHandTypes(root.querySelector('#drawer')!);

  let avatar = savedAvatar;
  root.querySelectorAll('.avatar-pick').forEach((el) => {
    el.addEventListener('click', () => {
      sfx.click();
      avatar = (el as HTMLElement).dataset.id!;
      root.querySelectorAll('.avatar-pick').forEach((x) => x.classList.remove('sel'));
      el.classList.add('sel');
    });
  });

  const nameEl = root.querySelector<HTMLInputElement>('#name')!;
  nameEl.addEventListener('input', () => saveName(nameEl.value.trim()));

  const codeEl = root.querySelector<HTMLInputElement>('#code')!;
  codeEl.addEventListener('input', () => {
    codeEl.value = codeEl.value.toUpperCase().replace(/[^2-9A-Z]/g, '');
  });

  const ensureName = (): string | null => {
    const name = nameEl.value.trim();
    if (!name) {
      nameEl.style.borderColor = 'var(--danger)';
      nameEl.focus();
      return null;
    }
    saveName(name);
    return name;
  };

  const collectSettings = (): Partial<RoomSettings> => {
    const turnSec = Number(root.querySelector<HTMLSelectElement>('#cfg-turn')!.value);
    const turnMs = turnSec * 1000;
    return {
      turnMs,
      defenseMs: turnMs === 0 ? 0 : Math.max(15_000, Math.round(turnMs / 2)),
      idleMs: turnMs === 0 ? 0 : Math.max(60_000, turnMs * 6),
      startChips: Number(root.querySelector<HTMLSelectElement>('#cfg-chips')!.value),
      ante: Number(root.querySelector<HTMLSelectElement>('#cfg-ante')!.value),
      chipMultiplier: Number(root.querySelector<HTMLSelectElement>('#cfg-mult')!.value),
    };
  };

  root.querySelector('#btn-create')!.addEventListener('click', () => {
    const name = ensureName();
    if (name) void createRoom(name, collectSettings(), avatar);
  });

  root.querySelector('#btn-tutorial')!.addEventListener('click', () => {
    const name = ensureName();
    if (!name) return;
    sfx.click();
    startTutorial();
    // 教学局：宽限时长 + 1 名教官机器人
    void createRoom(name, { turnMs: 120_000, defenseMs: 30_000, idleMs: 600_000, startChips: 100, ante: 1 }, avatar);
  });

  root.querySelector('#btn-join')!.addEventListener('click', () => {
    const name = ensureName();
    const code = codeEl.value.trim();
    if (!name) return;
    if (code.length !== 4) {
      codeEl.style.borderColor = 'var(--danger)';
      codeEl.focus();
      return;
    }
    sessionStorage.removeItem('castle.tutorial');
    void joinRoom(code, name, avatar);
  });

  root.querySelector('#btn-types')!.addEventListener('click', () => toggleDrawer());

  if (ui.joinCode) codeEl.focus();
  else nameEl.focus();

  codeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (root.querySelector('#btn-join') as HTMLButtonElement).click();
  });
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !codeEl.value) (root.querySelector('#btn-create') as HTMLButtonElement).click();
  });
}
