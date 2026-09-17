# 美术素材来源与再生成

《城堡》的美术、音效、字体全部取自本地另一份 demo：

```
别人的游戏demo/Kingslayer_demo_20250322/Release/assets/
```

来源只用于**素材复用**，没有引入对方的任何代码或规则。搬运后的资源都在
`packages/client/public/king/`，构建时由 Vite 原样拷到 `dist/king/`，
运行期用绝对路径引用（`/king/...`），不经打包器处理。

## 目录结构

| 路径 | 内容 | 来源 |
| --- | --- | --- |
| `king/cards/cards.png` | 牌面图集 637×325 = 13 列 × 5 行，单格 49×65 | `image/cards.png` |
| `king/cards/card_back.png` | 牌背 49×65 | `image/card_back.png` |
| `king/cards/discard_back.png` | 弃牌堆牌背 | `image/discard_back.png` |
| `king/cards/pile_base.png` | 牌堆虚线底框 | `image/pile_base.png` |
| `king/ui/nebula.png` | 星云底图 320×320（非无缝，用 cover 铺满） | `image/index/background.png` |
| `king/ui/btn_*_sheet.png` | 按钮原图 64×128（4 帧） | `image/*_button.png` |
| `king/ui/btn_*_0..3.png` | 切好的单状态帧 64×32，供 `border-image` | 由脚本切分 |
| `king/ui/icon_*.png` | 按钮图标（底色已透明） | 由脚本切分 |
| `king/sfx/*` | 音效：点击 / 抽牌 / 洗牌 / 轻叩 / 翻页 / 木响 / 金属 / 终局 | `audio/` 精选 |
| `king/font/NanoDyongSong-subset.woff2` | 17px 点阵中文字体子集 77KB | `font/namidiansong.ttf` |

## 牌面图集的行列

素材行序是 **红桃 → 方片 → 黑桃 → 梅花 → 王**，而《城堡》的 `Suit` 是
`0♦ 1♥ 2♣ 3♠`，所以 `components/card.ts` 里有一张映射表：

```ts
const SUIT_ROW = { 1: 0, 0: 1, 3: 2, 2: 3 };
```

列号 = `rank - 1`（A 在第 0 列，K 在第 12 列）。定位靠 CSS 自定义属性：

```css
background-position: calc(var(--col) * var(--cw) * -1) calc(var(--row) * var(--ch) * -1);
```

全尺寸手牌用 **2 倍格**（98×130），出战区 / 对手牌用 **1 倍格**（49×65）。
整数倍缩放 + `image-rendering: pixelated`，点阵不会糊。

## 按钮为什么和原图不完全一样

原按钮的图标是**画在按钮中央**的。做九宫格拉伸时中间区域会被拉长，
图标会跟着变形，所以 `scripts/slice-art.py` 把图标按行用左侧像素抹平，
得到一块干净底色的边框帧，图标另行导出、由按钮的 `::before` 单独贴回去。

```bash
python scripts/slice-art.py
```

脚本同时会打印各状态的中段底色，CSS 里的 `--btn-attack` 等变量就来自这个输出
（`border-image` 不加 `fill`，中段由 `background-color` 平涂，避免拉伸伪影）。

## 字体子集化

`namidiansong.ttf` 原文件 12.4MB，不能直接上网。用 `fontTools` 把它裁到
**游戏实际用到的 999 个汉字 + ASCII/标点/箭头**，转 woff2 后只有 77KB：

```bash
python -m fontTools.subset Release/assets/font/namidiansong.ttf \
  --text-file=<游戏内出现过的汉字集合> \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-205E,U+2190-21FF,U+2500-25FF,U+2600-27BF,U+3000-303F,U+FF01-FF5E" \
  --layout-features='*' --flavor=woff2 \
  --output-file=packages/client/public/king/font/NanoDyongSong-subset.woff2
```

**关键约束：这是一个 17px 点阵字体**，只有 17px 与 34px 是整数倍缩放、边缘才锐利，
其它尺寸都会糊。所以正文一律 17px、大号一律 34px（见 `styles/base.css` 的 `--fs`）。
玩家昵称里的生僻字不在子集内，会回落到 Fusion Pixel 缝合字体，不会显示成方块。
