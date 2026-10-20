import type { Card } from '../../../shared/src/index';
import { cardLabel } from '../../../shared/src/index';

/**
 * 原版牌面图集（cards.png）是 13 列 × 5 行，每格 49×65：列从左到右是 A,2,...,10,J,Q,K，
 * 行序是 红桃 / 方片 / 黑桃 / 梅花（第 5 行是大小王，52 张的规则用不到）。
 * 规则里的花色编号是 方片0 < 红桃1 < 梅花2 < 黑桃3，所以要按这张表换图集行号。
 */
const FIGURE_COLS = 13;
const FIGURE_ROWS = 5;
const FIGURE_ROW_BY_SUIT = [1, 0, 3, 2];

/** 卡牌 DOM（唯一创建卡牌节点的地方）：默认牌背，加 .up 翻到正面；两面都用原版像素图，位置交给 card.css */
export function createCard(card: Card | null, opts: { mini?: boolean; up?: boolean } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card' + (opts.mini ? ' mini' : '') + (opts.up ? ' up' : '');
  if (card) el.dataset.id = card.id;

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  const back = document.createElement('div');
  back.className = 'face back';

  const front = document.createElement('div');
  // 未知牌（只有牌背、还没有真牌可画）的正面保持素面：.empty 会挡掉图集背景
  front.className = 'face front' + (card ? '' : ' empty');
  if (card) {
    if (card.suit === 0 || card.suit === 1) el.classList.add('red');
    // 正面不画角标/花色，改成从图集里切出这一张：列 = 点数 - 1，行按花色查表。
    // 每格的位置 = 下标 / (总数 - 1)，配合 background-size 1300% 500% 正好落在整格上。
    const col = (card.rank - 1) / (FIGURE_COLS - 1);
    const row = FIGURE_ROW_BY_SUIT[card.suit] / (FIGURE_ROWS - 1);
    el.style.setProperty('--card-front-pos', `${col * 100}% ${row * 100}%`);
    // 牌面变成图片后读屏拿不到原来的角标文字，标签改挂在正面图上；未知牌（null）不加标签
    front.setAttribute('role', 'img');
    front.setAttribute('aria-label', cardLabel(card));
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
