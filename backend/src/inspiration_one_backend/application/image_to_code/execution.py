from __future__ import annotations

import base64
import html
import json
import mimetypes
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
from openai import OpenAI
from PIL import Image, ImageColor, ImageDraw
from pydantic import BaseModel, Field, field_validator

from inspiration_one_backend.domain.enums import ImageToCodeDeliveryMode
from inspiration_one_backend.infrastructure.openai_client import (
    OPENAI_COMPATIBLE_DEFAULT_HEADERS,
    OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS,
    build_openai_client_kwargs,
)
from inspiration_one_backend.infrastructure.openai_response_parsing import read_json_object_from_response
from inspiration_one_backend.infrastructure.provider_config import (
    ResolvedTextProviderConfig,
    resolve_text_provider_config,
)
from inspiration_one_backend.infrastructure.text.openai_chat_completions_provider import normalize_chat_completions_url
from inspiration_one_backend.infrastructure.text.structured_output import (
    TextStructuredOutputSchema,
    chat_response_format,
    responses_text_config,
    structured_output_instructions,
)

DEFAULT_SITE_FRAME_WIDTH = 1440
DEFAULT_SITE_FRAME_HEIGHT = 2200


class ImageToCodeJobParams(BaseModel):
    page_type: str = "landing"
    fidelity_mode: str = "balanced"
    responsive_shell: bool = True
    export_hd_preview: bool = True
    notes: str | None = Field(default=None, max_length=2000)
    retry_from_job_id: str | None = Field(default=None, max_length=36)

    @field_validator("page_type", mode="before")
    @classmethod
    def validate_page_type(cls, value: object) -> str:
        normalized = str(value or "landing").strip().lower()
        if normalized not in {"landing", "marketing", "editorial"}:
            raise ValueError("页面类型无效")
        return normalized

    @field_validator("fidelity_mode", mode="before")
    @classmethod
    def validate_fidelity_mode(cls, value: object) -> str:
        normalized = str(value or "balanced").strip().lower()
        if normalized not in {"balanced", "visual_first", "structure_first"}:
            raise ValueError("保真模式无效")
        return normalized

    @field_validator("notes", mode="before")
    @classmethod
    def normalize_notes(cls, value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @field_validator("retry_from_job_id", mode="before")
    @classmethod
    def normalize_retry_from_job_id(cls, value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None


class ImageToCodeSectionSpec(BaseModel):
    id: str
    label: str
    title: str
    body: str
    bullets: list[str] = Field(default_factory=list, max_length=4)
    emphasis: str | None = None

    @field_validator("id", "label", "title", "body", mode="before")
    @classmethod
    def normalize_required_text(cls, value: object) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("图片转代码分区文本不能为空")
        return text

    @field_validator("bullets", mode="before")
    @classmethod
    def normalize_bullets(cls, value: object) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("图片转代码分区 bullets 必须是数组")
        return [str(item).strip() for item in value if str(item).strip()]


class ImageToCodeAnalysisSpec(BaseModel):
    page_title: str
    hero_kicker: str | None = None
    hero_title: str
    hero_subtitle: str
    primary_cta: str
    secondary_cta: str | None = None
    layout_mood: str | None = None
    theme_keywords: list[str] = Field(default_factory=list, max_length=5)
    sections: list[ImageToCodeSectionSpec] = Field(min_length=2, max_length=4)

    @field_validator(
        "page_title",
        "hero_title",
        "hero_subtitle",
        "primary_cta",
        mode="before",
    )
    @classmethod
    def normalize_required_text(cls, value: object) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("图片转代码分析文本不能为空")
        return text

    @field_validator("hero_kicker", "secondary_cta", "layout_mood", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @field_validator("theme_keywords", mode="before")
    @classmethod
    def normalize_theme_keywords(cls, value: object) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("theme_keywords 必须是数组")
        return [str(item).strip() for item in value if str(item).strip()]


@dataclass(frozen=True, slots=True)
class ImageToCodeSourceSnapshot:
    owner_user_id: str
    filename: str
    mime_type: str
    width: int
    height: int
    content: bytes


@dataclass(frozen=True, slots=True)
class GeneratedFilePayload:
    relative_path: str
    content: bytes
    mime_type: str
    warm_variants: bool = False


@dataclass(frozen=True, slots=True)
class GeneratedArtifactPayload:
    artifact_id: str
    artifact_type: str
    label: str
    filename: str
    content: bytes
    mime_type: str
    preview_role: str = "none"


@dataclass(frozen=True, slots=True)
class ImageToCodeBuildBundle:
    analysis_spec: ImageToCodeAnalysisSpec
    warnings: list[str]
    site_files: list[GeneratedFilePayload]
    artifact_payloads: list[GeneratedArtifactPayload]
    static_site_summary: dict[str, object]
    figma_summary: dict[str, object] | None
    delivery_report_json: dict[str, object]


_IMAGE_TO_CODE_ANALYSIS_SCHEMA = TextStructuredOutputSchema(
    name="image_to_code_analysis",
    description="Structured single-page site summary derived from one reference image.",
    schema={
        "type": "object",
        "additionalProperties": False,
        "required": [
            "page_title",
            "hero_kicker",
            "hero_title",
            "hero_subtitle",
            "primary_cta",
            "secondary_cta",
            "layout_mood",
            "theme_keywords",
            "sections",
        ],
        "properties": {
            "page_title": {"type": "string"},
            "hero_kicker": {"type": ["string", "null"]},
            "hero_title": {"type": "string"},
            "hero_subtitle": {"type": "string"},
            "primary_cta": {"type": "string"},
            "secondary_cta": {"type": ["string", "null"]},
            "layout_mood": {"type": ["string", "null"]},
            "theme_keywords": {"type": "array", "items": {"type": "string"}},
            "sections": {
                "type": "array",
                "minItems": 2,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "label", "title", "body", "bullets", "emphasis"],
                    "properties": {
                        "id": {"type": "string"},
                        "label": {"type": "string"},
                        "title": {"type": "string"},
                        "body": {"type": "string"},
                        "bullets": {"type": "array", "items": {"type": "string"}},
                        "emphasis": {"type": ["string", "null"]},
                    },
                },
            },
        },
    },
)


def build_image_to_code_bundle(
    *,
    source: ImageToCodeSourceSnapshot,
    delivery_mode: ImageToCodeDeliveryMode,
    params: ImageToCodeJobParams,
) -> ImageToCodeBuildBundle:
    palette = _extract_palette_hexes(source.content)
    analysis_spec, analyzer_kind, warnings = analyze_image_to_code_source(source=source, params=params)
    site_asset_suffix = _normalized_suffix_from_filename(source.filename, source.mime_type)
    site_asset_name = f"source{site_asset_suffix}"
    site_files = _build_site_files(
        source=source,
        analysis_spec=analysis_spec,
        palette=palette,
        params=params,
        site_asset_name=site_asset_name,
    )
    preview_image = _build_preview_image(source=source, analysis_spec=analysis_spec, palette=palette)
    layers_manifest = _build_layers_manifest(
        analysis_spec=analysis_spec,
        palette=palette,
        params=params,
        site_asset_name=site_asset_name,
        source=source,
        analyzer_kind=analyzer_kind,
        warnings=warnings,
    )
    figma_layer_spec = _build_figma_layer_spec(layers_manifest)
    figma_summary = _build_figma_summary(figma_layer_spec) if delivery_mode in {
        ImageToCodeDeliveryMode.FIGMA_EXPORT,
        ImageToCodeDeliveryMode.BOTH,
    } else None
    delivery_report_json: dict[str, object] = {
        "version": 1,
        "analyzer_kind": analyzer_kind,
        "page_type": params.page_type,
        "fidelity_mode": params.fidelity_mode,
        "delivery_mode": delivery_mode.value,
        "page_title": analysis_spec.page_title,
        "site_frame": {"width": DEFAULT_SITE_FRAME_WIDTH, "height": DEFAULT_SITE_FRAME_HEIGHT},
        "theme_keywords": analysis_spec.theme_keywords,
        "warning_count": len(warnings),
        "warnings": warnings,
    }
    delivery_report_md = _build_delivery_report_markdown(
        source=source,
        analysis_spec=analysis_spec,
        delivery_mode=delivery_mode,
        params=params,
        warnings=warnings,
    )

    site_zip_bytes = _zip_file_payloads(site_files)
    artifact_payloads = [
        GeneratedArtifactPayload(
            artifact_id="source_snapshot",
            artifact_type="source_snapshot",
            label="源图快照",
            filename=source.filename,
            content=source.content,
            mime_type=source.mime_type,
        ),
        GeneratedArtifactPayload(
            artifact_id="preview_image",
            artifact_type="preview_image",
            label="网页预览图",
            filename="preview.png",
            content=preview_image,
            mime_type="image/png",
            preview_role="primary",
        ),
        GeneratedArtifactPayload(
            artifact_id="site_zip",
            artifact_type="site_zip",
            label="静态网页交付包",
            filename="site.zip",
            content=site_zip_bytes,
            mime_type="application/zip",
        ),
        GeneratedArtifactPayload(
            artifact_id="site_index_html",
            artifact_type="site_index_html",
            label="网页入口 HTML",
            filename="index.html",
            content=_site_file_bytes(site_files, "index.html"),
            mime_type="text/html; charset=utf-8",
        ),
        GeneratedArtifactPayload(
            artifact_id="layers_manifest",
            artifact_type="layers_manifest",
            label="图层清单",
            filename="layers.manifest.json",
            content=_json_bytes(layers_manifest),
            mime_type="application/json",
        ),
        GeneratedArtifactPayload(
            artifact_id="delivery_report_json",
            artifact_type="delivery_report_json",
            label="交付报告 JSON",
            filename="delivery-report.json",
            content=_json_bytes(delivery_report_json),
            mime_type="application/json",
        ),
        GeneratedArtifactPayload(
            artifact_id="delivery_report_md",
            artifact_type="delivery_report_md",
            label="交付说明",
            filename="delivery-report.md",
            content=delivery_report_md.encode("utf-8"),
            mime_type="text/markdown; charset=utf-8",
        ),
    ]

    if figma_summary is not None:
        figma_import_files = [
            GeneratedFilePayload(
                relative_path="README.md",
                content=_build_figma_import_readme().encode("utf-8"),
                mime_type="text/markdown; charset=utf-8",
            ),
            GeneratedFilePayload(
                relative_path="figma_layer_spec.json",
                content=_json_bytes(figma_layer_spec),
                mime_type="application/json",
            ),
            GeneratedFilePayload(
                relative_path="import.json",
                content=_json_bytes(
                    {
                        "version": 1,
                        "entry": "figma_layer_spec.json",
                        "asset_root": "assets",
                        "remote_write_enabled": False,
                    }
                ),
                mime_type="application/json",
            ),
            GeneratedFilePayload(
                relative_path=f"assets/{site_asset_name}",
                content=source.content,
                mime_type=source.mime_type,
                warm_variants=True,
            ),
        ]
        artifact_payloads.extend(
            [
                GeneratedArtifactPayload(
                    artifact_id="figma_layer_spec",
                    artifact_type="figma_layer_spec",
                    label="Figma 图层规范",
                    filename="figma-layer-spec.json",
                    content=_json_bytes(figma_layer_spec),
                    mime_type="application/json",
                ),
                GeneratedArtifactPayload(
                    artifact_id="figma_import_zip",
                    artifact_type="figma_import_zip",
                    label="Figma 本地导入包",
                    filename="figma-import.zip",
                    content=_zip_file_payloads(figma_import_files),
                    mime_type="application/zip",
                ),
                GeneratedArtifactPayload(
                    artifact_id="figma_readme",
                    artifact_type="figma_readme",
                    label="Figma 导入说明",
                    filename="FIGMA-README.md",
                    content=_build_figma_import_readme().encode("utf-8"),
                    mime_type="text/markdown; charset=utf-8",
                ),
            ]
        )

    static_site_summary = {
        "page_title": analysis_spec.page_title,
        "section_count": len(analysis_spec.sections),
        "theme_keywords": analysis_spec.theme_keywords,
        "responsive_shell": params.responsive_shell,
        "site_asset_count": len(site_files),
    }
    return ImageToCodeBuildBundle(
        analysis_spec=analysis_spec,
        warnings=warnings,
        site_files=site_files,
        artifact_payloads=artifact_payloads,
        static_site_summary=static_site_summary,
        figma_summary=figma_summary,
        delivery_report_json=delivery_report_json,
    )


def analyze_image_to_code_source(
    *,
    source: ImageToCodeSourceSnapshot,
    params: ImageToCodeJobParams,
) -> tuple[ImageToCodeAnalysisSpec, str, list[str]]:
    provider_config = resolve_text_provider_config()
    if provider_config.provider_kind == "mock":
        return (
            _build_mock_analysis_spec(source=source, params=params),
            "mock",
            ["当前使用 mock 分析器，输出为模板化结构。"],
        )
    return _build_ai_analysis_spec(source=source, params=params, provider_config=provider_config), "ai", []


def _build_ai_analysis_spec(
    *,
    source: ImageToCodeSourceSnapshot,
    params: ImageToCodeJobParams,
    provider_config: ResolvedTextProviderConfig,
) -> ImageToCodeAnalysisSpec:
    instructions = (
        "你是资深前端设计总监和信息架构设计师。"
        "请根据输入图片，推断一个单页静态网页的视觉方向和内容结构。"
        "输出必须克制、专业，不要编造电商价格、SKU、品牌承诺或联系方式。"
        "如果图片中没有明确文本，就根据视觉主题概括，不要伪造 OCR 细节。"
    )
    prompt = (
        f"图片文件名：{source.filename}\n"
        f"图片尺寸：{source.width}x{source.height}\n"
        f"页面类型：{params.page_type}\n"
        f"保真模式：{params.fidelity_mode}\n"
        f"是否输出响应式骨架：{'是' if params.responsive_shell else '否'}\n"
        f"补充说明：{params.notes or '未提供'}\n"
        "请输出一个单页网站摘要，包含 hero 文案和 2 到 4 个内容分区。"
        "分区标题要明确，正文要具体但不过度营销。"
    )
    if provider_config.provider_kind == "openai":
        return _analyze_with_openai_responses(
            source=source,
            prompt=prompt,
            instructions=instructions,
            provider_config=provider_config,
        )
    if provider_config.provider_kind == "openai_chat_completions":
        return _analyze_with_chat_completions(
            source=source,
            prompt=prompt,
            instructions=instructions,
            provider_config=provider_config,
        )
    raise ValueError("当前文案 provider 不支持图片转代码分析")


def _analyze_with_openai_responses(
    *,
    source: ImageToCodeSourceSnapshot,
    prompt: str,
    instructions: str,
    provider_config: ResolvedTextProviderConfig,
) -> ImageToCodeAnalysisSpec:
    client = OpenAI(**build_openai_client_kwargs(api_key=provider_config.api_key, base_url=provider_config.base_url))
    payload: dict[str, object] = {
        "model": provider_config.copy_model,
        "instructions": structured_output_instructions(
            instructions,
            provider_config.structured_output,
            _IMAGE_TO_CODE_ANALYSIS_SCHEMA,
        ),
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": _image_data_url(source)},
                ],
            }
        ],
    }
    text_config = responses_text_config(provider_config.structured_output, _IMAGE_TO_CODE_ANALYSIS_SCHEMA)
    if text_config is not None:
        payload["text"] = text_config
    response = client.responses.create(**payload)
    parsed = read_json_object_from_response(response, error_label="图片转代码分析")
    return ImageToCodeAnalysisSpec.model_validate(parsed)


def _analyze_with_chat_completions(
    *,
    source: ImageToCodeSourceSnapshot,
    prompt: str,
    instructions: str,
    provider_config: ResolvedTextProviderConfig,
) -> ImageToCodeAnalysisSpec:
    if not provider_config.api_key:
        raise ValueError("文案供应商档案缺少 API Key")
    payload: dict[str, object] = {
        "model": provider_config.copy_model,
        "messages": [
            {
                "role": "system",
                "content": structured_output_instructions(
                    instructions,
                    provider_config.structured_output,
                    _IMAGE_TO_CODE_ANALYSIS_SCHEMA,
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": _image_data_url(source)}},
                ],
            },
        ],
        "stream": False,
    }
    response_format = chat_response_format(provider_config.structured_output, _IMAGE_TO_CODE_ANALYSIS_SCHEMA)
    if response_format is not None:
        payload["response_format"] = response_format
    headers = {
        **OPENAI_COMPATIBLE_DEFAULT_HEADERS,
        "Authorization": f"Bearer {provider_config.api_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS, headers=headers) as client:
        response = client.post(normalize_chat_completions_url(provider_config.base_url), json=payload)
        response.raise_for_status()
    parsed = read_json_object_from_response(response.text, error_label="图片转代码分析")
    return ImageToCodeAnalysisSpec.model_validate(parsed)


def _build_mock_analysis_spec(
    *,
    source: ImageToCodeSourceSnapshot,
    params: ImageToCodeJobParams,
) -> ImageToCodeAnalysisSpec:
    safe_title = _default_page_title(source.filename)
    section_seed = {
        "landing": [
            ("signal", "核心视觉", "提炼源图中的主视觉元素与节奏，让页面首屏保留原始画面印象。"),
            ("structure", "信息结构", "用分层区块拆开主题、亮点与使用场景，减少静态长图的不确定解读。"),
            ("handoff", "交付说明", "同时生成网页结构、图层清单与 Figma 导入规范，方便继续二次设计。"),
        ],
        "marketing": [
            ("hook", "主题钩子", "围绕最强的视觉记忆点建立标题、辅助语与首屏对比关系。"),
            ("proof", "亮点展开", "把视觉细节整理成可复用的信息块，便于运营页继续补文案与 CTA。"),
            ("delivery", "输出物", "保留结构化交付与素材引用，方便后续接入发布或设计工具。"),
        ],
        "editorial": [
            ("theme", "视觉主题", "保留图片氛围并减少销售语言，让页面更像一篇可阅读的单页专题。"),
            ("narrative", "叙事展开", "按视觉、细节、延展三个区块组织内容，保持阅读层级清晰。"),
            ("handoff", "结构交付", "输出静态网页、图层清单与 Figma 规范，方便继续编辑和校对。"),
        ],
    }[params.page_type]
    sections = [
        ImageToCodeSectionSpec(
            id=section_id,
            label=f"0{index}",
            title=title,
            body=body,
            bullets=[
                "保留单图的主体张力",
                "限制文本密度，避免覆盖主要视觉",
                "让结构能继续被设计或开发复用",
            ][: 2 + (1 if index == len(section_seed) else 0)],
            emphasis="优先保留视觉主题" if index == 1 and params.fidelity_mode == "visual_first" else None,
        )
        for index, (section_id, title, body) in enumerate(section_seed, start=1)
    ]
    hero_title = {
        "landing": f"{safe_title} 页面骨架",
        "marketing": f"{safe_title} 主题页",
        "editorial": f"{safe_title} 视觉专题",
    }[params.page_type]
    return ImageToCodeAnalysisSpec(
        page_title=hero_title,
        hero_kicker="IMAGE TO CODE",
        hero_title=hero_title,
        hero_subtitle="从单张图片推导页面层级、视觉节奏与交付结构，便于继续预览、开发与设计复核。",
        primary_cta="查看静态预览",
        secondary_cta="下载交付包",
        layout_mood="calm editorial",
        theme_keywords=["single image", params.page_type.replace("_", " "), params.fidelity_mode.replace("_", " ")],
        sections=sections,
    )


def _build_site_files(
    *,
    source: ImageToCodeSourceSnapshot,
    analysis_spec: ImageToCodeAnalysisSpec,
    palette: list[str],
    params: ImageToCodeJobParams,
    site_asset_name: str,
) -> list[GeneratedFilePayload]:
    css = _build_site_css(palette=palette, params=params)
    html_text = _build_site_html(
        analysis_spec=analysis_spec,
        palette=palette,
        params=params,
        site_asset_name=site_asset_name,
    )
    return [
        GeneratedFilePayload(
            relative_path="index.html",
            content=html_text.encode("utf-8"),
            mime_type="text/html; charset=utf-8",
        ),
        GeneratedFilePayload(
            relative_path="assets/site.css",
            content=css.encode("utf-8"),
            mime_type="text/css; charset=utf-8",
        ),
        GeneratedFilePayload(
            relative_path=f"assets/{site_asset_name}",
            content=source.content,
            mime_type=source.mime_type,
            warm_variants=True,
        ),
    ]


def _build_site_html(
    *,
    analysis_spec: ImageToCodeAnalysisSpec,
    palette: list[str],
    params: ImageToCodeJobParams,
    site_asset_name: str,
) -> str:
    kicker = (
        f'<div class="hero-kicker">{html.escape(analysis_spec.hero_kicker)}</div>'
        if analysis_spec.hero_kicker
        else ""
    )
    secondary_cta = (
        f'<a class="action action-secondary" href="#sections">{html.escape(analysis_spec.secondary_cta)}</a>'
        if analysis_spec.secondary_cta
        else ""
    )
    section_markup = []
    for index, section in enumerate(analysis_spec.sections, start=1):
        bullets = "".join(f"<li>{html.escape(item)}</li>" for item in section.bullets)
        emphasis = f'<p class="section-emphasis">{html.escape(section.emphasis)}</p>' if section.emphasis else ""
        section_markup.append(
            f'<section class="story-block story-block-{index}" id="section-{html.escape(section.id)}">'
            f'<div class="story-label">{html.escape(section.label)}</div>'
            f"<div>"
            f"<h2>{html.escape(section.title)}</h2>"
            f"<p>{html.escape(section.body)}</p>"
            f"{emphasis}"
            f'<ul class="story-bullets">{bullets}</ul>'
            f"</div>"
            f"</section>"
        )
    keywords = " · ".join(html.escape(item) for item in analysis_spec.theme_keywords) or "single image"
    responsive_badge = "Responsive shell" if params.responsive_shell else "Fixed width shell"
    return (
        "<!doctype html>\n"
        '<html lang="zh-CN">\n'
        "<head>\n"
        '  <meta charset="utf-8" />\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1" />\n'
        f"  <title>{html.escape(analysis_spec.page_title)}</title>\n"
        '  <link rel="stylesheet" href="assets/site.css" />\n'
        "</head>\n"
        "<body>\n"
        '  <main class="page-shell">\n'
        '    <section class="hero-panel">\n'
        '      <div class="hero-copy">\n'
        f"        {kicker}\n"
        f"        <h1>{html.escape(analysis_spec.hero_title)}</h1>\n"
        f"        <p class=\"hero-subtitle\">{html.escape(analysis_spec.hero_subtitle)}</p>\n"
        '        <div class="hero-actions">\n'
        f'          <a class="action action-primary" href="#sections">{html.escape(analysis_spec.primary_cta)}</a>\n'
        f"          {secondary_cta}\n"
        "        </div>\n"
        '        <div class="hero-meta">\n'
        f'          <span>{keywords}</span>\n'
        f'          <span>{html.escape(responsive_badge)}</span>\n'
        "        </div>\n"
        "      </div>\n"
        '      <div class="hero-visual-wrap">\n'
        '        <div class="hero-visual-orbit"></div>\n'
        f'        <img class="hero-visual" src="assets/{html.escape(site_asset_name)}" '
        f'alt="{html.escape(analysis_spec.page_title)}" />\n'
        "      </div>\n"
        "    </section>\n"
        '    <section class="story-grid" id="sections">\n'
        f"      {''.join(section_markup)}\n"
        "    </section>\n"
        '    <footer class="page-footer">\n'
        '      <div class="footer-title">Generated by ProductFlow image-to-code</div>\n'
        '      <div class="footer-note">Preview is read-only and isolated from the main workspace runtime.</div>\n'
        "    </footer>\n"
        "  </main>\n"
        "</body>\n"
        "</html>\n"
    )


def _build_site_css(*, palette: list[str], params: ImageToCodeJobParams) -> str:
    background = palette[0]
    text = _contrast_text_color(background)
    surface = palette[1]
    accent = palette[3]
    accent_secondary = palette[4]
    border = _mix_hex(surface, text, 0.16)
    shadow = _mix_hex(accent, "#0b1020", 0.6)
    max_width = "min(1180px, calc(100vw - 32px))" if params.responsive_shell else "1180px"
    return f"""
:root {{
  --pf-bg: {background};
  --pf-surface: {surface};
  --pf-text: {text};
  --pf-muted: {_mix_hex(text, background, 0.58)};
  --pf-accent: {accent};
  --pf-accent-2: {accent_secondary};
  --pf-border: {border};
  --pf-shadow: {shadow};
  --pf-shell-width: {max_width};
}}

* {{
  box-sizing: border-box;
}}

html, body {{
  margin: 0;
  min-height: 100%;
  background:
    radial-gradient(circle at 18% 18%, {_with_alpha(accent, 0.22)}, transparent 36%),
    radial-gradient(circle at 85% 12%, {_with_alpha(accent_secondary, 0.18)}, transparent 30%),
    linear-gradient(180deg, var(--pf-bg), {_mix_hex(background, "#ffffff", 0.05)});
  color: var(--pf-text);
  font-family: "Trebuchet MS", "Helvetica Neue", "Segoe UI", sans-serif;
}}

body {{
  padding: 24px 0 48px;
}}

.page-shell {{
  width: var(--pf-shell-width);
  margin: 0 auto;
}}

.hero-panel {{
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.95fr);
  gap: 28px;
  align-items: center;
  padding: 42px;
  border: 1px solid var(--pf-border);
  border-radius: 36px;
  background: {_with_alpha(surface, 0.92)};
  box-shadow: 0 28px 64px {_with_alpha(shadow, 0.18)};
  overflow: hidden;
}}

.hero-panel::before {{
  content: "";
  position: absolute;
  inset: 18px auto auto 18px;
  width: 120px;
  height: 120px;
  border-radius: 999px;
  background: {_with_alpha(accent, 0.14)};
  filter: blur(6px);
}}

.hero-copy {{
  position: relative;
  z-index: 1;
}}

.hero-kicker {{
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 999px;
  background: {_with_alpha(accent, 0.14)};
  color: var(--pf-accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}}

.hero-copy h1 {{
  margin: 18px 0 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2.4rem, 4vw, 4.6rem);
  line-height: 0.95;
}}

.hero-subtitle {{
  max-width: 34rem;
  margin: 18px 0 0;
  color: var(--pf-muted);
  font-size: 1rem;
  line-height: 1.8;
}}

.hero-actions {{
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}}

.action {{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 20px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 0.95rem;
  font-weight: 700;
  text-decoration: none;
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}}

.action:hover {{
  transform: translateY(-1px);
}}

.action-primary {{
  background: var(--pf-accent);
  color: {_contrast_text_color(accent)};
  box-shadow: 0 18px 30px {_with_alpha(accent, 0.28)};
}}

.action-secondary {{
  border-color: var(--pf-border);
  color: var(--pf-text);
  background: {_with_alpha("#ffffff", 0.45)};
}}

.hero-meta {{
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-top: 18px;
  color: var(--pf-muted);
  font-size: 0.85rem;
}}

.hero-visual-wrap {{
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 380px;
}}

.hero-visual-orbit {{
  position: absolute;
  inset: 12% 8%;
  border-radius: 32px;
  background:
    linear-gradient(160deg, {_with_alpha(accent, 0.2)}, transparent 55%),
    linear-gradient(340deg, {_with_alpha(accent_secondary, 0.18)}, transparent 45%);
  transform: rotate(-4deg);
}}

.hero-visual {{
  position: relative;
  z-index: 1;
  width: min(100%, 520px);
  aspect-ratio: 4 / 5;
  object-fit: cover;
  border-radius: 28px;
  border: 1px solid {_with_alpha("#ffffff", 0.65)};
  box-shadow: 0 22px 54px {_with_alpha(shadow, 0.22)};
}}

.story-grid {{
  display: grid;
  gap: 18px;
  margin-top: 24px;
}}

.story-block {{
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 18px;
  padding: 28px;
  border-radius: 28px;
  border: 1px solid var(--pf-border);
  background: {_with_alpha(surface, 0.8)};
}}

.story-label {{
  color: var(--pf-muted);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}}

.story-block h2 {{
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1.7rem;
}}

.story-block p {{
  margin: 12px 0 0;
  color: var(--pf-muted);
  line-height: 1.75;
}}

.section-emphasis {{
  color: var(--pf-accent);
  font-weight: 700;
}}

.story-bullets {{
  margin: 16px 0 0;
  padding-left: 20px;
  color: var(--pf-text);
  line-height: 1.8;
}}

.page-footer {{
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px 18px;
  margin-top: 22px;
  padding: 0 10px;
  color: var(--pf-muted);
  font-size: 0.84rem;
}}

.footer-title {{
  font-weight: 700;
  color: var(--pf-text);
}}

@media (max-width: 900px) {{
  body {{
    padding-top: 16px;
  }}

  .hero-panel {{
    grid-template-columns: 1fr;
    padding: 26px;
  }}

  .hero-visual-wrap {{
    min-height: 280px;
  }}

  .story-block {{
    grid-template-columns: 1fr;
  }}
}}
""".strip()


def _build_layers_manifest(
    *,
    analysis_spec: ImageToCodeAnalysisSpec,
    palette: list[str],
    params: ImageToCodeJobParams,
    site_asset_name: str,
    source: ImageToCodeSourceSnapshot,
    analyzer_kind: str,
    warnings: list[str],
) -> dict[str, object]:
    nodes: list[dict[str, object]] = [
        {
            "id": "hero",
            "type": "frame",
            "label": "Hero",
            "x": 72,
            "y": 72,
            "width": 1296,
            "height": 760,
        },
        {
            "id": "hero-title",
            "type": "text",
            "parent_id": "hero",
            "x": 96,
            "y": 166,
            "width": 620,
            "height": 220,
            "text": analysis_spec.hero_title,
        },
        {
            "id": "hero-image",
            "type": "image",
            "parent_id": "hero",
            "x": 840,
            "y": 140,
            "width": 420,
            "height": 520,
            "asset_ref": site_asset_name,
        },
    ]
    section_y = 900
    for section in analysis_spec.sections:
        nodes.append(
            {
                "id": f"section-{section.id}",
                "type": "frame",
                "label": section.title,
                "x": 72,
                "y": section_y,
                "width": 1296,
                "height": 260,
            }
        )
        nodes.append(
            {
                "id": f"section-{section.id}-title",
                "type": "text",
                "parent_id": f"section-{section.id}",
                "x": 240,
                "y": section_y + 34,
                "width": 640,
                "height": 72,
                "text": section.title,
            }
        )
        nodes.append(
            {
                "id": f"section-{section.id}-body",
                "type": "text",
                "parent_id": f"section-{section.id}",
                "x": 240,
                "y": section_y + 116,
                "width": 720,
                "height": 96,
                "text": section.body,
            }
        )
        section_y += 304
    return {
        "version": 1,
        "canvas": {"width": DEFAULT_SITE_FRAME_WIDTH, "height": DEFAULT_SITE_FRAME_HEIGHT},
        "theme": {
            "palette": palette,
            "keywords": analysis_spec.theme_keywords,
            "layout_mood": analysis_spec.layout_mood,
        },
        "meta": {
            "page_title": analysis_spec.page_title,
            "page_type": params.page_type,
            "fidelity_mode": params.fidelity_mode,
            "responsive_shell": params.responsive_shell,
            "analyzer_kind": analyzer_kind,
            "source": {
                "filename": source.filename,
                "width": source.width,
                "height": source.height,
                "mime_type": source.mime_type,
            },
        },
        "assets": [
            {
                "id": site_asset_name,
                "relative_path": f"assets/{site_asset_name}",
                "role": "hero_image",
            }
        ],
        "nodes": nodes,
        "warnings": warnings,
    }


def _build_figma_layer_spec(layers_manifest: dict[str, object]) -> dict[str, object]:
    nodes = []
    for node in layers_manifest.get("nodes", []):
        if not isinstance(node, dict):
            continue
        node_type = str(node.get("type") or "").lower()
        figma_type = "FRAME"
        if node_type == "text":
            figma_type = "TEXT"
        elif node_type == "image":
            figma_type = "RECTANGLE"
        nodes.append(
            {
                "id": node.get("id"),
                "type": figma_type,
                "name": node.get("label") or node.get("text") or node.get("id"),
                "parent_id": node.get("parent_id"),
                "x": node.get("x"),
                "y": node.get("y"),
                "width": node.get("width"),
                "height": node.get("height"),
                "text": node.get("text"),
                "asset_ref": node.get("asset_ref"),
            }
        )
    canvas = layers_manifest.get("canvas") if isinstance(layers_manifest.get("canvas"), dict) else {}
    return {
        "version": 1,
        "document": {
            "name": (
                layers_manifest.get("meta", {}).get("page_title")
                if isinstance(layers_manifest.get("meta"), dict)
                else "Image To Code"
            ),
            "frame_width": canvas.get("width", DEFAULT_SITE_FRAME_WIDTH),
            "frame_height": canvas.get("height", DEFAULT_SITE_FRAME_HEIGHT),
        },
        "theme": layers_manifest.get("theme"),
        "assets": layers_manifest.get("assets"),
        "nodes": nodes,
        "warnings": layers_manifest.get("warnings", []),
        "remote_write": {
            "enabled": False,
            "planned_interface": "reserved_only",
        },
    }


def _build_figma_summary(figma_layer_spec: dict[str, object]) -> dict[str, object]:
    document = figma_layer_spec.get("document") if isinstance(figma_layer_spec.get("document"), dict) else {}
    warnings = figma_layer_spec.get("warnings")
    warning_count = len(warnings) if isinstance(warnings, list) else 0
    nodes = figma_layer_spec.get("nodes")
    node_count = len(nodes) if isinstance(nodes, list) else 0
    return {
        "node_count": node_count,
        "warning_count": warning_count,
        "frame_width": document.get("frame_width", DEFAULT_SITE_FRAME_WIDTH),
        "frame_height": document.get("frame_height", DEFAULT_SITE_FRAME_HEIGHT),
    }


def _build_delivery_report_markdown(
    *,
    source: ImageToCodeSourceSnapshot,
    analysis_spec: ImageToCodeAnalysisSpec,
    delivery_mode: ImageToCodeDeliveryMode,
    params: ImageToCodeJobParams,
    warnings: list[str],
) -> str:
    section_lines = "\n".join(f"- {section.title}: {section.body}" for section in analysis_spec.sections)
    warning_lines = "\n".join(f"- {item}" for item in warnings) if warnings else "- 无"
    return (
        "# Image To Code Delivery Report\n\n"
        f"- Source: `{source.filename}` ({source.width}x{source.height}, {source.mime_type})\n"
        f"- Delivery mode: `{delivery_mode.value}`\n"
        f"- Page type: `{params.page_type}`\n"
        f"- Fidelity mode: `{params.fidelity_mode}`\n"
        f"- Responsive shell: `{'yes' if params.responsive_shell else 'no'}`\n\n"
        "## Hero\n\n"
        f"- Title: {analysis_spec.hero_title}\n"
        f"- Subtitle: {analysis_spec.hero_subtitle}\n\n"
        "## Sections\n\n"
        f"{section_lines}\n\n"
        "## Warnings\n\n"
        f"{warning_lines}\n\n"
        "## Figma\n\n"
        "- Local importer bundle is included when figma export is enabled.\n"
        "- Remote Figma write capability is reserved as an interface boundary and is not enabled in this release.\n"
    )


def _build_figma_import_readme() -> str:
    return (
        "# Figma Import Bundle\n\n"
        "This bundle contains a stable layer spec, an import manifest, and copied image assets.\n\n"
        "## Files\n\n"
        "- `figma_layer_spec.json`: normalized frame/node description.\n"
        "- `import.json`: importer entry and asset-root metadata.\n"
        "- `assets/`: referenced bitmap assets.\n\n"
        "## Remote Write\n\n"
        "Remote Figma write capability is intentionally not enabled in this release.\n"
        "The interface boundary is reserved for future implementation only.\n"
    )


def _build_preview_image(
    *,
    source: ImageToCodeSourceSnapshot,
    analysis_spec: ImageToCodeAnalysisSpec,
    palette: list[str],
) -> bytes:
    canvas = Image.new("RGB", (1600, 900), ImageColor.getrgb(palette[0]))
    draw = ImageDraw.Draw(canvas)
    visual = Image.open(BytesIO(source.content)).convert("RGB")
    visual.thumbnail((620, 680))
    visual_x = canvas.width - visual.width - 120
    visual_y = 110
    canvas.paste(visual, (visual_x, visual_y))
    text_color = ImageColor.getrgb(_contrast_text_color(palette[0]))
    muted_color = ImageColor.getrgb(_mix_hex(_contrast_text_color(palette[0]), palette[0], 0.42))
    accent_color = ImageColor.getrgb(palette[3])
    draw.rounded_rectangle((110, 116, 292, 164), radius=24, fill=accent_color)
    draw.text((136, 130), "IMAGE TO CODE", fill=ImageColor.getrgb(_contrast_text_color(palette[3])))
    draw.text((110, 210), _preview_safe_text(analysis_spec.hero_title, fallback="Image to Code")[:42], fill=text_color)
    draw.multiline_text(
        (110, 300),
        _preview_safe_text(analysis_spec.hero_subtitle, fallback="Structured single-page preview")[:180],
        fill=muted_color,
        spacing=12,
    )
    y = 470
    for section in analysis_spec.sections[:3]:
        draw.text(
            (110, y),
            _preview_safe_text(f"{section.label}  {section.title}", fallback=f"Section {section.label}"),
            fill=text_color,
        )
        draw.multiline_text(
            (110, y + 36),
            _preview_safe_text(section.body, fallback="Structured content block")[:110],
            fill=muted_color,
            spacing=10,
        )
        y += 132
    output = BytesIO()
    canvas.save(output, format="PNG")
    return output.getvalue()


def _extract_palette_hexes(content: bytes) -> list[str]:
    image = Image.open(BytesIO(content)).convert("RGB")
    image.thumbnail((160, 160))
    palette_image = image.convert("P", palette=Image.ADAPTIVE, colors=5).convert("RGB")
    colors = palette_image.getcolors(maxcolors=25_600) or []
    ranked = sorted(colors, key=lambda item: item[0], reverse=True)
    values = [_rgb_to_hex(color) for _, color in ranked[:5]]
    while len(values) < 5:
        fallback = ["#f4efe8", "#f8f6f1", "#1f2a37", "#bc7b4b", "#7f9b82"][len(values)]
        values.append(fallback)
    if _luminance(values[0]) < 0.32:
        values[0] = _mix_hex(values[0], "#f7f3ec", 0.24)
    return values


def _site_file_bytes(site_files: list[GeneratedFilePayload], relative_path: str) -> bytes:
    for item in site_files:
        if item.relative_path == relative_path:
            return item.content
    raise ValueError(f"缺少站点文件: {relative_path}")


def _zip_file_payloads(file_payloads: list[GeneratedFilePayload]) -> bytes:
    output = BytesIO()
    with ZipFile(output, mode="w", compression=ZIP_DEFLATED) as archive:
        for item in file_payloads:
            archive.writestr(item.relative_path, item.content)
    return output.getvalue()


def _json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def _image_data_url(source: ImageToCodeSourceSnapshot) -> str:
    encoded = base64.b64encode(source.content).decode("ascii")
    return f"data:{source.mime_type};base64,{encoded}"


def _normalized_suffix_from_filename(filename: str, mime_type: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix:
        return suffix
    guessed = mimetypes.guess_extension(mime_type.split(";", 1)[0].strip()) or ".bin"
    return guessed


def _default_page_title(filename: str) -> str:
    stem = Path(filename).stem.strip().replace("_", " ").replace("-", " ")
    return stem or "Image To Code"


def _preview_safe_text(value: str, *, fallback: str) -> str:
    ascii_text = value.encode("ascii", "ignore").decode("ascii").strip()
    return ascii_text or fallback


def _rgb_to_hex(color: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*color)


def _luminance(color_hex: str) -> float:
    red, green, blue = ImageColor.getrgb(color_hex)
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255


def _contrast_text_color(background_hex: str) -> str:
    return "#101418" if _luminance(background_hex) > 0.6 else "#f8f7f2"


def _mix_hex(left_hex: str, right_hex: str, ratio: float) -> str:
    ratio = max(0.0, min(1.0, ratio))
    left = ImageColor.getrgb(left_hex)
    right = ImageColor.getrgb(right_hex)
    return _rgb_to_hex(
        tuple(int(round(left[index] * (1 - ratio) + right[index] * ratio)) for index in range(3))  # type: ignore[arg-type]
    )


def _with_alpha(color_hex: str, alpha: float) -> str:
    red, green, blue = ImageColor.getrgb(color_hex)
    return f"rgba({red}, {green}, {blue}, {max(0.0, min(1.0, alpha)):.3f})"
