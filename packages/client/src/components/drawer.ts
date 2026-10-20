import { HAND_TYPES, handType } from '../../../shared/src/index';

/** 与 base.css 中 #drawer 的 transition(0.25s) 对齐，滑出动画结束后再隐藏 */
const CLOSE_MS = 260;

/** 关闭后延迟设置 hidden 的定时器 */
let hideTimer = 0;
const observed = new WeakSet<HTMLElement>();

/**
 * 让 hidden / inert / aria-hidden 始终跟随 open class：抽屉靠 hidden 真正移出屏幕。
 * 关闭瞬间就加 inert 与 aria-hidden，滑出的 260ms 里里面的按钮不能再被聚焦或朗读。
 * 视图里除 toggleDrawer 外仍可能直接改 class，因此用属性监听兜住这些路径。
 */
function syncHidden(el: HTMLElement) {
  window.clearTimeout(hideTimer);
  if (el.classList.contains('open')) {
    el.hidden = false;
    el.removeAttribute('inert');
    el.removeAttribute('aria-hidden');
    return;
  }
  el.setAttribute('inert', '');
  el.setAttribute('aria-hidden', 'true');
  if (el.hidden) return;
  hideTimer = window.setTimeout(() => {
    if (!el.classList.contains('open')) el.hidden = true;
  }, CLOSE_MS);
}

function observeDrawer(el: HTMLElement) {
  if (observed.has(el)) return;
  observed.add(el);
  new MutationObserver(() => syncHidden(el)).observe(el, { attributes: true, attributeFilter: ['class'] });
}

/** 牌型总表抽屉（22 种，从弱到强） */
export function renderHandTypes(root: HTMLElement) {
  // 初始关闭：同时移出视口、焦点顺序与辅助技术树
  root.hidden = true;
  root.setAttribute('inert', '');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="drawer-head" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <h3 style="margin:8px 0">牌型总表（弱 → 强）</h3>
      <button type="button" class="ghost drawer-close" data-drawer-close aria-label="关闭牌型总表">关闭</button>
    </div>
    <table>
      ${HAND_TYPES.map(
        (t) => `<tr class="${t.rank >= 19 ? 'big' : ''}">
            <td class="rank">${t.rank}</td>
            <td class="alias">${t.alias}</td>
            <td>${t.name}${t.size > 0 && t.name !== '高牌' ? ` · ${t.size}张` : ''}</td>
          </tr>`,
      )
        .join('')}
    </table>
    <h3>比较规则</h3>
    <div style="line-height:1.9;font-size:12px">
      ① 牌型排名 → ② 杂牌少者胜（掺水）→ ③ 牌型内最大牌 → ④ 花色（黑桃&gt;梅花&gt;红桃&gt;方片）<br/>
      押注上限 = 你放在出战区的牌数（累计）<br/>
      防守：牌数 ≤ 托管筹码，本回合锁定；最大也只拿回托管
    </div>
  `;
  root.querySelector<HTMLElement>('[data-drawer-close]')!.onclick = () => toggleDrawer(false);
  observeDrawer(root);
}

export function toggleDrawer(force?: boolean) {
  const el = document.getElementById('drawer');
  if (!el) return;
  const next = force ?? !el.classList.contains('open');
  window.clearTimeout(hideTimer);
  if (next) {
    el.hidden = false;
    void el.offsetWidth; // 先落一次布局，滑入过渡才会播放
    el.classList.add('open');
  } else {
    el.classList.remove('open');
    syncHidden(el);
  }
}

export function handLabel(typeRank: number): string {
  const t = handType(typeRank);
  return `${t.alias}·${t.name}`;
}
