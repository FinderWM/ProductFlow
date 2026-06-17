from __future__ import annotations

import json
from json import JSONDecodeError
from typing import Any

STRUCTURED_OUTPUT_WRAPPER_KEYS = {
    "creative_brief",
    "copy_payload",
    "copy_payload_v2",
    "tail_split_plan",
    "text_structured_output_test",
}


def read_json_object_from_response(response: object, *, error_label: str) -> dict[str, Any]:
    text = response_output_text(response)
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        payload = json.loads(text)
    except JSONDecodeError as exc:
        extracted = extract_json_object_text(text)
        if extracted:
            payload = json.loads(extracted)
        else:
            snippet = text[:200] if text else "<empty>"
            raise ValueError(f"{error_label} 未返回 JSON 对象：{snippet}") from exc
    if not isinstance(payload, dict):
        snippet = text[:200] if text else "<empty>"
        raise ValueError(f"{error_label} 未返回 JSON 对象：{snippet}")
    if "error" in payload:
        raise ValueError(f"{error_label} 返回错误：{provider_error_message(payload['error'])}")
    return unwrap_structured_output_payload(payload)


def provider_error_message(error: object) -> str:
    if isinstance(error, str):
        return error.strip() or "供应商返回错误"
    if not isinstance(error, dict):
        return "供应商返回错误"
    message = error.get("message")
    code = error.get("code")
    text = message.strip() if isinstance(message, str) else "供应商返回错误"
    if isinstance(code, str) and code.strip():
        return f"{text} ({code.strip()})"
    return text


def unwrap_structured_output_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if len(payload) != 1:
        return payload
    key, value = next(iter(payload.items()))
    if key in STRUCTURED_OUTPUT_WRAPPER_KEYS and isinstance(value, dict):
        return value
    return payload


def response_output_text(response: object) -> str:
    if isinstance(response, str):
        return (extract_sse_output_text(response) or response).strip()

    output_text = getattr(response, "output_text", "")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    model_dump = getattr(response, "model_dump", None)
    if callable(model_dump):
        try:
            payload = model_dump(mode="json")
        except TypeError:
            payload = model_dump()
        if isinstance(payload, dict):
            return extract_response_dict_text(payload).strip()

    return ""


def extract_json_object_text(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index, character in enumerate(text[start:], start=start):
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def extract_sse_output_text(text: str) -> str | None:
    current_event: str | None = None
    chunks: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("event:"):
            current_event = line.split(":", 1)[1].strip()
            continue
        if not line.startswith("data:"):
            continue
        data_text = line.split(":", 1)[1].strip()
        if not data_text or data_text == "[DONE]":
            continue
        try:
            payload = json.loads(data_text)
        except JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        delta = payload.get("delta")
        is_output_text_delta = (
            current_event == "response.output_text.delta" or payload.get("type") == "response.output_text.delta"
        )
        if is_output_text_delta and isinstance(delta, str):
            chunks.append(delta)
        choices = payload.get("choices")
        if isinstance(choices, list):
            for choice in choices:
                if not isinstance(choice, dict):
                    continue
                choice_delta = choice.get("delta")
                if isinstance(choice_delta, dict):
                    content = choice_delta.get("content")
                    if isinstance(content, str):
                        chunks.append(content)
                message = choice.get("message")
                if isinstance(message, dict):
                    content = message.get("content")
                    if isinstance(content, str):
                        chunks.append(content)

    if chunks:
        return "".join(chunks)
    return None


def extract_response_dict_text(payload: dict[str, Any]) -> str:
    output = payload.get("output")
    if not isinstance(output, list):
        return ""
    chunks: list[str] = []
    for item in output:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            text = block.get("text")
            if isinstance(text, str):
                chunks.append(text)
    return "".join(chunks)
