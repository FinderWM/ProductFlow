# Fluid Mist 登录页配置契约

## 文件用途

- `index.html` 是视觉、布局、动效和登录框结构参考。
- `config-contract.md` 是后续实现管理端配置、公开接口和前端渲染时的字段契约。

## 模板标识

- `template_id`: `fluid-mist`
- `template_name`: `Fluid Mist`
- 默认参与随机：是
- 当前无图片槽位。

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
  "template_id": "fluid-mist",
  "content": {
    "greeting_title": "欢迎回来，继续创作",
    "greeting_description": "登录你的工作台，开启灵感之旅"
  },
  "assets": {}
}
```

## 可配置内容

这些字段允许管理员在配置页调整；缺失、空字符串或仅空白时使用默认值。

默认配置：

```json
{
  "greeting_title": "欢迎回来，继续创作",
  "greeting_description": "登录你的工作台，开启灵感之旅"
}
```

| 字段 | 默认值 | 对应位置 | 建议限制 |
|---|---|---|---|
| `greeting_title` | `欢迎回来，继续创作` | 登录卡片主标题 | 1-24 个中文字符或 48 个英文字符，纯文本 |
| `greeting_description` | `登录你的工作台，开启灵感之旅` | 登录卡片说明文案 | 1-64 个中文字符或 120 个英文字符，纯文本 |

实现要求：

- 只允许纯文本，不允许 HTML。
- 渲染前 trim。
- 不暴露字体、颜色、动效、位置、布局等样式配置。
- 字段超长时管理端应阻止保存；前端仍需保证不撑破布局。

## 安全与性能约束

- 生产实现不得从公网 CDN 加载运行时脚本、字体或样式；登录页资源应随前端构建产物或后端静态资源本地发布。
- 登录页应配置 CSP；脚本、样式、图片和表单提交目标默认限制为同源。
- 空闲状态不得运行永久 `requestAnimationFrame`、`setInterval` 或无限背景位移动画。
- 指针跟随动效只能在 `pointer: fine` 且非 `prefers-reduced-motion: reduce` 时启用，并且必须按 pointer 事件合并到单个 rAF。
- 不允许每帧读取布局信息；`getBoundingClientRect()` 只能在初始化、resize 或 pointer enter 等低频事件中使用。

## 设计绑定内容

这些内容属于 `fluid-mist` 的视觉识别，不允许在配置页修改：

| 字段 | 固定值 |
|---|---|
| `brand_title` | `Inspiration One` |
| `brand_subtitle` | `Visual Studio` |

## 登录框固定内容

登录框相关内容不可配置，后续实现应由模板固定提供：

- 账号 label：`账号`
- 密码 label：`密码`
- 账号输入框 placeholder：`name@studio.com`
- 密码输入框 placeholder：`输入密码`
- 错误提示文案：`账号或密码不正确`
- 提交按钮文案：`开始创作`
- 加载状态文案：`登录中…`
- 密码显示/隐藏切换按钮 aria-label：`显示密码`

## 图片槽位

`fluid-mist` 当前没有图片元素，因此：

```json
{
  "assets": {}
}
```

后续其他登录页模板如果包含图片，需要在各自模板目录内声明自己的图片槽位，例如：

```json
{
  "assets": {
    "background_image": "/media/login-background.png"
  }
}
```

图片槽位不应复用到 `fluid-mist`，除非该模板视觉设计发生明确变更。
图片 URL 只允许同源相对路径或后端签发的受控媒体路径，不允许管理员填写任意外链 URL。

## 兜底规则

- 未配置模板时使用 `random`。
- `random` 没有可用模板时回退到 `command-orbit`。
- `login_page_selected_template_id` 不存在或未启用时回退到 `command-orbit`。
- 可配置字段缺失时使用本文件中的默认值。
- 公开接口失败时，前端可直接渲染 `fluid-mist` 默认内容。
