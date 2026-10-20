/**
 * UI 验收截图脚本：用本机无头 Chrome 打开真实前端（先 `npm run dev`），
 * 走完大厅 → 房间 → 牌桌的真实流程并截图。
 *
 * 用法：node scripts/ui-shots.mjs [输出目录] [页面地址] [场景名]
 *   默认输出到 docs/ui-rebuild/acceptance/shots/，默认打开 http://localhost:5173
 *   场景：lobby / table2p / table6p / playAction / acceptance / reduced（省略则全跑）
 *
 * 依赖：本机 Chrome + node_modules/ws。所有交互都通过 CDP 在页面里执行真实点击。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = resolve(process.argv[2] ?? 'docs/ui-rebuild/acceptance/shots');
const ORIGIN = process.argv[3] ?? 'http://localhost:5173';
const PORT = 9411;
const DOCS_PORT = 9412;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.errors = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
      }
      for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, reject) => {
      this.pending.set(id, { resolve: res, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method) {
    return new Promise((res) => {
      const list = this.listeners.get(method) ?? [];
      const fn = (params) => {
        this.listeners.set(method, list.filter((x) => x !== fn));
        res(params);
      };
      list.push(fn);
      this.listeners.set(method, list);
    });
  }
  viewport(width, height) {
    return this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }
  async goto(url) {
    const loaded = this.once('Page.loadEventFired');
    await this.send('Page.navigate', { url });
    await loaded;
    await sleep(400);
  }
  /** 清掉会话与本地记录后回到大厅，保证每个场景都从大厅开始 */
  async reset() {
    await this.eval('sessionStorage.clear(); localStorage.clear(); return true;');
    await this.goto(ORIGIN);
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression: `(async()=>{${expression}})()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval failed');
    return res.result.value;
  }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    return `${name}.png`;
  }
}

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'castle-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`, 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      const target = await res.json();
      const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
      await new Promise((res2, rej) => { ws.on('open', res2); ws.on('error', rej); });
      const page = new Page(ws);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      return { chrome, page };
    } catch {
      await sleep(250);
    }
  }
  chrome.kill();
  throw new Error('无头 Chrome 未能在 15 秒内就绪');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
let docs = null;
/** 仓库根目录的极简静态服务：让验收页能以 http 而非 file:// 打开 */
async function docsServer() {
  if (docs) return docs;
  const root = resolve('.');
  docs = createServer(async (req, res) => {
    const path = resolve(root, '.' + decodeURIComponent((req.url ?? '/').split('?')[0]));
    if (!path.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': MIME[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((res) => docs.listen(DOCS_PORT, '127.0.0.1', res));
  return docs;
}

/** 大厅 → 建房 → 加电脑 → 开局；在页面里执行 */
const bootTable = (bots, name) => `
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(60); } throw new Error('等待超时'); };
  document.querySelector('#name').value = ${JSON.stringify(name)};
  document.querySelector('#name').dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#btn-create').click();
  await until(() => document.querySelector('#btn-bot'));
  for (let i = 0; i < ${bots}; i++) { document.querySelector('#btn-bot').click(); await wait(180); }
  await until(() => { const b = document.querySelector('#btn-start'); return b && !b.disabled; });
  document.querySelector('#btn-start').click();
  await until(() => document.querySelector('#hand'));
  await wait(900);
  return true;
`;

const scenarios = {
  async lobby(shot) {
    await shot.viewport(1280, 720);
    await shot.goto(ORIGIN);
    await shot.shot('01-lobby-desktop-1280x720');
    await shot.viewport(360, 640);
    await shot.shot('02-lobby-mobile-360');
    await shot.viewport(320, 568);
    await shot.shot('03-lobby-mobile-320');
  },
  async table2p(shot) {
    await shot.viewport(1280, 720);
    await shot.reset();
    await shot.eval(bootTable(1, '验收员'));
    await shot.shot('04-table-2p-1280x720');
    await shot.viewport(360, 640);
    await shot.shot('05-table-2p-360');
    await shot.viewport(320, 568);
    await shot.shot('06-table-2p-320');
    return shot.eval('return document.querySelector("#hand").children.length;');
  },
  async table6p(shot) {
    await shot.viewport(1280, 720);
    await shot.reset();
    await shot.eval(bootTable(5, '验收员'));
    await shot.shot('07-table-6p-1280x720');
    await shot.viewport(360, 640);
    await shot.shot('08-table-6p-360');
    await shot.viewport(1280, 720);
    return shot.eval('return document.querySelectorAll("#opponents [data-seat]").length;');
  },
  async playAction(shot) {
    await shot.viewport(1280, 720);
    await shot.reset();
    await shot.eval(bootTable(5, '验收员'));
    const staged = await shot.eval(`
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const until = async (fn, ms = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(40); } return null; };
      const armed = await until(() => document.querySelector('#commit') && !document.querySelector('#commit').disabled);
      document.querySelector('#hand .card').click();
      await wait(150);
      document.querySelector('#commit').click();
      const acting = await until(() => document.querySelector('.pixel-avatar[data-action="play"]') || document.querySelector('.fly-card'), 8000);
      return { armed: Boolean(armed), acting: Boolean(acting) };
    `);
    await shot.shot('09-table-play-action');
    await sleep(1200);
    await shot.shot('10-table-after-play');
    return JSON.stringify(staged);
  },
  /** 几何量测：容器 / 精灵 / 阴影 的框，用于确认接触点不漂、精灵不出框 */
  async inspect(shot) {
    await shot.viewport(1280, 720);
    await shot.reset();
    return shot.eval(`
      const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
      return JSON.stringify([...document.querySelectorAll('.avatar-pick')].map((el) =>
        [el.textContent.trim(), box(el), box(el.querySelector('.pixel-avatar')), box(el.querySelector('.sprite-frame')), box(el.querySelector('.avatar-shadow'))]));
    `);
  },
  /** 牌桌文字/计数探针：确认倒计时取自权威截止时间并逐秒递减 */
  async probe(shot) {
    await shot.viewport(1280, 720);
    await shot.reset();
    await shot.eval(bootTable(2, '验收员'));
    const read = `
      const t = (s) => document.querySelector(s)?.textContent ?? null;
      const seats = [...document.querySelectorAll('#opponents [data-seat]')].map((el) => [el.dataset.seat, t('[data-seat="' + el.dataset.seat + '"] .opp-name'), t('[data-seat="' + el.dataset.seat + '"] .opp-meta'), el.querySelectorAll('.opp-segs .card').length]);
      return { phase: t('#phase-tip'), countdown: t('#countdown'), round: t('#round-info'), type: t('#current-type'), bet: t('#bet-summary'), limits: t('#bet-limits'), commit: t('#commit'), hand: document.querySelectorAll('#hand .card').length, mine: t('#self-seat .self-name'), seats };
    `;
    const first = await shot.eval(read);
    await sleep(3000);
    const second = await shot.eval(read);
    return JSON.stringify({ first, second });
  },
  /** 版式探针：牌桌各区块是否越界 / 互相遮挡（720p 与 900×620 边界） */
  async layout(shot) {
    await shot.viewport(1280, 720);
    await shot.reset();
    await shot.eval(bootTable(5, '验收员'));
    const measure = `
      const box = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.width)]; };
      const hand = document.querySelector('#hand .card');
      const barTop = document.querySelector('#action-bar').getBoundingClientRect().top;
      const handBottom = hand ? hand.getBoundingClientRect().bottom : 0;
      return { vh: innerHeight, vw: innerWidth, scroll: document.documentElement.scrollHeight, handCard: hand ? [Math.round(hand.getBoundingClientRect().width), Math.round(hand.getBoundingClientRect().height)] : null, handBottom: Math.round(handBottom), barTop: Math.round(barTop), overlap: Math.round(handBottom - barTop), notice: box('#table-notice'), played: box('#you-played'), hand6: document.querySelectorAll('#hand .card').length, oppBottom: box('#opponents')?.[1] ?? null };
    `;
    const desktop = await shot.eval(measure);
    await shot.viewport(900, 620);
    const small = await shot.eval(measure);
    return JSON.stringify({ desktop, small });
  },
  async acceptance(shot) {
    await shot.viewport(1500, 1040);
    // 验收页用仓库根目录的静态服务打开，保证与实机一致的相对资源路径
    const server = await docsServer();
    await shot.goto(`http://127.0.0.1:${DOCS_PORT}/docs/ui-rebuild/acceptance/characters.html`);
    await shot.shot('11-acceptance-characters');
    await shot.eval(`
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      document.getElementById('anchors').click();
      document.getElementById('allplay6').click();
      await wait(340);
      return true;
    `);
    await shot.shot('12-acceptance-six-acting');
  },
  async reduced(shot) {
    await shot.viewport(1280, 720);
    await shot.reset();
    await shot.eval(bootTable(2, '验收员'));
    await shot.eval(`
      document.querySelector('#table-menu-button').click();
      document.querySelector('#btn-motion').click();
      document.querySelector('#table-menu').hidden = true;
      return true;
    `);
    await shot.shot('13-table-reduced-motion');
  },
};

const scenarioName = process.argv[4];
const names = scenarioName ? [scenarioName] : Object.keys(scenarios);
const { chrome, page } = await launch();
let failed = 0;
try {
  for (const name of names) {
    const run = scenarios[name];
    if (!run) throw new Error(`未知场景 ${name}`);
    const started = Date.now();
    const detail = await run(page);
    const errors = page.errors.splice(0);
    console.log(`✓ ${name} (${Date.now() - started}ms)${detail === undefined ? '' : ` → ${detail}`}`);
    if (errors.length) {
      failed = 1;
      console.log(`  ✗ 页面报错 ${errors.length} 条：\n    ${errors.join('\n    ')}`);
    }
  }
} catch (error) {
  failed = 1;
  console.error(`✗ ${error.message}`);
  if (page.errors.length) console.error(`  页面报错：\n    ${page.errors.join('\n    ')}`);
  try {
    await page.shot('error-state');
    const where = await page.eval('return location.pathname + " " + document.body.innerText.slice(0, 120).replace(/\\n+/g, " | ")');
    console.error(`  失败现场：${where}（已存 error-state.png）`);
  } catch { /* 页面已不可用 */ }
} finally {
  chrome.kill();
  docs?.close();
}
console.log(`截图输出目录：${OUT}`);
process.exit(failed);
