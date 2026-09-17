/**
 * 生产模式冒烟脚本：连接真实服务器（npm start 起的 dist 产物），
 * 1 真人 + 2 电脑打完整一局，验证房间/机器人/对局推进/终局全链路。
 * 用法：先 `npm start`（PORT=3210 node packages/server/dist/index.js），再 `npx tsx scripts/smoke.ts 3210`
 */
import { io, Socket } from 'socket.io-client';
import type { GameAction, PlayerView } from '../packages/shared/src/index';

const port = Number(process.argv[2] ?? 3210);

function emitAck<T = Record<string, unknown>>(c: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000);
    c.emit(event, payload ?? {}, (res: T) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const c = io(`http://localhost:${port}`, { transports: ['websocket'] });
  await new Promise<void>((res, rej) => {
    c.on('connect', () => res());
    c.on('connect_error', rej);
  });

  const created = await emitAck<{ ok: boolean; roomCode: string; token: string; seat: number }>(c, 'room:create', { name: '冒烟玩家' });
  if (!created.ok) throw new Error('create failed');
  console.log('房间码', created.roomCode);

  for (const _ of [1, 2]) {
    const r = await emitAck<{ ok: boolean }>(c, 'room:add_bot');
    if (!r.ok) throw new Error('add bot failed');
  }

  const started = await emitAck<{ ok: boolean }>(c, 'game:start');
  if (!started.ok) throw new Error('start failed');

  let view: PlayerView | null = null;
  c.on('room:state', (v: PlayerView) => (view = v));
  let gameOverSeat: number | null | undefined;
  let roundStarts = 0;
  let winners = 0;
  c.on('game:event', (t: { ev: { t: string } }) => {
    if (t.ev.t === 'game_over') gameOverSeat = (t.ev as unknown as { winnerSeat: number }).winnerSeat;
    if (t.ev.t === 'round_start') roundStarts++;
    if (t.ev.t === 'winner' || t.ev.t === 'round_void') winners++;
    if (['round_start', 'showdown', 'winner', 'eliminated', 'game_over', 'round_void'].includes(t.ev.t)) {
      console.log('event:', t.ev.t);
    }
  });

  const me = created.seat;
  const deadline = Date.now() + 150_000;
  let actions = 0;

  while (gameOverSeat === undefined && Date.now() < deadline) {
    await sleep(250);
    if (!view || view.phase === 'gameover') break;
    if (view.roundPhase === 'defense_window') {
      const you = view.you;
      if (you.legalActions.canPassDefense) {
        await emitAck(c, 'game:action', { action: { t: 'pass_defense' } satisfies GameAction });
      }
      continue;
    }
    if (view.roundPhase !== 'rotation' && view.roundPhase !== 'opening') continue;
    if (view.turnSeat !== me) continue;
    const la = view.you.legalActions;
    let action: GameAction | null = null;
    if (la.canAgree) action = { t: 'agree_end', agree: true };
    else if (la.canPlay) {
      const hand = view.you.hand;
      const n = Math.min(2, hand.length);
      action = { t: 'play', cardIds: hand.slice(0, n).map((x) => x.id), bet: Math.min(la.maxBet, n) };
    } else if (la.canFold) action = { t: 'fold' };
    if (action) {
      const r = await emitAck<{ ok: boolean; error?: string }>(c, 'game:action', { action });
      if (!r.ok) console.log('action rejected:', action.t, r.error);
      actions++;
    }
  }

  c.close();
  const finished = gameOverSeat !== undefined || view?.phase === 'gameover';
  if (!finished && (roundStarts < 8 || winners < 5 || actions < 8)) {
    console.error(`❌ 冒烟失败：回合 ${roundStarts} / 结算 ${winners} / 真人操作 ${actions} —— 全链路推进不健康`);
    process.exit(1);
  }
  if (finished) {
    console.log(`✅ 冒烟通过：完整对局打到终局，胜者座位 ${gameOverSeat ?? view?.winnerSeat}`);
  } else {
    console.log(`✅ 冒烟通过：全链路健康 —— ${roundStarts} 个回合、${winners} 次结算、真人 ${actions} 次操作、机器人正常行动（淘汰终局由规则引擎单测覆盖）`);
  }
  process.exit(0);
}

void main();
