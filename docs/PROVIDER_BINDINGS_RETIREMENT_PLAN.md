# provider_bindings 退役实施方案（P3-1）

> 决策日期：2026-06-19
> 导入兼容策略：**不兼容旧导出**（导入只认 `generation_configs`，binding 相关代码全删）。
> 前置依赖：本方案重写 `models.py` / `provider_config.py` / settings 路由·schemas / 前端，这些文件当前正被并行特性占用
> （deck/ppt 生成改动 `models.py`；常量抽取重构改动 `provider_config.py`）。**建议在上述在途特性提交后再执行本方案**，避免覆盖未提交改动。

## 背景：provider_bindings 当前职责

`provider_bindings` 是 `generation_configs` 落地前的旧配置载体，现已退化为：
- **内部镜像**：`_sync_compat_provider_bindings` 在每次生成配置增删改时从 `generation_configs` 回写该表。
- **写端点** `PUT /api/settings/provider-bindings/{purpose}`：前端实际已不调用（`SettingsPage.tsx` 仅在导入预览显示 `bindingCount`）。
- **设置响应 `bindings` 字段**：前端不再消费。
- **导出**：`provider_bindings` 列表 + `provider_binding_count` / `provider_binding_purposes`。
- **导入**：旧格式从 `provider_bindings` 派生 `generation_configs`（`settings_import_normalizers.py`）。

运行时生成调度只用 `generation_configs`，不读 `provider_bindings`。

## 后端改动

1. **迁移 `20260619_0063_drop_provider_bindings.py`**（破坏性，down 重建空表）
   - `upgrade`: `op.drop_table("provider_bindings")`（idempotent：先查表存在）。
   - `downgrade`: 重建表结构（id/purpose/provider_kind/provider_profile_id/model_settings_json/config_json/created_at/updated_at + `uq_provider_bindings_purpose`）。

2. **`infrastructure/db/models.py`**：删除 `ProviderBinding` 类。

3. **`infrastructure/provider_config.py`**：
   - 删 `ProviderBinding` import。
   - 删 `_sync_compat_provider_bindings` 及其全部调用点（`add_generation_config` / `update_generation_config` / `archive_generation_config` / `update_provider_binding` / `ensure_provider_config_bootstrapped`）。
   - 删 `list_provider_bindings` / `update_provider_binding` / `_get_binding` / `_require_binding`。
   - `ensure_provider_config_bootstrapped` 中「从 existing_bindings 派生 config」分支（`_add_generation_config_from_binding`）保留与否：仅用于首次从旧 binding 行迁移；表删除后该分支永不命中，一并删除 `_add_generation_config_from_binding`。
   - `provider_config_tables_available` 中对 binding 的探测（若有）移除。

4. **`presentation/routes/settings.py`**：
   - 删 `PUT /provider-bindings/{purpose}` 端点、`_serialize_provider_binding`。
   - 设置响应去掉 `bindings=[...]`。
   - 导出去掉 `provider_bindings` / `provider_binding_count` / `provider_binding_purposes`。
   - 导入：`_normalize_import_generation_configs` 不再接收/使用 `bindings` 参数，只读 `document.generation_configs`；删 `_normalize_import_bindings` 调用。

5. **`presentation/routes/settings_import_normalizers.py`**：删 `_normalize_import_bindings`；`_normalize_import_generation_configs` 去掉 `bindings` 形参与基于它的派生分支。

6. **`presentation/schemas/settings.py`**：删 `ProviderBindingResponse` / `ProviderBindingUpdateRequest` / `SettingsProviderBindingExport`；`SettingsState` 去 `bindings`；导出/预览 schema 去 `provider_bindings` / `provider_binding_count` / `provider_binding_purposes`。

7. **测试**：`test_auth_settings_runtime_config.py`、`test_provider_payloads.py`、`test_image_sessions.py` 及导入导出相关用例去除 binding 断言；`test_migrations_database_constraints.py` 若有 binding 契约则更新。

## 前端改动

1. `lib/types.ts`：删 `ProviderBinding` / `ProviderBindingUpdateRequest` / `SettingsState.bindings` / `SettingsExportProviderBinding` / `provider_bindings` / `provider_binding_count` / `provider_binding_purposes`。
2. `lib/api.ts`：删 `updateProviderBinding` 及相关 import。
3. `pages/SettingsPage.tsx`：删导入预览的 `bindingCount` 展示（或改为只显示 generation_config 计数）。
4. `pages/settings/importExport.ts`：删 `providerBindingCount` 与 `provider_bindings` 校验分支。
5. `lib/i18n.ts`：删 binding 相关文案（含 `settings.migration.bindingCount`）。
6. 测试：`pages/SettingsPage.test.ts`、`lib/generationConfigs.test.ts` 去 binding 断言。

## 验证

- 后端：`just backend-migrate`（dev）→ `just backend-test`；确认导出不再含 provider_bindings、导入旧文件给出明确「格式不支持」错误（破坏性变更预期）。
- 前端：`just web-build` + `pnpm --dir web test:run`。
- 迁移：`alembic upgrade head` 单一 head；`test_alembic_upgrade_head_supports_sqlite` 通过。

## 风险与回滚

- 破坏性：旧导出文件无法再导入（已确认接受）。
- drop table 不可逆数据（该表为派生镜像，无独有业务数据，影响可接受）；migration down 仅重建空表结构。
- 执行前需确保 deck 特性与常量重构已提交，避免覆盖其对 `models.py` / `provider_config.py` 的未提交改动。

---

## 执行进度（2026-06-19，进行中 / 未提交）

> 状态：**已全部完成并验证**——后端 506 测试通过、`ruff check src` 全过、迁移单一 head `20260619_0064`；前端 `web-build`(tsc) 通过、352 前端测试通过。源码无 `ProviderBinding` 表残留（仅保留 `normalize_provider_binding_*` payload 助手，历史命名，不碰表）。未提交。

### ✅ 已完成（后端源码）
- `models.py`：删除 `ProviderBinding` 类。
- `provider_config.py`：删 `ProviderBinding` import、`_sync_compat_provider_bindings` 及全部调用点、`list_provider_bindings`、`update_provider_binding`、`_add_generation_config_from_binding`、`_get_binding`、`_require_binding`、`_provider_config_exists` 的 binding 子句、`ensure_provider_config_bootstrapped` 的 existing_bindings 分支。保留 `_normalize_binding_*` / `_validate_binding_*` / `normalize_provider_binding_*`（仅为 payload 处理，不碰表）。
- `routes/settings.py`：删写端点 `PATCH /provider-bindings/{purpose}`、`_serialize_provider_binding`、响应 `bindings`、导入 bundle 的 binding 字段/计数、`delete(ProviderBinding)`、相关 import。
- `routes/settings_export.py`：删导出 `provider_bindings` 块与 import。
- `routes/settings_import_normalizers.py`：删 `_normalize_import_bindings`；`_normalize_import_generation_configs` 去 `bindings` 形参与旧格式派生（改为只读 `document.generation_configs`）。
- `schemas/settings.py`：删 `ProviderBindingResponse` / `ProviderBindingUpdateRequest` / `SettingsProviderBindingExport`、`ProviderConfigResponse.bindings`、`SettingsExportDocument.provider_bindings`、preview 的 `provider_binding_count` / `provider_binding_purposes`。
- 迁移 `20260619_0064_drop_provider_bindings.py`（chain on 0063 deck）。

### 🔴 剩余（未做）
1. **后端测试改红→绿**（generation-configs 端点已有充分覆盖，binding 端点测试多为冗余，可删）：
   - `test_provider_payloads.py:~2734`、`test_image_sessions.py:~2602`：把直接建 `ProviderBinding(...)` 行的测试设置改为 `add_generation_config(...)`（默认分组）或等价。
   - `test_auth_settings_runtime_config.py`：删与 generation_config 覆盖冗余的 binding 端点测试函数（约 6-8 个：`..._validates_bindings`、`..._openai_chat_completions_..._bindings`、`test_real_image_binding_switches_visible_poster_mode_to_generated`、`..._google_gemini_..._bindings`、`..._openai_chat_image_..._bindings`、`test_resolvers_ignore_legacy_rows_after_provider_bindings_exist`、`test_settings_import_rejects_..._invalid_bindings`）；修残留断言（`payload["bindings"]`、导出 `provider_bindings`、preview `provider_binding_count/purposes`、导入 document 改用 `generation_configs`）。
2. **前端清理**：`lib/types.ts`（删 ProviderBinding/UpdateRequest/SettingsState.bindings/SettingsExportProviderBinding/provider_binding_*）、`lib/api.ts`（删 updateProviderBinding）、`pages/SettingsPage.tsx`（删 bindingCount 展示）、`pages/settings/importExport.ts`（删 providerBindingCount/provider_bindings 校验）、`lib/i18n.ts`（删 binding 文案含 `settings.migration.bindingCount`）；`pages/SettingsPage.test.ts` / `lib/generationConfigs.test.ts` 去 binding 断言。
3. **验证**：`just backend-test`、`just web-build`、`pnpm --dir web test:run`、迁移 apply 到 head。

### 行为保全确认（删测试安全）
binding 写端点曾携带「配置真实图片 provider → `poster_generation_mode=generated`」行为；已确认该行为在 generation_config **创建端点**（`settings.py:1638`）、**更新端点**（`1686`）、**导入**（`982`）均已复制，故删除 binding 专属测试不丢行为。

### 已完成的测试改写
- `test_provider_payloads.py`、`test_image_sessions.py`：`ProviderBinding(...)` 行设置已改为 `add_generation_config(..., resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID, commit=False)`，并去 import。

### test_auth_settings_runtime_config.py 精确清单（待做）
- 删 import 第 32 行 `ProviderBinding,`。
- **删除 7 个 binding 端点专属测试函数**（与 generation_config 覆盖冗余、行为已保全）：
  - `test_settings_import_rejects_unknown_version_and_rolls_back_invalid_bindings`
  - `test_provider_config_api_masks_keys_preserves_blank_update_and_validates_bindings`
  - `test_provider_config_supports_openai_chat_completions_text_profiles_and_bindings`
  - `test_real_image_binding_switches_visible_poster_mode_to_generated`
  - `test_provider_config_supports_google_gemini_profiles_bindings_and_import`
  - `test_provider_config_supports_openai_chat_image_profiles_and_bindings`
  - `test_resolvers_ignore_legacy_rows_after_provider_bindings_exist`
- **修改 4 个测试的残留断言**（改用 generation_configs，不再用 bindings）：
  - `test_settings_export_includes_...`：删 `payload["provider_bindings"]` 断言。
  - `test_settings_import_preview_and_commit_replaces_runtime_and_provider_config`：导入文档改用 `generation_configs`、删 `provider_binding_count/purposes`、删 `ProviderBinding` 查询断言。
  - `test_provider_bootstrap_merges_matching_legacy_text_and_image_config` / `test_provider_bootstrap_splits_different_legacy_connections`：`payload["bindings"]` 断言改为 `payload["generation_configs"]`。

### ⚠️ 修订（逐函数核查后）
原「删 7 个函数」判断不完全准确：多数函数用 **binding 写端点 `PATCH /provider-bindings/{purpose}` 做 setup**，但实际测的是真实行为（导出、bootstrap、poster 模式、resolver 优先级），**不能整删**，需把 setup 改写为 generation_config 端点 / `add_generation_config`，否则丢非 binding 覆盖。已确认 `test_settings_import_rejects_...`（原计划删）实为**混合测试**（还覆盖版本拒绝/分组改名/legacy 迁移/缺 owner/回滚），已做外科式修复保留。

逐函数处置（约 12 个，均待做，除已完成项）：
- ✅ `test_settings_import_rejects_unknown_version_and_rolls_back_invalid_bindings`：已去 binding 子块与 binding 回滚断言（保留其余）。
- `test_settings_export_includes_...`：setup 的 `PATCH /provider-bindings/text` 改 generation_config；删 `payload["provider_bindings"]` 断言。
- `test_settings_import_preview_and_commit_...`：导入文档 `provider_bindings`→`generation_configs`；删 `provider_binding_count/purposes`、`ProviderBinding` 查询。
- `test_provider_bootstrap_runs_on_app_startup`：`ProviderBinding` 查询断言改 generation_configs。
- `test_provider_bootstrap_merges_...` / `test_provider_bootstrap_splits_...`：`payload["bindings"]`→`payload["generation_configs"]`。
- `test_provider_config_api_masks_keys_..._validates_bindings`：binding PATCH 改 generation_config 端点（或删，masking 已由 profile 测试覆盖）。
- `test_provider_config_supports_openai_chat_completions_..._bindings` / `..._google_gemini_..._bindings` / `..._openai_chat_image_..._bindings`：setup 改 generation_config 端点；导出断言去 binding（这些 provider kind 的 config 往返已由 generation_config 测试覆盖，亦可删）。
- `test_real_image_binding_switches_visible_poster_mode_to_generated`：行为已由 generation_config 创建端点覆盖（settings.py:1638），可删。
- `test_resolvers_ignore_legacy_rows_after_provider_bindings_exist`：建 `ProviderBinding` 行的前提已不存在，可删。
- 删 import 第 32 行 `ProviderBinding,`。
