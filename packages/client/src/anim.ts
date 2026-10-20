import type { GameEvent, ShowdownEntry } from '../../shared/src/index';
import type { SettlementSequence, SettlementStep } from './presentation';
import { getState } from './store';
import { createCard } from './components/card';
import { avatarHandRect, cancelAvatarActions, playAvatar, reducedMotion } from './components/pixelAvatar';
import { sfx } from './components/sfx';
import { TimerRegistry } from './pending';

export interface FxHooks {
  renderAll: () => void;
  renderCards: () => void;
  seatEl: (seat: number) => HTMLElement | null;
  bfZoneEl: (seat: number) => HTMLElement | null;
  deckEl: () => HTMLElement | null;
  dealZoneEl: (seat: number) => HTMLElement | null;
  potEl: () => HTMLElement | null;
  handEl: () => HTMLElement | null;
  dealBegin: (counts: [number, number][]) => void;
  dealEnd: () => void;
  settlementPrepare: (entries: ShowdownEntry[]) => void;
  settlementSequence: () => SettlementSequence | null;
  settlementReplayStart?: () => void;
  settlementStep: (step: SettlementStep, index: number) => void;
  settlementDone: (instant: boolean) => void;
  settlementAbort: (reason: string) => void;
  caption: (line: string) => void;
  report: (line: string) => void;
}

let hooks: FxHooks | null = null;
let epoch = 0;
let running = false;
let paused = false;
const pauseWaiters = new Set<() => void>();
const queue: GameEvent[] = [];
const effects = new Set<Animation>();
const nodes = new Set<HTMLElement>();
const timers = new TimerRegistry();

/** Own cards selected for flight: remember their screen positions before selection changes. */
let staged: { id: string; rect: DOMRect }[] = [];

export function stageOwnPlay(entries: { id: string; rect: DOMRect }[]) {
  staged = entries;
}
export function clearStagedOwnPlay() {
  staged = [];
}
export const isBusy = () => running || queue.length > 0;
export const isPresentationPaused = () => paused;

export function setPresentationPaused(next: boolean) {
  paused = next;
  if (!next) {
    for (const resolve of [...pauseWaiters]) resolve();
    pauseWaiters.clear();
  }
}

function cancelVisuals() {
  cancelAvatarActions();
  for (const animation of [...effects]) animation.cancel();
  effects.clear();
  for (const node of nodes) node.remove();
  nodes.clear();
  timers.cancelAll();
  document.querySelectorAll<HTMLElement>('[data-fx-hidden]').forEach((node) => {
    node.style.visibility = '';
    delete node.dataset.fxHidden;
  });
  document.querySelectorAll('.fly-card,.flying-chip').forEach((node) => node.remove());
  document.querySelectorAll<HTMLElement>('.fx-return,.fx-out').forEach((node) => {
    node.classList.remove('fx-return', 'fx-out');
  });
}

/**
 * Clear the current live presentation. Reconnect, hidden tabs, reduced motion and
 * event gaps use this path; the table then renders the latest snapshot as a completed,
 * readable result instead of leaving an unreplayable queue behind.
 */
export function resetQueue(reason = 'reset') {
  epoch += 1;
  queue.length = 0;
  running = false;
  staged = [];
  setPresentationPaused(false);
  cancelVisuals();
  hooks?.settlementAbort(reason);
}

/**
 * Hook replacement keeps already queued live events. This matters at game start:
 * events arrive before `main` mounts the table, and the initial deal must still play.
 */
export function setFxHooks(next: FxHooks | null) {
  if (hooks === next) return;
  epoch += 1;
  running = false;
  cancelVisuals();
  hooks = next;
  if (hooks && queue.length > 0) void drain(epoch);
}

function wait(ms: number): Promise<void> {
  if (reducedMotion() || document.hidden) return Promise.resolve();
  return new Promise<void>((resolve) => timers.set(ms, resolve));
}

async function presentationGate() {
  if (reducedMotion() || document.hidden) return;
  while (paused) {
    await new Promise<void>((resolve) => pauseWaiters.add(resolve));
    if (reducedMotion() || document.hidden) return;
  }
}

/**
 * Live events are staged by the socket and flushed after their authoritative snapshot.
 * If the socket reports a gap, skip the incomplete story and let the table render the
 * latest view directly.
 */
export function enqueueEvent(ev: GameEvent, gap = false) {
  if (gap || document.hidden) {
    resetQueue(gap ? 'gap' : 'hidden');
    hooks?.renderAll();
    return;
  }

  if (ev.t === 'round_start') {
    resetQueue('round');
  }
  if (ev.t === 'showdown') {
    hooks?.settlementPrepare(ev.entries);
  }
  queue.push(ev);
  if (hooks && !running) void drain(epoch);
}

async function drain(token: number) {
  if (running || !hooks) return;
  running = true;
  try {
    while (queue.length > 0 && token === epoch) {
      const ev = queue.shift()!;
      await handle(ev, token);
      if (token === epoch) hooks?.renderCards();
      await wait(80);
    }
  } catch (error) {
    console.error('演出恢复', error);
  } finally {
    if (token === epoch) {
      running = false;
      hooks?.renderAll();
      if (queue.length > 0 && hooks) void drain(epoch);
    }
  }
}

async function fly(
  node: HTMLElement,
  from: DOMRect,
  to: DOMRect,
  duration = 420,
): Promise<void> {
  if (reducedMotion() || document.hidden) return;
  node.classList.add('fly-card');
  Object.assign(node.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
  });
  document.body.append(node);
  nodes.add(node);
  const dx = to.left - from.left + (to.width - from.width) / 2;
  const dy = to.top - from.top + (to.height - from.height) / 2;
  const animation = node.animate(
    [
      { transform: 'translate(0,0) scale(1)' },
      {
        transform: `translate(${dx}px,${dy - 8}px) scale(${to.width / from.width})`,
        offset: 0.86,
      },
      { transform: `translate(${dx}px,${dy}px) scale(${to.width / from.width})` },
    ],
    { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
  );
  effects.add(animation);
  await animation.finished.catch(() => {});
  animation.cancel();
  effects.delete(animation);
  node.remove();
  nodes.delete(node);
}

function rect(el: HTMLElement | null): DOMRect | null {
  return el?.getBoundingClientRect() ?? null;
}

async function chips(from: DOMRect | null, to: DOMRect | null, delay = 0) {
  if (!from || !to) return;
  const node = document.createElement('span');
  node.className = 'flying-chip';
  if (delay) await wait(delay);
  await fly(
    node,
    new DOMRect(from.x + from.width / 2 - 8, from.y + from.height / 2 - 8, 16, 16),
    new DOMRect(to.x + to.width / 2 - 8, to.y + to.height / 2 - 8, 16, 16),
    460,
  );
}

function handNode(hand: HTMLElement | null, id: string): HTMLElement | null {
  return (
    [...(hand?.children ?? [])]
      .map((node) => node as HTMLElement)
      .find((node) => node.dataset.id === id) ?? null
  );
}

function pulse(el: HTMLElement | null, cls: string, ms: number) {
  if (!el) return;
  el.classList.add(cls);
  timers.set(ms, () => el.classList.remove(cls));
}

function playerName(seat: number): string {
  const view = getState().view;
  if (!view) return `座位 ${seat}`;
  if (seat === view.you.seat) return view.you.name || `座位 ${seat}`;
  return view.players.find((player) => player.seat === seat)?.name ?? `座位 ${seat}`;
}

function cardRectFrom(container: DOMRect): DOMRect {
  const width = Math.min(30, Math.max(22, container.width * 0.32));
  const height = width * 1.45;
  return new DOMRect(
    container.left + container.width / 2 - width / 2,
    container.top + container.height / 2 - height / 2,
    width,
    height,
  );
}

async function deal(ev: Extract<GameEvent, { t: 'deal' }>, token: number) {
  const h = hooks!;
  h.dealBegin(ev.counts);
  h.caption('中央牌堆发牌 · 每一位玩家同时收到本回合的手牌');
  h.renderCards();
  const source = rect(h.deckEl());
  const validSource =
    source !== null && source.width > 0 && source.height > 0;
  const maximum = Math.max(0, ...ev.counts.map(([, count]) => count));
  for (let index = 0; index < maximum; index += 1) {
    if (token !== epoch) return;
    await presentationGate();
    const flights: Promise<void>[] = [];
    for (const [seat, count] of ev.counts) {
      if (index >= count) continue;
      const target = rect(h.dealZoneEl(seat));
      if (
        !validSource ||
        !source ||
        !target ||
        target.width <= 0 ||
        target.height <= 0
      ) {
        continue;
      }
      flights.push(fly(createCard(null), cardRectFrom(source), cardRectFrom(target), 420));
    }
    if (index === 0) sfx.deal();
    await Promise.all(flights);
    await wait(90);
  }
  h.dealEnd();
  h.renderCards();
  h.report(
    `发牌 · ${ev.counts
      .map(([seat, count]) => `${playerName(seat)} ${count} 张`)
      .join('，')}`,
  );
  h.caption('发牌完成 · 查看手牌后开始行动');
  await wait(180);
}

async function actionCards(
  ev: Extract<GameEvent, { t: 'play' | 'add_cards' | 'defense_declared' }>,
  token: number,
) {
  const h = hooks!;
  const kind = ev.t === 'defense_declared' ? 'defend' : 'play';
  const own = ev.seat === getState().view?.you.seat;
  const move = playAvatar(h.seatEl(ev.seat), kind);
  const release = avatarHandRect(h.seatEl(ev.seat), kind) ?? rect(h.seatEl(ev.seat));
  const target = rect(h.bfZoneEl(ev.seat));
  const gathered = own ? staged : [];
  const hidden: HTMLElement[] = [];
  h.caption(
    `${playerName(ev.seat)} · ${
      ev.t === 'defense_declared' ? '宣布防守' : ev.t === 'add_cards' ? '补牌' : '出牌'
    } ${ev.cardCount} 张`,
  );

  if (own) {
    for (const item of gathered) {
      const node = handNode(h.handEl(), item.id);
      if (!node) continue;
      node.dataset.fxHidden = '1';
      node.style.visibility = 'hidden';
      hidden.push(node);
    }
    await wait(300);
    if (release && gathered.length > 0) {
      const handPoint = new DOMRect(release.x - 14, release.y - 24, 30, 42);
      await Promise.all(gathered.map((item) => fly(createCard(null), item.rect, handPoint, 260)));
    }
  } else {
    await wait(300);
  }
  staged = [];
  if (token !== epoch) return;

  if (release && target) {
    sfx.play();
    const flights: Promise<void>[] = [];
    for (let index = 0; index < ev.cardCount; index += 1) {
      const offset = (index - (ev.cardCount - 1) / 2) * 22;
      const to = new DOMRect(
        target.left + target.width / 2 + offset - 16,
        target.top + 10,
        32,
        46,
      );
      flights.push(
        fly(createCard(null), new DOMRect(release.x, release.y, 30, 42), to, 470 + index * 35),
      );
    }
    await Promise.all(flights);
  }

  for (const node of hidden) {
    node.style.visibility = '';
    delete node.dataset.fxHidden;
  }
  if (token !== epoch) return;
  h.renderCards();
  await move;
  if (token !== epoch) return;
  h.report(
    `${playerName(ev.seat)} · ${
      ev.t === 'defense_declared' ? '防守' : ev.t === 'add_cards' ? '加牌' : '出牌'
    } ${ev.cardCount}${
      ev.t === 'defense_declared' && ev.escrow ? ` · 托管 ${ev.escrow}` : ''
    }`,
  );
}

function stepDelay(step: SettlementStep): number {
  switch (step.kind) {
    case 'reveal-start':
      return 520;
    case 'reveal-card':
      return 760;
    case 'reveal-hold':
      return 1900;
    case 'no-entry':
      return 1050;
    case 'criterion':
      return 1700;
    case 'escrow':
      return 1750;
    case 'verdict':
      return 1850;
    case 'payout':
      return 720;
    case 'ready':
      return 0;
  }
}

async function playSettlement(
  sequence: SettlementSequence,
  token: number,
  instant: boolean,
) {
  const h = hooks!;
  for (let index = 0; index < sequence.steps.length; index += 1) {
    if (token !== epoch) return;
    await presentationGate();
    const step = sequence.steps[index];
    h.settlementStep(step, index);
    if (instant) continue;

    if (step.kind === 'verdict' && step.winnerSeat !== null) {
      sfx.win();
      void playAvatar(h.seatEl(step.winnerSeat), 'win');
      await chips(rect(h.potEl()), rect(h.seatEl(step.winnerSeat)), 260);
    } else if (step.kind === 'payout') {
      if (step.escrowReturn > 0) pulse(h.seatEl(step.seat), 'fx-return', 900);
      if (step.escrowForfeit > 0) pulse(h.seatEl(step.seat), 'fx-out', 900);
    }
    await wait(stepDelay(step));
  }
  if (token === epoch) h.settlementDone(instant);
}

/** Replay is explicit and never auto-advances the round. */
export function replaySettlement(sequence: SettlementSequence): boolean {
  if (!hooks || running || queue.length > 0 || document.hidden) return false;
  const token = ++epoch;
  running = true;
  setPresentationPaused(false);
  hooks.settlementReplayStart?.();
  void (async () => {
    try {
      await playSettlement(sequence, token, reducedMotion());
    } catch (error) {
      console.error('结算重播恢复', error);
    } finally {
      if (token === epoch) {
        running = false;
        hooks?.renderAll();
      }
    }
  })();
  return true;
}

async function handle(ev: GameEvent, token: number) {
  const h = hooks;
  const view = getState().view;
  if (!h || !view) return;

  if (ev.t === 'deal') {
    await deal(ev, token);
  } else if (ev.t === 'play' || ev.t === 'add_cards' || ev.t === 'defense_declared') {
    await actionCards(ev, token);
  } else if (ev.t === 'add_chips') {
    h.caption(`${playerName(ev.seat)} · 加注 ${ev.betDelta}`);
    sfx.chip();
    await playAvatar(h.seatEl(ev.seat), 'play');
    await chips(rect(h.seatEl(ev.seat)), rect(h.potEl()));
    if (token === epoch) h.report(`${playerName(ev.seat)} · 加注 ${ev.betDelta}`);
  } else if (ev.t === 'fold') {
    h.caption(`${playerName(ev.seat)} · 弃牌`);
    await playAvatar(h.seatEl(ev.seat), 'fold');
    if (token === epoch) h.report(`${playerName(ev.seat)} · 弃牌`);
  } else if (ev.t === 'showdown') {
    const sequence = h.settlementSequence();
    if (!sequence) {
      h.settlementDone(true);
    } else {
      await playSettlement(sequence, token, reducedMotion() || document.hidden);
    }
  } else if (ev.t === 'winner') {
    if (ev.seat !== null) h.caption(`奖池分配 · ${playerName(ev.seat)} +${ev.pot}`);
    h.report(ev.seat === null ? '回合作废' : `${playerName(ev.seat)} · +${ev.pot}`);
  } else if (ev.t === 'game_started') {
    h.caption('对局开始');
    h.report('对局开始');
  } else if (ev.t === 'round_start') {
    h.caption(`第 ${ev.roundNo} 回合 · 清点奖池 ${ev.pot}`);
    h.report(`第 ${ev.roundNo} 回合`);
  } else if (ev.t === 'agree') {
    h.report(`${playerName(ev.seat)} · ${ev.agree ? '同意摊牌' : '取消同意'}`);
  } else if (ev.t === 'defense_passed') {
    h.report(`${playerName(ev.seat)} · 不防守`);
  } else if (ev.t === 'defense_window_closed') {
    h.report('防守窗口关闭');
  } else if (ev.t === 'agree_reset') {
    h.report('行动更新，同意已重置');
  } else if (ev.t === 'eliminated') {
    // Eliminations are committed before showdown. Keep that result inside the
    // sequential settlement story instead of dimming the seat or announcing zero
    // chips while its hand is still being revealed.
    const current = getState().view;
    const deferred =
      !!current?.result &&
      (current.roundPhase === 'settlement' || current.phase === 'gameover');
    if (!deferred) {
      pulse(h.seatEl(ev.seat), 'fx-out', 1100);
      h.report(`${playerName(ev.seat)} · 淘汰出局`);
    }
  } else if (ev.t === 'round_void') {
    h.caption(`回合作废 · ${ev.reason}`);
    h.report(`回合作废：${ev.reason}`);
  } else if (ev.t === 'game_over') {
    h.report('终局已确定');
  } else if (ev.t === 'next_ready') {
    h.report(`${playerName(ev.seat)} · ${ev.agree ? '已准备' : '取消准备'}`);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resetQueue('hidden');
      hooks?.renderAll();
    }
  });
}
