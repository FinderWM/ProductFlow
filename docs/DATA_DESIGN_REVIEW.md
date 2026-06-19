# Inspiration One 数据层设计审查与整改规划

> 审查日期：2026-06-19
> 范围：后端数据库表结构、数据权限、索引、读写性能、并发与锁。
> 代码基线：`backend/src/inspiration_one_backend/`，分支 `feature/multi-generate`。
> 阅读对象：`infrastructure/db/models.py`、`infrastructure/provider_config.py`、`application/generation_config_runtime.py`、`application/admission.py`、`infrastructure/queue.py`、`application/auth.py`、`presentation/deps.py`、`application/ownership.py`、`domain/rbac.py` 及 `backend/alembic/versions/` 全部 59 个迁移。
> 结论用途：作为数据层整改的入口文档，配套优先级清单与逐项落地方案。

---

## 0. 实施状态（2026-06-19 已落地并验证）

已实施并通过验证：ruff 全过；后端 **510 测试全过**；迁移 `0061`/`0062` 可 apply 到 head。

| 项 | 状态 | 实际改动 |
|---|---|---|
| P0-1 认证热路径 bootstrap | ✅ 已改 | `deps.py:get_current_user` 移除每请求 `ensure_auth_bootstrapped`（依赖 lifespan 启动 + 登录入口已初始化）；注册表自愈改由低频 admin 端点 `/api/rbac/permissions` 显式执行（`routes/rbac.py`）。 |
| P0-2 current_concurrency 泄漏 | ✅ 已改 | `provider_config.reconcile_generation_config_concurrency` + `api.py` lifespan 启动归零。 |
| P1-1 / P2-1 缺失外键索引 | ✅ 已改 | 迁移 `20260619_0061` + `models.py`：`image_session_assets.session_id` 等 10 个关系列索引。 |
| P2-2 冗余 enabled 索引 | ✅ 已改 | 迁移 `20260619_0062` + `models.py`：删 13 个低基数单列 `enabled` 索引（含 `enabled` 前缀的组合索引保留）；同步更新 `test_migrations_database_constraints.py` 契约。 |
| P1-2 合并每请求 session | ⛔ 放弃 | 与已落地的 auth 会话失效特性「独立 auth session」设计冲突（见 `.trellis/.../lightweight-auth-invalidation/design.md`）。 |
| P3-2 删 price/source_note | ⛔ 撤回 | 复查发现两列为活跃特性：`schemas/inspirations.py` 序列化返回 + 生成提示词占位符 `{price}`/`{source_note}`，**非废弃**，原判断有误。 |
| 维度8 Risk-3 IntegrityError 竞态 | ✅ 已核查 | 核心并发路径（node run 抢占 `execution.py:414`、gallery 保存 `gallery.py:572`、workflow 创建 `mutations.py:321`、tag/resource_library）均已捕获 `IntegrityError` 幂等返回；已有回归测试（`test_gallery.py:441` `created is False`）。无需改动。 |
| P3-3 调度打分批量查询 | ✅ 已改 | `provider_config._candidate_generation_configs` 预取当日 `GenerationConfigDailyStat` 一次（`_today_stats_by_config`），打分查询由 2N 次降为 1 次，行为不变（`test_generation_config_scheduler.py` 通过）。 |
| P3-1 下线 provider_bindings | ⏸ 推迟（独立任务） | 爆炸半径过大：后端 64 处/5 文件 + 前端 7 文件 + 3 后端&2 前端测试，且属**设置导入导出契约**（删除改变导出格式、破坏旧导出兼容）。需先定向后兼容策略，作为独立规划任务/PR，不在数据层修复批次内。 |

> 本轮与一个已落地的 auth 会话失效特性（`AuthUser.session_revoked_after`/`last_login_at`/`last_seen_at` + 迁移 `0060`）并存，相关文件改动已对齐其新基线。

---

## 1. 总体结论

**数据层健康度：7.5 / 10。**

- **权限模型**（角色 + 个人资源双粒度）与**核心并发抢占逻辑**（原子条件 UPDATE + advisory lock）设计扎实，是亮点。
- 主要欠账集中在三处：
  1. **认证热路径每请求重复执行全量幂等初始化**（最大性能浪费）。
  2. **少量热点外键列缺索引 + 多个低基数布尔索引冗余**。
  3. **硬杀场景下并发计数器 `current_concurrency` 无对账，可能永久卡死配置调度**。
- 全库**刻意不使用外键约束**（迁移 `0040` 明确移除业务约束），完整性完全依赖应用层，是需要长期警惕的结构性取舍。

无需立即阻断功能开发的灾难性问题，但 P0 两项建议尽快处理。

---

## 2. 八维度审查发现

### 2.1 表结构与业务贴合度 / 无用部分

整体贴合 DDD 分层，但有历史包袱：

| 问题 | 证据 | 评价 |
|---|---|---|
| 全库无 FK 约束，关系全用 `String(36)` 软关联 | 迁移 `20260603_0040_remove_database_business_constraints`；`models.py` 全部 `primaryjoin=lambda` | 刻意为之，但孤儿数据无 DB 兜底，需应用层对账 |
| `provider_bindings` 已沦为 `generation_configs` 的派生镜像 | `provider_config.py:1567 _sync_compat_provider_bindings`；`list_provider_bindings` 注释 "Compatibility view for the old settings UI" | 每次配置变更都回写镜像，纯为旧 UI 兼容，可规划下线 |
| `Inspiration.price` / `source_note` 疑似只写不读 | 写：`use_cases.py:488-489`；无 `Inspiration.price` 读取/序列化点 | 源于 `20260607_0044_rename_legacy_domain_to_inspirations`（旧"商品"域遗留），疑废弃列 |
| 三套并存生命周期列：`enabled`+`disabled_at`+`disabled_by` / `deleted_at`+`deleted_by` / `archived_at` | `Inspiration` / `ImageSession` / `SourceAsset` 等多表 | 语义重叠（停用/删除/归档），列数膨胀 |

### 2.2 数据权限（角色 + 个人资源粒度）—— ✅ 实现到位

双层校验，粒度确实落到「角色 + 个人资源」：

- **角色层**：路由依赖 `require_api_permission(API_X)`（`deps.py:47`），按 `role_api_permissions` 校验（`auth.py:315 user_has_api_permission`），admin 短路放行。
- **个人资源层**：应用层 `ensure_actor_can_mutate_owner(owner, actor, actor_is_admin)`（`ownership.py:38`）；列表查询强制按归属过滤——`use_cases.py:362/671`、`image_sessions.py:199/453`、`resource_library.py:214/635` 均 `owner_user_id == actor_user_id`。
- **治理隔离**：admin 不能直接改他人资源（`ownership.py:48`），必须走独立 `require_admin` + `API_RESOURCES_MODERATE` 治理通道（`moderation.py`）——权责分离干净。

> 残余风险：归属校验靠「每个写操作都记得调用」，依赖 `test_route_rbac_contract.py` 做契约兜底，新增写接口需确保不漏 owner 校验。

### 2.3 / 2.4 表结构与索引合理性

**亮点**：
- 部分唯一索引做乐观并发保护：`uq_workflow_node_runs_one_active_per_node`、`uq_inspiration_workflows_one_active_per_inspiration`、`uq_source_assets_one_original_per_inspiration`、`uq_image_gallery_entry_tags_active`（`models.py:1044/892/1096/1615`）。
- 组合索引贴合查询：`ix_canvas_templates_scope_owner_entry_category_sort`、gallery `(resource_group_id, enabled, created_at)`。

**问题 A — 热点外键列缺索引**（selectinload 触发 `WHERE fk IN (...)` 全表扫）：
- `ImageSessionAsset.session_id` 无索引（`models.py:1341-1344` 仅索引 `owner_user_id`/`enabled`），却是每会话加载资产主路径（`image_sessions.py:165/170`），资产随轮次/候选累积 → **最值得补**。
- `CopySet.inspiration_id`、`CreativeBrief.inspiration_id`、`PosterVariant.inspiration_id/copy_set_id` 全无索引（类无 `__table_args__`）。
- `WorkflowRun.workflow_id`、`WorkflowNode.workflow_id`、`WorkflowEdge.workflow_id/source_node_id/target_node_id` 无索引；run 历史增长后按 workflow 拉取退化。

**问题 B — 过度索引（13 个单列 `enabled` 布尔索引）**：`models.py:195/273/344/383/455/482/721/794/1103/1214/1265/1343/1526`。布尔列基数极低，规划器通常不用；只增写入开销；部分与组合索引重复（如 `ix_image_gallery_entries_enabled` 被 `(enabled, created_at)` 前缀覆盖）。

### 2.5 写入性能 / 批量 —— 基本良好

- 批量写法正确：RBAC 授权用 `add_all`（`auth.py:536-537/794/805`）。
- workflow 多节点/多边创建循环 `session.add()`（`mutations.py:309-318`）但循环内无 commit/flush，SQLAlchemy 2.0 flush 时自动 `executemany`/`insertmanyvalues` 批量化——非反模式。
- 多候选生图结果随 provider 调用增量落库（供进度展示），属固有增量，不宜强行批量。
- 未发现「循环内逐次 commit」或「N 次单点查后逐条写」热点反模式。

### 2.6 查询性能 / 分步 / 减 join

**亮点**：`selectinload` 用得充分（gallery 29 处、moderation 41 处、use_cases 19 处）规避 N+1；gallery 列表把标签、浏览数拆成分步批量查再内存组装（`gallery.py:401/424/490`）而非大 join；队列排名用 2 次批量查 + Python 排序。

**头号问题 — 每个认证请求 3 个 DB session + 全量 bootstrap**：
- 单个受保护请求开 3 个独立 session/连接：`get_current_user`（`deps.py:25`）、`require_api_permission`（`deps.py:50`）、路由主 `get_db_session`。
- `get_current_user` 每请求都跑 `ensure_auth_bootstrapped`（`deps.py:26` → `auth.py:209`），无条件执行 `_ensure_registry`（`auth.py:743`）：对 7 个菜单逐个 `session.get(RbacMenu)` + 20 个权限逐个 `session.get(RbacApiPermission)` + 角色/管理员 4 次 SELECT ≈ **34 次 SELECT 往返**，末尾 `session.commit()`；部分应用函数（`auth.py:359/380/...`）再调一次，翻倍。
- 属纯幂等初始化，应仅在 `lifespan` 启动跑一次或进程级标志短路，稳态请求应为 no-op。

**次要**：调度打分 `_generation_config_score` 对每候选各发 2 条日表子查询（`provider_config.py:1847/1861`）；候选数小，可后续合并。

### 2.7 DB 计算后置到代码 —— ✅ 做得好

倾向「拉取适量数据 + Python 计算」：`generation_config_status_summary`（`provider_config.py:1202-1235`）把统计拉内存按 purpose 分组求和；队列位置 Python 排序（`generation_config_runtime.py:210`）。未见把可代码化聚合错误下沉到重 SQL。

### 2.8 表/并发锁与竞争、死锁 —— 设计正确，有 1 个泄漏风险

**强项（无 read-modify-write 竞态）**：
- 单配置并发抢占用原子条件 UPDATE：`SET current_concurrency = current_concurrency + 1 WHERE current_concurrency < max_concurrency AND (frozen_until IS NULL OR frozen_until <= now)`，靠 `rowcount` 判定（`provider_config.py:1057-1072`）。
- 释放用 `CASE WHEN current_concurrency > 0 THEN -1 ELSE 0` 防减负（`provider_config.py:1103-1110`）。
- 全局池容量再加 `pg_advisory_xact_lock`（`generation_config_runtime.py:289-303`）串行化「运行数 < 上限」检查。
- durable 任务状态以 DB 为准 + 启动恢复（`queue.py:111/199`）+ 部分唯一索引防重复活跃记录。

**风险 1（计数器泄漏，中危）**：`current_concurrency` 仅在 `release_*` 递减。正常异常已被 try/finally 覆盖（`workers.py:57/67/77`、`execution.py:676/696`）；但进程被 SIGKILL/OOM 杀于 claim 与 release 之间会泄漏计数，而 `recover_unfinished_*`（`queue.py`）只重排任务状态、**从不重置 `current_concurrency`**。默认 `max_concurrency=1` 时，一次泄漏就让该配置永久不可调度，且无对账。

**风险 2（PG-only）**：advisory lock 在 sqlite 为 no-op；生产 PG 下需保证「取锁 → 计运行数 → 把自己置 running」在同一事务内（xact 锁提交才释放）。

**风险 3（建议验证）**：并发双提交会触发「one active」部分唯一索引的 `IntegrityError`，未见显式 `except IntegrityError` 优雅处理，可能上抛 500，需补并发提交测试确认。

**死锁**：低风险——advisory lock 短小、单键、顺序一致；未见多行/多表乱序更新。

---

## 3. 优先级整改清单

| 优先级 | 项 | 位置 | 动作 |
|---|---|---|---|
| **P0-1** | 每请求全量 `ensure_auth_bootstrapped`（~34 SELECT + commit，含重复调用） | `deps.py:26`,`auth.py:209/743` | 启动一次或进程级标志短路 |
| **P0-2** | `current_concurrency` 硬杀泄漏，max_concurrency=1 时永久卡死 | `provider_config.py`,`queue.py` | 启动恢复时对账/清零计数器 |
| **P1-1** | `ImageSessionAsset.session_id` 缺索引（热点 + 累积） | `models.py:1341` | 新增迁移 + 模型索引 |
| **P1-2** | 每请求 3 个独立 DB session/连接 | `deps.py` | 合并复用单 session |
| **P2-1** | inspiration 子表 / workflow 节点边运行缺 FK 列索引 | 多表 | 按真实查询补索引 |
| **P2-2** | 13 个低基数 `enabled` 单列索引 | `models.py` 多处 | 删除独立索引，保留组合索引 |
| **P3-1** | `provider_bindings` 兼容镜像下线 | `provider_config.py` | 调研引用后分阶段移除 |
| **P3-2** | `Inspiration.price/source_note` 疑似废弃列 | `models.py:805/806` | 确认无暴露后删列 |
| **P3-3** | 调度打分 per-candidate 日表子查询 | `provider_config.py:1847/1861` | 批量预取当日 stat |

---

## 4. 详细落地方案

> 约定：所有 schema 变更必须含 Alembic revision；改动前先 `git status` 区分已提交/未提交；改动后 `just backend-migrate` → `just backend-test`。

### P0-1 认证热路径去除每请求全量 bootstrap

- **问题**：`get_current_user` 每请求触发 `ensure_auth_bootstrapped`，≈34 次 SELECT + 1 次 commit，部分链路翻倍。
- **影响**：每个认证接口固定附加数十次 DB 往返 + 一次空事务提交，并发下连接池压力显著。
- **方案**：
  1. 在 `application/auth.py` 引入进程级幂等缓存：模块级 `_AUTH_BOOTSTRAP_DONE = False`，`ensure_auth_bootstrapped` 首次成功后置 `True`，后续调用直接 `return`；提供 `reset_auth_bootstrap_cache()` 供测试。
  2. 在 `presentation/api.py` lifespan 启动阶段显式调用一次 `ensure_auth_bootstrapped()`（与 `recover_*` 同区），保证首请求前已就绪。
  3. 复查 application 层重复调用点（`auth.py:359/380/...`、provider 侧 `ensure_provider_config_bootstrapped`），统一走带缓存的入口。
- **多进程说明**：gunicorn 多 worker 每进程各 bootstrap 一次（DB 行已存在，仅置标志），安全。
- **验证**：用 SQLAlchemy `before_cursor_execute` 事件统计单请求 SQL 数，确认稳态请求 bootstrap 相关 SELECT 归零；`test_auth_settings_runtime_config.py` 回归；新增「冷启动首请求仍初始化」测试。
- **回滚**：去掉标志判断即恢复旧行为。

### P0-2 启动时对账 `current_concurrency`，消除硬杀泄漏

- **问题**：claim 增计数、release 减计数；硬杀于两者之间泄漏，恢复逻辑不重置。
- **影响**：`max_concurrency=1` 下一次泄漏即让配置永久 `current_concurrency < max_concurrency` 不成立，静默停止调度。
- **方案（单实例自托管前提，与 docker-compose 一致）**：
  1. 在 `provider_config.py` 新增 `reconcile_generation_config_concurrency(session)`：将所有 `GenerationConfigState.current_concurrency` 重算为「当前真实运行中、归属该 config 的任务数」；若难以精确归属，单实例下直接清零（启动时无任务真正在 provider 执行）。
  2. 在 `presentation/api.py` lifespan，于 `recover_unfinished_*` 之前调用一次。
  3. 文档注明：该清零假设单实例部署；若未来多实例，需改为基于 `ImageSessionGenerationTask.used_generation_config_id` + 运行中 workflow node 的精确重算，避免误清其他实例的在途 claim。
- **验证**：构造「claim 后不 release」→ 重启 → 断言计数归零且配置可再次被 claim。
- **回滚**：移除 lifespan 中的 reconcile 调用。

### P1-1 `ImageSessionAsset.session_id` 加索引

- **方案**：新增 Alembic revision：
  - `op.create_index("ix_image_session_assets_session_id", "image_session_assets", ["session_id"])`
  - `models.py` 的 `ImageSessionAsset.__table_args__` 同步追加 `Index("ix_image_session_assets_session_id", "session_id")`。
- **验证**：`just backend-migrate`；对 `selectinload(ImageSession.assets)` 触发的查询 `EXPLAIN` 确认走索引。
- **回滚**：`op.drop_index`。

### P1-2 合并每请求的多 session

- **问题**：`get_current_user`、`require_api_permission` 各自 `get_session_factory()()` 开新 session，叠加路由主 session。
- **方案**：重构 `deps.py`，让 `get_current_user` 与 `require_api_permission` 复用 `Depends(get_db_session)` 提供的同一请求级 session；注意 `get_current_user` 当前 `expunge(user)` 是为跨 session 使用，复用后可去除。保持鉴权读取不污染业务事务（必要时只读，不 commit）。
- **验证**：单请求连接数从 3 降到 1；鉴权相关测试回归。
- **回滚**：还原 deps 依赖结构。

### P2-1 补 inspiration 子表 / workflow 关系列索引

- **方案**：单个 Alembic revision 批量 `create_index`（按真实查询挑选，建议全列表）：
  - `copy_sets(inspiration_id)`、`creative_briefs(inspiration_id)`
  - `poster_variants(inspiration_id)`、`poster_variants(copy_set_id)`
  - `workflow_runs(workflow_id)`、`workflow_nodes(workflow_id)`
  - `workflow_edges(workflow_id)`、`workflow_edges(source_node_id)`、`workflow_edges(target_node_id)`
  - `models.py` 对应类同步补 `__table_args__`。
- **验证**：迁移 + 详情/历史接口 `EXPLAIN`；关注 workflow 历史多 run 场景。
- **回滚**：`drop_index` 对应项。

### P2-2 删除低基数 `enabled` 单列索引

- **方案**：Alembic revision `drop_index` 以下（保留含 `enabled` 的组合索引）：
  - `ix_image_gallery_entries_enabled`（被 `ix_image_gallery_entries_enabled_created` 覆盖）
  - `ix_inspirations_enabled`、`ix_image_sessions_enabled`、`ix_source_assets_enabled`、`ix_poster_variants_enabled`、`ix_image_session_assets_enabled`、`ix_resource_library_assets_enabled`
  - 配置类小表（`provider_profiles`/`generation_configs`/`generation_resource_groups`/`canvas_templates*`/`rbac_api_permissions`）的 `enabled` 索引可一并清理（收益主要是降复杂度）。
  - `models.py` 同步移除对应 `Index`。
- **验证**：迁移后跑全量测试；确认无查询依赖这些独立索引（组合索引已覆盖 `enabled` 前缀过滤）。
- **回滚**：重新 `create_index`。

### P3-1 `provider_bindings` 兼容层下线（调研先行）

- **方案**：先全局检索 `ProviderBinding` / `provider_bindings` / `_sync_compat_provider_bindings` / `list_provider_bindings` 引用；确认旧设置 UI 已切换到 `generation_configs` 后，分两步：①停止回写镜像；②迁移删表。需在 PR 描述显式标注。
- **回滚**：保留迁移 down。

### P3-2 `Inspiration.price/source_note` 废弃列确认

- **方案**：核对 `presentation/schemas/` 与前端 `web/src/lib/` 是否暴露/展示 `price`/`source_note`；若确无消费路径，新增迁移 `drop_column`（注意 `source_note` 在 `use_cases.py:489` 与 `context_long_text` 合并写入，删前需确认写入端一并清理）。
- **回滚**：迁移 down 重新加列（数据不可逆，删前需备份/确认）。

### P3-3 调度打分批量化日表查询

- **方案**：`_candidate_generation_configs` 中先按候选 id 一次性预取当日 `GenerationConfigDailyStat`，将 map 传入 `_recent_availability_score` / `_latency_score`，消除 per-candidate 2 次子查询。
- **验证**：调度单测断言行为不变、查询数下降。

---

## 5. 附录：现状速查

### 5.1 并发控制机制
- 单配置：`GenerationConfigState.current_concurrency` 原子条件 UPDATE（claim/release，`provider_config.py:1057/1103`）。
- 全局池：`pg_advisory_xact_lock`，key `text=42630001 / image=42630002`（`generation_config_runtime.py:26/289`），仅 PG 生效。
- 活跃唯一性：部分唯一索引（workflow run/node run / 原始图 / gallery tag 关联）。
- 启动恢复：`recover_unfinished_workflow_runs` / `recover_unfinished_image_session_generation_tasks`（`queue.py:111/199`）——**不含 `current_concurrency` 对账**。

### 5.2 权限校验链
- 角色：`require_api_permission(code)`（`deps.py:47`）→ `user_has_api_permission`（`auth.py:315`）。
- 个人资源：`ensure_actor_can_mutate_owner`（`ownership.py:38`）+ 列表 `owner_user_id == actor_user_id` 过滤。
- 治理：`require_admin` + `API_RESOURCES_MODERATE`（`moderation.py`）。

### 5.3 关键缺失/冗余索引一览
- 缺：`image_session_assets.session_id`、`copy_sets.inspiration_id`、`creative_briefs.inspiration_id`、`poster_variants.(inspiration_id|copy_set_id)`、`workflow_runs.workflow_id`、`workflow_nodes.workflow_id`、`workflow_edges.(workflow_id|source_node_id|target_node_id)`。
- 冗余：13 个单列 `enabled` 布尔索引（见 2.4 问题 B）。
