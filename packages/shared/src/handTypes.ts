import { HandValue } from './types';

/**
 * 22 种牌型总表（位次 1 最小，22 最大——设计者手工排定，刻意非单调：
 * 如四条(4张) > 六同花(6张)。顺序请勿调整！
 * size = 该牌型恰好需要的牌数；高牌特殊：任意张数，牌型用牌只有最大的一张。
 */
export interface HandTypeDef {
  rank: number; // 1..22
  name: string; // 牌型名
  alias: string; // 别称
  size: number; // 所需牌数（0 = 任意）
}

export const HAND_TYPES: HandTypeDef[] = [
  { rank: 1, name: '高牌', alias: '散兵', size: 1 },
  { rank: 2, name: '一对', alias: '单剑', size: 2 },
  { rank: 3, name: '三同花', alias: '浪花', size: 3 },
  { rank: 4, name: '三顺', alias: '术士', size: 3 },
  { rank: 5, name: '两对', alias: '双剑', size: 4 },
  { rank: 6, name: '四同花', alias: '洪水', size: 4 },
  { rank: 7, name: '四顺', alias: '学者', size: 4 },
  { rank: 8, name: '三条', alias: '骑士', size: 3 },
  { rank: 9, name: '三同花顺', alias: '领主', size: 3 },
  { rank: 10, name: '五顺', alias: '博士', size: 5 },
  { rank: 11, name: '五同花', alias: '海啸', size: 5 },
  { rank: 12, name: '葫芦', alias: '龙', size: 5 },
  { rank: 13, name: '三对', alias: '大剑', size: 6 },
  { rank: 14, name: '四同花顺', alias: '公爵', size: 4 },
  { rank: 15, name: '六顺', alias: '魔导', size: 6 },
  { rank: 16, name: '六同花', alias: '灾难', size: 6 },
  { rank: 17, name: '四条', alias: '贤者', size: 4 },
  { rank: 18, name: '三连对', alias: '正义', size: 6 },
  { rank: 19, name: '五同花顺', alias: '皇帝', size: 5 },
  { rank: 20, name: '3+3', alias: '龙王', size: 6 },
  { rank: 21, name: '4+2', alias: '使徒', size: 6 },
  { rank: 22, name: '六同花顺', alias: '暴君', size: 6 },
];

export function handType(rank: number): HandTypeDef {
  return HAND_TYPES[rank - 1];
}

export function makeHandValue(typeRank: number, junk: number, keyRank: number, keySuit: number, usedIds: string[]): HandValue {
  const def = handType(typeRank);
  return { typeRank, junk, keyRank, keySuit: keySuit as HandValue['keySuit'], usedIds, name: def.name, alias: def.alias };
}
