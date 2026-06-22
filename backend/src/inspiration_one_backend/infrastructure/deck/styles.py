from __future__ import annotations

# 内置「整页图片式」幻灯片风格。key -> (中文标签, 视觉风格指令)。
# 视觉指令用于拼进生图 prompt；标签用于前端单选展示。
_DECK_STYLES: dict[str, tuple[str, str]] = {
    "clean_business": ("简洁商务", "极简商务风：大量留白、克制的中性色、清晰网格、专业稳重"),
    "tech_dark": ("科技深色", "科技深色风：深色背景、霓虹/渐变点缀、未来感、几何线条"),
    "magazine": ("杂志排版", "杂志编辑风：强烈版式层次、大标题、衬线与无衬线混排、图文穿插"),
    "data_dashboard": ("数据看板", "数据看板风：图表化、卡片分区、信息密度适中、强调数字与对比"),
    "hand_drawn": ("手绘草图", "手绘技术风：手绘线条、便签质感、亲和、示意图风格"),
}

DEFAULT_DECK_STYLE_KEY = "clean_business"


def list_deck_styles() -> list[dict[str, str]]:
    """返回内置风格列表，供前端单选与配置校验使用。"""
    return [{"key": key, "label": label} for key, (label, _description) in _DECK_STYLES.items()]


def is_valid_deck_style(style_key: str | None) -> bool:
    return bool(style_key) and style_key in _DECK_STYLES


def _style_directive(style_key: str | None) -> str:
    entry = _DECK_STYLES.get(style_key or "")
    if entry is None:
        entry = _DECK_STYLES[DEFAULT_DECK_STYLE_KEY]
    return entry[1]


def build_slide_image_prompt(
    *,
    deck_title: str,
    slide_title: str,
    points: list[str],
    style_key: str | None,
    material_reference: bool = False,
    style_reference: bool = False,
) -> str:
    """拼出单页「整页图片式幻灯片」生图 prompt，并约束中文文字量以降低生图错字风险。"""
    points_block = "\n".join(f"- {point}" for point in points[:4] if str(point).strip()) or "（无要点）"
    if style_reference:
        style_line = "请严格模仿所提供风格参考图的视觉风格、配色与版式。"
    else:
        style_line = f"整体视觉风格：{_style_directive(style_key)}。"
    material_line = (
        "请将所提供的参考配图作为本页主要图像内容自然融入画面，不要遮挡标题与要点。\n" if material_reference else ""
    )
    return (
        "生成一张 16:9 整页演示幻灯片图片（full-page presentation slide），适合直接放入 PPT。\n"
        f"演示主题：{deck_title}\n"
        f"本页标题：{slide_title}\n"
        f"本页要点：\n{points_block}\n"
        f"{style_line}\n"
        f"{material_line}"
        "排版要求：标题醒目，要点以简洁短句或图标化方式呈现，信息层次清晰、负空间合理。\n"
        "文字要求：只渲染上面给出的中文标题与要点，文字精炼、数量克制、字形清晰准确，"
        "不要编造额外文案，不要出现乱码或无意义文字。"
    )
