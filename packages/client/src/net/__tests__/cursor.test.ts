import { describe, expect, it } from 'vitest';
import type { PlayerView } from '../../../../shared/src/index';
import { planViewCursor } from '../cursor';

/** 只关心游标相关字段，其余用最小占位，避免把测试绑死在完整视图结构上 */
const view = (over: Partial<PlayerView> = {}): PlayerView =>
  ({ code: 'A1B2', eventSeq: 0, roundNo: 1, ...over }) as PlayerView;

describe('planViewCursor：快照如何改动事件游标', () => {
  it('正常广播、同房、序号前进：不动游标、不重置演出', () => {
    const prev = view({ eventSeq: 7 });
    const plan = planViewCursor(prev, view({ eventSeq: 9 }), 7);
    expect(plan).toEqual({ lastEventSeq: 7, reset: false, reason: null });
  });

  it('正常广播、序号与游标持平（事件先行、快照随后）：不重置演出', () => {
    const plan = planViewCursor(view({ eventSeq: 12 }), view({ eventSeq: 12 }), 12);
    expect(plan.reset).toBe(false);
    expect(plan.lastEventSeq).toBe(12);
  });

  it('换房：接管游标并清空队列（防串房）', () => {
    const plan = planViewCursor(view({ code: 'A1B2', eventSeq: 40 }), view({ code: 'C3D4', eventSeq: 3 }), 40);
    expect(plan).toEqual({ lastEventSeq: 3, reset: true, reason: 'room' });
  });

  it('第一次收到快照（没有前一份视图）：接管游标并清空队列', () => {
    const plan = planViewCursor(null, view({ eventSeq: 5 }), 0);
    expect(plan).toEqual({ lastEventSeq: 5, reset: true, reason: 'room' });
  });

  it('序号回退：接管游标并清空队列', () => {
    const plan = planViewCursor(view({ eventSeq: 30 }), view({ eventSeq: 4 }), 30);
    expect(plan).toEqual({ lastEventSeq: 4, reset: true, reason: 'rewound' });
  });

  it('回合回退（重开对局）：即使序号更大也要清空队列', () => {
    const plan = planViewCursor(view({ eventSeq: 38, roundNo: 3 }), view({ eventSeq: 41, roundNo: 1 }), 38);
    expect(plan).toEqual({ lastEventSeq: 41, reset: true, reason: 'round' });
  });

  it('重连同房：游标明确设到快照序号，下一个真实动作不会被判成缺口', () => {
    const last = 20;
    const snapshot = view({ eventSeq: 34, roundNo: 4 });
    const plan = planViewCursor(view({ eventSeq: last, roundNo: 4 }), snapshot, last, 'rejoin');
    expect(plan).toEqual({ lastEventSeq: 34, reset: true, reason: 'rejoin' });
    // 重连之后的第一个真实事件：seq = 快照 + 1，必须不被当成 gap
    const gap = 35 > plan.lastEventSeq + 1;
    expect(gap).toBe(false);
  });

  it('重连时快照序号与本地一致：同样以快照为基线（不重播历史）', () => {
    const plan = planViewCursor(view({ eventSeq: 12 }), view({ eventSeq: 12 }), 12, 'rejoin');
    expect(plan).toEqual({ lastEventSeq: 12, reset: true, reason: 'rejoin' });
  });

  it('重连时快照序号更小（服务端重开过对局）：仍以快照为基线，之后的事件不会被判成过期', () => {
    const plan = planViewCursor(view({ eventSeq: 42, roundNo: 5 }), view({ eventSeq: 1, roundNo: 1 }), 42, 'rejoin');
    expect(plan).toEqual({ lastEventSeq: 1, reset: true, reason: 'rejoin' });
    // 第一条真实动作 seq = 2：既不是过期事件，也不被判成缺口
    expect(2 <= plan.lastEventSeq).toBe(false);
    expect(2 > plan.lastEventSeq + 1).toBe(false);
  });
});
