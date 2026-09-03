#!/bin/bash
# 《城堡》一键启动：双击即开玩（关掉弹出的终端窗口 = 停止服务）
cd /Users/xuyilin/Desktop/Projects/castle-game || { echo "找不到游戏目录"; exit 1; }

# 已经有城堡服务在跑 → 直接打开浏览器
if curl -s --max-time 1 http://localhost:3000/healthz >/dev/null 2>&1; then
  open "http://localhost:3000"
  echo "《城堡》已在运行，浏览器已打开（http://localhost:3000）"
  sleep 2
  exit 0
fi

# 首次使用：先构建
if [ ! -f packages/client/dist/index.html ]; then
  echo "首次启动，构建中（约半分钟）…"
  npm run build || { echo "构建失败"; exit 1; }
fi

# 起服务 → 等就绪 → 开浏览器 → 保持窗口显示日志
node packages/server/dist/index.js &
SERVER_PID=$!
for i in $(seq 1 30); do
  curl -s --max-time 1 http://localhost:3000/healthz >/dev/null 2>&1 && break
  sleep 0.3
done

open "http://localhost:3000"
clear
echo "┌─────────────────────────────────────────┐"
echo "│  🏰 《城堡》已启动                        │"
echo "│  浏览器已打开 http://localhost:3000      │"
echo "│  多人测试：多开几个浏览器标签页即可       │"
echo "│  关闭本窗口 = 停止服务                   │"
echo "└─────────────────────────────────────────┘"
wait $SERVER_PID
