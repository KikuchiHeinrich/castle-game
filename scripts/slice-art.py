#!/usr/bin/env python3
"""为 CSS border-image 准备 Kingslayer 按钮素材。

素材布局：每张按钮图 64×128，纵向 4 帧、每帧 64×32
  帧 0 = 禁用  帧 1 = 常态  帧 2 = 悬停  帧 3 = 按下

为什么要抠图标：九宫格的边角切片会带走图标在 y<8 / y>24 的部分，
所以先把四帧的图标包围盒统一擦成纯色，边框才干净；图标另行单独导出。

输入  packages/client/public/king/ui/btn_<name>_sheet.png
输出  btn_<name>_<0..3>.png   64×32 无图标帧 → CSS border-image
      icon_<name>.png        图标本体（底色透明）→ 按钮 ::before
并打印各帧中段底色，供 CSS 的 background-color 使用。

用法：python scripts/slice-art.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "packages" / "client" / "public" / "king" / "ui"

NAMES = ("attack", "defense", "skip", "tarot", "back")
FRAME_W, FRAME_H = 64, 32
ICON_INSET = 8  # 图标横向搜索范围，避开两侧圆角边框
SAMPLE = (14, 20)  # 中段无图标处的底色采样点


def bright_mask(frame: Image.Image) -> list[tuple[int, int]]:
    px = frame.load()
    hits = []
    for y in range(frame.height):
        for x in range(ICON_INSET, frame.width - ICON_INSET):
            r, g, b, a = px[x, y]
            if a > 128 and r > 190 and g > 190 and b > 190:
                hits.append((x, y))
    return hits


def icon_box(frames: list[Image.Image], pad: int = 1) -> tuple[int, int, int, int]:
    """四帧的图标包围盒取并集——悬停/按下帧的图标比常态帧略大一点。"""
    xs: list[int] = []
    ys: list[int] = []
    for frame in frames:
        for x, y in bright_mask(frame):
            xs.append(x)
            ys.append(y)
    if not xs:
        raise SystemExit("按钮帧里找不到图标像素")
    return (
        max(0, min(xs) - pad),
        max(0, min(ys) - pad),
        min(FRAME_W, max(xs) + 1 + pad),
        min(FRAME_H, max(ys) + 1 + pad),
    )


def erase_icon(frame: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """按行把图标左侧的像素横向铺满，还原成一块干净的纯色填充。"""
    x0, y0, x1, y1 = box
    out = frame.copy()
    px = out.load()
    for y in range(y0, y1):
        src = frame.getpixel((max(0, x0 - 1), y))
        for x in range(x0, x1):
            px[x, y] = src
    return out


def transparent_bg(icon: Image.Image) -> Image.Image:
    """按钮底色是纯色平涂，把左上角那个颜色抠成透明，图标才能放到别处复用。"""
    bg = icon.getpixel((0, 0))
    out = icon.copy()
    src = icon.load()
    dst = out.load()
    for y in range(icon.height):
        for x in range(icon.width):
            if src[x, y] == bg:
                dst[x, y] = (0, 0, 0, 0)
    return out


def hexof(rgba: tuple[int, int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgba[:3])


def main() -> None:
    report: list[str] = []
    for name in NAMES:
        sheet = Image.open(UI / f"btn_{name}_sheet.png").convert("RGBA")
        if sheet.size != (FRAME_W, FRAME_H * 4):
            raise SystemExit(f"{name}: 期望 {FRAME_W}×{FRAME_H * 4}，实际 {sheet.size}")

        frames = [sheet.crop((0, s * FRAME_H, FRAME_W, (s + 1) * FRAME_H)) for s in range(4)]
        box = icon_box(frames)

        for state, frame in enumerate(frames):
            erase_icon(frame, box).save(UI / f"btn_{name}_{state}.png")

        icon = transparent_bg(frames[1].crop(box))
        icon.save(UI / f"icon_{name}.png")

        colors = " ".join(hexof(f.getpixel(SAMPLE)) for f in frames)
        report.append(f"  {name:<8} {colors}   图标 {icon.width}×{icon.height}")
        print(f"{name:>8}: 4 帧 64×32（已抠图标）+ 图标 {icon.width}×{icon.height}")

    print("\n中段底色（禁用 / 常态 / 悬停 / 按下）：")
    print("\n".join(report))


if __name__ == "__main__":
    main()
