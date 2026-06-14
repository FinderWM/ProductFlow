# Command Orbit 登录页配置契约

`index.html` 是视觉、布局、动效和登录框结构参考；本文件定义后续实现时可配置字段的契约。

## 模板

```json
{
  "template_id": "codex-orbit",
  "template_name": "Command Orbit",
  "default_selection_mode": "random",
  "assets": []
}
```

## 可配置字段

管理员通过运行时配置选择登录页版本：

```json
{
  "login_page_mode": "random",
  "login_page_selected_template_id": "",
  "login_page_enabled_template_ids": ["codex-orbit", "fluid-mist", "image-lab"]
}
```

- `login_page_mode`: `random` 或 `selected`，默认 `random`。
- `login_page_selected_template_id`: 仅在 `selected` 模式下生效。
- `login_page_enabled_template_ids`: 随机模式只从启用模板中选择。
- 公开接口需要返回已经解析后的实际模板，前端不再二次随机。

```json
[
  {
    "key": "brand_subtitle",
    "label": "品牌副标题",
    "type": "text",
    "default_value": "Orbital access concept",
    "render_position": "左上角品牌副标题",
    "required": false,
    "trim": true,
    "plain_text_only": true,
    "max_length": 48
  },
  {
    "key": "hero_title",
    "label": "页面主标题",
    "type": "text",
    "default_value": "进入你的创意工作台",
    "render_position": "页面主标题",
    "required": false,
    "trim": true,
    "plain_text_only": true,
    "max_length": 48
  },
  {
    "key": "hero_description",
    "label": "页面主说明",
    "type": "textarea",
    "default_value": "从灵感编排、图像会话到素材沉淀，Inspiration One 将创作链路收束成一座私有控制台。",
    "render_position": "页面主说明",
    "required": false,
    "trim": true,
    "plain_text_only": true,
    "max_length": 180
  }
]
```

## 固定字段

以下字段属于 `codex-orbit` 的视觉识别或登录框结构，不允许在配置页修改。

```json
[
  {
    "key": "brand_title",
    "value": "Inspiration One",
    "reason": "模板品牌识别"
  },
  {
    "key": "hero_eyebrow",
    "value": "ORBITAL LOGIN",
    "reason": "模板视觉识别"
  },
  {
    "key": "vertical_title",
    "value": "ACCESS\\nORBIT",
    "reason": "模板视觉识别"
  },
  {
    "key": "satellite_caption",
    "value": "CONTROL SURFACE",
    "reason": "模板视觉识别"
  },
  {
    "key": "satellite_title",
    "value": "Creative\\ncommand orbit",
    "reason": "模板视觉识别"
  },
  {
    "key": "auth_panel",
    "value": "CORE ACCESS / No. 9527 / INSPIRATION START / 登录表单全部文案",
    "reason": "登录框相关内容不可配置"
  },
  {
    "key": "mode_rail",
    "value": "Login / Set key",
    "reason": "切换按钮属于模板交互结构"
  }
]
```

## 公开接口

接口不需要登录和权限：

```http
GET /api/public/login-page-config
```

建议返回当前已解析后的模板和配置值，前端不再二次随机：

```json
{
  "template_id": "codex-orbit",
  "content": {
    "brand_subtitle": "Orbital access concept",
    "hero_title": "进入你的创意工作台",
    "hero_description": "从灵感编排、图像会话到素材沉淀，Inspiration One 将创作链路收束成一座私有控制台。"
  },
  "assets": {}
}
```

## 安全与性能约束

- 生产实现不得从公网 CDN 加载运行时脚本、字体或样式；登录页资源应随前端构建产物或后端静态资源本地发布。
- 登录页应配置 CSP；脚本、样式、图片和表单提交目标默认限制为同源。
- 模板允许低频背景漂移和轨道心跳动画，以保留 `codex-orbit` 的概念动势。
- 空闲状态不得运行 JS 驱动的永久动画循环或其它高频持续合成动画。
- 指针跟随动效只能在 `pointer: fine` 且非 `prefers-reduced-motion: reduce` 时启用，并且必须按 pointer 事件合并到单个 rAF。
- 不允许每帧读取布局信息；长期 `will-change` 只允许在真实交互窗口内短暂启用。
- 当前模板没有图片槽位；后续新增图片槽位时，图片 URL 只允许同源相对路径或后端签发的受控媒体路径。

## 兜底规则

- 未配置模板时使用 `random` 模式。
- `random` 没有可用模板时回退到 `codex-orbit`。
- `login_page_selected_template_id` 不存在或未启用时回退到 `codex-orbit`。
- 可配置字段缺失、空字符串或仅空白时使用 `default_value`。
- 公开接口失败时，前端可直接渲染 `codex-orbit` 默认内容。
