import type { PlayerView } from '../../shared/src/index';

/** 客户端单一状态：serverView（权威快照）+ uiState（本地选择） */
export type Screen = 'lobby' | 'room' | 'table';

export interface UIState {
  selected: string[]; // 选中的手牌 id
  bet: number | null; // 押注滑块当前值
  freshIds: string[]; // 本轮新补的手牌 id（金框"新"标，下次发牌时更新）
  name: string;
  joinCode: string;
  toast: { msg: string; kind: 'err' | 'ok' } | null;
}

export interface Store {
  view: PlayerView | null;
  lastEventSeq: number;
  screen: Screen;
  /** 上一份快照的各座位手牌数（发牌动画据此算出"新补几张"） */
  prevHandCounts: Record<number, number>;
  ui: UIState;
}

const store: Store = {
  view: null,
  lastEventSeq: 0,
  screen: 'lobby',
  prevHandCounts: {},
  ui: {
    selected: [],
    bet: null,
    freshIds: [],
    name: localStorage.getItem('castle.name') ?? '',
    joinCode: new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '',
    toast: null,
  },
};

const subs = new Set<() => void>();
let raf = 0;

function emit() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    for (const fn of subs) fn();
  });
}

export function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function getState(): Store {
  return store;
}

export function setView(v: PlayerView) {
  const prev = store.view;
  store.view = v;

  // 记录"上一份快照的手牌数"：每次快照都跟随，发牌动画用它算出每个
  // 座位新补几张（新一局/重连则清空，按全量发牌处理）
  if (!prev || prev.phase !== 'playing') {
    store.prevHandCounts = {};
  } else {
    const prevCounts: Record<number, number> = {};
    for (const p of prev.players) prevCounts[p.seat] = p.handCount;
    store.prevHandCounts = prevCounts;
  }

  if (v.you) {
    const ids = new Set(v.you.hand.map((c) => c.id));
    // 本轮新补的手牌：新一局首轮全部为新；备战补牌则与上一份手牌做差集
    if (!prev?.you) {
      store.ui.freshIds = [];
    } else if (prev.phase !== 'playing') {
      store.ui.freshIds = v.you.hand.map((c) => c.id);
    } else {
      const oldIds = new Set(prev.you.hand.map((c) => c.id));
      const fresh = v.you.hand.filter((c) => !oldIds.has(c.id)).map((c) => c.id);
      if (fresh.length > 0) store.ui.freshIds = fresh;
      else store.ui.freshIds = store.ui.freshIds.filter((id) => ids.has(id));
    }
    // 手牌变化时清掉已不存在的选牌
    store.ui.selected = store.ui.selected.filter((id) => ids.has(id));
  }
  emit();
}

export function setScreen(screen: Screen) {
  store.screen = screen;
  emit();
}

export function patchUI(p: Partial<UIState>) {
  Object.assign(store.ui, p);
  emit();
}

export function toast(msg: string, kind: 'err' | 'ok' = 'err') {
  store.ui.toast = { msg, kind };
  emit();
  setTimeout(() => {
    if (store.ui.toast?.msg === msg) {
      store.ui.toast = null;
      emit();
    }
  }, 2400);
}

export function toggleSelect(cardId: string) {
  const sel = store.ui.selected;
  const i = sel.indexOf(cardId);
  if (i >= 0) sel.splice(i, 1);
  else sel.push(cardId);
  store.ui.bet = null;
  emit();
}

export function saveName(name: string) {
  store.ui.name = name;
  localStorage.setItem('castle.name', name);
}
