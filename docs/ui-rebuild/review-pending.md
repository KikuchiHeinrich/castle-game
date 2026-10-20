# 主代理实机审阅：待修复 → 本轮收尾状态

2026-10-16，DeepSeek 执行代理收尾。下面的"验证"只写真实跑过的命令与推算，不引用旧截图；
手机 / 六人实机几何与动画观感仍由主代理经 cua_repl 重拍确认。
主代理随后用 cua 做了实机验收，暴露的 6 个具体问题在第 7 节处理完毕（**第 7 节之后以第 7 节的状态为准**）。

> **证据边界**：`acceptance/shots/` 里 10-15 18:03 之前的截图是旧交付，**不能**作为任何修复的证据。
> 本轮的实机证据只有 `acceptance/current/` 下主代理 cua 录制的 `two-play` / `six-play` 截图序列，
> 以及由这些帧编码出的 `two-player.gif` / `six-player.gif`（采样演示，**不是 60fps 录屏**）。

## 1. 手机倍率与手牌扇形 —— 已改，实机待复核

- **倍率链路**：`avatarSVG()` 内联只写 `--avatar-default-scale`，最终倍率由
  `sprite.css` 的 `.pixel-avatar{--avatar-scale:var(--avatar-default-scale,2)}` 决定。
  手机媒体查询里的 `--avatar-scale:1` 因此真正生效；CSS 背景尺寸、WAAPI 帧偏移
  （`localScale()` 读 computed 值）与 `avatarHandRect()` 锚点读的是同一个最终值。
- **扇形居中**：手牌索引从 `1..6` 改为 `0..5`，配 `(count-1)/2` 中心公式后
  `--off` 对称分布（±2.5 档），六张牌不再整体偏右。
- **收叠不再靠裁切**：手机重叠量改由公式按可用宽度算
  `--fan-overlap: clamp(6px, var(--card-w) - (100vw - var(--fan-reserve) - var(--card-w))/5, var(--card-w) - 14px)`
  （≤760px 用 `--fan-reserve:140px`，≤400px 用 `120px`），旋转支点收到 `50% 190%`、
  角度 4.2° / 4°：扇形连"外圈牌旋转后的横向外扩"一起落在 `#hand` 内容盒内，
  不依赖 `#table` / `#you-zone` 的 overflow 把外圈牌裁掉。
- **本人座位**：手机上仍在手牌行上方的左侧空档（`left:4px`），倍率回到 1x（48px），
  偏移由 `calc(var(--card-h) + 140px)` 提到 `+168px`，给选中牌抬起 16px 与外圈旋转下探留余量。
- **静态复算**（`/tmp/fan-sweep.mjs`，按 table.css 数值建模旋转外接框，不是浏览器实测）：
  320 / 360 / 375 / 400 / 412 / 480 / 600 / 760 px 全部落在可用宽度内，最紧一档余量 54.6px，
  320px 时每张牌可见宽度 30px（牌角点数与花色在左上角，仍可读可点）；
  桌面 1280×720 与 900×620 的扇形宽 617.5px、可用 1204 / 840px，无溢出。
- **仍待主代理确认**：320/360 下头像不压手牌与组合行、六张牌全部可点、桌面低高度可用。

## 2. 呼吸相位 —— 已改

- 相位键从"角色 row"改成"实例键"：数字键（座位号）走黄金分割分层 + 少量散列抖动，
  相邻座位至少错开三分之一周期；字符串键走 FNV-1a 散列。同一个键恒定，
  DOM 重挂 / 重渲染都不变，也不触碰绘制图像。
- 实测参数：相位 0.016–0.761 周期，周期 3.157–3.470s（跨度 0.31s，属"轻微周期差"），
  延迟都落在一个周期内。牌桌（本人 + 每个对手）与房间座位格都按座位号传键，
  同一个人物坐在两个座位上不再同步起伏；验收页席位上也显示相位/周期。

## 3. 统一取消 —— 已改

- 新增 `packages/client/src/pending.ts` 的 `TimerRegistry`：登记 `setTimeout`，
  取消时先 `clearTimeout` 再立刻执行登记的回调（撤销高亮 / 移除 class / 结算等待中的 Promise）。
- `pixelAvatar.confirmAction` 原来是"确认样式一个定时器 + Promise 一个定时器（只清一个）"，
  现在只留一份登记 + 单一 `finish`：取消时样式与 Promise 一起收干净。
- `anim.ts` 的 `wait()` 与 `pulse()` 都走 `TimerRegistry`；
  `resetQueue()` 另外清掉 `.fx-return` 座位高亮、`.fly-card/.flying-chip` 残留节点，
  并恢复 `[data-fx-hidden]` 手牌。退出后没有残留计时器，等待中的 Promise 能结束。

## 4. socket 重连基线 —— 已改

- 新增 `packages/client/src/net/cursor.ts` 的 `planViewCursor()`，`socket.applyView()` 改用它。
  重连回包按 `rejoin` 模式处理：把 `lastEventSeq` 明确设成快照 `eventSeq` 并 `resetQueue()`，
  之后第一个真实动作（`seq = 快照 + 1`）不会再被判成 gap 而丢掉。
- 已核对服务端 `host.commit()`：先 `emit('game:event')`、再 `broadcastState()`，
  所以正常广播的快照 `eventSeq` 与本地游标持平，不会触发 reset，正在播的动作不被打断。
- 重连回包加了会话校验：房间码或 token 变了（离开、换房、新局）就丢弃，旧房间状态
  不会写进新局；`submit()` 原有的 `code + roundNo` 守卫保留。

## 5. 对手状态与结算文案 —— 已改

- 新增 `packages/client/src/views/shortStatus.ts`：头顶只放短状态
  （去"张"与空格、同意结束→同意摊牌、不同意→取消同意），例如
  `加牌2·加注3`、`防守2·托管4`、`出战3·押5`，最长 8 字；完整句子仍在座位详情与战报记录里。
- 结算删掉"钱没进奖池""已计入上面的奖池"两句解释，只留 `托管退还`/`托管入池` 标签与金额，
  同时删掉已无用的 `.result-note i` 样式。
- 牌型查询 ±4 档、组合预览、合法动作均未改动。

## 6. 验收页与生成链路 —— 已同步

- `docs/ui-rebuild/acceptance/acceptance-runtime.js`（生产模块打包源）新增两项自检：
  ① 样式表可覆盖内联默认倍率（手机 1x 依赖的链路）且锚点读最终倍率；
  ② 呼吸按实例错峰（相邻座位相位差 ≥25% 周期、周期跨度 ≤0.5s）。
  席位探针同时显示释放点、相位与周期。
- **慢放路径修正（本轮新发现）**：验收页的 `run()` 原来用 `avatar.getAnimations()` 取动画再设
  `playbackRate`，但 `Element.getAnimations()` 默认不含后代元素，而动作层 `.avatar-action`
  是 `.pixel-avatar` 的子元素——也就是说"慢放 ×2.5"一直是空操作。改成
  `document.getAnimations()` 过滤"位于该头像内的 `.avatar-action` 目标"，并新增自检
  "慢放 ×2.5 作用于动作时间线"（断言命中 ≥1 条动作动画且 `playbackRate === 0.4`）。
  只放慢动作时间线，不连带呼吸：呼吸已按 `--breath-period` 随倍率放长，两边都调会双重放慢。
  该修正只动验收页打包源；重新打包后的 `avatar-runtime.js` 已含 `actionAnimations()`，
  但**还没有在浏览器里重跑过**（见文末"未做"）。
- 重跑既有生成器 `node scripts/build-character-atlas.ts`：`atlas.png / atlas.svg / atlas.json`
  与重跑前的 sha256 完全一致（没有重绘美术），只有 `avatar-runtime.js` 按新代码重新打包。
  图像本身由主代理负责，本轮未做任何绘制改动。

## 7. 实机验收后的最后修正（2026-10-16 晚，本轮）

主代理用 cua 在真实 iframe 视口验收后，交回 6 个点。本轮只改这 6 点，**没有重绘图片、
没有改玩法/规则、没有启停 5173/3000、没有开浏览器**。改动文件：
`packages/client/src/views/TableView.ts`、`styles/table.css`、`styles/base.css`、
`components/__tests__/breathPhase.test.ts`（删 1 条自我比较用例），并删除
`__tests__/responsiveContract.test.ts`、`views/__tests__/shortStatus.test.ts`，
新增 `acceptance/current/two-player.gif`、`six-player.gif`。

### 7.1 战报（问题 1）—— 已改

- `#table-notice` 加 `class="sr-only"`，`base.css` 新增 `.sr-only`（1 像素 + `clip-path: inset(50%)` +
  `overflow: hidden`，**不是** `display:none`），`aria-live="polite"` 保留。
- `table.css` 删除原先贴在铭牌下方的绝对定位播报块，以及 `≤760px` 里覆盖它的
  `max-width: 62vw / font-size: 10px`。320px 的铭牌下不再有重叠文字。
- `report` 仍往该元素写文本，无新增 timeout；完整战报仍可从菜单"记录"查看。

### 7.2 手机查询面板与本人座位重叠（问题 2）—— 已改，实机待复核

- `≤760px` 的 `#rank-reference` 改为 `width: calc(100% - 68px)` + `margin-left: auto`（靠右），
  左侧 68px 留给本人座位（`left: 4px` + 48px 头像，名字最宽 60px）。
- ≤400px 沿用同一收窄宽度，并把面板内边距收到 `7px 6px`、`#rank-rail` 列间距收到 1px；
  按 CSS 数值推算 320px 下面板约 240px、9 列每列约 24px（按钮内容约 22px ≥ 两字 10px），
  仍单行可读——这是推算，**不是设备实测**。手牌与主按钮未改。

### 7.3 查询不再伪造"当前"档（问题 3）—— 已改

- 只有 `d.preview` 存在时才给该档加 `current`、`aria-current="true"`，"当前"标签同理；
  无组合时仍按第 5 档摊开 1..9 档可查，但三样标记都不出现。
- `.rank-directions` 中间的 span 加 `id="rank-current-label"` 供 `renderDecision()` 写入（保留元素以维持
  `space-between` 三段布局）；`keyed` 键加上 `hasCurrent`，避免"有组合第 5 档 / 无组合 fallback 第 5 档"
  同键不重绘导致 `current` 残留。有组合时的 ±4 档逻辑未改。

### 7.4 菜单状态与投入输入（问题 4）—— 已改

- 新增 `closeMenu()`（一处同时写 `hidden` 与 `aria-expanded="false"`），`[data-close]`、`Escape`、
  `btn-types`、`btn-history`、`btn-exit` 全部走它；`btn-mute` / `btn-motion` / `btn-tutorial-close`
  本来就不关菜单，保持原样。
- `#bet-input` 加 `oninput`（与 `onchange` 共用 `syncBet()` → `adjust()`）：输入 2 后光标未离开摘要即更新；
  输入框节点不重建、活动元素检查保留，焦点与光标不被重置。

### 7.5 测试精简（问题 5）—— 已完成

- 删除 `responsiveContract.test.ts`（源码字符串正则断言）与 `shortStatus.test.ts`（文案映射镜像），
  以及 `breathPhase.test.ts` 里明显自我比较的那条用例；没有新增任何测试。
- 保留行为回归：`net/__tests__/cursor.test.ts`（9 项，事件游标）、`__tests__/pending.test.ts`
  （4 项，取消机制）、`server` 集成、`shared` rules/evaluator/view。

### 7.6 实机录制编码（问题 6）—— 已完成

- 用 `two-play` / `six-play` 的**已有** 21 帧 + `timing.json` 编码出
  `acceptance/current/two-player.gif`（320×568，21 帧，1168KB，12974ms）与
  `six-player.gif`（1280×720，21 帧，669KB，4384ms）：每帧延迟 = 下一帧时间戳 − 本帧时间戳，
  末帧停 1000ms，`loop=0`。**不重绘、不 AI 生图、不造中间帧。**
- 编码器来源：本机无 ffmpeg、系统 Python 无 Pillow，改用 Codex 捆绑运行时的
  **捆绑 Python（Pillow 12.3.0）与捆绑 Node（sharp 0.35.5）**，未安装新依赖。
  Pillow 会把逐像素相同的相邻帧合并（six-play 里 2 对完全相同，会 21→19 帧），
  因此最终用 sharp 的 `keepDuplicateFrames: true` 保留 21 帧。
- GIF 延迟单位是 10ms，写入值 = 真实间隔取整到百分秒；回读校验帧数 / 页面尺寸 / 延迟一致，
  抽帧与源图平均像素差 0.6–1.5/255（256 色量化）。
- **采样率如实说明**：two-play ≈1.6 fps、six-play ≈4.8 fps，是实机截图采样演示，不能当 60fps 录屏。

### 7.7 本轮验证（真实执行）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 全部测试 | `npm test`（沙箱内 `listen EPERM`，放开沙箱执行） | **7 个文件、88 passed**（真实数；上一轮为 9 文件 / 108 passed） |
| 类型检查（三包） | `npx tsc -p packages/{client,shared,server}/tsconfig.json --noEmit` | 三包均 exit 0 |
| 生产构建 | `npm run build` | server esbuild + client vite 成功（client js 101.86 kB / css 193.36 kB） |
| GIF 校验 | 捆绑 Python Pillow 回读 | 两段各 21 帧、`loop=0`、延迟与 `timing.json` 一致（10ms 取整）、页面尺寸 320×568 / 1280×720 |

### 7.8 仍待主代理（不要当成通过）

- **320 / 360 实机复核查询重叠**：7.2 / 7.3 只到 CSS 与代码层面，**没有**在设备上量过。
  请复测：展开牌型轨道后左侧本人头像下的名字/筹码与最左档不再重叠、9 个两字按钮可读、
  手牌 6 张与主按钮完整。
- **六人手机**：仍未测。
- 主代理报告的实机结论（由主代理经 cua 实测，以下只是转述，不是本轮复现）：
  6 人桌面出牌 / 加牌 / 下注 / 跟注 / 同意、defense 锁定、`Escape` 抽屉均通过；
  320 与 360 双人真实 iframe 视口下手牌 6 张完整、头像不挡主操作——
  **但查询重叠正是本轮修正待复核的那一点**。
- 真实读屏播报、菜单 `aria-expanded` 实际值、`oninput` 同步：本轮均无浏览器验证。

---

## 验证记录（上一轮 2026-10-16 收尾，真实执行；当前数以第 7 节为准）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 全部测试 | `npm test`（沙箱内 `listen EPERM`，放开沙箱执行） | **9 个文件、108 passed**。我新增 3 个 client 测试文件（`net/__tests__/cursor.test.ts`、`__tests__/pending.test.ts`、`views/__tests__/shortStatus.test.ts`）；共享工作区里另有协作方加入的 `__tests__/responsiveContract.test.ts`、`components/__tests__/breathPhase.test.ts`（不是我写的），它们与当前实现一致、一起跑绿 |
| 类型检查 | `npx tsc -p packages/{client,shared,server}/tsconfig.json --noEmit` | 三包 exit 0 |
| 生产构建 | `npm run build` | server esbuild + client vite 成功（client js 101.82 kB / css 193.51 kB） |
| 图集未变 | `node scripts/build-character-atlas.ts` + sha256 对比 | atlas.png/svg/json 与重跑前逐字节一致 |
| 角色数据与图集复算 | `node /private/tmp/verify-atlas.ts`（解码 atlas.png 后与 `drawCharacter()` 逐像素比对，全部走生产模块） | **10 项全过**：图集 1400×300（cell 48 + gap 2）；387072 个像素 0 处不一致；6 人 × 5 动作均 ≥60% 帧互不相同；呼吸帧脚底恒为第 44 行（= `ANCHORS.foot.y`）；六人轮廓最小差异 27.2%；出牌释放点 = 释放帧手部中心（x 40 · y 30.5）且该帧牌已离手；出牌 620ms、呼吸 3360ms 都在要求区间；`atlas.json` 与源模块一致 |
| 扇形几何 | `/tmp/fan-sweep.mjs`（按 CSS 数值建模，非浏览器） | 320–760px 全部无溢出，最紧余量 54.6px |
| dev 端口（只读） | `lsof -nP -iTCP:5173/3000/9431 -sTCP:LISTEN` | 5173（vite）与 3000（node）仍在跑，未做任何启停；上一轮提到的 9431 已不存在 |

未做（按交接约束）：浏览器实机检查（浏览器只允许 cua_repl，最终手机与六人验收归主代理），
因此 320/360 的实机几何、动画观感、教学局形象仍未在设备上确认。

---

## 8. 最后三处边界修补 + 牌型查询浮层（2026-10-16 本轮，DeepSeek 执行代理）

本轮只做交接的 4 件事。**没有重绘图片、没有改玩法/规则、没有启停 5173/3000、没有开浏览器、没有提交。**
真实改动只有两个文件：`packages/client/src/views/TableView.ts`、`packages/client/src/styles/table.css`
（另加本文件与 `requirements.md` 第 16 节的如实记录）。

### 8.1 第 1–3 项：已在上一执行代理中断前写进工作区，本轮逐条核对后未再改动

- **第 1 项（手机对手区让开铭牌）**：`≤760px` 的 `#opponents` 是 `margin-top: clamp(80px,12vh,108px)`
  （320×568 → 80px > 铭牌底边 ≈67.5px）；`@media (max-height:640px)` 的 `clamp(40px,7vh,62px)` 声明在前，
  同优先级下被手机块覆盖；人物没有被任何规则隐藏；`#you-zone` 的 `overflow-y:auto` 安全阀保留。
- **第 2 项（六人手机出牌段）**：`≤760px` 下 `.opp-segs .play-segment` 内的暗牌从第二张起
  `display:none`（不占横向空间），公开的 `top`（第 0 张、带 `.up`）与首张暗牌保留，段边框与段边界照旧，
  `.seg-count` 绝对定位到右上角、仍是真实张数。按 CSS 数值算段宽 320px 下 = 26+16+4+2 = **48px**（要求 44–50px）。
  本人 `#you-played`、桌面与摊牌面板不受影响。
- **第 3 项（anim.ts）**：`document.hidden` 时 `resetQueue()` + 最新快照后**直接 return**（anim.ts:39）；
  `round_start` 作为权威边界当场 `resetQueue()` 且该事件本身仍被处理（anim.ts:43）；
  `add_chips` / `fold` 在两个 `await` 之后补 `if(token!==epoch)return;` 再 `report()`（anim.ts:85-86）。
- 这三项本轮**只读核对、没有再改**；`anim.ts` 本轮零改动。

### 8.2 第 4 项：查询浮层（本轮实现）

- `<section id="rank-reference" hidden>` 从 `#you-zone` 里移到 **`#table` 直接子节点**
  （TableView.ts:29-36，`</main>` 之后）；id 与所有事件绑定、`aria-controls` 不变。
  它是纵向 flex 项时会被挤成十几像素高（1280×600 实测 18px / 内容 102px），移出后展开收起都不推动手牌与主按钮。
- CSS：绝对定位浮层（`left:50% / translateX(-50%) / z-index:35 / flex:none / width:min(760px,94vw) /
  max-height:30vh / overflow-y:auto`，table.css:394-408；高屏那一档在 410-417），默认收起靠 `[hidden]`。
- **底边位置对交接数值做了一处调整并说明原因**：`≤640px` 高度沿用 `calc(var(--card-h) + 179px)`；
  `>640px` 高度改用 `calc(var(--card-h) + 149px + 6.1vh + 1.4 * clamp(22px,3.4vh,34px))`。
  179 是按低高度档量的（那一档手牌行 `card-h+22`、间距 2px、操作栏 46px）；高度回到 641px 以上后
  手牌行变 `card-h+34`、操作栏 52px、5 处间距回到 0.9vh、`#table` 下边距 1.6vh，组合行又随 `3.4vh` 字号长高，
  照搬 179 会在 1280×720 压住"当前组合"下缘约 10px。新表达式各项都取自同一份 CSS 数值，
  若以后改 `#current-type` 字号或 `#you-zone` 间距需要同步。
- 手机覆盖：`left:auto; right:6px; transform:none; width:calc(100% - 80px)`（左侧留给本人座位），
  九档按钮 `border-width:1px` + `padding:3px 0` + `white-space:nowrap` + 10px 字号，
  面板 `padding:6px`、`#rank-rail` `margin:3px 0`，`≤400px` 再收一档。
- 两个面板互斥：打开查询合上 `#bet-details` 的 `open`；打开 `#bet-details` 收起查询。
  只切 `open`，输入框节点与已填金额都不动。
- 另外：摊牌 / 终局一开就收起查询浮层（浮层现在在 `#you-zone` 之外，否则会压结算面板）。

### 8.3 本轮真实验证

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 全部测试 | `npm test` | **7 个文件、88 passed**（沙箱内服务端 `listen EPERM`，放开沙箱重跑；本轮未增删测试） |
| 类型检查（三包） | `npx tsc -p packages/{client,shared,server}/tsconfig.json --noEmit` | 三包 exit 0 |
| 生产构建 | `npm run build` | 成功：client js 102.41 kB / css 193.98 kB |
| 打包产物抽查 | `grep` dist/*.css、dist/*.js | 四条 `#rank-reference` 规则都在；模板里 `<section id="rank-reference">` 已在 `</main>` 之后 |
| 浮层几何推算 | `/private/tmp/rank-overlay-model.mjs`（按 CSS 数值建模，**非浏览器**） | 320×568 / 360×640 / 1280×600 / 1280×720 / 900×620 / 1440×900：浮层底边距组合行顶 18.5–22.4px、距手牌行顶 50–72px；320px 面板 240px、左边缘 74px、九列每列 24.4px |

### 8.4 仍待主代理（不要当成通过）

- **手机与 1280×600/720 的浮层实机复测**：本轮只有 CSS 数值推算与构建产物抽查，没有开浏览器。
  请复测：展开查询后手牌 6 张、主按钮、当前组合都不被遮；320/360 下面板不与本人座位、名字/筹码重叠；
  九档两字按钮 10px 单行可读；关掉查询完整牌桌立刻回来。
- **互斥逻辑**：查询 ↔ 投入面板的互相收起、金额/输入值保留，本轮没有在浏览器里点过。
- **前一轮遗留（第 7.8 / 15.8 节）里与查询相关的两条**（手机查询面板与本人座位重叠、320/360 实机复核）
  在本次改成浮层后**换了实现方式**，仍需实机复核，不能按旧结论通过；其余遗留项（动画观感、性能、
  教学局形象、读屏播报）状态不变。
