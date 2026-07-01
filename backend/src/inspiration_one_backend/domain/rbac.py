from __future__ import annotations

from dataclasses import dataclass

ADMIN_ROLE_CODE = "admin"
ADMIN_USER_ID = "00000000-0000-0000-0000-000000000010"
ADMIN_USERNAME = "libow"
DEFAULT_ROLE_CODE = "member"


@dataclass(frozen=True, slots=True)
class MenuDefinition:
    code: str
    title: str
    sort_order: int


@dataclass(frozen=True, slots=True)
class ApiPermissionDefinition:
    code: str
    menu_code: str
    title: str
    description: str
    sort_order: int


MENU_INSPIRATIONS = "inspirations"
MENU_IMAGE_CHAT = "image_chat"
MENU_ENHANCE = "enhance"
MENU_GALLERY = "gallery"
MENU_STATUS = "status"
MENU_USAGE_STATS = "usage_stats"
MENU_SETTINGS = "settings"
MENU_RBAC = "rbac"

API_INSPIRATIONS_READ = "inspirations:read"
API_INSPIRATIONS_WRITE = "inspirations:write"
API_INSPIRATIONS_GENERATE = "inspirations:generate"
API_DECK_READ = "deck:read"
API_DECK_WRITE = "deck:write"
API_DECK_GENERATE = "deck:generate"
API_IMAGE_CHAT_READ = "image_chat:read"
API_IMAGE_CHAT_WRITE = "image_chat:write"
API_IMAGE_CHAT_GENERATE = "image_chat:generate"
API_ENHANCE_READ = "enhance:read"
API_ENHANCE_GENERATE = "enhance:generate"
API_GALLERY_READ = "gallery:read"
API_GALLERY_WRITE = "gallery:write"
API_GALLERY_TAGS_MANAGE = "gallery:tags_manage"
API_STATUS_READ = "status:read"
API_USAGE_STATS_READ = "usage_stats:read"
API_SETTINGS_READ = "settings:read"
API_SETTINGS_WRITE = "settings:write"
API_SETTINGS_PROVIDER_WRITE = "settings:provider_write"
API_SETTINGS_MIGRATE = "settings:migrate"
API_RBAC_MANAGE = "rbac:manage"
API_RESOURCES_MODERATE = "resources:moderate"
API_GLOBAL_TEMPLATES_MANAGE = "templates:manage_global"

MENU_DEFINITIONS: tuple[MenuDefinition, ...] = (
    MenuDefinition(MENU_INSPIRATIONS, "灵感", 10),
    MenuDefinition(MENU_IMAGE_CHAT, "生图", 20),
    MenuDefinition(MENU_ENHANCE, "图片增强", 30),
    MenuDefinition(MENU_GALLERY, "画廊", 40),
    MenuDefinition(MENU_STATUS, "状态", 50),
    MenuDefinition(MENU_USAGE_STATS, "个人统计", 60),
    MenuDefinition(MENU_SETTINGS, "设置", 90),
    MenuDefinition(MENU_RBAC, "权限管理", 100),
)

API_PERMISSION_DEFINITIONS: tuple[ApiPermissionDefinition, ...] = (
    ApiPermissionDefinition(API_INSPIRATIONS_READ, MENU_INSPIRATIONS, "查看灵感", "查看灵感列表、详情和历史", 10),
    ApiPermissionDefinition(API_INSPIRATIONS_WRITE, MENU_INSPIRATIONS, "维护灵感", "创建、编辑、归档灵感资源", 20),
    ApiPermissionDefinition(API_INSPIRATIONS_GENERATE, MENU_INSPIRATIONS, "灵感生成", "发起灵感工作流生成", 30),
    ApiPermissionDefinition(
        API_DECK_READ, MENU_INSPIRATIONS, "查看演示文稿", "查看灵感下的演示文稿与幻灯片", 40
    ),
    ApiPermissionDefinition(
        API_DECK_WRITE, MENU_INSPIRATIONS, "维护演示文稿", "编辑大纲、风格、配图与演示文稿管理", 50
    ),
    ApiPermissionDefinition(
        API_DECK_GENERATE, MENU_INSPIRATIONS, "演示文稿生成", "发起大纲、整页生图、配图增强与备注生成", 60
    ),
    ApiPermissionDefinition(API_IMAGE_CHAT_READ, MENU_IMAGE_CHAT, "查看连续生图", "查看连续生图会话和图片", 10),
    ApiPermissionDefinition(API_IMAGE_CHAT_WRITE, MENU_IMAGE_CHAT, "维护连续生图", "创建和编辑连续生图会话", 20),
    ApiPermissionDefinition(API_IMAGE_CHAT_GENERATE, MENU_IMAGE_CHAT, "连续生图生成", "发起连续生图生成任务", 30),
    ApiPermissionDefinition(API_ENHANCE_READ, MENU_ENHANCE, "查看图片增强", "查看图片增强任务和结果", 10),
    ApiPermissionDefinition(API_ENHANCE_GENERATE, MENU_ENHANCE, "图片增强生成", "发起、取消和保存图片增强任务", 20),
    ApiPermissionDefinition(API_GALLERY_READ, MENU_GALLERY, "查看画廊", "查看画廊条目", 10),
    ApiPermissionDefinition(API_GALLERY_WRITE, MENU_GALLERY, "保存画廊", "将生成图保存到画廊", 20),
    ApiPermissionDefinition(
        API_GALLERY_TAGS_MANAGE,
        MENU_GALLERY,
        "管理画廊标签",
        "新增、编辑、禁用或删除画廊标签",
        30,
    ),
    ApiPermissionDefinition(API_STATUS_READ, MENU_STATUS, "查看状态", "查看生成队列和配置状态", 10),
    ApiPermissionDefinition(API_USAGE_STATS_READ, MENU_USAGE_STATS, "查看个人统计", "查看用户维度使用统计", 10),
    ApiPermissionDefinition(API_SETTINGS_READ, MENU_SETTINGS, "查看设置", "查看系统设置和供应商配置", 10),
    ApiPermissionDefinition(API_SETTINGS_WRITE, MENU_SETTINGS, "维护系统设置", "修改运行时系统设置", 20),
    ApiPermissionDefinition(
        API_SETTINGS_PROVIDER_WRITE,
        MENU_SETTINGS,
        "维护供应商配置",
        "修改供应商档案、生成分组、文案/图片生成配置和密钥相关配置",
        30,
    ),
    ApiPermissionDefinition(
        API_SETTINGS_MIGRATE,
        MENU_SETTINGS,
        "迁移设置",
        "执行设置导入预览和正式导入",
        40,
    ),
    ApiPermissionDefinition(API_RBAC_MANAGE, MENU_RBAC, "管理权限", "管理用户、角色和授权", 10),
    ApiPermissionDefinition(API_RESOURCES_MODERATE, MENU_RBAC, "查看与治理资源", "查看、屏蔽或恢复用户资源", 20),
    ApiPermissionDefinition(
        API_GLOBAL_TEMPLATES_MANAGE,
        MENU_SETTINGS,
        "管理全局模板",
        "维护全局画布模板和分类",
        50,
    ),
)

DEFAULT_ROLE_MENU_CODES = frozenset(
    {
        MENU_INSPIRATIONS,
        MENU_IMAGE_CHAT,
        MENU_ENHANCE,
        MENU_GALLERY,
        MENU_STATUS,
        MENU_USAGE_STATS,
    }
)

DEFAULT_ROLE_API_PERMISSION_CODES = frozenset(
    {
        API_INSPIRATIONS_READ,
        API_INSPIRATIONS_WRITE,
        API_INSPIRATIONS_GENERATE,
        API_IMAGE_CHAT_READ,
        API_IMAGE_CHAT_WRITE,
        API_IMAGE_CHAT_GENERATE,
        API_ENHANCE_READ,
        API_ENHANCE_GENERATE,
        API_GALLERY_READ,
        API_GALLERY_WRITE,
        API_STATUS_READ,
        API_USAGE_STATS_READ,
    }
)
