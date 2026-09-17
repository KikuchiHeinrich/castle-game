/**
 * 8bit 小人 v3 —— 元气骑士风：24×30 高分辨率、头身比 2:1、自动描边、
 * 三阶发色 + 高光、四格大眼带白色眼神光。程序化绘制保证对称。
 * 6 名角色（教官雪莉 + 5 名可选），4 种表情。
 */

export type Mood = 'happy' | 'neutral' | 'serious' | 'surprised';

export interface AvatarChar {
  id: string;
  name: string;
  hair: string;
  hairHi: string; // 发丝高光
  hairShade: string;
  eyeL: string; // 画面左眼
  eyeR: string; // 画面右眼
  coat: string;
  coatShade: string;
  trim: string; // 金扣/滚边
  style: 'twin' | 'short' | 'long';
}

export const SHIRLEY: AvatarChar = {
  id: 'shirley',
  name: '雪莉',
  hair: '#f4f2f8',
  hairHi: '#ffffff',
  hairShade: '#d9d5e6',
  eyeL: '#4aa3e8',
  eyeR: '#e0485a',
  coat: '#33415e',
  coatShade: '#26324a',
  trim: '#e8b04b',
  style: 'twin',
};

export const PLAYER_CHARS: AvatarChar[] = [
  { id: 'yan', name: '小焰', hair: '#e05a4a', hairHi: '#ff8a72', hairShade: '#b03a30', eyeL: '#f2a53c', eyeR: '#f2a53c', coat: '#6e2f2f', coatShade: '#4e1f1f', trim: '#f0c060', style: 'short' },
  { id: 'cang', name: '小苍', hair: '#4a7de0', hairHi: '#8ab4ff', hairShade: '#3559a8', eyeL: '#7ae0e0', eyeR: '#7ae0e0', coat: '#2f4e6e', coatShade: '#1f3750', trim: '#9ad0f0', style: 'long' },
  { id: 'mo', name: '小墨', hair: '#3a3a44', hairHi: '#6a6a7a', hairShade: '#26262e', eyeL: '#b07ae0', eyeR: '#b07ae0', coat: '#2b2b33', coatShade: '#1c1c22', trim: '#e8b04b', style: 'long' },
  { id: 'sen', name: '小森', hair: '#4aa05a', hairHi: '#8ae098', hairShade: '#337040', eyeL: '#e0e07a', eyeR: '#e0e07a', coat: '#3a5e3a', coatShade: '#284428', trim: '#b0e08a', style: 'short' },
  { id: 'jin', name: '小金', hair: '#f0d04a', hairHi: '#fff0a0', hairShade: '#c8a830', eyeL: '#e0485a', eyeR: '#e0485a', coat: '#5e3a6e', coatShade: '#432a50', trim: '#f0e0a0', style: 'twin' },
];

export const ALL_CHARS: AvatarChar[] = [SHIRLEY, ...PLAYER_CHARS];

export function charById(id: string): AvatarChar {
  return ALL_CHARS.find((c) => c.id === id) ?? SHIRLEY;
}

const W = 24;
const H = 30;
const OUTLINE = '#20202a';

type Cell = string | undefined;

function buildGrid(c: AvatarChar, mood: Mood): Cell[][] {
  const g: Cell[][] = Array.from({ length: H }, () => Array(W).fill(undefined));
  const rect = (r0: number, r1: number, c0: number, c1: number, ch: Cell) => {
    for (let r = Math.max(0, r0); r < Math.min(H, r1); r++) {
      for (let cc = Math.max(0, c0); cc < Math.min(W, c1); cc++) g[r][cc] = ch;
    }
  };
  /** 镜像绘制：给出左半边 [c0,c1)，右半边自动对称 */
  const sym = (r0: number, r1: number, c0: number, c1: number, ch: Cell) => {
    rect(r0, r1, c0, c1, ch);
    rect(r0, r1, W - c1, W - c0, ch);
  };

  // ---- 头发（大头） ----
  rect(1, 2, 8, 16, 'H');
  rect(2, 3, 6, 18, 'H');
  rect(3, 5, 5, 19, 'H');
  rect(5, 9, 4, 20, 'H');
  // 刘海盖在脸上 + 齐刘海尖
  rect(7, 9, 5, 19, 'H');
  rect(9, 10, 6, 9, 'H');
  rect(9, 10, 11, 13, 'H');
  rect(9, 10, 15, 18, 'H');
  // 发丝高光
  rect(2, 5, 8, 12, 'i');
  rect(3, 4, 13, 16, 'i');

  // ---- 脸 ----
  rect(9, 17, 6, 18, 'S');

  // ---- 眼睛（4 宽：上睫毛 + 2 高眼 + 眼神光） ----
  rect(10, 11, 8, 11, 'K');
  rect(11, 13, 8, 11, 'E');
  rect(10, 11, 13, 16, 'K');
  rect(11, 13, 13, 16, 'F');
  rect(11, 12, 8, 9, 'e');
  rect(11, 12, 13, 14, 'e');

  // ---- 腮红 / 嘴（1 像素小嘴） ----
  rect(14, 15, 6, 8, 'P');
  rect(14, 15, 16, 18, 'P');
  rect(15, 16, 11, 12, 'm');

  // ---- 双马尾 / 侧发 ----
  if (c.style !== 'short') {
    const rows: [number, number][] = c.style === 'twin' ? [[6, 24]] : [[6, 26]];
    for (const [r0, r1] of rows) {
      sym(r0, r1, 2, 4, 'H');
      sym(r0, r1, 3, 4, 'h');
    }
    sym(23, 26, 3, 5, 'H'); // 发尾展开
  } else {
    sym(6, 12, 3, 5, 'H'); // 短发贴脸
    sym(12, 14, 4, 6, 'h');
  }

  // ---- 身体（小大衣） ----
  rect(18, 19, 7, 17, 'U'); // 金滚边领口
  rect(19, 26, 6, 18, 'N');
  rect(25, 26, 8, 16, 'n');
  rect(19, 26, 11, 13, 'n'); // 中缝
  rect(20, 21, 9, 10, 'A');
  rect(22, 23, 9, 10, 'A');
  // 手臂
  rect(19, 24, 5, 6, 'N');
  sym(19, 24, 5, 6, 'N');
  // 腿 + 靴
  rect(26, 28, 9, 11, 'S');
  rect(26, 28, 13, 15, 'S');
  rect(28, 30, 8, 11, 'K');
  rect(28, 30, 13, 16, 'K');

  // ---- 表情覆写 ----
  if (mood === 'happy') {
    // 眯眯笑：眼睛收成第 10 行一条 + 小笑口
    rect(10, 13, 8, 11, 'S');
    rect(10, 13, 13, 16, 'S');
    rect(10, 11, 8, 11, 'E');
    rect(10, 11, 13, 16, 'F');
    rect(15, 16, 11, 13, 'K');
  } else if (mood === 'serious') {
    // 皱眉 + 抿嘴
    rect(9, 10, 8, 11, 'h');
    rect(9, 10, 13, 16, 'h');
    rect(15, 16, 11, 12, 'K');
  } else if (mood === 'surprised') {
    // 眼睛再大一圈 + 小 O 嘴
    rect(9, 13, 8, 11, 'E');
    rect(9, 13, 13, 16, 'F');
    rect(9, 10, 8, 9, 'e');
    rect(9, 10, 13, 14, 'e');
    rect(14, 16, 11, 12, 'K');
  }

  // ---- 自动描边：空格四邻有内容 → 描边 ----
  const out: Cell[][] = g.map((row) => [...row]);
  for (let r = 0; r < H; r++) {
    for (let cc = 0; cc < W; cc++) {
      if (g[r][cc] !== undefined) continue;
      const nb = [g[r - 1]?.[cc], g[r + 1]?.[cc], g[r]?.[cc - 1], g[r]?.[cc + 1]];
      if (nb.some((x) => x !== undefined)) out[r][cc] = 'K';
    }
  }
  return out;
}

function cellColor(ch: Cell, c: AvatarChar): string | undefined {
  switch (ch) {
    case 'K': return OUTLINE;
    case 'H': return c.hair;
    case 'h': return c.hairShade;
    case 'i': return c.hairHi;
    case 'S': return '#ffe6d2';
    case 'P': return '#f6a8a0';
    case 'E': return c.eyeL;
    case 'F': return c.eyeR;
    case 'e': return '#ffffff';
    case 'm': return '#a04a42';
    case 'N': return c.coat;
    case 'n': return c.coatShade;
    case 'U': return c.trim;
    case 'A': return c.trim;
    default: return undefined;
  }
}

export function avatarSVG(charId: string, mood: Mood = 'neutral', px = 4): string {
  const c = charById(charId);
  const grid = buildGrid(c, mood);
  let rects = '';
  grid.forEach((row, y) => {
    row.forEach((ch, x) => {
      const fill = cellColor(ch, c);
      if (fill) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    });
  });
  return `<svg class="pixel-avatar" viewBox="0 0 ${W} ${H}" width="${W * px}" height="${H * px}" shape-rendering="crispEdges" style="image-rendering:pixelated;display:block">${rects}</svg>`;
}

export const AVATAR_NAME = '教官 · 雪莉';
