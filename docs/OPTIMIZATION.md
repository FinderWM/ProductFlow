# ProductFlow 优化指引（Optimization Guide）

> 本文是 2026-06-19 全项目架构/代码/UI 审计的**可执行落地细则**。
> 它衔接已有文档，不重复其结论：
> - 架构健康度与风险见 `docs/ARCHITECTURE_HEALTH_REVIEW.md`
> - UI 设计审查与路线见 `docs/ui-design-audit-2026-06-09.md`
> - 模块结构与四层职责见 `docs/ARCHITECTURE.md`、`CLAUDE.md`
>
> 本文只回答一件事：**当前哪些地方该优化、具体怎么改、改完怎么验。**
> 每项均带代码证据（`file:line`）、目标、步骤、验证命令、优先级与工作量估计。

---

## 0. 优先级总览

| 编号 | 优化项 | 类别 | 优先级 | 工作量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| F1 | 拆分 `SettingsPage.tsx`(7629) | 前端 | P0 | 大 | 中 | ✅ 基本完成（→1663 行，-78%）：逻辑层(generationConfig/providerConfigOps/sections/configTestState/configDrafts…) + ~24 组件（GenerationConfigPoolSection/ProvidersSection/GenerationResourceGroupSection/SettingsSideRail/GenericConfigSection 等）全抽；主文件仅剩 orchestrator（state/mutation/query/JSX 路由），已是三大页面容器最精简（vs ImageChatPage 3509 / InspirationDetailPage 4089）。再下沉需 custom-hook 化 state，全仓库无先例、属改实现，定为自然终点 |
| F2 | 拆分 `lib/i18n.ts`(5821) 按命名空间 | 前端 | P1 | 中 | 低 | ✅ 已完成（按语言物理拆分：i18n.ts 5821→41 行索引 + `i18n/{zh,en,ja}.ts` 各~1930 行；`Record<keyof typeof zhCN>` 跨文件强校验键集一致；对外导出/`TranslationKey`/`useI18n` 零改） |
| F3 | 拆分 `index.css`(8294) 按层 | 前端/UI | P1 | 中 | 低 | ⏸ 受阻：index.css 当前被 deck-generation 特性 M，物理重排级联敏感、会与在飞特性 diff 冲突，应待该特性合并后再做 |
| F4 | 收口 `InspirationDetailPage`(4077)/`ImageChatPage`(3509) 残余 | 前端 | P2 | 中 | 中 | ✅ InspirationDetailPage 收口（11 纯函数→`inspiration-detail/workflowNodeHelpers.ts`）；ImageChatPage 已提交受保护，未动 |
| U1 | 字体纳入设计 token | UI | P0 | 小 | 低 | ✅ 已完成（字体族 + 字阶 token 入 :root，body 消费） |
| U2 | 圆角收敛为 radius scale | UI | P1 | 中 | 低 | ✅ 基本完成（109 处 73→107 token 化；新增 workspace 专属 radius token；仅余 2×20px 混合上下文 + 6 特例 0/50%/inherit） |
| U3 | dusk 去除裸 Tailwind 色覆盖层 | UI | P1 | 大 | 中 | 🔶 有界安全切片已落：pf-* 语义类(surface/ink/hairline) + 棘轮门禁 `scripts/check-bare-colors.mjs` + 基线(71 文件/3954)；样板 `GenerationResourceGroupSection` 已迁移验证(35→2，仅留半透明)。其余按下文 recipe 增量；committed 页逐一确认，ImageChatPage/DeckPanel + dusk 覆盖块保留 |
| B1 | image/text provider 工厂注册表化 | 后端 | P1 | 小 | 低 | ✅ 已完成 |
| B2 | 拆分 `provider_config.py`(2239) | 后端 | P2 | 中 | 中 | 🔶 第一刀已落（常量层抽出），深拆暂缓 |
| B3 | 拆 `routes/settings.py`(2561) | 后端 | P2 | 中 | 中 | 🔶 已落三刀（导入规范化 + 导出序列化 + ORM→响应序列化器 `settings_serializers.py`，2561→1844 行 -28%）；再切属端点 sub-router 重构，于 settings.py 被特性 M 期间风险大，暂止 |

> 建议执行顺序：U1 → B1（快赢、低风险）→ F1 → F2/F3 → U2/U3 → B2/B3 → F4。
> **当前进度（2026-06-21 更新）**：已完成 F1 ✅、F2 ✅、F4 ✅(InspirationDetailPage)、U1 ✅、U2 ✅、B1 ✅；B2 🔶(一刀)、B3 🔶(三刀)。
> **受阻并明确暂缓的项**：F3 / U3 / B2 深拆 / B3 sub-router —— 共同根因是它们都需要在 `index.css` / `provider_config.py` / `settings.py` 等**正被 deck-generation 在飞特性 M 的文件**上做高 churn 重排，或需触碰**已提交的 `ImageChatPage.tsx`**、**deck 特性的 `DeckPanel.tsx`**，或属破坏性整文件重写、或需五主题目视 QA。这些超出"安全自动完成"边界，应待 deck-generation 特性合并后作为独立任务推进（每项的就绪方案见下文各节）。

---

## 一、前端巨型文件拆分

总原则：**照搬项目已有的成功范式**——`pages/inspiration-detail/`、`pages/image-chat/` 已用「页面目录 + 子面板组件 + 纯逻辑 ts」拆开，新拆分一律对齐这套结构，不发明新模式。

### F1. 拆分 `SettingsPage.tsx`（7629 行，P0）✅ 基本完成（2026-06-20，→1663 行 -78%）

**收尾（2026-06-20）**：在前序逻辑/组件下沉基础上，再抽生成配置逻辑层 `generationConfig.ts`、供应商缓存/测试载荷 `providerConfigOps.ts`、区块定义/分类 `sections.ts`；组件侧抽出 `GenerationConfigPoolSection`/`ProvidersSection`/`GenerationResourceGroupSection`，并将主渲染中的侧栏 `SettingsSideRail`、通用配置表单段 `GenericConfigSection` 也下沉为展示型组件。全程"move-out + import-back + re-export 测试锁定符号"，`SettingsPage.test.ts` 零改。最终 1663 行（-78%），仅余 orchestrator（state/mutation/query/effect + section→组件 路由 + 对话框簇）。对比同类容器 ImageChatPage 3509 / InspirationDetailPage 4089，已是三者最精简；进一步把 state 抽成 custom hook 全仓库无先例、属"改实现"，定为机械下沉的自然终点。验证：tsc + `--noUnusedLocals`=0 + `pnpm build` + 352 vitest 全绿。

**已完成（第一刀）**：登录页模板逻辑（`LOGIN_PAGE_TEMPLATE_*` 5 个常量 + `LoginPageTemplateConfigField` 接口 + `isLoginPageTemplateId`/`isLoginPageMode`/`loginPageTemplateIdFromConfigKey`/`loginPageTemplateConfigItem`/`parse`/`serialize` 6 个函数，约 95 行）抽到 `pages/settings/loginPageTemplate.ts`；内部共享类型 `DraftValue` 抽到 `pages/settings/types.ts`。`SettingsPage.tsx` import 回所需常量/函数并 **re-export 6 个函数**，故 `SettingsPage.test.ts` 等测试零改。验证：352 前端测试全过 + `just web-build` 类型检查/构建干净。对齐既有 `settings/importExport.ts` 拆分范式。

**已完成（第二刀）**：配置测试草稿/记录状态机（7 个接口 + `DEFAULT_*`/`LEGACY_*`/`*_STORAGE_KEY` 常量 + `normalize*`/`read*`/`write*`/`*RecordForKey`/`mark*`/`clear*` 共 ~290 行）抽到 `pages/settings/configTestState.ts`；`SettingsPage.tsx` import 内部所用 29 个符号并 re-export 测试锁定的 12 函数 + 2 类型。验证：352 前端 vitest 全过 + `just web-build` 干净（另一窗口退役收尾后已恢复）。

**已完成（第三刀）**：运行时配置草稿助手（`DraftSnapshot`/`ConfigDraftState` 2 接口 + `multiSelectValue`/`draftFromItem`/`draftValuesEqual`/`draftsFromConfig`/`configValuesFromChangedDrafts` 5 函数）抽到 `pages/settings/configDrafts.ts`；re-export `draftsFromConfig`/`configValuesFromChangedDrafts`。验证：352 vitest + web-build 全绿。

**后续步骤**（同范式继续下沉）

**现状证据**
- 单文件含 ~144 个顶层声明，类型 `SettingsSectionId` 有 14 个 section（`web/src/pages/SettingsPage.tsx:122-147`）：
  `providers / resourceGroups / text / image / prompts / upload / queue / globalTemplates / layoutAppearance / loginPage / weather / notifications / security / migration`。
- 大量可测纯函数已就地拆好（normalizer / 状态机，如 `SettingsPage.tsx:463-989`），方法粒度没问题，**问题是全塞一个文件**，cohesion 差、改一个 section 要在 7000 行里翻找。

**目标**：每个 section 一个面板组件文件，主页面只做「section 路由 + 公共状态容器」，主文件降到 ~400 行。

**步骤**
1. 新建目录 `web/src/pages/settings/`。
2. 先抽**纯逻辑层**（零 JSX、最易测）到 `settings/` 下：
   - `testDrafts.ts` ← `normalize*ConfigTestDraft` / `read*` / `write*` / `mark*` / `clear*` 系列（`SettingsPage.tsx:526-823`）。
   - `configDrafts.ts` ← `draftFromItem` / `draftValuesEqual` / `draftsFromConfig` / `configValuesFromChangedDrafts`（`:836-893`）。
   - `loginPageTemplate.ts` ← `isLoginPageTemplateId` / `parse*` / `serialize*`（`:942-989`）。
   - 同步迁移对应的 `*.test.ts`（这些函数已被测试覆盖，迁移后测试即回归网）。
3. 每个 section 抽一个面板组件 `settings/panels/<Section>Panel.tsx`（14 个），props 只接 `config / drafts / onChange` 等已存在的句柄。
4. 主文件 `SettingsPage.tsx` 保留：`activeSection` 状态（`:6065`）、`handleActiveSectionChange`（`:6196`）、section→panel 的 map、公共布局壳。
5. `settingsSectionIds()` / `shouldShow*Panel()`（`:463-471`）移到 `settings/sections.ts` 作为单一事实源。

**验证**
```bash
pnpm --dir web test:run        # 迁移后的纯逻辑测试必须全绿
just web-build                 # 类型检查 + 构建
```
**红线**：纯逻辑函数的导出签名不变（其它文件/测试在 import），先搬文件、后改内部，分多个 commit。

### F2. 拆分 `lib/i18n.ts`（5821 行，P1）✅ 已完成（2026-06-21）

**落地结果**：采用**按语言物理拆分**（非按命名空间）——`i18n.ts` 5821→41 行，仅保留 locale 类型/常量、`import` 三语言、re-export `zhCN/enUS/jaJP`、`translations`/`TranslationKey`/`isLocale`/`resolveLocale`/`interpolate`/`translate`；文案搬到 `i18n/zh.ts`、`i18n/en.ts`、`i18n/ja.ts`（各~1930 行）。`enUS`/`jaJP` 保留 `Record<keyof typeof zhCN, string>` 注解，tsc 跨文件强制三语言键集与中文完全一致（拆漏键即编译失败，自带安全网）。对外导出名、`TranslationKey` 联合类型、37 处 `useI18n()` 调用方全部零改。验证：tsc 干净 + 352 vitest 全绿 + `pnpm build` 干净。

**为何按语言而非按命名空间**：按命名空间需把三个扁平 locale 对象（各~1928 键）重排为 per-ns 的 {zh,en,ja} 分组，是高风险的键级重组（易漏/错配键）；按语言是连续区间纯搬移、零键重排，且 `Record<keyof typeof zhCN>` 让 tsc 兜底校验。达成了 F2 的核心目标（拆小单文件、保契约不变）。若后续要 per-namespace 细分，可在各 locale 文件内再切，属独立增量。

---
（以下为原始拆分设计，保留备查）

**现状**：单文件维护全部文案，多人改易冲突、加载体积大。

**目标**：按命名空间分文件，保持 `TranslationKey` 类型与 `useI18n()` 对外不变。

**步骤**
1. 建 `web/src/lib/i18n/`，按现有 key 前缀切分（如 `settings.* / layout.* / workspaceAppearance.* / gallery.* / inspiration.* / common.*`）成 `locales/zh/<ns>.ts`、`locales/en/<ns>.ts`。
2. `i18n/index.ts` 合并各命名空间并**保留原 `TranslationKey` 联合类型推导**与导出名，调用方零改动。
3. 一次迁一个命名空间，每次 `just web-build` 验证类型联合是否完整。

**验证**：`just web-build`（关键看 `TranslationKey` 是否仍覆盖全部使用点，类型不报缺 key）。

### F3. 拆分 `index.css`（8294 行，P1）

**现状**：token、classic、workspace 三套 appearance、动效、各页面组件样式同处一文件（证据：`@theme`/`:root` 在 `:5-52`，30+ `@keyframes`，105 处 transition）。

**目标**：按职责拆为多文件，`index.css` 仅做 `@import` 编排。

**建议结构**
```
web/src/styles/
├── tokens.css          # :root / .dark / 三套 workspace appearance 的 --pf-* 定义
├── base.css            # @theme、reset、body/#root
├── classic.css         # pf-app/pf-page/pf-panel/pf-side-* 等 classic 原语
├── workspace.css       # pf-workspace-*、pf-shell-* workspace 专属
├── animations.css      # 全部 @keyframes + prefers-reduced-motion 降级
└── components.css       # 跨布局复用的组件类（pf-metric-card 等）
```
**验证**：`just web-build`；人工切换 light/dark/mist/sage/dusk 五态目视无回归（对照 `docs/ui-design-audit` 的覆盖矩阵）。

### F4. 收口 `InspirationDetailPage`(4077) / `ImageChatPage`(3509)（P2）

**现状**：两者已部分拆到 `inspiration-detail/`、`image-chat/` 子目录，但主文件仍偏大。
**目标**：把主文件里残留的内联子组件/逻辑继续下沉到既有子目录，主文件回归「编排 + 顶层状态」。
**做法**：按已有子目录范式，识别主文件中 >150 行的内联块，逐个抽为子组件；不新建目录结构。
**验证**：`pnpm --dir web test:run` + `just web-build`。

---

## 二、UI 设计 token 补全

总原则：**所有视觉量纲都进 token**，组件只消费语义 token，主题切换 = 换 token 值、零特例覆盖。

### U1. 字体纳入设计体系（P0，最高性价比）

**现状证据**：`index.css` 内 font-family 全为 `inherit`（`:4074` 等 8 处），**无 `--pf-font` token、无字阶**，排版只吃浏览器默认 sans——这是整套视觉语言唯一没被设计的维度。

**目标**：建立字体族 + 字阶 token，与 `--pf-*` 同源管理。

**步骤**
1. 在 `tokens.css`（见 F3）的 `:root` 增加：
   ```css
   --pf-font-sans: "Inter", "Noto Sans SC", system-ui, -apple-system, sans-serif;
   --pf-font-mono: "JetBrains Mono", ui-monospace, monospace;
   /* 字阶：size / line-height 成对 */
   --pf-text-xs: 0.75rem;   --pf-leading-xs: 1.1rem;
   --pf-text-sm: 0.875rem;  --pf-leading-sm: 1.25rem;
   --pf-text-base: 1rem;    --pf-leading-base: 1.5rem;
   --pf-text-lg: 1.125rem;  --pf-leading-lg: 1.75rem;
   --pf-text-xl: 1.5rem;    --pf-leading-xl: 2rem;
   ```
2. `body`/`#root` 设 `font-family: var(--pf-font-sans)`，等宽场景（代码/JSON 配置）用 `--pf-font-mono`。
3. 在 `@theme` 注册为 Tailwind 字体族，使 `font-sans`/`font-mono` 工具类指向 token。
4. 若引入 Web 字体，用 `font-display: swap` 并自托管，避免 CLS。

**验证**：`just web-build`；目视确认中英文混排、配置 JSON 等宽显示正常。
**注意**：这是 app 级视觉变更，先在一个页面灰度对比再全量。

### U2. 圆角收敛为 radius scale（P1）

**现状证据**：约 **33 种**不同 `border-radius` 取值散落——`999px`×32、`24px`×12、`28px`×8、`22px`×7、`29px`×4、`17px`×3…（其余 18/19/20/26/30/34/38/42px 等各 1–2 次）。无 token，组件圆角各调各的。

**目标**：收敛为 4–5 档 token，覆盖 95% 场景。

**步骤**
1. `tokens.css` 增加：
   ```css
   --pf-radius-sm: 8px;     /* 输入框、chip 内元素 */
   --pf-radius-md: 14px;    /* 默认卡片、面板 */
   --pf-radius-lg: 24px;    /* 大卡片、对话框 */
   --pf-radius-xl: 32px;    /* 落地页大容器 */
   --pf-radius-pill: 999px; /* 胶囊按钮、徽标 */
   ```
2. 全量替换 `index.css`（及拆分后各 css）里的裸值为 token；零散异值（17/19/22/26/29/34/42px）就近归并到最近档位。
3. workspace 若需更大圆角，在 appearance 块内**覆盖 token 值**，而非新写裸值。

**验证**：`grep -oE "border-radius: [^;]+" web/src/styles/*.css | grep -v "var(--pf-radius" ` 应接近空（仅剩 `0`/`50%`/`inherit` 等特例）。

### U3. dusk 去除裸 Tailwind 色覆盖层（P1，偏架构）🔶 free 文件 must-fix 真漏色已收口（2026-06-22）

**收尾（2026-06-22，free 文件 must-fix）**：以「dusk 覆盖块白名单」为基准做真漏色判定（漏色 = 组件层裸中性色 **不在** `index.css` dusk 覆盖选择器内，故 dusk appearance 轴下渲染为亮色）。普查全部 free（M/??）文件，剥离 `dark:`/`hover:` 等变体后，真漏色仅余：①边框类 `border-slate-300/400`、`border-slate-200/{opacity}`（perl 批量 → `pf-hairline-strong`/`pf-hairline`）；②共享类常量 `styles.ts:50` `PROVIDER_DRAWER_INPUT_CLASS` 的非变体 `border-slate-300` → `pf-hairline-strong`（`.ts` 文件被首轮 `*.tsx` glob 漏扫，单独补）。`InspirationDetailPage` 残留 3 处装饰性半透明灰条（`bg-slate-200/70` 分隔条 ×2、`bg-slate-300` 抽屉手柄 ×1）按 recipe「半透明/装饰特例保留勿动」不动。验证：tsc=0 + `pnpm build`=0 + 352 测试全绿；基线 3954→3934。**free 文件无遗留真漏色。**

**未尽（committed，需逐一确认）**：已普查 committed 文件真漏色清单（28 文件，剥离 `dark:`/`hover:` 变体后实际命中约 23 处）。**已修干净边框漏色 9 处**（实色 `border-slate-300` → `pf-hairline-strong`，保留配对 `dark:` 变体使 dark 观感零变、仅修 dusk 外观轴漏色）：MarkdownEditor 空预览框、SelectField 分隔线、InspectorPanel/TemplateManagementPage 空状态虚线框 ×3、TemplateGroupsPanel/InspirationCreatePage 时间线连接点、TopNav badge 激活态、HelpPage 序号徽标。基线 3934→3925；tsc+build+352 测试全绿。**剩余刻意跳过（低收益/非干净漏色）**：语义实色激活态 `bg-slate-900`、状态点 `bg-zinc-400`、装饰 `text-slate-300`/拖拽手柄/连接线/骨架 `bg-slate-200`、故意深底代码块 `bg-slate-950`、半透明项。禁区 `ImageChatPage.tsx`/`DeckPanel.tsx` 不动。

**已落地（基础设施 + 样板，全绿）**
1. **语义工具类**（`index.css`，pf-table-panel 后）：`.pf-surface`(=--pf-panel)、`.pf-surface-soft`(=--pf-panel-soft)、`.pf-ink`(=--pf-text)、`.pf-ink-muted`(=--pf-muted)、`.pf-hairline`(=--pf-border-soft)、`.pf-hairline-strong`(=--pf-border)。**关键**：light 模式下这些 token 与对应 slate 裸色**精确等值**（--pf-panel=#fff=bg-white、panel-soft=slate-50、text=slate-900、muted=slate-500、border-soft=slate-200），故替换零视觉变化，并自动适配 dark/mist/sage/dusk（各主题已定义同名 token，含 dusk 的 #292d23/#e8decb 等）。
2. **棘轮门禁** `web/scripts/check-bare-colors.mjs`：按文件记裸色计数基线 `scripts/bare-colors-baseline.json`(71 文件/3954)，计数超基线即失败、迁移降数则通过——与分支状态无关。`node scripts/check-bare-colors.mjs` 校验；`--update` 迁移后收紧。（未接入 package.json，因其为已提交文件；CI 接入待定。）
3. **样板**：`pages/settings/components/GenerationResourceGroupSection.tsx` 全量迁移（slate 族 35→2，仅留 2 处半透明 scrim/frosted），tsc+build+352 测试全绿。

**迁移 recipe（增量、每文件验证）**
- 映射：`text-slate-950/900/800`→`pf-ink`；`text-slate-700/600/500/400`→`pf-ink-muted`；实色 `bg-white`→`pf-surface`；`bg-slate-50/zinc-50`→`pf-surface-soft`；`border-slate-200/zinc-200`→`pf-hairline`；`border-slate-300`→`pf-hairline-strong`。**同时删除配对的 `dark:` 变体**（pf-* 自带主题适配）。
- **保留勿动**：半透明变体(`bg-white/80`、`/55` scrim 等，转 solid 会丢磨砂感)；非 slate 族语义色(emerald/indigo/violet/rose/amber)；`w-px` 分隔条等特例。
- 每文件迁完跑 `pnpm build` + `node scripts/check-bare-colors.mjs --update`。该页裸色清零后，方可删 `index.css` 对应 dusk 覆盖选择器。

**剩余清单（按 free/committed 分流）**
- **free（M/??，可直接做）**：settings/components 其余(GenerationConfigSection 107、ProvidersSection 70、SettingsSideRail 24 等，多异构含半透明，需逐项判断)、InspirationDetailPage.tsx(174)、SettingsPage.tsx(21)、App.tsx(7)。
- **committed（改前需逐一确认）**：InspirationCreatePage/InspirationListPage/RbacPage/GalleryPage/TemplateManagementPage/HelpPage 等高频页。
- **禁区**：`ImageChatPage.tsx`(已提交受保护)、`DeckPanel.tsx`(deck 在飞特性)——连同 dusk 覆盖块一并待这些文件迁移后再清。
- **门槛**：full 迁移需五主题(light/dark/mist/sage/dusk)目视 QA，自动化无法验证视觉，故按页人工抽检 dusk。

---
（以下为原始审计证据与设计）

**现状证据**：`index.css:385-447` 有 **36 处**选择器强行重写原生 Tailwind 颜色类——`.bg-white` / `.bg-slate-50` / `.text-slate-900` / `.border-zinc-200` 等。根因是**部分组件用了裸 Tailwind 颜色而非 `--pf-*` token**，dusk 暗主题只能全局打补丁兜底。后果：脆弱，新页面只要用裸色就会在 dusk 下漏色。

**目标**：组件统一消费 `pf-*` 语义类/token，删除 dusk 的裸色覆盖块，主题切换零特例。

**步骤（增量、可分页面推进）**
1. 盘点裸色使用点：
   ```bash
   grep -rnE "\b(bg|text|border)-(white|slate|zinc|gray)-[0-9]{2,3}\b" web/src/pages web/src/components
   ```
2. 为高频语义建立/复用 `pf-*` 工具类（如 `pf-surface` = panel 背景、`pf-text` = 主文本、`pf-line` = 边框），其值在四套主题 token 中各自定义。
3. 逐页把裸色替换为 `pf-*` 类；该页所有裸色清零后，删除 `index.css` 中对应的 dusk 覆盖选择器。
4. 加门禁防回潮：ESLint/stylelint 或 CI grep，禁止新代码在组件层直接用裸 `bg-white`/`text-slate-*`（允许在 token 定义文件内）。

**验证**：每收敛一页，切到 dusk 目视该页无突兀亮块；覆盖块删除后 `git grep 'appearance="dusk"\] \.\(bg-\|text-\|border-\)'` 持续下降直至清零。
**对齐**：此项正是 `.trellis/spec/frontend/ui-layout-guidelines.md`「不要让 classic 依赖 workspace token、组件吃语义 token」契约的落地补强。

---

## 三、后端工厂注册表化与配置拆分

### B1. image/text provider 工厂改注册表（P1，快赢）✅ 已完成（2026-06-19）

**落地结果**：image/text 工厂已改为注册表分派，行为完全不变，`test_provider_payloads`(56) 与 4 个工厂相关 workflow 测试套件(56) 全绿。
- `image/base.py` / `text/base.py` 新增 `_*_PROVIDER_FACTORIES` 表 + `register_*_provider` + `create_*_provider`（未注册：image 报错、text 回退 mock，保持原行为）。
- `image/factory.py` / `text/factory.py` 改为**集中式注册** + 查表分派，删除 if-elif。
- **实现修正（以代码为准）**：注册采用 factory.py 集中式（非"各 provider 模块自注册"）——因为 storage 本身就是单文件内集中注册，集中式才是真正对齐，且爆炸半径最小（只碰 4 个文件）。

**原始证据（改造前）**
- storage 已用注册表（最佳实践）：`register_storage_backend(name, factory)`（`infrastructure/storage.py:187`），`get_storage_backend` 按名查表。
- 但 image/text 工厂曾是 if-elif 硬编码（`image/factory.py`、`text/factory.py`），新增 provider 要改 factory + `provider_config.py`(2239) 两处，与 storage 风格不一致。

**后续新增 provider 的姿势**（注册表已就位）
1. 实现 `XxxImageProvider(ImageProvider)`，`__init__(self, provider_config)` 签名对齐其它 provider。
2. 在 `image/factory.py` 顶部加一行 `register_image_provider("xxx", XxxImageProvider)`（无参 provider 用 `lambda _config: Xxx()`）。
3. `get_image_provider` 无需改动；`provider_kind` 字符串值不可改（DB 配置/前端在用）。

**验证命令**
```bash
uv run --directory backend pytest tests/test_provider_payloads.py
uv run --directory backend ruff check src
```

### B2. 拆分 `provider_config.py`（2239 行，P2）🔶 第一刀已落（2026-06-19）

**已完成**：抽出**纯常量层** → 新文件 `infrastructure/provider_config_constants.py`（用途/类型/能力常量、结构化输出 keys、`LEGACY_PROVIDER_CONFIG_KEYS`、`RESOURCE_GROUP_KEY_RE` 等），`provider_config.py` 改为 import 并 re-export，**所有外部 import 路径不变、调用方零改动**。ruff 干净；provider/settings/scheduler 定向测试(139) 全绿。

**暂缓深拆的原因（重要）**：
1. 内部高度耦合——公开 rules 函数（`capability_for_provider_kind`/`validate_*`/`normalize_*`）只是薄包装，实际委托给一串纯私有 helper（`_capability_for_kind`/`_validate_*`/`_normalize_text_structured_output_dict` 等），且与 `TextStructuredOutputConfig`、`_optional_str/_optional_bool` 交织；
2. 公开面被**正在改动中的 `routes/settings.py`** 大量 import；
3. `provider_config.py` 本身正被**并发编辑**（期间新增 `reconcile_generation_config_concurrency` 等）。

完整拆包需删除/整文件重写原文件（破坏性操作，须确认），且应等并发改动收敛后作为独立任务推进。

**目标**：按职责切分，降低单文件认知负荷。

**建议结构**（保持对外导入名不变，用 `__init__.py` 或 facade 再导出）
```
infrastructure/provider_config/
├── __init__.py        # 对外 facade，re-export 现有公共函数
├── constants.py       # ✅ 已先行抽为 provider_config_constants.py，后续并入此处
├── rules.py           # 纯校验/规范化（capability/validate/normalize 及其私有 helper）
├── bootstrap.py       # ensure_provider_config_bootstrapped 及默认值
├── image_config.py    # resolve_image_provider_config + image 专属
├── text_config.py     # resolve_text_provider_config + text 专属
└── crud.py            # update_generation_config 等读写
```
**验证**：`uv run --directory backend pytest`（provider/settings 相关全套）；import 路径不变则调用方零改。

### B3. 拆分 `routes/settings.py`（2561 行，P2）🔶 已落两刀（2026-06-19）

**已完成（第一刀）**：配置导入规范化纯函数簇（8 个，约 395 行）→ `routes/settings_import_normalizers.py`。
**已完成（第二刀）**：配置导出序列化簇（`_export_config_value`/各 `_*_export`/`_build_settings_export_document`，6 个，约 155 行）→ `routes/settings_export.py`；协议常量 `SETTINGS_EXPORT_SCHEMA_VERSION`/`COMPATIBILITY` 抽到 leaf `routes/settings_constants.py`（导入解析与导出构建共用，避免循环）。`settings.py` 仅 import `_build_settings_export_document`。累计 2561 → ~2010 行。ruff 自动移除仅导出用的 schema import，印证边界干净；全套 510 测试绿。
- **边界**：`_parse_settings_import_document`、`_normalize_runtime_import_config`、`_build_settings_import_bundle`、`_apply_settings_import_bundle`/`_upsert_*` 因依赖 settings 内部符号/DB 写入留原处。

**后续可继续**：按资源把端点拆成 `routes/settings/` 子路由（`config.py`/`generation_configs.py`/`import_export.py`），各自 `APIRouter` 由 `settings.py` 用 `include_router` 合并（保持 `router` 对外不变）；导出序列化层（`_*_export`/`_build_settings_export_document`）可同样下沉。
**验证**：`uv run --directory backend pytest tests/test_route_rbac_contract.py tests/test_auth_settings_runtime_config.py`，确认路由路径与 RBAC 契约不变。

---

## 四、通用红线（所有改动遵守）

1. **行为不变优先**：以上全是重构/治理，**对外契约（API 路径、provider_kind、TranslationKey、公共函数签名、CSS 类名语义）必须保持**，否则属于功能变更，需另立需求。
2. **小步多 commit**：先搬运后改造，每步可独立 `git`，每步过验证命令。遵循仓库 Conventional Commit（中文摘要），如 `refactor: 拆分 SettingsPage 配置抽屉面板`。
3. **测试先行护栏**：拆分前确认相关测试存在（前端 `pnpm --dir web test:run`、后端 `just backend-test`）；缺测试的高风险块（如 B2/B3）先补一条冒烟测试再动。
4. **改前看 git 状态**：已提交代码遵循开闭原则优先扩展；本文所列文件多为长期演进文件，动手前 `git status` 区分边界。
5. **文档同步**：涉及 spec 契约的改动（U3、B1）完成后，用 `trellis-update-spec` 同步 `.trellis/spec/`，保持文档与代码对齐。

---

_生成于 2026-06-19，基于当时代码快照。文件行号会随演进漂移，以 `file:line` 为线索定位、以实际代码为准。_
