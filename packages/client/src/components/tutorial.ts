import type { PlayerView } from '../../../shared/src/index';
import { bestHandCards, cardLabel } from '../../../shared/src/index';
import { handLabel } from './drawer';
import { avatarSVG, AVATAR_NAME, type Mood } from './pixelAvatar';
import { sfx } from './sfx';

/**
 * 新手教学 v3：对话式分步指导。
 * 教官立绘（像素小人，随步骤换表情）+ 打字机逐字浮出 + 段落感，
 * 点卡片可跳过打字直接显示全文。步骤由游戏状态推导、自动推进。
 */

const SS_KEY = 'castle.tutorial';

export function tutorialActive(): boolean {
  return sessionStorage.getItem(SS_KEY) === '1';
}

export function startTutorial() {
  sessionStorage.setItem(SS_KEY, '1');
  accepted = false;
}

export function exitTutorial() {
  sessionStorage.removeItem(SS_KEY);
  accepted = false;
  typeToken++; // 中断进行中的打字
  document.getElementById('tutorial-card')?.remove();
  document.querySelectorAll('.tut-hl').forEach((el) => el.classList.remove('tut-hl'));
}

let accepted = false;
let renderedStep: StepId | null = null; // 打字动画只在步骤切换时重播
let typeToken = 0;

type StepId = 'welcome' | 'defense' | 'watch' | 'move' | 'showdown' | 'done';

function computeStep(v: PlayerView): StepId {
  if (!accepted) return 'welcome';
  if (v.phase === 'gameover') return 'done';
  if (v.roundPhase === 'settlement') return 'showdown';
  if (v.roundPhase === 'defense_window') return 'defense';
  if (v.roundPhase === 'opening' || v.roundPhase === 'rotation') {
    return v.you.legalActions.isYourTurn ? 'move' : 'watch';
  }
  return 'watch';
}

interface StepContent {
  step: string;
  title: string;
  mood: Mood;
  lines: string[];
  highlight: string | null;
  buttons?: { label: string; action: 'accept' | 'exit' | 'free' }[];
}

function chip(n: number): string {
  return `<b class="tut-num">${n}</b>`;
}

function buildContent(v: PlayerView, step: StepId): StepContent {
  const you = v.you;
  const declarer = v.players.find((p) => p.seat === v.declarerSeat);

  switch (step) {
    case 'welcome':
      return {
        step: '序幕',
        title: '目标：赢光对手的筹码',
        mood: 'happy',
        lines: [
          '你好呀，我是你的教官。这是一局 1 对 1 教学局，跟着我走完一个回合，你就会打《城堡》了。',
          '核心规则只有一句话——<em>你打出的牌，既是「牌型材料」，又是「押注上限」</em>。出战区有几张牌，就最多能押几个筹码。',
          '牌出得多、押得狠，但多余的杂牌会在摊牌时拖累你……这中间的取舍，就是这游戏好玩的地方。',
          '准备好了就点【开始教学】。',
        ],
        highlight: null,
        buttons: [{ label: '开始教学 →', action: 'accept' }],
      };
    case 'defense':
      if (you.status === 'defended') {
        return {
          step: '第 1 步 · 防守宣言',
          title: '哦？你选择了防守',
          mood: 'surprised',
          lines: [
            '可以嘛，敢用高级玩法。防守者本回合不能再做任何操作——包括我说话你也只能听着。',
            '它的用途是<em>买票观战</em>：看别人怎么打、亮一张大牌立威。摊牌时你的牌型若是全场最大，只能拿回托管；否则托管进奖池。',
            '奖池永远由进攻方争夺。看好了，我要出手了。',
          ],
          highlight: null,
        };
      }
      if (you.defensePassed) {
        return {
          step: '第 1 步 · 防守宣言',
          title: '不防守，稳！',
          mood: 'happy',
          lines: ['新手第一回合就该这么选。等所有人表完态，就进入宣战了。'],
          highlight: null,
        };
      }
      return {
        step: '第 1 步 · 防守宣言',
        title: '每回合开场：要不要当「防守者」？',
        mood: 'neutral',
        lines: [
          `本回合的庄家是 <em>${declarer?.name ?? '?'}</em>。在任何人出牌之前，每人都可以宣布防守：出牌规则相同，但<em>牌数 ≤ 托管筹码</em>，宣布后本回合被锁死。`,
          '防守者就算牌型全场最大，也只能拿回托管筹码，赢不了奖池。',
          '<em>现在：点下方操作栏里的【不防守】。</em>',
        ],
        highlight: '#action-bar',
      };
    case 'watch': {
      const turn = v.players.find((p) => p.seat === v.turnSeat);
      const segsText =
        turn?.playSegments.map((s0) => (s0.top ? `亮着 ${cardLabel(s0.top)} 的 ${s0.count} 张` : `暗扣着 ${s0.count} 张`)).join('，') ?? '还没出牌';
      return {
        step: '第 2~3 步 · 观察对手',
        title: `${turn?.name ?? '对手'} 正在行动`,
        mood: 'surprised',
        lines: [
          `看他的卡片：出战 <em>${turn?.battlefieldCount ?? 0} 张</em>——${segsText}。已押 ${chip(turn?.betTotal ?? 0)}。`,
          '你能看到的只有两样：<em>张数</em>和<em>亮出的最大牌</em>（单张出牌连最大牌都不亮）。张数越多，他的押注上限越高，但杂牌也越多。',
          '猜猜他凑的是什么牌型？轮到你的时候，卡片会教你怎么办。',
        ],
        highlight: null,
      };
    }
    case 'move': {
      if (you.battlefield.length === 0) {
        const sel = you.hand.filter((c) => selectedIdsCache.includes(c.id));
        const got = sel.length > 0 ? bestHandCards(sel) : null;
        const selText = got
          ? `已选 ${sel.length} 张 → <em>${handLabel(got.hand.typeRank)}</em> · 杂 ${got.hand.junk}`
          : '还没选牌';
        return {
          step: '第 2 步 · 宣战',
          title: '轮到你出牌了！',
          mood: 'serious',
          lines: [
            `<em>① 点下方手牌，选 1~3 张</em>。推荐先凑一对。选中的牌会组成一个牌型，<em>暗牌</em>打进你的出战区。`,
            `② 全场只会看到<em>张数</em>；两张起才亮最大的一张，单张出战连最大牌都不亮——所以单张最适合唬人。`,
            `③ 拖押注滑块（上限 = 张数），点【出战】。当前：${selText}。`,
          ],
          highlight: '#hand',
        };
      }
      if (you.betTotal < v.maxBet) {
        return {
          step: '第 3 步 · 跟牌',
          title: '糟糕，你的押注不够！',
          mood: 'serious',
          lines: [
            `场上最大押注是 ${chip(v.maxBet)}，你只押了 ${chip(you.betTotal)}。规则不允许免费过牌。`,
            `两条路：<em>加注</em>补齐（上限 = 出战区牌数，现在 ${you.battlefield.length}）；不够就<em>加牌</em>再补；都不想玩就<em>弃牌</em>认输。`,
          ],
          highlight: '#action-bar',
        };
      }
      return {
        step: '第 3 步 · 跟牌',
        title: '轮到你行动',
        mood: 'neutral',
        lines: [
          `你已出战 <em>${you.battlefield.length} 张</em>、押 ${chip(you.betTotal)}（上限 ${you.battlefield.length}）。选项：`,
          `<em>加牌</em> = 手牌补进出战区、抬高押注上限；<em>加注</em> = 上限内加筹码施压；<em>弃牌</em> = 认输；<em>同意结束</em> = 全员同意才摊牌。`,
          '教学局就点 <em>【同意结束】</em> 吧，直接看摊牌！',
        ],
        highlight: '#action-bar',
      };
    }
    case 'showdown': {
      const r = v.result;
      if (!r) return { step: '第 4 步 · 摊牌', title: '摊牌中…', mood: 'surprised', lines: ['所有未弃牌者亮出全部出战区牌。'], highlight: null };
      if (r.voidRound) {
        return { step: '第 4 步 · 摊牌结算', title: '回合作废', mood: 'neutral', lines: ['无人有资格竞夺奖池，所有注金退还。少见的情况，记住就好。'], highlight: null };
      }
      const best = r.entries[0];
      const mine = r.entries.find((e) => e.seat === you.seat);
      const iWin = r.winnerSeat === you.seat;
      return {
        step: '第 4 步 · 摊牌结算',
        title: iWin ? '这局你赢了！' : '看看结果',
        mood: iWin ? 'happy' : 'neutral',
        lines: [
          `比牌规则：<em>①牌型排名 → ②杂牌少者胜 → ③最大牌 → ④花色</em>。`,
          best ? `本局最大：<em>${best.handAlias}·${best.handName}</em>（${v.players.find((p) => p.seat === best.seat)?.name}），独吞奖池 ${chip(r.potAmount)}。` : '',
          mine ? `你的牌型是 ${handLabel(mine.typeRank)} · 用 ${mine.usedIds.length} 张 · 杂 ${mine.junk}。${iWin ? '漂亮！' : '下次记住：杂牌越少越硬。'}` : '',
          '接下来全部牌回牌堆重洗、每人补 6 张——你已经完整走过一遍流程了！',
        ],
        highlight: null,
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
        buttons: [
          { label: '继续自由对局', action: 'free' },
          { label: '退出教学', action: 'exit' },
        ],
      };
  }
}

let selectedIdsCache: string[] = [];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 标点节奏：一句话的"语气"靠不同长度的停顿体现 */
function charDelay(ch: string): number {
  if ('，、'.includes(ch)) return 130;
  if ('。！？…'.includes(ch)) return 340;
  if ('：；'.includes(ch)) return 170;
  return 26;
}

let advancer: (() => void) | null = null;

function waitAdvance(token: number): Promise<void> {
  return new Promise((resolve) => {
    advancer = () => {
      if (token !== typeToken) return resolve();
      advancer = null;
      resolve();
    };
  });
}

/** HTML 感知的逐字打字机：逐段打出，每段结束等待玩家点击确认 */
async function typeLines(container: HTMLElement, lines: string[], token: number): Promise<void> {
  container.innerHTML = '';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let skipPara = false;
  advancer = () => (skipPara = true);

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
          if (!skipPara) {
            sfx.type();
            await sleep(charDelay(ch));
          }
        }
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const p = document.createElement('p');
    container.appendChild(p);
    await typeParagraph(p, lines[i]);
    if (token !== typeToken) return;
    const last = i === lines.length - 1;
    if (!last && !reduced) {
      // 段落确认提示 ▼
      const marker = document.createElement('div');
      marker.className = 'tut-next';
      marker.textContent = '▼ 点击继续';
      container.appendChild(marker);
      await waitAdvance(token);
      marker.remove();
      if (token !== typeToken) return;
    } else if (!last && reduced) {
      continue;
    }
  }
  container.classList.remove('typing');
}

/** 每次状态渲染时调用：维护教学大卡片（打字只在步骤切换时重播） */
export function renderTutorial(v: PlayerView, selectedIds: string[]) {
  selectedIdsCache = selectedIds;
  const step = computeStep(v);

  let el = document.getElementById('tutorial-card');
  if (!el || !el.querySelector('.tut-dialog')) {
    el?.remove();
    el = mountTutorialCard();
    // 嵌入桌面布局流（对手区与奖池之间），不悬浮、不遮挡操作区
    (document.getElementById('tutorial-slot') ?? document.body).appendChild(el);
  }

  // 立绘表情跟随步骤（不重触发打字）
  const c = buildContent(v, step);
  const portrait = el.querySelector('.tut-portrait-svg') as HTMLElement | null;
  const mood = c.mood;
  if (portrait && portrait.dataset.mood !== mood) {
    portrait.dataset.mood = mood;
    portrait.innerHTML = avatarSVG('shirley', mood, 5);
  }

  if (renderedStep !== step) {
    renderedStep = step;
    const token = ++typeToken;
    el.dataset.step = step;

    el.querySelector('.tut-step')!.textContent = c.step;
    el.querySelector('.tut-title')!.textContent = c.title;
    const textEl = el.querySelector('.tut-text') as HTMLElement;
    const actionsEl = el.querySelector('.tut-actions') as HTMLElement;
    actionsEl.innerHTML = '';

    const showButtons = () => {
      if (!c.buttons) {
        actionsEl.innerHTML = '<div class="tut-skip">※ 完成对应操作后自动进入下一步</div>';
        return;
      }
      actionsEl.innerHTML = c.buttons
        .map((b) => `<button data-tut="${b.action}" class="${b.action === 'exit' ? 'ghost' : 'primary'}">${b.label}</button>`)
        .join('');
      actionsEl.querySelectorAll('button[data-tut]').forEach((b) => {
        b.addEventListener('click', () => {
          const action = (b as HTMLElement).dataset.tut;
          if (action === 'accept') {
            accepted = true;
            renderedStep = null; // 强制重播下一步
            renderTutorial(v, selectedIds);
          } else if (action === 'free') {
            exitTutorial();
          } else {
            exitTutorial();
            location.href = '/';
          }
        });
      });
    };

    el.onclick = () => {
      sfx.click();
      advancer?.();
    };
    void typeLines(textEl, c.lines, token).then(() => {
      if (token === typeToken) showButtons();
    });
  }

  // 高亮指引区域
  document.querySelectorAll('.tut-hl').forEach((e) => e.classList.remove('tut-hl'));
  if (c.highlight) {
    const target = document.querySelector(c.highlight);
    if (target) target.classList.add('tut-hl');
  }
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
      <div class="tut-text"></div>
      <div class="tut-actions"></div>
    </div>
  `;
  return el;
}
