# SESSION-CONTEXT — 新会话快速恢复

> **用途**：跨会话恢复开发上下文的单一入口。记录"代码本身/git 看不出"的判断、进行中工作、范式与陷阱。
> **使用话术**（新会话开场直接粘）：
> > 先读 `docs/SESSION-CONTEXT.md` 和 `docs/OPTIMIZATION.md` 恢复上下文，然后继续 F1/F2/…（说明要做哪项）。约束：纯机械下沉、不改已有实现、re-export 测试锁定符号保持 `*.test.ts` 零改、每步保持全绿、不要提交（我自己提交）。

最近更新：2026-06-20 ｜ 分支：`feature/multi-generate`

---

## 1. 优化路线总览

完整清单与每项详情见 `docs/OPTIMIZATION.md`。状态速览：

| 项 | 内容 | 状态 |
|---|---|---|
| B1 | image/text provider 工厂改注册表 | ✅ 完成 |
| F1 | 拆 `web/src/pages/SettingsPage.tsx`(7629) | ✅ 基本完成 → **1663 行 -78%**（见 §2） |
| B3 | 拆 `backend/.../routes/settings.py`(2561) | 🔶 已落两刀 →~2010 行 |
| B2 | 拆 `provider_config.py`(2239) | 🔶 仅抽常量层；深拆暂缓 |
| F2 | 拆 `web/src/lib/i18n.ts`(5815) | ⬜ 未动 |
| F3 | 拆 `web/src/index.css`(8294) | ⬜ 未动 |
| U1/U2/U3 | 字体 token / 圆角 scale / dusk 去裸色覆盖 | ⬜ 未动 |

> ⚠️ `index.css` / `i18n.ts` / `routes/settings.py` 正处于 `feature/multi-generate` 进行中改动，F2/F3/B3 续作待分支收尾再推，避免冲突。

---

## 2. F1 收尾详情（SettingsPage 拆分）

- **结果**：`SettingsPage.tsx` 7629 → **1663 行（-78%）**，约 5970 行下沉到 `web/src/pages/settings/`。
- **主文件现状**：仅剩 orchestrator —— state / mutation / query / effect + section→组件 路由 JSX + 对话框簇。这是本仓库范式下的**自然终点**：
  - 同类容器拆分后 `ImageChatPage.tsx` 3509 行、`InspirationDetailPage.tsx` 4089 行——SettingsPage 1663 已是**三者最精简**。
  - **全仓库没有任何页面把 state 抽成 custom hook**；再下沉=偏离范式+改实现，不在"机械下沉"范围。
- **`settings/` 布局**：~15 个逻辑 `.ts`（`generationConfig` / `providerConfigOps` / `sections` / `configTestState` / `configDrafts` / `configHelp` / `configSource` / `providerModels` / `providerForm` / `resourceGroups` / `draftValues` / `loginPageTemplate` / `importExport` / `types`）+ `components/` 下 ~24 个展示组件（`GenerationConfigSection`=PoolSection 簇 / `ProvidersSection` / `GenerationResourceGroupSection` / `ConfigTestPanels` / `ConfigField` / `LoginPageSettingsPanel` / `SettingsMigrationPanel` / `SettingsSideRail` / `GenericConfigSection` / …）。
- **本轮（2026-06-20）新抽**：`SettingsSideRail`（左侧导航 `<aside>`，含 `handleSettingsSideRailWheel`）、`GenericConfigSection`（prompts/upload/queue/外观/安全 五类通用配置表单段，三种布局）。配套 `sections.ts` 导出 `SettingsSection` / `ConfigCategoryGroup` 类型。

---

## 3. 拆分范式（F2/F3 及任何巨型文件复用）

1. **move-out + import-back**：把一簇符号移到新模块，原文件 import 回来——调用处零改。
2. **逻辑→`.ts`、JSX→`.tsx` 组件**；纯函数/状态机/类型优先（最易测、零 JSX）。
3. **re-export 测试锁定符号**：`*.test.ts` 从原文件 import 的符号，移走后原文件必须 `export { x }` 或 `export { x } from "./mod"`，使测试**零改**。
4. **每步保持全绿**：抽一簇 → 立即验证 → 再抽下一簇。中途绝不留红。
5. 组件内部专用 helper **不导出**；只导出对外用到的。
6. `useI18n` 来自 `lib/preferences`；className 常量集中在 `settings/components/styles.ts`；共享类型入 `settings/types.ts`。

---

## 4. 验证命令 & 环境陷阱

```bash
cd web
pnpm exec tsc --noEmit -p tsconfig.app.json          # 快速类型检查
pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters -p tsconfig.app.json  # 列未用 import（平时关）
pnpm build                                            # 完整：tsc×2 + vite，~5s
pnpm test:run                                         # 352 vitest（49 文件）
```

- **rtk/ugrep hook 噪声**：shell 输出混入 `command not found: _encode/_decode`，所有命令管道追加 `| grep -vaE "command not found"` 过滤。
- **`grep -c` 陷阱**：匹配 0 行时退出码 1，会中断 `&&` 链；用 `;` 分隔或 `|| true`。
- **noUnusedLocals 平时关**：抽取后用它枚举孤立 import 最快；eslint `no-unused-vars` 不自动修。
- 后端定向测试：`uv run --directory backend pytest tests/path::name`。

---

## 5. 架构审计 durable 结论（2026-06）

- **抽象强项**：三类基础设施都有 ABC+工厂——`ImageProvider`(5 实现) / `TextProvider`(3 实现) / `StorageBackend`(Local/S3)，均带 mock。
- **巨型文件清单**（维护短板，方法级粒度其实健康，问题是全塞一个文件）：前端 `SettingsPage.tsx`(已拆) / `i18n.ts`(5815) / `InspirationDetailPage.tsx`(4089) / `ImageChatPage.tsx`(3509) / `index.css`(8294)；后端 `routes/settings.py`(2561) / `provider_config.py`(2239) / `canvas_templates.py`(2125) / `image_sessions.py`(2101)。
- **拆分范本**：`application/inspiration_workflow/`、`pages/inspiration-detail/`、`pages/image-chat/`、`pages/settings/`。
- **Trellis 文档**（`.trellis/spec/`）与代码高度对齐，以代码为准时几乎无需改文档。

---

## 6. 约束备忘（用户偏好）

- 提交由**用户自己做**——不要 `git commit`。
- 改代码前看 `git status`：M/?? 自由改；已提交代码改前需确认。
- 跨 CWD 文件写入（含 `~/.claude` memory）需确认——所以恢复上下文用**本项目内**的本文件，不写 `~/.claude`。
- 沟通：think in English, **respond in Chinese**, 简洁。
