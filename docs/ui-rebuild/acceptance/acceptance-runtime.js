/**
 * 角色验收页运行时（浏览器 ESM）。
 *
 * 这里不复制任何美术数据：全部 import 自生产模块
 * （packages/client/src/art/characters.ts、packages/client/src/components/pixelAvatar.ts），
 * 图集与 atlas.json 也从 packages/client/src/assets/characters/ 真实读取，
 * 因此本页测到的就是实机代码、实机帧时长与实机锚点。
 * 构建方式：npm run 图集脚本（见 docs/ui-rebuild/requirements.md）→ 本文件被打包成 avatar-runtime.js。
 */
import {
  CHARACTERS, MOTIONS, CELL, GAP, PITCH, COLUMNS, ROWS,
  ANCHORS, RELEASE_ANCHORS, HAND_POS, motionFrameAt, releaseAnchor, drawCharacter,
} from '../../../packages/client/src/art/characters.ts';
import {
  avatarSVG, playAvatar, avatarHandRect, avatarUnit, cancelAvatarActions, reducedMotion,
  breathPhase, breathPeriod, breathDelay,
} from '../../../packages/client/src/components/pixelAvatar.ts';

const ATLAS_PNG = '../../../packages/client/src/assets/characters/atlas.png';
const ATLAS_JSON = '../../../packages/client/src/assets/characters/atlas.json';
const SCALE = 3;
const MOTION_LABEL = { idle: '呼吸', play: '出牌', defend: '防守', fold: '弃牌', win: '胜利' };
const MOTION_ORDER = ['idle', 'play', 'defend', 'fold', 'win'];

document.documentElement.style.setProperty('--atlas', `url("${ATLAS_PNG}")`);
document.documentElement.style.setProperty('--atlas-w', `${COLUMNS * PITCH}px`);
document.documentElement.style.setProperty('--atlas-h', `${ROWS * PITCH}px`);

const $ = (id) => document.getElementById(id);
const slow = { factor: 1 };
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });

/* ---------- 一、呼吸席位 ---------- */

function seatMarkup(c, row) {
  const release = RELEASE_ANCHORS.play;
  const acts = MOTION_ORDER.filter((m) => m !== 'idle')
    .map((m) => `<button data-motion="${m}">${MOTION_LABEL[m]}</button>`).join('');
  return `<div class="seat" data-char="${c.id}">
    <div class="nm">${c.name} <small>#${row}</small></div>
    <div class="stage" data-anchors="off">
      ${avatarSVG(c.id, 'neutral', SCALE)}
      <span class="anchor foot" style="left:0;width:${CELL * SCALE}px;top:${ANCHORS.foot.y * SCALE}px"></span>
      <span class="anchor rel" style="left:${release.x * SCALE}px;top:${release.y * SCALE}px" title="出牌释放点"></span>
    </div>
    <div class="acts">${acts}<button data-motion="play" data-twice="1">连续两次</button></div>
    <div class="probe" data-probe></div>
  </div>`;
}

const seats = $('seats');
seats.innerHTML = CHARACTERS.map((c, row) => seatMarkup(c, row)).join('');

/** 呼吸相位按慢放倍率成比例放长（与生产 CSS 的 --breath-period 同一变量） */
function applyBreathScale() {
  document.querySelectorAll('.seat .pixel-avatar').forEach((el) => {
    const row = CHARACTERS.findIndex((c) => c.id === el.dataset.character);
    if (row < 0) return;
    // 相位键 = 座位序号：生产里用座位号，六个人物即使同角色也各错开约半周期
    el.style.setProperty('--breath-period', `${(breathPeriod(row) / slow.factor).toFixed(3)}s`);
    el.style.setProperty('--breath-delay', `${(breathDelay(row) / slow.factor).toFixed(3)}s`);
  });
}

/** 每个席位上标出该倍率下的实际释放点（CSS 像素）与呼吸相位，用于核对锚点与错峰 */
function annotateReleasePoints() {
  document.querySelectorAll('.seat').forEach((seat) => {
    const avatar = seat.querySelector('.pixel-avatar');
    const box = avatar.getBoundingClientRect();
    const hand = avatarHandRect(avatar, 'play');
    const row = CHARACTERS.findIndex((c) => c.id === seat.dataset.char);
    seat.querySelector('[data-probe]').textContent =
      `释放点 +${(hand.left - box.left).toFixed(1)} / +${(hand.top - box.top).toFixed(1)} px` +
      ` · 相位 ${(breathPhase(row) * 100).toFixed(0)}% · 周期 ${breathPeriod(row).toFixed(2)}s`;
  });
}
annotateReleasePoints();

/**
 * 慢放只作用于"人物动作"这一条 WAAPI 时间线（.avatar-action 层）。
 *
 * 不能用 `avatar.getAnimations()`：Element.getAnimations() 默认不包含后代元素的动画，
 * 而动作层是 .pixel-avatar 的子元素，会拿不到任何动画，慢放就成了空操作。
 * 也不能顺手把 CSS 呼吸一起调慢：呼吸已经由 --breath-period / --breath-delay 按倍率放长，
 * 两边都调会变成双重放慢。
 */
function actionAnimations(avatar) {
  return document.getAnimations().filter((animation) => {
    const target = animation.effect && animation.effect.target;
    return target instanceof Element
      && target.classList.contains('avatar-action')
      && avatar.contains(target);
  });
}

async function run(avatar, motion) {
  // playAvatar() 是同步创建动画、返回 Promise 的：这里紧接着就能拿到刚建好的动作动画
  const promise = playAvatar(avatar, motion);
  if (slow.factor !== 1) {
    for (const animation of actionAnimations(avatar)) animation.playbackRate = slow.factor;
  }
  return promise;
}

seats.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-motion]');
  if (!button) return;
  const stage = button.closest('.seat').querySelector('.stage');
  const avatar = stage.querySelector('.pixel-avatar');
  const motion = button.dataset.motion;
  if (button.dataset.twice) {
    await run(avatar, motion);
    await run(avatar, motion);
  } else {
    void run(avatar, motion);
  }
});

/* ---------- 二、逐帧条 ---------- */

const frameOf = new Map();
for (const [name, spec] of Object.entries(MOTIONS)) {
  for (let i = 0; i < spec.durations.length; i += 1) frameOf.set(spec.start + i, name);
}

$('col-count').textContent = String(COLUMNS);
$('legend').innerHTML = MOTION_ORDER
  .map((m) => `<span class="m-${m}">${MOTION_LABEL[m]} ${MOTIONS[m].start}–${MOTIONS[m].start + MOTIONS[m].durations.length - 1}</span>`)
  .join('');

$('strip').innerHTML = CHARACTERS.map((c, row) => {
  const cells = [];
  for (let f = 0; f < COLUMNS; f += 1) {
    const motion = frameOf.get(f) ?? 'idle';
    cells.push(`<div class="fr m-${motion}"><i style="background-position:${-PITCH * f}px ${-PITCH * row}px"></i>${f}</div>`);
  }
  return `<div style="margin-bottom:14px"><div class="nm" style="font-size:12px;margin-bottom:6px">${c.name}</div>
    <div class="frames">${cells.join('')}</div></div>`;
}).join('');

$('ruler').innerHTML = MOTION_ORDER
  .map((m) => `<b style="left:${((MOTIONS[m].start + 0.5) / COLUMNS) * 100}%">${MOTION_LABEL[m]}</b>`).join('');

/* ---------- 三、帧数据与锚点（由源模块生成，不手写） ---------- */

$('table').innerHTML = `<table>
  <tr><th>动作</th><th>起始帧</th><th>帧数</th><th>单帧时长 ms</th><th>总时长 ms</th><th>循环</th><th>释放关键帧</th><th>释放点（逻辑像素）</th></tr>
  ${MOTION_ORDER.map((name) => {
    const s = MOTIONS[name];
    const a = RELEASE_ANCHORS[name];
    return `<tr><td>${MOTION_LABEL[name]} <code>${name}</code></td><td>${s.start}</td><td>${s.durations.length}</td>
      <td>${s.durations.join(' / ')}</td><td>${s.durations.reduce((x, y) => x + y, 0)}</td>
      <td>${s.loop ? '是' : '否'}</td>
      <td>${s.releaseMs === null ? '—' : `${s.releaseMs} ms → 第 ${motionFrameAt(name, s.releaseMs)} 帧`}</td>
      <td>${a ? `x ${a.x} · y ${a.y}` : '—'}</td></tr>`;
  }).join('')}
  <tr><th>接触点 / 图集</th><td colspan="7">脚底 <code>(${ANCHORS.foot.x}, ${ANCHORS.foot.y})</code> ·
    画布 ${CELL}×${CELL} · 单元格间距 ${GAP} · pitch ${PITCH} · ${COLUMNS} 列 × ${ROWS} 行 ·
    图集 ${COLUMNS * PITCH}×${ROWS * PITCH}</td></tr>
</table>`;

/* ---------- 四、自检：把上面这些说法变成可复现的判定 ---------- */

const pixels = (id, motion, frame) => drawCharacter(id, motion, frame);
const frameKey = (id, motion, frame) => pixels(id, motion, frame).map((row) => row.join(',')).join('|');
const frameSet = (id, motion) => {
  const spec = MOTIONS[motion];
  return new Set(Array.from({ length: spec.durations.length }, (_, i) => frameKey(id, motion, i)));
};
/** 接触点：该帧最下面一行非空像素，呼吸时不得漂移 */
const contactRow = (id, motion, frame) => {
  const grid = pixels(id, motion, frame);
  for (let y = grid.length - 1; y >= 0; y -= 1) if (grid[y].some(Boolean)) return y;
  return -1;
};
/** 手里那张牌的浅色牌面像素数（与 drawCharacter 中的 P 色一致；jin 的手套也算，所以只看差值） */
const heldCardPixels = (id, motion, frame) =>
  pixels(id, motion, frame).flat().filter((c) => c === '#f4e7cd').length;

async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

async function selfCheck() {
  // 1) 每个角色每个动作都是真实逐帧：帧数够、且大部分帧彼此不同
  let frameFailures = [];
  let contactFailures = [];
  for (const c of CHARACTERS) {
    for (const motion of MOTION_ORDER) {
      const spec = MOTIONS[motion];
      const distinct = frameSet(c.id, motion).size;
      if (distinct < Math.ceil(spec.durations.length * 0.6)) {
        frameFailures.push(`${c.name}/${motion} 只有 ${distinct}/${spec.durations.length} 帧不同`);
      }
    }
    const rows = new Set(Array.from({ length: MOTIONS.idle.durations.length }, (_, i) => contactRow(c.id, 'idle', i)));
    if (rows.size !== 1) contactFailures.push(`${c.name} 呼吸时脚底在 ${[...rows].join('/')} 行之间漂移`);
  }
  check('呼吸与出牌是逐帧绘制（每动作 ≥60% 帧互不相同）', frameFailures.length === 0, frameFailures.join('；') || `6 人 × 5 动作全部通过`);
  check('呼吸时脚底接触点不漂', contactFailures.length === 0, contactFailures.join('；') || '6 人呼吸帧的最底行一致');

  // 2) 出牌：释放帧的手已经空了，释放前一帧还握着牌（手臂与卡牌严格对齐）
  const releaseIssues = [];
  for (const c of CHARACTERS) {
    const at = motionFrameAt('play', MOTIONS.play.releaseMs);
    const before = heldCardPixels(c.id, 'play', at - 1);
    const after = heldCardPixels(c.id, 'play', at);
    // 手里的牌是 4×6 的浅色块，中间还有 2×4 的深色牌子，所以净减少约 10–16 个像素
    if (before - after < 8) releaseIssues.push(`${c.name} 放牌帧手里还捏着牌（${before} → ${after} 个牌面像素）`);
    let moved = 0;
    const a = pixels(c.id, 'play', at - 1).flat();
    const b = pixels(c.id, 'play', at).flat();
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) moved += 1;
    if (moved < 80) releaseIssues.push(`${c.name} 释放帧与前一帧几乎一样（${moved} 个像素变化）`);
    const anchor = releaseAnchor('play');
    const hand = HAND_POS.play[at];
    if (anchor.x !== hand[0] || anchor.y !== hand[1] + 0.5) releaseIssues.push(`${c.name} 释放点与手部坐标不一致`);
  }
  check('出牌释放点 = 释放帧的手部中心，且该帧牌已离手', releaseIssues.length === 0,
    releaseIssues.join('；') || `play ${MOTIONS.play.releaseMs}ms → 第 ${motionFrameAt('play', MOTIONS.play.releaseMs)} 帧，6 人一致`);

  // 3) 六人轮廓不同（只换发色不够）
  const silhouettes = CHARACTERS.map((c) => pixels(c.id, 'idle', 0));
  let minDiff = 1;
  for (let i = 0; i < silhouettes.length; i += 1) {
    for (let j = i + 1; j < silhouettes.length; j += 1) {
      let diff = 0;
      for (let y = 0; y < CELL; y += 1) {
        for (let x = 0; x < CELL; x += 1) {
          if ((silhouettes[i][y][x] ?? null) !== (silhouettes[j][y][x] ?? null)) diff += 1;
        }
      }
      minDiff = Math.min(minDiff, diff / (CELL * CELL));
    }
  }
  check('六个角色互不相同', minDiff > 0.08, `最相近的两个角色仍有 ${(minDiff * 100).toFixed(1)}% 像素不同`);

  // 4) 生产图集与源模块逐格一致
  let atlasNote = '无法读取 atlas.png';
  try {
    const img = await loadImage(ATLAS_PNG);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const at = (x, y) => {
      const i = (y * img.width + x) * 4;
      return data[i + 3] === 0 ? null
        : `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    };
    let mismatches = 0;
    let checked = 0;
    for (let row = 0; row < CHARACTERS.length; row += 1) {
      for (const motion of MOTION_ORDER) {
        const spec = MOTIONS[motion];
        for (let i = 0; i < spec.durations.length; i += 1) {
          const grid = pixels(CHARACTERS[row].id, motion, i);
          for (let y = 0; y < CELL; y += 1) {
            for (let x = 0; x < CELL; x += 1) {
              checked += 1;
              if (grid[y][x] !== at((spec.start + i) * PITCH + x, row * PITCH + y)) mismatches += 1;
            }
          }
        }
      }
    }
    check('atlas.png 与源模块逐像素一致（含 cell 间距）', mismatches === 0,
      mismatches === 0 ? `${checked} 个像素全部一致 · 图集 ${img.width}×${img.height}` : `${mismatches}/${checked} 个像素不一致，请重跑图集脚本`);
    check('图集尺寸 = 列 × pitch × 行 × pitch', img.width === COLUMNS * PITCH && img.height === ROWS * PITCH,
      `实际 ${img.width}×${img.height}，期望 ${COLUMNS * PITCH}×${ROWS * PITCH}`);
  } catch (error) {
    check('atlas.png 可读取', false, String(error));
  }

  // 5) atlas.json 与源模块一致（防止图集元数据过期）
  try {
    const json = await (await fetch(ATLAS_JSON, { cache: 'no-store' })).json();
    const same = json.cell === CELL && json.pitch === PITCH && json.gap === GAP
      && json.columns === COLUMNS && json.rows === ROWS
      && JSON.stringify(json.motions) === JSON.stringify(MOTIONS)
      && JSON.stringify(json.foot) === JSON.stringify(ANCHORS.foot)
      && JSON.stringify(json.release) === JSON.stringify(RELEASE_ANCHORS)
      && json.characters.map((c) => c.id).join() === CHARACTERS.map((c) => c.id).join();
    check('atlas.json 与源模块一致', same, same ? 'cell / pitch / 动作时长 / 角色 / 锚点全部吻合' : '元数据不一致，请重跑图集脚本');
  } catch (error) {
    check('atlas.json 可读取', false, String(error));
  }

  // 6) 整数倍率：1x / 2x 渲染尺寸都是 48 的整数倍，锚点随之等比
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0';
  probe.innerHTML = avatarSVG('shirley', 'neutral', 1) + avatarSVG('shirley', 'neutral', 2);
  document.body.append(probe);
  const sizes = [...probe.querySelectorAll('.pixel-avatar')].map((el) => Math.round(el.getBoundingClientRect().width));
  const rect1 = avatarHandRect(probe.querySelectorAll('.pixel-avatar')[0], 'play');
  const rect2 = avatarHandRect(probe.querySelectorAll('.pixel-avatar')[1], 'play');
  const expected = [CELL * 1, CELL * 2];
  // 手部中心 = 释放框中心（释放框本身固定 8×10 CSS 像素，只有中心随倍率等比）
  const center1 = rect1.left + rect1.width / 2 - probe.querySelectorAll('.pixel-avatar')[0].getBoundingClientRect().left;
  const center2 = rect2.left + rect2.width / 2 - probe.querySelectorAll('.pixel-avatar')[1].getBoundingClientRect().left;
  check('1x / 2x 都是整数倍率且手部锚点等比', sizes.join() === expected.join() && Math.abs(center2 - center1 * 2) < 0.6,
    `渲染宽度 ${sizes.join(' / ')}（期望 ${expected.join(' / ')}）· 手部中心偏移 ${center1.toFixed(1)} / ${center2.toFixed(1)}px（应 1:2）`);
  probe.remove();

  // 6b) 内联只写"默认倍率"（--avatar-default-scale），样式表能覆盖最终倍率（--avatar-scale）：
  //     手机媒体查询把 2x 降成 1x 就是靠这条链路生效的，CSS 背景 / WAAPI / 锚点必须都跟最终值。
  const overrideStyle = document.createElement('style');
  overrideStyle.textContent = '.scale-override-probe .pixel-avatar{--avatar-scale:1}';
  document.head.append(overrideStyle);
  const overrideProbe = document.createElement('div');
  overrideProbe.className = 'scale-override-probe';
  overrideProbe.style.cssText = 'position:absolute;left:-9999px;top:0';
  overrideProbe.innerHTML = avatarSVG('shirley', 'neutral', 2);
  document.body.append(overrideProbe);
  const overrideAvatar = overrideProbe.querySelector('.pixel-avatar');
  const overrideWidth = Math.round(overrideAvatar.getBoundingClientRect().width);
  const overrideUnit = avatarUnit(overrideAvatar);
  check('样式表可覆盖内联默认倍率（手机 1x 依赖这条链路）', overrideWidth === CELL && Math.abs(overrideUnit - 1) < 0.02,
    `内联默认 2x + 样式表 1x → 实渲染 ${overrideWidth}px（期望 ${CELL}）、锚点倍率 ${overrideUnit?.toFixed(3)}（期望 1.000）`);
  overrideProbe.remove();
  overrideStyle.remove();

  // 6c) 呼吸错峰按"实例"而不是"角色"：座位号相邻也要错开，且周期只轻微不同
  const phases = CHARACTERS.map((_, row) => breathPhase(row));
  let minGap = 1;
  for (let i = 1; i < phases.length; i += 1) minGap = Math.min(minGap, Math.abs(phases[i] - phases[i - 1]));
  const periods = CHARACTERS.map((_, row) => breathPeriod(row));
  const spread = Math.max(...periods) - Math.min(...periods);
  check('呼吸错峰按实例生效（相邻座位不同相位、周期只轻微不同）',
    minGap >= 0.25 && spread <= 0.5 && new Set(periods.map((p) => p.toFixed(3))).size === periods.length,
    `相邻座位最小相位差 ${(minGap * 100).toFixed(0)}% 周期 · 周期 ${Math.min(...periods).toFixed(2)}–${Math.max(...periods).toFixed(2)}s（跨度 ${spread.toFixed(2)}s）`);

  // 6d) 慢放 ×2.5：动作时间线真的被放慢，而不是只改了按钮文字
  const slowProbe = seats.querySelector('.seat .pixel-avatar');
  const prevFactor = slow.factor;
  slow.factor = 0.4;
  const slowPromise = run(slowProbe, 'play');
  const slowAnims = actionAnimations(slowProbe);
  const ratesOk = slowAnims.length > 0 && slowAnims.every((a) => a.playbackRate === 0.4);
  await slowPromise;
  slow.factor = prevFactor;
  check('慢放 ×2.5 作用于动作时间线', ratesOk,
    ratesOk ? `${slowAnims.length} 条动作动画 playbackRate = 0.4（单次出牌约 1.6s）`
            : '没有命中动作动画：慢放会失效（Element.getAnimations() 不含后代）');

  // 7) 减弱动态：没有动作帧也要有清晰的短确认，且能被取消
  const prevMotion = document.documentElement.dataset.motion;
  document.documentElement.dataset.motion = 'reduced';
  const card = seats.querySelector('.seat .pixel-avatar');
  const reducedPromise = playAvatar(card, 'play');
  const confirmed = card.classList.contains('avatar-confirm') && card.dataset.confirm === '出牌';
  cancelAvatarActions();
  const cleared = !card.classList.contains('avatar-confirm') && !card.dataset.confirm;
  await reducedPromise;
  document.documentElement.dataset.motion = prevMotion ?? 'standard';
  check('减弱动态仍有短确认，且取消后清理干净', confirmed && cleared,
    `确认标签 ${confirmed ? '已显示' : '缺失'} · 取消后 ${cleared ? '无残留' : '有残留'}`);

  // 8) 连续出牌不会卡住：两次顺序播放后不留下 data-action
  const seq = seats.querySelector('.seat .pixel-avatar');
  await run(seq, 'play');
  await run(seq, 'play');
  check('同一人物连续出牌可顺序衔接', !seq.dataset.action, seq.dataset.action ? `残留 data-action=${seq.dataset.action}` : '两次播放结束且动作层已复位');

  $('selfcheck').innerHTML = checks.map((c) => `<div class="ck ${c.ok ? 'ok' : 'bad'}">
    <b>${c.ok ? 'PASS' : 'FAIL'}</b> ${c.name}<small>${c.detail}</small></div>`).join('');
  const failed = checks.filter((c) => !c.ok).length;
  $('selfcheck-summary').textContent = failed === 0 ? `全部 ${checks.length} 项通过` : `${failed} / ${checks.length} 项未通过`;
  $('selfcheck-summary').className = failed === 0 ? 'ok' : 'bad';
}

/* ---------- 工具条 ---------- */

function setToggle(id, on, onLabel, offLabel) {
  const el = $(id);
  el.classList.toggle('on', on);
  el.textContent = on ? onLabel : offLabel;
}

$('slow').onclick = () => {
  slow.factor = slow.factor === 1 ? 0.4 : 1;
  setToggle('slow', slow.factor !== 1, '恢复 ×1', '慢放 ×2.5');
  applyBreathScale();
};

$('reduced').onclick = () => {
  const on = !reducedMotion();
  document.documentElement.dataset.motion = on ? 'reduced' : 'standard';
  setToggle('reduced', on, '恢复标准动态', '减弱动态');
};

$('pause').onclick = () => {
  const idle = [...document.querySelectorAll('.avatar-idle')];
  const paused = idle[0]?.style.animationPlayState === 'paused';
  idle.forEach((el) => { el.style.animationPlayState = paused ? '' : 'paused'; });
  setToggle('pause', !paused, '继续呼吸', '暂停呼吸');
};

$('anchors').onclick = () => {
  const stages = [...document.querySelectorAll('.stage')];
  const on = stages[0].dataset.anchors !== 'on';
  stages.forEach((el) => { el.dataset.anchors = on ? 'on' : 'off'; });
  setToggle('anchors', on, '隐藏锚点', '显示锚点');
};

const avatarAt = (i) => document.querySelectorAll('.seat')[i].querySelector('.pixel-avatar');
$('allplay').onclick = () => {
  CHARACTERS.forEach((c, i) => setTimeout(() => void run(avatarAt(i), 'play'), i * 300 * (1 / slow.factor)));
};
$('allplay6').onclick = () => {
  CHARACTERS.forEach((c, i) => void run(avatarAt(i), 'win'));
};

document.addEventListener('visibilitychange', () => {
  document.documentElement.classList.toggle('page-hidden', document.hidden);
});

void selfCheck();
