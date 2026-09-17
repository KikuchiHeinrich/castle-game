@echo off
title 城堡 · Castle
cd /d "%~dp0"

echo ================================================
echo    城堡 · Castle
echo    正在启动，浏览器会自动打开游戏页面...
echo    玩游戏期间请保持本窗口开启（最小化即可）
echo    不想玩了：直接关掉本窗口就是退出游戏
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 电脑上没有找到 Node.js，请先到 https://nodejs.org 安装后重试。
  pause
  exit /b 1
)

if not exist node_modules (
  echo [首次运行] 正在安装依赖，大约 1~2 分钟，请耐心等待...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

if exist packages\server\dist\index.js if exist packages\client\dist\index.html goto run

echo [首次运行] 正在构建游戏，大约 1 分钟...
call npm run build
if errorlevel 1 (
  echo [错误] 构建失败，请把本窗口截图反馈。
  pause
  exit /b 1
)

:run
set PORT=3000
set OPEN_BROWSER=1
echo.
echo 服务地址: http://localhost:3000
echo.
node packages\server\dist\index.js

rem 走到这里说明服务退出了：若 3000 端口已有旧实例在跑，则直接打开页面
curl -s -o nul http://localhost:3000/healthz
if not errorlevel 1 (
  echo 游戏服务已经在运行，直接为你打开页面...
  start "" http://localhost:3000
  timeout /t 3 >nul
  exit /b 0
)
echo.
echo [服务已退出] 如果不是你自己关的窗口，请把本界面截图反馈。
pause
