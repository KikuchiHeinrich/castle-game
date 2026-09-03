import { createRoom, joinRoom } from '../net/socket';
import { getState, saveName } from '../store';
import { renderHandTypes, toggleDrawer } from '../components/drawer';

export function mountLobby(root: HTMLElement) {
  const ui = getState().ui;
  root.innerHTML = `
    <div id="lobby">
      <div class="title">城 堡</div>
      <div class="subtitle">原创扑克筹码博弈 · 支持 2~6 人在线对战 · 出牌即押注，杂牌会掺水</div>
      <div class="menu pixel-panel">
        <div class="row">
          <input id="name" type="text" maxlength="12" placeholder="你的昵称" value="${ui.name.replace(/"/g, '')}" style="width:180px" />
        </div>
        <div class="row">
          <button id="btn-create" class="primary">创建房间</button>
        </div>
        <div class="row">
          <input id="code" type="text" maxlength="4" placeholder="房间码" value="${ui.joinCode}" style="width:110px;text-transform:uppercase" />
          <button id="btn-join">加入</button>
        </div>
      </div>
      <div class="row">
        <button id="btn-types" class="ghost">牌型总表</button>
      </div>
      <div class="loading">建议手机/电脑都开一个页面试玩 · 一台设备可开多个标签页扮演多人</div>
    </div>
    <div id="drawer"></div>
  `;

  renderHandTypes(root.querySelector('#drawer')!);

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

  root.querySelector('#btn-create')!.addEventListener('click', () => {
    const name = ensureName();
    if (name) void createRoom(name);
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
    void joinRoom(code, name);
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
