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
          <div class="cfg-row"><span>初始筹码</span>
            <span class="cfg-num"><input id="cfg-chips" type="number" min="10" max="100000" step="10" value="100" /><em>每人</em></span>
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
          <div class="cfg-row"><span>回合上限<em>到点筹码最多者胜</em></span>
            <span class="cfg-num"><input id="cfg-maxrounds" type="number" min="0" max="999" step="5" value="30" /><em>回合（0=无上限）</em></span>
          </div>
          <div class="cfg-row"><span>底注递增<em>加速收场</em></span>
            <span class="cfg-num"><input id="cfg-anteramp" type="number" min="0" max="50" step="1" value="3" /><em>回合 +1（0=不递增）</em></span>
          </div>
          <div class="cfg-group">各阶段限时<em>（填 0 = 不限时；留空或超范围会夹到最近的有效值）</em></div>
          <div class="cfg-row"><span>① 防守宣言</span>
            <span class="cfg-num"><input id="cfg-defense" type="number" min="0" max="600" step="5" value="20" /><em>秒</em></span>
          </div>
          <div class="cfg-row"><span>② 每人行动<em>宣战 / 跟牌</em></span>
            <span class="cfg-num"><input id="cfg-turn" type="number" min="0" max="1200" step="10" value="60" /><em>秒</em></span>
          </div>
          <div class="cfg-row"><span>③ 摊牌展示</span>
            <span class="cfg-num"><input id="cfg-settlement" type="number" min="0" max="60" step="1" value="5" /><em>秒</em></span>
          </div>
          <div class="cfg-row"><span>全桌无动作兜底</span>
            <span class="cfg-num"><input id="cfg-idle" type="number" min="0" max="3600" step="30" value="180" /><em>秒</em></span>
          </div>
          <div class="cfg-note">
            筹码倍数：押注上限 = 出战区牌数 × 倍数，越高越刺激。<br/>
            摊牌展示填 0 表示不等待、结算完立刻开下一回合。填 0 的次数越多，越需要大家自觉按时操作。<br/>
            关于「打不完」：底注是全额返池的，没有抽水，所以筹码本身是无漂移的随机游走——
            光靠淘汰可能要几百回合。回合上限是硬保证，底注递增则让领先者更早拉开差距。
          </div>
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

  /**
   * 读一个数字输入框并归一化，规则与服务端 normalizeSettings 完全一致：
   * 填 0（或负）表示"不限时"原样保留；其余夹到 [min, max]。
   * 夹完回显到输入框，避免"填了 1 秒、实际按 5 秒跑"这种错觉。
   */
  const readNum = (sel: string, fallback: number, min: number, max: number): number => {
    const el = root.querySelector<HTMLInputElement>(sel)!;
    const raw = Math.floor(Number(el.value));
    let v: number;
    if (!Number.isFinite(raw)) v = fallback;
    else if (raw <= 0) v = 0;
    else v = Math.min(max, Math.max(min, raw));
    el.value = String(v);
    return v;
  };

  const collectSettings = (): Partial<RoomSettings> => {
    const sec = (sel: string, def: number, min: number, max: number) => readNum(sel, def, min, max) * 1000;
    return {
      startChips: readNum('#cfg-chips', 100, 10, 100_000),
      maxRounds: readNum('#cfg-maxrounds', 30, 0, 999),
      anteRamp: readNum('#cfg-anteramp', 3, 0, 50),
      ante: Number(root.querySelector<HTMLSelectElement>('#cfg-ante')!.value),
      chipMultiplier: Number(root.querySelector<HTMLSelectElement>('#cfg-mult')!.value),
      // 各阶段独立可调：两个 0 的语义不同——决策阶段 0 = 不限时，
      // 摊牌展示 0 = 不等待，前端文案里已分别说明
      defenseMs: sec('#cfg-defense', 20, 5, 600),
      turnMs: sec('#cfg-turn', 60, 10, 1200),
      settlementMs: sec('#cfg-settlement', 5, 0, 60),
      idleMs: sec('#cfg-idle', 180, 30, 3600),
    };
  };

  // 失焦即归一化，让玩家一眼看到实际生效的值
  for (const id of ['#cfg-chips', '#cfg-defense', '#cfg-turn', '#cfg-settlement', '#cfg-idle', '#cfg-maxrounds', '#cfg-anteramp']) {
    root.querySelector(id)!.addEventListener('change', () => void collectSettings());
  }

  root.querySelector('#btn-create')!.addEventListener('click', () => {
    const name = ensureName();
    if (name) void createRoom(name, collectSettings(), avatar);
  });

  root.querySelector('#btn-tutorial')!.addEventListener('click', () => {
    const name = ensureName();
    if (!name) return;
    sfx.click();
    startTutorial();
    // 教学局：时限放宽，但**不能放宽到失去兜底**——服务端的回合超时会代打；
    // 若把时限设成 10 分钟，一旦哪里卡住，玩家要干等十分钟才等到自愈。
    // 5 分钟足够新手读完一段解说，也留住了自动恢复能力。1 名教官机器人陪练。
    void createRoom(name, {
      turnMs: 300_000,
      defenseMs: 240_000,
      settlementMs: 5_000,
      anteRamp: 4,
      maxRounds: 20,
      idleMs: 900_000,
      startChips: 100,
      ante: 1,
      chipMultiplier: 1,
    }, avatar);
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
