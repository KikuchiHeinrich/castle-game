import type { Card, GameEvent, PlayerView, PublicPlayer, ShowdownEntry } from '../../shared/src/index';
import { getState } from './store';
import { createCard } from './components/card';
import { avatarSVG } from './components/pixelAvatar';
import { cardLabel } from '../../shared/src/index';
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
  oppHandEl: (seat: number) => HTMLElement | null; // 对手手牌堆（抽牌动画起点）
  handEl: () => HTMLElement | null;
  ownPlayedEl: () => HTMLElement | null;
  potEl: () => HTMLElement | null;
  deckEl: () => HTMLElement | null;
  discardEl: () => HTMLElement | null;
  report: (line: string) => void; // 教官播报战报
  showdownPrepare: (entries: ShowdownEntry[]) => {
    seat: number;
    nodes: HTMLElement[];
    cards: Card[];
    usedIds: string[];
    label: HTMLElement;
  }[];
  /** 中央展示台：按玩家逐个亮牌面 */
  stageOpen: (name: string, total: number) => void;
  stageSlotRect: (i: number) => RectLike | null;
  stageFill: (i: number, card: Card, used?: boolean) => void;
  stageClearSlot: (i: number) => void;
  stageLabel: (text: string) => void;
  stageClose: () => void;
  verdict: (html: string) => Promise<void>; // 教官裁定演出
  banner: (main: string, sub?: string, ms?: number) => Promise<void>;
  tweenPot: () => void;
}

let hooks: FxHooks | null = null;
export function setFxHooks(h: FxHooks) {
  hooks = h;
}

/**
 * 结算演出期间冻结桌面。
 *
 * 这里的核心矛盾：**权威快照是即时的，动画队列是滞后的叙事**。
 * `setView` 一到就把最新状态存进 store，而 `drain` 每处理完一个事件就重绘一次——
 * 它读的是最新快照，不是"当前正在演的那一步"。于是服务端的结算快照（带着
 * 全员明牌的 result）一到，队列里排在后面的动作一渲染，就会把"所有人牌全亮"
 * 和"下一回合的手牌"抢先画出来；而演出要几秒后才轮到，玩家看到的就是
 * 先亮牌、先开下一回合，最后才逐个判定。
 *
 * 所以：快照一旦进入结算阶段，就把它**冻住**当成本次演出用的画面，
 * 期间所有渲染都用这一份，直到裁定结束再切回实时快照。
 */
let settlementHold = false;
let heldView: PlayerView | null = null;

export function holdingForSettlement(): boolean {
  return settlementHold;
}

/** 演出期间要用哪一份快照渲染：冻结中就用冻结的那份 */
export function settlementView(): PlayerView | null {
  return settlementHold ? heldView : null;
}

/**
 * 告知动画系统"当前快照已经进入结算"。
 * 必须由渲染/重绘路径在每个快照上调用——不能等 showdown 事件开始处理才置位，
 * 那时队列可能还堵在前面几个动作的动画里。
 */
export function noteSettlementView(v: PlayerView) {
  if (settlementHold) return;
  if (v.roundPhase !== 'settlement' && !v.result) return;
  settlementHold = true;
  heldView = v;
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, reducedMotion ? 0 : ms));

/**
 * 每个动作之后的停顿——给玩家看清「刚才发生了什么」的时间。
 * 这些数字是节奏参数，调大=更从容、调小=更紧凑；教学局的即时反馈也依赖它们。
 */
const PAUSE = {
  /** 一次实打实的行动之后（出牌 / 加牌 / 加注 / 弃牌 / 防守宣言） */
  action: 1900,
  /** 轻动作之后（同意结束、不防守这类没有画面变化的表态） */
  minor: 950,
  /** 亮出最大牌之后，给翻面动画留一拍 */
  reveal: 450,
  /** 摊牌时每位玩家亮完全部牌之后的停留（整段演出要压进服务端 5 秒的结算窗口） */
  perPlayer: 600,
  /** 教官裁定 / 收池横幅之后的停留 */
  verdict: 700,
};

type RectLike = { left: number; top: number; width: number; height: number };

function rectOf(el: HTMLElement | null): RectLike | null {
  return el ? el.getBoundingClientRect() : null;
}

/**
 * 飞一张牌。
 *
 * 坐标约定：**起点与终点都是"牌的中心落在该矩形的中心"**；元素本身不改写尺寸，
 * 保持 CSS 里的牌尺寸（全尺寸 98×130 / 小牌 49×65），飞行途中它始终是一张正常大小的牌。
 *
 * 早期实现把元素钉在视口 (0,0) 再按"位置差值"做 translate，于是每张牌都从**窗口左上角**
 * 起飞、落点与牌桌无关；缩放还在拿整块容器宽度除以牌堆宽度，会放大十几倍。
 */
function flyNode(node: HTMLElement, from: RectLike, to: RectLike, dur = 360, fromScale = 0.55): Promise<void> {
  if (reducedMotion) return Promise.resolve();
  node.classList.add('fly-card');
  document.body.appendChild(node);

  // 先量出牌自身的真实尺寸，再把它的中心摆到起点中心
  const w = node.offsetWidth || 1;
  const h = node.offsetHeight || 1;
  const fromCx = from.left + from.width / 2;
  const fromCy = from.top + from.height / 2;
  const toCx = to.left + to.width / 2;
  const toCy = to.top + to.height / 2;
  node.style.left = `${fromCx - w / 2}px`;
  node.style.top = `${fromCy - h / 2}px`;

  const anim = node.animate(
    [
      { transform: `translate(0, 0) scale(${fromScale})` },
      { transform: `translate(${toCx - fromCx}px, ${toCy - fromCy}px) scale(1)` },
    ],
    { duration: dur, easing: EASE, fill: 'forwards' },
  );
  return settle(anim, dur).then(() => node.remove());
}

/**
 * 等动画结束，但**带兜底超时**：标签页切到后台时 requestAnimationFrame 会被节流，
 * Web Animation 的 finished 可能永远不 resolve——那会把整个动画队列连同教学节奏
 * 一起卡死。超时后直接收尾：按「状态兜底」原则，画面依旧与权威快照一致。
 */
function settle(anim: Animation, dur: number): Promise<void> {
  return Promise.race([
    anim.finished.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((r) => setTimeout(r, dur + 260)),
  ]);
}

/** 读 CSS 变量里的牌尺寸，保证动画与牌桌用的是同一套数字 */
function cardMetrics(size: 'full' | 'mini' = 'full'): { w: number; h: number } {
  const cs = getComputedStyle(document.documentElement);
  const px = (name: string, def: number) => parseFloat(cs.getPropertyValue(name)) || def;
  return size === 'mini'
    ? { w: px('--card-mini-w', 49), h: px('--card-mini-h', 65) }
    : { w: px('--card-w', 98), h: px('--card-h', 130) };
}

/**
 * 取目标区域里"本次刚打出的那几张"牌：出战区是追加式的，

/** 把 n 个落点沿水平方向摊开，整体以 rect 的中心为中点 */
function spreadSlots(rect: RectLike, n: number, w: number, h: number, step: number): RectLike[] {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return Array.from({ length: n }, (_, i) => ({
    left: cx + (i - (n - 1) / 2) * step - w / 2,
    top: cy - h / 2,
    width: w,
    height: h,
  }));
}

/** 手牌行第 i 张（共 n 张）的落点——用的是与 #hand CSS 完全相同的布局参数 */
function handSlots(handEl: HTMLElement, n: number): RectLike[] {
  const cs = getComputedStyle(handEl);
  const { w, h } = cardMetrics('full');
  const overlap = parseFloat(cs.getPropertyValue('--card-overlap')) || 30;
  const step = w - overlap;
  const r = handEl.getBoundingClientRect();
  const rowW = w + Math.max(0, n - 1) * step;
  const left = r.left + (r.width - rowW) / 2;
  const top = r.top + (parseFloat(cs.paddingTop) || 0);
  return Array.from({ length: n }, (_, i) => ({ left: left + i * step, top, width: w, height: h }));
}

function flyCardFace(card: Card | null, from: RectLike, to: RectLike, dur = 360, mini = false) {
  return flyNode(createCard(card, { mini }), from, to, dur);
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
    const d = dur + i * 40;
    const anim = chip.animate(
      [
        { transform: 'translate(0,0)', offset: 0 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px)`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px)`, offset: 1 },
      ],
      { duration: d, easing: EASE, fill: 'forwards' },
    );
    flights.push(settle(anim, d).then(() => chip.remove()));
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
      // 注意：**不要**在这里统一重绘卡牌区。
      //
      // 这个统一重绘读的是"最新快照"，而最新快照可能已经包含了队列里后面几个
      // 事件的结果——于是牌会先被状态渲染画出来（"出战区突然冒出牌"），
      // 等动画真轮到它时又得把它藏起来重飞一遍，变成"出现→消失→飞进来"。
      // 各事件的动画自己知道该在什么时候重绘（出牌/发牌/弃牌/摊牌里都有），
      // 队列排空时还有 renderAll() 兜底，所以这里不需要也不应该插手。
    } catch (e) {
      console.error('anim error', e);
      settlementHold = false;
      heldView = null;
      hooks?.renderAll();
    }
  }
  dropped = false;
  running = false;
  settlementHold = false;
  heldView = null;
  hooks?.renderAll(); // 队列排空：最终兜底，保证与权威状态一致
}

export function isBusy() {
  return running;
}

export function resetQueue() {
  queue.length = 0;
  dropped = true;
  settlementHold = false; // 重连/丢事件兜底：绝不能把桌面永久冻住
  heldView = null;
}

// ---- 各事件动画 ----

async function handle(ev: GameEvent): Promise<void> {
  if (!hooks) return;
  const h = hooks;
  const st = getState();

  switch (ev.t) {
    case 'round_start': {
      const declarer = st.view?.players.find((p) => p.seat === ev.declarerSeat);
      sfx.shuffle();
      h.report(`🎬 第 ${ev.roundNo} 回合开始 · 庄家 ${declarer?.name ?? '?'}`);
      await h.banner(`第 ${ev.roundNo} 回合`, `宣战者：${declarer?.name ?? '?'} · 底注各 ${ev.ante}`, 1100);
      await sleep(PAUSE.verdict);
      break;
    }
    case 'deal': {
      // 洗牌音在 round_start 已经响过，这里只要发牌音，不然一回合会响两遍
      sfx.deal();
      // 备战补牌：手牌继承、只补到 6 张。事件里的 count 是补牌后的总数，
      // 真实新增 = 总数 - 上一份快照的存量；自己的新牌 id 由 store 差集给出
      const ownSeat = st.view?.you.seat;
      const prevCounts = st.prevHandCounts;
      const freshIds = st.ui.freshIds;
      const addedOf = (seat: number, total: number) =>
        seat === ownSeat ? Math.min(freshIds.length, total) : Math.max(0, total - (prevCounts[seat] ?? 0));
      const parts = ev.counts.map(([seat, total]) => `${seat === ownSeat ? '你' : seatName(seat)} +${addedOf(seat, total)}`);
      h.report(`📦 备战补牌：${parts.join(' · ')}`);

      // 发牌一律从中央牌堆飞出，**每张落地就留在那儿**。
      //
      // 做法：先把新牌摆上桌并设为不可见（只留占位，不影响布局），
      // 再逐张从牌堆飞过去，落地那一刻把对应位置的牌显示出来。
      // 早期是"牌先出现、飞牌盖上去"，看起来像把目标地的牌替换掉，
      // 而不是"发过来一张、就待在那儿"。
      h.renderCards();
      const deck = rectOf(h.deckEl()) ?? rectOf(h.potEl());

      const hidden: HTMLElement[] = [];
      const conceal = (nodes: HTMLElement[]) => {
        for (const n of nodes) { n.classList.add('dealing'); hidden.push(n); }
      };
      const reveal = (node: HTMLElement | undefined) => node?.classList.remove('dealing');

      const flights: Promise<void>[] = [];
      let order = 0;
      // 逐张错开出发，读起来才像"一张张发"而不是"一坨飞过来"
      const queue = (run: () => Promise<void>) => {
        flights.push(sleep(order * 90).then(() => { sfx.deal(); return run(); }));
        order++;
      };

      try {
        for (const [seat, total] of ev.counts) {
          const add = Math.min(6, addedOf(seat, total));
          if (add <= 0 || !deck) continue;

          if (seat === ownSeat) {
            // 自己的新牌：renderCards 已经把最终手牌摆好，这里按 .fresh 找到它们
            const handEl = h.handEl();
            const freshNodes = handEl
              ? [...handEl.querySelectorAll<HTMLElement>('.card.fresh')]
              : [];
            const fresh = (st.view?.you.hand ?? []).filter((c) => freshIds.includes(c.id));
            conceal(freshNodes);
            const fallback = handEl ? handSlots(handEl, Math.max(total, add)) : [];
            for (let k = 0; k < add; k++) {
              const node = freshNodes[k];
              const to = node ? rectOf(node) : fallback[Math.min(fallback.length - 1, Math.max(0, fallback.length - add + k))];
              if (!to) continue;
              const card = fresh[k] ?? null;
              queue(async () => {
                await flyCardFace(card, deck, to, 340, false);
                reveal(node); // 落地即留在那里
              });
            }
          } else {
            // 对手：手牌堆最后 add 张牌背是新补的（堆显示上限 8，超了就不逐个揭示）
            const stack = h.oppHandEl(seat);
            const rect = rectOf(stack ?? h.seatEl(seat));
            if (!rect) continue;
            const backs = stack ? [...stack.querySelectorAll<HTMLElement>('.stack-back')] : [];
            const newBacks = backs.slice(Math.max(0, backs.length - add));
            const targets = newBacks.length === add ? newBacks : [];
            conceal(targets);
            const { w, h: ch } = cardMetrics('mini');
            const slots = spreadSlots(rect, add, w, ch, 12);
            for (let k = 0; k < add; k++) {
              const node = targets[k];
              const to = (node ? rectOf(node) : slots[k]) ?? slots[k];
              queue(async () => {
                await flyCardFace(null, deck, to, 340, true);
                reveal(node);
              });
            }
          }
        }
        await Promise.all(flights);
      } finally {
        // 任何异常都不能把牌永久藏起来
        for (const n of hidden) n.classList.remove('dealing');
      }
      break;
    }
    case 'defense_declared': {
      h.report(`🔒 ${seatName(ev.seat)} 宣布防守 ${ev.cardCount} 张，托管 ${ev.escrow}`);
      // 防守也是把牌从手里打到出战区，卡牌区要跟着重绘
      // （原来靠 drain 的统一重绘，那层去掉后必须自己来）
      h.renderCards();
      const from = rectOf(h.seatEl(ev.seat));
      if (from) {
        sfx.chip();
        await flyChips(from, from, 2);
      }
      await sleep(PAUSE.action);
      break;
    }
    case 'play':
    case 'add_cards': {
      const own = ev.seat === st.view?.you.seat;
      const n = Math.min(ev.cardCount, 6);
      // 起点：自己的手牌区 / 对手的手牌堆（抽牌）；终点：各自的出牌区
      const fromEl = own ? h.handEl() : (h.oppHandEl(ev.seat) ?? h.seatEl(ev.seat));
      const from = rectOf(fromEl);
      const targetEl = own ? h.ownPlayedEl() : (h.bfZoneEl(ev.seat) ?? h.seatEl(ev.seat));

      // 和发牌同一套做法：**先把牌摆到最终位置并藏起来**（保住占位、布局不跳），
      // 再一张张从手牌"打"过去，落地那一刻把那张显示出来。
      //
      // 关键：这一段由**事件本身**搭出来（张数 + 亮出的最大牌），不依赖快照。
      // 快照可能已经包含队列里后面几个事件的结果，按它重绘会一次画出更多的牌，
      // 于是"藏哪几张"就不准了，玩家会看到牌先全冒出来又逐张消失重飞。
      const placed: HTMLElement[] = [];
      if (targetEl) {
        // 对手区是"整回合一行铺开"（只有一个 .seg 盒子）。新牌必须追加进**同一行**：
        // 再起一个 .seg 盒子的话，nowrap 的一行会被撑宽、溢出到隔壁玩家的卡片上，
        // 看起来就是"不同玩家的出战区叠在一起"。
        // 自己那一侧本来就是"每段一个盒子"，照旧新起一个。
        let row = own ? null : (targetEl.querySelector('.seg-cards') as HTMLElement | null);
        let seg = row ? (row.parentElement as HTMLElement) : null;
        if (!row) {
          seg = document.createElement('div');
          seg.className = 'seg';
          row = document.createElement('div');
          row.className = 'seg-cards';
          seg.appendChild(row);
          const lab = document.createElement('span');
          lab.className = 'seg-count';
          seg.appendChild(lab);
          targetEl.appendChild(seg);
        }
        const mine = own ? (st.view?.you.battlefield ?? []).slice(-n) : [];
        for (let k = 0; k < n; k++) {
          const isTop = k === 0 && !!ev.revealedTop;
          // 自己的牌正面朝上；对手只知道张数和亮出的那一张
          const card = own ? (mine[k] ?? null) : isTop ? ev.revealedTop : null;
          const node = createCard(card, { up: own || isTop, mini: true });
          row.appendChild(node);
          placed.push(node);
        }
        const lab = seg?.querySelector('.seg-count') as HTMLElement | null;
        if (lab) {
          const total = row.querySelectorAll('.card').length;
          lab.textContent = ev.revealedTop
            ? `亮 ${cardLabel(ev.revealedTop)} · 共 ${total} 张`
            : `暗牌 ${total} 张`;
        }
      }
      for (const node of placed) node.classList.add('dealing');
      try {
        const to = rectOf(targetEl);
        if (from && to) {
          const { w, h: ch } = cardMetrics('mini');
          // 叠放步长从目标容器自己身上读：对手那一行叠得更紧，写死就会落偏
          const overlap = targetEl
            ? parseFloat(getComputedStyle(targetEl).getPropertyValue('--card-mini-overlap')) || 22
            : 22;
          const fallback = spreadSlots(to, n, w, ch, w - overlap);
          const mine = own ? (st.view?.you.battlefield ?? []).slice(-n) : [];
          for (let k = 0; k < n; k++) {
            const node = placed[k];
            const slot = (node ? rectOf(node) : null) ?? fallback[k];
            if (!slot) continue;
            sfx.deal();
            // 自己的牌正面朝上飞过去，对手的保持背面
            const card = own ? (mine[k] ?? null) : null;
            await flyCardFace(card, from, slot, 280, true);
            node?.classList.remove('dealing'); // 落地即留在那儿
            await sleep(90);
          }
        }
      } finally {
        // 出任何岔子都不能把牌永久藏起来
        for (const node of placed) node.classList.remove('dealing');
      }
      // 加牌常常"不补筹码"（betDelta 0）——那是一个正常动作（抬高押注上限），
      // 不是"加注 0"。原来的文案把两者混为一谈，看起来像机器人在做空动作。
      const betText =
        ev.t === 'play' ? `押 ${ev.bet}` : ev.betDelta > 0 ? `补注 ${ev.betDelta}` : '不补注';
      h.report(
        ev.t === 'play'
          ? ev.revealedTop
            ? `⚔ ${seatName(ev.seat)} 出战 ${ev.cardCount} 张（亮 ${cardLabel(ev.revealedTop)}）· ${betText}`
            : `⚔ ${seatName(ev.seat)} 暗出 ${ev.cardCount} 张 · ${betText}`
          : `🂠 ${seatName(ev.seat)} 加牌 ${ev.cardCount} 张${ev.revealedTop ? `（亮 ${cardLabel(ev.revealedTop)}）` : ''} · ${betText}`,
      );
      if (ev.revealedTop) {
        h.renderCards();
        sfx.flip();
        await sleep(PAUSE.reveal);
      }
      if (ev.t === 'add_cards' && ev.betDelta > 0) {
        const pot = rectOf(h.potEl());
        if (from && pot) {
          sfx.chip();
          await flyChips(from, pot, 2);
        }
      }
      // 收尾必须**强制**权威重绘，把动画临时搭的那一段替换掉。
      // renderSegs / renderYouPlayed 是按 dataset.key 缓存重建的，而快照可能
      // 已经把 key 更新成当前值了——那样 renderCards() 会直接早退，临时段就地留下，
      // 每出一次牌多一个盒子，几回合后这一行被撑爆、压到隔壁玩家的卡片上。
      if (targetEl) targetEl.dataset.key = '';
      h.renderCards();
      await sleep(PAUSE.action); // 停顿：看清刚才出了什么、押了多少
      break;
    }
    case 'add_chips': {
      sfx.chip();
      h.report(`💰 ${seatName(ev.seat)} 加注 ${ev.betDelta}（累计 ${ev.betTotal}）`);
      const from = rectOf(h.seatEl(ev.seat));
      const pot = rectOf(h.potEl());
      if (from && pot) await flyChips(from, pot, 3);
      h.tweenPot();
      await sleep(PAUSE.action);
      break;
    }
    case 'fold': {
      sfx.fold();
      h.report(`🏳 ${seatName(ev.seat)} 弃牌离场`);
      const from = rectOf(h.seatEl(ev.seat));
      const discard = rectOf(h.discardEl()) ?? rectOf(h.deckEl());
      if (from && discard) await flyChips(from, discard, 2);
      h.renderCards();
      await sleep(PAUSE.action);
      break;
    }
    case 'agree': {
      sfx.agree();
      h.report(`✋ ${seatName(ev.seat)} ${ev.agree ? '同意结束' : '取消同意'}`);
      const el = h.seatEl(ev.seat);
      if (el) el.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 300 });
      await sleep(PAUSE.minor);
      break;
    }
    case 'showdown': {
      // 摊牌演出：**不一次性亮出所有人的牌**，而是按座位顺序一个个来——
      // 逐张翻开 → 飞到中央展示台亮明牌面 → 判定牌型（结果写在他自己牌型下面，
      // 一直留着）→ 牌飞回各自的出战区。全部走完才轮到教官宣布胜者。
      settlementHold = true; // 从这里到裁定结束，桌面不再跟随快照刷新
      h.report('🔍 摊牌 —— 逐个亮牌');
      const prepared = h.showdownPrepare(ev.entries);

      try {
        for (const item of prepared) {
          const info = ev.entries.find((e) => e.seat === item.seat);
          const name = seatName(item.seat);
          h.stageOpen(name, item.nodes.length);

          // ① 逐张翻开，并飞到中央展示台
          const usedSet = new Set(item.usedIds);
          for (let i = 0; i < item.nodes.length; i++) {
            const node = item.nodes[i];
            const isUsed = usedSet.has(item.cards[i].id);
            sfx.flipLong();
            node.classList.add('up'); // 先在自己区域翻开
            // 银边只在**翻开之后**才加：暗着的时候就镶边会提前泄露哪几张凑成了牌型
            if (isUsed) node.classList.add('used');
            await sleep(reducedMotion ? 0 : 150);

            const from = rectOf(node);
            const slot = h.stageSlotRect(i);
            if (from && slot) {
              await flyNode(createCard(item.cards[i], { up: true, mini: true }), from, slot, 260);
            }
            h.stageFill(i, item.cards[i], isUsed);
            node.classList.add('dealing'); // 原位留空：牌"移走了"
            await sleep(reducedMotion ? 0 : 80);
          }

          // ② 判定牌型：中央先亮出来，同时写进他本人的牌型标签（会一直留着）
          if (info) {
            h.stageLabel(`${info.handAlias}·${info.handName}`);
            item.label.textContent = `${name}：${info.handAlias}·${info.handName}`;
          }
          await sleep(reducedMotion ? 0 : PAUSE.perPlayer);

          // ③ 一起飞回各自的出战区
          const back = item.nodes.map((node, i) => {
            const from = h.stageSlotRect(i);
            const to = rectOf(node);
            if (!from || !to) return Promise.resolve();
            return flyNode(createCard(item.cards[i], { up: true, mini: true }), from, to, 240).then(() => {
              node.classList.remove('dealing');
              h.stageClearSlot(i);
            });
          });
          await Promise.all(back);
          h.stageLabel('');
          h.stageClose();
          await sleep(reducedMotion ? 0 : 200);
        }
      } finally {
        // 演出出任何岔子都不能让牌停在隐藏状态、展示台留在屏幕上
        for (const item of prepared) for (const n of item.nodes) n.classList.remove('dealing');
        h.stageClose();
      }
      break;
    }
    case 'winner': {
      // 收池动画 → 教官裁定。裁定把"钱怎么分的"一次讲清楚，之后才解冻桌面。
      const winners = ev.seat === null ? null : st.view?.players.find((p) => p.seat === ev.seat);
      if (ev.seat !== null) {
        const wInfo = ev.result.entries[0];
        h.report(`🏆 ${seatName(ev.seat)} 以【${wInfo.handAlias}·${wInfo.handName}】收下 ${ev.pot} 筹码`);
      } else {
        h.report('🌀 回合作废，注金退还');
      }
      if (ev.seat !== null && ev.pot > 0) {
        const pot = rectOf(h.potEl());
        const target = rectOf(h.seatEl(ev.seat));
        if (pot && target) {
          sfx.win();
          await flyChips(pot, target, 5, 520);
        }
      }
      sfx.horn();
      await h.verdict(verdictHtml(ev, st.view));
      await sleep(PAUSE.verdict);
      settlementHold = false;
      heldView = null;
      void winners;
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
    case 'defense_passed': {
      h.report(`🙅 ${seatName(ev.seat)} 不防守`);
      await sleep(PAUSE.minor);
      break;
    }
    case 'defense_window_closed': {
      h.report('🔔 防守宣言结束，进入宣战');
      await sleep(PAUSE.minor);
      break;
    }
    case 'agree_reset':
      break;
    case 'round_void':
      h.report('🌀 回合作废，注金退还');
      await sleep(PAUSE.minor);
      break;
  }
}

/**
 * 教官裁定的内容。
 *
 * 关键是把"净变化"和"奖池"分开讲：奖池里含赢家自己押进去的钱，
 * 只播报"收下 N 筹码"会让人误以为赢了 N——实际净赚通常小得多。
 * 顺便交代托管去哪了（收回 / 罚没进奖池）和谁被淘汰。
 */
function verdictHtml(ev: Extract<GameEvent, { t: 'winner' }>, view: { players: PublicPlayer[] } | null | undefined): string {
  const nameOf = (seat: number) => view?.players.find((p) => p.seat === seat)?.name ?? `座位${seat}`;
  const r = ev.result;

  if (ev.seat === null) {
    return `<div class="verdict-box">
      <div class="verdict-avatar">${avatarSVG('shirley', 'neutral', 6)}</div>
      <div class="verdict-text">
        <div class="verdict-title">教官裁定</div>
        <div class="verdict-main">回合作废</div>
        <div class="verdict-sub">无人竞夺奖池，底注与押注全部退还</div>
      </div>
    </div>`;
  }

  const entry = r.entries.find((e) => e.seat === ev.seat);
  const you = view && 'you' in view ? (view as { you: { seat: number } }).you.seat : -1;
  const iWin = ev.seat === you;

  const deltas = Object.entries(r.chipDeltas)
    .map(([seat, d]) => ({ seat: Number(seat), d }))
    .sort((a, b) => b.d - a.d);
  const rows = deltas
    .map(
      ({ seat, d }) =>
        `<div class="verdict-row${seat === ev.seat ? ' win' : ''}"><span>${nameOf(seat)}</span><b class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${d}</b></div>`,
    )
    .join('');

  const extras: string[] = [];
  for (const [seat, v] of Object.entries(r.escrowForfeits)) {
    extras.push(`${nameOf(Number(seat))} 托管 ${v} 被罚没，进了奖池`);
  }
  for (const [seat, v] of Object.entries(r.escrowReturns)) {
    extras.push(`${nameOf(Number(seat))} 牌型全场最大，收回托管 ${v}`);
  }
  for (const seat of r.eliminated) extras.push(`${nameOf(seat)} 筹码归零出局`);

  return `<div class="verdict-box">
    <div class="verdict-avatar">${avatarSVG('shirley', iWin ? 'happy' : 'neutral', 6)}</div>
    <div class="verdict-text">
      <div class="verdict-title">教官裁定</div>
      <div class="verdict-main">${nameOf(ev.seat)} 胜！</div>
      ${entry ? `<div class="verdict-sub">${entry.handAlias}·${entry.handName} · 用 ${entry.usedIds.length} 张 · 杂 ${entry.junk}</div>` : ''}
      <div class="verdict-pot">收下奖池 <b>${ev.pot}</b> 筹码<span class="dim">（含本回合所有人的底注与押注）</span></div>
      <div class="verdict-rows">${rows}</div>
      ${extras.length ? `<div class="verdict-notes">${extras.map((t) => `<div>· ${t}</div>`).join('')}</div>` : ''}
    </div>
  </div>`;
}

function seatName(seat: number): string {
  return getState().view?.players.find((p) => p.seat === seat)?.name ?? `座位${seat}`;
}

void seatName;

