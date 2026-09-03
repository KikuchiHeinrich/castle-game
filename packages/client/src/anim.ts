import type { Card, GameEvent } from '../../shared/src/index';
import { getState } from './store';
import { createCard } from './components/card';

/**
 * 动画编排：串行消费服务端 game:event，映射到飞卡 / 翻牌 / 筹码特效。
 * 原则——"状态兜底，事件只负责好看"：动画结束后回调 renderAll() 让桌面
 * 回到权威快照的样子；检测到事件缺口（seq 跳变/重连）时直接跳过动画。
 */

export interface FxHooks {
  renderAll: () => void; // 立即把桌面渲染到最新快照（跳过动画）
  renderCards: () => void; // 只重绘卡牌区域
  seatEl: (seat: number) => HTMLElement | null;
  handEl: () => HTMLElement | null;
  ownBattlefieldEl: () => HTMLElement | null;
  potEl: () => HTMLElement | null;
  deckEl: () => HTMLElement | null;
  discardEl: () => HTMLElement | null;
  cardById: (id: string) => Card | null; // 从摊牌结果/公开信息里找牌面
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

function rectOf(el: HTMLElement | null): DOMRect | null {
  return el ? el.getBoundingClientRect() : null;
}

/** 创建一张飞行中的临时卡牌，从 from 飞到 to */
function flyNode(node: HTMLElement, from: DOMRect, to: DOMRect, dur = 380): Promise<void> {
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

function flyCardFace(card: Card | null, from: DOMRect, to: DOMRect, dur = 380, mini = false) {
  return flyNode(createCard(card, { mini }), from, to, dur);
}

function flyChips(from: DOMRect, to: DOMRect, count = 3, dur = 420): Promise<void> {
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
        // 缺口模式：跳过动画，靠兜底渲染
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
      await h.banner(`第 ${ev.roundNo} 回合`, `宣战者：${declarer?.name ?? '?'} · 底注各 1`, 900);
      break;
    }
    case 'deal': {
      const deckRect = rectOf(h.deckEl()) ?? rectOf(h.potEl());
      const flights: Promise<void>[] = [];
      let i = 0;
      for (const [seat, count] of ev.counts) {
        const target = seat === st.view?.you.seat ? h.handEl() : h.seatEl(seat);
        const to = rectOf(target);
        if (!deckRect || !to) continue;
        for (let k = 0; k < Math.min(count, 3); k++) {
          flights.push(flyCardFace(null, deckRect, to, 360).then(() => sleep(40)));
          i++;
        }
      }
      await Promise.all(flights);
      break;
    }
    case 'defense_declared': {
      const from = rectOf(h.seatEl(ev.seat));
      if (from) await flyChips(from, from, 2);
      break;
    }
    case 'play':
    case 'add_cards': {
      const own = ev.seat === st.view?.you.seat;
      let from: DOMRect | null;
      if (own) {
        from = rectOf(h.handEl());
      } else {
        from = rectOf(h.seatEl(ev.seat));
      }
      const bfEl = own ? h.ownBattlefieldEl() : h.seatEl(ev.seat);
      const to = rectOf(bfEl);
      if (from && to) {
        const flights: Promise<void>[] = [];
        for (let k = 0; k < Math.min(ev.cardCount, 3); k++) {
          flights.push(flyCardFace(null, from, to, 340).then(() => sleep(50)));
        }
        await Promise.all(flights);
      }
      if (ev.t === 'add_cards' && ev.betDelta > 0) {
        const pot = rectOf(h.potEl());
        if (from && pot) await flyChips(from, pot, 2);
      }
      h.renderCards(); // 先落位，再翻新亮出的最大牌
      await sleep(120); // 翻面由 renderCards 的新节点 transition 呈现
      break;
    }
    case 'add_chips': {
      const from = rectOf(h.seatEl(ev.seat));
      const pot = rectOf(h.potEl());
      if (from && pot) await flyChips(from, pot, 3);
      h.tweenPot();
      break;
    }
    case 'fold': {
      const from = rectOf(h.seatEl(ev.seat));
      const discard = rectOf(h.discardEl()) ?? rectOf(h.deckEl());
      if (from && discard) await flyChips(from, discard, 2);
      break;
    }
    case 'agree': {
      const el = h.seatEl(ev.seat);
      if (el) {
        el.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 300 });
      }
      break;
    }
    case 'showdown': {
      // 全员明牌：交给 renderAll 立即渲染摊牌面，然后横幅公布最大牌型
      h.renderAll();
      await sleep(500);
      const top = ev.entries[0];
      if (top) {
        await h.banner(`${top.handAlias} · ${top.handName}`, `${seatName(top.seat)} 领先`, 1400);
      }
      break;
    }
    case 'winner': {
      if (ev.seat !== null && ev.pot > 0) {
        const pot = rectOf(h.potEl());
        const target = rectOf(h.seatEl(ev.seat));
        if (pot && target) await flyChips(pot, target, 5, 520);
      }
      if (ev.seat !== null) {
        const w = st.view?.players.find((p) => p.seat === ev.seat);
        await h.banner(`${w?.name ?? '?'} 收下 ${ev.pot} 筹码`, '', 1100);
      } else {
        await h.banner('回合作废', '无人竞夺奖池，注金退还', 1200);
      }
      break;
    }
    case 'eliminated': {
      const w = st.view?.players.find((p) => p.seat === ev.seat);
      await h.banner(`${w?.name ?? '?'} 出局`, '', 900);
      break;
    }
    case 'game_over': {
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
