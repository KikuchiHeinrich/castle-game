import type { Card, PlayerView, PlaySegment, PublicPlayer } from '../../../shared/src/index';
import { bestHandCards, cardLabel } from '../../../shared/src/index';
import { createCard } from '../components/card';
import { renderHandTypes, toggleDrawer, handLabel } from '../components/drawer';
import { gameAction, rematch } from '../net/socket';
import { getState, patchUI, toggleSelect } from '../store';
import { setFxHooks } from '../anim';
import { renderTutorial, tutorialActive } from '../components/tutorial';
import { avatarSVG } from '../components/pixelAvatar';

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
  hand: HTMLElement;
  actionBar: HTMLElement;
  log: HTMLElement;
  overlay: HTMLElement;
  drawer: HTMLElement;
} | null = null;

let countdownRaf = 0;
const logLines: string[] = [];
let animateTopsFlag = false;

export function mountTable(root: HTMLElement) {
  root.innerHTML = `
    <div id="table">
      <div id="table-header">
        <span class="room-code">${getState().view?.code ?? ''}</span>
        <span class="round-info" id="round-info"></span>
        <span class="spacer"></span>
        <button id="btn-types" class="ghost">牌型表</button>
        <button id="btn-exit" class="ghost">退出</button>
      </div>
      <div id="opponents"></div>
      <div id="center-row">
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
        <div id="hand"></div>
      </div>
      <div id="action-bar"></div>
      <div id="log"></div>
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
    hand: root.querySelector('#hand')!,
    actionBar: root.querySelector('#action-bar')!,
    log: root.querySelector('#log')!,
    overlay: root.querySelector('#overlay')!,
    drawer: root.querySelector('#drawer')!,
  };
  renderHandTypes(els.drawer);
  root.querySelector('#btn-types')!.addEventListener('click', () => toggleDrawer());
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
    handEl: () => els?.hand ?? null,
    ownBattlefieldEl: () => els?.youPlayed ?? null,
    potEl: () => root.querySelector('#pot-block') as HTMLElement | null,
    deckEl: () => els?.opponents ?? null,
    discardEl: () => els?.opponents ?? null,
    cardById: (id) => findPublicCard(id),
    banner,
    tweenPot: () => tweenNumber(els!.potNum, getState().view?.pot ?? 0),
  });
}

function findPublicCard(id: string) {
  const v = getState().view;
  if (!v) return null;
  const all = [
    ...v.players.flatMap((p) => p.playSegments.flatMap((s0) => (s0.top ? [s0.top] : []))),
    ...(v.result?.entries.flatMap((e) => e.cards) ?? []),
  ];
  return all.find((c) => c.id === id) ?? null;
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
  renderOverlay(v);
  renderCards(false);
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
      el.innerHTML = `<div class="opp-head"></div><div class="opp-meta"></div><div class="opp-segs"></div>`;
      wrap.appendChild(el);
    }
    el.className = oppClass(p, v);

    const headKey = `${p.name}|${p.isHost}|${p.chips}|${p.escrow}|${p.status}|${p.agreeEnd}|${p.away}`;
    const head = el.querySelector('.opp-head') as HTMLElement;
    if (head.dataset.key !== headKey) {
      head.dataset.key = headKey;
      head.innerHTML = `
        <span class="opp-name">${p.isBot ? avatarSVG('neutral', 1.5) : ''}${p.name}${p.isHost ? '<span class="host-mark">👑</span>' : ''}
          ${p.status === 'defended' ? '<span class="badge defense">防守</span>' : ''}
          ${p.agreeEnd ? '<span class="badge agree">同意</span>' : ''}
          ${p.away ? '<span class="badge away">托管</span>' : ''}
        </span>
        <span class="opp-chips">💰${p.chips}${p.escrow > 0 ? ` · 托管${p.escrow}` : ''}</span>
      `;
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

/** 一个"出牌段"簇：亮牌/暗牌 + 张数说明 */
function segmentCluster(seg: { count: number; top: Card | null }): HTMLElement {
  const cluster = document.createElement('div');
  cluster.className = 'seg';
  const node = createCard(seg.top, { mini: true, up: !!seg.top && !animateTopsFlag });
  cluster.appendChild(node);
  if (seg.top && animateTopsFlag) {
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('up')));
  }
  const label = document.createElement('span');
  label.className = 'seg-count';
  label.textContent = seg.top ? `亮 ${seg.count} 张` : `暗 ${seg.count} 张`;
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
      const node = createCard(c, { mini: !own, up: true });
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
  for (const seg of p.playSegments) el.appendChild(segmentCluster(seg));
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
  const key = `${you.chips}|${you.betTotal}|${you.battlefield.length}|${you.escrow}|${bf?.hand.typeRank ?? 0}|${v.pot}|${v.maxBet}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = `
    <span>💰 <b>${you.chips}</b></span><span class="sep">│</span>
    <span>已押 <b>${you.betTotal}</b>${you.escrow > 0 ? ` · 托管 <b>${you.escrow}</b>` : ''}</span><span class="sep">│</span>
    <span>${bfText}</span><span class="sep">│</span>
    <span>押注上限 = 出战区牌数 <b>${you.battlefield.length}</b></span><span class="sep">│</span>
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

// ============ 操作栏（逻辑不变，渲染目标更新） ============

function renderActionBar(v: PlayerView) {
  const bar = els!.actionBar;
  const you = v.you;
  const la = you.legalActions;
  const ui = getState().ui;
  const selected = ui.selected;
  const selCards = you.hand.filter((c) => selected.includes(c.id));
  const key = JSON.stringify([v.roundPhase, la, selected, ui.bet, ui.escrow, you.agreeEnd, v.turnSeat, v.phase]);
  if (bar.dataset.key === key) return;
  bar.dataset.key = key;
  bar.innerHTML = '';

  const addPreview = () => {
    if (selected.length === 0) return;
    const got = bestHandCards(selCards);
    if (got) {
      const top = got.used[got.used.length - 1];
      const d = document.createElement('span');
      d.className = 'preview';
      d.textContent = `已选 ${handLabel(got.hand.typeRank)} · 用 ${got.used.length} · 杂 ${got.hand.junk} · 最大 ${top ? cardLabel(top) : '?'}`;
      bar.appendChild(d);
    }
  };

  if (v.phase === 'gameover') {
    bar.innerHTML = `<span class="hint">对局结束</span>`;
    return;
  }
  if (v.roundPhase === 'settlement') {
    bar.innerHTML = `<span class="hint">结算中，马上进入下一回合…</span>`;
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
    hint.textContent = `防守：牌数 ≤ 托管筹码（筹码 ${you.chips}）`;
    bar.appendChild(hint);
    addPreview();
    if (selected.length > 0) {
      const group = document.createElement('div');
      group.className = 'slider-group';
      const defMin = selected.length;
      const defMax = you.chips;
      const escrowVal = Math.min(Math.max(ui.escrow ?? defMin, defMin), defMax);
      group.innerHTML = `<span class="hint">托管</span><input id="escrow" type="range" min="${defMin}" max="${defMax}" value="${escrowVal}" /><span class="val">${escrowVal}</span>`;
      bar.appendChild(group);
      const slider = group.querySelector<HTMLInputElement>('#escrow')!;
      slider.addEventListener('input', () => {
        group.querySelector('.val')!.textContent = slider.value;
        patchUI({ escrow: Number(slider.value) });
      });
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = `宣布防守（${selected.length} 张 / 托管 ${escrowVal}）`;
      btn.addEventListener('click', () => {
        void gameAction({ t: 'declare_defense', cardIds: [...selected], escrow: Number(slider.value) }).then((ok) => {
          if (ok) patchUI({ selected: [], escrow: null });
        });
      });
      bar.appendChild(btn);
    } else {
      const tip = document.createElement('span');
      tip.className = 'hint';
      tip.textContent = '（先在下方手牌里点选要防守的牌）';
      bar.appendChild(tip);
    }
    const pass = document.createElement('button');
    pass.textContent = '不防守';
    pass.addEventListener('click', () => void gameAction({ t: 'pass_defense' }));
    bar.appendChild(pass);
    if (la.canForceCloseDefense) {
      const force = document.createElement('button');
      force.className = 'ghost';
      force.textContent = '直接开始（跳过等待）';
      force.addEventListener('click', () => void gameAction({ t: 'force_close_defense' }));
      bar.appendChild(force);
    }
    return;
  }

  if (v.roundPhase !== 'opening' && v.roundPhase !== 'rotation') return;

  if (!la.isYourTurn) {
    bar.innerHTML = `<span class="hint">${phaseTip(v)} · 场上最大押注 ${v.maxBet}</span>`;
    return;
  }

  addPreview();

  const chips = you.chips;
  const bfCount = you.battlefield.length;

  if (la.canPlay) {
    const cap = Math.min(selected.length, chips);
    const minBet = la.maxBet;
    if (selected.length > 0 && cap >= minBet) {
      const group = document.createElement('div');
      group.className = 'slider-group';
      const betVal = Math.max(minBet, Math.min(ui.bet ?? minBet, cap));
      group.innerHTML = `<span class="hint">押注</span><input id="bet" type="range" min="${minBet}" max="${cap}" value="${betVal}" /><span class="val">${betVal}</span>`;
      bar.appendChild(group);
      const slider = group.querySelector<HTMLInputElement>('#bet')!;
      slider.addEventListener('input', () => {
        group.querySelector('.val')!.textContent = slider.value;
        patchUI({ bet: Number(slider.value) });
      });
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = `出战 ${selected.length} 张`;
      btn.addEventListener('click', () => {
        void gameAction({ t: 'play', cardIds: [...selected], bet: Number(slider.value) }).then((ok) => {
          if (ok) patchUI({ selected: [], bet: null });
        });
      });
      bar.appendChild(btn);
    } else {
      const tip = document.createElement('span');
      tip.className = 'hint';
      tip.textContent =
        selected.length === 0
          ? '选 1~6 张手牌出战（张数 = 你的押注上限）'
          : `押注须 ≥ ${minBet}，最多 ${cap}${cap < minBet ? ' —— 张数不够，多选几张' : ''}`;
      bar.appendChild(tip);
    }
  } else if (bfCount > 0 && selected.length > 0 && la.canAddCards) {
    const n = selected.length;
    const min = Math.max(0, v.maxBet - you.betTotal);
    const max = Math.min(chips, bfCount + n - you.betTotal);
    if (max >= min) {
      const group = document.createElement('div');
      group.className = 'slider-group';
      const delta = Math.max(min, Math.min(ui.bet ?? min, max));
      group.innerHTML = `<span class="hint">加注</span><input id="delta" type="range" min="${min}" max="${max}" value="${delta}" /><span class="val">${delta}</span>`;
      bar.appendChild(group);
      const slider = group.querySelector<HTMLInputElement>('#delta')!;
      slider.addEventListener('input', () => {
        group.querySelector('.val')!.textContent = slider.value;
        patchUI({ bet: Number(slider.value) });
      });
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = `加牌 ${n} 张`;
      btn.addEventListener('click', () => {
        void gameAction({ t: 'add_cards', cardIds: [...selected], betDelta: Number(slider.value) }).then((ok) => {
          if (ok) patchUI({ selected: [], bet: null });
        });
      });
      bar.appendChild(btn);
    } else {
      const tip = document.createElement('span');
      tip.className = 'hint';
      tip.textContent = `加 ${n} 张也押不满 ${v.maxBet}，试试多选几张或加注`;
      bar.appendChild(tip);
    }
  } else if (bfCount > 0) {
    const tip = document.createElement('span');
    tip.className = 'hint';
    tip.textContent = '点选手牌可加牌；或直接操作：';
    bar.appendChild(tip);
  }

  if (la.canAddChips) {
    const { min, max } = la.canAddChips;
    const group = document.createElement('div');
    group.className = 'slider-group';
    const delta = Math.max(min, Math.min(ui.bet ?? min, max));
    group.innerHTML = `<input id="chips" type="range" min="${min}" max="${max}" value="${delta}" /><span class="val">${delta}</span>`;
    bar.appendChild(group);
    const slider = group.querySelector<HTMLInputElement>('#chips')!;
    slider.addEventListener('input', () => {
      group.querySelector('.val')!.textContent = slider.value;
      patchUI({ bet: Number(slider.value) });
    });
    const btn = document.createElement('button');
    btn.textContent = `加注 ${delta}`;
    btn.addEventListener('click', () => {
      void gameAction({ t: 'add_chips', betDelta: Number(slider.value) }).then((ok) => {
        if (ok) patchUI({ bet: null });
      });
    });
    bar.appendChild(btn);
  }

  if (la.canAgree) {
    const btn = document.createElement('button');
    btn.textContent = you.agreeEnd ? '取消同意' : '同意结束';
    btn.className = you.agreeEnd ? '' : 'ghost';
    btn.addEventListener('click', () => void gameAction({ t: 'agree_end', agree: !you.agreeEnd }));
    bar.appendChild(btn);
  }

  if (la.canFold) {
    const btn = document.createElement('button');
    btn.className = 'danger';
    btn.textContent = '弃牌';
    btn.addEventListener('click', () => {
      if (confirm('确定弃牌？已押筹码将进入奖池且无法收回。')) {
        void gameAction({ t: 'fold' }).then((ok) => {
          if (ok) patchUI({ selected: [], bet: null });
        });
      }
    });
    bar.appendChild(btn);
  }

  if (bar.children.length === 0) {
    bar.innerHTML = `<span class="hint">等待中…</span>`;
  }
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
  appendLog(v);
}

function appendLog(v: PlayerView) {
  if (!v.result || v.result.entries.length === 0) return;
  const r = v.result;
  const line = r.voidRound
    ? `第 ${v.roundNo} 回合作废：无人竞夺奖池`
    : `第 ${v.roundNo} 回合：${nameOf(v, r.winnerSeat!)} 以【${r.entries[0].handAlias}·${r.entries[0].handName}】收下 ${r.potAmount} 筹码`;
  if (logLines[logLines.length - 1] === line) return;
  logLines.push(line);
  if (logLines.length > 40) logLines.shift();
  const log = els!.log;
  log.innerHTML = logLines.map((l) => `<div class="log-line gold">${l}</div>`).join('');
  log.scrollTop = log.scrollHeight;
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
