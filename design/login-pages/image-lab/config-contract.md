# Image Lab 登录页配置契约

## 文件用途

- `index.html` 是 `web/login-redesign-static-alt-v3.html` 迁移后的静态视觉稿。
- `config-contract.md` 标出本模板允许替换的内容；除 `hero_description` 和 `hero_image` 外，其它文案和结构都固定。

## 模板标识

- `template_id`: `image-lab`
- `template_name`: `Image Lab`
- 默认参与随机：是
- 静态稿使用一张英雄图：`../../../web/public/hero.png`。

## 管理端版本选择

登录页支持多版本，由管理员在配置页管理：

```json
{
  "login_page_mode": "random",
  "login_page_selected_template_id": "",
  "login_page_enabled_template_ids": ["command-orbit", "fluid-mist", "image-lab"]
}
```

- `login_page_mode`: `random` 或 `selected`，默认 `random`。
- `login_page_selected_template_id`: 仅在 `selected` 模式下生效。
- `login_page_enabled_template_ids`: 随机模式只从启用模板中选择。
- 公开接口需要返回已经解析后的实际模板，前端不再二次随机。

## 公开接口

接口不需要登录和权限：

```http
GET /api/public/login-page-config
```

建议返回：

```json
{
  "template_id": "image-lab",
  "content": {
    "hero_description": "登录页像一张摄影棚邀请函，先给情绪和记忆点，再承载最短的进入路径。"
  },
  "assets": {
    "hero_image": "/hero.png"
  }
}
```

## 可替换内容

只允许管理员替换以下内容；缺失、空字符串或仅空白时使用默认值。

默认配置：

```json
{
  "hero_description": "登录页像一张摄影棚邀请函，先给情绪和记忆点，再承载最短的进入路径。"
}
```

| 字段 | 默认值 | 对应位置 | 建议限制 |
|---|---|---|---|
| `hero_description` | `登录页像一张摄影棚邀请函，先给情绪和记忆点，再承载最短的进入路径。` | 英雄图说明文案 | 1-90 个中文字符或 180 个英文字符，纯文本 |

实现要求：

- 只允许纯文本，不允许 HTML。
- 渲染前 trim。
- 不支持换行。
- 不暴露字体、颜色、动效、位置、布局、扫描数值或其它文案配置。
- 字段超长时管理端应阻止保存；前端仍需保证不撑破布局。

## 安全与性能约束

- 生产实现不得从公网 CDN 加载运行时脚本、字体或样式；登录页资源应随前端构建产物或后端静态资源本地发布。
- 登录页应配置 CSP；脚本、样式、图片和表单提交目标默认限制为同源。
- 模板允许低频背景漂移和面板浮动动画，以保留静态稿的空间感。
- 空闲状态不得运行无限扫描、旋转、shimmer 或 JS 驱动动效。
- 指针、扫描或 loading 动效必须尊重 `prefers-reduced-motion: reduce`，且不得在页面空闲时持续触发布局、绘制或合成。
- 大图不应使用持续变化的 CSS `filter`、`backdrop-filter` 或 `mix-blend-mode`；如需视觉压暗，优先使用静态遮罩层。

## 图片槽位

```json
{
  "assets": {
    "hero_image": "/hero.png"
  }
}
```

| 槽位 | 默认值 | 对应位置 | 说明 |
|---|---|---|---|
| `hero_image` | `/hero.png` | 左侧英雄图 | 建议 4:3 或 16:10，前端使用 `object-fit: cover` |

图片槽位只影响英雄图，不改变登录卡片、背景纹理和扫描动效。
管理员只能保留默认图片或从资源库图片中选择；公开接口返回同源公共图片代理 URL，不返回资源库下载接口。
图片 URL 只允许同源相对路径或后端签发的受控媒体路径，不允许管理员填写任意外链 URL。

## 设计绑定内容

这些内容属于 `image-lab` 的视觉识别，不允许在配置页修改：

| 字段 | 固定值 | 原因 |
|---|---|---|
| `brand_title` | `Inspiration One` | 产品品牌识别 |
| `hero_rail_text` | `studio access` | 模板视觉识别 |
| `hero_badge` | `ACCESS / INVITATION ONLY` | 模板视觉识别 |
| `hero_title` | `Enter the image lab` | 模板视觉识别 |
| `entry_kicker` | `PRIVATE ENTRY` | 模板视觉识别 |
| `entry_title` | `验证身份，进入创作现场` | 模板视觉识别 |
| `scan_eyebrow` | `identity scanner` | 扫描卡片结构 |
| `scan_status_title` | `身份信号校准完成` | 扫描卡片结构 |
| `scan_code` | `IO-SCAN-9527` | 模板视觉编号 |
| `scanner_core` | `Access` | 扫描动效中心标记 |
| `meter_labels` | `KEY` / `PAIR` / `SYNC` | 扫描动效结构 |
| `meter_values` | `72` / `84` / `63` | 扫描动效结构 |
| `state_labels` | `loading` / `empty` | 状态示例结构 |
| `loading_state_title` | `会话校验中` | 状态示例结构 |
| `empty_state_title` | `设置密码后进入` | 状态示例结构 |
| `hero_image_alt` | `视觉创作海报` | 模板固定无障碍描述 |

## 登录框固定内容

登录框相关内容不可配置，后续实现应由模板固定提供：

- 登录模式按钮：`登录`、`设置密码`
- 账号 label：`账号`
- 密码 label：`密码`
- 账号输入框 placeholder：`输入授权账号`
- 密码输入框 placeholder：`输入当前密码`
- 账号辅助文案：`授权账号用于确认进入权限。`
- 密码辅助文案：`首次进入或重置后可切换到设置密码。`
- 错误提示文案：`身份信号未匹配，请检查账号或密码后重新校准。`
- 提交按钮文案：`确认进入`
- 安全状态按钮 aria-label：`查看安全状态`
- 登录表单、视觉概念、校验状态、状态示例等 aria-label。

## 兜底规则

- 未配置模板时使用 `random`。
- `random` 没有可用模板时回退到 `command-orbit`。
- `login_page_selected_template_id` 不存在或未启用时回退到 `command-orbit`。
- `hero_description` 缺失、空字符串或仅空白时使用本文件中的默认值。
- `hero_image` 缺失时使用模板默认图。
- 公开接口失败时，前端可直接渲染 `image-lab` 默认内容。
