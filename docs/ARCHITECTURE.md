# Inspiration One Architecture

[中文](ARCHITECTURE.md) | [English](ARCHITECTURE.en.md)

当前架构健康度、已完成治理和剩余风险见 `docs/ARCHITECTURE_HEALTH_REVIEW.md`；本文保持为系统结构说明。

## 1. 系统概览

Inspiration One 由前端、后端 API、后台 worker、PostgreSQL、Redis 和本地文件存储组成：

```text
React/Vite web
  -> FastAPI backend
    -> PostgreSQL metadata
    -> Redis/Dramatiq queue
    -> local storage files
    -> text provider / image provider
  -> Dramatiq worker
    -> same database, queue, storage and providers
```

默认自托管路径由根目录 `docker-compose.yml` 驱动。`docker compose up -d --build` 会构建并启动 FastAPI 后端、Dramatiq worker 和 nginx-served Web 静态站点；API/worker 通过 `.env` 中的 `DATABASE_URL` / `REDIS_URL` 连接 `/Users/yunlong/project/self/env` 维护的共享 PostgreSQL 容器 `libowpg` 和 Redis 容器 `libowredis`，并通过 `STORAGE_BACKEND` 切换本地存储或共享对象存储。`STORAGE_BACKEND=local` 时共享挂载到容器 `/app/storage` 的持久化 storage，未设置 `STORAGE_HOST_PATH` 时使用 Docker named volume `inspiration-one-storage`；迁移旧 systemd 生产环境时，可以设置 host-only 变量 `STORAGE_HOST_PATH=/home/cot/Inspiration One-release/shared/storage` 将既有宿主机 storage 目录 bind-mount 到 `/app/storage`，容器运行时仍保持 `STORAGE_ROOT=/app/storage`。`STORAGE_BACKEND=minio` 或 `STORAGE_BACKEND=s3` 时，API/worker 使用 S3 兼容对象存储，`STORAGE_ROOT` 只承担本地缓存和缩略图派生。后端容器启动时先执行 Alembic 迁移，再启动 `uvicorn`。

生产更新入口是 `just release`，底层调用 `scripts/release.sh` 执行 Compose 配置校验、停止 legacy user-level systemd 服务（`inspiration-one-backend.service`、`inspiration-one-worker.service`、`inspiration-one-web.service`，用于释放旧发布占用的 29280/29281 端口）、`docker compose up -d --build --remove-orphans` 和 HTTP health checks。`just release-dry-run` 只做配置校验与计划输出，不停止旧服务、不构建、不启动容器。普通更新不会删除 Docker volumes。

本地热重载开发仍由根目录 `justfile` 驱动：共享中间件 `libowpg`、`libowredis` 和 `libowminio` 运行后，API、worker、前端分别由 `just backend-run`、`just backend-worker`、`just web-dev` 启动。开发环境使用 `.env.dev` 中的 `STORAGE_BACKEND=minio` 和 `STORAGE_ROOT=./backend/storage-dev`，其中 `STORAGE_ROOT` 只作为本地缓存目录；脚本会从 `/Users/yunlong/project/self/env/minio.env` 注入 `S3_*` 配置。不要通过 shell-sourcing 生产 `.env` 来启动本地开发进程。

## 2. 后端分层

后端代码位于 `backend/src/inspiration_one_backend/`，按以下层组织：

- `presentation/`：FastAPI app、路由、鉴权依赖、Pydantic schemas、上传校验。
- `application/`：灵感产物、文案、海报、画廊、图片会话、灵感产物工作流等用例逻辑。灵感产物工作流已拆成 graph /
  mutations / query / execution / context / artifacts / dependencies 等 page-facing use case 模块，由
  `inspiration_workflows.py` 作为兼容 facade 对外暴露。
- `domain/`：稳定枚举，如任务状态、素材类型、工作流节点类型。
- `infrastructure/`：SQLAlchemy models/session、队列、storage、text/image provider、海报 renderer。
- `workers.py`：Dramatiq actor 入口。
- `config.py`：环境变量配置、运行时配置定义、数据库覆盖读取。

路由层只做输入适配、鉴权、错误映射和序列化；provider 调用、任务状态变更、工作流推进都在 application/infrastructure 边界内完成。

## 3. 前端结构

前端代码位于 `web/src/`：

- `pages/`：登录、灵感产物列表、创建灵感产物、灵感产物详情、画廊、帮助、设置、图片会话页面（当前路由包括 `/image-chat`、
  `/inspirations/:inspirationId/image-chat`、`/gallery`、`/help` 和 `/settings`）。
- `components/`：共享 UI，如顶栏、状态标签和图片拖拽上传区。
- `lib/api.ts`：集中封装 REST API 请求。
- `lib/types.ts`：前端 DTO 类型，需与后端 schemas 保持一致。

前端使用 TanStack Query 管理服务端状态。灵感产物详情页和连续生图页对运行中状态采用轻量 status 轮询：

- 连续生图运行中轮询 `['image-session-status', selectedSessionId]`，只合并任务状态，完成后再刷新完整 session。
- 灵感产物工作流运行中轮询 `['inspiration-workflow-status', inspirationId]`，只合并 node/run 状态，完成后再刷新完整 workflow
  和灵感产物产物查询。

不要重新给完整 `ImageSessionDetailResponse` 或完整 `InspirationWorkflowResponse` 加 active 轮询；它们包含历史图片、
节点配置、产物引用和运行记录，运行中高频刷新会放大前端渲染和后端序列化压力。

灵感产物详情页当前是 Inspiration One 工作台：画布负责节点、连接线、缩放、平移、节点拖拽、框选和多选。桌面端右侧侧栏负责详情、日志、图库和模板；移动端用底部工具栏承载运行入口、单节点、模板、详情、日志和图库入口，并用底部面板展示这些面板内容。移动端画布有 `browse` / `edit` / `select` 三种本地交互模式：`browse` 用于单指平移、点选节点和双指缩放；`edit` 允许触控/触控笔拖动节点和创建连线；`select` 用点按切换多选。画布缩放比例和桌面侧栏宽度是浏览器本地偏好，移动端模式和底部面板开合是页面本地 UI 状态；工作流节点、连接、运行状态和产物仍以数据库为准。

## 4. 数据模型主线

传统灵感产物素材链路：

```text
Inspiration
  -> SourceAsset(original/reference/processed)
  -> CreativeBrief
  -> CopySet(draft/confirmed)
  -> PosterVariant(main_image/promo_poster)
```

连续生图链路：

```text
ImageSession
  -> ImageSessionAsset(reference_upload/generated_image)
  -> ImageSessionRound(one generated candidate per row)
  -> ImageSessionGenerationTask(durable async generation task)
  -> optional Inspiration attachment
  -> optional ImageGalleryEntry
```

灵感产物 DAG 工作流链路：

```text
InspirationWorkflow
  -> WorkflowNode(inspiration_context/reference_image/copy_generation/image_generation)
  -> WorkflowEdge
  -> WorkflowRun
  -> WorkflowNodeRun
```

画布模板链路：

```text
CanvasTemplate(builtin full_canvas)
  -> inspiration creation or workflow template insertion

UserCanvasTemplate(node_group)
  -> reusable selected workflow nodes and internal edges
```

PostgreSQL 是元数据和运行状态的权威存储；Redis/Dramatiq 只负责投递后台执行消息。

工作流节点的用户语义：

- `inspiration_context`：一个灵感产物工作流的灵感产物资料入口。
- `reference_image`：单张当前参考图槽位；手动上传或上游生图填充会替换当前图，旧素材保留在灵感产物历史/素材表。
- `copy_generation`：文案生成和可编辑结构化文案；后续生图直接读取结构化文案上下文。
- `image_generation`：生图触发/配置节点；图片产物填充到下游参考图节点，生图节点本身只保存触发与配置语义。

画布模板的边界：

- 内置 `full_canvas` 场景模板可在创建灵感产物时初始化完整工作流，也可在已有灵感产物工作台中追加同一套场景模板。
- 追加内置场景模板时，模板里的 `inspiration_context` 会复用当前活动工作流已有的灵感产物资料节点，不会创建第二个灵感产物节点。
- 用户节点组模板由多选节点保存而来，只持久化可复用配置和选中节点之间的内部连线，不保存灵感产物资料、生成图片或文案产物。

## 5. 异步任务与恢复

当前有两套后台执行入口：

1. `WorkflowRun`：用于灵感产物 DAG 工作流执行。
2. `ImageSessionGenerationTask`：用于连续生图异步生成。

共同原则：

- 数据库记录先落地，Redis 消息只是可恢复的投递尝试。
- 同一灵感产物工作流通过数据库约束避免重复 active run。
- enqueue 失败时会把新建 run 标记为失败，避免 active 状态卡死。
- API 启动时会恢复 queued 的未完成任务/工作流。
- worker 启动时可重置 stale running 状态后重新投递。
- 工作流运行和连续生图任务都会序列化 `is_retryable` / `is_cancelable`，前端据此展示重试和取消入口。
- 图片生成失败会先做用户可读分类，覆盖供应商限流/配额、内容策略、网络中断、请求超时、服务异常和参数不支持等常见情况。
- 连续生图不再用用户可配置的硬总超时作为产品语义。运行中任务会持久化 `progress_updated_at`、
  `completed_candidates`、当前候选和 provider response 状态；stale running 恢复按最近 progress heartbeat
  判断 idle，旧行才回退到 `started_at`。
- 连续生图 worker 的 Dramatiq `time_limit` 只保留为内部 failsafe，避免进程永久占用，不作为用户可调的生成总时限。
- Dramatiq actor 对 terminal/currently-running 的重复消息应 no-op。
- 全局生成并发上限通过数据库中的 active `WorkflowRun`、`ImageSessionGenerationTask` 计数实现。
- `/api/generation-queue` 返回全局 durable 队列概览；连续生图 status 响应会带回当前任务的队列位置。

相关入口：

- `inspiration_one_backend.infrastructure.queue.recover_unfinished_workflow_runs`
- `inspiration_one_backend.infrastructure.queue.recover_unfinished_image_session_generation_tasks`
- `inspiration_one_backend.workers`

## 6. Provider 架构

Inspiration One 把模型能力按模态拆分。

文本 provider 位于 `infrastructure/text/`，统一接口为：

- `generate_brief(inspiration_input)`
- `generate_copy(inspiration_input, brief, config, reference_images=None)`

当前实现：

- `mock`
- `openai`（Responses API 兼容）

图片 provider 位于 `infrastructure/image/`，统一服务于海报生成和图片会话。当前实现：

- `mock`
- `openai_responses`（Responses API `image_generation` 工具，支持 `input_image`；连续生图优先使用 background
  response + retrieve polling，把 provider status 写入任务 progress）
- `openai_images`（Images API `images.generate` / `images.edit` 兼容接口；不使用 Responses
  `previous_response_id`，连续生图由 Inspiration One 显式传入所选基图和参考图）
- `google_gemini_image`（Google Gemini native `generateContent` 图片接口，通过官方 `google-genai` SDK 调用；
  连续生图由 Inspiration One 显式传入所选基图和参考图）

Provider 选择由 `provider_profiles`、`provider_bindings` 和对应 factory 控制。旧 `TEXT_*` / `IMAGE_*`
环境变量只作为首次迁移输入；运行时 resolver 从供应商档案和用途绑定读取接口类型、连接信息和模型。路由不直接依赖具体 SDK。

## 7. 海报生成

海报生成保留两个运行模式，工作流生图会在图片用途绑定真实供应商时自动走 AI 生成：

- `template`：使用本地 Pillow 模板渲染，适合无图片模型密钥的开发/测试。
- `generated`：把确认版文案、灵感产物图和参考图组织为图片 provider 输入，由远程模型生成结果。

两种模式都面向两类产物：

- `main_image`：1:1 电商主图。
- `promo_poster`：3:4 促销海报。

## 8. 配置层级

配置分为两类：

1. Env-only 基础设施配置：`DATABASE_URL`、`REDIS_URL`、`SESSION_SECRET`、`ADMIN_ACCESS_KEY` 等。这些配置在应用访问数据库前就必须可用，或属于部署级访问密钥，因此不支持运行时 DB 覆盖。
2. 运行时业务配置：provider、模型、图片尺寸、上传限制、任务重试、全局生成并发上限、海报模式、提示词模板、登录门禁开关、业务删除开关等。它们可由 `.env` / `.env.dev` 提供默认值，也可在登录且具备 RBAC 配置权限后通过 `/api/settings` 写入 `app_settings` 并覆盖。

Secret 类配置在 API 响应中不回显已有值。

登录门禁开关 `admin_access_required` 保留为运行时配置项；当前访问控制以账号登录和 RBAC 权限为准。配置读取、配置写入、状态读取、资源治理和权限管理都在后端路由绑定对应 API 权限。

业务删除开关 `deletion_enabled` 默认关闭；关闭时后端在路由边界拒绝灵感产物整删和连续生图会话整删，避免体验站违规内容被整条删除后无法溯源。工作流节点/连线编辑和参考图删除不受该开关影响。`DELETE /api/auth/session` 和设置页恢复数据库覆盖值不属于业务删除保护范围。

提示词模板覆盖范围包括灵感产物理解、文案生成、工作台生图和连续生图。基础设施配置和 secret 读取仍保持后端边界；前端只展示配置项、来源和保存状态。

## 9. 文件存储与下载

`infrastructure/storage.py` 里的 `StorageService` 是存储门面，`LocalStorage` 保留为兼容别名。`STORAGE_BACKEND=local` 时对象直接落到 `STORAGE_ROOT`；`STORAGE_BACKEND=minio` 或 `STORAGE_BACKEND=s3` 时通过 S3 兼容后端写入对象存储，并把对象缓存到 `STORAGE_ROOT` 供下载和缩略图派生。`STORAGE_HOST_PATH` 只控制宿主机 bind mount 来源，不应传入应用逻辑替代 `STORAGE_ROOT`。

图片资源表不保存完整访问 URL，只保存对象身份字段：`storage_backend`、`storage_bucket`、`storage_object_key`。历史 `storage_path` 保留为兼容字段，读取时优先使用 `storage_object_key`，为空时回退到 `storage_path`。列表、画廊和连续生图页面由 API 在响应阶段按当前存储配置动态拼接 MinIO/S3 URL；本地存储或缺少公共访问配置时继续使用后端下载接口。

用户可下载的文件通过受控路由读取，例如：

- `/api/posters/{poster_id}/download`
- `/api/source-assets/{asset_id}/download`
- `/api/image-session-assets/{asset_id}/download`

不要绕过 storage 服务直接拼接用户可控路径。

## 10. 安全边界

当前安全模型是“单管理员种子账号 + 多用户 RBAC”：

- 初始管理员账号为 `libow`，管理员角色强制拥有所有菜单和 API 权限。
- `ADMIN_ACCESS_KEY` 只从环境变量读取，不进入数据库配置；账号密码登录和 RBAC 权限决定可见页面与可调用接口。
- 普通用户由管理员加入授信列表后设置密码；非管理员角色的菜单和 API 权限可由管理员配置。
- Session cookie 由 `SESSION_SECRET` 签名。
- CORS 由 `BACKEND_CORS_ORIGINS` 控制。
- 上传文件有 MIME、大小、像素和数量限制。
- Provider API key 保存在 env 或数据库配置中，接口不回显 secret。

当前不提供多用户隔离、对象级权限、审计日志或生产 WAF 配置。
