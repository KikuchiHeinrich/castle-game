import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  // Kingslayer 美术素材（卡牌图集/按钮/音效/子集字体）放在 public/king，
  // 构建时原样拷到 dist/king，服务端静态托管即可，不需要打包器处理
  publicDir: path.join(root, 'public'),
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: `http://localhost:${process.env.PORT ?? 3000}`,
        ws: true,
      },
    },
  },
});
