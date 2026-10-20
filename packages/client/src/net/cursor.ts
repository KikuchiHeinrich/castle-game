import type { PlayerView } from '../../../shared/src/index';

/** broadcast = 服务端正常广播的快照（commit 里事件先行）；rejoin = 重连补发的基线快照 */
export type ViewApplyMode = 'broadcast' | 'rejoin';

export interface CursorPlan {
  /** 应当写入本地的事件游标 */
  lastEventSeq: number;
  /** 是否要清空在途演出（resetQueue） */
  reset: boolean;
  /** 触发重置的原因，便于排查与回归测试 */
  reason: 'room' | 'rewound' | 'round' | 'rejoin' | null;
}

/**
 * 决定一份新快照如何改动本地事件游标。
 *
 * 服务端 host.commit() 先广播 game:event、再广播 room:state，所以正常广播带回来的
 * 快照里 eventSeq 与客户端游标一致：这时**不能**重置演出，否则正在播的动作每次都会被
 * 紧随其后的快照打断。只有换房（防串房）、序号回退、回合回退，以及重连补发的基线快照
 * 才接管游标并清队列。
 */
export function planViewCursor(
  prev: PlayerView | null,
  next: PlayerView,
  lastEventSeq: number,
  mode: ViewApplyMode = 'broadcast',
): CursorPlan {
  // 重连：服务端只按最新快照落地、不补播历史，所以这里明确把游标设到快照处，
  // 下一个真实动作（snapshot.seq + 1）才不会被判成事件缺口而整段丢掉。
  if (mode === 'rejoin') return { lastEventSeq: next.eventSeq, reset: true, reason: 'rejoin' };
  if (!prev || prev.code !== next.code) return { lastEventSeq: next.eventSeq, reset: true, reason: 'room' };
  if (next.eventSeq < lastEventSeq) return { lastEventSeq: next.eventSeq, reset: true, reason: 'rewound' };
  if ((prev.roundNo ?? 0) > (next.roundNo ?? 0)) return { lastEventSeq: next.eventSeq, reset: true, reason: 'round' };
  return { lastEventSeq, reset: false, reason: null };
}
