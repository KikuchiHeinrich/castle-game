var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// packages/client/src/art/characters.ts
var CELL = 48;
var GAP = 2;
var PITCH = CELL + GAP;
var CHARACTERS = [
  ["shirley", "\u96EA\u8389", "#e8e3dc", "#fff5df", "#a3a1b5", "#344865", "#202d44", "#dfb569", "#699eca"],
  ["yan", "\u5C0F\u7130", "#c74b45", "#f3815b", "#7c303a", "#829295", "#3c4852", "#d9b165", "#9f5140"],
  ["cang", "\u5C0F\u82CD", "#649ac4", "#a3d0df", "#345787", "#3c5687", "#253451", "#e4c373", "#315c87"],
  ["mo", "\u5C0F\u58A8", "#44404e", "#776879", "#282631", "#67517b", "#392d48", "#b99a70", "#9278b0"],
  ["sen", "\u5C0F\u68EE", "#779355", "#b7c681", "#3c5e40", "#547453", "#304b3d", "#dac078", "#527449"],
  ["jin", "\u5C0F\u91D1", "#d8ac55", "#f4dc94", "#a36f40", "#91516d", "#563447", "#efc979", "#ac515d"]
].map(([id, name, hair, light, shade, coat, dark, trim, eye]) => ({ id, name, hair, light, shade, coat, dark, trim, eye }));
var MOTIONS = {
  idle: { start: 0, durations: [650, 430, 570, 610, 480, 620], loop: true, releaseMs: null },
  play: { start: 6, durations: [90, 60, 70, 80, 90, 90, 70, 70], loop: false, releaseMs: 150 },
  defend: { start: 14, durations: [110, 140, 170, 150], loop: false, releaseMs: 110 },
  fold: { start: 18, durations: [100, 150, 160, 150], loop: false, releaseMs: 100 },
  win: { start: 22, durations: [100, 100, 140, 140, 120, 120], loop: false, releaseMs: null }
};
var COLUMNS = Math.max(...Object.values(MOTIONS).map((m) => m.start + m.durations.length));
var ROWS = CHARACTERS.length;
var ANCHORS = { foot: { x: 24, y: 44 } };
var HAND_POS = {
  idle: [[34, 34], [34, 33], [34, 33], [34, 33], [34, 34], [34, 34]],
  play: [[34, 34], [32, 29], [40, 30], [41, 31], [39, 32], [37, 32], [35, 33], [34, 34]],
  defend: [[34, 34], [29, 31], [27, 30], [29, 32]],
  fold: [[34, 34], [36, 35], [34, 36], [33, 35]],
  win: [[34, 34], [36, 26], [35, 23], [36, 24], [35, 26], [34, 34]]
};
function motionFrameAt(motion, ms) {
  const spec = MOTIONS[motion];
  let acc = 0;
  for (let i = 0; i < spec.durations.length; i++) {
    acc += spec.durations[i];
    if (ms < acc) return i;
  }
  return spec.durations.length - 1;
}
function releaseAnchor(motion) {
  const spec = MOTIONS[motion];
  if (spec.releaseMs === null) return null;
  const [ax, ay] = HAND_POS[motion][motionFrameAt(motion, spec.releaseMs)];
  return { x: ax, y: ay + 0.5 };
}
var RELEASE_ANCHORS = Object.fromEntries(
  Object.keys(MOTIONS).map((m) => [m, releaseAnchor(m)])
);
function drawCharacter(id, motion, frame) {
  const c = CHARACTERS.find((c2) => c2.id === id) ?? CHARACTERS[0], g = Array.from({ length: 48 }, () => Array(48).fill(null));
  const O = "#202633", S = "#edc9a6", D = "#c18f78", B = "#4a3b38", P = "#f4e7cd";
  const r = (x, y, w, h, v) => {
    for (let yy = Math.max(0, y); yy < Math.min(48, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(48, x + w); xx++) g[yy][xx] = v;
  };
  const p = (pts, v) => {
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      let a = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (yi > y + 0.5 !== yj > y + 0.5 && x + 0.5 < (xj - xi) * (y + 0.5 - yi) / (yj - yi) + xi) a = !a;
      }
      if (a) g[y][x] = v;
    }
  };
  const idle = motion === "idle", dy = idle && [1, 2, 3].includes(frame) ? -1 : 0, hy = idle && [2, 3].includes(frame) ? -1 : motion === "fold" && frame > 0 ? 1 : 0;
  const hyHat = idle ? [0, 0, 0, -1, -1, 0][frame] : hy;
  const lag = idle ? [0, 0, 1, 1, 1, 0][frame] : frame % 2, lean = motion === "play" && frame > 1 && frame < 5 ? 1 : 0, Y = 28 + dy, happy = motion === "win" && frame > 0 && frame < 5;
  p([[17, 27], [31, 27], [36 + lag, 40], [28, 39], [24, 41], [13 - lag, 39]], c.dark);
  r(19, 37, 4, 5, c.coat);
  r(27, 37, 4, 5, c.dark);
  r(17, 42, 6, 2, B);
  r(27, 42, 6, 2, B);
  r(18, 41, 5, 1, c.trim);
  r(27, 41, 5, 1, c.trim);
  if (id === "shirley" || id === "jin") {
    p([[12, 14 + hyHat], [15, 14 + hyHat], [15, 26], [11 - lag, 34], [7 - lag, 32], [10, 23]], c.hair);
    p([[33, 14 + hyHat], [36, 15 + hyHat], [38, 25], [41 + lag, 32], [36, 35], [33, 27]], c.hair);
    r(10, 18 + hyHat, 2, 10, c.shade);
    r(36, 21 + hyHat, 2, 8, c.shade);
    r(11, 13 + hyHat, 5, 3, c.dark);
    r(33, 14 + hyHat, 5, 3, c.dark);
    r(8, 29, 2, 3, c.light);
  } else if (id === "cang" || id === "sen") p([[14, 17 + dy], [34, 17 + dy], [34, 26], [39 + lag, 34], [32, 33], [31, 24], [16, 26], [14, 31], [11, 29]], c.shade);
  r(18 + lean, Y, 14, 10, c.coat);
  r(27 + lean, Y + 1, 5, 9, c.dark);
  p([[18 + lean, Y], [24 + lean, Y + 3], [21 + lean, Y + 7], [17 + lean, Y + 6]], c.trim);
  r(23 + lean, Y + 3, 2, 7, c.dark);
  r(18, 37, 14, 2, B);
  r(23, 37, 3, 2, c.trim);
  if (id === "yan") {
    r(19 + lean, Y + 3, 10, 5, c.light);
    r(21 + lean, Y + 4, 5, 1, P);
    r(19, Y + 8, 12, 2, c.dark);
  }
  if (id === "jin" || id === "shirley") {
    p([[18, 34], [32, 34], [34, 40], [29, 39], [25, 40], [20, 39], [16, 40]], c.coat);
    r(18, 38, 14, 1, c.trim);
  }
  if (id === "mo") {
    p([[15, Y], [30, Y + 1], [34 + lag, 38], [24, 35], [14, 38]], c.coat);
    r(26, Y + 3, 2, 2, c.trim);
  }
  if (id === "sen") {
    r(27, Y + 1, 2, 8, B);
    r(26, Y + 2, 2, 2, c.trim);
  }
  r(15 + lean, 13 + hyHat, 19, 11, c.hair);
  r(17 + lean, 17 + hy, 15, 10, S);
  r(18 + lean, 26 + hy, 12, 2, D);
  r(15 + lean, 15 + hyHat, 3, 10, c.shade);
  r(32 + lean, 17 + hyHat, 2, 8, c.shade);
  r(18 + lean, 13 + hyHat, 12, 4, c.hair);
  r(18 + lean, 12 + hyHat, 5, 3, c.light);
  p([[17 + lean, 15 + hyHat], [30 + lean, 15 + hyHat], [29 + lean, 20 + hyHat], [26 + lean, 18 + hyHat], [24 + lean, 21 + hy], [22 + lean, 18 + hyHat], [19 + lean, 20 + hyHat]], c.hair);
  if (happy) {
    r(20 + lean, 21 + hy, 3, 1, O);
    r(27 + lean, 21 + hy, 3, 1, O);
    r(21 + lean, 20 + hy, 1, 1, O);
    r(28 + lean, 20 + hy, 1, 1, O);
  } else {
    r(20 + lean, 20 + hy, 3, 1, O);
    r(27 + lean, 20 + hy, 3, 1, O);
    r(20 + lean, 21 + hy, 2, 3, c.eye);
    r(27 + lean, 21 + hy, 2, 3, id === "shirley" ? "#b45d68" : c.eye);
    r(20 + lean, 21 + hy, 1, 1, P);
    r(27 + lean, 21 + hy, 1, 1, P);
  }
  r(24 + lean, 25 + hy, happy ? 2 : 1, 1, D);
  if (id === "yan") {
    p([[12 + lean, 15 + hyHat], [15 + lean, 12 + hyHat], [14 + lean, 8 + hyHat], [20 + lean, 10 + hyHat], [22 + lean, 6 + hyHat], [27 + lean, 9 + hyHat], [31 + lean, 7 + hyHat], [32 + lean, 12 + hyHat], [36 + lean, 13 + hyHat], [33 + lean, 16 + hyHat], [34 + lean, 19 + hyHat], [30 + lean, 18 + hyHat], [28 + lean, 16 + hyHat], [26 + lean, 19 + hyHat], [23 + lean, 16 + hyHat], [20 + lean, 19 + hyHat], [18 + lean, 16 + hyHat], [14 + lean, 19 + hyHat]], c.hair);
    r(19 + lean, 11 + hyHat, 4, 2, c.light);
    r(26 + lean, 10 + hyHat, 3, 2, c.light);
    r(16, Y, 18, 3, c.hair);
    p([[16, Y + 1], [20, Y + 3], [13 - lag, Y + 8], [8 - lag, Y + 5], [12, Y + 4]], c.shade);
  } else if (id === "cang") {
    p([[9 + lean, 16 + hyHat], [16 + lean, 13 + hyHat], [23 + lean, 3 + hyHat], [31 + lean, 6 + hyHat], [35 + lean, 11 + hyHat], [32 + lean, 12 + hyHat], [39 + lean, 17 + hyHat], [34 + lean, 19 + hyHat], [17 + lean, 17 + hyHat], [10 + lean, 19 + hyHat]], c.coat);
    p([[18 + lean, 12 + hyHat], [23 + lean, 5 + hyHat], [25 + lean, 7 + hyHat], [22 + lean, 13 + hyHat]], c.dark);
    p([[15 + lean, 14 + hyHat], [33 + lean, 14 + hyHat], [36 + lean, 16 + hyHat], [13 + lean, 16 + hyHat]], c.trim);
    r(29 + lean, 9 + hyHat, 2, 5, c.trim);
    r(27 + lean, 11 + hyHat, 6, 1, c.trim);
  } else if (id === "sen") {
    p([[10 + lean, 15 + hyHat], [17 + lean, 11 + hyHat], [28 + lean, 10 + hyHat], [34 + lean, 14 + hyHat], [37 + lean, 16 + hyHat], [29 + lean, 18 + hyHat], [16 + lean, 16 + hyHat], [11 + lean, 18 + hyHat]], c.dark);
    r(18 + lean, 13 + hyHat, 14, 2, c.trim);
    p([[27 + lean, 12 + hyHat], [30 + lean, 5 + hyHat], [35 + lean, 6 + hyHat], [32 + lean, 12 + hyHat]], c.hair);
    r(31 + lean, 8 + hyHat, 1, 4, c.light);
    r(32 + lean, 13 + hyHat, 3, 3, P);
    r(33 + lean, 14 + hyHat, 1, 1, c.trim);
  } else if (id === "mo") {
    p([[12 + lean, 18 + hyHat], [14 + lean, 11 + hyHat], [25 + lean, 7 + hyHat], [34 + lean, 12 + hyHat], [36 + lean, 24 + hyHat], [32 + lean, 27 + hyHat], [32 + lean, 17 + hyHat], [25 + lean, 13 + hyHat], [18 + lean, 17 + hyHat], [16 + lean, 27 + hyHat], [12 + lean, 25 + hyHat]], c.coat);
    p([[16 + lean, 12 + hyHat], [25 + lean, 9 + hyHat], [32 + lean, 13 + hyHat], [26 + lean, 12 + hyHat], [18 + lean, 17 + hyHat]], c.dark);
    p([[18 + lean, 16 + hyHat], [25 + lean, 15 + hyHat], [23 + lean, 24 + hyHat], [18 + lean, 24 + hyHat]], c.hair);
    r(29 + lean, 13 + hyHat, 1, 4, c.trim);
    r(28 + lean, 14 + hyHat, 3, 1, c.trim);
  } else if (id === "shirley") {
    r(16 + lean, 8 + hyHat, 17, 5, c.dark);
    r(18 + lean, 6 + hyHat, 13, 3, c.coat);
    r(16 + lean, 12 + hyHat, 18, 2, c.trim);
    r(23 + lean, 8 + hyHat, 3, 3, c.trim);
    r(22 + lean, 9 + hyHat, 5, 1, c.trim);
    r(19, Y, 2, 2, c.trim);
    r(29, Y, 2, 2, c.trim);
  } else if (id === "jin") {
    p([[18 + lean, 11 + hyHat], [17 + lean, 6 + hyHat], [21 + lean, 8 + hyHat], [24 + lean, 4 + hyHat], [27 + lean, 8 + hyHat], [31 + lean, 6 + hyHat], [30 + lean, 12 + hyHat]], c.trim);
    r(24 + lean, 7 + hyHat, 2, 3, c.coat);
    r(19 + lean, 11 + hyHat, 10, 1, c.light);
    r(16, Y, 4, 3, P);
    r(30, Y, 3, 3, P);
  }
  r(14 + lean, Y + 2, 4, 6, c.coat);
  r(14 + lean, Y + 7, 4, 3, D);
  const hand = HAND_POS[motion][Math.min(Math.max(frame, 0), HAND_POS[motion].length - 1)], ax = hand[0], ay = hand[1];
  p([[30 + lean, Y + 2], [34 + lean, Y + 2], [ax, ay - 2], [ax - 2, ay + 2], [31, Y + 7]], c.dark);
  r(ax - 2, ay - 1, 4, 3, S);
  if (idle || motion === "play" && frame < motionFrameAt("play", MOTIONS.play.releaseMs)) {
    const x = idle ? 31 + lean : ax, y = idle ? Y + 1 : ay - 5;
    r(x, y, 4, 6, P);
    r(x + 1, y + 1, 2, 4, c.dark);
  }
  const out = g.map((row) => [...row]);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) if (!g[y][x] && [g[y - 1]?.[x], g[y + 1]?.[x], g[y]?.[x - 1], g[y]?.[x + 1]].some(Boolean)) out[y][x] = O;
  return out;
}

// packages/client/src/assets/characters/atlas.png
var atlas_default = "./atlas.png";

// packages/client/src/pending.ts
var TimerRegistry = class {
  constructor() {
    __publicField(this, "timers", /* @__PURE__ */ new Map());
  }
  /** 登记一个超时：到点执行 run；被取消时同样执行 run（收尾 + 结算等待） */
  set(ms, run2) {
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      run2();
    }, ms);
    this.timers.set(handle, run2);
    return handle;
  }
  /** 取消单个超时：未登记或已触发/已取消时返回 false，不会重复执行回调 */
  cancel(handle) {
    const run2 = this.timers.get(handle);
    if (run2 === void 0) return false;
    this.timers.delete(handle);
    clearTimeout(handle);
    run2();
    return true;
  }
  /** 取消全部：先停表，再逐个收尾 / 结算 */
  cancelAll() {
    for (const [handle, run2] of [...this.timers]) {
      this.timers.delete(handle);
      clearTimeout(handle);
      run2();
    }
  }
  get size() {
    return this.timers.size;
  }
};

// packages/client/src/components/pixelAvatar.ts
var SHIRLEY = CHARACTERS[0];
var PLAYER_CHARS = CHARACTERS.slice(1);
var charById = (id) => CHARACTERS.find((c) => c.id === id) ?? SHIRLEY;
function avatarSVG(id, _mood = "neutral", px = 2, phase) {
  const c = charById(id), row = CHARACTERS.indexOf(c), scale = Math.max(1, Math.round(px)), key = phase ?? row;
  return `<span class="pixel-avatar" data-character="${c.id}" data-scale="${scale}" role="img" aria-label="${c.name}" style="--avatar-default-scale:${scale};--atlas-row:${row};--breath-period:${breathPeriod(key).toFixed(3)}s;--breath-delay:${breathDelay(key).toFixed(3)}s"><span class="avatar-shadow"></span><span class="avatar-idle sprite-frame" style="background-image:url('${atlas_default}')"></span><span class="avatar-action sprite-frame" style="background-image:url('${atlas_default}')"></span></span>`;
}
function phaseHash(key, fallback) {
  const text = key === void 0 || key === "" ? String(fallback) : String(key);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 997 / 997;
}
var GOLDEN = 0.6180339887;
function phaseOf(key, fallback) {
  if (typeof key === "number" && Number.isFinite(key)) return (key * GOLDEN + 0.13 + 0.09 * phaseHash(`n${key}`, fallback)) % 1;
  return phaseHash(key, fallback);
}
var breathPhase = (key, fallback = 0) => phaseOf(key, fallback);
var breathPeriod = (key, fallback = 0) => 3.15 + 0.42 * phaseOf(key, fallback);
var breathDelay = (key, fallback = 0) => -(phaseOf(key, fallback) * 3.57);
if (typeof document !== "undefined") {
  const s = document.documentElement.style;
  s.setProperty("--atlas-pitch", String(PITCH));
  s.setProperty("--atlas-columns", String(COLUMNS));
  s.setProperty("--atlas-rows", String(ROWS));
}
var asAvatar = (element) => element?.matches(".pixel-avatar") ? element : element?.querySelector(".pixel-avatar") ?? null;
var localScale = (avatar) => {
  const fromCss = Number.parseFloat(getComputedStyle(avatar).getPropertyValue("--avatar-scale"));
  return Math.max(1, Math.round(Number.isFinite(fromCss) && fromCss > 0 ? fromCss : Number(avatar.dataset.scale) || 2));
};
function reducedMotion() {
  return document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;
}
var actors = /* @__PURE__ */ new Map();
var confirmTimers = new TimerRegistry();
var confirmHandles = /* @__PURE__ */ new Map();
var CONFIRM_MS = 240;
function cancelAvatarActions() {
  for (const cancel of [...actors.values()]) cancel();
  for (const avatar of [...confirmHandles.keys()]) clearConfirm(avatar);
  confirmTimers.cancelAll();
  for (const el of document.querySelectorAll(".avatar-confirm")) {
    el.classList.remove("avatar-confirm");
    delete el.dataset.confirm;
  }
}
function clearConfirm(avatar) {
  const handle = confirmHandles.get(avatar);
  if (handle === void 0) return;
  confirmHandles.delete(avatar);
  confirmTimers.cancel(handle);
}
function confirmAction(avatar, motion) {
  clearConfirm(avatar);
  avatar.classList.add("avatar-confirm");
  avatar.dataset.confirm = CONFIRM_LABEL[motion];
  delete avatar.dataset.action;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      confirmHandles.delete(avatar);
      avatar.classList.remove("avatar-confirm");
      delete avatar.dataset.confirm;
      resolve();
    };
    confirmHandles.set(avatar, confirmTimers.set(CONFIRM_MS, finish));
  });
}
var CONFIRM_LABEL = { play: "\u51FA\u724C", defend: "\u9632\u5B88", fold: "\u5F03\u724C", win: "\u80DC\u5229" };
function playAvatar(element, motion) {
  const avatar = asAvatar(element);
  if (!avatar) return Promise.resolve();
  actors.get(avatar)?.();
  if (reducedMotion()) return confirmAction(avatar, motion);
  const layer = avatar.querySelector(".avatar-action"), spec = MOTIONS[motion], duration = spec.durations.reduce((a, b) => a + b, 0);
  avatar.dataset.action = motion;
  const scale = localScale(avatar);
  let elapsed = 0;
  const keys = spec.durations.map((hold, i) => {
    const k = { backgroundPositionX: `${-(spec.start + i) * PITCH * scale}px`, offset: elapsed / duration, easing: "steps(1,end)" };
    elapsed += hold;
    return k;
  });
  keys.push({ backgroundPositionX: `${-(spec.start + spec.durations.length - 1) * PITCH * scale}px`, offset: 1 });
  const animation = layer.animate(keys, { duration, fill: "forwards" });
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      actors.delete(avatar);
      animation.cancel();
      delete avatar.dataset.action;
      resolve();
    };
    actors.set(avatar, finish);
    animation.finished.then(finish, finish);
  });
}
function avatarMetrics(avatar) {
  const r = avatar.getBoundingClientRect(), cs = getComputedStyle(avatar);
  const bl = Number.parseFloat(cs.borderLeftWidth) || 0, bt = Number.parseFloat(cs.borderTopWidth) || 0, br = Number.parseFloat(cs.borderRightWidth) || 0;
  const inner = r.width - bl - br;
  return { unit: inner > 0 ? inner / CELL : localScale(avatar), x: r.left + bl, y: r.top + bt };
}
function avatarUnit(element) {
  const avatar = asAvatar(element);
  return avatar ? avatarMetrics(avatar).unit : null;
}
function avatarHandRect(element, motion = "play") {
  const avatar = asAvatar(element);
  if (!avatar) return null;
  const m = avatarMetrics(avatar), a = RELEASE_ANCHORS[motion] ?? RELEASE_ANCHORS.play ?? { x: 34, y: 34 };
  return new DOMRect(m.x + a.x * m.unit - 4, m.y + a.y * m.unit - 5, 8, 10);
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
  document.documentElement.classList.toggle("page-hidden", document.hidden);
  if (document.hidden) cancelAvatarActions();
});

// docs/ui-rebuild/acceptance/acceptance-runtime.js
var ATLAS_PNG = "../../../packages/client/src/assets/characters/atlas.png";
var ATLAS_JSON = "../../../packages/client/src/assets/characters/atlas.json";
var SCALE = 3;
var MOTION_LABEL = { idle: "\u547C\u5438", play: "\u51FA\u724C", defend: "\u9632\u5B88", fold: "\u5F03\u724C", win: "\u80DC\u5229" };
var MOTION_ORDER = ["idle", "play", "defend", "fold", "win"];
document.documentElement.style.setProperty("--atlas", `url("${ATLAS_PNG}")`);
document.documentElement.style.setProperty("--atlas-w", `${COLUMNS * PITCH}px`);
document.documentElement.style.setProperty("--atlas-h", `${ROWS * PITCH}px`);
var $ = (id) => document.getElementById(id);
var slow = { factor: 1 };
var checks = [];
var check = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });
function seatMarkup(c, row) {
  const release = RELEASE_ANCHORS.play;
  const acts = MOTION_ORDER.filter((m) => m !== "idle").map((m) => `<button data-motion="${m}">${MOTION_LABEL[m]}</button>`).join("");
  return `<div class="seat" data-char="${c.id}">
    <div class="nm">${c.name} <small>#${row}</small></div>
    <div class="stage" data-anchors="off">
      ${avatarSVG(c.id, "neutral", SCALE)}
      <span class="anchor foot" style="left:0;width:${CELL * SCALE}px;top:${ANCHORS.foot.y * SCALE}px"></span>
      <span class="anchor rel" style="left:${release.x * SCALE}px;top:${release.y * SCALE}px" title="\u51FA\u724C\u91CA\u653E\u70B9"></span>
    </div>
    <div class="acts">${acts}<button data-motion="play" data-twice="1">\u8FDE\u7EED\u4E24\u6B21</button></div>
    <div class="probe" data-probe></div>
  </div>`;
}
var seats = $("seats");
seats.innerHTML = CHARACTERS.map((c, row) => seatMarkup(c, row)).join("");
function applyBreathScale() {
  document.querySelectorAll(".seat .pixel-avatar").forEach((el) => {
    const row = CHARACTERS.findIndex((c) => c.id === el.dataset.character);
    if (row < 0) return;
    el.style.setProperty("--breath-period", `${(breathPeriod(row) / slow.factor).toFixed(3)}s`);
    el.style.setProperty("--breath-delay", `${(breathDelay(row) / slow.factor).toFixed(3)}s`);
  });
}
function annotateReleasePoints() {
  document.querySelectorAll(".seat").forEach((seat) => {
    const avatar = seat.querySelector(".pixel-avatar");
    const box = avatar.getBoundingClientRect();
    const hand = avatarHandRect(avatar, "play");
    const row = CHARACTERS.findIndex((c) => c.id === seat.dataset.char);
    seat.querySelector("[data-probe]").textContent = `\u91CA\u653E\u70B9 +${(hand.left - box.left).toFixed(1)} / +${(hand.top - box.top).toFixed(1)} px \xB7 \u76F8\u4F4D ${(breathPhase(row) * 100).toFixed(0)}% \xB7 \u5468\u671F ${breathPeriod(row).toFixed(2)}s`;
  });
}
annotateReleasePoints();
function actionAnimations(avatar) {
  return document.getAnimations().filter((animation) => {
    const target = animation.effect && animation.effect.target;
    return target instanceof Element && target.classList.contains("avatar-action") && avatar.contains(target);
  });
}
async function run(avatar, motion) {
  const promise = playAvatar(avatar, motion);
  if (slow.factor !== 1) {
    for (const animation of actionAnimations(avatar)) animation.playbackRate = slow.factor;
  }
  return promise;
}
seats.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-motion]");
  if (!button) return;
  const stage = button.closest(".seat").querySelector(".stage");
  const avatar = stage.querySelector(".pixel-avatar");
  const motion = button.dataset.motion;
  if (button.dataset.twice) {
    await run(avatar, motion);
    await run(avatar, motion);
  } else {
    void run(avatar, motion);
  }
});
var frameOf = /* @__PURE__ */ new Map();
for (const [name, spec] of Object.entries(MOTIONS)) {
  for (let i = 0; i < spec.durations.length; i += 1) frameOf.set(spec.start + i, name);
}
$("col-count").textContent = String(COLUMNS);
$("legend").innerHTML = MOTION_ORDER.map((m) => `<span class="m-${m}">${MOTION_LABEL[m]} ${MOTIONS[m].start}\u2013${MOTIONS[m].start + MOTIONS[m].durations.length - 1}</span>`).join("");
$("strip").innerHTML = CHARACTERS.map((c, row) => {
  const cells = [];
  for (let f = 0; f < COLUMNS; f += 1) {
    const motion = frameOf.get(f) ?? "idle";
    cells.push(`<div class="fr m-${motion}"><i style="background-position:${-PITCH * f}px ${-PITCH * row}px"></i>${f}</div>`);
  }
  return `<div style="margin-bottom:14px"><div class="nm" style="font-size:12px;margin-bottom:6px">${c.name}</div>
    <div class="frames">${cells.join("")}</div></div>`;
}).join("");
$("ruler").innerHTML = MOTION_ORDER.map((m) => `<b style="left:${(MOTIONS[m].start + 0.5) / COLUMNS * 100}%">${MOTION_LABEL[m]}</b>`).join("");
$("table").innerHTML = `<table>
  <tr><th>\u52A8\u4F5C</th><th>\u8D77\u59CB\u5E27</th><th>\u5E27\u6570</th><th>\u5355\u5E27\u65F6\u957F ms</th><th>\u603B\u65F6\u957F ms</th><th>\u5FAA\u73AF</th><th>\u91CA\u653E\u5173\u952E\u5E27</th><th>\u91CA\u653E\u70B9\uFF08\u903B\u8F91\u50CF\u7D20\uFF09</th></tr>
  ${MOTION_ORDER.map((name) => {
  const s = MOTIONS[name];
  const a = RELEASE_ANCHORS[name];
  return `<tr><td>${MOTION_LABEL[name]} <code>${name}</code></td><td>${s.start}</td><td>${s.durations.length}</td>
      <td>${s.durations.join(" / ")}</td><td>${s.durations.reduce((x, y) => x + y, 0)}</td>
      <td>${s.loop ? "\u662F" : "\u5426"}</td>
      <td>${s.releaseMs === null ? "\u2014" : `${s.releaseMs} ms \u2192 \u7B2C ${motionFrameAt(name, s.releaseMs)} \u5E27`}</td>
      <td>${a ? `x ${a.x} \xB7 y ${a.y}` : "\u2014"}</td></tr>`;
}).join("")}
  <tr><th>\u63A5\u89E6\u70B9 / \u56FE\u96C6</th><td colspan="7">\u811A\u5E95 <code>(${ANCHORS.foot.x}, ${ANCHORS.foot.y})</code> \xB7
    \u753B\u5E03 ${CELL}\xD7${CELL} \xB7 \u5355\u5143\u683C\u95F4\u8DDD ${GAP} \xB7 pitch ${PITCH} \xB7 ${COLUMNS} \u5217 \xD7 ${ROWS} \u884C \xB7
    \u56FE\u96C6 ${COLUMNS * PITCH}\xD7${ROWS * PITCH}</td></tr>
</table>`;
var pixels = (id, motion, frame) => drawCharacter(id, motion, frame);
var frameKey = (id, motion, frame) => pixels(id, motion, frame).map((row) => row.join(",")).join("|");
var frameSet = (id, motion) => {
  const spec = MOTIONS[motion];
  return new Set(Array.from({ length: spec.durations.length }, (_, i) => frameKey(id, motion, i)));
};
var contactRow = (id, motion, frame) => {
  const grid = pixels(id, motion, frame);
  for (let y = grid.length - 1; y >= 0; y -= 1) if (grid[y].some(Boolean)) return y;
  return -1;
};
var heldCardPixels = (id, motion, frame) => pixels(id, motion, frame).flat().filter((c) => c === "#f4e7cd").length;
async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
async function selfCheck() {
  let frameFailures = [];
  let contactFailures = [];
  for (const c of CHARACTERS) {
    for (const motion of MOTION_ORDER) {
      const spec = MOTIONS[motion];
      const distinct = frameSet(c.id, motion).size;
      if (distinct < Math.ceil(spec.durations.length * 0.6)) {
        frameFailures.push(`${c.name}/${motion} \u53EA\u6709 ${distinct}/${spec.durations.length} \u5E27\u4E0D\u540C`);
      }
    }
    const rows = new Set(Array.from({ length: MOTIONS.idle.durations.length }, (_, i) => contactRow(c.id, "idle", i)));
    if (rows.size !== 1) contactFailures.push(`${c.name} \u547C\u5438\u65F6\u811A\u5E95\u5728 ${[...rows].join("/")} \u884C\u4E4B\u95F4\u6F02\u79FB`);
  }
  check("\u547C\u5438\u4E0E\u51FA\u724C\u662F\u9010\u5E27\u7ED8\u5236\uFF08\u6BCF\u52A8\u4F5C \u226560% \u5E27\u4E92\u4E0D\u76F8\u540C\uFF09", frameFailures.length === 0, frameFailures.join("\uFF1B") || `6 \u4EBA \xD7 5 \u52A8\u4F5C\u5168\u90E8\u901A\u8FC7`);
  check("\u547C\u5438\u65F6\u811A\u5E95\u63A5\u89E6\u70B9\u4E0D\u6F02", contactFailures.length === 0, contactFailures.join("\uFF1B") || "6 \u4EBA\u547C\u5438\u5E27\u7684\u6700\u5E95\u884C\u4E00\u81F4");
  const releaseIssues = [];
  for (const c of CHARACTERS) {
    const at = motionFrameAt("play", MOTIONS.play.releaseMs);
    const before = heldCardPixels(c.id, "play", at - 1);
    const after = heldCardPixels(c.id, "play", at);
    if (before - after < 8) releaseIssues.push(`${c.name} \u653E\u724C\u5E27\u624B\u91CC\u8FD8\u634F\u7740\u724C\uFF08${before} \u2192 ${after} \u4E2A\u724C\u9762\u50CF\u7D20\uFF09`);
    let moved = 0;
    const a = pixels(c.id, "play", at - 1).flat();
    const b = pixels(c.id, "play", at).flat();
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) moved += 1;
    if (moved < 80) releaseIssues.push(`${c.name} \u91CA\u653E\u5E27\u4E0E\u524D\u4E00\u5E27\u51E0\u4E4E\u4E00\u6837\uFF08${moved} \u4E2A\u50CF\u7D20\u53D8\u5316\uFF09`);
    const anchor = releaseAnchor("play");
    const hand = HAND_POS.play[at];
    if (anchor.x !== hand[0] || anchor.y !== hand[1] + 0.5) releaseIssues.push(`${c.name} \u91CA\u653E\u70B9\u4E0E\u624B\u90E8\u5750\u6807\u4E0D\u4E00\u81F4`);
  }
  check(
    "\u51FA\u724C\u91CA\u653E\u70B9 = \u91CA\u653E\u5E27\u7684\u624B\u90E8\u4E2D\u5FC3\uFF0C\u4E14\u8BE5\u5E27\u724C\u5DF2\u79BB\u624B",
    releaseIssues.length === 0,
    releaseIssues.join("\uFF1B") || `play ${MOTIONS.play.releaseMs}ms \u2192 \u7B2C ${motionFrameAt("play", MOTIONS.play.releaseMs)} \u5E27\uFF0C6 \u4EBA\u4E00\u81F4`
  );
  const silhouettes = CHARACTERS.map((c) => pixels(c.id, "idle", 0));
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
  check("\u516D\u4E2A\u89D2\u8272\u4E92\u4E0D\u76F8\u540C", minDiff > 0.08, `\u6700\u76F8\u8FD1\u7684\u4E24\u4E2A\u89D2\u8272\u4ECD\u6709 ${(minDiff * 100).toFixed(1)}% \u50CF\u7D20\u4E0D\u540C`);
  let atlasNote = "\u65E0\u6CD5\u8BFB\u53D6 atlas.png";
  try {
    const img = await loadImage(ATLAS_PNG);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const at = (x, y) => {
      const i = (y * img.width + x) * 4;
      return data[i + 3] === 0 ? null : `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
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
    check(
      "atlas.png \u4E0E\u6E90\u6A21\u5757\u9010\u50CF\u7D20\u4E00\u81F4\uFF08\u542B cell \u95F4\u8DDD\uFF09",
      mismatches === 0,
      mismatches === 0 ? `${checked} \u4E2A\u50CF\u7D20\u5168\u90E8\u4E00\u81F4 \xB7 \u56FE\u96C6 ${img.width}\xD7${img.height}` : `${mismatches}/${checked} \u4E2A\u50CF\u7D20\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u91CD\u8DD1\u56FE\u96C6\u811A\u672C`
    );
    check(
      "\u56FE\u96C6\u5C3A\u5BF8 = \u5217 \xD7 pitch \xD7 \u884C \xD7 pitch",
      img.width === COLUMNS * PITCH && img.height === ROWS * PITCH,
      `\u5B9E\u9645 ${img.width}\xD7${img.height}\uFF0C\u671F\u671B ${COLUMNS * PITCH}\xD7${ROWS * PITCH}`
    );
  } catch (error) {
    check("atlas.png \u53EF\u8BFB\u53D6", false, String(error));
  }
  try {
    const json = await (await fetch(ATLAS_JSON, { cache: "no-store" })).json();
    const same = json.cell === CELL && json.pitch === PITCH && json.gap === GAP && json.columns === COLUMNS && json.rows === ROWS && JSON.stringify(json.motions) === JSON.stringify(MOTIONS) && JSON.stringify(json.foot) === JSON.stringify(ANCHORS.foot) && JSON.stringify(json.release) === JSON.stringify(RELEASE_ANCHORS) && json.characters.map((c) => c.id).join() === CHARACTERS.map((c) => c.id).join();
    check("atlas.json \u4E0E\u6E90\u6A21\u5757\u4E00\u81F4", same, same ? "cell / pitch / \u52A8\u4F5C\u65F6\u957F / \u89D2\u8272 / \u951A\u70B9\u5168\u90E8\u543B\u5408" : "\u5143\u6570\u636E\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u91CD\u8DD1\u56FE\u96C6\u811A\u672C");
  } catch (error) {
    check("atlas.json \u53EF\u8BFB\u53D6", false, String(error));
  }
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0";
  probe.innerHTML = avatarSVG("shirley", "neutral", 1) + avatarSVG("shirley", "neutral", 2);
  document.body.append(probe);
  const sizes = [...probe.querySelectorAll(".pixel-avatar")].map((el) => Math.round(el.getBoundingClientRect().width));
  const rect1 = avatarHandRect(probe.querySelectorAll(".pixel-avatar")[0], "play");
  const rect2 = avatarHandRect(probe.querySelectorAll(".pixel-avatar")[1], "play");
  const expected = [CELL * 1, CELL * 2];
  const center1 = rect1.left + rect1.width / 2 - probe.querySelectorAll(".pixel-avatar")[0].getBoundingClientRect().left;
  const center2 = rect2.left + rect2.width / 2 - probe.querySelectorAll(".pixel-avatar")[1].getBoundingClientRect().left;
  check(
    "1x / 2x \u90FD\u662F\u6574\u6570\u500D\u7387\u4E14\u624B\u90E8\u951A\u70B9\u7B49\u6BD4",
    sizes.join() === expected.join() && Math.abs(center2 - center1 * 2) < 0.6,
    `\u6E32\u67D3\u5BBD\u5EA6 ${sizes.join(" / ")}\uFF08\u671F\u671B ${expected.join(" / ")}\uFF09\xB7 \u624B\u90E8\u4E2D\u5FC3\u504F\u79FB ${center1.toFixed(1)} / ${center2.toFixed(1)}px\uFF08\u5E94 1:2\uFF09`
  );
  probe.remove();
  const overrideStyle = document.createElement("style");
  overrideStyle.textContent = ".scale-override-probe .pixel-avatar{--avatar-scale:1}";
  document.head.append(overrideStyle);
  const overrideProbe = document.createElement("div");
  overrideProbe.className = "scale-override-probe";
  overrideProbe.style.cssText = "position:absolute;left:-9999px;top:0";
  overrideProbe.innerHTML = avatarSVG("shirley", "neutral", 2);
  document.body.append(overrideProbe);
  const overrideAvatar = overrideProbe.querySelector(".pixel-avatar");
  const overrideWidth = Math.round(overrideAvatar.getBoundingClientRect().width);
  const overrideUnit = avatarUnit(overrideAvatar);
  check(
    "\u6837\u5F0F\u8868\u53EF\u8986\u76D6\u5185\u8054\u9ED8\u8BA4\u500D\u7387\uFF08\u624B\u673A 1x \u4F9D\u8D56\u8FD9\u6761\u94FE\u8DEF\uFF09",
    overrideWidth === CELL && Math.abs(overrideUnit - 1) < 0.02,
    `\u5185\u8054\u9ED8\u8BA4 2x + \u6837\u5F0F\u8868 1x \u2192 \u5B9E\u6E32\u67D3 ${overrideWidth}px\uFF08\u671F\u671B ${CELL}\uFF09\u3001\u951A\u70B9\u500D\u7387 ${overrideUnit?.toFixed(3)}\uFF08\u671F\u671B 1.000\uFF09`
  );
  overrideProbe.remove();
  overrideStyle.remove();
  const phases = CHARACTERS.map((_, row) => breathPhase(row));
  let minGap = 1;
  for (let i = 1; i < phases.length; i += 1) minGap = Math.min(minGap, Math.abs(phases[i] - phases[i - 1]));
  const periods = CHARACTERS.map((_, row) => breathPeriod(row));
  const spread = Math.max(...periods) - Math.min(...periods);
  check(
    "\u547C\u5438\u9519\u5CF0\u6309\u5B9E\u4F8B\u751F\u6548\uFF08\u76F8\u90BB\u5EA7\u4F4D\u4E0D\u540C\u76F8\u4F4D\u3001\u5468\u671F\u53EA\u8F7B\u5FAE\u4E0D\u540C\uFF09",
    minGap >= 0.25 && spread <= 0.5 && new Set(periods.map((p) => p.toFixed(3))).size === periods.length,
    `\u76F8\u90BB\u5EA7\u4F4D\u6700\u5C0F\u76F8\u4F4D\u5DEE ${(minGap * 100).toFixed(0)}% \u5468\u671F \xB7 \u5468\u671F ${Math.min(...periods).toFixed(2)}\u2013${Math.max(...periods).toFixed(2)}s\uFF08\u8DE8\u5EA6 ${spread.toFixed(2)}s\uFF09`
  );
  const slowProbe = seats.querySelector(".seat .pixel-avatar");
  const prevFactor = slow.factor;
  slow.factor = 0.4;
  const slowPromise = run(slowProbe, "play");
  const slowAnims = actionAnimations(slowProbe);
  const ratesOk = slowAnims.length > 0 && slowAnims.every((a) => a.playbackRate === 0.4);
  await slowPromise;
  slow.factor = prevFactor;
  check(
    "\u6162\u653E \xD72.5 \u4F5C\u7528\u4E8E\u52A8\u4F5C\u65F6\u95F4\u7EBF",
    ratesOk,
    ratesOk ? `${slowAnims.length} \u6761\u52A8\u4F5C\u52A8\u753B playbackRate = 0.4\uFF08\u5355\u6B21\u51FA\u724C\u7EA6 1.6s\uFF09` : "\u6CA1\u6709\u547D\u4E2D\u52A8\u4F5C\u52A8\u753B\uFF1A\u6162\u653E\u4F1A\u5931\u6548\uFF08Element.getAnimations() \u4E0D\u542B\u540E\u4EE3\uFF09"
  );
  const prevMotion = document.documentElement.dataset.motion;
  document.documentElement.dataset.motion = "reduced";
  const card = seats.querySelector(".seat .pixel-avatar");
  const reducedPromise = playAvatar(card, "play");
  const confirmed = card.classList.contains("avatar-confirm") && card.dataset.confirm === "\u51FA\u724C";
  cancelAvatarActions();
  const cleared = !card.classList.contains("avatar-confirm") && !card.dataset.confirm;
  await reducedPromise;
  document.documentElement.dataset.motion = prevMotion ?? "standard";
  check(
    "\u51CF\u5F31\u52A8\u6001\u4ECD\u6709\u77ED\u786E\u8BA4\uFF0C\u4E14\u53D6\u6D88\u540E\u6E05\u7406\u5E72\u51C0",
    confirmed && cleared,
    `\u786E\u8BA4\u6807\u7B7E ${confirmed ? "\u5DF2\u663E\u793A" : "\u7F3A\u5931"} \xB7 \u53D6\u6D88\u540E ${cleared ? "\u65E0\u6B8B\u7559" : "\u6709\u6B8B\u7559"}`
  );
  const seq = seats.querySelector(".seat .pixel-avatar");
  await run(seq, "play");
  await run(seq, "play");
  check("\u540C\u4E00\u4EBA\u7269\u8FDE\u7EED\u51FA\u724C\u53EF\u987A\u5E8F\u8854\u63A5", !seq.dataset.action, seq.dataset.action ? `\u6B8B\u7559 data-action=${seq.dataset.action}` : "\u4E24\u6B21\u64AD\u653E\u7ED3\u675F\u4E14\u52A8\u4F5C\u5C42\u5DF2\u590D\u4F4D");
  $("selfcheck").innerHTML = checks.map((c) => `<div class="ck ${c.ok ? "ok" : "bad"}">
    <b>${c.ok ? "PASS" : "FAIL"}</b> ${c.name}<small>${c.detail}</small></div>`).join("");
  const failed = checks.filter((c) => !c.ok).length;
  $("selfcheck-summary").textContent = failed === 0 ? `\u5168\u90E8 ${checks.length} \u9879\u901A\u8FC7` : `${failed} / ${checks.length} \u9879\u672A\u901A\u8FC7`;
  $("selfcheck-summary").className = failed === 0 ? "ok" : "bad";
}
function setToggle(id, on, onLabel, offLabel) {
  const el = $(id);
  el.classList.toggle("on", on);
  el.textContent = on ? onLabel : offLabel;
}
$("slow").onclick = () => {
  slow.factor = slow.factor === 1 ? 0.4 : 1;
  setToggle("slow", slow.factor !== 1, "\u6062\u590D \xD71", "\u6162\u653E \xD72.5");
  applyBreathScale();
};
$("reduced").onclick = () => {
  const on = !reducedMotion();
  document.documentElement.dataset.motion = on ? "reduced" : "standard";
  setToggle("reduced", on, "\u6062\u590D\u6807\u51C6\u52A8\u6001", "\u51CF\u5F31\u52A8\u6001");
};
$("pause").onclick = () => {
  const idle = [...document.querySelectorAll(".avatar-idle")];
  const paused = idle[0]?.style.animationPlayState === "paused";
  idle.forEach((el) => {
    el.style.animationPlayState = paused ? "" : "paused";
  });
  setToggle("pause", !paused, "\u7EE7\u7EED\u547C\u5438", "\u6682\u505C\u547C\u5438");
};
$("anchors").onclick = () => {
  const stages = [...document.querySelectorAll(".stage")];
  const on = stages[0].dataset.anchors !== "on";
  stages.forEach((el) => {
    el.dataset.anchors = on ? "on" : "off";
  });
  setToggle("anchors", on, "\u9690\u85CF\u951A\u70B9", "\u663E\u793A\u951A\u70B9");
};
var avatarAt = (i) => document.querySelectorAll(".seat")[i].querySelector(".pixel-avatar");
$("allplay").onclick = () => {
  CHARACTERS.forEach((c, i) => setTimeout(() => void run(avatarAt(i), "play"), i * 300 * (1 / slow.factor)));
};
$("allplay6").onclick = () => {
  CHARACTERS.forEach((c, i) => void run(avatarAt(i), "win"));
};
document.addEventListener("visibilitychange", () => {
  document.documentElement.classList.toggle("page-hidden", document.hidden);
});
void selfCheck();
