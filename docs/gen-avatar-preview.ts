/** 生成 docs/avatar-preview.html：全部角色 × 全部表情的立绘预览（给设计者过目用） */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ALL_CHARS, avatarSVG, type Mood } from '../packages/client/src/components/pixelAvatar';

const MOODS: Mood[] = ['neutral', 'happy', 'serious', 'surprised'];
const MOOD_NAMES: Record<Mood, string> = { neutral: '平静', happy: '开心', serious: '认真', surprised: '惊讶' };

const cells = ALL_CHARS.map((c) => {
  const row = MOODS.map(
    (m) => `<td><div class="av">${avatarSVG(c.id, m, 6)}</div><div class="lb">${MOOD_NAMES[m]}</div></td>`,
  ).join('');
  const mini = MOODS.map((m) => avatarSVG(c.id, m, 2)).join('');
  return `<tr><th>${c.name}<div class="mini">${mini}</div></th>${row}</tr>`;
}).join('\n');

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>城堡 · 小人形象预览</title>
<style>
  body { background:#14121c; color:#f4e9d0; font-family:"PingFang SC",monospace; padding:24px; }
  h1 { color:#e8b04b; } p { color:#8f8a9e; }
  table { border-collapse:collapse; margin-top:16px; }
  th, td { border:1px solid #ffffff22; padding:12px; text-align:center; }
  th { color:#e8b04b; font-size:14px; }
  .av { background:#00000055; display:inline-block; padding:8px; }
  .lb { font-size:12px; margin-top:6px; color:#8f8a9e; }
  .mini { display:flex; gap:4px; margin-top:8px; justify-content:center; }
</style></head><body>
<h1>城堡 · 像素小人预览（元气骑士风大头娃娃）</h1>
<p>每人展示 4 种表情；右下小图为对手卡片/房间里的实际显示尺寸。选定后告诉我改哪里（发型/配色/五官都在代码里，好调）。</p>
<table><tr><th>角色</th>${MOODS.map((m) => `<th>${MOOD_NAMES[m]}</th>`).join('')}</tr>${cells}</table>
</body></html>`;

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'avatar-preview.html');
writeFileSync(out, html);
console.log(`written: ${out}`);
