import type { Card, PlayerView, PlaySegment, PublicPlayer, ShowdownEntry } from '../../../shared/src/index';
import { bestHandCards, cardLabel } from '../../../shared/src/index';
import { createCard } from '../components/card';
import { renderHandTypes, toggleDrawer, handLabel } from '../components/drawer';
import { gameAction, rematch } from '../net/socket';
import { getState, patchUI, toggleSelect } from '../store';
import { setFxHooks, isBusy } from '../anim';
import { renderTutorial, tutorialActive } from '../components/tutorial';
import { avatarSVG } from '../components/pixelAvatar';
import { sfx, isMuted, toggleMute } from '../components/sfx';

/**
 * 桌面主视图 v2 —— 结构化三段式布局：
 *   对手卡片横排 → 中央奖池 → 己方区域（出牌段/状态/手牌/操作栏）
 * 全部 flex 流式布局，无绝对定位，不会互相重叠。
 * 渲染分两路：HUD 即时跟随权威快照；卡牌区域由动画系统在空闲时调用。
 */

let els: {
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
        <button id="btn-mute" class="ghost">🔊</button>
        <button id="btn-types" class="ghost">牌型表</button>
        <button id="btn-exit" class="ghost">退出</button>
      </div>
      <div id="opponents"></div>
      <div id="tutorial-slot"></div>
      <div id="center-row">
        <div id="deck-pile" title="牌堆">
          <div class="pile-card"></div>
          <div class="pile-card"></div>
          <span>牌堆</span>
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
      </div>
      <div id="you-zone">
        <div id="you-played"></div>
        <div id="own-status"></div>
        <div id="bet-dock"></div>
        <div id="hand"></div>
      </div>
      <div id="action-bar"></div>
      <div id="log">
        <div id="log-head">
          <span class="log-av">${avatarSVG('shirley', 'neutral', 1.2)}</span>
          <span>教官播报</span>
        </div>
        <div id="log-lines"></div>
      </div>
      <div id="overlay"></div>
      <div id="drawer"></div>
    </div>
  `;
  els = {
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
    drawer: root.querySelector('#drawer')!,
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
    verdict: (html) => verdictShow(html),
    banner,
    tweenPot: () => tweenNumber(els!.potNum, getState().view?.pot ?? 0),
  });
}

// ============ 总渲染入口 ============

export function render() {
  const v = getState().view;
  if (!v || !els) return;
  renderHeader(v);
  renderOpponents(v);
  renderCenter(v);
  renderOwnStatus(v);
  renderActionBar(v);
  renderBetDock(v);
  renderOverlay(v);
  if (!isBusy()) renderCards(false); // 动画进行中不踩卡牌区
  renderCountdown(v);
  if (tutorialActive()) renderTutorial(v, getState().ui.selected);
}

export function renderCards(animateTops: boolean) {
  const v = getState().view;
  if (!v || !els) return;
  animateTopsFlag = animateTops;
  renderOpponents(v);
  renderYouPlayed(v);
  renderHand(v);
}

// ============ 顶部 ============

function renderHeader(v: PlayerView) {
  const el = els!.header.querySelector('#round-info')!;
  const phase = v.roundPhase === null ? '' : `第 ${v.roundNo} 回合 · ${phaseLabel(v)}`;
  if (el.textContent !== phase) el.textContent = phase;
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

function renderOpponents(v: PlayerView) {
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
        <span class="opp-name">${avatarSVG(p.avatar, 'neutral', 1.5)}${p.name}${p.isHost ? '<span class="host-mark">👑</span>' : ''}
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

    renderSegs(el.querySelector('.opp-segs') as HTMLElement, p, v, false);
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

/** 一个"出牌段"簇：显示该段全部实体牌（亮牌 + 牌背），与手牌同尺寸 */
function segmentCluster(seg: { count: number; top: Card | null }, own = false): HTMLElement {
  const cluster = document.createElement('div');
  cluster.className = 'seg';
  for (let i = 0; i < seg.count; i++) {
    const isTopCard = !!seg.top && i === 0;
    const node = createCard(isTopCard ? seg.top : null, { up: (isTopCard && !animateTopsFlag) || own });
    cluster.appendChild(node);
    if (isTopCard && animateTopsFlag) {
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('up')));
    }
  }
  const label = document.createElement('span');
  label.className = 'seg-count';
  label.textContent = seg.top ? `亮牌 ×${seg.count}` : `暗牌 ×${seg.count}`;
  cluster.appendChild(label);
  return cluster;
}

function renderSegs(el: HTMLElement, p: PublicPlayer, v: PlayerView, own: boolean) {
  const faceUpAll = v.result && !v.result.voidRound;
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
    for (const c of entry.cards) {
      const node = createCard(c, { up: true }); // 摊牌全明牌、全尺寸
      if (entry.usedIds.includes(c.id)) node.classList.add('gold');
      cluster.appendChild(node);
    }
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
  for (const seg of p.playSegments) el.appendChild(segmentCluster(seg, own));
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
  const faceUpAll = v.result && !v.result.voidRound;
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
    for (const c of entry.cards) {
      const node = createCard(c, { up: true });
      if (entry.usedIds.includes(c.id)) node.classList.add('gold');
      cluster.appendChild(node);
    }
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
    for (const c of cards) {
      // 自己打出的牌自己全程可见：全部明牌
      const node = createCard(c, { up: true });
      if (seg.top?.id === c.id && animateTopsFlag && cards.length > 1) {
        // 多张段的最大牌播放一次强调动画
        node.animate([{ filter: 'brightness(1.9)' }, { filter: 'brightness(1)' }], { duration: 500 });
      }
      if (mark?.hand.usedIds.includes(c.id) && v.you.battlefield.length > 1) node.classList.add('mark');
      cluster.appendChild(node);
    }
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
  const bfText = bf ? `出战区 <b>${handLabel(bf.hand.typeRank)}</b> · 杂 ${bf.hand.junk}` : '出战区：空';
  const key = `${you.avatar}|${you.chips}|${you.betTotal}|${you.battlefield.length}|${you.escrow}|${bf?.hand.typeRank ?? 0}|${v.pot}|${v.maxBet}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = `
    <span class="own-av">${avatarSVG(you.avatar, 'neutral', 1.5)} <b>${you.name}</b></span><span class="sep">│</span>
    <span>💰 <b>${you.chips}</b></span><span class="sep">│</span>
    <span>已押 <b>${you.betTotal}</b>${you.escrow > 0 ? ` · 托管 <b>${you.escrow}</b>` : ''}</span><span class="sep">│</span>
    <span>${bfText}</span><span class="sep">│</span>
    <span>押注上限 = 牌数 <b>${you.battlefield.length}</b> × 倍数 <b>${v.settings.chipMultiplier}</b></span><span class="sep">│</span>
    <span>🏺 <b>${v.pot}</b> · 最大押注 <b>${v.maxBet}</b></span>
  `;
}

function renderHand(v: PlayerView) {
  const hand = els!.hand;
  const ids = v.you.hand.map((c) => c.id);
  const key = ids.join(',') + '|' + getState().ui.selected.join(',');
  if (hand.dataset.key === key) return;
  hand.dataset.key = key;
  hand.innerHTML = '';
  const selected = new Set(getState().ui.selected);
  for (const c of v.you.hand) {
    const node = createCard(c, { up: true });
    if (selected.has(c.id)) node.classList.add('sel');
    node.dataset.id = c.id;
    hand.appendChild(node);
  }
  if (v.you.hand.length === 0) {
    hand.innerHTML = '<span style="color:var(--dim);font-size:12px">手牌已出完</span>';
  }
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
  const key = JSON.stringify([v.roundPhase, la.roundPhase, la.isYourTurn, la.canDeclareDefense, la.canPassDefense, la.canForceCloseDefense, la.canAgree, you.agreeEnd, you.status, you.defensePassed, v.turnSeat, v.phase, you.chips, ui.escrow, selected.length]);
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
    hint.textContent = `防守：牌数 ≤ 托管筹码（筹码 ${you.chips}），选中手牌后点【宣布防守】`;
    bar.appendChild(hint);
    const pass = document.createElement('button');
    pass.textContent = '不防守';
    pass.addEventListener('click', () => {
      sfx.click();
      void gameAction({ t: 'pass_defense' });
    });
    bar.appendChild(pass);
    if (la.canForceCloseDefense) {
      const force = document.createElement('button');
      force.className = 'ghost';
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
  if (you.battlefield.length === 0 && selN === 0) {
    const tip = document.createElement('span');
    tip.className = 'hint';
    tip.textContent = '① 点选手牌 → ② 上方滑块押注 → ③ 点【出战】';
    bar.appendChild(tip);
  }

  if (la.canAgree) {
    const btn = document.createElement('button');
    btn.textContent = you.agreeEnd ? '取消同意' : '同意结束';
    btn.className = you.agreeEnd ? '' : 'ghost';
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
  const key = JSON.stringify([v.roundPhase, la, selected, ui.bet, ui.escrow, v.turnSeat, v.phase]);
  if (dock.dataset.key === key) return;
  dock.dataset.key = key;
  dock.innerHTML = '';

  const show =
    v.phase === 'playing' &&
    (v.roundPhase === 'opening' || v.roundPhase === 'rotation') &&
    la.isYourTurn &&
    you.status === 'active';
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
      d.textContent = `已选 ${handLabel(got.hand.typeRank)} · 最大 ${top ? cardLabel(top) : '?'} · 用 ${got.used.length} · 杂 ${got.hand.junk}`;
      dock.appendChild(d);
    }
  };

  const mkSlider = (id: string, label: string, min: number, max: number, val: number) => {
    const group = document.createElement('div');
    group.className = 'slider-group';
    group.innerHTML = `<span class="hint">${label}</span><input id="${id}" type="range" min="${min}" max="${max}" value="${val}" /><span class="val">${val}</span>`;
    const slider = group.querySelector<HTMLInputElement>(`#${id}`)!;
    slider.addEventListener('input', () => {
      group.querySelector('.val')!.textContent = slider.value;
      patchUI({ bet: Number(slider.value) });
      dock.dataset.key = ''; // 数值变化即时反映在按钮文字上
      renderBetDock(v);
    });
    return group;
  };

  const bigBtn = (label: string, cls: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = `dock-btn ${cls}`;
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };

  const commit = (fn: () => Promise<boolean>) =>
    fn().then((ok) => {
      if (ok) patchUI({ selected: [], bet: null });
    });

  if (la.canPlay && selected.length > 0) {
    const cap = Math.min(selected.length * mult, you.chips);
    const minBet = la.maxBet;
    if (cap >= minBet) {
      const betVal = Math.max(minBet, Math.min(ui.bet ?? Math.max(minBet, 1), cap));
      dock.appendChild(mkSlider('bet', `押注（≤ ${cap}）`, minBet, cap, betVal));
      dock.appendChild(
        bigBtn(`⚔ 出战 ${selected.length} 张`, 'primary', () =>
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
        bigBtn(`🂠 加牌 ${n} 张`, 'primary', () =>
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
    const { min, max } = la.canAddChips;
    const delta = Math.max(min, Math.min(ui.bet ?? min, max));
    dock.appendChild(mkSlider('chips', `加注（${min}~${max}）`, min, max, delta));
    dock.appendChild(
      bigBtn(`💰 加注 ${delta}`, 'primary', () =>
        commit(() => gameAction({ t: 'add_chips', betDelta: Number(dock.querySelector('.val')!.textContent!) })),
      ),
    );
  } else if (la.canPlay) {
    const tip = document.createElement('span');
    tip.className = 'hint';
    tip.textContent = '在下方点选手牌（张数 × 筹码倍数 = 押注上限）';
    dock.appendChild(tip);
  }

  addPreview();

  if (la.canFold) {
    const fold = document.createElement('button');
    fold.className = 'dock-btn danger-btn';
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

function prepareShowdown(entries: ShowdownEntry[]): { seat: number; cards: HTMLElement[]; label: HTMLElement }[] {
  const you = getState().view!.you.seat;
  const out: { seat: number; cards: HTMLElement[]; label: HTMLElement }[] = [];
  for (const entry of entries) {
    const own = entry.seat === you;
    const container = own ? els!.youPlayed : (document.querySelector(`.opp-card[data-seat="${entry.seat}"] .opp-segs`) as HTMLElement | null);
    if (!container) continue;
    container.innerHTML = '';
    const cluster = document.createElement('div');
    cluster.className = 'seg';
    const cards: HTMLElement[] = [];
    for (const c of entry.cards) {
      const node = createCard(c, { up: false, mini: !own });
      cluster.appendChild(node);
      cards.push(node);
    }
    const label = document.createElement('span');
    label.className = 'seg-count gold-text';
    cluster.appendChild(label);
    cluster.dataset.reveal = '1';
    container.appendChild(cluster);
    out.push({ seat: entry.seat, cards, label });
  }
  return out;
}

function verdictShow(html: string): Promise<void> {
  const ov = els!.overlay;
  ov.innerHTML = html;
  ov.classList.add('show');
  return new Promise((resolve) => setTimeout(() => resolve(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : 2100));
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
