from __future__ import annotations

# 配置导入导出的协议常量。独立成 leaf 模块，供 settings.py（导入解析）与 settings_export.py（导出构建）
# 共同 import，避免两者相互依赖产生循环导入。

SETTINGS_EXPORT_SCHEMA_VERSION = 1
SETTINGS_EXPORT_COMPATIBILITY = "inspiration-one-settings-v1"
