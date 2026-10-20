import { afterEach, describe, expect, it, vi } from 'vitest';
import { addPlayer, applyAction, createGameState, startGame } from '../../../shared/src/index';
import { BotDriver } from '../bots';
import type { Room } from '../rooms';

afterEach(() => {
  vi.useRealTimers();
});

describe('结算机器人', () => {
  it('等待可读的延迟后准备；全员准备后推进下一回合', () => {
    vi.useFakeTimers();
    let state = createGameState('BOT1');
    addPlayer(state, '真人');
    const bot = addPlayer(state, '电脑', true);
    if (!bot.ok) throw new Error(bot.error);
    const started = startGame(state, 0, 7, 1_000_000);
    if (!started.ok) throw new Error(started.error);
    state = started.state;
    state.round!.phase = 'settlement';
    state.round!.deadlineAt = 0;
    state.players[0]!.nextReady = true;
    state.players[bot.seat]!.nextReady = false;

    const room = { code: 'BOT1', state } as Room;
    const driver = new BotDriver((target, seat, action) => {
      const res = applyAction(target.state, seat, action, 1_003_000);
      if (!res.ok) throw new Error(res.error);
      target.state = res.state;
    }, () => 0);

    driver.kick(room);
    vi.advanceTimersByTime(2_499);
    expect(room.state.round!.roundNo).toBe(1);
    expect(room.state.players[bot.seat]!.nextReady).toBe(false);

    vi.advanceTimersByTime(1);
    expect(room.state.round!.roundNo).toBe(2);
    expect(room.state.round!.phase).toBe('defense_window');
    expect(room.state.players[bot.seat]!.nextReady).toBe(false);
    driver.dispose();
  });
});
