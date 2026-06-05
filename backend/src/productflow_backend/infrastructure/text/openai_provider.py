from __future__ import annotations

from openai import OpenAI

from productflow_backend.application.contracts import (
    CopyNodeConfigV2,
    CopyPayloadV2,
    CreativeBriefPayload,
    ProductInput,
    ReferenceImageInput,
    TailSplitPlanDraft,
    TailSplitPlanInput,
)
from productflow_backend.application.copy_payloads import normalize_copy_payload
from productflow_backend.config import get_runtime_settings
from productflow_backend.infrastructure.openai_client import build_openai_client_kwargs
from productflow_backend.infrastructure.openai_response_parsing import (
    read_json_object_from_response,
    response_output_text,
)
from productflow_backend.infrastructure.prompts import text_or_default
from productflow_backend.infrastructure.provider_config import (
    ResolvedTextProviderConfig,
    resolve_text_provider_config,
)
from productflow_backend.infrastructure.text.base import TextProvider


class OpenAITextProvider(TextProvider):
    provider_name = "openai"
    prompt_version = "responses-json-v1"

    def __init__(self, provider_config: ResolvedTextProviderConfig | None = None) -> None:
        settings = get_runtime_settings()
        resolved_config = provider_config or resolve_text_provider_config()
        self.client = OpenAI(
            **build_openai_client_kwargs(api_key=resolved_config.api_key, base_url=resolved_config.base_url)
        )
        self.brief_model = resolved_config.brief_model
        self.copy_model = resolved_config.copy_model
        self.brief_system_prompt = settings.prompt_brief_system
        self.copy_system_prompt = settings.prompt_copy_system
        self.image_prompt_polish_system_prompt = settings.prompt_image_prompt_polish_system
        self.tail_split_system_prompt = settings.prompt_tail_split_system

    def _read_output_json(self, response) -> dict:
        return read_json_object_from_response(response, error_label="文案 provider")

    def generate_brief(self, product: ProductInput) -> tuple[CreativeBriefPayload, str]:
        response = self.client.responses.create(
            model=self.brief_model,
            instructions=text_or_default(self.brief_system_prompt, "请输出简洁、结构化的中文 JSON。"),
            input=[
                {
                    "role": "user",
                    "content": (
                        f"商品名：{product.name}\n"
                        f"类目：{product.category or '未提供'}\n"
                        f"价格：{product.price or '未提供'}\n"
                        f"商品描述/补充说明：{product.source_note or '未提供'}\n"
                        "请输出字段：positioning、audience、selling_angles(3到5条)、"
                        "taboo_phrases、poster_style_hint。"
                    ),
                },
            ],
        )
        payload = CreativeBriefPayload.model_validate(self._read_output_json(response))
        return payload, self.brief_model

    def generate_copy(
        self,
        product: ProductInput,
        brief: CreativeBriefPayload,
        config: CopyNodeConfigV2 | None = None,
        reference_images: list[ReferenceImageInput] | None = None,
    ) -> tuple[CopyPayloadV2, str]:
        config = config or CopyNodeConfigV2()
        reference_images = reference_images or []
        reference_lines = [
            (
                f"{index}. {reference.label or reference.filename}"
                f"（角色：{reference.role or '参考图'}，类型：{reference.mime_type}，文件：{reference.filename}）"
            )
            for index, reference in enumerate(reference_images, start=1)
        ]
        reference_text = "\n".join(reference_lines) if reference_lines else "未连接"
        response = self.client.responses.create(
            model=self.copy_model,
            instructions=text_or_default(self.copy_system_prompt, "请输出中文 JSON，不要输出 markdown。"),
            input=[
                {
                    "role": "user",
                    "content": (
                        f"商品名：{product.name}\n"
                        f"类目：{product.category or '未提供'}\n"
                        f"价格：{product.price or '未提供'}\n"
                        f"商品描述/补充说明：{product.source_note or '未提供'}\n"
                        f"参考图：{reference_text}\n"
                        f"文案用途：{config.purpose or '未指定'}\n"
                        f"输出模式：{config.output_mode}\n"
                        f"渠道：{config.channel or '未指定'}\n"
                        f"语气：{config.tone or '未指定'}\n"
                        f"本轮文案要求：{config.instruction or '按商品和场景自由组织文案'}\n"
                        f"可选槽位：{[slot.model_dump(mode='json') for slot in config.requested_slots]}\n"
                        f"商品定位：{brief.positioning}\n"
                        f"目标人群：{brief.audience}\n"
                        f"卖点角度：{', '.join(brief.selling_angles)}\n"
                        f"禁忌表达：{', '.join(brief.taboo_phrases) or '无'}\n"
                        "请输出 v2 JSON 外壳：version=2、purpose、summary、content、visual_guidance。\n"
                        "content.kind 必须是 freeform、blocks 或 layout_brief。"
                        "不要为了满足固定字段编造 CTA、海报标题或固定 3 到 5 条卖点。"
                    ),
                },
            ],
        )
        payload = normalize_copy_payload(self._read_output_json(response), fallback_purpose=config.purpose)
        return payload, self.copy_model

    def polish_image_prompt(self, prompt: str) -> tuple[str, str]:
        response = self.client.responses.create(
            model=self.copy_model,
            instructions=text_or_default(
                self.image_prompt_polish_system_prompt,
                "只输出润色后的中文画面描述，不要输出 markdown、标题或解释。",
            ),
            input=[
                {
                    "role": "user",
                    "content": f"原始画面描述：\n{prompt.strip()}",
                },
            ],
        )
        polished = response_output_text(response).strip()
        if not polished:
            raise ValueError("文案 provider 未返回润色结果")
        return polished, self.copy_model

    def generate_tail_split_plan(self, payload: TailSplitPlanInput) -> tuple[TailSplitPlanDraft, str]:
        reference_lines = [
            (
                f"{index}. {reference.label or reference.filename}"
                f"（角色：{reference.role or '参考图'}，类型：{reference.mime_type}，文件：{reference.filename}）"
            )
            for index, reference in enumerate(payload.reference_images, start=1)
        ]
        upstream_text = "\n".join(
            f"{index}. {text}" for index, text in enumerate(payload.upstream_text_contexts, start=1)
        )
        response = self.client.responses.create(
            model=self.copy_model,
            instructions=text_or_default(
                self.tail_split_system_prompt,
                "把输入拆成多条彼此独立、适合后续单独生图的方向。只输出 JSON 对象。",
            ),
            input=[
                {
                    "role": "user",
                    "content": (
                        f"商品名：{payload.product_name}\n"
                        f"类目：{payload.category or '未提供'}\n"
                        f"价格：{payload.price or '未提供'}\n"
                        f"商品描述/补充说明：{payload.source_note or '未提供'}\n"
                        f"粘贴长文本：{payload.source_text or '未提供'}\n"
                        f"尾巴节点描述：{payload.description or '未提供'}\n"
                        f"上游文案上下文：\n{upstream_text or '未提供'}\n"
                        f"参考图：\n{chr(10).join(reference_lines) if reference_lines else '未提供'}\n"
                        f"最多拆分项：{payload.max_items}\n"
                        "请输出字段：source_summary、items。\n"
                        "items 为数组，每项包含 title、instruction、visual_intent、source_refs。\n"
                        "要求：\n"
                        "1. 最多拆分项是数量上限，不是必须输出的数量；请按实际内容输出 1 到该上限之间的合理数量；\n"
                        "2. 不要为了填满上限硬拆，也不要把同一画面目标改写成多个 item；\n"
                        "3. instruction 必须是可直接用于后续生图触发器的完整中文提示词；\n"
                        "4. 每个 item 聚焦不同画面目标，不要只是同义改写；\n"
                        "5. source_refs 必须是字符串数组，例如 [\"入口长文本：正视图\", \"参考图 1\"]；"
                        "没有来源时输出 []。"
                    ),
                },
            ],
        )
        return TailSplitPlanDraft.model_validate(self._read_output_json(response)), self.copy_model
