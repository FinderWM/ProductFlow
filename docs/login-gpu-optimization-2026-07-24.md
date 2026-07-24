# 登录页 GPU 占用分析与优化方案（2026-07-24）

范围：`web/src/pages/LoginPage.tsx` / `LoginPage.css` 的三套模板 —— `command-orbit`、`fluid-mist`、`image-lab`。
目标：保持现有动效观感与鼠标联动不变，降低静置与交互期间的 GPU 占用。
参照：工作台优化（commit `52641f1`）沉淀的 `web/src/lib/workspaceMotion.ts` 模式可直接复用。

## 一、各模板 GPU 成本清单

### 1. fluid-mist（最重）

| 项目 | 位置 | 问题 |
| --- | --- | --- |
| 4 个 `mesh-blob`（440–600px） | `LoginPage.css:1026` | `filter: blur(100px)` 使每个 blob 光栅化区域膨胀到约 1200px²，四个常驻大纹理；`mistBlobFloat` 12–16s 无限循环 |
| 自定义属性动画 | `LoginPage.css:1426`（`mistBlobFloat`） | 动画目标是注册过的 `@property`（`--blob-drift-*`），每帧主线程重算 style，无法纯合成器执行 |
| `main-card` 毛玻璃 | `LoginPage.css:1228` | `backdrop-filter: blur(24px)`；blob 永不停 → 卡片背后每帧重新采样并模糊约 460px 宽区域，两者互相放大 |
| 10 个 `sparkle-dot` | `LoginPage.css:1095` | 各跑一条无限自定义属性动画（`mistSparkle` 3s），10 条常驻主线程 style tick |

### 2. command-orbit（次重）

| 项目 | 位置 | 问题 |
| --- | --- | --- |
| `.orbit` 大圆环（≤880px） | `LoginPage.css:326` | `orbitAutonomousDrift` 13s + `orbitHeartbeat` 3.2s 双无限动画，动的全是自定义属性；`--orbit-glow` 进 background 渐变与 4 层 box-shadow（62px/90px 大模糊）→ **每帧全量重绘约 880×880 区域**，本页最贵一项 |
| 根 `::after` 环境层 | `LoginPage.css:225` | 140vw×140vh 固定层，`orbitAmbientDrift` 16s 无限（opacity+transform，可合成但层巨大） |
| `.pointer-glow` | `LoginPage.css:252` | 520px 光晕 `pointerGlowDrift` 18s 无限漂移 |
| 卡片内扫描/电噪 | `LoginPage.css:443,453` | `authSignalSweep` 4.8s + `authElectricJitter` 6.4s 无限循环，见下节"不可见浪费" |

### 3. image-lab（相对轻）

6 条无限动画基本都是 transform/opacity（可合成）：根 `::before`（140% 视口，`labBackgroundDrift` 18s）、根 `::after`（全屏 `labSoftPulse` 10s）、`.page::before`（大面板 `labBackgroundPanelFloat` 14s）、`entry-frame::before` / `entry-frame::after` / `panel-kicker` 三个元素同跑 `labFloatingKicker` 13s（可合并为一个 wrapper，省两个合成层）。

## 二、"看不见却一直在烧"的动效（已实锤）

1. **orbit `.pointer-glow` 是死代码级浪费**：transform 依赖 `--cursor-x/--cursor-y`，但全代码库无任何 JS 写入这两个变量（仅 CSS 默认值 `LoginPage.css:164`），且 `pointerGlowDrift` 的 keyframe transform 直接覆盖基础 transform —— "指针光晕"从未跟随过鼠标，只是永动漂移层；漂到 auth 卡片下方时被不透明的 `.auth-core`（背景 `#080a09`）完全遮住，仍在合成。
2. **`.orbit` 圆环右半被 auth 卡片（z-index 6、内核不透明）遮住**，但因 `--orbit-glow` 动画每帧整体重绘，被遮部分照付全款。
3. **`authSignalSweep` / `authElectricJitter`**：各自约 70% 的周期 opacity 为 0，完全不可见但动画常驻；后者带 `mix-blend-mode: screen`，强制永久维持离屏合成组。
4. **所有模板的无限动画在页面静置（有焦点但无操作）时照跑**，登录页恰是最容易被晾着的页面。浏览器只在标签页隐藏时节流，不覆盖此场景。
5. 顺带发现：lab 的 `.scan-line`（`LoginPage.css:1885`）**没有任何动画**，疑似 keyframes 丢失，目前是静止的"扫描线"（非 GPU 问题，视觉缺陷）。

## 三、优化方案（保持观感 + 鼠标联动）

按收益排序：3 > 2 > 1 > 4 > 5；mist 页收益最大。

### 方案 1：自定义属性动画改为 transform/opacity 关键帧

`orbitAutonomousDrift`、`mistBlobFloat`、`mistSparkle` 的位移/缩放直接写进 transform keyframes。指针偏移与漂移动画拆到父/子两层嵌套元素：父层跑漂移 keyframes，子层接鼠标联动 CSS 变量，合成结果与现状一致，但全部转为纯合成器动画（不再逐帧主线程 style 重算）。

### 方案 2：orbit 光晕呼吸与几何分离

`--orbit-glow` 驱动的辉光改为独立叠加伪元素，预烘焙高/低两档 glow 图层，仅动 `opacity` 做 crossfade，消除每帧 880px box-shadow + 渐变重绘。心跳节奏（3.2s keyframe 时间点）保持不变。

### 方案 3：mist blob 降本

- 首选：`blur(100px)` 替换为等效的预模糊 radial-gradient 背景（大半径 blur ≈ 更软的渐变 stop，可调到肉眼无差），删除滤镜；
- 或将 4 个 blob 合并到单层/canvas。
- `backdrop-filter` 保留；blob 静止后它自然不再逐帧重采样。

### 方案 4：闲置暂停生命周期（工作台同款）

复用 `workspaceMotion.ts` 模式（`data-*-motion` dataset → `animation-play-state: paused`）：

- `document.hidden` 时暂停（已有工作台先例）；
- 新增：指针离开页面/静止 N 秒后暂停或降档，一动鼠标即恢复 —— 静置 GPU 归零，观感无损；
- 指针联动写入沿用 8px 量化（`WORKSPACE_POINTER_QUANTUM_PX`）避免亚像素级逐帧改写。

### 方案 5：削掉纯浪费

- `.pointer-glow`：要么真接上指针联动（复用 `workspacePointerCssValues`），要么删除死变量只保留漂移语义；
- `authSignalSweep` / `authElectricJitter`：改为 JS 每 5–6s 触发一次 one-shot class 的间歇动画，空闲期无活跃动画层，并移除常驻 `mix-blend-mode` 组（触发期间临时加类）;
- lab 三个 `labFloatingKicker` 动画元素合并到一个 wrapper；
- 顺手修复 `.scan-line` 缺失的动画（或确认设计上就是静态并改名）。

## 四、验证方式

- Chrome DevTools Performance 面板：对比优化前后静置 30s 的 GPU 轨道与 "Rasterize Paint" 耗时；
- `chrome://gpu` + Activity Monitor（macOS）观察 WindowServer/GPU 占用；
- Rendering 面板开 "Paint flashing"：优化后静置时应无持续闪绿（orbit 圆环当前每帧闪）；
- 视觉回归：三模板 desktop/mobile 截图对比（仓库已有 `.tmp-login-*` 基线截图习惯）。
