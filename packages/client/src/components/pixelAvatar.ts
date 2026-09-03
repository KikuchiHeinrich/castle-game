/**
 * 8bit 教官小人：16×22 像素画，代码定义，SVG crispEdges 渲染。
 * 白毛双马尾 · 左眼蓝右眼红 · 城堡军官大衣 + 军帽。
 * 表情通过覆写面部像素实现（happy / neutral / serious / surprised）。
 */

export type Mood = 'happy' | 'neutral' | 'serious' | 'surprised';

const PAL: Record<string, string> = {
  K: '#2b2b33', // 描边/靴
  W: '#f4f2f8', // 白发
  w: '#d9d5e6', // 发影/眉
  S: '#ffe6d2', // 皮肤
  P: '#f6a8a0', // 腮红
  B: '#4aa3e8', // 蓝眼（画面左）
  R: '#e0485a', // 红眼（画面右）
  N: '#33415e', // 大衣藏青
  n: '#26324a', // 大衣阴影/帽带
  A: '#e8b04b', // 金扣/帽徽
  m: '#a04a42', // 嘴
};

// 16 列 × 22 行；'.' 为透明
const BASE: string[] = [
  '...KKKKKKKKK....',
  '..KNNNNNNNNNK...',
  '..KNnnAAnNNK....',
  '.WWWWWWWWWWWWW..',
  '.WWWWWWWWWWWWW..',
  '.WWSSSSSSSSWW...',
  '.WWSBBSSRRSSW...',
  '.WWPSSSSSSPWW...',
  '.WWWSSmmSSWW....',
  '.WWWWSSSSSWWW...',
  '.WWWNNNNNNWWW...',
  '.WWKNNNNNNKWW...',
  '.WWNNNANNANNN...',
  '.WwNNNNNNNNNw...',
  '..NNNNNNNNNN....',
  '..NNNnNNnNNN....',
  '..NNNNNNNNNN....',
  '..nNNNNNNNn.....',
  '...SS....SS.....',
  '...KK....KK.....',
  '...KKK..KKK.....',
  '..KKKK..KKKK....',
];

/** 表情：覆写 [行, 列, 字符]。眼睛基线在第 6 行（左眼列 4-5=蓝，右眼列 8-9=红） */
const MOOD_OVERRIDES: Record<Mood, [number, number, string][]> = {
  // 微笑眯眯眼（眼睛上移一行）+ 宽笑
  happy: [
    [5, 4, 'B'], [5, 5, 'B'], [5, 8, 'R'], [5, 9, 'R'],
    [6, 4, 'S'], [6, 5, 'S'], [6, 8, 'S'], [6, 9, 'S'],
    [8, 6, 'K'], [8, 7, 'K'], [8, 8, 'K'], [8, 9, 'K'],
  ],
  neutral: [
    [8, 6, 'm'], [8, 7, 'm'],
  ],
  // 皱眉 + 抿嘴
  serious: [
    [5, 4, 'w'], [5, 5, 'w'], [5, 8, 'w'], [5, 9, 'w'],
    [8, 6, 'K'], [8, 7, 'K'],
  ],
  // 大眼睛（两行高）+ O 嘴
  surprised: [
    [5, 4, 'B'], [5, 5, 'B'], [5, 8, 'R'], [5, 9, 'R'],
    [8, 7, 'K'], [8, 8, 'K'], [7, 7, 'K'], [7, 8, 'K'],
  ],
};

export const AVATAR_NAME = '教官 · 雪莉';

export function avatarSVG(mood: Mood = 'neutral', px = 4): string {
  const grid = BASE.map((row) => row.split(''));
  for (const [r, c, ch] of MOOD_OVERRIDES[mood] ?? []) {
    if (grid[r] && grid[r][c] !== undefined) grid[r][c] = ch;
  }
  let rects = '';
  grid.forEach((row, y) => {
    row.forEach((ch, x) => {
      const fill = PAL[ch];
      if (fill) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    });
  });
  return `<svg class="pixel-avatar" viewBox="0 0 16 22" width="${16 * px}" height="${22 * px}" shape-rendering="crispEdges" style="image-rendering:pixelated;display:block">${rects}</svg>`;
}
