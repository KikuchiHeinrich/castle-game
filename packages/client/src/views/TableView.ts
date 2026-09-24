import type { Card, PlayerView, PlaySegment, PublicPlayer, ShowdownEntry } from '../../../shared/src/index';
import { battlefieldJunk, bestHandCards, cardLabel, EMOTE_MOODS } from '../../../shared/src/index';
import { createCard } from '../components/card';
import { renderHandTypes, toggleDrawer, handLabel } from '../components/drawer';
import { gameAction, rematch, sendEmote, onEmote } from '../net/socket';
import { getState, patchUI, toggleSelect } from '../store';
import { setFxHooks, isBusy, holdingForSettlement, settlementView, noteSettlementView } from '../anim';
import { renderTutorial, tutorialActive, refreshTutorialGate } from '../components/tutorial';
import { avatarSVG, EMOTES, type Mood } from '../components/pixelAvatar';
import { sfx, isMuted, toggleMute } from '../components/sfx';

/**
 * 桌面主视图 v2 —— 结构化三段式布局：
 *   对手卡片横排 → 中央奖池 → 己方区域（出牌段/状态/手牌/操作栏）
 * 全部 flex 流式布局，无绝对定位，不会互相重叠。
 * 渲染分两路：HUD 即时跟随权威快照；卡牌区域由动画系统在空闲时调用。
 */

let els: {
  table: HTMLElement;
  header: HTMLElement;
  opponents: HTMLElement;
  potNum: HTMLElement;
  potChips: HTMLElement;
  phaseTip: HTMLElement;
  maxBet: HTMLElement;
  countdown: HTMLElement;
  youPlayed: HTMLElement;
  ownStatus: HTMLElement;
  betDock: HTMLElement;
  hand: HTMLElement;
  actionBar: HTMLElement;
  log: HTMLElement;
  overlay: HTMLElement;
  drawer: HTMLElement;
  stage: HTMLElement;
  stageName: HTMLElement;
  stageCards: HTMLElement;
  stageLabel: HTMLElement;
  phaseBlock: HTMLElement;
  emoteLayer: HTMLElement;
  emoteFab: HTMLElement;
  emotePalette: HTMLElement;
} | null = null;

let countdownRaf = 0;
let lastTickSecond = -1;
const logLines: string[] = [];
let animateTopsFlag = false;

export function mountTable(root: HTMLElement) {
  root.innerHTML = `
    <div id="table">
      <div id="table-header">
        <span class="room-code">${getState().view?.code ?? ''}</span>
        <span class="round-info" id="round-info"></span>
        <span class="spacer"></span>
        <button id="btn-mute" class="ghost" title="音效开关">🔊</button>
        <button id="btn-types" class="arcane iconed eye">牌型表</button>
        <button id="btn-exit" class="ghost iconed bak">退出</button>
      </div>
      <div id="stage">
        <div id="side-rail">
          <div id="tutorial-slot"></div>
          <div id="log">
            <div id="log-head">
              <span class="log-av">${avatarSVG('shirley', 'neutral', 1)}</span>
              <span>教官播报</span>
            </div>
            <div id="log-lines"></div>
          </div>
        </div>
        <div id="game-col">
          <div id="opponents"></div>
          <div id="center-row">
            <div id="deck-pile" title="牌堆">
              <div class="pile-stack">
                <div class="pile-card"></div>
                <div class="pile-card"></div>
              </div>
              <span class="pile-label">牌堆</span>
            </div>
            <div id="pot-block">
              <div class="pot-chips" id="pot-chips"></div>
              <div>
                <div class="pot-num" id="pot-num">0</div>
                <div class="pot-label">奖池</div>
              </div>
            </div>
            <div id="phase-block">
              <div id="phase-tip"></div>
              <div id="max-bet"></div>
              <div id="countdown"></div>
            </div>
            <!-- 摊牌展示台：逐个玩家把牌飞到这里亮牌面，判定完再飞回去。
                 卡槽是提前占好的，所以后落的牌不会把先落的挤走。 -->
            <div id="showdown-stage" hidden>
              <div class="stage-name"></div>
              <div class="stage-cards"></div>
              <div class="stage-label"></div>
            </div>
          </div>
        </div>
        <div id="drawer"><div class="drawer-inner"></div></div>
      </div>
      <div id="you-zone">
        <div id="you-played"></div>
        <div id="own-status"></div>
        <div id="bet-dock"></div>
        <div id="hand"></div>
      </div>
      <div id="action-bar"></div>
      <div id="overlay"></div>
    </div>
  `;
  els = {
    table: root.querySelector('#table')!,
    header: root.querySelector('#table-header')!,
    opponents: root.querySelector('#opponents')!,
    potNum: root.querySelector('#pot-num')!,
    potChips: root.querySelector('#pot-chips')!,
    phaseTip: root.querySelector('#phase-tip')!,
    maxBet: root.querySelector('#max-bet')!,
    countdown: root.querySelector('#countdown')!,
    youPlayed: root.querySelector('#you-played')!,
    ownStatus: root.querySelector('#own-status')!,
    betDock: root.querySelector('#bet-dock')!,
    hand: root.querySelector('#hand')!,
    actionBar: root.querySelector('#action-bar')!,
    log: root.querySelector('#log')!,
    overlay: root.querySelector('#overlay')!,
    drawer: root.querySelector('#drawer .drawer-inner') as HTMLElement,
    stage: root.querySelector('#showdown-stage')!,
    stageName: root.querySelector('#showdown-stage .stage-name')!,
    stageCards: root.querySelector('#showdown-stage .stage-cards')!,
    stageLabel: root.querySelector('#showdown-stage .stage-label')!,
    phaseBlock: root.querySelector('#phase-block')!,
  };
  renderHandTypes(els.drawer);
  root.querySelector('#btn-types')!.addEventListener('click', () => {
    sfx.click();
    toggleDrawer();
  });
  const muteBtn = root.querySelector('#btn-mute') as HTMLButtonElement;
  muteBtn.textContent = isMuted() ? '🔇' : '🔊';
  muteBtn.addEventListener('click', () => {
    const m = toggleMute();
    muteBtn.textContent = m ? '🔇' : '🔊';
    if (!m) sfx.click();
  });
  root.querySelector('#btn-exit')!.addEventListener('click', () => {
    sessionStorage.clear();
    location.href = '/';
  });
  els.hand.addEventListener('click', onHandClick);

  setFxHooks({
    renderAll: () => render(),
    renderCards: () => renderCards(true),
    seatEl: (seat) => root.querySelector(`.opp-card[data-seat="${seat}"]`) as HTMLElement | null,
    bfZoneEl: (seat) => root.querySelector(`.opp-card[data-seat="${seat}"] .opp-segs`) as HTMLElement | null,
    oppHandEl: (seat) => root.querySelector(`.opp-card[data-seat="${seat}"] [data-hand]`) as HTMLElement | null,
    handEl: () => els?.hand ?? null,
    ownPlayedEl: () => els?.youPlayed ?? null,
    potEl: () => root.querySelector('#pot-block') as HTMLElement | null,
    deckEl: () => document.getElementById('deck-pile') as HTMLElement | null,
    discardEl: () => document.getElementById('deck-pile') as HTMLElement | null,
    report: (line: string) => reportLine(line),
    showdownPrepare: (entries) => prepareShowdown(entries),
    stageOpen: (name, total) => stageOpen(name, total),
    stageSlotRect: (i) => stageSlotRect(i),
    stageFill: (i, card) => stageFill(i, card),
    stageClearSlot: (i) => stageClearSlot(i),
    stageLabel: (text) => { if (els) els.stageLabel.textContent = text; },
    stageClose: () => stageClose(),
    verdict: (html) => verdictShow(html),
    banner,
    tweenPot: () => tweenNumber(els!.potNum, getState().view?.pot ?? 0),
  });

  // ---- 对局表情（皇室战争式）：右下角按钮 → 面板 → 座位上方气泡 ----
  const emoteLayer = document.createElement('div');
  emoteLayer.id = 'emote-layer';
  els.table.appendChild(emoteLayer);
  els.emoteLayer = emoteLayer;

  const emoteFab = document.createElement('button');
  emoteFab.id = 'emote-fab';
  emoteFab.title = '发表情';
  emoteFab.innerHTML = avatarSVG(getState().view?.you.avatar ?? 'shirley', 'happy', 1);
  const emotePalette = document.createElement('div');
  emotePalette.id = 'emote-palette';
  emotePalette.hidden = true;
  const togglePalette = () => {
    if (!emotePalette.hidden) {
      emotePalette.hidden = true;
      return;
    }
    const me = getState().view?.you;
    emotePalette.innerHTML = '';
    for (const e of EMOTES) {
      const b = document.createElement('button');
      b.className = 'emote-opt';
      b.title = e.label;
      b.innerHTML = avatarSVG(me?.avatar ?? 'shirley', e.mood, 3);
      const lab = document.createElement('span');
      lab.textContent = e.label;
      b.appendChild(lab);
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        sfx.click();
        emotePalette.hidden = true;
        void sendEmote(e.mood); // 自己的气泡也由服务端广播回来，众人看到的一致
      });
      emotePalette.appendChild(b);
    }
    emotePalette.hidden = false;
  };
  emoteFab.addEventListener('click', (ev) => {
    ev.stopPropagation();
    sfx.click();
    togglePalette();
  });
  // 点面板外任意处收起（挂在捕获阶段，先于其他点击处理）
  root.addEventListener('click', (ev) => {
    if (!emotePalette.hidden && !emotePalette.contains(ev.target as Node) && ev.target !== emoteFab) {
      emotePalette.hidden = true;
    }
  }, true);
  els.table.appendChild(emoteFab);
  els.table.appendChild(emotePalette);
  els.emoteFab = emoteFab;
  els.emotePalette = emotePalette;

  onEmote((seat, mood) => showEmoteBubble(seat, mood));
}

/** 离开牌桌：注销表情监听、清掉在飞的气泡，避免往已卸载的 DOM 里挂节点 */
export function unmountTable() {
  onEmote(null);
  for (const { el, timers } of emoteTimers.values()) {
    clearTimeout(timers[0]);
    clearTimeout(timers[1]);
    el.remove();
  }
  emoteTimers.clear();
  els = null;
}

// ============ 总渲染入口 ============

export function render() {
  const live = getState().view;
  if (!live || !els) return;
  noteSettlementView(live); // 快照一进结算就接管，不能等 showdown 事件
  // 演出期间一律用冻结的那份快照渲染：实时快照可能已经跑到下一回合了
  const v = settlementView() ?? live;
  if (!holdingForSettlement()) {
    renderHeader(v);
    // 动画进行中、或快照领先于事件时，出牌区都交给动画自己按节奏重绘
    renderOpponents(v, !isBusy());
    renderCenter(v);
    renderOwnStatus(v);
    renderActionBar(v);
    renderBetDock(v);
    renderOverlay(v);
    if (!isBusy()) renderCards(false); // 动画进行中不踩卡牌区
    renderCountdown(v);
  }
  // 教学卡讲的是"现在轮到你说什么"，演出期间也要跟着走，不能被冻结
  if (tutorialActive()) renderTutorial(live, getState().ui.selected);
}

export function renderCards(animateTops: boolean) {
  const live = getState().view;
  if (!live || !els) return;
  noteSettlementView(live); // drain 每处理完一个事件就调这里，是"抢跑"最容易发生的入口
  const v = settlementView() ?? live;
  animateTopsFlag = animateTops;
  renderOpponents(v, true);
  renderYouPlayed(v);
  renderHand(v);
  refreshTutorialGate(); // 重建手牌/按钮会冲掉门控类，这里补回来
}

// ============ 顶部 ============

function renderHeader(v: PlayerView) {
  const el = els!.header.querySelector('#round-info')!;
  if (v.roundPhase === null) {
    if (el.textContent !== '') el.textContent = '';
    return;
  }
  const cap = v.settings.maxRounds > 0 ? ` / ${v.settings.maxRounds}` : '';
  const ramp = v.settings.anteRamp > 0 ? ` · 每 ${v.settings.anteRamp} 回合 +1` : '';
  // 底注会随递增变大，直接把本回合的实际值摆出来，玩家才看得懂奖池为什么变大
  // v.ante 来自服务端；旧版本服务端没有这个字段，回落到设置里的基础底注
  const info = `第 ${v.roundNo}${cap} 回合 · ${phaseLabel(v)} · 底注 ${v.ante ?? v.settings.ante}${ramp}`;
  if (el.textContent !== info) el.textContent = info;
}

function phaseLabel(v: PlayerView): string {
  switch (v.roundPhase) {
    case 'defense_window': return '防守宣言';
    case 'opening': return '宣战';
    case 'rotation': return '轮转跟牌';
    case 'settlement': return '结算';
    default: return '';
  }
}

function nameOf(v: PlayerView, seat: number): string {
  return v.players.find((p) => p.seat === seat)?.name ?? '?';
}

// ============ 对手卡片 ============

/**
 * 对手卡片区。
 *
 * `withSegs=false` 时只刷新名字/筹码/状态这些 HUD 部分，**不碰出牌区**。
 * 出牌区（.opp-segs）属于"卡牌画面"，播放动画期间必须由动画按自己的节奏重绘——
 * 否则任何一次快照渲染都会把对手刚出的牌先画出来，动画再把它藏起来重飞一遍，
 * 玩家看到的就是"先出现 → 突然消失 → 再一张张打出"。
 */
function renderOpponents(v: PlayerView, withSegs = true) {
  const wrap = els!.opponents;
  const you = v.you.seat;

  for (const p of v.players) {
    if (p.seat === you) continue;
    let el = wrap.querySelector(`.opp-card[data-seat="${p.seat}"]`) as HTMLElement | null;
    if (!el) {
      el = document.createElement('div');
      el.className = 'opp-card';
      el.dataset.seat = String(p.seat);
      el.innerHTML = `<div class="opp-head"></div><div class="opp-hand" data-hand></div><div class="opp-meta"></div><div class="opp-segs"></div>`;
      wrap.appendChild(el);
    }
    el.className = oppClass(p, v);

    const headKey = `${p.name}|${p.isHost}|${p.chips}|${p.escrow}|${p.status}|${p.agreeEnd}|${p.away}`;
    const head = el.querySelector('.opp-head') as HTMLElement;
    if (head.dataset.key !== headKey) {
      head.dataset.key = headKey;
      head.innerHTML = `
        <span class="opp-name">${avatarSVG(p.avatar, 'neutral', 1)}${p.name}${p.isHost ? '<span class="host-mark">👑</span>' : ''}
          ${p.status === 'defended' ? '<span class="badge defense">防守</span>' : ''}
          ${p.agreeEnd ? '<span class="badge agree">同意</span>' : ''}
          ${p.away ? '<span class="badge away">托管</span>' : ''}
        </span>
        <span class="opp-chips">💰${p.chips}${p.escrow > 0 ? ` · 托管${p.escrow}` : ''}</span>
      `;
    }

    // 手牌堆：蜘蛛纸牌式半叠牌背，代表其全部手牌
    const handStack = el.querySelector('[data-hand]') as HTMLElement;
    const handKey = String(p.handCount);
    if (handStack.dataset.key !== handKey) {
      handStack.dataset.key = handKey;
      handStack.innerHTML = '';
      handStack.title = `手牌 ${p.handCount} 张`;
      for (let i = 0; i < Math.min(p.handCount, 8); i++) {
        handStack.appendChild(Object.assign(document.createElement('div'), { className: 'stack-back' }));
      }
      const cnt = document.createElement('span');
      cnt.className = 'stack-count';
      cnt.textContent = `${p.handCount}`;
      handStack.appendChild(cnt);
    }
    const metaKey = `${p.betTotal}|${p.lastAction ?? ''}`;
    const meta = el.querySelector('.opp-meta') as HTMLElement;
    if (meta.dataset.key !== metaKey) {
      meta.dataset.key = metaKey;
      meta.innerHTML = `
        <span class="opp-bet">${p.betTotal > 0 ? `${chipStack(p.betTotal)} 押${p.betTotal}` : ''}</span>
        <span>${p.lastAction ?? ''}</span>
      `;
    }

    if (withSegs) renderSegs(el.querySelector('.opp-segs') as HTMLElement, p, v, false);
  }

  for (const el of [...wrap.querySelectorAll('.opp-card')]) {
    const card = el as HTMLElement;
    const seat = Number(card.dataset.seat);
    if (!v.players.find((p) => p.seat === seat)) card.remove();
  }
}

function oppClass(p: PublicPlayer, v: PlayerView): string {
  const cls = ['opp-card'];
  if (v.turnSeat === p.seat && (v.roundPhase === 'opening' || v.roundPhase === 'rotation')) cls.push('turn');
  if (p.status === 'folded') cls.push('folded');
  if (p.status === 'out') cls.push('out');
  if (p.status === 'defended') cls.push('defended');
  return cls.join(' ');
}

/**
 * 出战区的一张牌。两个视觉维度分开表达：
 *  - `revealed`：这张是**摊在桌上所有人都能看到**的（每段的最大牌）；
 *    否则是"只有自己看得到"的牌 → 压暗
 *  - `used`：这张参与了当前牌型 → 镶银边
 */
function fieldCard(card: Card, opts: { revealed: boolean; used: boolean; mini?: boolean }): HTMLElement {
  const node = createCard(card, { up: true, mini: opts.mini ?? true });
  node.classList.add(opts.revealed ? 'revealed' : 'private');
  if (opts.used) node.classList.add('used');
  return node;
}

/** 摊牌展示：把组成牌型的牌归拢到前面，方便一眼看出是哪几张凑成的 */
function groupByUsed(cards: Card[], usedIds: string[]): Card[] {
  const used = new Set(usedIds);
  return [...cards].sort((a, b) => Number(used.has(b.id)) - Number(used.has(a.id)));
}

/** 一个"出牌段"簇：显示该段全部实体牌（亮牌 + 牌背），横向半叠避免纵向拉高 */
/**
 * 一个座位本回合的出牌，全部**压成一行**横向铺开。
 *
 * 原来每一段各占一个盒子，装不下就换行 → 竖向堆叠，直接把对手卡片撑爆
 * （卡片高度是内容决定的，超出对手区就被裁掉）。现在不管分几段出牌，
 * 都按顺序铺在同一行里：亮出的最大牌正面朝上，其余暗牌，段与段之间靠
 * 亮牌的位置自然分界。手牌最多 6 张，所以一行必然放得下。
 */
function playedRow(segs: { count: number; top: Card | null }[], own: boolean): HTMLElement {
  const cluster = document.createElement('div');
  cluster.className = 'seg';
  const row = document.createElement('div');
  row.className = 'seg-cards';

  for (const seg of segs) {
    for (let i = 0; i < seg.count; i++) {
      const isTopCard = !!seg.top && i === 0;
      const node = createCard(isTopCard ? seg.top : null, { up: (isTopCard && !animateTopsFlag) || own, mini: !own });
      node.classList.add(isTopCard ? 'revealed' : 'private');
      row.appendChild(node);
      if (isTopCard && animateTopsFlag) {
        requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('up')));
      }
    }
  }
  cluster.appendChild(row);

  const total = segs.reduce((n, s0) => n + s0.count, 0);
  const revealed = segs.filter((s0) => s0.top).map((s0) => cardLabel(s0.top!));
  const label = document.createElement('span');
  label.className = 'seg-count';
  label.textContent = revealed.length ? `亮 ${revealed.join(' / ')} · 共 ${total} 张` : `暗牌 ${total} 张`;
  cluster.appendChild(label);
  return cluster;
}

function renderSegs(el: HTMLElement, p: PublicPlayer, v: PlayerView, own: boolean) {
  // 演出期间**不**用 result 的全员明牌：亮牌由动画按座位逐个演，
  // 状态渲染抢先把 result 画出来就是"所有人的牌突然全亮挤在一堆"。
  const faceUpAll = !holdingForSettlement() && v.result && !v.result.voidRound;
  const entry = faceUpAll ? v.result!.entries.find((e) => e.seat === p.seat) : null;
  const segsKey = entry
    ? 'all:' + entry.cards.map((c) => c.id).join(',')
    : 'segs:' + p.playSegments.map((s0) => `${s0.count}:${s0.top?.id ?? '-'}`).join(',');
  if (el.dataset.key === segsKey) return;
  el.dataset.key = segsKey;
  el.innerHTML = '';

  if (entry) {
    const cluster = document.createElement('div');
    cluster.className = 'seg';
    const row = document.createElement('div');
    row.className = 'seg-cards';
    for (const c of groupByUsed(entry.cards, entry.usedIds)) {
      row.appendChild(fieldCard(c, { revealed: true, used: entry.usedIds.includes(c.id) }));
    }
    cluster.appendChild(row);
    const label = document.createElement('span');
    label.className = 'seg-count gold-text';
    label.textContent = `${entry.handAlias}·${entry.handName}`;
    cluster.appendChild(label);
    el.appendChild(cluster);
    return;
  }

  if (p.playSegments.length === 0) {
    const tip = document.createElement('span');
    tip.className = 'seg-count';
    tip.style.color = 'var(--dim)';
    tip.textContent = '未出牌';
    el.appendChild(tip);
    return;
  }
  // 一行铺开：分几段出牌都不换行，避免把对手卡片撑高到裁切
  el.appendChild(playedRow(p.playSegments, own));
}

// ============ 中央奖池 ============

function renderCenter(v: PlayerView) {
  if (els!.potNum.textContent !== String(v.pot)) els!.potNum.textContent = String(v.pot);
  const target = Math.min(10, v.pot);
  if (els!.potChips.childElementCount !== target) {
    els!.potChips.innerHTML = '';
    for (let i = 0; i < target; i++) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.style.marginLeft = i === 0 ? '0' : '-8px';
      els!.potChips.appendChild(c);
    }
  }
  const tip = phaseTip(v);
  if (els!.phaseTip.textContent !== tip) els!.phaseTip.textContent = tip;
  const mb = v.maxBet > 0 ? `场上最大押注 ${v.maxBet}` : '尚无人押注';
  if (els!.maxBet.textContent !== mb) els!.maxBet.textContent = mb;
}

function phaseTip(v: PlayerView): string {
  const you = v.you;
  switch (v.roundPhase) {
    case 'defense_window':
      return you.legalActions.canDeclareDefense || you.legalActions.canPassDefense ? '防守宣言阶段：要防守吗？' : '等待其他玩家表态…';
    case 'opening':
      return v.turnSeat === you.seat ? '轮到你宣战！' : `等待 ${nameOf(v, v.turnSeat!)} 宣战`;
    case 'rotation':
      return v.turnSeat === you.seat ? '轮到你行动' : `等待 ${nameOf(v, v.turnSeat!)} 行动`;
    case 'settlement':
      return '结算中…';
    default:
      return '';
  }
}

function chipStack(count: number): string {
  const n = Math.min(count, 6);
  let html = '<span class="chip-stack">';
  for (let i = 0; i < n; i++) html += '<span class="chip"></span>';
  html += '</span>';
  return html;
}

// ============ 己方区域 ============

/** 己方出牌段：battlefield 按每段张数切片（自己看得见全部明牌） */
function ownSegmentCards(v: PlayerView): { cards: Card[]; seg: PlaySegment }[] {
  const you = v.you;
  let i = 0;
  return you.playSegments.map((seg) => {
    const cards = you.battlefield.slice(i, i + seg.count);
    i += seg.count;
    return { cards, seg };
  });
}

function renderYouPlayed(v: PlayerView) {
  const el = els!.youPlayed;
  const groups = ownSegmentCards(v);
  const faceUpAll = !holdingForSettlement() && v.result && !v.result.voidRound;
  const key = JSON.stringify({
    segs: v.you.playSegments.map((s0) => `${s0.count}:${s0.top?.id ?? '-'}`),
    bf: v.you.battlefield.map((c) => c.id),
    all: faceUpAll ? v.result!.entries.find((e) => e.seat === v.you.seat)?.cards.map((c) => c.id) : null,
  });
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = '';

  const entry = faceUpAll ? v.result!.entries.find((e) => e.seat === v.you.seat) : null;
  if (entry) {
    const cluster = document.createElement('div');
    cluster.className = 'seg';
    const row = document.createElement('div');
    row.className = 'seg-cards';
    for (const c of groupByUsed(entry.cards, entry.usedIds)) {
      row.appendChild(fieldCard(c, { revealed: true, used: entry.usedIds.includes(c.id) }));
    }
    cluster.appendChild(row);
    const label = document.createElement('span');
    label.className = 'seg-count gold-text';
    label.textContent = `你 · ${entry.handAlias}·${entry.handName}`;
    cluster.appendChild(label);
    el.appendChild(cluster);
    return;
  }

  const mark = bestHandCards(v.you.battlefield);
  for (const { cards, seg } of groups) {
    const cluster = document.createElement('div');
    cluster.className = 'seg';
    const row = document.createElement('div');
    row.className = 'seg-cards';
    for (const c of cards) {
      // 自己打出的牌自己全程可见，但只有"亮出的最大牌"是全场公开的：
      // 公开的做高亮，其余压暗——这样一眼就知道自己有几张是明着的
      const revealed = seg.top?.id === c.id;
      const node = fieldCard(c, {
        revealed,
        used: !!mark?.hand.usedIds.includes(c.id) && v.you.battlefield.length > 1,
      });
      if (revealed && animateTopsFlag && cards.length > 1) {
        // 多张段的最大牌播放一次强调动画
        node.animate([{ filter: 'brightness(1.9)' }, { filter: 'brightness(1)' }], { duration: 500 });
      }
      row.appendChild(node);
    }
    cluster.appendChild(row);
    const label = document.createElement('span');
    label.className = 'seg-count';
    label.textContent = `你 · ${seg.top ? `亮 ${seg.count} 张` : `暗 ${seg.count} 张`}`;
    cluster.appendChild(label);
    el.appendChild(cluster);
  }
}

function renderOwnStatus(v: PlayerView) {
  const el = els!.ownStatus;
  const you = v.you;
  const bf = bestHandCards(you.battlefield);
  // 杂牌数 = 出战区里没用上的牌（掺水规则），不能用 bestHand 的 junk（那是按凑牌型的子集算的，恒为 0）
  const bfText = bf ? `出战区 <b>${handLabel(bf.hand.typeRank)}</b> · 杂 ${battlefieldJunk(you.battlefield)}` : '出战区：空';
  const key = `${you.avatar}|${you.chips}|${you.betTotal}|${you.battlefield.length}|${you.escrow}|${bf?.hand.typeRank ?? 0}|${v.pot}|${v.maxBet}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = `
    <span class="own-av">${avatarSVG(you.avatar, 'neutral', 1)} <b>${you.name}</b></span>
    <span>💰 <b>${you.chips}</b></span>
    <span>已押 <b>${you.betTotal}</b>${you.escrow > 0 ? ` · 托管 <b>${you.escrow}</b>` : ''}</span>
    <span>${bfText} · 上限 <b>${you.battlefield.length * v.settings.chipMultiplier}</b></span>
    <span>🏺 <b>${v.pot}</b> · 场上最大注 <b>${v.maxBet}</b></span>
  `;
}

function renderHand(v: PlayerView) {
  const hand = els!.hand;
  const ids = v.you.hand.map((c) => c.id).join(',');
  // 手牌集合变化（发牌/出牌）才重建；选择变化只改样式 → 抬起动画有过渡
  if (hand.dataset.ids !== ids) {
    hand.dataset.ids = ids;
    hand.innerHTML = '';
    // 自动理牌：花色组 ♠♣♥♦，组内点数从大到小（A 最大）
    const sorted = [...v.you.hand].sort((a, b) => {
      const ra = a.rank === 1 ? 14 : a.rank;
      const rb = b.rank === 1 ? 14 : b.rank;
      return b.suit - a.suit || rb - ra;
    });
    // 本轮新补的牌：金框 + 「新」角标；发牌落位那次重建加脉冲动画
    const freshSet = new Set(getState().ui.freshIds);
    for (const c of sorted) {
      const node = createCard(c, { up: true });
      node.dataset.id = c.id;
      if (freshSet.has(c.id)) {
        node.classList.add('fresh');
        if (animateTopsFlag) node.classList.add('fresh-anim');
      }
      hand.appendChild(node);
    }
    if (sorted.length === 0) hand.innerHTML = '<span class="hint">手牌已出完</span>';
  }
  // 选中态：整张上抬（不旋转，点阵保持锐利）
  const selected = new Set(getState().ui.selected);
  for (const node of [...hand.children] as HTMLElement[]) {
    if (!node.dataset.id) continue;
    const isSel = selected.has(node.dataset.id);
    node.classList.toggle('sel', isSel);
    node.style.transform = isSel ? 'translateY(-16px)' : '';
    node.style.zIndex = isSel ? '5' : '';
  }
}

// ============ 对局表情气泡 ============

/** 每个座位同一时刻只有一个气泡；发送新表情直接顶掉旧的 */
const emoteTimers = new Map<number, { el: HTMLElement; timers: [number, number] }>();

function showEmoteBubble(seat: number, mood: string) {
  if (!els) return;
  if (!(EMOTE_MOODS as readonly string[]).includes(mood)) return; // 防御：非白名单表情不渲染
  const v = getState().view;
  if (!v) return;
  const isYou = v.you.seat === seat;
  const player = v.players.find((p) => p.seat === seat);
  if (!isYou && !player) return;

  const old = emoteTimers.get(seat);
  if (old) {
    clearTimeout(old.timers[0]);
    clearTimeout(old.timers[1]);
    old.el.remove();
    emoteTimers.delete(seat);
  }

  const anchor = isYou
    ? (document.getElementById('own-status') ?? document.getElementById('you-zone'))
    : els.table.querySelector(`.opp-card[data-seat="${seat}"]`);
  if (!anchor) return;

  const el = document.createElement('div');
  el.className = 'emote-bubble';
  el.innerHTML = `<span class="emote-face">${avatarSVG(player?.avatar ?? v.you.avatar, mood as Mood, 3)}</span><span class="emote-name">${player?.name ?? v.you.name}</span>`;

  // 先入层才能量宽高，再按锚点定位：水平居中于锚点、垂直浮在其上方，越界则贴边。
  // 自己的气泡锚在 #own-status：那是己方区顶部，再往上就是出战区——
  // 气泡短暂盖住出战区无妨，但绝不能往下掉进押注坞/手牌区挡操作。
  els.emoteLayer.appendChild(el);
  const layerR = els.table.getBoundingClientRect();
  const aR = anchor.getBoundingClientRect();
  const bR = el.getBoundingClientRect();
  const left = Math.max(4, Math.min(layerR.width - bR.width - 4, aR.left - layerR.left + aR.width / 2 - bR.width / 2));
  const top = Math.max(4, aR.top - layerR.top - bR.height - 10);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  const hide = window.setTimeout(() => el.classList.add('bye'), 2_400);
  const drop = window.setTimeout(() => {
    el.remove();
    emoteTimers.delete(seat);
  }, 2_900);
  emoteTimers.set(seat, { el, timers: [hide, drop] });
}

function onHandClick(e: Event) {
  const cardEl = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
  if (!cardEl?.dataset.id) return;
  toggleSelect(cardEl.dataset.id);
  renderHand(getState().view!);
  renderActionBar(getState().view!);
}

// ============ 操作栏（防守/同意/提示） + 押注坞（滑块+大按钮） ============

function renderActionBar(v: PlayerView) {
  const bar = els!.actionBar;
  const you = v.you;
  const la = you.legalActions;
  const ui = getState().ui;
  const selected = ui.selected;
  const key = JSON.stringify([v.roundPhase, la.roundPhase, la.isYourTurn, la.canDeclareDefense, la.canPassDefense, la.canForceCloseDefense, la.canAgree, you.agreeEnd, you.status, you.defensePassed, v.turnSeat, v.phase, you.chips, you.betTotal, v.maxBet, selected.length]);
  if (bar.dataset.key === key) return;
  bar.dataset.key = key;
  bar.innerHTML = '';

  if (v.phase === 'gameover' || v.roundPhase === 'settlement') {
    bar.innerHTML = `<span class="hint">${v.phase === 'gameover' ? '对局结束' : '结算中，马上进入下一回合…'}</span>`;
    return;
  }

  if (v.roundPhase === 'defense_window') {
    if (you.status === 'defended') {
      bar.innerHTML = `<span class="hint">本回合你已防守（${you.battlefield.length} 张 · 托管 ${you.escrow}），等待开局…</span>`;
      return;
    }
    if (you.defensePassed) {
      bar.innerHTML = `<span class="hint">已表态不防守，等待开局…</span>`;
      return;
    }
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = `防守 N 张 = 总投入 N 筹码（含底注，现有 ${you.chips}），选中手牌后点【宣布防守】`;
    bar.appendChild(hint);
    const pass = document.createElement('button');
    pass.className = 'steel iconed def';
    pass.dataset.act = 'pass_defense';
    pass.textContent = '不防守';
    pass.addEventListener('click', () => {
      sfx.click();
      void gameAction({ t: 'pass_defense' });
    });
    bar.appendChild(pass);
    if (la.canForceCloseDefense) {
      const force = document.createElement('button');
      force.className = 'ghost iconed skp';
      force.dataset.act = 'force_close_defense';
      force.textContent = '直接开始（跳过等待）';
      force.addEventListener('click', () => {
        sfx.click();
        void gameAction({ t: 'force_close_defense' });
      });
      bar.appendChild(force);
    }
    return;
  }

  if (v.roundPhase !== 'opening' && v.roundPhase !== 'rotation') return;

  if (!la.isYourTurn) {
    bar.innerHTML = `<span class="hint">${phaseTip(v)} · 场上最大押注 ${v.maxBet}</span>`;
    return;
  }

  // 出牌段相关提示（滑块和大按钮在 bet-dock）
  const selN = selected.length;
  // 已有出战区但押注被别人抬高：必须补到场上最大押注才能继续（同意结束也被锁），
  // 这是玩家最容易愣住的时刻——不给提示就只会看到一句"等待中…"。
  if (you.battlefield.length > 0 && you.betTotal < v.maxBet) {
    const need = v.maxBet - you.betTotal;
    const warn = document.createElement('span');
    warn.className = 'hint-warn';
    warn.textContent = `⚠ 押注被抬高：场上最大 ${v.maxBet}，你已押 ${you.betTotal} —— 须补 ${need}（上方「加注」或选牌「加牌」跟注），否则弃牌`;
    bar.appendChild(warn);
  }
  if (you.battlefield.length === 0 && selN === 0) {
    const tip = document.createElement('span');
    tip.className = 'hint';
    tip.textContent = la.maxBet > 0
      ? `① 点选手牌 → ② 上方滑块押注（须 ≥ ${la.maxBet}）→ ③ 点【出战】`
      : '① 点选手牌 → ② 上方滑块押注 → ③ 点【出战】';
    bar.appendChild(tip);
  }

  if (la.canAgree) {
    const btn = document.createElement('button');
    btn.dataset.act = 'agree_end';
    btn.textContent = you.agreeEnd ? '取消同意' : '同意结束';
    btn.className = you.agreeEnd ? 'iconed def' : 'ghost iconed def';
    btn.addEventListener('click', () => {
      sfx.click();
      void gameAction({ t: 'agree_end', agree: !you.agreeEnd });
    });
    bar.appendChild(btn);
  }

  if (bar.children.length === 0) {
    bar.innerHTML = `<span class="hint">等待中…</span>`;
  }
}

/** 押注坞：滑块 + 大按钮（出战/加牌/加注） + 大号弃牌，位于手牌上方 */
function renderBetDock(v: PlayerView) {
  const dock = els!.betDock;
  const you = v.you;
  const la = you.legalActions;
  const ui = getState().ui;
  const selected = ui.selected;
  const selCards = you.hand.filter((c) => selected.includes(c.id));
  const mult = v.settings.chipMultiplier;
  const key = JSON.stringify([v.roundPhase, la, selected, ui.bet, v.turnSeat, v.phase]);
  if (dock.dataset.key === key) return;
  dock.dataset.key = key;
  dock.innerHTML = '';

  const show =
    v.phase === 'playing' &&
    you.status === 'active' &&
    (v.roundPhase === 'defense_window'
      ? la.canDeclareDefense
      : (v.roundPhase === 'opening' || v.roundPhase === 'rotation') && la.isYourTurn);
  if (!show) {
    dock.style.display = 'none';
    return;
  }
  dock.style.display = '';

  const addPreview = () => {
    if (selected.length === 0) return;
    const got = bestHandCards(selCards);
    if (got) {
      const top = got.used[got.used.length - 1];
      const d = document.createElement('span');
      d.className = 'preview';
      d.textContent = `已选 ${handLabel(got.hand.typeRank)} · 最大 ${top ? cardLabel(top) : '?'} · 用 ${got.used.length} · 杂 ${battlefieldJunk(selCards)}`;
      dock.appendChild(d);
    }
  };

  const mkSlider = (id: string, label: string, min: number, max: number, val: number, field: 'bet' = 'bet') => {
    const group = document.createElement('div');
    group.className = 'slider-group';
    group.innerHTML = `<span class="hint">${label}</span><input id="${id}" type="range" min="${min}" max="${max}" value="${val}" /><span class="val">${val}</span>`;
    const slider = group.querySelector<HTMLInputElement>(`#${id}`)!;
    slider.addEventListener('input', () => {
      group.querySelector('.val')!.textContent = slider.value;
      patchUI({ [field]: Number(slider.value) });
      dock.dataset.key = ''; // 数值变化即时反映在按钮文字上
      renderBetDock(v);
    });
    return group;
  };

  const bigBtn = (label: string, cls: string, act: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = `dock-btn ${cls}`;
    b.dataset.act = act;
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };

  const commit = (fn: () => Promise<boolean>) =>
    fn().then((ok) => {
      if (ok) patchUI({ selected: [], bet: null });
    });

  // 防守宣言窗口：选牌 → 托管滑块（≥ 牌数、≤ 全部筹码）→ 宣布防守
  if (v.roundPhase === 'defense_window') {
    const n = selected.length;
    if (n === 0) {
      const tip = document.createElement('span');
      tip.className = 'hint';
      tip.textContent = '先在下方点选手牌作为防守牌（至少 1 张）';
      dock.appendChild(tip);
    } else {
      // 防守投入是定量的：N 张 = 本回合总投入 N 筹码（底注已含在内），
      // 引擎只补 N − 底注 的差额——没有滑块，选完牌直接宣布。
      const need = Math.max(0, n - v.ante);
      if (need <= you.chips) {
        const tip = document.createElement('span');
        tip.className = 'hint';
        tip.textContent = `防守 ${n} 张 = 总投入 ${n} 筹码（含底注 ${v.ante}${need > 0 ? `，还需另付 ${need}` : '，无需再付'}）`;
        dock.appendChild(tip);
        dock.appendChild(
          bigBtn(`宣布防守 ${n} 张`, 'steel iconed def', 'declare_defense', () =>
            commit(() => gameAction({ t: 'declare_defense', cardIds: [...selected] })),
          ),
        );
      } else {
        const tip = document.createElement('span');
        tip.className = 'hint';
        tip.textContent = `防守 ${n} 张须总投入 ${n}（含底注），你只剩 ${you.chips} 筹码 —— 少选几张`;
        dock.appendChild(tip);
      }
    }
    addPreview();
    return;
  }

  if (la.canPlay && selected.length > 0) {
    const cap = Math.min(selected.length * mult, you.chips);
    const minBet = la.maxBet;
    if (cap >= minBet) {
      const betVal = Math.max(minBet, Math.min(ui.bet ?? Math.max(minBet, 1), cap));
      dock.appendChild(mkSlider('bet', `押注（≤ ${cap}）`, minBet, cap, betVal));
      dock.appendChild(
        bigBtn(`出战 ${selected.length} 张`, 'primary iconed atk', 'play', () =>
          commit(() => gameAction({ t: 'play', cardIds: [...selected], bet: Number(dock.querySelector('.val')!.textContent!) })),
        ),
      );
    } else {
      const tip = document.createElement('span');
      tip.className = 'hint';
      tip.textContent = `押注须 ≥ ${minBet}，当前最多 ${cap}${cap < minBet ? ' —— 张数不够，多选几张' : ''}`;
      dock.appendChild(tip);
    }
  } else if (you.battlefield.length > 0 && selected.length > 0 && la.canAddCards) {
    const n = selected.length;
    const min = Math.max(0, v.maxBet - you.betTotal);
    const max = Math.min(you.chips, (you.battlefield.length + n) * mult - you.betTotal);
    if (max >= min) {
      const delta = Math.max(min, Math.min(ui.bet ?? min, max));
      dock.appendChild(mkSlider('delta', `加注（${min}~${max}）`, min, max, delta));
      dock.appendChild(
        bigBtn(`加牌 ${n} 张`, 'primary iconed atk', 'add_cards', () =>
          commit(() => gameAction({ t: 'add_cards', cardIds: [...selected], betDelta: Number(dock.querySelector('.val')!.textContent!) })),
        ),
      );
    } else {
      const tip = document.createElement('span');
      tip.className = 'hint';
      tip.textContent = `加 ${n} 张也押不满 ${v.maxBet}，多选几张`;
      dock.appendChild(tip);
    }
  } else if (la.canAddChips) {
    // 下限至少 1：加注 0 没有任何效果，还会把全桌的"同意结束"清掉。
    // 引擎已不再为这种情况提供 canAddChips，这里再兜一道，滑块不会出现 0。
    const { min, max } = la.canAddChips;
    const lo = Math.max(1, min);
    if (max >= lo) {
      const delta = Math.max(lo, Math.min(ui.bet ?? lo, max));
      dock.appendChild(mkSlider('chips', `加注（${lo}~${max}）`, lo, max, delta));
      dock.appendChild(
        bigBtn(`加注 ${delta}`, 'primary iconed atk', 'add_chips', () =>
          commit(() => gameAction({ t: 'add_chips', betDelta: Number(dock.querySelector('.val')!.textContent!) })),
        ),
      );
    }
  } else if (la.canPlay) {
    const tip = document.createElement('span');
    tip.className = 'hint';
    tip.textContent = '在下方点选手牌（张数 × 筹码倍数 = 押注上限）';
    dock.appendChild(tip);
  }

  addPreview();

  if (la.canFold) {
    const fold = document.createElement('button');
    fold.className = 'dock-btn ghost iconed bak';
    fold.dataset.act = 'fold';
    fold.textContent = '弃牌';
    fold.addEventListener('click', () => {
      if (confirm('确定弃牌？已押筹码将进入奖池且无法收回。')) {
        sfx.click();
        void gameAction({ t: 'fold' }).then((ok) => {
          if (ok) patchUI({ selected: [], bet: null });
        });
      }
    });
    dock.appendChild(fold);
  }
}

// ============ 摊牌准备 / 教官裁定 ============

/**
 * 摊牌一开始只把所有人的牌**背面**摆回各自区域，先不亮。
 * 亮牌交给 anim.ts 按座位逐个翻开 + 飞到中央展示台。
 * 统一用 mini 尺寸：中央展示台一套尺寸，飞进飞出不会忽大忽小。
 */
function prepareShowdown(entries: ShowdownEntry[]): {
  seat: number;
  nodes: HTMLElement[];
  cards: Card[];
  usedIds: string[];
  label: HTMLElement;
}[] {
  const you = getState().view!.you.seat;
  const out: { seat: number; nodes: HTMLElement[]; cards: Card[]; usedIds: string[]; label: HTMLElement }[] = [];
  for (const entry of entries) {
    const own = entry.seat === you;
    const container = own ? els!.youPlayed : (document.querySelector(`.opp-card[data-seat="${entry.seat}"] .opp-segs`) as HTMLElement | null);
    if (!container) continue;
    container.innerHTML = '';
    const cluster = document.createElement('div');
    cluster.className = 'seg';
    const row = document.createElement('div');
    row.className = 'seg-cards';
    const nodes: HTMLElement[] = [];
    for (const c of entry.cards) {
      const node = createCard(c, { up: false, mini: true });
      row.appendChild(node);
      nodes.push(node);
    }
    cluster.appendChild(row);
    const label = document.createElement('span');
    label.className = 'seg-count gold-text';
    cluster.appendChild(label);
    cluster.dataset.reveal = '1';
    container.appendChild(cluster);
    out.push({ seat: entry.seat, nodes, cards: entry.cards, usedIds: entry.usedIds, label });
  }
  return out;
}

// ============ 中央展示台（摊牌演出用） ============

/** 开台：按张数提前占好卡槽，之后落座的牌不会把先落的挤走 */
function stageOpen(name: string, total: number) {
  if (!els) return;
  const { stage, stageName, stageCards, stageLabel, phaseBlock } = els;
  stageName.textContent = name;
  stageLabel.textContent = '';
  stageCards.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const slot = document.createElement('div');
    slot.className = 'stage-slot';
    slot.dataset.slot = String(i);
    stageCards.appendChild(slot);
  }
  stage.hidden = false;
  phaseBlock.hidden = true; // 阶段提示让位给展示台
}

function stageSlotEl(i: number): HTMLElement | null {
  return els?.stageCards.querySelector<HTMLElement>(`.stage-slot[data-slot="${i}"]`) ?? null;
}

function stageSlotRect(i: number): { left: number; top: number; width: number; height: number } | null {
  const el = stageSlotEl(i);
  return el ? el.getBoundingClientRect() : null;
}

function stageFill(i: number, card: Card, used = false) {
  const slot = stageSlotEl(i);
  if (!slot) return;
  slot.innerHTML = '';
  const node = createCard(card, { up: true, mini: true });
  node.classList.add('revealed');
  if (used) node.classList.add('used');
  slot.appendChild(node);
}

function stageClearSlot(i: number) {
  const slot = stageSlotEl(i);
  if (slot) slot.innerHTML = '';
}

function stageClose() {
  if (!els) return;
  els.stage.hidden = true;
  els.stageCards.innerHTML = '';
  els.phaseBlock.hidden = false;
}

/** 教官裁定：与横幅共用同一条队列，演出结束后自己收起，不留给下一个事件去覆盖 */
function verdictShow(html: string): Promise<void> {
  bannerBusy = bannerBusy.then(async () => {
    const ov = els!.overlay;
    ov.innerHTML = html;
    ov.classList.add('show');
    await new Promise((r) => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : 2600));
    ov.classList.remove('show');
    ov.innerHTML = '';
  });
  return bannerBusy;
}

// ============ 倒计时 ============

function renderCountdown(v: PlayerView) {
  cancelAnimationFrame(countdownRaf);
  const el = els!.countdown;
  if (!v.deadlineAt || v.roundPhase === 'settlement') {
    el.textContent = '';
    return;
  }
  if (v.deadlineAt > 8e15) {
    el.textContent = '∞ 不限时';
    el.style.color = 'var(--dim)';
    return;
  }
  const tickFn = () => {
    const remain = Math.max(0, Math.ceil((v.deadlineAt - Date.now()) / 1000));
    el.textContent = `⏳ ${remain}s`;
    el.style.color = remain <= 5 ? 'var(--danger)' : 'var(--gold)';
    if (remain <= 5 && remain !== lastTickSecond) {
      lastTickSecond = remain;
      if (remain > 0) sfx.tick();
    }
    if (remain > 0) countdownRaf = requestAnimationFrame(tickFn);
  };
  tickFn();
}

// ============ 横幅 / 覆盖层 / 日志 ============

let bannerBusy: Promise<void> = Promise.resolve();

function banner(main: string, sub = '', ms = 1000): Promise<void> {
  bannerBusy = bannerBusy.then(async () => {
    const ov = els!.overlay;
    ov.innerHTML = `
      <div class="banner">${main}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    `;
    ov.classList.add('show');
    await new Promise((r) => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : ms));
    ov.classList.remove('show');
    ov.innerHTML = '';
  });
  return bannerBusy;
}

function renderOverlay(v: PlayerView) {
  const ov = els!.overlay;
  if (v.phase === 'gameover') {
    if (ov.dataset.mode === 'gameover') return;
    ov.dataset.mode = 'gameover';
    const winner = v.players.find((p) => p.seat === v.winnerSeat);
    const sorted = [...v.players].sort((a, b) => b!.chips - a!.chips);
    ov.innerHTML = `
      <div class="banner">${winner?.name ?? '?'} 统治了城堡！</div>
      <div class="score pixel-panel">
        ${sorted.map((p) => `<div><b>${p!.name}</b> · ${p!.chips} 筹码</div>`).join('')}
      </div>
      ${v.isHost ? '<button id="btn-rematch" class="primary">再来一局</button>' : '<div class="sub">等待房主开始下一局…</div>'}
    `;
    ov.classList.add('show');
    ov.querySelector('#btn-rematch')?.addEventListener('click', () => {
      ov.dataset.mode = '';
      ov.classList.remove('show');
      void rematch();
    });
    return;
  }
  if (ov.dataset.mode === 'gameover') {
    ov.dataset.mode = '';
    ov.classList.remove('show');
    ov.innerHTML = '';
  }
}

function reportLine(line: string) {
  logLines.unshift(line);
  if (logLines.length > 30) logLines.pop();
  const box = document.getElementById('log-lines');
  if (box) box.innerHTML = logLines.map((l) => `<div class="log-line">${l}</div>`).join('');
}

// ============ 工具 ============

function tweenNumber(el: HTMLElement, to: number) {
  const from = Number(el.textContent ?? '0') || 0;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = String(to);
    return;
  }
  const start = performance.now();
  const dur = 400;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = String(Math.round(from + (to - from) * t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
