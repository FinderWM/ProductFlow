# 生成配置池调度与状态重构

## Goal

把当前“一个文案绑定 + 一个图片绑定”的供应商用途配置，重构为可调度的文案/图片生成配置池。
系统应能按优先级、健康度、并发容量、冻结状态和手动指定规则动态选择配置，并在设置页展示配置、运行状态和按日统计。

## Requirements

- 这是重大重构，不要求保留旧 `provider_bindings` 的产品语义或导入导出兼容格式。
- 数据库迁移可以按最新结构迁移、删除或重建旧生成配置数据；迁移后本地执行 `just backend-migrate` 应得到可运行的新结构。
- 供应商档案仍是连接信息层；文案生成和图片生成需要各自支持多个可调度配置。
- 每个生成配置需要包含：
  - 用途：`text` 或 `image`
  - 供应商档案引用、接口类型、模型设置、接口设置
  - 启用状态、优先级、单配置最大并发数
  - 可用性窗口、失败阈值、冷冻期等调度参数
- 所有调度时间参数和失败阈值都必须能在配置页手动调整，不放到 `.env` / `.env.dev`。
- 配置页需要提供按优先级自动排序的能力；编辑优先级后提供手动刷新排序按钮。
- 调度必须支持自动选择和手动指定：
  - 自动选择按优先级、时间窗口内可用性、剩余并发容量、冻结状态动态计算。
  - 手动指定优先使用指定配置，但仍受启用状态、冻结状态、并发上限约束。
  - 容量不足时进入 durable queue 等待，不把排队视为 provider 调用失败。
- 每个配置需要统计使用数据和可用性数据，并展示在配置卡片上。
- 统计数据按日新增/更新，不在每次查询时从使用记录实时聚合。
- 按日统计使用当前运行机器时区的自然日作为日期口径，不额外引入 `.env` 时区配置。
- 当配置在可配置分钟窗口内失败次数达到阈值时，进入可配置分钟冷冻期；到期后自动恢复可调度。
- 需要新增同“配置”同级的“状态”页面，展示：
  - 单配置优先级、当前并发/最大并发、今日统计、可用率、最近失败、冻结信息。
  - 总使用统计、总可用统计、运行中/排队中/冻结配置数等状态。
  - 状态页为只读页面，不在设置页内部展示，也不提供跳转回配置页的按钮。
  - 状态页支持日期范围筛选，默认快捷范围包含今日、近 7 天、近 30 天、本月，并支持自定义开始/结束日期。
  - 今日调用总数需要拆分展示今日文案调用和今日图片调用。
- 商品/工作台画布中：
  - 文案节点可以自动选择文案配置，也可以手动指定文案配置。
  - 图片节点可以自动选择图片配置，也可以手动指定图片配置。
- 文/图生图中：
  - 图片生成可以自动选择图片配置，也可以手动选择图片配置。
  - 画面描述润色可以调用文案配置；生成后必须由用户手动确认是否填入画面描述。
- 设置导入导出必须使用新的配置池结构，包含生成配置池和调度参数。
- 项目用 Trellis 管理开发周期，规划阶段需沉淀 PRD、design、implement。
- 用户希望多 agent 加速实现；当前 Codex 会话受 inline 约束不能实际派发实现/检查子 agent，本任务的实施计划需记录可并行调度方案，待执行环境允许时使用。

## Acceptance Criteria

- [ ] 迁移后旧的单一用途绑定不再是运行时生成配置来源。
- [ ] 文案/图片配置池均支持多个配置、优先级、启用状态、最大并发和冻结策略配置。
- [ ] 自动调度能在多个可用配置中按动态分数选择，并通过数据库原子占用避免并发超卖。
- [ ] 手动指定配置能优先调度到指定配置，且在满并发/冻结时按任务排队规则处理。
- [ ] provider 调用成功、失败、超时后会更新对应配置当天统计和运行状态。
- [ ] 状态页不扫描历史使用记录实时聚合，而是读取按日统计表和运行态表。
- [ ] 冻结规则可通过配置页调整，且到期后自动恢复可调度。
- [ ] 工作台节点和文/图生图都能选择自动或手动配置。
- [ ] 文/图生图支持使用文案配置润色画面描述，并在用户确认后写回。
- [ ] 导出文件包含新的 provider profiles + generation configs 结构；导入后配置页和调度器都读取新结构。
- [ ] 后端测试覆盖迁移、调度、并发、冻结、统计、导入导出和调用链路。
- [ ] 前端 lint/test/build 通过，设置页和工作台/文图生图关键交互可手动验证。

## Notes

- Parent task owns full scope and integration acceptance.
- Current completed status-page slice:
  - `2ed30ff feat: 提升生成状态页` made `/status` a first-level private route next to `/settings`.
  - `2ed30ff feat: 提升生成状态页` added date-range status API fields and frontend quick filters.
  - `2ed30ff feat: 提升生成状态页` split today's attempts into text/image counts and removed the embedded settings status section.
  - `e6149ba fix: 移除状态页配置跳转` removed the status-page configuration jump button.
- Child task split:
  - `05-26-generation-config-backend`: schema, migration, resolver, scheduler, stats, backend APIs.
  - `05-26-generation-config-frontend`: settings config pool UI and status tab.
  - `05-26-generation-config-integration`: workflow node, image chat, prompt polish, import/export integration.
- Current repository has unrelated dirty files. Implementation must inspect hunks before editing and avoid reverting unrelated work.
