import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildServer } from './host';

function clientDistPath(): string | undefined {
  if (process.env.CLIENT_DIST) return process.env.CLIENT_DIST;
  try {
    // esbuild CJS 产物有 __dirname；tsx/ESM 下用 import.meta.url
    if (typeof __dirname !== 'undefined') {
      return path.resolve(__dirname, '../../client/dist');
    }
    return fileURLToPath(new URL('../../client/dist', import.meta.url));
  } catch {
    return undefined;
  }
}

const port = Number(process.env.PORT ?? 3000);
const server = buildServer({ clientDist: clientDistPath() });

server.listen(port).then(() => {
  // 启动器控制台是 GBK 代码页，这里保持 ASCII 避免 mojibake
  console.log(`[Castle] server ready: http://localhost:${port}`);
  // 双击启动器（启动城堡.bat）设置 OPEN_BROWSER=1：服务就绪后自动打开浏览器
  if (process.env.OPEN_BROWSER === '1') {
    const url = `http://localhost:${port}`;
    const cmd =
      process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
