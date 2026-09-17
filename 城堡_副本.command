#!/bin/bash
# 《城堡》一键启动（macOS）：双击即开玩（关掉弹出的终端窗口 = 停止服务）
# 端口默认 3000，可用环境变量 PORT 覆盖；脚本自动定位自身所在目录，可放任何位置
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"
cd "$DIR" || { echo "找不到游戏目录: $DIR"; exit 1; }

# 已经有城堡服务在跑 → 直接打开浏览器
if curl -s --max-time 1 "$URL/healthz" >/dev/null 2>&1; then
  open "$URL"
  echo "《城堡》已在运行，浏览器已打开（$URL）"
  sleep 2
  exit 0
fi

# 检查 Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未找到 Node.js，请先到 https://nodejs.org 安装后重试。"
  sleep 5
  exit 1
fi

# 首次使用：安装依赖
if [ ! -d node_modules ]; then
  echo "[首次运行] 正在安装依赖，大约 1~2 分钟，请耐心等待…"
  npm install || { echo "依赖安装失败，请检查网络后重试。"; sleep 5; exit 1; }
fi

# 首次使用：构建
if [ ! -f packages/client/dist/index.html ]; then
  echo "首次启动，构建中（约半分钟）…"
  npm run build || { echo "构建失败"; sleep 5; exit 1; }
fi

# 起服务 → 等就绪 → 开浏览器 → 保持窗口显示日志
OPEN_BROWSER=1 PORT="$PORT" node packages/server/dist/index.js &
SERVER_PID=$!
for i in $(seq 1 30); do
  curl -s --max-time 1 "$URL/healthz" >/dev/null 2>&1 && break
  sleep 0.3
done

open "$URL"
clear
echo "┌─────────────────────────────────────────┐"
echo "│  🏰 《城堡》已启动                        │"
echo "│  浏览器已打开 $URL"
echo "│  多人测试：多开几个浏览器标签页即可       │"
echo "│  关闭本窗口 = 停止服务                   │"
echo "└─────────────────────────────────────────┘"
wait $SERVER_PID
