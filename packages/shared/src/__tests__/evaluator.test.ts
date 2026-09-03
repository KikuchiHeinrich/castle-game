import { describe, expect, it } from 'vitest';
import { Card, compareHandValue, SUIT_CHARS, RANK_CHARS } from '../types';
import { evaluateSubset, bestHand } from '../evaluator';
import { buildDeck } from '../deck';

const SUIT_OF: Record<string, number> = { d: 0, h: 1, c: 2, s: 3 };

/** 测试辅助：C('s','A') → 黑桃A，C('h',10) → 红桃10 */
function C(s: 'd' | 'h' | 'c' | 's', r: number | string): Card {
  const suit = SUIT_OF[s] as Card['suit'];
  const rank = typeof r === 'string' ? (RANK_CHARS.indexOf(r as never) as number) : r;
  if (rank < 1 || rank > 13) throw new Error(`bad rank ${r}`);
  return { id: `${SUIT_CHARS[suit]}${RANK_CHARS[rank]}`, suit, rank };
}

const hv = (cards: Card[]) => evaluateSubset(cards)!;

describe('22 种牌型识别', () => {
  const cases: [number, string, Card[]][] = [
    [22, '暴君(六同花顺)', [C('s', 3), C('s', 4), C('s', 5), C('s', 6), C('s', 7), C('s', 8)]],
    [21, '使徒(4+2)', [C('h', 'K'), C('d', 'K'), C('s', 'K'), C('c', 'K'), C('h', 9), C('d', 9)]],
    [20, '龙王(3+3)', [C('h', 5), C('d', 5), C('s', 5), C('h', 'Q'), C('d', 'Q'), C('s', 'Q')]],
    [19, '皇帝(五同花顺)', [C('d', 7), C('d', 8), C('d', 9), C('d', 10), C('d', 'J')]],
    [18, '正义(三连对)', [C('s', 6), C('h', 6), C('c', 7), C('d', 7), C('s', 8), C('h', 8)]],
    [17, '贤者(四条)', [C('h', 3), C('d', 3), C('s', 3), C('c', 3), C('h', 'K')]],
    [16, '灾难(六同花)', [C('c', 2), C('c', 5), C('c', 9), C('c', 'J'), C('c', 'K'), C('c', 'A')]],
    [15, '魔导(六顺)', [C('s', 4), C('h', 5), C('d', 6), C('s', 7), C('c', 8), C('h', 9)]],
    [14, '公爵(四同花顺)', [C('h', 5), C('h', 6), C('h', 7), C('h', 8)]],
    [13, '大剑(三对)', [C('s', 2), C('h', 2), C('c', 6), C('d', 6), C('s', 'K'), C('h', 'K')]],
    [12, '龙(葫芦)', [C('h', 8), C('s', 8), C('d', 8), C('c', 'A'), C('s', 'A')]],
    [11, '海啸(五同花)', [C('d', 2), C('d', 6), C('d', 9), C('d', 'Q'), C('d', 'K')]],
    [10, '博士(五顺)', [C('s', 5), C('h', 6), C('c', 7), C('d', 8), C('s', 9)]],
    [9, '领主(三同花顺)', [C('c', 9), C('c', 10), C('c', 'J')]],
    [8, '骑士(三条)', [C('s', 7), C('h', 7), C('d', 7), C('c', 2)]],
    [7, '学者(四顺)', [C('s', 8), C('h', 9), C('d', 10), C('s', 'J'), C('c', 3)]],
    [6, '洪水(四同花)', [C('h', 2), C('h', 5), C('h', 9), C('h', 'K'), C('s', 4)]],
    [5, '双剑(两对)', [C('s', 'A'), C('h', 'A'), C('c', 4), C('d', 4), C('s', 8)]],
    [4, '术士(三顺)', [C('s', 3), C('h', 4), C('d', 5), C('c', 'K')]],
    [3, '浪花(三同花)', [C('d', 7), C('d', 'Q'), C('d', 'K')]],
    [2, '单剑(一对)', [C('s', 9), C('c', 9), C('h', 2)]],
    [1, '散兵(高牌)', [C('s', 2), C('h', 5), C('d', 9)]],
  ];
  for (const [rank, label, cards] of cases) {
    it(`识别 ${label}`, () => {
      expect(hv(cards).typeRank).toBe(rank);
    });
  }

  it('每种牌型带杂牌时 junk 正确且分类不变', () => {
    // 单剑 + 3 张杂牌 → junk 3
    const pair = hv([C('s', 9), C('c', 9), C('h', 2), C('d', 5), C('s', 7)]);
    expect(pair.typeRank).toBe(2);
    expect(pair.junk).toBe(3);
    // 公爵 + 2 张杂牌
    const sf4 = hv([C('h', 5), C('h', 6), C('h', 7), C('h', 8), C('s', 2), C('d', 3)]);
    expect(sf4.typeRank).toBe(14);
    expect(sf4.junk).toBe(2);
  });
});

describe('A 高低顺', () => {
  it('A2345 是三顺，最大牌取 5', () => {
    const s = hv([C('s', 'A'), C('h', 2), C('d', 3), C('s', 4), C('c', 5)]);
    expect(s.typeRank).toBe(10);
    expect(s.keyRank).toBe(5);
  });
  it('10JQKA 是五顺，最大牌是 A(14)', () => {
    const s = hv([C('s', 10), C('h', 'J'), C('d', 'Q'), C('s', 'K'), C('c', 'A')]);
    expect(s.typeRank).toBe(10);
    expect(s.keyRank).toBe(14);
  });
  it('23456 胜 A2345', () => {
    const low = hv([C('s', 'A'), C('h', 2), C('d', 3), C('s', 4), C('c', 5)]);
    const mid = hv([C('s', 2), C('h', 3), C('d', 4), C('s', 5), C('c', 6)]);
    expect(compareHandValue(mid, low)).toBeGreaterThan(0);
  });
  it('A2345 同点数比 5 的花色', () => {
    const hi5 = hv([C('s', 'A'), C('h', 2), C('d', 3), C('h', 4), C('s', 5)]); // 5♠
    const lo5 = hv([C('d', 'A'), C('h', 2), C('d', 3), C('h', 4), C('d', 5)]); // 5♦
    expect(compareHandValue(hi5, lo5)).toBeGreaterThan(0);
  });
  it('A23456 六顺（A 低六连）', () => {
    const s = hv([C('s', 'A'), C('h', 2), C('d', 3), C('s', 4), C('c', 5), C('h', 6)]);
    expect(s.typeRank).toBe(15);
    expect(s.keyRank).toBe(6);
  });
  it('无 A 时顺子照常', () => {
    expect(hv([C('s', 8), C('h', 9), C('d', 10)]).typeRank).toBe(4);
  });
});

describe('同花顺族', () => {
  it('3/4/5/6 张分别落领主/公爵/皇帝/暴君', () => {
    expect(hv([C('s', 5), C('s', 6), C('s', 7)]).typeRank).toBe(9);
    expect(hv([C('s', 5), C('s', 6), C('s', 7), C('s', 8)]).typeRank).toBe(14);
    expect(hv([C('s', 5), C('s', 6), C('s', 7), C('s', 8), C('s', 9)]).typeRank).toBe(19);
    expect(hv([C('s', 5), C('s', 6), C('s', 7), C('s', 8), C('s', 9), C('s', 10)]).typeRank).toBe(22);
  });
  it('非同花的顺子不成同花顺', () => {
    expect(hv([C('s', 5), C('h', 6), C('s', 7)]).typeRank).toBe(4);
  });
});

describe('点数族与构成选择', () => {
  it('667788 判三连对（正义），6677 99 判三对（大剑）', () => {
    expect(hv([C('s', 6), C('h', 6), C('s', 7), C('h', 7), C('s', 8), C('h', 8)]).typeRank).toBe(18);
    expect(hv([C('s', 6), C('h', 6), C('s', 7), C('h', 7), C('s', 9), C('h', 9)]).typeRank).toBe(13);
  });
  it('四条带杂牌是贤者，四条带一对是使徒', () => {
    expect(hv([C('h', 3), C('d', 3), C('s', 3), C('c', 3), C('h', 'K'), C('s', 9)]).typeRank).toBe(17);
    expect(hv([C('h', 3), C('d', 3), C('s', 3), C('c', 3), C('h', 'K'), C('s', 'K')]).typeRank).toBe(21);
  });
  it('同为一对，纯的对子胜杂牌对子（掺水）', () => {
    const pure = hv([C('s', 'A'), C('h', 'A')]);
    const dirty = hv([C('s', 'A'), C('h', 'A'), C('d', 3)]);
    expect(compareHandValue(pure, dirty)).toBeGreaterThan(0);
  });
  it('同为高牌比最大牌', () => {
    const a = hv([C('s', 'K'), C('h', 3)]);
    const b = hv([C('s', 'Q'), C('h', 'J')]);
    expect(compareHandValue(a, b)).toBeGreaterThan(0);
  });
  it('同点数比花色：黑桃>梅花>红桃>方片', () => {
    const s = hv([C('s', 'A'), C('h', 5)]);
    const c = hv([C('c', 'A'), C('h', 5)]);
    const h = hv([C('h', 'A'), C('d', 5)]);
    const d = hv([C('d', 'A'), C('h', 5)]);
    expect(compareHandValue(s, c)).toBeGreaterThan(0);
    expect(compareHandValue(c, h)).toBeGreaterThan(0);
    expect(compareHandValue(h, d)).toBeGreaterThan(0);
  });
  it('两对以较大的对子做最大牌，其余为杂牌', () => {
    const got = hv([C('s', 2), C('h', 2), C('c', 5), C('d', 5), C('s', 'K'), C('h', 3)]);
    expect(got.typeRank).toBe(5);
    expect(got.keyRank).toBe(5);
    expect(got.junk).toBe(2);
  });
  it('三对（大剑）取点数最高的对子做最大牌', () => {
    const got = hv([C('s', 2), C('h', 2), C('c', 5), C('d', 5), C('s', 'K'), C('h', 'K')]);
    expect(got.typeRank).toBe(13);
    expect(got.keyRank).toBe(13);
  });
});

describe('bestHand 子集枚举', () => {
  it('从出战区挑出元组最大的构成', () => {
    // 6 张里同时有两套花色的四同花顺：黑桃那套更大
    const cards = [C('s', 5), C('s', 6), C('s', 7), C('s', 8), C('h', 5), C('h', 6)];
    const got = bestHand(cards)!;
    expect(got.typeRank).toBe(14); // 公爵
    expect(got.keySuit).toBe(3); // 黑桃
  });
  it('一对会丢弃杂牌构成纯对子', () => {
    const got = bestHand([C('s', 'A'), C('h', 'A'), C('d', 9), C('c', 'J'), C('h', 5), C('s', 8)])!;
    expect(got.typeRank).toBe(2);
    expect(got.junk).toBe(0);
  });
  it('6 张同花会取六同花而非五同花', () => {
    const cards = [C('d', 2), C('d', 5), C('d', 7), C('d', 9), C('d', 'J'), C('d', 'K')];
    expect(bestHand(cards)!.typeRank).toBe(16);
  });
  it('空牌组返回 null', () => {
    expect(bestHand([])).toBeNull();
    expect(evaluateSubset([])).toBeNull();
    expect(evaluateSubset([C('s', 2), C('h', 3), C('d', 4), C('s', 5), C('h', 6), C('d', 7), C('c', 8)])).toBeNull();
  });
});

describe('性质测试', () => {
  it('任意两张不相交的出战区，比较结果永不为 0（严格全序）', () => {
    let seed = 42;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 2000; i++) {
      const deck = buildDeck();
      // 洗牌后各抽 6 张
      for (let j = deck.length - 1; j > 0; j--) {
        const k = Math.floor(rng() * (j + 1));
        [deck[j], deck[k]] = [deck[k], deck[j]];
      }
      const a = deck.slice(0, 6);
      const b = deck.slice(6, 12);
      const cmp = compareHandValue(bestHand(a)!, bestHand(b)!);
      expect(cmp).not.toBe(0);
    }
  });
  it('bestHand 与全子集暴力枚举一致（对随机场）', () => {
    let seed = 7;
    const rng = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 300; i++) {
      const deck = buildDeck();
      for (let j = deck.length - 1; j > 0; j--) {
        const k = Math.floor(rng() * (j + 1));
        [deck[j], deck[k]] = [deck[k], deck[j]];
      }
      const field = deck.slice(0, 6);
      const got = bestHand(field)!;
      // 全子集枚举验证：不存在比 got 更大的子集牌型
      for (let mask = 1; mask < 64; mask++) {
        const sub: Card[] = [];
        for (let b = 0; b < 6; b++) if (mask & (1 << b)) sub.push(field[b]);
        const hv2 = evaluateSubset(sub)!;
        expect(compareHandValue(hv2, got)).toBeLessThanOrEqual(0);
      }
      // used 牌必须是子集的成员
      const ids = new Set(field.map((c) => c.id));
      for (const id of got.usedIds) expect(ids.has(id)).toBe(true);
    }
  });
});
