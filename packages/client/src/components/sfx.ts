/**
 * 8bit 音效：Web Audio API 程序化合成（方波/三角波 + 噪声），零素材。
 * AudioContext 在首次用户手势时创建（浏览器自动播放策略）。
 * 顶栏 🔊/🔇 开关，状态存 localStorage。
 */

let ctx: AudioContext | null = null;
let muted = localStorage.getItem('castle.mute') === '1';

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  localStorage.setItem('castle.mute', muted ? '1' : '0');
  return muted;
}

/** 首次手势时调用一次，解锁音频 */
export function initAudio() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) return null;
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  when?: number; // 相对当前时间的秒
  slide?: number; // 频率滑变目标差值
}

function tone(freq: number, dur: number, opts: ToneOpts = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + (opts.when ?? 0);
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = opts.type ?? 'square';
  o.frequency.setValueAtTime(Math.max(30, freq), t);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + opts.slide), t + dur);
  g.gain.setValueAtTime(opts.vol ?? 0.05, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.03);
}

function noise(dur: number, vol = 0.04, when = 0) {
  const a = ac();
  if (!a) return;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  const g = a.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(g);
  g.connect(a.destination);
  src.start(a.currentTime + when);
}

export const sfx = {
  deal() {
    noise(0.07, 0.05);
  },
  play() {
    tone(520, 0.06, { vol: 0.05 });
    tone(700, 0.05, { when: 0.055, vol: 0.045 });
  },
  add() {
    tone(460, 0.05, { vol: 0.05 });
  },
  chip() {
    tone(900, 0.05, { type: 'triangle', vol: 0.06 });
    tone(1350, 0.07, { when: 0.05, type: 'triangle', vol: 0.05 });
  },
  fold() {
    tone(190, 0.16, { slide: -110, vol: 0.06 });
  },
  flip() {
    tone(560, 0.05, { slide: 320, vol: 0.04 });
  },
  agree() {
    tone(660, 0.07, { vol: 0.05 });
    tone(990, 0.1, { when: 0.07, vol: 0.05 });
  },
  click() {
    tone(780, 0.035, { vol: 0.04 });
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.13, { when: i * 0.09, vol: 0.06 }));
  },
  lose() {
    [420, 320, 230].forEach((f, i) => tone(f, 0.15, { when: i * 0.11, vol: 0.05 }));
  },
  tick() {
    tone(1050, 0.03, { vol: 0.03 });
  },
  horn() {
    tone(330, 0.28, { vol: 0.06 });
    tone(440, 0.34, { when: 0.2, vol: 0.06 });
    tone(550, 0.4, { when: 0.42, vol: 0.06 });
  },
  type() {
    tone(1150, 0.012, { vol: 0.012, type: 'square' });
  },
};

// 首次手势解锁
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => initAudio(), { once: true, capture: true });
}
