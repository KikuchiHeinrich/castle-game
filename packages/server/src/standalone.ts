// 单文件可执行入口：配合 `bun build --compile --asset` 使用。
// Bun 编译产物中 readdirSync/readFileSync 可读内嵌资源，但 createReadStream
// 不行（express.static 依赖它），因此启动时把客户端 dist 全量读入内存再服务。
import fs from 'node:fs';
import path from 'node:path';
import { buildServer } from './host';

const assetRoot = path.join(import.meta.dir, 'embed', 'dist');

function loadAssets(root: string): Map<string, Buffer> {
  const assets = new Map<string, Buffer>();
  const walk = (dir: string, prefix: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else assets.set(rel, fs.readFileSync(full));
    }
  };
  walk(root, '');
  return assets;
}

const assets = loadAssets(assetRoot);
const port = Number(process.env.PORT ?? 3000);
const server = buildServer({ clientAssets: assets });

function openBrowser(url: string) {
  const { exec } = require('node:child_process') as typeof import('node:child_process');
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function onPortInUse(port: number) {
  // 端口被占：如果已是《城堡》在跑，直接打开浏览器；否则给出可操作的提示
  const url = `http://localhost:${port}`;
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      console.log(`[Castle] 已有实例在运行，直接打开 ${url}`);
      openBrowser(url);
      process.exit(0);
    }
  } catch { /* 不是本游戏 */ }
  console.error(`[Castle] 端口 ${port} 被其他程序占用。可用环境变量 PORT 换端口，例如：PORT=3001 ./${process.argv[1]?.split('/').pop()}`);
  process.exit(1);
}

// Bun/Node 下端口冲突可能同步抛错或触发 error 事件，两种都接住
server.httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') void onPortInUse(port);
  else throw err;
});

try {
  server.listen(port).then(() => {
    console.log(`[Castle] server ready: http://localhost:${port} (${assets.size} embedded files)`);
    if (process.env.OPEN_BROWSER !== '0') openBrowser(`http://localhost:${port}`);
  }, (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') void onPortInUse(port);
    else throw err;
  });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') void onPortInUse(port);
  else throw err;
}
