import type { Card, PlayerView } from '../../../shared/src/index';
import { battlefieldJunk, bestHandCards, cardLabel } from '../../../shared/src/index';
import { createCard } from './card';
import { handLabel } from './drawer';
import { avatarSVG, AVATAR_NAME, type Mood } from './pixelAvatar';
import { sfx } from './sfx';
import { isBusy } from '../anim';
import { getState } from '../store';

/**
 * 新手教学 v4：分步引导 + 操作门控 + 节奏停顿。
 *
 * 相比 v3 的三个关键改动：
 *  1) **不抢跑**：步骤只在动画队列跑完之后才切换，且切换前先静默 SETTLE_MS，
 *     让玩家看清自己上一步操作的结果，再听下一段解说。
 *  2) **不迷路**：每一步只解锁该点的控件，其余压暗并挡住点击；
 *     随时可点「跳过指引」解除门控，不会被锁死。
 *  3) **不赶人**：台词打完后再等 READ_MS 才开锁，避免边读边误点。
 */

const SS_KEY = 'castle.tutorial';

/** 动画结束后、新台词出现前的静默时长（给玩家反应时间） */
const SETTLE_MS = 1100;
/** 台词打完后、控件解锁前的阅读时长 */
const READ_MS = 700;
/** 一步至少停留多久才允许切走，防止连续事件把台词冲掉 */
const MIN_HOLD_MS = 1500;
/** 条件不满足时的轮询间隔 */
const RETRY_MS = 220;

export function tutorialActive(): boolean {
  return sessionStorage.getItem(SS_KEY) === '1';
}

export function startTutorial() {
  sessionStorage.setItem(SS_KEY, '1');
  resetState();
}

export function exitTutorial() {
  sessionStorage.removeItem(SS_KEY);
  resetState();
  document.getElementById('tutorial-card')?.remove();
  document.getElementById('table')?.classList.remove('tut');
  clearGate();
  document.querySelectorAll('.tut-hl').forEach((el) => el.classList.remove('tut-hl'));
}

function resetState() {
  accepted = false;
  gateFree = false;
  currentStep = null;
  pendingStep = null;
  typedDone = false;
  stepShownAt = 0;
  armedAt = 0;
  introPage = 0;
  stepShownOn = null;
  typeToken++;
  clearTimeout(retryTimer);
  retryTimer = undefined;
}

let accepted = false;
/** 玩家点过「跳过指引」：不再门控，但台词照旧 */
let gateFree = false;
let currentStep: StepId | null = null;
let pendingStep: StepId | null = null;
let typedDone = false;
let stepShownAt = 0;
let armedAt = 0;
let typeToken = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** 当前台词渲染在哪张卡片元素上：切场景/重连会整体重挂 #table，卡片会被换掉 */
let stepShownOn: HTMLElement | null = null;

type StepId = 'intro1' | 'intro2' | 'intro3' | 'intro4' | 'intro5' | 'defense' | 'watch' | 'move' | 'showdown' | 'done';

/** 实战前的规则讲解，玩家一页页点过去；讲完才进教学局 */
const INTRO_ORDER: StepId[] = ['intro1', 'intro2', 'intro3', 'intro4', 'intro5'];
let introPage = 0;

function computeStep(v: PlayerView): StepId {
  if (!accepted) return INTRO_ORDER[Math.min(introPage, INTRO_ORDER.length - 1)];
  if (v.phase === 'gameover') return 'done';
  if (v.roundPhase === 'settlement') return 'showdown';
  if (v.roundPhase === 'defense_window') return 'defense';
  if (v.roundPhase === 'opening' || v.roundPhase === 'rotation') {
    return v.you.legalActions.isYourTurn ? 'move' : 'watch';
  }
  return 'watch';
}

/** 讲解用的示意图：把抽象规则变成看得见的东西 */
type PropKind = 'goal' | 'flow' | 'battlefield' | 'hands';

interface StepContent {
  step: string;
  title: string;
  mood: Mood;
  lines: string[];
  highlight: string | null;
  /** 本步允许点击的控件；null = 只读步骤，控件全锁 */
  allow: string | null;
  props?: PropKind;
  buttons?: { label: string; action: 'next' | 'accept' | 'exit' | 'free' }[];
}

/** 造一张只用于示范的牌（不参与任何对局逻辑） */
function demoCard(rank: number, suit: 0 | 1 | 2 | 3): Card {
  return { id: `demo-${suit}-${rank}`, suit, rank };
}

function cardNode(rank: number, suit: 0 | 1 | 2 | 3, up = true): HTMLElement {
  return createCard(demoCard(rank, suit), { up, mini: true });
}

/** 讲解配图的 DOM：用真实卡牌/筹码组件拼，风格与牌桌一致 */
function renderProps(kind: PropKind): string {
  const wrap = (inner: string) => `<div class="prop-inner">${inner}</div>`;
  switch (kind) {
    case 'goal':
      return wrap(
        `<div class="prop-chips">${Array.from({ length: 8 }, () => '<span class="chip"></span>').join('')}</div>` +
          `<span class="prop-tag">桌子中间这堆 = 奖池</span>` +
          `<span class="prop-tag dim">每回合被一个人全部拿走</span>`,
      );
    case 'flow':
      return wrap(
        ['防守宣言', '宣战 / 跟牌', '摊牌比大小', '备战补到 6 张']
          .map((t, i) => `${i > 0 ? '<span class="prop-arrow">→</span>' : ''}<span class="prop-step">${t}</span>`)
          .join(''),
      );
    case 'battlefield':
      return wrap(
        `<span class="prop-cards" data-slot="bf"></span>` +
          `<span class="prop-tag">出战区 3 张 → 最多押 3 个筹码</span>`,
      );
    case 'hands':
      return wrap(
        `<span class="prop-cards" data-slot="pair"></span><span class="prop-tag">一对 A（大）</span>` +
          `<span class="prop-arrow">＞</span>` +
          `<span class="prop-cards" data-slot="high"></span><span class="prop-tag">高牌 K（小）</span>`,
      );
  }
}

/** 配图里的牌要用真实卡牌节点拼，所以字符串先占位再填节点 */
function fillProps(el: HTMLElement, kind: PropKind) {
  const put = (slot: string, nodes: HTMLElement[]) => {
    const host = el.querySelector(`[data-slot="${slot}"]`);
    if (!host) return;
    host.innerHTML = '';
    for (const n of nodes) host.appendChild(n);
  };
  if (kind === 'battlefield') put('bf', [cardNode(1, 3, false), cardNode(1, 1, false), cardNode(13, 0, false)]);
  if (kind === 'hands') {
    put('pair', [cardNode(1, 3), cardNode(1, 0)]);
    put('high', [cardNode(13, 3)]);
  }
}

function chip(n: number): string {
  return `<b class="tut-num">${n}</b>`;
}

function buildContent(v: PlayerView, step: StepId): StepContent {
  const you = v.you;
  const nameOf = (seat: number | null) => v.players.find((p) => p.seat === seat)?.name ?? '?';

  switch (step) {
    case 'intro1':
      return {
        step: '规则 1 / 5 · 这局在比什么',
        title: '一句话：把桌上那堆筹码赢过来',
        mood: 'happy',
        lines: [
          '你好呀，我是教官雪莉。这是一局 1 对 1 教学局——动手之前，我先把规则用大白话讲一遍，五页讲完。',
          '开局每人 <em>100 筹码</em>。每回合一开始，所有人先往桌子中间各丢 <em>1 个底注</em>。',
          '一回合结束时，桌子中间这堆筹码（叫<em>奖池</em>）会被一个人<em>全部拿走</em>。',
          '谁的筹码先变成 0，谁就出局。撑到最后的那个人赢。',
        ],
        highlight: null,
        allow: null,
        props: 'goal',
        buttons: [{ label: '下一页 →', action: 'next' }],
      };

    case 'intro2':
      return {
        step: '规则 2 / 5 · 一回合的流程',
        title: '一个回合就四步',
        mood: 'neutral',
        lines: [
          '<em>① 防守宣言</em>：开局先问一句「这回合防不防」。新手可以先跳过这一项。',
          '<em>② 宣战 / 跟牌</em>：从庄家开始，轮流从手里挑牌打进自己的「出战区」，同时押上筹码。',
          '<em>③ 摊牌</em>：所有人亮出出战区的牌比大小，最大的把奖池拿走。',
          '然后<em>④ 备战</em>：没打出去的手牌留到下一回合，只补到 6 张，再来一遍。',
        ],
        highlight: null,
        allow: null,
        props: 'flow',
        buttons: [{ label: '下一页 →', action: 'next' }],
      };

    case 'intro3':
      return {
        step: '规则 3 / 5 · 最重要的一条',
        title: '打出的牌，既是牌型材料，也是押注上限',
        mood: 'serious',
        lines: [
          '出战区<em>有几张牌，你这回合就最多能押几个筹码</em>。想出大注，就得多出牌。',
          '但出战区的牌摊牌时<em>必须全部参与比牌</em>——凑不成牌型的那些叫「杂牌」，会拖累你。',
          '所以核心取舍是：<em>出得少，牌型干净但压不住场；出得多，押得狠但容易掺水。</em>',
        ],
        highlight: null,
        allow: null,
        props: 'battlefield',
        buttons: [{ label: '下一页 →', action: 'next' }],
      };

    case 'intro4':
      return {
        step: '规则 4 / 5 · 怎么分大小',
        title: '先比牌型，牌型一样再比细节',
        mood: 'neutral',
        lines: [
          '出战区的牌能凑成什么牌型，就按什么牌型比。一共 22 种，从最小的「散兵（高牌）」到最大的「暴君」。',
          '比如 <em>一对 &gt; 高牌</em>；三张同点 &gt; 两对。右上角【牌型表】随时能查全部 22 种。',
          '牌型一样时依次比：<em>杂牌少的赢</em> → 最大牌 → 花色。',
        ],
        highlight: null,
        allow: null,
        props: 'hands',
        buttons: [{ label: '下一页 →', action: 'next' }],
      };

    case 'intro5':
      return {
        step: '规则 5 / 5 · 你每回合要做的',
        title: '其实每回合就三个决定',
        mood: 'happy',
        lines: [
          '<em>① 防不防</em>——新手先选「不防守」。',
          '<em>② 打什么牌、押多少</em>——挑牌凑个好牌型打进出战区。',
          '<em>③ 跟不跟</em>——别人押得比你多，就跟注或加牌；不划算就<em>弃牌认输</em>，保住筹码下回合再来。',
          '接下来我带你实战走一遍，规则我边打边讲。记不住没关系，随时可以点【牌型表】查。',
        ],
        highlight: null,
        allow: null,
        buttons: [{ label: '开始实战 →', action: 'accept' }],
      };

    case 'defense':
      if (you.status === 'defended') {
        return {
          step: '第 1 步 · 防守宣言',
          title: '哦？你选择了防守',
          mood: 'surprised',
          lines: [
            '可以嘛，敢用高级玩法。防守者本回合不能再做任何操作，只能看着。',
            '它的用途是<em>买票观战</em>：亮一张大牌立威。防守 N 张 = 本回合总投入 N 筹码（底注已含在内）；摊牌时你的牌型若是全场最大，只收回这笔投入；否则投入进奖池。',
            '奖池永远由进攻方争夺。看好了，我要出手了。',
          ],
          highlight: null,
          allow: null,
        };
      }
      if (you.defensePassed) {
        return {
          step: '第 1 步 · 防守宣言',
          title: '不防守，稳！',
          mood: 'happy',
          lines: ['新手第一回合就该这么选。等所有人表完态，就进入宣战了。'],
          highlight: null,
          allow: null,
        };
      }
      return {
        step: '第 1 步 · 防守宣言',
        title: '开场先问一句：要不要当「防守者」？',
        mood: 'neutral',
        lines: [
          `本回合的庄家是 <em>${nameOf(v.declarerSeat)}</em>。在任何人出牌之前，每人都可以宣布防守：<em>用 N 张手牌 = 总投入 N 筹码（含底注）</em>，宣布后本回合被锁死。`,
          '防守者就算牌型全场最大，也只能收回自己的投入，赢不了奖池。新手先别碰。',
          '<em>现在：点下方操作栏里的【不防守】。</em>',
        ],
        highlight: '#action-bar',
        allow: '#action-bar button[data-act="pass_defense"], #action-bar button[data-act="force_close_defense"]',
      };

    case 'watch': {
      const turn = v.players.find((p) => p.seat === v.turnSeat);
      const segsText =
        turn?.playSegments
          .map((s) => (s.top ? `亮着 ${cardLabel(s.top)} 的 ${s.count} 张` : `暗扣着 ${s.count} 张`))
          .join('，') ?? '还没出牌';
      return {
        step: '第 2~3 步 · 观察对手',
        title: `${turn?.name ?? '对手'} 正在行动`,
        mood: 'surprised',
        lines: [
          `看他的卡片：出战 <em>${turn?.battlefieldCount ?? 0} 张</em>——${segsText}。已押 ${chip(turn?.betTotal ?? 0)}。`,
          '你能看到的只有两样：<em>张数</em>和<em>亮出的最大牌</em>（单张出牌连最大牌都不亮）。张数越多，他的押注上限越高，但杂牌也越多。',
          '先别动手，看完他这步。轮到你时我会喊你。',
        ],
        highlight: '#opponents',
        allow: null,
      };
    }

    case 'move': {
      if (you.battlefield.length === 0) {
        const sel = you.hand.filter((c) => selectedIdsCache.includes(c.id));
        const got = sel.length > 0 ? bestHandCards(sel) : null;
        const selText = got
          ? `已选 ${sel.length} 张 → <em>${handLabel(got.hand.typeRank)}</em> · 杂 ${battlefieldJunk(sel)}`
          : '<em>还没选牌</em>';
        return {
          step: '第 2 步 · 宣战',
          title: '轮到你出牌了！',
          mood: 'serious',
          lines: [
            '<em>① 点下方手牌，选 1~3 张</em>，推荐先凑一对。选中的牌会组成一个牌型，<em>暗牌</em>打进你的出战区。',
            '两张起才亮最大的一张，单张出战连最大牌都不亮——所以单张最适合唬人。',
            `② 拖押注滑块（上限 = 张数），点【出战】。当前：${selText}`,
          ],
          highlight: '#hand',
          allow: '#hand .card, #bet-dock input, #bet-dock button[data-act="play"], #bet-dock button[data-act="fold"]',
        };
      }
      if (you.betTotal < v.maxBet) {
        return {
          step: '第 3 步 · 跟牌',
          title: '糟糕，你的押注不够！',
          mood: 'serious',
          lines: [
            `场上最大押注是 ${chip(v.maxBet)}，你只押了 ${chip(you.betTotal)}。规则不允许免费过牌。`,
            `两条路：<em>加注</em>补齐（上限 = 出战区牌数，现在 ${you.battlefield.length}）；张数不够就<em>加牌</em>再补。`,
          ],
          highlight: '#bet-dock',
          allow: '#hand .card, #bet-dock input, #bet-dock button[data-act="add_cards"], #bet-dock button[data-act="add_chips"], #bet-dock button[data-act="fold"]',
        };
      }
      return {
        step: '第 3 步 · 跟牌',
        title: '轮到你行动',
        mood: 'neutral',
        lines: [
          `你已出战 <em>${you.battlefield.length} 张</em>、押 ${chip(you.betTotal)}。`,
          '<em>加牌</em> = 手牌补进出战区、抬高押注上限；<em>加注</em> = 上限内施压；<em>弃牌</em> = 认输；<em>同意结束</em> = 全员同意才摊牌。',
          '教学局就点 <em>【同意结束】</em> 吧，直接看摊牌！',
        ],
        highlight: '#action-bar',
        allow: '#bet-dock input, #bet-dock button[data-act="add_chips"], #bet-dock button[data-act="fold"], #action-bar button[data-act="agree_end"]',
      };
    }

    case 'showdown': {
      const r = v.result;
      if (!r) {
        return {
          step: '第 4 步 · 摊牌',
          title: '摊牌中…',
          mood: 'surprised',
          lines: ['所有未弃牌者亮出全部出战区牌。'],
          highlight: null,
          allow: null,
        };
      }
      if (r.voidRound) {
        return {
          step: '第 4 步 · 摊牌结算',
          title: '回合作废',
          mood: 'neutral',
          lines: ['无人有资格竞夺奖池，所有注金退还。少见的情况，记住就好。'],
          highlight: null,
          allow: null,
        };
      }
      const best = r.entries[0];
      const mine = r.entries.find((e) => e.seat === you.seat);
      const iWin = r.winnerSeat === you.seat;
      return {
        step: '第 4 步 · 摊牌结算',
        title: iWin ? '这局你赢了！' : '看看结果',
        mood: iWin ? 'happy' : 'neutral',
        lines: [
          '比牌规则：<em>①牌型排名 → ②杂牌少者胜 → ③最大牌 → ④花色</em>。',
          best
            ? `本局最大：<em>${best.handAlias}·${best.handName}</em>（${nameOf(best.seat)}），独吞奖池 ${chip(r.potAmount)}。`
            : '',
          mine
            ? `你的牌型是 ${handLabel(mine.typeRank)} · 用 ${mine.usedIds.length} 张 · 杂 ${mine.junk}。${iWin ? '漂亮！' : '下次记住：杂牌越少越硬。'}`
            : '',
          '打出去的牌回牌堆，<em>没打出去的手牌会保留到下一回合</em>，只补足到 6 张——你已经完整走过一遍流程了！',
        ].filter(Boolean),
        highlight: null,
        allow: null,
      };
    }

    case 'done':
      return {
        step: '结业',
        title: '出师了！',
        mood: 'happy',
        lines: [
          '防守宣言 → 宣战 → 跟牌 → 摊牌 → 备战，整个流程你都走过了。剩下的是经验活：读张数、控杂牌、算筹码。',
          '想继续陪我练，就点【继续自由对局】；也可以退出，去大厅开一间真房间会会朋友。',
        ],
        highlight: null,
        allow: null,
        buttons: [
          { label: '继续自由对局', action: 'free' },
          { label: '退出教学', action: 'exit' },
        ],
      };
  }
}

let selectedIdsCache: string[] = [];

// ============ 操作门控 ============

/** 教学期间允许被门控的控件（顶栏的静音/退出/牌型表不在此列，永远是逃生口） */
// 注意：【弃牌】必须永远留在 allow 里。它是玩家在"跟不上押注"时唯一
// 能走的路——锁住它就可能把人锁死，而它本身有二次确认弹窗防误点。
const GATED = '#hand .card, #bet-dock input, #bet-dock button, #action-bar button';

function clearGate() {
  const table = document.getElementById('table');
  if (!table) return;
  table.classList.remove('tut-gate');
  for (const el of table.querySelectorAll('.tut-locked')) el.classList.remove('tut-locked');
}

/** 只解锁 allow 选中的控件，其余压暗并挡住点击 */
function applyGate(allow: string | null) {
  const table = document.getElementById('table');
  if (!table) return;
  if (gateFree || allow === null) {
    clearGate();
    return;
  }
  table.classList.add('tut-gate');
  for (const el of table.querySelectorAll<HTMLElement>(GATED)) {
    el.classList.toggle('tut-locked', !el.matches(allow));
  }
}

/** 本步是否已可操作：台词打完 + 阅读时间已过 + 动画不忙 */
function armed(): boolean {
  return typedDone && Date.now() >= armedAt && !isBusy();
}

// ============ 打字机 ============

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function pinTutorialScroll() {
  const slot = document.getElementById('tutorial-slot');
  if (slot) slot.scrollTop = slot.scrollHeight;
  const text = document.querySelector('.tut-text');
  if (text) text.scrollTop = text.scrollHeight;
}

/** 标点节奏：一句话的"语气"靠不同长度的停顿体现 */
function charDelay(ch: string): number {
  if ('，、'.includes(ch)) return 120;
  if ('。！？…'.includes(ch)) return 320;
  if ('：；'.includes(ch)) return 150;
  return 24;
}

/**
 * 点击推进的两件事必须分开记：
 *  - skipTyping：正在逐字打字时，点一下直接把本段文字一次性补完
 *  - advanceResolver：停在「▼ 点击继续」时，点一下放行到下一段
 * 早期版本共用一个 advancer 槽，两者会互相覆盖——一旦被覆盖，
 * 玩家再怎么点都推不动，教学就卡死了。所以这里拆成两个互不干扰的状态。
 */
let advanceResolver: (() => void) | null = null;
let skipTyping = false;

/** 玩家点击教学卡 */
export function tutorialClick() {
  if (advanceResolver) {
    advanceResolver();
    return;
  }
  skipTyping = true;
}

/** 切换步骤时把仍在等点击的旧段落放掉，避免留下永不 resolve 的 Promise */
function cancelPendingAdvance() {
  const r = advanceResolver;
  advanceResolver = null;
  if (r) r();
}

function waitAdvance(token: number): Promise<void> {
  return new Promise((resolve) => {
    if (token !== typeToken) {
      resolve();
      return;
    }
    advanceResolver = () => {
      advanceResolver = null;
      resolve();
    };
  });
}

/** HTML 感知的逐字打字机：逐段打出，每段结束等玩家点一下再继续 */
async function typeLines(container: HTMLElement, lines: string[], token: number): Promise<void> {
  container.innerHTML = '';
  container.classList.add('typing');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  skipTyping = false;

  const typeParagraph = async (p: HTMLElement, html: string) => {
    const stack: HTMLElement[] = [p];
    const parts = html.split(/(<\/?[a-z]+[^>]*>)/i).filter((s) => s !== '');
    for (const part of parts) {
      if (part.startsWith('<')) {
        const m = part.match(/<\/?(?:([a-z]+))/i);
        if (!m) continue;
        if (part.startsWith('</')) stack.pop();
        else {
          const el = document.createElement(m[1].toLowerCase());
          stack[stack.length - 1].appendChild(el);
          stack.push(el);
        }
      } else {
        for (const ch of part) {
          if (token !== typeToken) return;
          stack[stack.length - 1].append(ch);
          if (!skipTyping) {
            sfx.type();
            await sleep(reduced ? 0 : charDelay(ch));
          }
        }
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const p = document.createElement('p');
    container.appendChild(p);
    pinTutorialScroll();
    await typeParagraph(p, lines[i]);
    if (token !== typeToken) return;
    pinTutorialScroll();
    const last = i === lines.length - 1;
    if (!last && !reduced) {
      const marker = document.createElement('div');
      marker.className = 'tut-next';
      marker.textContent = '▼ 点击继续';
      container.appendChild(marker);
      pinTutorialScroll();
      await waitAdvance(token);
      marker.remove();
      if (token !== typeToken) return;
    }
  }
  container.classList.remove('typing');
}

// ============ 渲染 ============

/** 每次状态渲染时调用。步骤只在动画跑完后推进，推进前静默 SETTLE_MS。 */
export function renderTutorial(v: PlayerView, selectedIds: string[]) {
  selectedIdsCache = selectedIds;

  let el = document.getElementById('tutorial-card');
  if (!el || !el.querySelector('.tut-dialog')) {
    el?.remove();
    el = mountTutorialCard();
  }
  // 每次渲染都确认卡片挂在当前侧轨里：大厅↔房间↔牌桌会整体重建 #table，
  // 若只认「有没有卡片」而不认「挂在哪里」，卡片会滞留在 document.body 里，
  // 表现就是教学整块消失、且不参与布局。
  const slot = document.getElementById('tutorial-slot');
  if (slot) {
    if (el.parentElement !== slot) slot.appendChild(el);
  } else if (el.parentElement !== document.body) {
    document.body.appendChild(el);
  }
  document.getElementById('table')?.classList.add('tut');

  const freshCard = el !== stepShownOn;
  const want = computeStep(v);

  if (want !== currentStep) {
    if (freshCard) {
      // 卡片换过且步骤没变：直接补画，不用再等一拍静默
      pendingStep = want;
      advance(v, el, want);
      return;
    }
    if (pendingStep !== want) {
      // 首次观察到这一步：先静默 SETTLE_MS，让玩家看清上一步的结果
      pendingStep = want;
      showWaiting(el);
      scheduleRetry(SETTLE_MS);
      paintGate(v, el);
      return;
    }
    if (isBusy() || Date.now() - stepShownAt < MIN_HOLD_MS) {
      scheduleRetry(RETRY_MS);
      paintGate(v, el);
      return;
    }
    advance(v, el, want);
    return;
  }

  pendingStep = null;
  if (freshCard) {
    // 卡片刚被重建：把当前步骤补画回去，而不是留一张白卡
    stepShownOn = el;
    repaintStep(v, el, want);
    return;
  }
  paintGate(v, el);
}

/** 玩家点【下一页】：直接换页。静默停顿是留给游戏事件的，翻页不该等。 */
function forceStep(step: StepId) {
  const v = getState().view;
  const el = document.getElementById('tutorial-card');
  if (!v || !el) return;
  advance(v, el, step);
}

function scheduleRetry(ms: number) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    if (!tutorialActive()) return;
    const v = getState().view;
    if (v) renderTutorial(v, selectedIdsCache);
  }, ms);
}

/**
 * 卡片元素被重建（切场景、重连都会整体重挂 #table）时，把当前步骤的内容原样补回去。
 * 只判断"步骤有没有变"是不够的：重建后的卡片会一直空白，教学看起来就是整块消失。
 * 这里不重播打字机，直接把整段文字和按钮补上，玩家不会被迫再读一遍。
 */
function repaintStep(v: PlayerView, el: HTMLElement, step: StepId) {
  const c = buildContent(v, step);
  el.dataset.step = step;
  (el.querySelector('.tut-step') as HTMLElement).textContent = c.step;
  (el.querySelector('.tut-title') as HTMLElement).textContent = c.title;

  const portrait = el.querySelector('.tut-portrait-svg') as HTMLElement | null;
  if (portrait) {
    portrait.dataset.mood = c.mood;
    portrait.innerHTML = avatarSVG('shirley', c.mood, 3);
  }

  const propsEl = el.querySelector('.tut-props') as HTMLElement;
  propsEl.innerHTML = c.props ? renderProps(c.props) : '';
  propsEl.hidden = !c.props;
  if (c.props) fillProps(propsEl, c.props);

  const textEl = el.querySelector('.tut-text') as HTMLElement;
  textEl.dataset.waiting = '';
  textEl.classList.remove('typing');
  textEl.innerHTML = c.lines.map((ln) => `<p>${ln}</p>`).join('');

  typedDone = true;
  armedAt = 0;
  renderActions(el, c);
  paintHighlight(c.highlight);
  applyGate(c.allow);
}

/** 静默期显示：告诉玩家「我在看，马上说」 */
function showWaiting(el: HTMLElement) {
  const textEl = el.querySelector('.tut-text') as HTMLElement | null;
  const actionsEl = el.querySelector('.tut-actions') as HTMLElement | null;
  if (!textEl || textEl.dataset.waiting === '1') return;
  textEl.dataset.waiting = '1';
  textEl.classList.remove('typing');
  textEl.innerHTML = '<p class="tut-wait">……</p>';
  if (actionsEl) actionsEl.innerHTML = '';
  const propsEl = el.querySelector('.tut-props') as HTMLElement | null;
  if (propsEl) {
    propsEl.innerHTML = '';
    propsEl.hidden = true;
  }
}

function advance(v: PlayerView, el: HTMLElement, step: StepId) {
  stepShownOn = el;
  currentStep = step;
  pendingStep = null;
  typedDone = false;
  stepShownAt = Date.now();
  armedAt = Number.MAX_SAFE_INTEGER; // 台词打完前不开锁
  clearGate();

  const c = buildContent(v, step);
  cancelPendingAdvance();
  const token = ++typeToken;
  el.dataset.step = step;

  (el.querySelector('.tut-step') as HTMLElement).textContent = c.step;
  (el.querySelector('.tut-title') as HTMLElement).textContent = c.title;

  const portrait = el.querySelector('.tut-portrait-svg') as HTMLElement | null;
  if (portrait) {
    portrait.dataset.mood = c.mood;
    portrait.innerHTML = avatarSVG('shirley', c.mood, 3);
  }

  const propsEl = el.querySelector('.tut-props') as HTMLElement;
  propsEl.innerHTML = c.props ? renderProps(c.props) : '';
  propsEl.hidden = !c.props;
  if (c.props) fillProps(propsEl, c.props);

  const textEl = el.querySelector('.tut-text') as HTMLElement;
  const actionsEl = el.querySelector('.tut-actions') as HTMLElement;
  textEl.dataset.waiting = '';
  actionsEl.innerHTML = '';
  paintHighlight(c.highlight);

  void typeLines(textEl, c.lines, token).then(() => {
    if (token !== typeToken) return;
    typedDone = true;
    armedAt = Date.now() + READ_MS;
    // 阅读时间过后才亮出按钮、解锁控件 —— 这一步就是「给玩家反应时间」
    setTimeout(() => {
      if (token !== typeToken) return;
      renderActions(el, c);
      applyGate(c.allow);
    }, READ_MS);
  });
}

/** 台词播完后出现的按钮 / 提示 */
function renderActions(el: HTMLElement, c: StepContent) {
  const actionsEl = el.querySelector('.tut-actions') as HTMLElement | null;
  if (!actionsEl) return;
  actionsEl.innerHTML = '';

  if (c.buttons) {
    for (const b of c.buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      btn.className = b.action === 'exit' ? 'ghost' : 'primary';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (b.action === 'next') {
          introPage = Math.min(introPage + 1, INTRO_ORDER.length - 1);
          forceStep(INTRO_ORDER[introPage]);
        } else if (b.action === 'accept') {
          accepted = true;
          currentStep = null;
          pendingStep = null;
          stepShownAt = 0;
          // 必须清掉"台词已打完"的状态：否则下一步的门控会在台词出现前就解锁
          typedDone = false;
          armedAt = Number.MAX_SAFE_INTEGER;
          cancelPendingAdvance();
          skipTyping = false;
          const v = getState().view;
          if (v) renderTutorial(v, selectedIdsCache);
        } else if (b.action === 'free') {
          exitTutorial();
        } else {
          exitTutorial();
          location.href = '/';
        }
      });
      actionsEl.appendChild(btn);
    }
    return;
  }

  if (c.allow === null) {
    const hint = document.createElement('div');
    hint.className = 'tut-skip';
    hint.textContent = '※ 这段是解说，看完自动继续';
    actionsEl.appendChild(hint);
    return;
  }

  if (gateFree) {
    const hint = document.createElement('div');
    hint.className = 'tut-skip';
    hint.textContent = '※ 已解除限制，自由操作';
    actionsEl.appendChild(hint);
    return;
  }

  const hint = document.createElement('div');
  hint.className = 'tut-skip';
  hint.textContent = '※ 已解锁该点的按钮，其余先锁住';
  const free = document.createElement('button');
  free.className = 'ghost';
  free.textContent = '跳过指引';
  free.addEventListener('click', (e) => {
    e.stopPropagation();
    gateFree = true;
    clearGate();
    hint.textContent = '※ 已解除限制，自由操作';
    free.remove();
  });
  actionsEl.append(hint, free);
}

/** 每帧维护：高亮 + 门控（门控要等「台词打完 + 阅读时间到 + 动画空闲」） */
function paintGate(v: PlayerView, el: HTMLElement) {
  const step = currentStep ?? computeStep(v);
  const c = buildContent(v, step);
  paintHighlight(c.highlight);

  if (gateFree) {
    clearGate();
    return;
  }
  if (armed()) applyGate(c.allow);
  else clearGate();
}

/** 只重绘卡牌区（renderCards）会重建按钮/手牌 DOM，门控类会被冲掉，这里补回来 */
export function refreshTutorialGate() {
  if (!tutorialActive()) return;
  const v = getState().view;
  const el = document.getElementById('tutorial-card');
  if (v && el) paintGate(v, el);
}

function paintHighlight(sel: string | null) {
  document.querySelectorAll('.tut-hl').forEach((e) => e.classList.remove('tut-hl'));
  if (!sel) return;
  for (const target of document.querySelectorAll(sel)) target.classList.add('tut-hl');
}

export function mountTutorialCard() {
  const el = document.createElement('div');
  el.id = 'tutorial-card';
  el.innerHTML = `
    <div class="tut-portrait">
      <div class="tut-portrait-svg" data-mood=""></div>
      <div class="tut-name">${AVATAR_NAME}</div>
    </div>
    <div class="tut-dialog">
      <div class="tut-step"></div>
      <div class="tut-title"></div>
      <div class="tut-props" hidden></div>
      <div class="tut-text"></div>
      <div class="tut-actions"></div>
    </div>
  `;
  el.onclick = () => {
    sfx.click();
    tutorialClick();
  };
  return el;
}
