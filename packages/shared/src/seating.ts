import { GameState, Player } from './types';

/** 座位以 +1 方向为逆时针轮转方向（前端按此顺序围绕桌面布置座位） */
export function allPlayers(s: GameState): Player[] {
  return s.players.filter((p): p is Player => p !== null);
}

export function getPlayer(s: GameState, seat: number): Player | null {
  return s.players[seat] ?? null;
}

/** 本回合的"投票者"：未弃牌且未防守的活跃玩家 */
export function voters(s: GameState): Player[] {
  return allPlayers(s).filter((p) => p.status === 'active');
}

/** 存活玩家（未淘汰），用于备战发牌与终局判定 */
export function survivors(s: GameState): Player[] {
  return allPlayers(s).filter((p) => p.status !== 'out');
}

/** 从 from 起逆时针找第一个满足 pred 的座位（不含 from 自身），找不到返回 null */
export function nextSeatFrom(s: GameState, from: number, pred: (p: Player) => boolean): number | null {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (from + i) % n;
    const p = s.players[seat];
    if (p && pred(p)) return seat;
  }
  return null;
}

/** 轮转中的下一个行动者（未弃牌未防守的活跃玩家） */
export function nextVoter(s: GameState, from: number): number | null {
  return nextSeatFrom(s, from, (p) => p.status === 'active');
}
