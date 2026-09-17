import { Card, SUIT_CHARS, RANK_CHARS } from './types';

/** mulberry32：确定性 RNG，状态就是一个 uint32，可放进 Secret 做纯函数重放 */
export function rngNext(state: number): { v: number; next: number } {
  let s = (state + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const v = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { v, next: s };
}

export function rngInt(state: number, maxExclusive: number): { v: number; next: number } {
  const r = rngNext(state);
  return { v: Math.floor(r.v * maxExclusive), next: r.next };
}

export function shuffle<T>(arr: T[], seed: number): { arr: T[]; seed: number } {
  let s = seed;
  for (let i = arr.length - 1; i > 0; i--) {
    const r = rngInt(s, i + 1);
    s = r.next;
    const j = r.v;
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return { arr, seed: s };
}

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (let suit = 0 as Card['suit']; suit <= 3; suit = (suit + 1) as Card['suit']) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ id: `${SUIT_CHARS[suit]}${RANK_CHARS[rank]}`, suit, rank });
    }
  }
  return deck;
}

/** 服务端开局用的随机种子（引擎内部只依赖种子，保持确定性可测） */
export function randomSeed(): number {
  return (Math.floor(Math.random() * 0x1_0000_0000) ^ Date.now()) >>> 0;
}
