from __future__ import annotations

import json
import logging
from base64 import b64encode
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from helpers import (
    _execute_workflow_queue_inline,
    _login,
    _make_demo_image_bytes,
    _make_demo_image_data_url,
    _wait_for_workflow_run,
)
from PIL import Image
from pydantic import ValidationError

from inspiration_one_backend.application.contracts import (
    BlocksCopyContent,
    CopyBlock,
    CopyNodeConfigV2,
    CopyPayloadV2,
    CopySection,
    CreativeBriefPayload,
    FreeformCopyContent,
    InspirationInput,
    LayoutBriefCopyContent,
    PosterGenerationInput,
    ReferenceImageInput,
    TailSplitPlanInput,
)
from inspiration_one_backend.application.copy_payloads import normalize_copy_payload
from inspiration_one_backend.application.inspiration_workflow_dependencies import WorkflowExecutionDependencies
from inspiration_one_backend.application.inspiration_workflows import run_inspiration_workflow
from inspiration_one_backend.application.use_cases import (
    create_inspiration,
    get_inspiration_detail,
)
from inspiration_one_backend.config import DEFAULT_WORKFLOW_IMAGE_GENERATION_PROVIDER_TIMEOUT_SECONDS, get_settings
from inspiration_one_backend.domain.enums import (
    PosterKind,
)
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    AppSetting,
    ProviderBinding,
    ProviderProfile,
)
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.image.gemini_provider import (
    GoogleGeminiImageClient,
    GoogleGeminiImageProvider,
    GoogleGeminiReferenceImage,
    map_inspiration_one_size_to_gemini_image_config,
)
from inspiration_one_backend.infrastructure.image.images_provider import OpenAIImagesImageProvider
from inspiration_one_backend.infrastructure.image.openai_chat_provider import (
    OpenAIChatImageClient,
    OpenAIChatImageProvider,
)
from inspiration_one_backend.infrastructure.image.responses_provider import (
    OpenAIResponsesImageClient,
    OpenAIResponsesImageProvider,
)
from inspiration_one_backend.infrastructure.openai_client import (
    OPENAI_COMPATIBLE_DEFAULT_HEADERS,
    OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS,
    build_openai_client_kwargs,
)
from inspiration_one_backend.infrastructure.provider_config import (
    ResolvedImageProviderConfig,
    ResolvedTextProviderConfig,
)
from inspiration_one_backend.infrastructure.text.openai_chat_completions_provider import (
    OpenAIChatCompletionsTextProvider,
    normalize_chat_completions_url,
)

REMOVED_COPY_OUTPUT_KEYS = [
    "derived" + "_fields",
    "title",
    "selling" + "_points",
    "poster" + "_headline",
    "c" + "ta",
]


def test_openai_client_kwargs_include_default_timeout() -> None:
    kwargs = build_openai_client_kwargs(api_key="test-key", base_url="https://openai.example/v1")

    assert kwargs["timeout"] == OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS
    assert kwargs["default_headers"] == OPENAI_COMPATIBLE_DEFAULT_HEADERS
    assert kwargs["base_url"] == "https://openai.example/v1"


def test_responses_background_poll_has_deadline(configured_env: Path) -> None:
    client = OpenAIResponsesImageClient(
        ResolvedImageProviderConfig(
            provider_kind="openai_responses",
            model="gpt-image-2",
            api_key="test-key",
            responses_background_enabled=True,
        )
    )
    client.background_poll_timeout_seconds = 0.0
    response = SimpleNamespace(id="resp_timeout", status="in_progress")

    class DummyResponses:
        def retrieve(self, response_id: str):
            return SimpleNamespace(id=response_id, status="in_progress")

    dummy_client = SimpleNamespace(responses=DummyResponses())

    with pytest.raises(TimeoutError, match="后台生成超时"):
        client._poll_background_response(
            dummy_client,
            response,
            request_payload={"model": "gpt-image-2"},
            progress_callback=None,
            task_context={},
        )


@pytest.fixture(autouse=True)
def _execute_workflow_queue_inline_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep API workflow tests deterministic while production delivery goes through Dramatiq."""

    _execute_workflow_queue_inline(monkeypatch)


def _progress_collector_with_context(
    *,
    task_id: str,
    session_id: str,
    candidate_index: int,
    candidate_count: int,
):
    events: list[dict] = []

    def append(progress: dict) -> None:
        events.append(progress)

    append.inspiration_one_context = {  # type: ignore[attr-defined]
        "task_id": task_id,
        "session_id": session_id,
        "candidate_index": candidate_index,
        "candidate_count": candidate_count,
    }
    return append


class DummyImagesAPIItem:
    def __init__(self, b64_json: str | None, revised_prompt: str | None = "revised prompt") -> None:
        self.b64_json = b64_json
        self.revised_prompt = revised_prompt


class DummyImagesAPIResponse:
    def __init__(self, b64_json: str | None = None, *, b64_jsons: list[str | None] | None = None) -> None:
        self.data = [DummyImagesAPIItem(item) for item in (b64_jsons if b64_jsons is not None else [b64_json])]


def test_prompt_settings_reach_provider_prompt_builders(configured_env: Path, monkeypatch) -> None:
    from inspiration_one_backend.infrastructure.image.chat_service import ImageChatService, ImageChatTurn
    from inspiration_one_backend.infrastructure.prompts import render_prompt_template
    from inspiration_one_backend.infrastructure.text.openai_provider import OpenAITextProvider

    assert (
        render_prompt_template(
            '示例 JSON：{"title":"{title}"}；未知：{unknown}；坏括号：{',
            {"title": "主标题"},
        )
        == '示例 JSON：{"title":"主标题"}；未知：{unknown}；坏括号：{'
    )

    session = get_session_factory()()
    try:
        session.add_all(
            [
                AppSetting(key="prompt_brief_system", value="自定义灵感产物理解提示"),
                AppSetting(key="prompt_copy_system", value="自定义文案提示"),
                AppSetting(
                    key="prompt_poster_image_template",
                    value=(
                        "自定义海报 {inspiration_name} / {instruction} / {kind_label} / "
                        "{context_block} / {reference_policy}"
                    ),
                ),
                AppSetting(
                    key="prompt_poster_image_edit_template",
                    value="自定义改图 {inspiration_name} / {instruction} / {kind_label} / {size} / {reference_policy}",
                ),
                AppSetting(
                    key="prompt_poster_image_reference_policy",
                    value="自定义视觉参考规则",
                ),
                AppSetting(
                    key="prompt_image_chat_template",
                    value="自定义连续生图 {size} / {history_block} / {prompt}",
                ),
            ]
        )
        session.commit()
    finally:
        session.close()

    text_calls: list[dict] = []
    text_client_kwargs: list[dict] = []

    class DummyTextResponse:
        def __init__(self, output_text: str) -> None:
            self.output_text = output_text

    class DummyTextResponses:
        def create(self, **kwargs):
            text_calls.append(kwargs)
            if len(text_calls) == 1:
                return DummyTextResponse(
                    '{"positioning":"入门定位","audience":"新手","selling_angles":["稳","快","省"],'
                    '"taboo_phrases":[],"poster_style_hint":"白底"}'
                )
            return DummyTextResponse(
                '{"version":2,"summary":"主标题","content":{"kind":"blocks","blocks":[{"id":"headline","text":"标题"}]}}'
            )

    class DummyTextOpenAI:
        def __init__(self, **kwargs) -> None:
            text_client_kwargs.append(kwargs)
            self.responses = DummyTextResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.text.openai_provider.OpenAI", DummyTextOpenAI)

    text_provider = OpenAITextProvider(
        ResolvedTextProviderConfig(
            provider_kind="openai",
            brief_model="brief-model",
            copy_model="copy-model",
            api_key="super-secret-text-key",
        )
    )
    inspiration_input = InspirationInput(
        name="测试灵感产物",
        category="类目",
        price="9.90",
        source_note="说明",
        image_path="/tmp/a.png",
    )
    brief, _ = text_provider.generate_brief(inspiration_input)
    text_provider.generate_copy(inspiration_input, brief)

    assert text_client_kwargs == [
        {
            "api_key": "super-secret-text-key",
            "default_headers": OPENAI_COMPATIBLE_DEFAULT_HEADERS,
            "timeout": OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS,
        }
    ]
    assert text_calls[0]["instructions"] == "自定义灵感产物理解提示"
    assert text_calls[0]["input"][0]["role"] == "user"
    assert text_calls[1]["instructions"] == "自定义文案提示"
    assert text_calls[1]["input"][0]["role"] == "user"

    source_path = configured_env / "prompt-provider-source.png"
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(_make_demo_image_bytes())
    poster_prompt = OpenAIResponsesImageProvider()._build_prompt(
        PosterGenerationInput(
            inspiration_name="测试灵感产物",
            category="类目",
            price="9.90",
            source_note="说明",
            instruction="强调轻便",
            structured_copy_context="摘要：主标题\n卖点：卖点一\n卖点：卖点二\n卖点：卖点三",
            source_image=source_path,
        ),
        PosterKind.MAIN_IMAGE,
        "1024x1024",
    )
    assert "自定义海报 测试灵感产物 / 强调轻便 / 主图 /" in poster_prompt
    assert "可用文案参考" in poster_prompt
    assert "卖点：卖点一" in poster_prompt
    assert poster_prompt.endswith("自定义视觉参考规则")

    edit_prompt = OpenAIResponsesImageProvider()._build_prompt(
        PosterGenerationInput(
            copy_prompt_mode="image_edit",
            inspiration_name="测试灵感产物",
            category="类目",
            price="9.90",
            source_note="说明",
            instruction="改成白底，保留主体",
            source_image=source_path,
        ),
        PosterKind.MAIN_IMAGE,
        "1024x1024",
    )
    assert edit_prompt == "自定义改图 测试灵感产物 / 改成白底，保留主体 / 主图 / 1024x1024 / 自定义视觉参考规则"

    chat_prompt = ImageChatService()._build_prompt(
        "改成白底",
        [ImageChatTurn(role="user", content="先做一个主图")],
        "1024x1024",
    )
    assert "自定义连续生图 1024x1024" in chat_prompt
    assert "用户：先做一个主图" in chat_prompt
    assert chat_prompt.endswith("改成白底")


def test_openai_text_provider_reads_sse_text_response() -> None:
    from inspiration_one_backend.infrastructure.text.openai_provider import OpenAITextProvider

    provider = object.__new__(OpenAITextProvider)
    response = "\n".join(
        [
            "event: response.output_text.delta",
            'data: {"type":"response.output_text.delta","delta":"{\\"version\\":2,"}',
            "",
            "event: response.output_text.delta",
            'data: {"type":"response.output_text.delta","delta":"\\"summary\\":\\"促销文案\\","}',
            "",
            "event: response.output_text.delta",
            (
                'data: {"type":"response.output_text.delta","delta":"\\"content\\":'
                '{\\"kind\\":\\"freeform\\",\\"text\\":\\"五一促销\\"}}"}'
            ),
            "",
            "event: response.completed",
            'data: {"type":"response.completed","response":{"output":[]}}',
        ]
    )

    assert provider._read_output_json(response) == {
        "version": 2,
        "summary": "促销文案",
        "content": {"kind": "freeform", "text": "五一促销"},
    }


def test_openai_chat_completions_text_provider_sends_non_stream_payload_and_reads_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict] = []
    client_kwargs: list[dict] = []

    class DummyResponse:
        headers = {"content-type": "application/json"}
        text = '{"choices":[{"message":{"content":"润色后的画面描述"}}]}'

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"choices": [{"message": {"content": "润色后的画面描述"}}]}

    class DummyHTTPXClient:
        def __init__(self, **kwargs) -> None:
            client_kwargs.append(kwargs)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, *, json: dict):
            calls.append({"url": url, "json": json})
            return DummyResponse()

    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.text.openai_chat_completions_provider.httpx.Client",
        DummyHTTPXClient,
    )

    provider = OpenAIChatCompletionsTextProvider(
        ResolvedTextProviderConfig(
            provider_kind="openai_chat_completions",
            brief_model="brief-model",
            copy_model="copy-model",
            api_key="demo-api-key",
            base_url="https://gateway.example/v1",
        )
    )

    text, model = provider.polish_image_prompt("改成白底")

    assert text == "润色后的画面描述"
    assert model == "copy-model"
    assert client_kwargs == [
        {
            "timeout": OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS,
            "headers": {
                **OPENAI_COMPATIBLE_DEFAULT_HEADERS,
                "Authorization": "Bearer demo-api-key",
                "Content-Type": "application/json",
            },
        }
    ]
    assert calls[0]["url"] == "https://gateway.example/v1/chat/completions"
    payload = calls[0]["json"]
    assert payload["model"] == "copy-model"
    assert payload["stream"] is False
    assert "response_format" not in payload
    assert payload["messages"][0]["role"] == "system"
    assert "只输出润色后的中文画面描述，不要输出 markdown、标题或解释。" in payload["messages"][0]["content"]
    assert payload["messages"][1] == {"role": "user", "content": "原始画面描述：\n改成白底"}


def test_openai_chat_completions_text_provider_sends_response_format_for_json_tasks_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses = [
        {
            "positioning": "通勤保温杯",
            "audience": "上班族",
            "selling_angles": ["保温", "轻便", "好清洁"],
            "taboo_phrases": [],
            "poster_style_hint": "白底",
        },
        {
            "version": 2,
            "summary": "通勤杯文案",
            "content": {"kind": "freeform", "text": "轻便保温，通勤随手带。"},
        },
        {
            "source_summary": "通勤杯素材",
            "items": [
                {
                    "title": "白底主图",
                    "instruction": "生成白底通勤杯主图",
                    "visual_intent": "突出杯身和保温",
                    "source_refs": ["入口长文本"],
                }
            ],
        },
        "润色后的画面描述",
    ]
    calls: list[dict] = []

    class DummyResponse:
        headers = {"content-type": "application/json"}

        def __init__(self, content: dict | str) -> None:
            self._payload = {"choices": [{"message": {"content": json.dumps(content, ensure_ascii=False)}}]}
            if isinstance(content, str):
                self._payload = {"choices": [{"message": {"content": content}}]}
            self.text = json.dumps(self._payload, ensure_ascii=False)

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self._payload

    class DummyHTTPXClient:
        def __init__(self, **kwargs) -> None:
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, *, json: dict):
            calls.append({"url": url, "json": json})
            return DummyResponse(responses.pop(0))

    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.text.openai_chat_completions_provider.httpx.Client",
        DummyHTTPXClient,
    )

    provider = OpenAIChatCompletionsTextProvider(
        ResolvedTextProviderConfig(
            provider_kind="openai_chat_completions",
            brief_model="brief-model",
            copy_model="copy-model",
            api_key="demo-api-key",
            base_url="https://gateway.example/v1",
            structured_json_response_format_enabled=True,
        )
    )
    inspiration = InspirationInput(name="通勤杯", category="杯具", price="99", source_note="轻量杯身", image_path="")

    brief, _ = provider.generate_brief(inspiration)
    copy_payload, _ = provider.generate_copy(inspiration, brief)
    tail_plan, _ = provider.generate_tail_split_plan(
        TailSplitPlanInput(inspiration_name="通勤杯", source_text="白底主图", max_items=2)
    )
    polished, _ = provider.polish_image_prompt("改成白底")

    assert brief.positioning == "通勤保温杯"
    assert copy_payload.summary == "通勤杯文案"
    assert tail_plan.items[0].title == "白底主图"
    assert polished == "润色后的画面描述"
    assert [call["json"].get("response_format") for call in calls] == [
        {"type": "json_object"},
        {"type": "json_object"},
        {"type": "json_object"},
        None,
    ]


def test_openai_chat_completions_text_provider_reads_sse_despite_stream_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses = [
        "\n".join(
            [
                'data: {"choices":[{"delta":{"content":"{\\"positioning\\":\\"通勤保温杯\\","}}]}',
                "",
                'data: {"choices":[{"delta":{"content":"\\"audience\\":\\"上班族\\","}}]}',
                "",
                (
                    'data: {"choices":[{"delta":{"content":"\\"selling_angles\\":[\\"保温\\",\\"轻便\\",'
                    '\\"好清洁\\"],\\"taboo_phrases\\":[],\\"poster_style_hint\\":\\"白底\\"}"}}]}'
                ),
                "",
                "data: [DONE]",
            ]
        ),
        "\n".join(
            [
                'data: {"choices":[{"delta":{"content":"{\\"version\\":2,\\"summary\\":\\"通勤杯文案\\","}}]}',
                "",
                (
                    'data: {"choices":[{"delta":{"content":"\\"content\\":{\\"kind\\":\\"freeform\\",'
                    '\\"text\\":\\"轻便保温，通勤随手带\\"}}"}}]}'
                ),
                "",
                "data: [DONE]",
            ]
        ),
    ]
    calls: list[dict] = []

    class DummyResponse:
        headers = {"content-type": "text/event-stream"}

        def __init__(self, text: str) -> None:
            self.text = text

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            raise AssertionError("SSE response should not be parsed as JSON")

    class DummyHTTPXClient:
        def __init__(self, **kwargs) -> None:
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, *, json: dict):
            calls.append({"url": url, "json": json})
            return DummyResponse(responses.pop(0))

    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.text.openai_chat_completions_provider.httpx.Client",
        DummyHTTPXClient,
    )

    provider = OpenAIChatCompletionsTextProvider(
        ResolvedTextProviderConfig(
            provider_kind="openai_chat_completions",
            brief_model="brief-model",
            copy_model="copy-model",
            api_key="demo-api-key",
            base_url="https://gateway.example",
        )
    )

    inspiration = InspirationInput(
        name="通勤杯",
        category="杯具",
        price="99",
        source_note="轻量杯身",
        image_path="/tmp/source.png",
    )
    brief, brief_model = provider.generate_brief(inspiration)
    copy_payload, copy_model = provider.generate_copy(inspiration, brief)

    assert brief_model == "brief-model"
    assert copy_model == "copy-model"
    assert brief.positioning == "通勤保温杯"
    assert brief.audience == "上班族"
    assert copy_payload.summary == "通勤杯文案"
    assert copy_payload.content.kind == "freeform"
    assert all(call["json"]["stream"] is False for call in calls)
    assert [call["url"] for call in calls] == [
        "https://gateway.example/v1/chat/completions",
        "https://gateway.example/v1/chat/completions",
    ]


def test_openai_chat_completions_text_provider_normalizes_loose_copy_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses = [
        {
            "choices": [
                {
                    "message": {
                        "content": (
                            '{"positioning":"通勤保温杯","audience":"上班族",'
                            '"selling_angles":["保温","轻便","好清洁"],'
                            '"taboo_phrases":[],"poster_style_hint":"白底"}'
                        )
                    }
                }
            ]
        },
        {
            "choices": [
                {
                    "message": {
                        "content": (
                            '{"主标题":"轻便保温","副标题":"通勤随手带",'
                            '"卖点":["长效保温","杯口好清洁"],"视觉建议":"白底主图，杯身居中"}'
                        )
                    }
                }
            ]
        },
    ]

    class DummyResponse:
        headers = {"content-type": "application/json"}

        def __init__(self, payload: dict) -> None:
            self._payload = payload
            self.text = json.dumps(payload, ensure_ascii=False)

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self._payload

    class DummyHTTPXClient:
        def __init__(self, **kwargs) -> None:
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, *, json: dict):
            return DummyResponse(responses.pop(0))

    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.text.openai_chat_completions_provider.httpx.Client",
        DummyHTTPXClient,
    )

    provider = OpenAIChatCompletionsTextProvider(
        ResolvedTextProviderConfig(
            provider_kind="openai_chat_completions",
            brief_model="brief-model",
            copy_model="copy-model",
            api_key="demo-api-key",
            base_url="https://gateway.example/v1",
        )
    )

    inspiration = InspirationInput(name="通勤杯", category="杯具", price="99", source_note="轻量杯身", image_path="")
    brief, _ = provider.generate_brief(inspiration)
    copy_payload, _ = provider.generate_copy(inspiration, brief, CopyNodeConfigV2(purpose="main_image"))

    assert copy_payload.purpose == "main_image"
    assert copy_payload.summary == "轻便保温"
    assert copy_payload.content.kind == "blocks"
    assert [block.text for block in copy_payload.content.blocks] == [
        "轻便保温",
        "通勤随手带",
        "长效保温",
        "杯口好清洁",
    ]
    assert copy_payload.visual_guidance is not None
    assert copy_payload.visual_guidance.composition_hint == "白底主图，杯身居中"


def test_normalize_chat_completions_url() -> None:
    assert normalize_chat_completions_url(None) == "https://api.openai.com/v1/chat/completions"
    assert normalize_chat_completions_url("https://gateway.example") == "https://gateway.example/v1/chat/completions"
    assert normalize_chat_completions_url("https://gateway.example/v1") == "https://gateway.example/v1/chat/completions"
    assert (
        normalize_chat_completions_url("https://gateway.example/v1/chat/completions")
        == "https://gateway.example/v1/chat/completions"
    )


def test_ai_payload_normalizes_scalar_text_lists_without_swallowing_malformed_values() -> None:
    brief = CreativeBriefPayload.model_validate(
        {
            "positioning": ["摄影入门工具", "桌面拍摄辅助"],
            "audience": ["摄影入门用户", "小红书图文内容创作者"],
            "selling_angles": ["上手快", "构图稳", "出片自然"],
            "taboo_phrases": [],
            "poster_style_hint": ["干净明亮", "真实生活感"],
        }
    )
    assert brief.positioning == "摄影入门工具、桌面拍摄辅助"
    assert brief.audience == "摄影入门用户、小红书图文内容创作者"
    assert brief.poster_style_hint == "干净明亮、真实生活感"

    for bad_value in ([], ["摄影入门用户", ""], [{"label": "摄影入门用户"}]):
        with pytest.raises(ValidationError):
            CreativeBriefPayload.model_validate(
                {
                    "positioning": "摄影入门工具",
                    "audience": bad_value,
                    "selling_angles": ["上手快", "构图稳", "出片自然"],
                    "taboo_phrases": [],
                    "poster_style_hint": "干净明亮",
                }
            )


def test_copy_payload_v2_supports_flexible_content() -> None:
    freeform = CopyPayloadV2(summary="白底图只保留主体", content=FreeformCopyContent(text="主体居中，保留真实材质。"))
    blocks = CopyPayloadV2(
        summary="卖点速览",
        content=BlocksCopyContent(
            blocks=[
                CopyBlock(id="a", label="免打孔", text="不伤墙面，安装更轻松", visual_hint="墙面标注"),
                CopyBlock(id="b", label="承重", text="厨房瓶罐稳定收纳", visual_hint="承重图标"),
            ]
        ),
    )
    layout = CopyPayloadV2(
        summary="信息图层级",
        content=LayoutBriefCopyContent(
            sections=[
                CopySection(
                    id="hero",
                    title="主标题区",
                    body="免打孔收纳",
                    items=[CopyBlock(id="point", text="下方放 2 个功能标签")],
                    visual_hint="上方留白放标题",
                )
            ]
        ),
    )

    assert freeform.content.text == "主体居中，保留真实材质。"
    assert blocks.content.blocks[1].text == "厨房瓶罐稳定收纳"
    assert layout.content.sections[0].title == "主标题区"


def test_copy_payload_v2_normalizes_provider_block_variants() -> None:
    payload = normalize_copy_payload(
        {
            "version": 2,
            "summary": "坐标验收灵感产物4",
            "content": {
                "kind": "blocks",
                "blocks": [
                    {"type": "title", "text": "坐标验收灵感产物4"},
                    {"type": "benefit", "text": "覆盖上下架流程验收"},
                    {"type": "benefit", "text": "节点、区域功能测试"},
                    {"type": "benefit", "text": "方便快速识别管理"},
                    {
                        "type": "benefits",
                        "items": ["自动保存", "运行前同步", "展示和数据校验"],
                    },
                ],
            },
        }
    )

    assert payload.content.kind == "blocks"
    assert [block.id for block in payload.content.blocks] == [
        "title-1",
        "benefit-2",
        "benefit-3",
        "benefit-4",
        "benefits-5",
    ]
    assert payload.content.blocks[0].role == "title"
    assert payload.content.blocks[1].text == "覆盖上下架流程验收"
    assert payload.content.blocks[4].text == "自动保存；运行前同步；展示和数据校验"
    assert [block.text for block in payload.content.blocks[1:3]] == ["覆盖上下架流程验收", "节点、区域功能测试"]


def test_copy_payload_v2_normalizes_real_provider_freeform_variants() -> None:
    items_payload = normalize_copy_payload(
        {
            "version": 2,
            "summary": "小红书封面角度",
            "content": {
                "kind": "freeform",
                "items": ["租房也能少打孔", "厨房浴室都能放", "双层和挂钩款按空间选"],
            },
        }
    )
    list_text_payload = normalize_copy_payload(
        {
            "version": 2,
            "summary": "人群与场景",
            "content": {
                "kind": "freeform",
                "text": ["租房厨房台面更清爽", "浴室洗护瓶分层收纳"],
            },
        }
    )
    dict_text_payload = normalize_copy_payload(
        {
            "version": 2,
            "summary": "场景说明",
            "content": {
                "kind": "freeform",
                "text": {"适合场景": ["厨房调味瓶", "浴室洗护瓶"], "注意": "不承诺适用所有墙面"},
            },
        }
    )
    chinese_key_payload = normalize_copy_payload(
        {
            "version": 2,
            "summary": "细节说明",
            "content": {
                "kind": "freeform",
                "短标签": "304 不锈钢",
                "说明": "底部沥水孔减少积水，建议重物螺丝加固。",
            },
        }
    )

    assert items_payload.content.text == "租房也能少打孔\n厨房浴室都能放\n双层和挂钩款按空间选"
    assert list_text_payload.content.text == "租房厨房台面更清爽\n浴室洗护瓶分层收纳"
    assert "适合场景：厨房调味瓶\n浴室洗护瓶" in dict_text_payload.content.text
    assert "短标签：304 不锈钢" in chinese_key_payload.content.text
    assert "说明：底部沥水孔减少积水" in chinese_key_payload.content.text


def test_copy_payload_v2_normalizes_real_provider_layout_variants() -> None:
    payload = normalize_copy_payload(
        {
            "version": 2,
            "summary": "多角度规划",
            "content": {
                "kind": "layout_brief",
                "items": [
                    {
                        "order": 1,
                        "angle": "正面主视觉",
                        "copy": "展示置物架主体和前挡边，标题强调免打孔厨卫收纳。",
                        "shot": "主体居中，保留墙面和台面参照。",
                    },
                    {
                        "label": "底部沥水",
                        "description": "特写底部沥水孔，说明洗护瓶和清洁工具放置更清爽。",
                        "visual_suggestion": "使用局部放大标注。",
                    },
                ],
            },
        }
    )

    assert payload.content.kind == "layout_brief"
    assert len(payload.content.sections) == 2
    assert payload.content.sections[0].id == "正面主视觉-1"
    assert payload.content.sections[0].title == "正面主视觉"
    assert payload.content.sections[0].body == "展示置物架主体和前挡边，标题强调免打孔厨卫收纳。"
    assert payload.content.sections[0].visual_hint == "主体居中，保留墙面和台面参照。"
    assert payload.content.sections[1].title == "底部沥水"
    assert payload.content.sections[1].body == "特写底部沥水孔，说明洗护瓶和清洁工具放置更清爽。"


def test_copy_payload_v2_normalizes_visual_guidance_text() -> None:
    payload = normalize_copy_payload(
        {
            "version": 2,
            "summary": "冷灰色手机壳",
            "content": {
                "kind": "blocks",
                "blocks": [{"id": "headline", "text": "适合通勤和日常搭配"}],
            },
            "visual_guidance": "适合搭配冷灰、黑白背景，突出简洁文艺的视觉感。",
        }
    )

    assert payload.visual_guidance is not None
    assert payload.visual_guidance.composition_hint == "适合搭配冷灰、黑白背景，突出简洁文艺的视觉感。"


def test_copy_payload_v2_normalizes_layout_object_fields_to_sections() -> None:
    payload = normalize_copy_payload(
        {
            "version": 2,
            "summary": "视觉层级",
            "content": {
                "kind": "layout_brief",
                "hero_area": {"title": "主标题区", "copy": "厨卫收纳，限时到手69元起"},
                "feature_points": [
                    {"label": "304不锈钢", "text": "厨卫潮湿环境也好打理"},
                    {"label": "免打孔安装", "text": "也可按需螺丝加固"},
                ],
                "disclaimer": ["优惠以页面为准", "承重与墙面条件有关"],
            },
        }
    )

    assert payload.content.kind == "layout_brief"
    assert [section.title for section in payload.content.sections] == [
        "主标题区",
        "feature points",
        "disclaimer",
    ]
    assert payload.content.sections[0].body == "厨卫收纳，限时到手69元起"
    assert [item.label for item in payload.content.sections[1].items] == [
        "304不锈钢",
        "免打孔安装",
    ]
    assert [item.text for item in payload.content.sections[1].items] == [
        "厨卫潮湿环境也好打理",
        "也可按需螺丝加固",
    ]
    assert payload.content.sections[2].body == "优惠以页面为准\n承重与墙面条件有关"


def test_copy_payload_v2_drops_empty_provider_blocks() -> None:
    payload = normalize_copy_payload(
        {
            "version": 2,
            "summary": "对比维度",
            "content": {
                "kind": "blocks",
                "blocks": [
                    {"type": "compare_label", "text": "免打孔安装"},
                    {"type": "separator", "text": ""},
                    {"type": "compare_label", "text": "304 不锈钢"},
                ],
            },
        }
    )

    assert payload.content.kind == "blocks"
    assert [block.text for block in payload.content.blocks] == ["免打孔安装", "304 不锈钢"]


def test_copy_payload_v2_drops_empty_layout_items() -> None:
    payload = normalize_copy_payload(
        {
            "version": 2,
            "summary": "画面节奏",
            "content": {
                "kind": "layout_brief",
                "sections": [
                    {
                        "title": "3秒内",
                        "items": [
                            {"label": "空镜头", "text": ""},
                            {"label": "钩子", "text": "台面乱？上墙收一收"},
                        ],
                    }
                ],
            },
        }
    )

    assert payload.content.kind == "layout_brief"
    assert [item.text for item in payload.content.sections[0].items] == ["台面乱？上墙收一收"]


def test_inspiration_workflow_copy_run_normalizes_provider_scalar_lists(configured_env: Path, monkeypatch) -> None:
    class ListAudienceTextProvider:
        provider_name = "list-audience"
        prompt_version = "test-v1"

        def generate_brief(self, inspiration: InspirationInput) -> tuple[CreativeBriefPayload, str]:
            return (
                CreativeBriefPayload.model_validate(
                    {
                        "positioning": f"{inspiration.name} 的内容创作场景",
                        "audience": ["摄影入门用户", "小红书图文内容创作者"],
                        "selling_angles": ["上手快", "画面稳", "适合图文内容"],
                        "taboo_phrases": [],
                        "poster_style_hint": "清爽真实",
                    }
                ),
                "list-audience-brief",
            )

        def generate_copy(
            self,
            inspiration: InspirationInput,
            brief: CreativeBriefPayload,
            config: CopyNodeConfigV2,
            reference_images: list[ReferenceImageInput] | None = None,
        ) -> tuple[CopyPayloadV2, str]:
            del config, reference_images
            return (
                CopyPayloadV2(
                    summary=f"{inspiration.name} 新手拍摄更稳",
                    content=BlocksCopyContent(
                        blocks=[
                            CopyBlock(id="audience", text=f"适合{brief.audience}"),
                            CopyBlock(id="stability", text="手机拍摄角度更稳定"),
                            CopyBlock(id="daily", text="日常图文内容更好出片"),
                        ]
                    ),
                ),
                "list-audience-copy",
            )

    _execute_workflow_queue_inline(
        monkeypatch,
        dependencies=WorkflowExecutionDependencies(
            text_provider_resolver=lambda: ListAudienceTextProvider(),
        ),
    )

    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/inspirations",
        data={"name": "手机摄影支架", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("tripod.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    inspiration_id = created.json()["id"]

    run_response = client.post(f"/api/inspirations/{inspiration_id}/workflow/run", json={})
    assert run_response.status_code == 200
    assert run_response.json()["runs"][0]["status"] == "running"
    workflow_payload = _wait_for_workflow_run(client, inspiration_id, status="succeeded")
    copy_node = next(node for node in workflow_payload["nodes"] if node["node_type"] == "copy_generation")
    assert copy_node["output_json"]["structured_payload"]["version"] == 2
    assert not set(REMOVED_COPY_OUTPUT_KEYS) & set(copy_node["output_json"])
    structured_text = str(copy_node["output_json"]["structured_payload"])
    assert "摄影入门用户、小红书图文内容创作者" in structured_text

    inspiration_response = client.get(f"/api/inspirations/{inspiration_id}")
    assert inspiration_response.status_code == 200
    latest_brief = inspiration_response.json()["latest_brief"]
    assert latest_brief["payload"]["audience"] == "摄影入门用户、小红书图文内容创作者"


def test_inspiration_workflow_copy_run_retries_provider_payload_contract_mismatch(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class RetryingTextProvider:
        provider_name = "retrying-text"
        prompt_version = "test-v1"
        brief_attempts = 0
        copy_attempts = 0

        def generate_brief(self, inspiration: InspirationInput) -> tuple[CreativeBriefPayload, str]:
            type(self).brief_attempts += 1
            if type(self).brief_attempts == 1:
                return CreativeBriefPayload.model_validate(
                    {
                        "positioning": f"{inspiration.name} 定位",
                        "audience": [],
                        "selling_angles": ["轻", "稳", "好收纳"],
                        "taboo_phrases": [],
                        "poster_style_hint": "清爽",
                    }
                ), "bad-brief"
            return (
                CreativeBriefPayload(
                    positioning=f"{inspiration.name} 便携定位",
                    audience="小户型用户",
                    selling_angles=["轻", "稳", "好收纳"],
                    taboo_phrases=[],
                    poster_style_hint="清爽真实",
                ),
                "good-brief",
            )

        def generate_copy(
            self,
            inspiration: InspirationInput,
            brief: CreativeBriefPayload,
            config: CopyNodeConfigV2,
            reference_images: list[ReferenceImageInput] | None = None,
        ) -> tuple[CopyPayloadV2, str]:
            del inspiration, brief, config, reference_images
            type(self).copy_attempts += 1
            if type(self).copy_attempts == 1:
                return CopyPayloadV2.model_validate(
                    {
                        "version": 2,
                        "summary": " ",
                        "content": {"kind": "freeform", "text": "第一次字段不匹配"},
                    }
                ), "bad-copy"
            return (
                CopyPayloadV2(
                    summary="轻巧稳固，随手收纳",
                    content=FreeformCopyContent(text="轻巧稳固，适合小户型日常收纳。"),
                ),
                "good-copy",
            )

    _execute_workflow_queue_inline(
        monkeypatch,
        dependencies=WorkflowExecutionDependencies(
            text_provider_resolver=lambda: RetryingTextProvider(),
        ),
    )

    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/inspirations",
        data={"name": "折叠置物架", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("shelf.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    inspiration_id = created.json()["id"]

    run_response = client.post(f"/api/inspirations/{inspiration_id}/workflow/run", json={})
    assert run_response.status_code == 200
    workflow_payload = _wait_for_workflow_run(client, inspiration_id, status="succeeded")
    copy_node = next(node for node in workflow_payload["nodes"] if node["node_type"] == "copy_generation")

    assert RetryingTextProvider.brief_attempts == 2
    assert RetryingTextProvider.copy_attempts == 2
    assert copy_node["output_json"]["summary"] == "文案：轻巧稳固，随手收纳"
    assert copy_node["output_json"]["structured_payload"]["summary"] == "轻巧稳固，随手收纳"


def test_mock_image_provider_does_not_read_runtime_settings_during_generation(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.infrastructure.image.mock_provider import MockImageProvider

    source_path = configured_env / "mock-thread-safe-source.png"
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(_make_demo_image_bytes())
    provider = MockImageProvider()

    def fail_runtime_settings_lookup():
        raise AssertionError("runtime settings should be resolved before provider worker execution")

    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.image.mock_provider.get_runtime_settings",
        fail_runtime_settings_lookup,
    )

    generated, model = provider.generate_poster_image(
        PosterGenerationInput(
            inspiration_name="线程安全测试灵感产物",
            category="测试类目",
            price="99",
            source_note="测试说明",
            instruction="生成测试图",
            structured_copy_context="摘要：测试主标题\n卖点：卖点一\n卖点：卖点二\n卖点：卖点三",
            source_image=source_path,
            image_size="512x512",
        ),
        PosterKind.MAIN_IMAGE,
    )

    assert model == "mock-image-v1"
    assert generated.width == 512
    assert generated.height == 512
    assert generated.bytes_data


def test_image_generation_without_copy_link_uses_image_edit_prompt_mode(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.infrastructure.image.base import GeneratedImagePayload
    from inspiration_one_backend.presentation.api import create_app

    session = get_session_factory()()
    try:
        session.add(AppSetting(key="poster_generation_mode", value="generated"))
        session.commit()
    finally:
        session.close()

    captured_inputs: list[PosterGenerationInput] = []

    class CapturingImageProvider:
        provider_name = "capturing"
        prompt_version = "capturing-v1"

        def generate_poster_image(
            self,
            poster: PosterGenerationInput,
            kind: PosterKind,
        ) -> tuple[GeneratedImagePayload, str]:
            captured_inputs.append(poster)
            return (
                GeneratedImagePayload(
                    kind=kind,
                    bytes_data=_make_demo_image_bytes(),
                    mime_type="image/png",
                    width=800,
                    height=800,
                    variant_label=f"capturing-{poster.copy_prompt_mode}",
                    provider_response_id="resp_workflow_1",
                    provider_response_status="completed",
                    provider_output_json={
                        "_inspiration_one": {
                            "actual_size": "800x800",
                            "notes": ["accepted quality", "normalized size"],
                        },
                        "raw": {"hidden": True},
                    },
                ),
                "capturing-v1",
            )

    _execute_workflow_queue_inline(
        monkeypatch,
        dependencies=WorkflowExecutionDependencies(
            image_provider_resolver=CapturingImageProvider,
        ),
    )

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/inspirations",
        data={"name": "露营杯", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("cup.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    inspiration_id = created.json()["id"]

    workflow_response = client.get(f"/api/inspirations/{inspiration_id}/workflow")
    assert workflow_response.status_code == 200
    workflow = workflow_response.json()
    copy_node = next(node for node in workflow["nodes"] if node["node_type"] == "copy_generation")
    image_node = next(node for node in workflow["nodes"] if node["node_type"] == "image_generation")

    deleted_copy = client.delete(f"/api/workflow-nodes/{copy_node['id']}")
    assert deleted_copy.status_code == 200
    patched_image = client.patch(
        f"/api/workflow-nodes/{image_node['id']}",
        json={"config_json": {"instruction": "基于灵感产物图改成暖色露营场景", "size": "1024x1024"}},
    )
    assert patched_image.status_code == 200

    selected_run = client.post(
        f"/api/inspirations/{inspiration_id}/workflow/run",
        json={"start_node_id": image_node["id"]},
    )
    assert selected_run.status_code == 200
    payload = _wait_for_workflow_run(client, inspiration_id, status="succeeded")
    image_output = next(node for node in payload["nodes"] if node["id"] == image_node["id"])["output_json"]

    assert image_output["context_summary"]["copy_prompt_mode"] == "image_edit"
    assert image_output["copy_set_id"]
    assert len(image_output["provider_results"]) == 1
    provider_result = image_output["provider_results"][0]
    assert provider_result["generation_config_id"]
    assert provider_result == {
        "target_index": 1,
        "provider_name": "capturing",
        "model_name": "capturing-v1",
        "generation_config_id": provider_result["generation_config_id"],
        "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        "provider_response_id": "resp_workflow_1",
        "provider_response_status": "completed",
        "actual_size": "800x800",
        "notes": ["accepted quality", "normalized size"],
    }
    assert len(captured_inputs) == 1
    assert captured_inputs[0].copy_prompt_mode == "image_edit"
    assert captured_inputs[0].instruction and "暖色露营场景" in captured_inputs[0].instruction


def test_image_session_openai_responses_uses_explicit_branch_context(
    configured_env: Path,
    monkeypatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_responses")
    monkeypatch.setenv("IMAGE_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-5.4")
    get_settings.cache_clear()

    calls: list[dict] = []
    client_kwargs: list[dict] = []
    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]

    class DummyImageGenerationCall:
        type = "image_generation_call"

        def __init__(self, index: int) -> None:
            self.id = f"ig_{index}"
            self.result = encoded_result
            self.revised_prompt = f"revised prompt {index}"

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict[str, str]:
            return {
                "id": self.id,
                "type": self.type,
                "status": "completed",
                "revised_prompt": self.revised_prompt,
                "result": self.result,
            }

    class DummyResponse:
        def __init__(self, index: int) -> None:
            self.id = f"resp_{index}"
            self.output = [DummyImageGenerationCall(index)]

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict:
            return {
                "id": self.id,
                "output": [output.model_dump(mode=mode, exclude_none=exclude_none) for output in self.output],
            }

    class DummyResponses:
        def create(self, **kwargs):
            calls.append(kwargs)
            return DummyResponse(len(calls))

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            client_kwargs.append(kwargs)
            self.responses = DummyResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.OpenAI", DummyOpenAI)

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post("/api/image-sessions", json={"title": "Responses 连续生图"})
    assert created.status_code == 201
    session_id = created.json()["id"]

    upload = client.post(
        f"/api/image-sessions/{session_id}/reference-images",
        files={"reference_images": ("sample.png", _make_demo_image_bytes(), "image/png")},
    )
    assert upload.status_code == 200
    reference_id = next(asset["id"] for asset in upload.json()["assets"] if asset["kind"] == "reference_upload")

    first = client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "生成日漫风灵感产物场景",
            "size": "1024x1024",
        },
    )
    assert first.status_code == 202
    first_round = first.json()["rounds"][-1]
    assert first_round["provider_name"] == "openai-responses"
    assert first_round["provider_response_id"] == "resp_1"
    assert first_round["previous_response_id"] is None
    assert first_round["image_generation_call_id"] == "ig_1"
    first_asset_id = first_round["generated_asset"]["id"]

    second_without_base = client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "保持主体，把背景改成晴天街角",
            "size": "1024x1024",
        },
    )
    assert second_without_base.status_code == 202
    text_only_round = second_without_base.json()["rounds"][-1]
    assert text_only_round["provider_response_id"] == "resp_2"
    assert text_only_round["base_asset_ids"] == []
    assert text_only_round["base_asset_id"] is None
    assert text_only_round["selected_reference_asset_ids"] == []

    branched = client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "只从第一张和手动选择的参考图继续",
            "size": "1024x1024",
            "base_asset_id": first_asset_id,
            "selected_reference_asset_ids": [reference_id],
        },
    )
    assert branched.status_code == 202
    branched_round = branched.json()["rounds"][-1]
    assert branched_round["provider_response_id"] == "resp_3"
    assert branched_round["previous_response_id"] is None
    assert branched_round["base_asset_ids"] == [first_asset_id, reference_id]
    assert branched_round["base_asset_id"] == first_asset_id
    assert branched_round["selected_reference_asset_ids"] == [reference_id]

    assert client_kwargs[0] == {
        "api_key": "demo-api-key",
        "base_url": "https://example.test/v1",
        "default_headers": OPENAI_COMPATIBLE_DEFAULT_HEADERS,
        "timeout": OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS,
    }
    assert calls[0]["model"] == "gpt-5.4"
    assert calls[0]["tools"] == [{"type": "image_generation", "size": "1024x1024"}]
    assert "previous_response_id" not in calls[0]
    assert "previous_response_id" not in calls[1]
    assert "previous_response_id" not in calls[2]
    assert isinstance(calls[0]["input"], str)
    assert isinstance(calls[1]["input"], str)
    branch_content = calls[2]["input"][0]["content"]
    assert branch_content[0]["type"] == "input_text"
    branch_images = [item for item in branch_content if item["type"] == "input_image"]
    assert len(branch_images) == 2
    assert all(item["image_url"].startswith("data:image/png;base64,") for item in branch_images)
    assert "/images/generations" not in str(calls)
    assert "/images/edits" not in str(calls)


def test_openai_responses_poster_provider_uses_image_generation_tool(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_responses")
    monkeypatch.setenv("IMAGE_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-5.4")
    monkeypatch.setenv("IMAGE_RESPONSES_BACKGROUND_ENABLED", "false")
    get_settings.cache_clear()

    calls: list[dict] = []
    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]

    class DummyImageGenerationCall:
        type = "image_generation_call"
        id = "ig_poster"
        result = encoded_result

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict[str, str]:
            return {"id": self.id, "type": self.type, "result": self.result}

    class DummyResponse:
        id = "resp_poster"
        output = [DummyImageGenerationCall()]

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict:
            return {"id": self.id, "output": [self.output[0].model_dump(mode=mode, exclude_none=exclude_none)]}

    class DummyResponses:
        def create(self, **kwargs):
            calls.append(kwargs)
            return DummyResponse()

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.responses = DummyResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.OpenAI", DummyOpenAI)

    source_path = configured_env / "provider-source.png"
    reference_path = configured_env / "provider-reference.png"
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(_make_demo_image_bytes())
    reference_path.write_bytes(_make_demo_image_bytes())

    provider = OpenAIResponsesImageProvider()
    generated_image, model_name = provider.generate_poster_image(
        poster=PosterGenerationInput(
            inspiration_name="测试灵感产物",
            category="测试类目",
            price="9.90",
            source_note="防水牛津布，适合通勤和短途出差。",
            instruction="背景更干净，强调收纳空间。",
            image_size="1536x1024",
            tool_options={"quality": "high", "output_format": "webp"},
            structured_copy_context="摘要：测试海报标题\n卖点：卖点1\n卖点：卖点2\n卖点：卖点3",
            source_image=source_path,
            reference_images=[
                ReferenceImageInput(
                    path=reference_path,
                    mime_type="image/png",
                    filename="reference.png",
                )
            ],
        ),
        kind=PosterKind.MAIN_IMAGE,
    )

    assert generated_image.mime_type == "image/png"
    assert (generated_image.width, generated_image.height) == (800, 800)
    assert model_name == "gpt-5.4"
    payload = calls[0]
    assert payload["model"] == "gpt-5.4"
    assert payload["tools"] == [
        {"type": "image_generation", "size": "1536x1024", "quality": "high", "output_format": "webp"}
    ]
    content = payload["input"][0]["content"]
    assert content[0]["type"] == "input_text"
    prompt_text = content[0]["text"]
    assert "用户要求：背景更干净，强调收纳空间。" in prompt_text
    assert "- 补充说明：防水牛津布，适合通勤和短途出差。" in prompt_text
    assert "- 参考图片数量：2" in prompt_text
    assert "- 灵感产物原图：第 1 张输入图片" in prompt_text
    assert "- 参考图：reference.png（角色：参考图）" in prompt_text
    assert "视觉参考规则：" in prompt_text
    assert "如有输入图片，以输入图片中的主体、结构、材质、风格或场景作为视觉基准" in prompt_text
    assert len([item for item in content if item["type"] == "input_image"]) == 2
    assert "/images/generations" not in str(payload)
    assert "/images/edits" not in str(payload)
    assert "background" not in payload


def test_openai_responses_image_tool_optional_fields_are_omitted_until_configured(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_responses")
    monkeypatch.setenv("IMAGE_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-5.4")
    monkeypatch.setenv("IMAGE_RESPONSES_BACKGROUND_ENABLED", "false")
    get_settings.cache_clear()

    calls: list[dict] = []
    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]

    class DummyImageGenerationCall:
        type = "image_generation_call"
        id = "ig_tool"
        result = encoded_result

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict[str, str]:
            return {"id": self.id, "type": self.type, "result": self.result}

    class DummyResponse:
        id = "resp_tool"
        output = [DummyImageGenerationCall()]

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict:
            return {"id": self.id, "output": [self.output[0].model_dump(mode=mode, exclude_none=exclude_none)]}

    class DummyResponses:
        def create(self, **kwargs):
            calls.append(kwargs)
            return DummyResponse()

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.responses = DummyResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.OpenAI", DummyOpenAI)

    from inspiration_one_backend.infrastructure.image.responses_provider import OpenAIResponsesImageClient

    OpenAIResponsesImageClient().generate_image(prompt="默认 payload", size="1024x1024")

    assert calls[-1]["model"] == "gpt-5.4"
    assert calls[-1]["tools"] == [{"type": "image_generation", "size": "1024x1024"}]
    assert "background" not in calls[-1]
    assert "tool_choice" not in calls[-1]

    session = get_session_factory()()
    try:
        session.add_all(
            [
                AppSetting(
                    key="image_tool_allowed_fields",
                    value=(
                        "model,quality,output_format,output_compression,background,moderation,action,"
                        "input_fidelity,partial_images,n"
                    ),
                ),
                AppSetting(key="image_tool_model", value="gpt-image-2"),
                AppSetting(key="image_tool_quality", value="high"),
                AppSetting(key="image_tool_output_format", value="jpeg"),
                AppSetting(key="image_tool_output_compression", value="80"),
                AppSetting(key="image_tool_background", value="transparent"),
                AppSetting(key="image_tool_moderation", value="low"),
                AppSetting(key="image_tool_action", value="generate"),
                AppSetting(key="image_tool_input_fidelity", value="high"),
                AppSetting(key="image_tool_partial_images", value="2"),
                AppSetting(key="image_tool_n", value="3"),
            ]
        )
        session.commit()
    finally:
        session.close()

    OpenAIResponsesImageClient().generate_image(prompt="带可选字段", size="1024x1536")

    assert calls[-1]["tools"] == [
        {
            "type": "image_generation",
            "size": "1024x1536",
            "model": "gpt-image-2",
            "quality": "high",
            "output_format": "jpeg",
            "output_compression": 80,
            "moderation": "low",
            "action": "generate",
            "partial_images": 2,
        }
    ]
    assert "background" not in calls[-1]["tools"][0]
    assert "input_fidelity" not in calls[-1]["tools"][0]
    assert "tool_choice" not in calls[-1]


def test_openai_responses_image_client_polls_background_response_and_reports_progress(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_responses")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-5.4")
    monkeypatch.setenv("IMAGE_RESPONSES_BACKGROUND_ENABLED", "true")
    get_settings.cache_clear()

    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]
    calls: list[dict] = []
    retrieved: list[str] = []
    progress_events: list[dict] = []

    class DummyImageGenerationCall:
        type = "image_generation_call"
        id = "ig_background"
        result = encoded_result

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict[str, str]:
            return {"id": self.id, "type": self.type, "result": self.result}

    class DummyResponse:
        def __init__(self, status: str, output: list | None = None) -> None:
            self.id = "resp_background"
            self.status = status
            self.output = output or []

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict:
            return {
                "id": self.id,
                "status": self.status,
                "output": [output.model_dump(mode=mode, exclude_none=exclude_none) for output in self.output],
            }

    class DummyResponses:
        def create(self, **kwargs):
            calls.append(kwargs)
            return DummyResponse("queued")

        def retrieve(self, response_id: str):
            retrieved.append(response_id)
            return DummyResponse("completed", [DummyImageGenerationCall()])

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.responses = DummyResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.OpenAI", DummyOpenAI)
    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.sleep", lambda seconds: None)

    from inspiration_one_backend.infrastructure.image.responses_provider import OpenAIResponsesImageClient

    result = OpenAIResponsesImageClient().generate_image(
        prompt="后台生成",
        size="1024x1024",
        progress_callback=progress_events.append,
    )

    assert calls[0]["background"] is True
    assert retrieved == ["resp_background"]
    assert result.provider_response_id == "resp_background"
    assert result.provider_output_json["status"] == "completed"
    assert result.image_generation_call_id == "ig_background"
    assert [event["provider_response_status"] for event in progress_events] == ["queued", "completed"]
    assert [event["provider_response_id"] for event in progress_events] == ["resp_background", "resp_background"]
    assert progress_events[-1]["provider_response"]["output"][0]["result"].startswith("<base64 omitted")


def test_openai_responses_image_client_falls_back_when_background_is_unsupported(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_responses")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-5.4")
    monkeypatch.setenv("IMAGE_RESPONSES_BACKGROUND_ENABLED", "true")
    get_settings.cache_clear()

    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]
    calls: list[dict] = []

    class DummyImageGenerationCall:
        type = "image_generation_call"
        id = "ig_sync_fallback"
        result = encoded_result

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict[str, str]:
            return {"id": self.id, "type": self.type, "result": self.result}

    class DummyResponse:
        id = "resp_sync_fallback"
        output = [DummyImageGenerationCall()]

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict:
            return {"id": self.id, "output": [self.output[0].model_dump(mode=mode, exclude_none=exclude_none)]}

    class DummyResponses:
        def create(self, **kwargs):
            calls.append(kwargs)
            if kwargs.get("background") is True:
                raise RuntimeError("unexpected keyword argument: background")
            return DummyResponse()

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.responses = DummyResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.OpenAI", DummyOpenAI)

    from inspiration_one_backend.infrastructure.image.responses_provider import OpenAIResponsesImageClient

    result = OpenAIResponsesImageClient().generate_image(prompt="兼容同步响应", size="1024x1024")

    assert len(calls) == 2
    assert calls[0]["background"] is True
    assert "background" not in calls[1]
    assert result.provider_response_id == "resp_sync_fallback"
    assert result.image_generation_call_id == "ig_sync_fallback"


def test_openai_responses_image_client_wraps_background_poll_errors(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_responses")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-5.4")
    monkeypatch.setenv("IMAGE_RESPONSES_BACKGROUND_ENABLED", "true")
    get_settings.cache_clear()

    class DummyResponse:
        id = "resp_poll_error"
        status = "queued"
        output = []

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict:
            return {"id": self.id, "status": self.status, "output": []}

    class DummyResponses:
        def create(self, **kwargs):
            return DummyResponse()

        def retrieve(self, response_id: str):
            raise RuntimeError("raw provider failure with secret material")

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.responses = DummyResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.OpenAI", DummyOpenAI)
    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.sleep", lambda seconds: None)

    from inspiration_one_backend.infrastructure.image import responses_provider
    from inspiration_one_backend.infrastructure.image.responses_provider import OpenAIResponsesImageClient

    log_messages: list[str] = []

    class DummyLogger:
        def log(self, level: int, message: str, *args) -> None:
            log_messages.append(message % args)

        def warning(self, message: str, *args) -> None:
            log_messages.append(message % args)

    monkeypatch.setattr(responses_provider, "logger", DummyLogger())

    with pytest.raises(RuntimeError) as exc_info:
        OpenAIResponsesImageClient().generate_image(
            prompt="轮询失败",
            size="1024x1024",
            progress_callback=_progress_collector_with_context(
                task_id="task-1",
                session_id="session-1",
                candidate_index=2,
                candidate_count=4,
            ),
        )

    assert str(exc_info.value) == "图片供应商请求失败，请检查供应商配置后重试"
    assert "secret material" not in str(exc_info.value)
    log_text = "\n".join(log_messages)
    assert "task_id=task-1" in log_text
    assert "session_id=session-1" in log_text
    assert "candidate_index=2" in log_text
    assert "candidate_count=4" in log_text
    assert "model=gpt-5.4" in log_text
    assert "background=True" in log_text
    assert "status=queued" in log_text
    assert "response_id=resp_poll_error" in log_text
    assert "exception_class=RuntimeError" in log_text
    assert "secret material" not in log_text
    assert "demo-api-key" not in log_text


def test_openai_responses_image_client_redacts_base_url_credentials_in_logs(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_responses")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_BASE_URL", "https://user:secret-pass@example.test/v1?token=secret-token")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-5.4")
    get_settings.cache_clear()

    class DummyResponses:
        def create(self, **kwargs):
            raise RuntimeError("provider failure")

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.responses = DummyResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.OpenAI", DummyOpenAI)

    from inspiration_one_backend.infrastructure.image import responses_provider
    from inspiration_one_backend.infrastructure.image.responses_provider import OpenAIResponsesImageClient

    log_messages: list[str] = []

    class DummyLogger:
        def log(self, level: int, message: str, *args) -> None:
            if level >= logging.WARNING:
                log_messages.append(message % args)

    monkeypatch.setattr(responses_provider, "logger", DummyLogger())

    with pytest.raises(RuntimeError):
        OpenAIResponsesImageClient().generate_image(prompt="日志脱敏", size="1024x1024")

    log_text = "\n".join(log_messages)
    assert "base_url=https://example.test/v1" in log_text
    assert "secret-pass" not in log_text
    assert "secret-token" not in log_text
    assert "demo-api-key" not in log_text


def test_openai_responses_image_client_retries_without_optional_fields_and_records_note(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_responses")
    monkeypatch.setenv("IMAGE_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-5.4")
    get_settings.cache_clear()

    calls: list[dict] = []
    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]

    class DummyImageGenerationCall:
        type = "image_generation_call"
        id = "ig_fallback"
        result = encoded_result
        size = "1024x1024"

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict[str, str]:
            return {"id": self.id, "type": self.type, "result": self.result, "size": self.size}

    class DummyResponse:
        id = "resp_fallback"
        output = [DummyImageGenerationCall()]

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict:
            return {"id": self.id, "output": [self.output[0].model_dump(mode=mode, exclude_none=exclude_none)]}

    class DummyResponses:
        def create(self, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                raise RuntimeError("raw provider 400 unsupported field image_tool_quality")
            return DummyResponse()

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.responses = DummyResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.OpenAI", DummyOpenAI)

    from inspiration_one_backend.infrastructure.image.responses_provider import OpenAIResponsesImageClient

    result = OpenAIResponsesImageClient().generate_image(
        prompt="带每轮字段",
        size="1024x1024",
        tool_options={"quality": "high", "output_format": "webp", "n": 2},
    )

    assert len(calls) == 2
    assert calls[0]["tools"] == [
        {"type": "image_generation", "size": "1024x1024", "quality": "high", "output_format": "webp"}
    ]
    assert calls[1]["tools"] == [{"type": "image_generation", "size": "1024x1024"}]
    assert result.provider_request_json["_inspiration_one"]["fallback_used"] is True
    assert result.provider_output_json["_inspiration_one"]["notes"] == [
        {"kind": "fallback", "message": "供应商不支持部分参数，已按基础参数完成。"}
    ]
    assert "unsupported field" not in str(result.provider_output_json)


def test_openai_responses_image_client_records_provider_adjusted_note(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_responses")
    monkeypatch.setenv("IMAGE_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-5.4")
    get_settings.cache_clear()

    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]

    class DummyImageGenerationCall:
        type = "image_generation_call"
        id = "ig_adjusted"
        result = encoded_result
        output_format = "png"
        quality = "auto"

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict[str, str]:
            return {
                "id": self.id,
                "type": self.type,
                "result": self.result,
                "output_format": self.output_format,
                "quality": self.quality,
            }

    class DummyResponse:
        id = "resp_adjusted"
        output = [DummyImageGenerationCall()]

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict:
            return {"id": self.id, "output": [self.output[0].model_dump(mode=mode, exclude_none=exclude_none)]}

    class DummyResponses:
        def create(self, **kwargs):
            return DummyResponse()

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.responses = DummyResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.OpenAI", DummyOpenAI)

    from inspiration_one_backend.infrastructure.image.responses_provider import OpenAIResponsesImageClient

    result = OpenAIResponsesImageClient().generate_image(
        prompt="provider 调整字段",
        size="1024x1024",
        tool_options={"quality": "high", "output_format": "webp"},
    )

    metadata = result.provider_output_json["_inspiration_one"]
    assert metadata["effective_image_tool"]["output_format"] == "png"
    assert metadata["notes"][0]["kind"] == "provider_adjusted"
    assert metadata["notes"][0]["fields"] == ["quality", "output_format"]


def test_openai_responses_image_client_sanitizes_client_initialization_errors(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_responses")
    monkeypatch.setenv("IMAGE_BASE_URL", "https://secret-provider.example/v1")
    monkeypatch.setenv("IMAGE_API_KEY", "sk-sensitive")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-5.4")
    get_settings.cache_clear()

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            raise RuntimeError(f"raw provider init failed: {kwargs}")

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.OpenAI", DummyOpenAI)

    from inspiration_one_backend.infrastructure.image.responses_provider import OpenAIResponsesImageClient

    with pytest.raises(RuntimeError) as error:
        OpenAIResponsesImageClient().generate_image(prompt="初始化失败", size="1024x1024")

    assert str(error.value) == "图片供应商请求失败，请检查供应商配置后重试"
    assert isinstance(error.value.__cause__, RuntimeError)
    assert "sk-sensitive" not in str(error.value)
    assert "secret-provider" not in str(error.value)


def test_openai_responses_image_client_infers_mime_type_from_returned_bytes(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_responses")
    monkeypatch.setenv("IMAGE_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-5.4")
    get_settings.cache_clear()

    buffer = BytesIO()
    Image.new("RGB", (16, 16), (255, 255, 255)).save(buffer, format="JPEG")
    encoded_result = b64encode(buffer.getvalue()).decode("utf-8")

    class DummyImageGenerationCall:
        type = "image_generation_call"
        id = "ig_jpeg"
        result = encoded_result
        output_format = "png"

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict[str, str]:
            return {
                "id": self.id,
                "type": self.type,
                "result": self.result,
                "output_format": self.output_format,
            }

    class DummyResponse:
        id = "resp_jpeg"
        output = [DummyImageGenerationCall()]

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict:
            return {"id": self.id, "output": [self.output[0].model_dump(mode=mode, exclude_none=exclude_none)]}

    class DummyResponses:
        def create(self, **kwargs):
            return DummyResponse()

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.responses = DummyResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.OpenAI", DummyOpenAI)

    from inspiration_one_backend.infrastructure.image.responses_provider import OpenAIResponsesImageClient

    result = OpenAIResponsesImageClient().generate_image(prompt="返回 JPEG", size="1024x1024")

    assert result.mime_type == "image/jpeg"


def test_openai_images_provider_factory_and_client_generate_payload(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_images")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-image-1")
    monkeypatch.setenv("IMAGE_IMAGES_QUALITY", "high")
    monkeypatch.setenv("IMAGE_IMAGES_STYLE", "vivid")
    get_settings.cache_clear()

    calls: list[dict] = []
    client_kwargs: list[dict] = []
    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]

    class DummyImages:
        def generate(self, **kwargs):
            calls.append(kwargs)
            return DummyImagesAPIResponse(encoded_result)

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            client_kwargs.append(kwargs)
            self.images = DummyImages()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.images_provider.OpenAI", DummyOpenAI)

    from inspiration_one_backend.infrastructure.image.factory import get_image_provider
    from inspiration_one_backend.infrastructure.image.images_provider import OpenAIImagesClient

    assert isinstance(get_image_provider(), OpenAIImagesImageProvider)

    result = OpenAIImagesClient().generate(prompt="生成灵感产物图", size="1024x1024")[0]

    assert client_kwargs == [
        {
            "api_key": "demo-api-key",
            "base_url": "https://example.test/v1",
            "default_headers": OPENAI_COMPATIBLE_DEFAULT_HEADERS,
            "timeout": OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS,
        }
    ]
    assert calls == [
        {
            "model": "gpt-image-1",
            "prompt": "生成灵感产物图",
            "size": "1024x1024",
            "n": 1,
            "response_format": "b64_json",
            "quality": "high",
            "style": "vivid",
        }
    ]
    assert result.mime_type == "image/png"
    assert result.model_name == "gpt-image-1"
    assert result.provider_request_json == {
        "model": "gpt-image-1",
        "prompt": "生成灵感产物图",
        "size": "1024x1024",
        "n": 1,
        "quality": "high",
        "style": "vivid",
    }
    assert result.provider_output_json == {}


def test_openai_chat_image_provider_factory_and_client_sends_non_stream_payload(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_BASE_URL", "https://www.packyapi.com")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_chat_image")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gemini-3-pro-image-preview-16-9-4K")
    get_settings.cache_clear()

    calls: list[dict] = []
    client_kwargs: list[dict] = []

    class DummyResponse:
        content = b""
        headers: dict[str, str] = {}

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "id": "chatcmpl-image-1",
                "model": "gemini-3-pro-image-preview-16-9-4K",
                "choices": [
                    {
                        "message": {
                            "images": [
                                {
                                    "type": "image_url",
                                    "image_url": {"url": _make_demo_image_data_url()},
                                }
                            ]
                        },
                        "finish_reason": "stop",
                    }
                ],
            }

    class DummyHTTPXClient:
        def __init__(self, **kwargs) -> None:
            client_kwargs.append(kwargs)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, *, json: dict):
            calls.append({"method": "post", "url": url, "json": json})
            return DummyResponse()

    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.image.openai_chat_provider.httpx.Client",
        DummyHTTPXClient,
    )

    from inspiration_one_backend.infrastructure.image.factory import get_image_provider
    from inspiration_one_backend.infrastructure.image.images_provider import ImagesReferenceImage

    assert isinstance(get_image_provider(), OpenAIChatImageProvider)

    result = OpenAIChatImageClient().generate_image(
        prompt="生成灵感产物图",
        size="1024x1024",
        reference_images=[ImagesReferenceImage(_make_demo_image_bytes(), "image/png", "base.png")],
    )

    assert client_kwargs == [
        {
            "timeout": float(DEFAULT_WORKFLOW_IMAGE_GENERATION_PROVIDER_TIMEOUT_SECONDS),
            "headers": {
                **OPENAI_COMPATIBLE_DEFAULT_HEADERS,
                "Authorization": "Bearer demo-api-key",
                "Content-Type": "application/json",
            },
        }
    ]
    assert calls[0]["url"] == "https://www.packyapi.com/v1/chat/completions"
    payload = calls[0]["json"]
    assert payload["model"] == "gemini-3-pro-image-preview-16-9-4K"
    assert payload["stream"] is False
    assert payload["messages"][0]["content"][0] == {"type": "text", "text": "生成灵感产物图"}
    assert payload["messages"][0]["content"][1]["type"] == "image_url"
    assert payload["messages"][0]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert result.mime_type == "image/png"
    assert result.model_name == "gemini-3-pro-image-preview-16-9-4K"
    assert result.provider_response_id == "chatcmpl-image-1"
    assert result.provider_request_json == {
        "endpoint": "chat/completions",
        "model": "gemini-3-pro-image-preview-16-9-4K",
        "size": "1024x1024",
        "stream": False,
        "message_content_format": "parts",
        "message_count": 1,
        "prompt_character_count": 7,
        "reference_image_count": 1,
        "reference_images": [
            {"filename": "base.png", "mime_type": "image/png", "byte_count": len(_make_demo_image_bytes())}
        ],
    }
    assert result.provider_output_json["_inspiration_one"] == {
        "endpoint": "chat/completions",
        "stream": False,
        "image_source": "data_url",
        "image_mime_type": "image/png",
        "image_byte_count": len(_make_demo_image_bytes()),
    }
    assert "base64" not in str(result.provider_request_json).lower()
    assert _make_demo_image_bytes().hex() not in str(result.provider_output_json)


def test_openai_chat_image_client_parses_url_and_raw_base64_outputs(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_BASE_URL", "https://chat.example/v1")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_chat_image")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "chat-image-model")
    get_settings.cache_clear()

    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]
    post_responses = [
        {
            "id": "chatcmpl-url",
            "choices": [{"message": {"content": "![image](https://cdn.example/generated.png)"}}],
        },
        {
            "id": "chatcmpl-b64",
            "choices": [{"message": {"content": encoded_result}}],
        },
    ]
    calls: list[dict] = []
    get_urls: list[str] = []

    class DummyJSONResponse:
        content = b""
        headers: dict[str, str] = {}

        def __init__(self, payload: dict) -> None:
            self.payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self.payload

    class DummyImageResponse:
        content = _make_demo_image_bytes()
        headers = {"content-type": "image/png; charset=utf-8"}

        def raise_for_status(self) -> None:
            return None

    class DummyHTTPXClient:
        def __init__(self, **kwargs) -> None:
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, *, json: dict):
            calls.append({"url": url, "json": json})
            return DummyJSONResponse(post_responses.pop(0))

        def get(self, url: str):
            get_urls.append(url)
            return DummyImageResponse()

    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.image.openai_chat_provider.httpx.Client",
        DummyHTTPXClient,
    )

    url_result = OpenAIChatImageClient().generate_image(prompt="URL 输出", size="1024x1024")
    b64_result = OpenAIChatImageClient().generate_image(prompt="base64 输出", size="1024x1024")

    assert calls[0]["json"]["messages"][0]["content"] == "URL 输出"
    assert calls[1]["json"]["messages"][0]["content"] == "base64 输出"
    assert get_urls == ["https://cdn.example/generated.png"]
    assert url_result.provider_output_json["_inspiration_one"]["image_source"] == "url"
    assert url_result.provider_request_json["message_content_format"] == "string"
    assert url_result.mime_type == "image/png"
    assert b64_result.provider_output_json["_inspiration_one"]["image_source"] == "base64"
    assert b64_result.provider_request_json["message_content_format"] == "string"
    assert b64_result.mime_type == "image/png"
    assert b64_result.bytes_data == _make_demo_image_bytes()


def test_openai_chat_image_client_parses_non_json_image_outputs(
    configured_env: Path,
    monkeypatch,
) -> None:
    session = get_session_factory()()
    try:
        session.merge(AppSetting(key="workflow_image_generation_provider_timeout_seconds", value="321"))
        session.commit()
    finally:
        session.close()

    monkeypatch.setenv("IMAGE_BASE_URL", "https://chat.example/v1")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_chat_image")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "chat-image-model")
    get_settings.cache_clear()

    image_bytes = _make_demo_image_bytes()
    post_responses = ["raw_image", "text_url"]
    get_urls: list[str] = []

    class DummyRawImageResponse:
        content = image_bytes
        headers = {"content-type": "image/png"}

        def raise_for_status(self) -> None:
            return None

        def json(self):
            raise ValueError("not json")

    class DummyTextUrlResponse:
        content = b"https://cdn.example/generated.png"
        headers = {"content-type": "text/plain; charset=utf-8"}

        def raise_for_status(self) -> None:
            return None

        def json(self):
            raise ValueError("not json")

    class DummyImageResponse:
        content = image_bytes
        headers = {"content-type": "image/png; charset=utf-8"}

        def raise_for_status(self) -> None:
            return None

    class DummyHTTPXClient:
        def __init__(self, **kwargs) -> None:
            assert kwargs["timeout"] == 321.0

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, *, json: dict):
            response_kind = post_responses.pop(0)
            if response_kind == "raw_image":
                return DummyRawImageResponse()
            return DummyTextUrlResponse()

        def get(self, url: str):
            get_urls.append(url)
            return DummyImageResponse()

    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.image.openai_chat_provider.httpx.Client",
        DummyHTTPXClient,
    )

    raw_result = OpenAIChatImageClient().generate_image(prompt="raw image", size="1024x1024")
    text_url_result = OpenAIChatImageClient().generate_image(prompt="text url", size="1024x1024")

    assert raw_result.bytes_data == image_bytes
    assert raw_result.provider_output_json["response_format"] == "raw_image"
    assert raw_result.provider_output_json["content_type"] == "image/png"
    assert raw_result.provider_output_json["_inspiration_one"]["image_source"] == "base64"
    assert text_url_result.bytes_data == image_bytes
    assert text_url_result.provider_output_json["response_format"] == "text_image_reference"
    assert text_url_result.provider_output_json["_inspiration_one"]["image_source"] == "url"
    assert get_urls == ["https://cdn.example/generated.png"]


def test_image_session_openai_chat_image_uses_explicit_references(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_BASE_URL", "https://chat.example")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_chat_image")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "chat-image-model")
    get_settings.cache_clear()

    calls: list[dict] = []

    class DummyResponse:
        content = b""
        headers: dict[str, str] = {}

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "id": "chatcmpl-session",
                "choices": [{"message": {"images": [{"image_url": {"url": _make_demo_image_data_url()}}]}}],
            }

    class DummyHTTPXClient:
        def __init__(self, **kwargs) -> None:
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, *, json: dict):
            calls.append({"url": url, "json": json})
            return DummyResponse()

    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.image.openai_chat_provider.httpx.Client",
        DummyHTTPXClient,
    )

    from inspiration_one_backend.infrastructure.image.chat_service import ImageChatService, ImageChatTurn

    result = ImageChatService().generate(
        prompt="只改背景",
        size="1024x1024",
        history=[ImageChatTurn(role="assistant", content="上一张", image_data_url=_make_demo_image_data_url())],
        manual_reference_images=[_make_demo_image_data_url(), _make_demo_image_data_url()],
    )

    content = calls[0]["json"]["messages"][0]["content"]
    assert calls[0]["url"] == "https://chat.example/v1/chat/completions"
    assert calls[0]["json"]["stream"] is False
    assert [part["type"] for part in content] == ["text", "image_url", "image_url", "image_url"]
    assert result.provider_name == "openai-chat-image"
    assert result.provider_response_id == "chatcmpl-session"
    assert result.provider_request_json["message_content_format"] == "parts"
    assert result.provider_request_json["reference_image_count"] == 3
    assert result.provider_request_json["reference_images"] == [
        {"filename": "base.png", "mime_type": "image/png", "byte_count": len(_make_demo_image_bytes())},
        {"filename": "reference-1.png", "mime_type": "image/png", "byte_count": len(_make_demo_image_bytes())},
        {"filename": "reference-2.png", "mime_type": "image/png", "byte_count": len(_make_demo_image_bytes())},
    ]


def test_google_gemini_provider_factory_and_client_generate_payload(
    configured_env: Path,
    monkeypatch,
) -> None:
    session = get_session_factory()()
    try:
        profile = ProviderProfile(
            name="Gemini",
            provider_type="google_gemini",
            base_url=None,
            api_key="google-api-key",
            capabilities_json=["image_google_gemini"],
            default_models_json={"image_model": "gemini-2.5-flash-image"},
            config_json={},
            enabled=True,
        )
        session.add(profile)
        session.flush()
        session.add(
            ProviderBinding(
                purpose="image",
                provider_kind="google_gemini_image",
                provider_profile_id=profile.id,
                model_settings_json={"model": "gemini-3.1-flash-image-preview"},
                config_json={"gemini_api_version": "v1beta", "gemini_output_mime_type": "image/png"},
            )
        )
        session.commit()
    finally:
        session.close()

    calls: list[dict] = []
    client_kwargs: list[dict] = []
    image_bytes = _make_demo_image_bytes()

    class DummyModels:
        def generate_content(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                response_id="gemini-response-1",
                model_version="gemini-test-version",
                parts=[
                    SimpleNamespace(text="ok"),
                    SimpleNamespace(inline_data=SimpleNamespace(data=image_bytes, mime_type="image/png")),
                ],
            )

    class DummyClient:
        def __init__(self, **kwargs) -> None:
            client_kwargs.append(kwargs)
            self.models = DummyModels()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.gemini_provider.genai.Client", DummyClient)

    from inspiration_one_backend.infrastructure.image.factory import get_image_provider

    assert isinstance(get_image_provider(), GoogleGeminiImageProvider)

    result = GoogleGeminiImageClient().generate_image(
        prompt="生成灵感产物图",
        size="2048x1152",
        reference_images=[GoogleGeminiReferenceImage(image_bytes, "image/png", "ref.png")],
    )

    assert client_kwargs[0]["api_key"] == "google-api-key"
    assert calls[0]["model"] == "gemini-3.1-flash-image-preview"
    assert len(calls[0]["contents"]) == 2
    assert result.mime_type == "image/png"
    assert result.model_name == "gemini-3.1-flash-image-preview"
    assert result.provider_response_id == "gemini-response-1"
    assert result.provider_request_json == {
        "model": "gemini-3.1-flash-image-preview",
        "prompt": "生成灵感产物图",
        "size": "2048x1152",
        "reference_image_count": 1,
        "reference_images": [{"filename": "ref.png", "mime_type": "image/png", "byte_count": len(image_bytes)}],
        "image_config": {"aspect_ratio": "16:9", "image_size": "2K", "output_mime_type": "image/png"},
    }
    assert result.provider_output_json == {
        "response_id": "gemini-response-1",
        "model_version": "gemini-test-version",
        "text_part_count": 1,
        "_inspiration_one": {
            "model": "gemini-3.1-flash-image-preview",
            "requested_size": "2048x1152",
            "effective_aspect_ratio": "16:9",
            "effective_image_size": "2K",
        },
    }
    assert "base64" not in str(result.provider_request_json).lower()
    assert image_bytes.hex() not in str(result.provider_output_json)


def test_google_gemini_size_mapping_and_sanitized_errors() -> None:
    config = map_inspiration_one_size_to_gemini_image_config("1024x1536", "gemini-2.5-flash-image")
    assert config.aspect_ratio == "2:3"
    assert config.image_size is None

    preview_config = map_inspiration_one_size_to_gemini_image_config("3840x2160", "gemini-3-pro-image-preview")
    assert preview_config.aspect_ratio == "16:9"
    assert preview_config.image_size == "4K"

    with pytest.raises(RuntimeError) as missing_key:
        GoogleGeminiImageClient(
            ResolvedImageProviderConfig(
                provider_kind="google_gemini_image",
                model="gemini-2.5-flash-image",
                api_key=None,
            )
        ).generate_image(prompt="生成图", size="1024x1024")
    assert str(missing_key.value) == "图片供应商档案缺少 API Key"


def test_openai_images_client_retries_generate_without_optional_fields(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_images")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-image-1")
    monkeypatch.setenv("IMAGE_IMAGES_QUALITY", "high")
    monkeypatch.setenv("IMAGE_IMAGES_STYLE", "natural")
    get_settings.cache_clear()

    calls: list[dict] = []
    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]

    class DummyImages:
        def generate(self, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                raise RuntimeError("unsupported optional field")
            return DummyImagesAPIResponse(encoded_result)

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.images = DummyImages()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.images_provider.OpenAI", DummyOpenAI)

    from inspiration_one_backend.infrastructure.image.images_provider import OpenAIImagesClient

    result = OpenAIImagesClient().generate(prompt="fallback", size="1024x1024")[0]

    assert len(calls) == 2
    assert "quality" in calls[0]
    assert "style" in calls[0]
    assert "quality" not in calls[1]
    assert "style" not in calls[1]
    assert result.provider_output_json["_inspiration_one"]["notes"] == [
        {"kind": "fallback", "message": "供应商不支持部分可选参数，已按基础参数完成。"}
    ]
    assert "unsupported optional field" not in str(result.provider_output_json)


def test_openai_images_client_edit_sends_multiple_images_and_falls_back_to_base_image(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_images")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-image-1")
    monkeypatch.setenv("IMAGE_IMAGES_QUALITY", "high")
    get_settings.cache_clear()

    calls: list[dict] = []
    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]

    class DummyImages:
        def edit(self, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                raise RuntimeError("multiple files are not supported")
            return DummyImagesAPIResponse(encoded_result)

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.images = DummyImages()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.images_provider.OpenAI", DummyOpenAI)

    from inspiration_one_backend.infrastructure.image.images_provider import ImagesReferenceImage, OpenAIImagesClient

    result = OpenAIImagesClient().edit(
        image=[
            ImagesReferenceImage(_make_demo_image_bytes(), "image/png", "base.png"),
            ImagesReferenceImage(_make_demo_image_bytes(), "image/png", "ref.png"),
        ],
        prompt="改图",
        size="1024x1024",
    )[0]

    assert len(calls) == 2
    assert isinstance(calls[0]["image"], list)
    assert [image.name for image in calls[0]["image"]] == ["base.png", "ref.png"]
    assert calls[0]["quality"] == "high"
    assert calls[1]["image"].name == "base.png"
    assert "quality" not in calls[1]
    assert result.provider_request_json == {
        "model": "gpt-image-1",
        "prompt": "改图",
        "size": "1024x1024",
        "n": 1,
        "image_count": 1,
        "images": [{"filename": "base.png", "mime_type": "image/png"}],
        "has_mask": False,
    }
    assert result.provider_output_json["_inspiration_one"] == {
        "notes": [
            {"kind": "fallback", "message": "供应商不支持部分可选参数，已按基础参数完成。"},
            {"kind": "multi_image_fallback", "message": "供应商不支持多张编辑输入，已仅使用基图完成。"},
        ],
        "requested_image_count": 2,
        "effective_image_count": 1,
    }
    assert "multiple files" not in str(result.provider_output_json)


def test_openai_images_client_reports_missing_output_and_sanitizes_failures(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_images")
    monkeypatch.setenv("IMAGE_BASE_URL", "https://secret-provider.example/v1")
    monkeypatch.setenv("IMAGE_API_KEY", "sk-sensitive")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-image-1")
    get_settings.cache_clear()

    class MissingOutputImages:
        def generate(self, **kwargs):
            return DummyImagesAPIResponse(None)

    class FailingImages:
        def generate(self, **kwargs):
            raise RuntimeError(f"raw failure with {kwargs}")

    class MissingOutputOpenAI:
        def __init__(self, **kwargs) -> None:
            self.images = MissingOutputImages()

    class FailingOpenAI:
        def __init__(self, **kwargs) -> None:
            self.images = FailingImages()

    from inspiration_one_backend.infrastructure.image import images_provider
    from inspiration_one_backend.infrastructure.image.images_provider import OpenAIImagesClient

    monkeypatch.setattr(images_provider, "OpenAI", MissingOutputOpenAI)
    with pytest.raises(RuntimeError) as missing_error:
        OpenAIImagesClient().generate(prompt="没有图", size="1024x1024")
    assert str(missing_error.value) == "图片供应商没有返回图片结果，请稍后重试"

    monkeypatch.setattr(images_provider, "OpenAI", FailingOpenAI)
    with pytest.raises(RuntimeError) as failure_error:
        OpenAIImagesClient().generate(prompt="失败", size="1024x1024")
    assert str(failure_error.value) == "图片供应商请求失败，请检查供应商配置后重试"
    assert "sk-sensitive" not in str(failure_error.value)
    assert "secret-provider" not in str(failure_error.value)


def test_openai_images_poster_provider_uses_existing_prompt_contract_and_references(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_images")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-image-1")
    get_settings.cache_clear()

    calls: list[dict] = []
    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]

    class DummyImages:
        def edit(self, **kwargs):
            calls.append(kwargs)
            return DummyImagesAPIResponse(encoded_result)

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.images = DummyImages()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.images_provider.OpenAI", DummyOpenAI)

    session = get_session_factory()()
    try:
        session.add_all(
            [
                AppSetting(
                    key="prompt_poster_image_edit_template",
                    value=(
                        "EDIT {inspiration_name}/{category}/{price}/{source_note}/{instruction}/"
                        "{kind_label}/{size}/{context_block}/{reference_policy}/{kind_requirements}"
                    ),
                ),
                AppSetting(key="prompt_poster_image_reference_policy", value="保留灵感产物主体"),
            ]
        )
        session.commit()
    finally:
        session.close()

    source_path = configured_env / "images-source.png"
    reference_path = configured_env / "images-reference.png"
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(_make_demo_image_bytes())
    reference_path.write_bytes(_make_demo_image_bytes())

    generated_image, model_name = OpenAIImagesImageProvider().generate_poster_image(
        poster=PosterGenerationInput(
            copy_prompt_mode="image_edit",
            inspiration_name="测试灵感产物",
            category="测试类目",
            price="9.90",
            source_note="防水牛津布",
            instruction="背景更干净",
            image_size="1024x1024",
            source_image=source_path,
            reference_images=[
                ReferenceImageInput(
                    path=reference_path,
                    mime_type="image/png",
                    filename="reference.png",
                )
            ],
        ),
        kind=PosterKind.MAIN_IMAGE,
    )

    assert generated_image.mime_type == "image/png"
    assert model_name == "gpt-image-1"
    payload = calls[0]
    assert payload["model"] == "gpt-image-1"
    assert payload["size"] == "1024x1024"
    assert [image.name for image in payload["image"]] == ["images-source.png", "reference.png"]
    prompt = payload["prompt"]
    assert "EDIT 测试灵感产物/测试类目/9.90/防水牛津布/背景更干净/主图/1024x1024" in prompt
    assert "- 补充说明：防水牛津布" in prompt
    assert "- 参考图片数量：2" in prompt
    assert "- 灵感产物原图：第 1 张输入图片" in prompt
    assert "- 参考图：reference.png（角色：参考图）" in prompt
    assert "保留灵感产物主体" in prompt
    assert "不要把字段名" in prompt


def test_openai_images_poster_provider_batches_count_as_images_api_n(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_images")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-image-1")
    get_settings.cache_clear()

    calls: list[dict] = []
    encoded_result = _make_demo_image_data_url().split(",", maxsplit=1)[1]

    class DummyImages:
        def generate(self, **kwargs):
            calls.append(kwargs)
            return DummyImagesAPIResponse(b64_jsons=[encoded_result, encoded_result, encoded_result])

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.images = DummyImages()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.images_provider.OpenAI", DummyOpenAI)

    generated_images = OpenAIImagesImageProvider().generate_poster_images(
        poster=PosterGenerationInput(
            inspiration_name="批量灵感产物",
            instruction="生成候选",
            image_size="1024x1024",
            tool_options={"quality": "high", "n": 1},
        ),
        kind=PosterKind.MAIN_IMAGE,
        count=3,
    )

    assert len(calls) == 1
    assert calls[0]["n"] == 3
    assert calls[0]["quality"] == "high"
    assert len(generated_images) == 3
    assert [generated_image.variant_label for generated_image, _ in generated_images] == ["v1", "v2", "v3"]
    assert [model_name for _, model_name in generated_images] == ["gpt-image-1", "gpt-image-1", "gpt-image-1"]


def test_generated_poster_mode_uses_image_provider(
    db_session,
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("POSTER_GENERATION_MODE", "generated")
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "mock")
    get_settings.cache_clear()

    inspiration = create_inspiration(
        db_session,
        name="便携榨汁杯",
        category="小家电",
        price="89.00",
        source_note=None,
        image_bytes=_make_demo_image_bytes(),
        filename="juicer.png",
        content_type="image/png",
        reference_image_uploads=[
            (_make_demo_image_bytes(), "ref-1.png", "image/png"),
            (_make_demo_image_bytes(), "ref-2.png", "image/png"),
        ],
    )

    run_inspiration_workflow(db_session, inspiration_id=inspiration.id)
    db_session.expire_all()

    inspiration_after_poster = get_inspiration_detail(db_session, inspiration.id)
    assert inspiration_after_poster.poster_variants
    assert all(
        "workflow:mock:mock-generated-r1:mock-image-v1" in poster.template_name
        for poster in inspiration_after_poster.poster_variants
    )


def test_default_image_prompts_are_low_pollution_context_carriers(configured_env: Path) -> None:
    from inspiration_one_backend.infrastructure.image.chat_service import ImageChatService

    prompt = OpenAIResponsesImageProvider()._build_prompt(
        PosterGenerationInput(
            copy_prompt_mode="image_edit",
            inspiration_name="",
            instruction="画一张蓝色抽象渐变",
            image_size="1280x720",
        ),
        PosterKind.MAIN_IMAGE,
        "1280x720",
    )
    chat_prompt = ImageChatService()._build_prompt("画一张蓝色抽象渐变", [], "1280x720")

    forbidden = ["电商海报", "继承输入参考图", "灵感产物主体", "主标题", "卖点", "CTA", "价格标签"]
    assert all(term not in prompt for term in forbidden)
    assert all(term not in chat_prompt for term in ["继承已经确定", "主体", "构图与材质"])
    assert "不应注入" not in prompt
    assert "画一张蓝色抽象渐变" in prompt
    assert "无显式上游上下文" in prompt
    assert "1280x720" in chat_prompt


def test_openai_image_prompt_uses_structured_copy_context(configured_env: Path) -> None:
    prompt = OpenAIResponsesImageProvider()._build_prompt(
        PosterGenerationInput(
            inspiration_name="结构化灵感产物",
            instruction="突出结构化上下文",
            structured_copy_context="摘要：结构化主标题\n正文：结构化正文\n卖点：结构化卖点",
        ),
        PosterKind.MAIN_IMAGE,
        "1024x1024",
    )

    assert "结构化主标题" in prompt
    assert "结构化正文" in prompt
    assert "结构化卖点" in prompt
    assert "可用文案参考" in prompt
    assert "字段名、标签名或上下文说明" in prompt
    assert "不应作为主输入" not in prompt


def test_openai_responses_image_client_reports_completed_text_without_image(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("IMAGE_PROVIDER_KIND", "openai_responses")
    monkeypatch.setenv("IMAGE_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("IMAGE_API_KEY", "demo-api-key")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "gpt-5.4")
    get_settings.cache_clear()

    class DummyResponse:
        id = "resp_text_only"
        status = "completed"
        output = [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": "抱歉，无法生成这张图片。"}],
            }
        ]

        def model_dump(self, *, mode: str, exclude_none: bool) -> dict:
            return {"id": self.id, "status": self.status, "output": self.output}

    class DummyResponses:
        def create(self, **kwargs):
            return DummyResponse()

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.responses = DummyResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.image.responses_provider.OpenAI", DummyOpenAI)

    from inspiration_one_backend.infrastructure.image.responses_provider import OpenAIResponsesImageClient

    with pytest.raises(RuntimeError) as error:
        OpenAIResponsesImageClient().generate_image(prompt="只返回文字", size="1024x1024")

    assert str(error.value) == "图片供应商已完成请求，但返回的是文字回复，没有返回图片结果"
