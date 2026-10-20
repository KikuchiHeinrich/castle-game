/**
 * 统一的"可取消计时器"登记簿。
 *
 * 演出层里的 setTimeout 分两类：等待（resolve 一个 Promise 让流程继续）与收尾
 * （移除 class / 隐藏节点）。两类都必须在离开牌桌、重连、事件缺口或回合推进时被清掉，
 * 否则会留下"退出后仍在跑的计时器"和"永远不 resolve 的等待"。
 * 登记在一起后，取消时先 clearTimeout，再立刻执行登记的回调：等待中的 Promise 能结束，
 * 收尾动作也不用等超时。
 */
export type TimerHandle = ReturnType<typeof setTimeout>;

export class TimerRegistry {
  private timers = new Map<TimerHandle, () => void>();

  /** 登记一个超时：到点执行 run；被取消时同样执行 run（收尾 + 结算等待） */
  set(ms: number, run: () => void): TimerHandle {
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      run();
    }, ms);
    this.timers.set(handle, run);
    return handle;
  }

  /** 取消单个超时：未登记或已触发/已取消时返回 false，不会重复执行回调 */
  cancel(handle: TimerHandle): boolean {
    const run = this.timers.get(handle);
    if (run === undefined) return false;
    this.timers.delete(handle);
    clearTimeout(handle);
    run();
    return true;
  }

  /** 取消全部：先停表，再逐个收尾 / 结算 */
  cancelAll(): void {
    for (const [handle, run] of [...this.timers]) {
      this.timers.delete(handle);
      clearTimeout(handle);
      run();
    }
  }

  get size(): number {
    return this.timers.size;
  }
}
