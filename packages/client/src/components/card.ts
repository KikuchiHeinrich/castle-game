import type { Card } from '../../../shared/src/index';

/**
 * 卡牌 DOM（唯一创建卡牌节点的地方）。
 * 牌面直接用 Kingslayer 的 cards.png 图集：13 列（A→K）× 5 行（♥♦♠♣ + 王），
 * 单格 49×65；花色行号与《城堡》的 Suit（0♦ 1♥ 2♣ 3♠）做一次映射。
 */

/** 图集行号：素材里从上到下是 红桃 / 方片 / 黑桃 / 梅花，最后一行是两张王 */
const SUIT_ROW: Record<number, number> = { 1: 0, 0: 1, 3: 2, 2: 3 };

export function createCard(card: Card | null, opts: { mini?: boolean; up?: boolean } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card' + (opts.mini ? ' mini' : '') + (opts.up ? ' up' : '');
  if (card) {
    el.dataset.id = card.id;
    el.style.setProperty('--col', String(card.rank - 1));
    el.style.setProperty('--row', String(SUIT_ROW[card.suit] ?? 0));
    el.dataset.label = cardLabelOf(card);
  }

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  const front = document.createElement('div');
  front.className = 'face front';

  const back = document.createElement('div');
  back.className = 'face back';

  inner.append(front, back);
  el.appendChild(inner);
  return el;
}

/** 供 title / 无障碍读屏用的牌面文字（图集本身已含角标，不再重复渲染） */
function cardLabelOf(card: Card): string {
  const suits = ['方片', '红桃', '梅花', '黑桃'];
  const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return `${suits[card.suit]}${ranks[card.rank]}`;
}

/** 他人手牌数量的牌背小堆 */
export function createBacks(count: number, max = 6): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'backs';
  const n = Math.min(count, max);
  for (let i = 0; i < n; i++) {
    const b = document.createElement('div');
    b.className = 'mini-back';
    wrap.appendChild(b);
  }
  return wrap;
}
