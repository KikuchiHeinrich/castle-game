import {
  HAND_TYPES,
  cardLabel,
  type GameAction,
  type PlayerView,
  type PublicPlayer,
  type ShowdownEntry,
} from '../../../shared/src/index';
import { getState, patchUI, toggleSelect } from '../store';
import { clearSession, gameAction, rematch } from '../net/socket';
import { createBacks, createCard } from '../components/card';
import {
  avatarSVG,
  cancelAvatarActions,
  shownAvatar,
} from '../components/pixelAvatar';
import { renderHandTypes, toggleDrawer } from '../components/drawer';
import { html, keyed, text } from '../components/dom';
import { isMuted, sfx, toggleMute } from '../components/sfx';
import { decision, matchingSelection } from '../decision';
import {
  clearStagedOwnPlay,
  isBusy,
  isPresentationPaused,
  replaySettlement,
  resetQueue,
  setFxHooks,
  setPresentationPaused,
  stageOwnPlay,
} from '../anim';
import { exitTutorial, renderTutorial, tutorialActive } from '../components/tutorial';
import { shortStatus } from './shortStatus';
import {
  buildSettlementSequence,
  seatLayout,
  settlementCaption,
  type CriterionRow,
  type SettlementPlayer,
  type SettlementSequence,
  type SettlementStep,
} from '../presentation';

type SeatPlayer = PublicPlayer | PlayerView['you'];

interface SettlementRun {
  sequence: SettlementSequence;
  index: number;
  complete: boolean;
  instant: boolean;
}

interface RevealState {
  counts: Map<number, number>;
  activeSeat: number | null;
  judged: Set<number>;
}

let root: HTMLElement | null = null;
let pending = false;
let rankOpen = false;
let queryRank = 0;
let foldConfirm = false;
let raf = 0;
let captionText = '';
let settlement: SettlementRun | null = null;
let safePot = 0;
const safeChips = new Map<number, number>();
let knownHandIds = new Set<string>();
let dealingHiddenIds = new Set<string>();
let dealActive = false;
let dialogSeat: number | null = null;
let dialogTrigger: HTMLElement | null = null;
let dialogRefocus = true;
const history: string[] = [];

const $ = (selector: string) => root!.querySelector<HTMLElement>(selector)!;
const NO_DEADLINE = 8e15;

function resultActive(view: PlayerView): boolean {
  return (
    !!view.result &&
    (view.roundPhase === 'settlement' || view.phase === 'gameover')
  );
}

function settlementPlayers(view: PlayerView): SettlementPlayer[] {
  const players: SettlementPlayer[] = view.players.map((player) => ({
    seat: player.seat,
    name: player.name || `座位 ${player.seat}`,
    status: player.status,
    chips: player.chips,
  }));
  if (!players.some((player) => player.seat === view.you.seat)) {
    players.push({
      seat: view.you.seat,
      name: view.you.name || `座位 ${view.you.seat}`,
      status: view.you.status,
      chips: view.you.chips,
    });
  }
  return players;
}

function instantSettlement(view: PlayerView): SettlementRun | null {
  if (!view.result) return null;
  const sequence = buildSettlementSequence(
    view.result,
    settlementPlayers(view),
    view.you.seat,
    view.result.entries,
  );
  return {
    sequence,
    index: sequence.steps.length - 1,
    complete: true,
    instant: true,
  };
}

function ensureSettlement(view: PlayerView): SettlementRun | null {
  if (!resultActive(view)) {
    settlement = null;
    return null;
  }
  if (!settlement) settlement = instantSettlement(view);
  return settlement;
}

function rememberSafeValues(view: PlayerView) {
  safePot = view.pot;
  for (const player of view.players) safeChips.set(player.seat, player.chips);
  if (!safeChips.has(view.you.seat)) safeChips.set(view.you.seat, view.you.chips);
}

function shownChips(player: SeatPlayer): number {
  if (settlement) {
    for (let index = settlement.index; index >= 0; index -= 1) {
      const step = settlement.sequence.steps[index];
      if (step.kind === 'payout' && step.seat === player.seat) return step.chips;
    }
  }
  if (settlement && !settlement.complete) {
    return safeChips.get(player.seat) ?? player.chips;
  }
  return player.chips;
}

function shownPot(view: PlayerView): number {
  if (!settlement || settlement.complete) return view.pot;
  for (let index = 0; index <= settlement.index; index += 1) {
    const step = settlement.sequence.steps[index];
    if (step.kind === 'payout' && step.potWon > 0) return 0;
  }
  return safePot;
}

function deferredOut(view: PlayerView, seat: number): boolean {
  return Boolean(
    settlement &&
      !settlement.complete &&
      view.result?.eliminated.includes(seat),
  );
}

export function unmountTable() {
  closeDialog(false);
  cancelAnimationFrame(raf);
  raf = 0;
  setFxHooks(null);
  cancelAvatarActions();
  settlement = null;
  dialogSeat = null;
  dialogTrigger = null;
  root = null;
  resetQueue('unmount');
}

function detachTableForRemount() {
  closeDialog(false);
  cancelAnimationFrame(raf);
  raf = 0;
  setFxHooks(null);
  cancelAvatarActions();
  settlement = null;
  dialogSeat = null;
  dialogTrigger = null;
  root = null;
}

export function mountTable(container: HTMLElement) {
  detachTableForRemount();
  root = container;
  pending = false;
  rankOpen = false;
  queryRank = 0;
  foldConfirm = false;
  captionText = '';
  settlement = null;
  knownHandIds = new Set();
  dealingHiddenIds = new Set();
  dealActive = false;
  safeChips.clear();

  root.innerHTML = `<div id="table" class="castle-scene">
  <header id="table-header">
    <div class="castle-plaque"><span>城 堡</span><small id="round-info"></small></div>
    <div id="pot-block"><span class="coin-stack" aria-hidden="true">●</span><span>奖池</span> <strong id="pot-num"></strong></div>
    <span id="ready-summary"></span>
    <span id="connection" role="status"></span>
    <button id="table-menu-button" class="ghost" aria-label="牌桌菜单" aria-expanded="false">☰</button>
  </header>
  <span id="table-notice" class="sr-only" aria-live="polite"></span>
  <div id="table-body">
    <aside id="player-rail" aria-label="玩家摘要"></aside>
    <section id="table-surface" aria-label="四座牌桌">
      <div id="tutorial-slot"></div>
      <div id="board-scroll">
        <div id="board-grid">
          ${seatSlotHTML('top')}
          ${seatSlotHTML('left')}
          ${seatSlotHTML('right')}
          ${seatSlotHTML('self')}
          <div id="table-center">
            <div id="deck-pile" aria-label="中央牌堆">
              <div class="deck-card deck-a"></div><div class="deck-card deck-b"></div><div class="deck-card deck-c"></div>
              <span id="deck-count"></span>
            </div>
            <div id="center-pot"><span>奖池</span><strong id="center-pot-num"></strong></div>
            <p id="table-caption" role="status" aria-live="polite"></p>
            <p id="turn-caption"></p>
          </div>
        </div>
      </div>
    </section>
  </div>
  <main id="dock">
    <div id="round-result" hidden></div>
    <div id="play-controls">
      <div class="turn-line"><span id="phase-tip"></span><span id="countdown"></span></div>
      <div id="composition"><div><h1 id="current-type">选牌</h1><span id="preview-detail" class="quiet"></span></div><button id="rank-toggle" class="ghost" aria-expanded="false" aria-controls="rank-reference">牌型 ›</button></div>
      <div id="hand" aria-label="我的手牌"></div>
      <div id="bet-row"><details id="bet-details"><summary id="bet-summary">再投 0</summary><div class="bet-content"><span id="bet-limits"></span><button id="bet-minus" aria-label="减少投入">−</button><input id="bet-input" aria-label="本次投入" type="number" step="1" inputmode="numeric"><button id="bet-plus" aria-label="增加投入">+</button></div></details></div>
      <div id="action-bar"><div id="secondary-actions"></div><button id="commit" class="primary" disabled>选牌</button></div>
      <p id="action-feedback" role="status"></p>
    </div>
  </main>
  <section id="rank-reference" hidden aria-label="牌型查询"><div class="rank-head"><span class="rank-directions"><span>弱 ←</span><span id="rank-current-label"></span><span>→ 强</span></span><button class="ghost" data-rank-close>关闭</button></div><div id="rank-rail"></div><div id="rank-detail"></div></section>
  <dialog id="player-dialog" aria-labelledby="player-dialog-title"></dialog>
  <aside id="table-menu" class="popover" hidden><div class="popover-heading">牌桌<button class="ghost" data-close>关闭</button></div><p id="room-code"></p><button id="btn-types" class="menu-row">全部牌型</button><button id="btn-history" class="menu-row">记录</button><button id="btn-mute" class="menu-row"></button><button id="btn-motion" class="menu-row"></button><button id="btn-tutorial-close" class="menu-row">收起教学</button><button id="btn-exit" class="menu-row">离开</button></aside>
  <aside id="seat-detail" class="popover" hidden></aside>
  <aside id="drawer" aria-label="全部牌型"></aside>
  <div id="overlay"></div>
 </div>`;

  renderHandTypes($('#drawer'));
  text($('#room-code'), `房间 ${getState().view?.code ?? ''}`);

  const closeMenu = () => {
    $('#table-menu').hidden = true;
    $('#table-menu-button').setAttribute('aria-expanded', 'false');
  };
  $('#table-menu-button').onclick = () => {
    const element = $('#table-menu');
    element.hidden = !element.hidden;
    $('#table-menu-button').setAttribute('aria-expanded', String(!element.hidden));
  };
  root.querySelectorAll('[data-close]').forEach((node) => {
    (node as HTMLElement).onclick = closeMenu;
  });
  $('#btn-types').onclick = () => {
    closeMenu();
    toggleDrawer();
  };
  $('#btn-history').onclick = () => {
    showDetail(
      '记录',
      history.map((line) => `<p>${html(line)}</p>`).join('') || '<p>暂无记录</p>',
    );
    closeMenu();
  };
  const mute = $('#btn-mute');
  text(mute, isMuted() ? '声音：关' : '声音：开');
  mute.onclick = () => text(mute, toggleMute() ? '声音：关' : '声音：开');
  const motion = $('#btn-motion');
  const motionLabel = () =>
    text(
      motion,
      document.documentElement.dataset.motion === 'reduced' ? '动效：减弱' : '动效：标准',
    );
  motionLabel();
  motion.onclick = () => {
    const reduce = document.documentElement.dataset.motion !== 'reduced';
    document.documentElement.dataset.motion = reduce ? 'reduced' : 'standard';
    localStorage.setItem('castle.motion', reduce ? 'reduced' : 'standard');
    resetQueue('motion');
    render(true);
    motionLabel();
  };
  $('#btn-exit').onclick = () => {
    showDetail(
      '离开牌桌',
      '<p>离开后将由托管接手。</p><button id="confirm-leave" class="primary">离开</button>',
    );
    closeMenu();
    $('#confirm-leave').onclick = () => {
      unmountTable();
      clearSession();
      location.href = '/';
    };
  };
  $('#btn-tutorial-close').hidden = !tutorialActive();
  $('#btn-tutorial-close').onclick = () => {
    exitTutorial();
    $('#btn-tutorial-close').hidden = true;
  };

  const betDetails = $('#bet-details') as HTMLDetailsElement;
  const closeBet = () => {
    if (betDetails.open) betDetails.open = false;
  };
  $('#rank-toggle').onclick = () => {
    rankOpen = !rankOpen;
    if (rankOpen) closeBet();
    renderDecision();
  };
  $('[data-rank-close]').onclick = () => {
    rankOpen = false;
    renderDecision();
  };
  betDetails.addEventListener('toggle', () => {
    if (betDetails.open && rankOpen) {
      rankOpen = false;
      queryRank = 0;
      renderDecision();
    }
  });
  $('#rank-rail').onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-rank]');
    if (!button) return;
    queryRank = Number(button.dataset.rank);
    renderRankDetail();
  };
  $('#rank-detail').onclick = (event) => {
    const button = (event.target as HTMLElement).closest('[data-select-type]');
    if (!button) return;
    const view = getState().view!;
    const found = matchingSelection(view, queryRank || currentRank());
    if (found) {
      patchUI({ selected: found, bet: null, escrow: null });
      rankOpen = false;
      queryRank = 0;
      renderDecision();
    }
  };
  const pickHand = (event: Event) => {
    const node = (event.target as HTMLElement).closest<HTMLElement>('.card');
    const view = getState().view;
    if (
      !node?.dataset.id ||
      actionsLocked(view) ||
      !view ||
      view.you.status !== 'active'
    ) {
      return;
    }
    toggleSelect(node.dataset.id);
    queryRank = 0;
    foldConfirm = false;
    sfx.click();
    renderDecision();
  };
  $('#hand').onclick = pickHand;
  $('#hand').onkeydown = (event) => {
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      (event.target as HTMLElement).matches('.card')
    ) {
      event.preventDefault();
      pickHand(event);
    }
  };
  $('#commit').onclick = () => {
    const view = getState().view;
    const ui = getState().ui;
    if (!view || actionsLocked(view)) return;
    const choice = decision(view, ui.selected, ui.bet, ui.escrow);
    if (choice.action) void submit(choice.action);
  };
  const adjust = (amount: number) => {
    const view = getState().view!;
    const ui = getState().ui;
    const choice = decision(view, ui.selected, ui.bet, ui.escrow);
    patchUI(
      choice.defense
        ? { escrow: Math.max(choice.min, Math.min(choice.max, amount)) }
        : { bet: Math.max(choice.min, Math.min(choice.max, amount)) },
    );
  };
  $('#bet-minus').onclick = () =>
    adjust(Number(($('#bet-input') as HTMLInputElement).value) - 1);
  $('#bet-plus').onclick = () =>
    adjust(Number(($('#bet-input') as HTMLInputElement).value) + 1);
  const syncBet = () => adjust(Number(($('#bet-input') as HTMLInputElement).value));
  $('#bet-input').onchange = syncBet;
  $('#bet-input').oninput = syncBet;
  $('#player-rail').onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-info]');
    if (button) openDialog(Number(button.dataset.info), button);
  };
  root.querySelectorAll<HTMLElement>('.seat-avatar').forEach((button) => {
    button.onclick = () => {
      const seat = Number(button.dataset.info);
      if (Number.isInteger(seat)) openDialog(seat, button);
    };
  });

  const dialog = $('#player-dialog') as HTMLDialogElement;
  dialog.addEventListener('close', () => {
    dialogSeat = null;
    delete dialog.dataset.sig;
    const trigger = dialogTrigger;
    dialogTrigger = null;
    if (dialogRefocus && trigger?.isConnected) trigger.focus();
    dialogRefocus = true;
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const panel = dialog.firstElementChild as HTMLElement | null;
    if (panel) {
      const r = panel.getBoundingClientRect();
      if (
        event.clientX >= r.left &&
        event.clientX <= r.right &&
        event.clientY >= r.top &&
        event.clientY <= r.bottom
      ) {
        return;
      }
    }
    dialog.close();
  });
  root.onkeydown = (event) => {
    if (event.key !== 'Escape') return;
    toggleDrawer(false);
    closeMenu();
    $('#seat-detail').hidden = true;
    if (rankOpen) {
      rankOpen = false;
      renderDecision();
    }
  };

  setFxHooks({
    renderAll: () => render(true),
    renderCards: () => renderCards(),
    seatEl: (seat) =>
      root?.querySelector<HTMLElement>(`.seat-slot[data-seat="${seat}"] .seat-avatar`) ??
      null,
    bfZoneEl: (seat) =>
      root?.querySelector<HTMLElement>(`.seat-slot[data-seat="${seat}"] .seat-battlefield`) ??
      null,
    deckEl: () => root?.querySelector<HTMLElement>('#deck-pile') ?? null,
    dealZoneEl: (seat) =>
      seat === getState().view?.you.seat
        ? root?.querySelector<HTMLElement>('#hand') ?? null
        : root?.querySelector<HTMLElement>(
              `.seat-slot[data-seat="${seat}"] .seat-avatar`,
            ) ??
          null,
    potEl: () => root?.querySelector<HTMLElement>('#pot-block') ?? null,
    handEl: () => root?.querySelector<HTMLElement>('#hand') ?? null,
    dealBegin: (counts) => beginDeal(counts),
    dealEnd: () => endDeal(),
    settlementPrepare: (entries) => prepareSettlement(entries),
    settlementSequence: () => settlement?.sequence ?? null,
    settlementReplayStart: () => {
      if (!settlement) return;
      settlement.index = -1;
      settlement.complete = false;
      settlement.instant = false;
      setPresentationPaused(false);
      render(true);
    },
    settlementStep: (step, index) => {
      if (!settlement) return;
      settlement.index = index;
      settlement.complete = false;
      setCaption(settlementCaption(step, settlement.sequence));
      render(true);
    },
    settlementDone: (instant) => {
      if (!settlement) return;
      settlement.index = settlement.sequence.steps.length - 1;
      settlement.complete = true;
      settlement.instant = instant;
      setPresentationPaused(false);
      setCaption('结算完成 · 等待仍在局中的每位玩家确认继续');
      render(true);
    },
    settlementAbort: () => {
      const view = getState().view;
      settlement = view && resultActive(view) ? instantSettlement(view) : null;
      setPresentationPaused(false);
      if (settlement) setCaption('结算已完成 · 可以查看完整结果');
    },
    caption: (line) => setCaption(line),
    report: (line) => {
      history.push(line);
      if (history.length > 40) history.shift();
      if (root) text($('#table-notice'), line);
    },
  });

  tick();
  render(true);
}

function seatSlotHTML(role: string): string {
  return `<article class="seat-slot seat-${role}" data-role="${role}" hidden>
    <div class="seat-head">
      <button class="seat-avatar" type="button"></button>
      <div class="seat-id"><span class="seat-name"></span><span class="seat-meta"></span><span class="seat-status"></span></div>
    </div>
    <div class="seat-hand" aria-label="手牌数量"></div>
    <div class="seat-battlefield" aria-label="出战区"></div>
  </article>`;
}

function playerAt(view: PlayerView, seat: number | null): SeatPlayer | null {
  if (seat === null) return null;
  return seat === view.you.seat
    ? view.you
    : (view.players.find((player) => player.seat === seat) ?? null);
}

function avatarOf(player: SeatPlayer, tutorial: boolean): string {
  return shownAvatar(
    { avatar: player.avatar, isBot: 'isBot' in player ? player.isBot : false },
    tutorial,
  );
}

function labelOf(player: SeatPlayer): string {
  return player.name || `座位 ${player.seat}`;
}

function nextReadyOf(player: SeatPlayer): boolean {
  return player.nextReady;
}

function survivorsOf(view: PlayerView): number[] {
  const seats = view.players
    .filter((player) => player.status !== 'out')
    .map((player) => player.seat);
  if (view.you.status !== 'out' && !seats.includes(view.you.seat)) {
    seats.push(view.you.seat);
  }
  return seats;
}

function canReadyNext(view: PlayerView): boolean {
  if (view.phase !== 'playing') return false;
  if (view.roundPhase !== 'settlement' || view.you.status === 'out') return false;
  return view.you.legalActions.canReadyNext;
}

function readyCount(view: PlayerView): number {
  let count = 0;
  for (const seat of survivorsOf(view)) {
    const player =
      seat === view.you.seat
        ? view.you
        : view.players.find((item) => item.seat === seat);
    if (player && nextReadyOf(player)) count += 1;
  }
  return count;
}

function actionsLocked(view: PlayerView | null): boolean {
  if (!view) return true;
  return (
    pending ||
    !getState().ui.connected ||
    isBusy() ||
    (settlement !== null && !settlement.complete) ||
    resultActive(view)
  );
}

function readySubmissionLocked(view: PlayerView | null): boolean {
  return (
    !view ||
    pending ||
    !getState().ui.connected ||
    isBusy() ||
    !settlement?.complete ||
    !canReadyNext(view)
  );
}

function settlementStep(): SettlementStep | null {
  if (!settlement || settlement.index < 0) return null;
  return settlement.sequence.steps[settlement.index] ?? null;
}

function activeSeatFor(view: PlayerView): number | null {
  if (!resultActive(view)) return view.turnSeat;
  return settlement ? revealState().activeSeat : null;
}

interface CriterionSeatState {
  tone: 'survives' | 'eliminated' | 'pending';
  status: string;
}

function criterionSeatState(seat: number): CriterionSeatState | null {
  if (!settlement || settlement.complete) return null;
  let latest = -1;
  for (let index = 0; index <= settlement.index; index += 1) {
    if (settlement.sequence.steps[index].kind === 'criterion') latest = index;
  }
  if (latest < 0) return null;
  const latestStep = settlement.sequence.steps[latest];
  if (latestStep.kind !== 'criterion') return null;
  const scope = latestStep.scope;
  const records = new Map<
    number,
    { survives: boolean; round: number }
  >();
  for (let index = latest; index >= 0; index -= 1) {
    const step = settlement.sequence.steps[index];
    if (step.kind !== 'criterion' || step.scope !== scope) break;
    for (const row of step.rows) {
      if (!records.has(row.seat)) {
        records.set(row.seat, { survives: row.survives, round: step.round });
      }
    }
  }
  const record = records.get(seat);
  if (!record) return null;
  const mark = ['', '①', '②', '③', '④'][record.round] ?? String(record.round);
  const label = scope === 'field' ? '全场' : '奖池';
  if (record.survives) {
    return {
      tone: 'survives',
      status: `${label}比较保留`,
    };
  }
  if (
    scope === 'field' &&
    settlement.sequence.prizeCandidates.includes(seat)
  ) {
    return {
      tone: 'pending',
      status: `已在${mark}全场淘汰 · 仍争奖池`,
    };
  }
  return {
    tone: 'eliminated',
    status: `已在${mark}${label}淘汰`,
  };
}

function criterionTone(
  seat: number,
): 'survives' | 'eliminated' | 'pending' | null {
  return criterionSeatState(seat)?.tone ?? null;
}

function activeCriterionScope(): 'field' | 'prize' | null {
  if (!settlement || settlement.complete) return null;
  for (let index = settlement.index; index >= 0; index -= 1) {
    const step = settlement.sequence.steps[index];
    if (step.kind === 'criterion') return step.scope;
  }
  return null;
}

function revealState(): RevealState {
  const counts = new Map<number, number>();
  const judged = new Set<number>();
  let activeSeat: number | null = null;
  if (!settlement) return { counts, activeSeat, judged };
  if (settlement.complete) {
    for (const entry of settlement.sequence.entries) {
      counts.set(entry.seat, entry.cards.length);
      judged.add(entry.seat);
    }
    return { counts, activeSeat, judged };
  }
  for (let index = 0; index <= settlement.index; index += 1) {
    const step = settlement.sequence.steps[index];
    if (step.kind === 'reveal-start') {
      counts.set(step.seat, 0);
      activeSeat = step.seat;
    } else if (step.kind === 'reveal-card') {
      counts.set(step.seat, Math.max(counts.get(step.seat) ?? 0, step.cardIndex + 1));
      activeSeat = step.seat;
    } else if (step.kind === 'reveal-hold') {
      counts.set(step.seat, step.entry.cards.length);
      judged.add(step.seat);
      activeSeat = step.seat;
    } else if (step.kind === 'no-entry') {
      activeSeat = step.seat;
    } else {
      activeSeat = null;
    }
  }
  return { counts, activeSeat, judged };
}

function setCaption(line: string) {
  captionText = line;
  if (!root) return;
  text($('#table-caption'), line);
  text($('#table-notice'), line);
}

function beginDeal(counts: [number, number][]) {
  const view = getState().view;
  if (!view) return;
  dealActive = true;
  const ownCount = counts.find(([seat]) => seat === view.you.seat)?.[1] ?? 0;
  let newIds =
    ownCount === 0
      ? []
      : view.you.hand
          .map((card) => card.id)
          .filter((id) => !knownHandIds.has(id));
  if (ownCount > 0 && newIds.length < ownCount) {
    newIds = view.you.hand.slice(-ownCount).map((card) => card.id);
  }
  dealingHiddenIds = new Set(newIds);
  renderCards();
}

function endDeal() {
  const view = getState().view;
  dealActive = false;
  dealingHiddenIds.clear();
  if (view) knownHandIds = new Set(view.you.hand.map((card) => card.id));
  renderCards();
}

function prepareSettlement(entries: ShowdownEntry[]) {
  const view = getState().view;
  if (!view?.result) return;
  const sequence = buildSettlementSequence(
    view.result,
    settlementPlayers(view),
    view.you.seat,
    entries,
  );
  settlement = { sequence, index: -1, complete: false, instant: false };
  setPresentationPaused(false);
  setCaption('摊牌准备 · 接下来逐位玩家、逐张牌公开');
  if (root) render(true);
}

export function render(sync = false) {
  const view = getState().view;
  if (!view || !root) return;
  const hasResult = resultActive(view);
  if (!hasResult) {
    settlement = null;
    rememberSafeValues(view);
  } else {
    ensureSettlement(view);
    if (settlement?.complete) rememberSafeValues(view);
    rankOpen = false;
  }

  text($('#round-info'), view.roundNo ? `第 ${view.roundNo} 回合` : '');
  text($('#connection'), getState().ui.connected ? '' : '重连中');
  text($('#pot-num'), shownPot(view));
  text($('#center-pot-num'), shownPot(view));
  text($('#deck-count'), `${view.deckCount} 张`);
  text(
    $('#ready-summary'),
    settlement?.complete &&
      view.phase === 'playing' &&
      view.roundPhase === 'settlement'
      ? `准备 ${readyCount(view)}/${survivorsOf(view).length}`
      : '',
  );
  text($('#table-caption'), captionText);
  text(
    $('#turn-caption'),
    view.roundPhase === 'defense_window'
      ? '防守窗口'
      : view.roundPhase === 'opening'
        ? '开局出牌'
        : view.roundPhase === 'rotation'
          ? '轮转'
          : view.roundPhase === 'settlement'
            ? '摊牌结算'
            : view.phase === 'gameover'
              ? '终局'
              : '',
  );

  renderSeats(view);
  renderRail(view);
  renderDialog(view);
  renderResult(view);
  renderDecision();
  if (!isBusy() || dealActive || hasResult || sync) renderCards();
  if (tutorialActive()) renderTutorial(view, getState().ui.selected);
}

function renderSeats(view: PlayerView) {
  const layout = seatLayout(
    view.you.seat,
    view.players.map((player) => player.seat),
  );
  const byRole = new Map(layout.map((item) => [item.role, item.seat]));
  for (const role of ['top', 'left', 'right', 'self']) {
    const slot = root!.querySelector<HTMLElement>(`.seat-slot[data-role="${role}"]`);
    if (!slot) continue;
    const seat = byRole.get(role as 'top' | 'left' | 'right' | 'self') ?? null;
    if (seat === null) {
      slot.hidden = true;
      delete slot.dataset.seat;
      continue;
    }
    slot.hidden = false;
    slot.dataset.seat = String(seat);
    const player = playerAt(view, seat);
    if (!player) continue;
    slot.classList.toggle('mine', seat === view.you.seat);
    const actingSeat = activeSeatFor(view);
    const tone = criterionTone(seat);
    slot.classList.toggle(
      'active',
      actingSeat === seat &&
        (resultActive(view) || player.status === 'active'),
    );
    slot.classList.toggle('criterion-survives', tone === 'survives');
    slot.classList.toggle('criterion-eliminated', tone === 'eliminated');
    slot.classList.toggle('criterion-pending', tone === 'pending');
    slot.classList.toggle(
      'inactive',
      player.status === 'out' && !deferredOut(view, seat),
    );
    slot.classList.toggle('folded', player.status === 'folded');
    const avatarButton = slot.querySelector<HTMLElement>('.seat-avatar')!;
    avatarButton.dataset.info = String(seat);
    avatarButton.setAttribute('aria-label', `查看 ${labelOf(player)} 的详情`);
    const face = avatarOf(player, tutorialActive());
    if (avatarButton.dataset.face !== face) {
      avatarButton.dataset.face = face;
      avatarButton.innerHTML = avatarSVG(face, 'neutral', 2, seat);
    }
    text(slot.querySelector('.seat-name'), labelOf(player));
    const count =
      seat === view.you.seat
        ? view.you.hand.length
        : 'handCount' in player
          ? player.handCount
          : 0;
    const meta = [
      `${shownChips(player)} 筹`,
      player.betTotal ? `押 ${player.betTotal}` : '',
      `手 ${count}`,
    ]
      .filter(Boolean)
      .join(' · ');
    text(slot.querySelector('.seat-meta'), meta);
    const status = seatStatus(view, player);
    text(slot.querySelector('.seat-status'), status);
    const statusNode = slot.querySelector<HTMLElement>('.seat-status')!;
    statusNode.hidden = !status;
    const hand = slot.querySelector<HTMLElement>('.seat-hand')!;
    keyed(hand, `${seat}:${count}`, () => {
      hand.replaceChildren(createBacks(count, 5));
      const label = document.createElement('span');
      label.className = 'seat-hand-count';
      label.textContent = `${count} 张`;
      hand.append(label);
    });
  }
}

function seatStatus(view: PlayerView, player: SeatPlayer): string {
  if (settlement && !settlement.complete) {
    const criterionState = criterionSeatState(player.seat);
    if (criterionState) return criterionState.status;
    const scope = activeCriterionScope();
    if (scope) {
      if (scope === 'field') {
        return player.status === 'folded' ? '已弃牌 · 不参与比较' : '不参与全场比较';
      }
      if (settlement.sequence.defenderSeats.includes(player.seat)) {
        return '防守托管已判定';
      }
      return player.status === 'folded' ? '已弃牌' : '不参与奖池竞夺';
    }
    const reveal = revealState();
    if (reveal.activeSeat === player.seat) return '正在亮牌';
    if ((reveal.counts.get(player.seat) ?? 0) > 0) return '已亮牌';
    if (player.status === 'folded') return '已弃牌';
    if (player.status === 'defended') return '防守中';
    return '结算中';
  }
  if (settlement?.complete && resultActive(view)) {
    if (view.phase === 'gameover') {
      if (player.seat === view.winnerSeat) return '对局胜者';
      return player.status === 'out' ? '出局' : '对局结束';
    }
    if (player.status === 'out') return '出局';
    return nextReadyOf(player) ? '已准备' : '等待准备';
  }
  if (player.status === 'out') return '出局';
  if (player.status === 'folded') return '弃牌';
  if (player.status === 'defended') return `防守 · 托管 ${player.escrow}`;
  if (player.away) return '断线托管';
  if (player.agreeEnd) return '同意摊牌';
  if (view.turnSeat === player.seat && view.roundPhase !== 'settlement') {
    return '行动中';
  }
  return shortStatus(player.lastAction ?? '');
}

function renderRail(view: PlayerView) {
  const rail = $('#player-rail');
  const tutorial = tutorialActive();
  const order = seatLayout(
    view.you.seat,
    view.players.map((player) => player.seat),
  ).map((item) => item.seat);
  for (const seat of order) {
    const player = playerAt(view, seat);
    if (!player) continue;
    let item = rail.querySelector<HTMLElement>(`[data-seat="${seat}"]`);
    if (!item) {
      item = document.createElement('article');
      item.className = 'rail-item';
      item.dataset.seat = String(seat);
      item.innerHTML = `<button class="rail-avatar" data-info="${seat}"></button><div class="rail-info"><span class="rail-name"></span><span class="rail-meta"></span><span class="rail-status"></span><span class="rail-ready"></span></div>`;
      rail.append(item);
    }
    item.classList.toggle('self', seat === view.you.seat);
    const actingSeat = activeSeatFor(view);
    const tone = criterionTone(seat);
    item.classList.toggle(
      'active',
      actingSeat === seat &&
        (resultActive(view) || player.status === 'active'),
    );
    item.classList.toggle('criterion-survives', tone === 'survives');
    item.classList.toggle('criterion-eliminated', tone === 'eliminated');
    item.classList.toggle('criterion-pending', tone === 'pending');
    item.classList.toggle(
      'inactive',
      player.status === 'out' && !deferredOut(view, seat),
    );
    const avatar = item.querySelector<HTMLElement>('.rail-avatar')!;
    avatar.dataset.info = String(seat);
    avatar.setAttribute('aria-label', `查看 ${labelOf(player)} 的详情`);
    const face = avatarOf(player, tutorial);
    if (avatar.dataset.face !== face) {
      avatar.dataset.face = face;
      avatar.innerHTML = avatarSVG(face, 'neutral', 1, seat);
    }
    text(item.querySelector('.rail-name'), labelOf(player));
    text(
      item.querySelector('.rail-meta'),
      `${shownChips(player)} 筹${player.betTotal ? ` · 押 ${player.betTotal}` : ''}`,
    );
    const status = seatStatus(view, player);
    const statusNode = item.querySelector<HTMLElement>('.rail-status')!;
    text(statusNode, status);
    statusNode.hidden = !status;
    const ready = item.querySelector<HTMLElement>('.rail-ready')!;
    ready.hidden = !(
      settlement?.complete &&
      view.phase === 'playing' &&
      view.roundPhase === 'settlement'
    );
    if (!ready.hidden) {
      text(ready, nextReadyOf(player) ? '✓ 已准备' : '未准备');
      ready.classList.toggle('is-ready', nextReadyOf(player));
    }
  }
  for (const item of rail.querySelectorAll<HTMLElement>('[data-seat]')) {
    if (!order.includes(Number(item.dataset.seat))) item.remove();
  }
}

export function renderCards() {
  const view = getState().view;
  if (!view || !root) return;
  const reveal = revealState();
  for (const slot of root.querySelectorAll<HTMLElement>('.seat-slot[data-seat]')) {
    const seat = Number(slot.dataset.seat);
    const field = slot.querySelector<HTMLElement>('.seat-battlefield');
    if (!field) continue;
    const entry = settlement?.sequence.entries.find((item) => item.seat === seat) ?? null;
    segmentsInto(field, seat, view, {
      mini: true,
      entry: settlement ? entry : null,
      revealCount: reveal.counts.get(seat) ?? 0,
      judged: Boolean(entry && reveal.judged.has(seat)),
    });
  }

  const hand = $('#hand');
  const selected = new Set(getState().ui.selected);
  const cards = [...view.you.hand].sort(
    (a, b) => b.rank - a.rank || b.suit - a.suit,
  );
  hand.style.setProperty('--hand-count', String(Math.max(1, cards.length)));
  for (const card of cards) {
    let node = [...hand.children].find(
      (child) => (child as HTMLElement).dataset.id === card.id,
    ) as HTMLElement | undefined;
    if (!node) {
      node = createCard(card, { up: true });
      node.setAttribute('role', 'button');
      node.tabIndex = 0;
      node.setAttribute('aria-label', cardLabel(card));
      hand.append(node);
    }
    node.classList.toggle('sel', selected.has(card.id));
    node.setAttribute('aria-pressed', String(selected.has(card.id)));
    node.style.visibility = dealingHiddenIds.has(card.id) ? 'hidden' : '';
  }
  for (const node of [...hand.children]) {
    if (!cards.some((card) => card.id === (node as HTMLElement).dataset.id)) {
      node.remove();
    }
  }
  if (!dealActive) knownHandIds = new Set(cards.map((card) => card.id));
}

interface SegmentOptions {
  mini?: boolean;
  entry: ShowdownEntry | null;
  revealCount: number;
  judged: boolean;
}

function segmentsInto(
  element: HTMLElement,
  seat: number,
  view: PlayerView,
  options: SegmentOptions,
) {
  const own = seat === view.you.seat;
  const player = playerAt(view, seat);
  if (!player) {
    element.replaceChildren();
    return;
  }
  if (!options.entry) {
    const signature = JSON.stringify([
      'play',
      seat,
      own ? view.you.battlefield.map((card) => card.id) : null,
      player.playSegments,
      options.mini ? 1 : 0,
    ]);
    keyed(element, signature, () => {
      element.replaceChildren();
      let offset = 0;
      for (const segment of player.playSegments) {
        const group = document.createElement('div');
        group.className = 'play-segment';
        group.setAttribute(
          'aria-label',
          `${segment.count} 张${segment.top ? `，公开 ${cardLabel(segment.top)}` : '，暗牌'}`,
        );
        const badge = document.createElement('span');
        badge.className = 'seg-count';
        badge.textContent = String(segment.count);
        group.append(badge);
        for (let index = 0; index < segment.count; index += 1) {
          if (own) {
            const card = view.you.battlefield[offset + index] ?? null;
            group.append(createCard(card, { mini: options.mini, up: !!card }));
          } else {
            const top = index === 0 ? (segment.top ?? null) : null;
            group.append(createCard(top, { mini: options.mini, up: !!top }));
          }
        }
        offset += segment.count;
        element.append(group);
      }
    });
    return;
  }

  const entry = options.entry;
  const signature = JSON.stringify([
    'settlement',
    seat,
    entry.cards.map((card) => card.id),
    entry.usedIds,
    options.mini ? 1 : 0,
  ]);
  keyed(element, signature, () => {
    element.replaceChildren();
    const group = document.createElement('div');
    group.className = 'play-segment settlement-hand';
    const badge = document.createElement('span');
    badge.className = 'seg-count';
    badge.textContent = `${entry.cards.length} 张`;
    group.append(badge);
    entry.cards.forEach((card) => {
      const wrapper = document.createElement('span');
      wrapper.className = 'judged-card';
      wrapper.dataset.cardId = card.id;
      wrapper.append(createCard(card, { mini: options.mini }));
      const flag = document.createElement('span');
      flag.className = 'card-role';
      wrapper.append(flag);
      group.append(wrapper);
    });
    element.append(group);
  });

  // Keep the same card nodes across reveal steps. Toggling `.up` runs the
  // existing CSS flip transition; rebuilding an already-up card would skip it.
  const group = element.querySelector<HTMLElement>('.settlement-hand');
  if (!group) return;
  const wrappers = [...group.querySelectorAll<HTMLElement>('.judged-card')];
  wrappers.forEach((wrapper, index) => {
    const card = wrapper.querySelector<HTMLElement>('.card');
    const front = wrapper.querySelector<HTMLElement>('.face.front');
    const used = entry.usedIds.includes(wrapper.dataset.cardId ?? '');
    const up = index < options.revealCount;
    card?.classList.toggle('up', up);
    if (front) {
      if (up) front.removeAttribute('aria-hidden');
      else front.setAttribute('aria-hidden', 'true');
    }
    wrapper.classList.toggle('used', options.judged && used);
    wrapper.classList.toggle('junk', options.judged && !used);
    const flag = wrapper.querySelector<HTMLElement>('.card-role');
    if (flag) {
      flag.textContent = options.judged ? (used ? '用' : '杂') : '';
      flag.hidden = !options.judged;
    }
  });
  group.setAttribute(
    'aria-label',
    `本回合出战 ${entry.cards.length} 张，已亮 ${options.revealCount} 张`,
  );
}

function showDetail(title: string, body: string) {
  const element = $('#seat-detail');
  element.innerHTML = `<div class="popover-heading">${html(title)}<button class="ghost" data-dismiss>关闭</button></div>${body}`;
  element.hidden = false;
  element.querySelector<HTMLElement>('[data-dismiss]')!.onclick = () => {
    element.hidden = true;
  };
}

async function submit(action: GameAction) {
  const start = getState().view;
  const locked = action.t === 'ready_next' ? readySubmissionLocked(start) : actionsLocked(start);
  if (locked) return;
  if (!start || !root) return;
  pending = true;
  if (
    action.t === 'play' ||
    action.t === 'add_cards' ||
    action.t === 'declare_defense'
  ) {
    const nodes = [...$('#hand').children].map((node) => node as HTMLElement);
    stageOwnPlay(
      action.cardIds
        .map((id) => {
          const node = nodes.find((item) => item.dataset.id === id);
          return node ? { id, rect: node.getBoundingClientRect() } : null;
        })
        .filter((item): item is { id: string; rect: DOMRect } => item !== null),
    );
  } else {
    clearStagedOwnPlay();
  }
  const code = start.code;
  const round = start.roundNo;
  renderDecision();
  try {
    const ok = await gameAction(action);
    const now = getState().view;
    if (now && now.code === code && now.roundNo === round) {
      if (ok) patchUI({ selected: [], bet: null, escrow: null });
      else {
        clearStagedOwnPlay();
        if (root) text($('#action-feedback'), getState().ui.toast?.msg ?? '请重试');
      }
      foldConfirm = false;
    }
  } finally {
    pending = false;
    const now = getState().view;
    if (root && now?.code === code && now?.roundNo === round) {
      renderDecision();
      renderResult(now);
    }
  }
}

function openDialog(seat: number, trigger: HTMLElement | null) {
  const view = getState().view;
  const dialog = root?.querySelector<HTMLDialogElement>('#player-dialog');
  if (!view || !dialog || !playerAt(view, seat)) return;
  dialogSeat = seat;
  dialogTrigger = trigger;
  delete dialog.dataset.sig;
  renderDialog(view);
  if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLElement>('[data-dialog-close]')?.focus();
}

function closeDialog(refocus = true) {
  dialogRefocus = refocus;
  const dialog = root?.querySelector<HTMLDialogElement>('#player-dialog');
  if (dialog?.open) dialog.close();
  else {
    dialogSeat = null;
    dialogTrigger = null;
    if (dialog) delete dialog.dataset.sig;
  }
}

function dialogSignature(view: PlayerView, seat: number): string {
  const player = playerAt(view, seat);
  const reveal = revealState();
  return JSON.stringify([
    seat,
    player?.name,
    player?.avatar,
    player ? shownChips(player) : null,
    player?.betTotal,
    player?.escrow,
    player?.status,
    player?.lastAction,
    player?.playSegments,
    view.turnSeat,
    view.roundPhase,
    view.phase,
    settleEntry(seat)?.cards.map((card) => card.id) ?? null,
    reveal.counts.get(seat) ?? 0,
    settlement?.complete ?? false,
  ]);
}

function settleEntry(seat: number): ShowdownEntry | null {
  return settlement?.sequence.entries.find((entry) => entry.seat === seat) ?? null;
}

function renderDialog(view: PlayerView) {
  const dialog = root?.querySelector<HTMLDialogElement>('#player-dialog');
  if (!dialog) return;
  if (dialogSeat === null) {
    if (dialog.open) dialog.close();
    return;
  }
  const seat = dialogSeat;
  const player = playerAt(view, seat);
  if (!player) {
    dialog.close();
    return;
  }
  const signature = dialogSignature(view, seat);
  if (dialog.dataset.sig === signature) return;
  dialog.dataset.sig = signature;
  const own = seat === view.you.seat;
  const publicPlayer = view.players.find((item) => item.seat === seat);
  const handCount = own ? view.you.hand.length : (publicPlayer?.handCount ?? 0);
  const played = own ? view.you.battlefield.length : (publicPlayer?.battlefieldCount ?? 0);
  const rows: [string, string][] = [
    ['筹码', String(shownChips(player))],
    ['已押', String(player.betTotal)],
    ['托管', String(player.escrow)],
    ['状态', seatStatus(view, player) || '—'],
    ['手牌', `${handCount} 张`],
    ['出战', `${played} 张`],
  ];
  const keepFocus = !!document.activeElement && dialog.contains(document.activeElement);
  const showLastAction =
    !!player.lastAction && !(settlement !== null && !settlement.complete);
  dialog.innerHTML = `<div class="dlg-panel">
    <div class="dlg-head"><h2 id="player-dialog-title">${html(labelOf(player))}</h2><button class="ghost" data-dialog-close>关闭</button></div>
    <div class="dlg-top"><div class="dlg-avatar">${avatarSVG(avatarOf(player, tutorialActive()), 'neutral', 2, seat)}</div><dl class="dlg-stats">${rows
      .map(([label, value]) => `<div><dt>${html(label)}</dt><dd>${html(value)}</dd></div>`)
      .join('')}</dl></div>
    ${showLastAction ? `<p class="dlg-last">最近动作：${html(player.lastAction)}</p>` : ''}
    <h3 class="dlg-sub">出战区</h3>
    <div class="dlg-segs"></div>
  </div>`;
  dialog.querySelector<HTMLElement>('[data-dialog-close]')!.onclick = () => closeDialog();
  const reveal = revealState();
  const entry = settleEntry(seat);
  segmentsInto(dialog.querySelector<HTMLElement>('.dlg-segs')!, seat, view, {
    entry: settlement ? entry : null,
    revealCount: reveal.counts.get(seat) ?? 0,
    judged: Boolean(entry && reveal.judged.has(seat)),
  });
  if (dialog.open && keepFocus) {
    dialog.querySelector<HTMLElement>('[data-dialog-close]')!.focus();
  }
}

function currentRank(): number {
  const view = getState().view!;
  const ui = getState().ui;
  return decision(view, ui.selected, ui.bet, ui.escrow).preview?.hand.typeRank ?? 0;
}

function renderRankDetail() {
  const view = getState().view!;
  const rank = queryRank || currentRank() || 1;
  const type = HAND_TYPES[rank - 1];
  const found = matchingSelection(view, rank);
  $('#rank-detail').innerHTML = `<span>${type.alias} · ${type.name}${type.size > 0 && type.name !== '高牌' ? ` · ${type.size} 张` : ''}</span>${found ? '<button class="ghost" data-select-type>预选</button>' : '<span class="quiet">当前手牌凑不出</span>'}`;
}

function renderDecision() {
  const view = getState().view;
  if (!root || !view) return;
  const ui = getState().ui;
  const choice = decision(view, ui.selected, ui.bet, ui.escrow);
  const legal = view.you.legalActions;
  text($('#current-type'), choice.preview?.hand.name ?? '选牌');
  text($('#preview-detail'), '');
  $('#current-type').title = choice.preview
    ? `${choice.preview.hand.alias} · ${choice.preview.hand.typeRank}/22 · 杂牌 ${choice.preview.hand.junk}`
    : '';
  const settlementPending =
    resultActive(view) && settlement !== null && !settlement.complete;
  const phase = !view.you.legalActions
    ? ''
    : settlementPending
      ? '摊牌演示'
      : view.you.status === 'out'
        ? '旁观'
        : view.you.status === 'defended'
          ? '已防守'
          : view.you.status === 'folded'
            ? '已弃牌'
            : resultActive(view)
              ? '等待准备'
              : choice.defense
                ? '防守'
                : legal.isYourTurn
                  ? '轮到你'
                  : view.roundPhase === 'settlement'
                    ? '摊牌'
                    : `${view.players.find((player) => player.seat === view.turnSeat)?.name ?? '其他玩家'} 行动中`;
  text($('#phase-tip'), phase);
  $('#rank-reference').hidden = !rankOpen;
  $('#rank-toggle').setAttribute('aria-expanded', String(rankOpen));
  text($('#rank-toggle'), rankOpen ? '收起 ‹' : '牌型 ›');
  if (rankOpen) {
    const hasCurrent = !!choice.preview;
    const rank = choice.preview?.hand.typeRank ?? 5;
    keyed($('#rank-rail'), `${rank}:${hasCurrent}`, () => {
      $('#rank-rail').innerHTML = Array.from({ length: 9 }, (_, index) => {
        const type = HAND_TYPES[rank + index - 5];
        if (!type) return '<span class="rank-gap" aria-hidden="true"></span>';
        const current = hasCurrent && type.rank === rank;
        return `<button data-rank="${type.rank}" class="${current ? 'current' : ''}" aria-label="${type.alias} ${type.name}"${current ? ' aria-current="true"' : ''}><small>${type.rank}</small>${type.alias}</button>`;
      }).join('');
    });
    text($('#rank-current-label'), hasCurrent ? '当前' : '');
    renderRankDetail();
  }
  const locked = actionsLocked(view);
  const commit = $('#commit') as HTMLButtonElement;
  commit.disabled = locked || !choice.action;
  text(commit, pending ? '提交中' : choice.label);
  const input = $('#bet-input') as HTMLInputElement;
  if (document.activeElement !== input) input.value = String(choice.amount);
  input.min = String(choice.min);
  input.max = String(choice.max);
  input.disabled = locked;
  text($('#bet-summary'), `${choice.defense ? '托管' : '再投'} ${choice.amount}`);
  text(
    $('#bet-limits'),
    choice.defense
      ? `至少 ${choice.min} · 可用 ${view.you.chips}`
      : `已押 ${view.you.betTotal} → ${view.you.betTotal + choice.amount} / ${choice.cards.length * view.settings.chipMultiplier}`,
  );
  ($('#bet-minus') as HTMLButtonElement).disabled = locked || choice.amount <= choice.min;
  ($('#bet-plus') as HTMLButtonElement).disabled = locked || choice.amount >= choice.max;
  const betDetails = $('#bet-details');
  betDetails.hidden =
    !choice.action ||
    ['agree_end', 'pass_defense'].includes(choice.action.t) ||
    view.you.status !== 'active';
  $('#bet-row').hidden = betDetails.hidden;
  const key = JSON.stringify([
    legal.canFold,
    legal.canAgree,
    legal.canPassDefense,
    legal.canForceCloseDefense,
    view.you.agreeEnd,
    choice.action?.t,
    foldConfirm,
    locked,
  ]);
  keyed($('#secondary-actions'), key, () => {
    const actions: { label: string; action: GameAction | 'fold' }[] = [];
    if (legal.canFold) actions.push({ label: foldConfirm ? '确认弃牌' : '弃牌', action: 'fold' });
    if (legal.canPassDefense && choice.pick.length) {
      actions.push({ label: '不防守', action: { t: 'pass_defense' } });
    }
    if (legal.canAgree && choice.action?.t !== 'agree_end') {
      actions.push({
        label: view.you.agreeEnd ? '取消同意' : '同意摊牌',
        action: { t: 'agree_end', agree: !view.you.agreeEnd },
      });
    }
    if (legal.canForceCloseDefense) {
      actions.push({ label: '开始', action: { t: 'force_close_defense' } });
    }
    $('#secondary-actions').replaceChildren();
    for (const item of actions) {
      const button = document.createElement('button');
      button.className = 'ghost';
      button.textContent = item.label;
      button.disabled = locked;
      button.onclick = () => {
        if (item.action === 'fold') {
          if (!foldConfirm) {
            foldConfirm = true;
            renderDecision();
          } else void submit({ t: 'fold' });
        } else void submit(item.action);
      };
      $('#secondary-actions').append(button);
    }
  });
  text(
    $('#action-feedback'),
    !ui.connected
      ? '重连中'
      : foldConfirm
        ? `已投 ${view.you.invested} 留在奖池`
        : choice.reason,
  );
  if (!isBusy()) {
    for (const node of $('#hand').querySelectorAll<HTMLElement>('.card')) {
      const selected = ui.selected.includes(node.dataset.id!);
      node.classList.toggle('sel', selected);
      node.setAttribute('aria-pressed', String(selected));
    }
  }
}

function applyStepTitle(step: SettlementStep, view: PlayerView): string {
  if (!settlement) return '';
  const name = (seat: number | null) =>
    seat === null
      ? '无人'
      : (settlement!.sequence.players.find((player) => player.seat === seat)?.name ??
        `座位 ${seat}`);
  switch (step.kind) {
    case 'reveal-start':
    case 'reveal-card':
      return `${name(step.seat)} · 正在逐张亮牌`;
    case 'reveal-hold':
      return `${name(step.seat)} · ${step.entry.handAlias} / ${step.entry.handName}`;
    case 'no-entry':
      return `${name(step.seat)} · ${step.reason}`;
    case 'criterion':
      return step.label;
    case 'escrow':
      return '防守托管判定';
    case 'verdict':
      return step.winnerSeat === null
        ? '比较完成 · 回合作废'
        : `${name(step.winnerSeat)} ${view.phase === 'gameover' ? '获胜' : `+${step.potAmount}`}`;
    case 'payout':
      return '逐个玩家分配筹码';
    case 'ready':
      return '等待全员准备';
  }
}

function renderResult(view: PlayerView) {
  const container = $('#round-result');
  const active = resultActive(view);
  container.hidden = !active;
  $('#play-controls').hidden = active;
  $('#dock').classList.toggle('result-dock', active);
  if (!active || !settlement) return;
  const run = settlement;
  const applied = run.sequence.steps.slice(0, run.index + 1);
  const step = settlementStep();
  const names = (seat: number | null) =>
    seat === null
      ? '无人'
      : (run.sequence.players.find((player) => player.seat === seat)?.name ??
        `座位 ${seat}`);
  const oldHistory = container.querySelector<HTMLElement>('.history-body');
  const oldHistoryScroll = oldHistory?.scrollTop ?? 0;
  const oldDetails = container.querySelector<HTMLDetailsElement>('.result-history');
  const historyOpen = oldDetails?.open ?? false;
  const focusedAction =
    document.activeElement instanceof HTMLElement &&
    container.contains(document.activeElement)
      ? document.activeElement.dataset.focusAction ?? null
      : null;
  const criteria = applied.filter(
    (item): item is Extract<SettlementStep, { kind: 'criterion' }> =>
      item.kind === 'criterion',
  );
  const historyCriteria = run.complete
    ? run.sequence.steps.filter(
        (item): item is Extract<SettlementStep, { kind: 'criterion' }> =>
          item.kind === 'criterion',
      )
    : criteria;
  const finalVerdict = [...run.sequence.steps]
    .reverse()
    .find(
      (item): item is Extract<SettlementStep, { kind: 'verdict' }> =>
        item.kind === 'verdict',
    );
  const finalPayouts = run.sequence.steps.filter(
    (item): item is Extract<SettlementStep, { kind: 'payout' }> =>
      item.kind === 'payout',
  );
  const title = run.complete
    ? run.sequence.winnerSeat === null
      ? '回合作废'
      : `${names(run.sequence.winnerSeat)} ${
          view.phase === 'gameover'
            ? '获胜'
            : `+${finalVerdict?.potAmount ?? run.sequence.result.potAmount}`
        }`
    : step
      ? applyStepTitle(step, view)
      : '摊牌准备';
  const currentBody = run.complete
    ? `${finalVerdict ? `<p class="result-verdict">${html(finalVerdict.note)}</p>` : ''}
       <section class="result-section"><h2>每位玩家筹码</h2><div class="payout-table">${finalPayouts
         .map((item) => renderPayout(item, names))
         .join('')}</div></section>`
    : step
      ? renderCurrentStep(step, names)
      : '<p class="result-note">摊牌即将开始。所有玩家会按固定座位逐位亮牌，每张牌依次翻开。</p>';
  const history = applied
    .filter(
      (item) =>
        item.kind === 'reveal-hold' ||
        item.kind === 'no-entry' ||
        item.kind === 'criterion' ||
        item.kind === 'escrow' ||
        item.kind === 'verdict' ||
        item.kind === 'payout',
    )
    .map((item) => renderHistoryStep(item, names))
    .join('');

  container.innerHTML = `<div class="result-shell">
    <div class="result-head">
      <div><p class="result-eyebrow">${run.complete ? '结算结果' : '分步结算'}</p><h1>${html(title)}</h1></div>
      <div class="result-tools">
        ${!run.complete ? `<button class="ghost" data-pause data-focus-action="pause">${isPresentationPaused() ? '继续' : '暂停'}</button>` : ''}
        ${run.complete ? '<button class="ghost" data-replay data-focus-action="replay">重播结算</button>' : ''}
      </div>
    </div>
    <div class="result-main">
      <section class="current-step" aria-live="polite">${currentBody}</section>
      <details class="result-history"${historyOpen ? ' open' : ''}>
        <summary>结算记录 <span>${Math.max(0, applied.length - (run.complete ? 0 : 1))} 步</span></summary>
        <div class="history-body">${history || '<p class="quiet">暂无已完成的结算步骤</p>'}</div>
      </details>
    </div>
    <footer class="result-footer">
      ${
        run.complete
          ? renderReadiness(view) +
            (view.phase === 'gameover'
              ? `<div class="result-actions">${view.isHost ? '<button class="primary" data-rematch>再来一局</button>' : '<span class="quiet">等待房主重开</span>'}<button class="ghost" data-back-lobby>返回大厅</button></div>`
              : '')
          : `<p>${isPresentationPaused() ? '演出已暂停，可继续播放。' : '自动播放中；你也可以随时暂停阅读。'}</p>`
      }
    </footer>
  </div>`;

  hydrateCriterionCards(container, historyCriteria);
  const newHistory = container.querySelector<HTMLElement>('.history-body');
  if (newHistory) newHistory.scrollTop = oldHistoryScroll;
  if (focusedAction) {
    container
      .querySelector<HTMLElement>(`[data-focus-action="${focusedAction}"]`)
      ?.focus({ preventScroll: true });
  }

  container.querySelector('[data-pause]')?.addEventListener('click', () => {
    setPresentationPaused(!isPresentationPaused());
    render(true);
  });
  container.querySelector('[data-replay]')?.addEventListener('click', () => {
    if (!settlement) return;
    replaySettlement(settlement.sequence);
  });
  container.querySelector('[data-rematch]')?.addEventListener('click', () => void rematch());
  container.querySelector('[data-back-lobby]')?.addEventListener('click', () => {
    clearSession();
    location.href = '/';
  });
  container.querySelector<HTMLButtonElement>('[data-ready]')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const agree = button.dataset.ready === 'true';
    void submit({ t: 'ready_next', agree });
  });
}

function renderCurrentStep(
  step: SettlementStep,
  names: (seat: number | null) => string,
): string {
  switch (step.kind) {
    case 'reveal-start':
      return `<div class="reveal-current"><b>${html(names(step.seat))}</b><span>正在逐张亮牌 · 0/${step.entry.cards.length}</span></div>`;
    case 'reveal-card': {
      const card = step.entry.cards[step.cardIndex];
      return `<div class="reveal-current"><b>${html(names(step.seat))}</b><span>正在逐张亮牌 · ${step.cardIndex + 1}/${step.entry.cards.length}</span><small>${card ? html(cardLabel(card)) : ''}</small></div>`;
    }
    case 'reveal-hold':
      return `<div class="reveal-current held"><b>${html(names(step.seat))}</b><span>${html(step.entry.handAlias)} / ${html(step.entry.handName)}</span><small>组成用牌 ${step.entry.usedIds.length} 张 · 杂牌 ${step.entry.junk} 张 · 请阅读后再进入下一位</small></div>`;
    case 'no-entry':
      return `<div class="reveal-current"><b>${html(names(step.seat))}</b><span>${html(step.reason)}</span></div>`;
    case 'criterion':
      return renderCriterion(step, names);
    case 'escrow':
      return `<p class="result-note">${html(step.note)}</p>`;
    case 'verdict':
      return `<section class="verdict-section"><p class="result-verdict">${html(step.note)}</p></section>`;
    case 'payout':
      return renderPayout(step, names);
    case 'ready':
      return '<p class="result-note">所有比较与筹码分配均已完成，等待仍在局中的玩家确认继续。</p>';
  }
}

function renderHistoryStep(
  step: SettlementStep,
  names: (seat: number | null) => string,
): string {
  switch (step.kind) {
    case 'reveal-hold':
      return `<div class="history-step reveal-summary"><b>${html(names(step.seat))}</b><span>${html(step.entry.handAlias)} / ${html(step.entry.handName)}</span><small>用牌 ${step.entry.usedIds.length} · 杂牌 ${step.entry.junk}</small></div>`;
    case 'no-entry':
      return `<div class="history-step"><b>${html(names(step.seat))}</b><span>${html(step.reason)}</span></div>`;
    case 'criterion':
      return renderCriterion(step, names);
    case 'escrow':
      return `<div class="history-step"><b>防守托管</b><span>${html(step.note)}</span></div>`;
    case 'verdict':
      return `<div class="history-step verdict-section"><b>奖池判定</b><span>${html(step.note)}</span></div>`;
    case 'payout':
      return renderPayout(step, names);
    case 'ready':
    case 'reveal-start':
    case 'reveal-card':
      return '';
  }
}

function hydrateCriterionCards(
  container: HTMLElement,
  steps: Extract<SettlementStep, { kind: 'criterion' }>[],
) {
  for (const step of steps) {
    step.rows.forEach((row: CriterionRow, rowIndex) => {
      if (!row.comparisonCard) return;
      const slots = container.querySelectorAll<HTMLElement>(
        `[data-criterion-card="${step.scope}:${step.round}:${rowIndex}"]`,
      );
      slots.forEach((slot) =>
        slot.append(createCard(row.comparisonCard, { mini: true, up: true })),
      );
    });
  }
}

function renderCriterion(
  step: Extract<SettlementStep, { kind: 'criterion' }>,
  names: (seat: number | null) => string,
): string {
  const rows = step.rows
    .map(
      (row, rowIndex) => `<div class="criterion-row ${row.survives ? 'survives' : 'eliminated'}">
        <b>${html(names(row.seat))}</b>
        <span class="criterion-value">${html(row.value)}</span>
        <span class="criterion-flag">${row.survives ? '保留' : '淘汰'}</span>
        <small>${html(row.reason)}</small>
        ${row.comparisonCard ? `<span class="criterion-card" data-criterion-card="${step.scope}:${step.round}:${rowIndex}"></span>` : ''}
      </div>`,
    )
    .join('');
  return `<div class="criterion-step ${step.scope}"><div class="criterion-head"><b>${html(step.label)}</b><span>${html(step.rule)}</span></div>${rows}<p class="criterion-survivors">存活候选：${step.survivors
    .map((seat) => html(names(seat)))
    .join('、')}</p></div>`;
}

function renderPayout(
  step: Extract<SettlementStep, { kind: 'payout' }>,
  names: (seat: number | null) => string,
): string {
  const parts = [
    step.potWon ? `奖池 +${step.potWon}` : '',
    step.escrowReturn ? `托管退回 +${step.escrowReturn}` : '',
    step.escrowForfeit ? `托管罚没 −${step.escrowForfeit}` : '',
    step.anteRefund ? `投入退回 +${step.anteRefund}` : '',
  ].filter(Boolean);
  return `<div class="payout-row"><b>${html(names(step.seat))}</b><span class="${step.delta >= 0 ? 'plus' : 'minus'}">${step.delta >= 0 ? '+' : ''}${step.delta}</span><span>当前 ${step.chips} 筹</span><small>${parts.join(' · ') || '无筹码变动'}</small></div>`;
}

function renderReadiness(view: PlayerView): string {
  if (
    !settlement ||
    view.phase !== 'playing' ||
    view.roundPhase !== 'settlement'
  ) {
    return '';
  }
  const ready = nextReadyOf(view.you);
  const canReady = canReadyNext(view);
  return `<section class="ready-panel" aria-label="继续准备">
    <div class="ready-head"><b>等待全员准备</b><span>${readyCount(view)}/${settlement.sequence.survivors.length}</span></div>
    <div class="ready-list">${settlement.sequence.survivors
      .map((seat) => {
        const player =
          seat === view.you.seat
            ? view.you
            : view.players.find((item) => item.seat === seat);
        if (!player) return '';
        return `<span class="${nextReadyOf(player) ? 'is-ready' : ''}">${html(player.name || `座位 ${seat}`)} · ${nextReadyOf(player) ? '已准备' : '未准备'}</span>`;
      })
      .join('')}</div>
    ${canReady ? `<button class="primary" data-ready="${String(!ready)}">${ready ? '取消准备' : '我已准备，下一回合'}</button>` : '<p class="quiet">本轮不再由倒计时自动推进，请等待其余玩家。</p>'}
  </section>`;
}

function tick() {
  if (!root) return;
  const view = getState().view;
  if (view) {
    const settlementPhase =
      view.roundPhase === 'settlement' || view.phase === 'gameover';
    if (settlementPhase) {
      text(
        $('#countdown'),
        settlement?.complete
          ? view.phase === 'gameover'
            ? '已终局'
            : `准备 ${readyCount(view)}/${survivorsOf(view).length}`
          : '结算演出中',
      );
      $('#countdown').classList.remove('urgent');
    } else {
      const unlimited = !view.deadlineAt || view.deadlineAt >= NO_DEADLINE;
      const seconds = unlimited
        ? 0
        : Math.max(0, Math.ceil((view.deadlineAt - Date.now()) / 1000));
      text($('#countdown'), unlimited ? '∞' : `${seconds}s`);
      $('#countdown').classList.toggle(
        'urgent',
        !unlimited && seconds > 0 && seconds <= 5,
      );
    }
  }
  raf = requestAnimationFrame(tick);
}
