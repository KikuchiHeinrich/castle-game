import { describe, expect, it } from 'vitest';
import { breathDelay, breathPeriod, breathPhase } from '../pixelAvatar';

/**
 * 呼吸错峰按"实例键"（生产里用座位号）生效：同一个人物坐在两个座位上不能同步起伏。
 * 相位、周期都由键散列得出，因此同一个键在每次重渲染、重挂载后都必须给出同一个值，
 * DOM 重建不会让某个人物突然跳到别的相位。
 */
describe('呼吸相位与周期（按实例键）', () => {
  const seats = [0, 1, 2, 3, 4, 5];

  it('六个座位相位互不相同，相邻座位错开至少四分之一周期', () => {
    const phases = seats.map((seat) => breathPhase(seat));
    expect(new Set(phases.map((p) => p.toFixed(4))).size).toBe(seats.length);
    for (let i = 1; i < phases.length; i += 1) {
      expect(Math.abs(phases[i] - phases[i - 1])).toBeGreaterThanOrEqual(0.25);
    }
    for (const phase of phases) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });

  it('周期只有轻微差异，且都落在 2.8–4.2s 的呼吸区间内', () => {
    const periods = seats.map((seat) => breathPeriod(seat));
    expect(new Set(periods.map((p) => p.toFixed(3))).size).toBe(seats.length);
    expect(Math.max(...periods) - Math.min(...periods)).toBeLessThan(0.5);
    for (const period of periods) {
      expect(period).toBeGreaterThanOrEqual(2.8);
      expect(period).toBeLessThanOrEqual(4.2);
    }
  });

  it('起始相位是负延迟且不超过一个周期（首帧不凭空等待）', () => {
    for (const seat of seats) {
      const delay = breathDelay(seat);
      expect(delay).toBeLessThanOrEqual(0);
      expect(delay).toBeGreaterThan(-3.57);
    }
  });

  it('相邻座位即使同人物也错峰，字符串键同样稳定且互不相同', () => {
    expect(breathPhase(2)).not.toBe(breathPhase(4));
    const names = ['you:0', 'bot:1', 'bot:2', 'bot:3', 'bot:4', 'bot:5'];
    const phases = names.map((name) => breathPhase(name));
    expect(new Set(phases.map((p) => p.toFixed(4))).size).toBe(names.length);
    expect(breathPhase('bot:1')).toBe(breathPhase('bot:1'));
  });
});
