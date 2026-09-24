#!/usr/bin/env bash
# 打包《城堡》为单文件可执行程序（Windows/macOS/Linux），产物在 release/ 目录。
# 用法：npm run release   或   ./scripts/build-binaries.sh [targets...]
# targets 默认：bun-windows-x64 bun-darwin-x64 bun-darwin-arm64 bun-linux-x64
set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="release"
STAGE="build/embed"
TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=(bun-windows-x64 bun-darwin-x64 bun-darwin-arm64 bun-linux-x64)
fi

echo "[1/3] 构建服务端与客户端…"
npm run build

echo "[2/3] 暂存客户端资源…"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R packages/client/dist "$STAGE/dist"

echo "[3/3] 交叉编译 $(printf '%s ' "${TARGETS[@]}")…"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
for target in "${TARGETS[@]}"; do
  case "$target" in
    bun-windows-x64)  name="城堡.exe" ;;
    bun-darwin-x64)   name="城堡-macOS-Intel" ;;
    bun-darwin-arm64) name="城堡-macOS-AppleSilicon" ;;
    bun-linux-x64)    name="城堡-linux" ;;
    *)                 name="城堡-$target" ;;
  esac
  echo "  → $name"
  npx bun build packages/server/src/standalone.ts \
    --compile "--target=$target" \
    "--asset=$STAGE" \
    --minify \
    "--outfile=$OUT_DIR/$name"
  chmod +x "$OUT_DIR/$name"
done

echo
echo "完成！产物在 $OUT_DIR/："
ls -lh "$OUT_DIR"
echo "运行方式：双击（macOS 需先在终端执行  xattr -dr com.apple.quarantine 文件名），或命令行 ./文件名"
echo "端口默认 3000，可用环境变量 PORT 覆盖。"
