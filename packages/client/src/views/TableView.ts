import type { PlayerView, PublicPlayer } from '../../../shared/src/index';
import { bestHandCards, cardLabel } from '../../../shared/src/index';
import { createCard } from '../components/card';
import { renderHandTypes, toggleDrawer, handLabel } from '../components/drawer';
import { gameAction, rematch } from '../net/socket';
import { getState, patchUI, toggleSelect } from '../store';
import { setFxHooks } from '../anim';

/**
 * 桌面主视图。分两路渲染：
 *  - renderHUD：即时渲染（筹码/状态/操作栏/倒计时/日志）——跟着权威快照走
 *  - renderCards：卡牌区域（手牌/出战区/亮牌）——由动画系统在空闲时调用，
 *    避免动画进行中被状态快照踩掉
 */

let els: {
  header: HTMLElement;
  felt: HTMLElement;
  potArea: HTMLElement;
  deck: HTMLElement;
  discard: HTMLElement;
  ownBattlefield: HTMLElement;
  ownHud: HTMLElement;
  hand: HTMLElement;
  actionBar: HTMLElement;
  log: HTMLElement;
  overlay: HTMLElement;
  drawer: HTMLElement;
} | null = null;

let countdownRaf = 0;
const logLines: string[] = [];
let lastRenderedRound = -1;

export function mountTable(root: HTMLElement) {
  root.innerHTML = `
    <div id="table">
      <div id="table-header">
        <span class="room-code">${getState().view?.code ?? ''}</span>
        <span id="hdr-round"></span>
        <span class="spacer"></span>
        <button id="btn-types" class="ghost">牌型表</button>
        <button id="btn-exit" class="ghost">退出</button>
      </div>
      <div id="felt-wrap">
        <div id="felt">
          <div id="pot-area">
            <div class="pot-label">奖池</div>
            <div class="pot-num" id="pot-num">0</div>
            <div class="phase-tip" id="phase-tip"></div>
            <div class="max-bet" id="max-bet"></div>
          </div>
          <div id="deck" title="牌堆" style="position:absolute;right:14px;top:12px;width:26px;height:36px;background:repeating-linear-gradient(45deg,#2b3a67 0 3px,#22305a 3px 6px);border:1px solid var(--card-edge);box-shadow:inset 0 0 0 1px var(--card-face);opacity:.7"></div>
          <div id="discard" title="弃牌堆" style="position:absolute;left:14px;bottom:12px;width:26px;height:36px;border:1px dashed #ffffff33;opacity:.5"></div>
        </div>
      </div>
      <div id="own-zone">
        <div id="own-battlefield"></div>
        <div id="own-row">
          <div id="own-hud"></div>
          <div id="hand"></div>
        </div>
      </div>
      <div id="action-bar"></div>
      <div id="log"></div>
      <div id="overlay"></div>
      <div id="drawer"></div>
    </div>
  `;
  els = {
    header: root.querySelector('#table-header')!,
    felt: root.querySelector('#felt')!,
    potArea: root.querySelector('#pot-area')!,
    deck: root.querySelector('#deck')!,
    discard: root.querySelector('#discard')!,
    ownBattlefield: root.querySelector('#own-battlefield')!,
    ownHud: root.querySelector('#own-hud')!,
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
    seatEl: (seat) => root.querySelector(`.seat[data-seat="${seat}"]`) as HTMLElement | null,
    handEl: () => els?.hand ?? null,
    ownBattlefieldEl: () => els?.ownBattlefield ?? null,
    potEl: () => els?.potArea ?? null,
    deckEl: () => els?.deck ?? null,
    discardEl: () => els?.discard ?? null,
    cardById: (id) => findPublicCard(id),
    banner,
    tweenPot: () => tweenNumber(root.querySelector('#pot-num') as HTMLElement, getState().view?.pot ?? 0),
  });
}

function findPublicCard(id: string) {
  const v = getState().view;
  if (!v) return null;
  const all = [
    ...v.players.flatMap((p) => p.revealedTops),
    ...(v.result?.entries.flatMap((e) => e.cards) ?? []),
  ];
  return all.find((c) => c.id === id) ?? null;
}

/** 奖池数字滚动补间 */
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

// ============ 总渲染入口 ============

export function render() {
  const v = getState().view;
  if (!v || !els) return;
  if (v.roundNo !== lastRenderedRound) {
    lastRenderedRound = v.roundNo ?? -1;
  }
  renderHeader(v);
  renderSeats(v);
  renderPot(v);
  renderOwnHud(v);
  renderActionBar(v);
  renderOverlay(v);
  renderCards(false);
  renderCountdown(v);
}

/** HUD + 卡牌全量（animateTops=true 时新亮出的牌播放翻面动画） */
export function renderCards(animateTops: boolean) {
  const v = getState().view;
  if (!v || !els) return;
  animateTopsFlag = animateTops;
  renderSeats(v);
  renderOwnBattlefield(v);
  renderHand(v);
}

// ============ 各区域 ============

function renderHeader(v: PlayerView) {
  const hdr = els!.header.querySelector('#hdr-round')!;
  hdr.textContent =
    v.roundPhase === null ? '' : `第 ${v.roundNo} 回合 · ${phaseLabel(v)}`;
}

function phaseLabel(v: PlayerView): string {
  switch (v.roundPhase) {
    case 'defense_window': return '防守声明';
    case 'opening': return '宣战';
    case 'rotation': return '轮转跟牌';
    case 'settlement': return '结算';
    default: return '';
  }
}

/** 对手座位布局：逆时针从自己左手边开始绕上半圈分布 */
function seatPositions(n: number): { x: number; y: number }[] {
  // 返回 index 1..n-1（相对自己的逆时针序）的位置
  const out: { x: number; y: number }[] = [];
  const count = n - 1;
  for (let j = 1; j <= count; j++) {
    const theta = ((count === 1 ? 90 : 170 - ((j - 1) * 160) / (count - 1)) * Math.PI) / 180;
    out.push({
      x: 50 + 41 * Math.cos(theta),
      y: 46 - 36 * Math.sin(theta),
    });
  }
  return out;
}

function renderSeats(v: PlayerView) {
  const wrap = els!.felt;
  const you = v.you.seat;
  const n = v.players.length;
  const positions = seatPositions(n);
  const orderOf = (seat: number) => ((((seat - you - 1) % n) + n) % n) + 1;
  const faceUpAll = v.result && !v.result.voidRound;

  for (const p of v.players) {
    if (p.seat === you) continue;
    let el = wrap.querySelector(`.seat[data-seat="${p.seat}"]`) as HTMLElement | null;
    if (!el) {
      el = document.createElement('div');
      el.className = 'seat';
      el.dataset.seat = String(p.seat);
      el.innerHTML = `<div class="seat-info"></div><div class="seat-cards"><div class="tops" data-tops></div><span class="bf-count" style="font-size:10px;color:var(--dim)"></span></div><div class="seat-action"></div>`;
      wrap.appendChild(el);
    }
    const pos = positions[orderOf(p.seat) - 1];
    if (pos) {
      el.style.left = `${pos.x}%`;
      el.style.top = `${pos.y}%`;
    }
    el.className = seatClass(p, v);

    // HUD 文本区：key 变了才重绘（避免亮牌被打断翻面）
    const infoKey = `${p.name}|${p.isHost}|${p.chips}|${p.escrow}|${p.betTotal}|${p.status}|${p.agreeEnd}|${p.away}`;
    const info = el.querySelector('.seat-info') as HTMLElement;
    if (info.dataset.key !== infoKey) {
      info.dataset.key = infoKey;
      info.innerHTML = `
        <div class="seat-name">${p.name}${p.isHost ? ' <span class="host-mark">👑</span>' : ''}
          ${p.status === 'defended' ? '<span class="badge defense">防守</span>' : ''}
          ${p.agreeEnd ? '<span class="badge agree">同意</span>' : ''}
          ${p.away ? '<span class="badge away">托管</span>' : ''}
        </div>
        <div class="seat-chips">💰 ${p.chips}${p.escrow > 0 ? ` · 托管 ${p.escrow}` : ''}</div>
        ${p.betTotal > 0 ? `<div class="seat-bet">已押 ${p.betTotal}</div>` : ''}
      `;
    }
    const actionEl = el.querySelector('.seat-action')!;
    if (actionEl.textContent !== (p.lastAction ?? '')) actionEl.textContent = p.lastAction ?? '';

    // 卡片区：摊牌全亮 / 只亮历次最大牌
    const entry = faceUpAll ? v.result!.entries.find((e) => e.seat === p.seat) : null;
    const topsKey = entry ? 'all:' + entry.cards.map((c) => c.id).join(',') : 'tops:' + p.revealedTops.map((c) => c.id).join(',');
    const tops = el.querySelector('[data-tops]') as HTMLElement;
    const bfCount = el.querySelector('.bf-count')!;
    bfCount.textContent = entry ? '' : p.battlefieldCount > 0 ? `背×${p.battlefieldCount}` : '';
    if (tops.dataset.key !== topsKey) {
      tops.dataset.key = topsKey;
      tops.innerHTML = '';
      if (entry) {
        for (const c of entry.cards) {
          const node = createCard(c, { mini: true, up: true });
          if (entry.usedIds.includes(c.id)) node.classList.add('gold');
          tops.appendChild(node);
        }
      } else {
        for (const t of p.revealedTops) {
          const node = createCard(t, { mini: true, up: !animateTopsFlag });
          tops.appendChild(node);
          if (animateTopsFlag) {
            requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('up')));
          }
        }
      }
    }
  }

  // 移除已消失的座位（不应发生，防御性）
  for (const el of [...wrap.querySelectorAll('.seat')]) {
    const seatEl = el as HTMLElement;
    const seat = Number(seatEl.dataset.seat);
    if (!v.players.find((p) => p.seat === seat)) seatEl.remove();
  }
}

let animateTopsFlag = false;

function seatClass(p: PublicPlayer, v: PlayerView): string {
  const cls = ['seat'];
  if (v.turnSeat === p.seat && (v.roundPhase === 'opening' || v.roundPhase === 'rotation')) cls.push('turn');
  if (p.status === 'folded') cls.push('folded');
  if (p.status === 'out') cls.push('out');
  if (p.status === 'defended') cls.push('defended');
  return cls.join(' ');
}

function renderPot(v: PlayerView) {
  const num = els!.header.parentElement?.querySelector('#pot-num') ?? document.querySelector('#pot-num')!;
  (num as HTMLElement).textContent = String(v.pot);
  (document.querySelector('#max-bet') as HTMLElement).textContent = v.maxBet > 0 ? `场上最大押注 ${v.maxBet}` : '';
  (document.querySelector('#phase-tip') as HTMLElement).textContent = phaseTip(v);
}

function phaseTip(v: PlayerView): string {
  const you = v.you;
  switch (v.roundPhase) {
    case 'defense_window':
      return you.legalActions.canDeclareDefense || you.legalActions.canPassDefense ? '要不要防守？' : '等待其他玩家表态…';
    case 'opening':
      return v.turnSeat === you.seat ? '轮到你宣战！选牌出战' : `等待 ${nameOf(v, v.turnSeat!)} 宣战`;
    case 'rotation':
      return v.turnSeat === you.seat ? '轮到你行动' : `等待 ${nameOf(v, v.turnSeat!)} 行动`;
    case 'settlement':
      return '结算中…';
    default:
      return '';
  }
}

function nameOf(v: PlayerView, seat: number): string {
  return v.players.find((p) => p.seat === seat)?.name ?? '?';
}

function renderOwnBattlefield(v: PlayerView) {
  const bf = els!.ownBattlefield;
  const you = v.you;
  const faceUpAll = v.result && !v.result.voidRound;
  const key = JSON.stringify({
    bf: you.battlefield.map((c) => c.id),
    tops: you.revealedTops.map((c) => c.id),
    all: faceUpAll ? v.result!.entries.find((e) => e.seat === you.seat)?.cards.map((c) => c.id) : null,
  });
  if (bf.dataset.key === key) return;
  bf.dataset.key = key;
  bf.innerHTML = '';

  if (faceUpAll) {
    const entry = v.result!.entries.find((e) => e.seat === you.seat);
    if (entry) {
      for (const c of entry.cards) {
        const node = createCard(c, { up: true });
        if (entry.usedIds.includes(c.id)) node.classList.add('gold');
        bf.appendChild(node);
      }
      return;
    }
  }
  // 出战区暗牌 + 历次亮出的最大牌（animateTopsFlag 时播放翻面）
  for (let i = 0; i < you.battlefield.length; i++) {
    const card = you.battlefield[i];
    const isTop = you.revealedTops.some((t) => t.id === card.id);
    const node = createCard(card, { up: isTop && !animateTopsFlag });
    bf.appendChild(node);
    if (isTop && animateTopsFlag) {
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('up')));
    }
  }
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
    hand.innerHTML = '<div class="loading">手牌已出完</div>';
  }
}

function onHandClick(e: Event) {
  const cardEl = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
  if (!cardEl?.dataset.id) return;
  toggleSelect(cardEl.dataset.id);
  renderHand(getState().view!);
  renderActionBar(getState().view!);
}

function renderOwnHud(v: PlayerView) {
  const you = v.you;
  const el = els!.ownHud;
  const isTurn = v.turnSeat === you.seat && (v.roundPhase === 'opening' || v.roundPhase === 'rotation');
  el.className = isTurn ? 'turn' : '';
  el.id = 'own-hud';
  el.innerHTML = `
    <div class="seat-name">${you.name}${viewIsHost(v) ? ' <span class="host-mark">👑</span>' : ''}
      ${you.status === 'defended' ? '<span class="badge defense">防守</span>' : ''}
      ${you.agreeEnd ? '<span class="badge agree">已同意</span>' : ''}
    </div>
    <div class="seat-chips">💰 ${you.chips}${you.escrow > 0 ? ` · 托管 ${you.escrow}` : ''}</div>
    ${you.betTotal > 0 ? `<div class="seat-bet">已押 ${you.betTotal}</div>` : ''}
    <div class="seat-action">${you.lastAction ?? ''}</div>
  `;
}

function viewIsHost(v: PlayerView): boolean {
  return v.isHost;
}

// ============ 操作栏 ============

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
      d.textContent = `已选 ${handLabel(got.hand.typeRank)} · 用 ${got.used.length} 张 · 杂 ${got.hand.junk} · 最大 ${cardLabel(top ?? selCards[0])}`;
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
    if (you.defensePassed ?? false) {
      bar.innerHTML = `<span class="hint">已表态不防守，等待开局…</span>`;
      return;
    }
    // 防守面板：选牌 + 托管筹码
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = `防守：牌数 ≤ 托管筹码（当前筹码 ${you.chips}）`;
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

  // opening / rotation
  if (v.roundPhase !== 'opening' && v.roundPhase !== 'rotation') return;

  if (!la.isYourTurn) {
    bar.innerHTML = `<span class="hint">${phaseTip(v)} · 场上最大押注 ${v.maxBet}</span>`;
    return;
  }

  addPreview();

  const chips = you.chips;
  const bfCount = you.battlefield.length;

  if (la.canPlay) {
    // 首次出牌
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
          ? '选 1~6 张手牌出战（张数=你的押注上限）'
          : `押注须 ≥ ${minBet}，最多 ${cap}${cap < minBet ? ' —— 张数不够，多选几张' : ''}`;
      bar.appendChild(tip);
    }
  } else if (bfCount > 0 && selected.length > 0 && la.canAddCards) {
    // 加牌
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
  let el = document.getElementById('countdown');
  if (!el) {
    el = document.createElement('div');
    el.id = 'countdown';
    el.style.cssText = 'position:absolute;left:50%;top:8px;transform:translateX(-50%);font-size:14px;color:var(--gold)';
    els!.felt.appendChild(el);
  }
  if (!v.deadlineAt || v.roundPhase === 'settlement') {
    el.textContent = '';
    return;
  }
  const tickFn = () => {
    const remain = Math.max(0, Math.ceil((v.deadlineAt - Date.now()) / 1000));
    el!.textContent = `⏳ ${remain}s`;
    el!.style.color = remain <= 5 ? 'var(--danger)' : 'var(--gold)';
    if (remain > 0) countdownRaf = requestAnimationFrame(tickFn);
  };
  tickFn();
}

// ============ 横幅 / 摊牌覆盖层 / 日志 ============

let bannerBusy: Promise<void> = Promise.resolve();

function banner(main: string, sub = '', ms = 1000): Promise<void> {
  bannerBusy = bannerBusy.then(async () => {
    const ov = els!.overlay;
    ov.innerHTML = `
      <div class="banner">${main}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    `;
    ov.classList.add('show');
    await new Promise((r) => setTimeout(r, reducedMotion() ? 50 : ms));
    ov.classList.remove('show');
    ov.innerHTML = '';
  });
  return bannerBusy;
}

function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    // 回到大厅视图由 main 重新挂载
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
