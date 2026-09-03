import path from 'node:path';
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
  console.log(`[城堡] 服务已启动: http://localhost:${port}`);
});
