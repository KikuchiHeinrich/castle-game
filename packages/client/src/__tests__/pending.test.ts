import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimerRegistry } from '../pending';

afterEach(() => {
  vi.useRealTimers();
});

describe('TimerRegistry：统一追踪的计时器', () => {
  it('正常到点只执行一次，且不再残留登记', () => {
    vi.useFakeTimers();
    const timers = new TimerRegistry();
    let runs = 0;
    timers.set(10, () => {
      runs += 1;
    });
    expect(timers.size).toBe(1);
    vi.advanceTimersByTime(10);
    expect(runs).toBe(1);
    expect(timers.size).toBe(0);
    timers.cancelAll();
    expect(runs).toBe(1);
  });

  it('cancel 单个超时会立刻执行它的收尾（撤销座位高亮）', () => {
    vi.useFakeTimers();
    const timers = new TimerRegistry();
    const classes = new Set(['fx-return']);
    const handle = timers.set(900, () => classes.delete('fx-return'));
    expect(timers.cancel(handle)).toBe(true);
    expect(classes.has('fx-return')).toBe(false);
    // 幂等：已取消 / 已触发的登记再取消不会重复执行
    expect(timers.cancel(handle)).toBe(false);
    vi.advanceTimersByTime(900);
    expect(timers.size).toBe(0);
  });

  it('cancelAll 立刻执行所有未到点的收尾，不需要等超时', () => {
    vi.useFakeTimers();
    const timers = new TimerRegistry();
    let closed = 0;
    timers.set(5000, () => {
      closed += 1;
    });
    timers.set(9000, () => {
      closed += 1;
    });
    timers.cancelAll();
    expect(closed).toBe(2);
    expect(timers.size).toBe(0);
  });

  it('取消时结算等待中的 Promise：演出流程不会永远挂着', async () => {
    vi.useFakeTimers();
    const timers = new TimerRegistry();
    let finished = false;
    const waiting = new Promise<void>((resolve) =>
      timers.set(60_000, () => {
        finished = true;
        resolve();
      }),
    );
    timers.cancelAll();
    await waiting; // 没有结算的话这里会一直挂住
    expect(finished).toBe(true);
    expect(timers.size).toBe(0);
  });
});
