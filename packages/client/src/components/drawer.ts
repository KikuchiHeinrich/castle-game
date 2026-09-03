import { HAND_TYPES, handType } from '../../../shared/src/index';

/** 牌型总表抽屉（22 种，从大到小） */
export function renderHandTypes(root: HTMLElement) {
  const rows = [...HAND_TYPES].reverse();
  root.innerHTML = `
    <h3>牌型总表（大 → 小）</h3>
    <table>
      ${rows
        .map(
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
}

export function toggleDrawer() {
  const el = document.getElementById('drawer');
  if (el) el.classList.toggle('open');
}

export function handLabel(typeRank: number): string {
  const t = handType(typeRank);
  return `${t.alias}·${t.name}`;
}
