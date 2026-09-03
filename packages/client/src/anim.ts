import type { Card, GameEvent, ShowdownEntry } from '../../shared/src/index';
import { getState } from './store';
import { createCard } from './components/card';
import { avatarSVG } from './components/pixelAvatar';
import { sfx } from './components/sfx';

/**
 * 动画编排：串行消费服务端 game:event，映射到飞卡 / 翻牌 / 筹码特效。
 * 原则——"状态兜底，事件只负责好看"：动画结束后回调 renderAll() 让桌面
 * 回到权威快照的样子；检测到事件缺口（seq 跳变/重连）时直接跳过动画。
 * 每个动作后保留节奏停顿，摊牌逐玩家逐张揭示 + 教官裁定演出。
 */

export interface FxHooks {
  renderAll: () => void; // 立即把桌面渲染到最新快照（跳过动画）
  renderCards: () => void; // 只重绘卡牌区域
  seatEl: (seat: number) => HTMLElement | null;
  bfZoneEl: (seat: number) => HTMLElement | null; // 座位的出牌段容器（飞牌落点）
  handEl: () => HTMLElement | null;
  ownPlayedEl: () => HTMLElement | null;
  potEl: () => HTMLElement | null;
  deckEl: () => HTMLElement | null;
  discardEl: () => HTMLElement | null;
  showdownPrepare: (entries: ShowdownEntry[]) => { seat: number; cards: HTMLElement[]; label: HTMLElement }[];
  verdict: (html: string) => Promise<void>; // 教官裁定演出
  banner: (main: string, sub?: string, ms?: number) => Promise<void>;
  tweenPot: () => void;
}

let hooks: FxHooks | null = null;
export function setFxHooks(h: FxHooks) {
  hooks = h;
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, reducedMotion ? 0 : ms));

type RectLike = { left: number; top: number; width: number; height: number };

function rectOf(el: HTMLElement | null): RectLike | null {
  return el ? el.getBoundingClientRect() : null;
}

function shiftRect(r: RectLike, dx: number): RectLike {
  return { left: r.left + dx, top: r.top, width: r.width, height: r.height };
}

/** 创建一张飞行中的临时卡牌，从 from 飞到 to */
function flyNode(node: HTMLElement, from: RectLike, to: RectLike, dur = 380): Promise<void> {
  if (reducedMotion) return Promise.resolve();
  node.classList.add('fly-card');
  node.style.left = '0px';
  node.style.top = '0px';
  node.style.width = `${from.width}px`;
  node.style.height = `${from.height}px`;
  document.body.appendChild(node);
  const dx = to.left - from.left + (to.width - from.width) / 2;
  const dy = to.top - from.top + (to.height - from.height) / 2;
  const sx = to.width / from.width;
  const anim = node.animate(
    [
      { transform: 'translate(0, 0) scale(1)' },
      { transform: `translate(${dx}px, ${dy}px) scale(${sx})` },
    ],
    { duration: dur, easing: EASE, fill: 'forwards' },
  );
  return anim.finished.then(() => node.remove());
}

function flyCardFace(card: Card | null, from: RectLike, to: RectLike, dur = 380) {
  return flyNode(createCard(card), from, to, dur);
}

function flyChips(from: RectLike | null, to: RectLike | null, count = 3, dur = 420): Promise<void> {
  if (reducedMotion || !from || !to) return Promise.resolve();
  const flights: Promise<void>[] = [];
  for (let i = 0; i < Math.min(count, 5); i++) {
    const chip = document.createElement('div');
    chip.className = 'fly-card';
    chip.style.width = '18px';
    chip.style.height = '18px';
    chip.style.background = i % 2 ? 'var(--chip-r)' : 'var(--chip-w)';
    chip.style.border = '3px dashed var(--card-edge)';
    chip.style.borderRadius = '50%';
    chip.style.left = `${from.left + from.width / 2 + i * 4}px`;
    chip.style.top = `${from.top + from.height / 2}px`;
    document.body.appendChild(chip);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2) + i * 4;
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const anim = chip.animate(
      [
        { transform: 'translate(0,0)', offset: 0 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px)`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px)`, offset: 1 },
      ],
      { duration: dur + i * 40, easing: EASE, fill: 'forwards' },
    );
    flights.push(anim.finished.then(() => chip.remove()));
  }
  return Promise.all(flights).then(() => undefined);
}

// ---- 事件队列 ----

interface Pending {
  ev: GameEvent;
  gap: boolean;
}
const queue: Pending[] = [];
let running = false;
let dropped = false;

export function enqueueEvent(ev: GameEvent, gap: boolean) {
  queue.push({ ev, gap });
  if (gap) dropped = true; // 有缺口：本批直接走兜底
  if (!running) void drain();
}

async function drain() {
  running = true;
  while (queue.length > 0) {
    const { ev, gap } = queue.shift()!;
    try {
      if (gap || dropped) {
        hooks?.renderAll();
        continue;
      }
      await handle(ev);
      hooks?.renderCards();
    } catch (e) {
      console.error('anim error', e);
      hooks?.renderAll();
    }
  }
  dropped = false;
  running = false;
  hooks?.renderAll(); // 队列排空：最终兜底，保证与权威状态一致
}

export function isBusy() {
  return running;
}

export function resetQueue() {
  queue.length = 0;
  dropped = true;
}

// ---- 各事件动画 ----

async function handle(ev: GameEvent): Promise<void> {
  if (!hooks) return;
  const h = hooks;
  const st = getState();

  switch (ev.t) {
    case 'round_start': {
      const declarer = st.view?.players.find((p) => p.seat === ev.declarerSeat);
      await h.banner(`第 ${ev.roundNo} 回合`, `宣战者：${declarer?.name ?? '?'} · 底注各 1`, 1100);
      break;
    }
    case 'deal': {
      sfx.deal();
      const deckRect = rectOf(h.deckEl()) ?? rectOf(h.potEl());
      const flights: Promise<void>[] = [];
      for (const [seat, count] of ev.counts) {
        const target = seat === st.view?.you.seat ? h.handEl() : h.seatEl(seat);
        const to = rectOf(target);
        if (!deckRect || !to) continue;
        for (let k = 0; k < Math.min(count, 3); k++) {
          flights.push(
            sleep(k * 90).then(() => {
              sfx.deal();
              return flyCardFace(null, deckRect, to, 360);
            }),
          );
        }
      }
      await Promise.all(flights);
      break;
    }
    case 'defense_declared': {
      const from = rectOf(h.seatEl(ev.seat));
      if (from) {
        sfx.chip();
        await flyChips(from, from, 2);
      }
      break;
    }
    case 'play':
    case 'add_cards': {
      const own = ev.seat === st.view?.you.seat;
      // 起点：自己的手牌区 / 对手的座位；终点：各自的出牌区
      const from = own ? rectOf(h.handEl()) : rectOf(h.seatEl(ev.seat));
      const to = rectOf(own ? h.ownPlayedEl() : (h.bfZoneEl(ev.seat) ?? h.seatEl(ev.seat)));
      if (from && to) {
        // 逐张抽出、按序横摆在桌面上
        const n = Math.min(ev.cardCount, 6);
        const cardW = Math.min(56, to.width / (n + 1));
        for (let k = 0; k < n; k++) {
          sfx.deal();
          const slot = shiftRect(to, (k - (n - 1) / 2) * (cardW + 6));
          await flyCardFace(null, from, slot, 300);
          await sleep(130);
        }
      }
      if (ev.revealedTop) {
        h.renderCards();
        sfx.flip();
        await sleep(400);
      }
      if (ev.t === 'add_cards' && ev.betDelta > 0) {
        const pot = rectOf(h.potEl());
        if (from && pot) {
          sfx.chip();
          await flyChips(from, pot, 2);
        }
      }
      h.renderCards();
      await sleep(1200); // 节奏停顿：看清刚才发生了什么
      break;
    }
    case 'add_chips': {
      sfx.chip();
      const from = rectOf(h.seatEl(ev.seat));
      const pot = rectOf(h.potEl());
      if (from && pot) await flyChips(from, pot, 3);
      h.tweenPot();
      await sleep(700);
      break;
    }
    case 'fold': {
      sfx.fold();
      const from = rectOf(h.seatEl(ev.seat));
      const discard = rectOf(h.discardEl()) ?? rectOf(h.deckEl());
      if (from && discard) await flyChips(from, discard, 2);
      h.renderCards();
      await sleep(600);
      break;
    }
    case 'agree': {
      sfx.agree();
      const el = h.seatEl(ev.seat);
      if (el) el.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 300 });
      break;
    }
    case 'showdown': {
      // 逐玩家逐张翻面 + 逐人亮出牌型标签
      const prepared = h.showdownPrepare(ev.entries);
      for (let idx = 0; idx < prepared.length; idx++) {
        const entry = prepared[idx];
        const info = ev.entries[idx];
        const name = st.view?.players.find((p) => p.seat === entry.seat)?.name ?? `座位${entry.seat}`;
        for (const node of entry.cards) {
          sfx.flip();
          node.classList.add('up');
          await sleep(reducedMotion ? 0 : 180);
        }
        entry.label.textContent = info ? `${name}：${info.handAlias}·${info.handName}` : name;
        await sleep(reducedMotion ? 0 : 850);
      }
      // 教官裁定演出
      const wEntry = ev.entries[0];
      const wName = st.view?.players.find((p) => p.seat === wEntry?.seat)?.name ?? '?';
      sfx.horn();
      await h.verdict(
        `<div class="verdict-box">
          <div class="verdict-avatar">${avatarSVG('shirley', 'happy', 6)}</div>
          <div class="verdict-text">
            <div class="verdict-title">教官裁定</div>
            <div class="verdict-main">${wName} 胜！</div>
            ${wEntry ? `<div class="verdict-sub">${wEntry.handAlias}·${wEntry.handName}</div>` : ''}
          </div>
        </div>`,
      );
      break;
    }
    case 'winner': {
      if (ev.seat !== null && ev.pot > 0) {
        const pot = rectOf(h.potEl());
        const target = rectOf(h.seatEl(ev.seat));
        if (pot && target) {
          sfx.win();
          await flyChips(pot, target, 5, 520);
        }
        const w = st.view?.players.find((p) => p.seat === ev.seat);
        const youWin = ev.seat === st.view?.you.seat;
        await h.banner(`${w?.name ?? '?'} 收下 ${ev.pot} 筹码`, youWin ? '漂亮！' : '', 1200);
      } else {
        await h.banner('回合作废', '无人竞夺奖池，注金退还', 1200);
      }
      break;
    }
    case 'eliminated': {
      sfx.lose();
      const w = st.view?.players.find((p) => p.seat === ev.seat);
      await h.banner(`${w?.name ?? '?'} 出局`, '', 900);
      break;
    }
    case 'game_over': {
      sfx.win();
      const w = st.view?.players.find((p) => p.seat === ev.winnerSeat);
      await h.banner(`${w?.name ?? '?'} 统治了城堡！`, '', 1400);
      break;
    }
    case 'defense_window_closed':
    case 'defense_passed':
    case 'agree_reset':
    case 'round_void':
      break;
  }
}

function seatName(seat: number): string {
  return getState().view?.players.find((p) => p.seat === seat)?.name ?? `座位${seat}`;
}

void seatName;

