import type { PlayerView } from '../../shared/src/index';

/** 客户端单一状态：serverView（权威快照）+ uiState（本地选择） */
export type Screen = 'lobby' | 'room' | 'table';

export interface UIState {
  selected: string[]; // 选中的手牌 id
  bet: number | null; // 押注滑块当前值
  escrow: number | null; // 防守托管输入
  name: string;
  joinCode: string;
  toast: { msg: string; kind: 'err' | 'ok' } | null;
}

export interface Store {
  view: PlayerView | null;
  lastEventSeq: number;
  screen: Screen;
  ui: UIState;
}

const store: Store = {
  view: null,
  lastEventSeq: 0,
  screen: 'lobby',
  ui: {
    selected: [],
    bet: null,
    escrow: null,
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
  store.view = v;
  // 手牌变化时清掉已不存在的选牌
  if (v.you) {
    const ids = new Set(v.you.hand.map((c) => c.id));
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
