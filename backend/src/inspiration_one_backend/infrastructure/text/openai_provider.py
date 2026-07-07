from __future__ import annotations

from openai import OpenAI

from inspiration_one_backend.application.contracts import (
    CopyNodeConfigV2,
    CopyPayloadV2,
    CreativeBriefPayload,
    DeckOutlineInput,
    DeckOutlinePayload,
    InspirationInput,
    ReferenceImageInput,
    SpeakerNotesInput,
    SpeakerNotesPayload,
    TailSplitPlanDraft,
    TailSplitPlanInput,
)
from inspiration_one_backend.application.copy_payloads import normalize_copy_payload
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.infrastructure.openai_client import build_openai_client_kwargs
from inspiration_one_backend.infrastructure.openai_response_parsing import (
    read_json_object_from_response,
    response_output_text,
)
from inspiration_one_backend.infrastructure.prompts import text_or_default
from inspiration_one_backend.infrastructure.provider_config import (
    ResolvedTextProviderConfig,
    resolve_text_provider_config,
)
from inspiration_one_backend.infrastructure.text.base import TextProvider
from inspiration_one_backend.infrastructure.text.prompt_context import (
    BRIEF_SYSTEM_FALLBACK,
    COPY_SYSTEM_FALLBACK,
    build_brief_user_content,
    build_copy_user_content,
)
from inspiration_one_backend.infrastructure.text.structured_output import (
    BRIEF_SCHEMA,
    COPY_SCHEMA,
    DECK_OUTLINE_SCHEMA,
    POLISHED_PROMPT_SCHEMA,
    SPEAKER_NOTES_SCHEMA,
    STRUCTURED_OUTPUT_TEST_SCHEMA,
    TAIL_SPLIT_SCHEMA,
    TextStructuredOutputSchema,
    read_polished_prompt_from_payload,
    responses_text_config,
    structured_output_instructions,
)


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
        self.structured_output = resolved_config.structured_output
        self.brief_system_prompt = settings.prompt_brief_system
        self.copy_system_prompt = settings.prompt_copy_system
        self.image_prompt_polish_system_prompt = settings.prompt_image_prompt_polish_system
        self.tail_split_system_prompt = settings.prompt_tail_split_system

    def _responses_create(
        self,
        *,
        model: str,
        instructions: str,
        input: list[dict],
        structured_schema: TextStructuredOutputSchema,
    ):
        payload = {
            "model": model,
            "instructions": structured_output_instructions(
                instructions,
                self.structured_output,
                structured_schema,
            ),
            "input": input,
        }
        text_config = responses_text_config(self.structured_output, structured_schema)
        if text_config is not None:
            payload["text"] = text_config
        return self.client.responses.create(**payload)

    def _read_output_json(self, response) -> dict:
        return read_json_object_from_response(response, error_label="文案 provider")

    def generate_brief(self, inspiration: InspirationInput) -> tuple[CreativeBriefPayload, str]:
        response = self._responses_create(
            model=self.brief_model,
            instructions=text_or_default(self.brief_system_prompt, BRIEF_SYSTEM_FALLBACK),
            input=[
                {
                    "role": "user",
                    "content": build_brief_user_content(inspiration),
                },
            ],
            structured_schema=BRIEF_SCHEMA,
        )
        payload = CreativeBriefPayload.model_validate(self._read_output_json(response))
        return payload, self.brief_model

    def generate_copy(
        self,
        inspiration: InspirationInput,
        brief: CreativeBriefPayload,
        config: CopyNodeConfigV2 | None = None,
        reference_images: list[ReferenceImageInput] | None = None,
    ) -> tuple[CopyPayloadV2, str]:
        config = config or CopyNodeConfigV2()
        reference_images = reference_images or []
        response = self._responses_create(
            model=self.copy_model,
            instructions=text_or_default(self.copy_system_prompt, COPY_SYSTEM_FALLBACK),
            input=[
                {
                    "role": "user",
                    "content": build_copy_user_content(inspiration, brief, config, reference_images),
                },
            ],
            structured_schema=COPY_SCHEMA,
        )
        payload = normalize_copy_payload(self._read_output_json(response), fallback_purpose=config.purpose)
        return payload, self.copy_model

    def polish_image_prompt(self, prompt: str) -> tuple[str, str]:
        response = self._responses_create(
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
            structured_schema=POLISHED_PROMPT_SCHEMA,
        )
        polished = (
            read_polished_prompt_from_payload(self._read_output_json(response))
            if self.structured_output.enabled
            else response_output_text(response).strip()
        )
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
        response = self._responses_create(
            model=self.copy_model,
            instructions=text_or_default(
                self.tail_split_system_prompt,
                "把输入拆成多条彼此独立、适合后续单独生图的方向。只输出 JSON 对象。",
            ),
            input=[
                {
                    "role": "user",
                    "content": (
                        f"灵感产物名：{payload.inspiration_name}\n"
                        f"类目：{payload.category or '未提供'}\n"
                        f"价格：{payload.price or '未提供'}\n"
                        f"灵感产物描述/补充说明：{payload.source_note or '未提供'}\n"
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
                        '5. source_refs 必须是字符串数组，例如 ["入口长文本：正视图", "参考图 1"]；'
                        "没有来源时输出 []。"
                    ),
                },
            ],
            structured_schema=TAIL_SPLIT_SCHEMA,
        )
        return TailSplitPlanDraft.model_validate(self._read_output_json(response)), self.copy_model

    def generate_outline(self, payload: DeckOutlineInput) -> tuple[DeckOutlinePayload, str]:
        response = self._responses_create(
            model=self.copy_model,
            instructions=(
                "你是演示文稿策划。基于灵感素材与补充输入，整理成整页图片式幻灯片大纲。"
                "每页文字精炼（标题 + 不超过 4 条要点），控制文字量以便图像模型生成整页图。只输出 JSON 对象。"
            ),
            input=[
                {
                    "role": "user",
                    "content": (
                        f"灵感产物名：{payload.inspiration_name}\n"
                        f"类目：{payload.category or '未提供'}\n"
                        f"补充说明：{payload.source_note or '未提供'}\n"
                        f"灵感素材摘要：\n{payload.material_summary or '未提供'}\n"
                        f"用户补充长文/要点：\n{payload.source_input or '未提供'}\n"
                        f"最多页数：{payload.max_slides}\n"
                        "请输出字段：title、slides。slides 为有序数组，每项含 title、points(字符串数组)、"
                        "material_hint(可空)。\n"
                        "要求：1) 页数不超过最多页数，按内容合理取值；2) 每页要点精炼、控制文字量；"
                        "3) 首页为封面/概览；4) material_hint 指出该页适合插入的真实配图意图，没有则为 null。"
                    ),
                },
            ],
            structured_schema=DECK_OUTLINE_SCHEMA,
        )
        return DeckOutlinePayload.model_validate(self._read_output_json(response)), self.copy_model

    def generate_speaker_notes(self, payload: SpeakerNotesInput) -> tuple[SpeakerNotesPayload, str]:
        response = self._responses_create(
            model=self.copy_model,
            instructions="为演示文稿单页写简洁、口语化的中文演讲备注。只输出 JSON 对象。",
            input=[
                {
                    "role": "user",
                    "content": (
                        f"演示主题：{payload.deck_title}\n"
                        f"本页标题：{payload.slide_title}\n"
                        f"本页要点：{'；'.join(payload.points) or '未提供'}\n"
                        "请输出字段：notes（一段演讲备注文本）。"
                    ),
                },
            ],
            structured_schema=SPEAKER_NOTES_SCHEMA,
        )
        return SpeakerNotesPayload.model_validate(self._read_output_json(response)), self.copy_model

    def test_structured_output(self) -> tuple[dict, str]:
        response = self._responses_create(
            model=self.copy_model,
            instructions="只输出 JSON 对象，不要输出 markdown、标题或解释。",
            input=[
                {
                    "role": "user",
                    "content": (
                        '请返回一个 JSON 对象，包含字段 ok=true、kind="text_structured_output_test"、'
                        'items=["structured_output"]。'
                    ),
                },
            ],
            structured_schema=STRUCTURED_OUTPUT_TEST_SCHEMA,
        )
        payload = self._read_output_json(response)
        if not payload:
            raise ValueError("文案结构化输出测试返回空 JSON 对象")
        return payload, self.copy_model

    def test_structured_json_response_format(self) -> tuple[dict, str]:
        return self.test_structured_output()
