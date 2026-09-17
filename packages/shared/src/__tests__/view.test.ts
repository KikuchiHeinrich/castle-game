import { describe, expect, it } from 'vitest';
import { addPlayer, buildPlayerView, createGameState, startGame, legalActions } from '../index';

const T0 = 1_000_000;

function setup(n = 3) {
  let s = createGameState('VW01');
  for (let i = 0; i < n; i++) addPlayer(s, `P${i}`);
  const g = startGame(s, 0, 11, T0);
  if (!g.ok) throw new Error(g.error);
  return g.state;
}

describe('buildPlayerView 防作弊过滤', () => {
  it('视图只含自己的手牌，绝不含他人手牌/牌堆/secret', () => {
    const s = setup(3);
    const allHands = s.players.map((p) => (p ? s.secret!.hands[p.seat].map((c) => c.id) : []));
    const view = buildPlayerView(s, 0)!;
    const json = JSON.stringify(view);

    // 不含 secret 结构
    expect(json).not.toContain('"secret"');
    expect(json).not.toContain('"deck":[');
    expect(view.deckCount).toBe(52 - 18); // 只有数量

    // 不含他人手牌
    for (const p of s.players) {
      if (!p || p.seat === 0) continue;
      for (const id of allHands[p.seat]) {
        expect(json.includes(id)).toBe(false);
      }
    }
    // 含自己的手牌
    for (const id of allHands[0]) {
      expect(json.includes(id)).toBe(true);
    }
    // 他人只有数量
    expect(view.players[1].handCount).toBe(6);
    expect((view.players[1] as unknown as Record<string, unknown>).hand).toBeUndefined();
  });

  it('字段完整：回合信息、合法操作、倒计时', () => {
    const s = setup(3);
    const view = buildPlayerView(s, 1)!;
    expect(view.roundPhase).toBe('defense_window');
    expect(view.pot).toBe(3);
    expect(view.declarerSeat).toBe(s.round!.declarerSeat);
    expect(view.deadlineAt).toBeGreaterThan(T0);
    expect(view.you.hand).toHaveLength(6);
    expect(view.you.legalActions.roundPhase).toBe('defense_window');
    expect(view.you.legalActions.canPassDefense).toBe(true);
    expect(legalActions(s, 1).canDeclareDefense).toBe(true);
    // 自己是宣战者才有权提前开始
    const declarerView = buildPlayerView(s, s.round!.declarerSeat)!;
    expect(declarerView.you.legalActions.canForceCloseDefense).toBe(true);
    const otherView = buildPlayerView(s, (s.round!.declarerSeat + 1) % 3)!;
    expect(otherView.you.legalActions.canForceCloseDefense).toBe(false);
  });

  it('lobby 阶段视图正常降级', () => {
    const s = createGameState('VW02');
    addPlayer(s, 'alone');
    const view = buildPlayerView(s, 0)!;
    expect(view.roundPhase).toBeNull();
    expect(view.pot).toBe(0);
    expect(view.you.hand).toHaveLength(0);
    expect(view.you.legalActions.canPlay).toBe(false);
  });
});
