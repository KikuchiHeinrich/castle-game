/**
 * 音效：优先播放 Kingslayer 素材里的真实音效，素材未就绪或缺失时回落到
 * Web Audio 程序化合成（方波/三角波 + 噪声），保证任何情况下都有反馈。
 * AudioContext 在首次用户手势时创建（浏览器自动播放策略）。
 * 顶栏 🔊/🔇 开关，状态存 localStorage。
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = localStorage.getItem('castle.mute') === '1';

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  localStorage.setItem('castle.mute', muted ? '1' : '0');
  if (master) master.gain.value = muted ? 0 : 1;
  return muted;
}

/** 首次手势时调用一次，解锁音频并开始后台预载素材 */
export function initAudio() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
    } catch {
      return;
    }
    void preloadAll();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function ac(): AudioContext | null {
  if (muted || !ctx) return null;
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// ============ 素材音效 ============

/** 素材名 → 音频文件（Kingslayer assets/audio 精选，见 scripts/README-art.md） */
const SAMPLES: Record<string, string> = {
  click: '/king/sfx/click.mp3',
  draw: '/king/sfx/card_draw.mp3',
  shuffle: '/king/sfx/cards_shuffle.mp3',
  tap: '/king/sfx/tap.mp3',
  page: '/king/sfx/paging.mp3',
  pageLong: '/king/sfx/paging_long.mp3',
  thud: '/king/sfx/wood_hit.wav',
  clang: '/king/sfx/metal_bars.wav',
  gameOver: '/king/sfx/game_over.mp3',
  gameEnd: '/king/sfx/game_end.mp3',
};

const buffers = new Map<string, AudioBuffer>();
const loading = new Set<string>();

async function loadSample(key: string): Promise<void> {
  if (buffers.has(key) || loading.has(key) || !ctx) return;
  loading.add(key);
  try {
    const res = await fetch(SAMPLES[key]);
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    buffers.set(key, buf);
  } catch {
    /* 拿不到就继续用合成兜底 */
  } finally {
    loading.delete(key);
  }
}

function preloadAll(): Promise<void> {
  return Promise.all(Object.keys(SAMPLES).map(loadSample)).then(() => undefined);
}

/** 播放素材；未就绪返回 false，由调用方回落到合成音 */
function sample(key: string, vol = 1, rate = 1, when = 0): boolean {
  const a = ac();
  const buf = buffers.get(key);
  if (!a || !buf || !master) {
    void loadSample(key);
    return false;
  }
  const src = a.createBufferSource();
  const g = a.createGain();
  src.buffer = buf;
  src.playbackRate.value = rate;
  g.gain.value = vol;
  src.connect(g);
  g.connect(master);
  src.start(a.currentTime + when);
  return true;
}

// ============ 合成兜底 ============

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  when?: number; // 相对当前时间的秒
  slide?: number; // 频率滑变目标差值
}

function tone(freq: number, dur: number, opts: ToneOpts = {}) {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + (opts.when ?? 0);
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = opts.type ?? 'square';
  o.frequency.setValueAtTime(Math.max(30, freq), t);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + opts.slide), t + dur);
  g.gain.setValueAtTime(opts.vol ?? 0.05, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.03);
}

function noise(dur: number, vol = 0.04, when = 0) {
  const a = ac();
  if (!a || !master) return;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  const g = a.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(g);
  g.connect(master);
  src.start(a.currentTime + when);
}

// ============ 对外接口 ============

export const sfx = {
  /** 洗牌：回合开始 */
  shuffle() {
    if (!sample('shuffle', 0.7)) noise(0.22, 0.05);
  },
  /** 单张发牌 */
  deal() {
    if (!sample('draw', 0.6)) noise(0.07, 0.05);
  },
  /** 出牌：木响 */
  play() {
    if (!sample('thud', 0.75)) {
      tone(520, 0.06, { vol: 0.05 });
      tone(700, 0.05, { when: 0.055, vol: 0.045 });
    }
  },
  /** 加牌 */
  add() {
    if (!sample('draw', 0.55)) tone(460, 0.05, { vol: 0.05 });
  },
  /** 筹码：轻叩 */
  chip() {
    if (!sample('tap', 0.7)) {
      tone(900, 0.05, { type: 'triangle', vol: 0.06 });
      tone(1350, 0.07, { when: 0.05, type: 'triangle', vol: 0.05 });
    }
  },
  /** 弃牌：下滑音（素材里没有对应的，保持合成） */
  fold() {
    tone(190, 0.16, { slide: -110, vol: 0.06 });
  },
  /** 翻面 / 换页 */
  flip() {
    if (!sample('page', 0.7)) tone(560, 0.05, { slide: 320, vol: 0.04 });
  },
  /** 长翻页：摊牌逐张揭示 */
  flipLong() {
    if (!sample('pageLong', 0.7)) tone(560, 0.05, { slide: 320, vol: 0.04 });
  },
  agree() {
    if (!sample('tap', 0.55, 1.25)) {
      tone(660, 0.07, { vol: 0.05 });
      tone(990, 0.1, { when: 0.07, vol: 0.05 });
    }
  },
  click() {
    if (!sample('click', 0.55)) tone(780, 0.035, { vol: 0.04 });
  },
  win() {
    if (!sample('gameEnd', 0.85)) [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.13, { when: i * 0.09, vol: 0.06 }));
  },
  lose() {
    if (!sample('gameOver', 0.8)) [420, 320, 230].forEach((f, i) => tone(f, 0.15, { when: i * 0.11, vol: 0.05 }));
  },
  tick() {
    tone(1050, 0.03, { vol: 0.03 });
  },
  /** 教官裁定：金属撞击 */
  horn() {
    if (!sample('clang', 0.8)) {
      tone(330, 0.28, { vol: 0.06 });
      tone(440, 0.34, { when: 0.2, vol: 0.06 });
      tone(550, 0.4, { when: 0.42, vol: 0.06 });
    }
  },
  /** 打字机滴答：极短极轻，用素材会太吵，保持合成 */
  type() {
    tone(1150, 0.012, { vol: 0.012, type: 'square' });
  },
};

// 首次手势解锁
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => initAudio(), { once: true, capture: true });
}
