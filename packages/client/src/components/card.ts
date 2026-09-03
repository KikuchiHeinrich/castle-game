import type { Card } from '../../../shared/src/index';
import { SUIT_CHARS } from '../../../shared/src/index';

/** 卡牌 DOM（唯一创建卡牌节点的地方）：默认牌背，加 .up 翻到正面 */
export function createCard(card: Card | null, opts: { mini?: boolean; up?: boolean } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card' + (opts.mini ? ' mini' : '') + (opts.up ? ' up' : '');
  if (card) el.dataset.id = card.id;

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  const back = document.createElement('div');
  back.className = 'face back';

  const front = document.createElement('div');
  front.className = 'face front';
  if (card) {
    if (card.suit === 0 || card.suit === 1) el.classList.add('red');
    const corner = document.createElement('span');
    corner.className = 'corner';
    corner.textContent = `${SUIT_CHARS[card.suit]}${card.id.slice(1)}`;
    const pip = document.createElement('span');
    pip.className = 'pip';
    pip.textContent = SUIT_CHARS[card.suit];
    front.append(corner, pip);
  }

  inner.append(front, back);
  el.appendChild(inner);
  return el;
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
