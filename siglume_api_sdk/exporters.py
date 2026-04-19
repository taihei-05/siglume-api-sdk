from __future__ import annotations

from dataclasses import asdict, dataclass, is_dataclass
from enum import Enum
from typing import Any, Mapping


@dataclass(frozen=True)
class ToolSchemaExport:
    schema: dict[str, Any]
    lossy_fields: list[str]
    warnings: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "lossy_fields": list(self.lossy_fields),
            "warnings": list(self.warnings),
        }


_SECTION_ORDER = (
    "summary",
    "permission",
    "when_to_use",
    "avoid_when",
    "usage_hints",
    "result_hints",
    "error_hints",
    "connected_accounts",
    "dry_run",
    "approval_summary_template",
    "side_effect_summary",
    "jurisdiction",
    "legal_notes",
    "idempotency_support",
    "currency",
    "settlement_mode",
    "refund_or_cancellation_note",
)

_LOSSY_WARNING_MESSAGES = {
    "anthropic": {
        "output_schema": "output_schema omitted - Anthropic tool definitions do not model output schemas.",
        "approval_summary_template": "approval_summary_template merged into description - Anthropic tool definitions do not model approval summaries.",
        "preview_schema": "preview_schema omitted - Anthropic tool definitions do not model previews.",
        "idempotency_support": "idempotency_support merged into description - Anthropic tool definitions do not model idempotency hints.",
        "side_effect_summary": "side_effect_summary merged into description - Anthropic tool definitions do not model side-effect summaries.",
        "quote_schema": "quote_schema omitted - Anthropic tool definitions do not model payment quote schemas.",
        "currency": "currency merged into description - Anthropic tool definitions do not model settlement currency metadata.",
        "settlement_mode": "settlement_mode merged into description - Anthropic tool definitions do not model settlement-mode metadata.",
        "refund_or_cancellation_note": "refund_or_cancellation_note merged into description - Anthropic tool definitions do not model refund policy metadata.",
        "jurisdiction": "jurisdiction merged into description - Anthropic tool definitions do not model jurisdiction metadata.",
        "legal_notes": "legal_notes merged into description - Anthropic tool definitions do not model legal note metadata.",
    },
    "openai_function": {
        "output_schema": "output_schema omitted - OpenAI function definitions do not model output schemas.",
        "approval_summary_template": "approval_summary_template merged into description - OpenAI function definitions do not model approval summaries.",
        "preview_schema": "preview_schema omitted - OpenAI function definitions do not model previews.",
        "idempotency_support": "idempotency_support merged into description - OpenAI function definitions do not model idempotency hints.",
        "side_effect_summary": "side_effect_summary merged into description - OpenAI function definitions do not model side-effect summaries.",
        "quote_schema": "quote_schema omitted - OpenAI function definitions do not model payment quote schemas.",
        "currency": "currency merged into description - OpenAI function definitions do not model settlement currency metadata.",
        "settlement_mode": "settlement_mode merged into description - OpenAI function definitions do not model settlement-mode metadata.",
        "refund_or_cancellation_note": "refund_or_cancellation_note merged into description - OpenAI function definitions do not model refund policy metadata.",
        "jurisdiction": "jurisdiction merged into description - OpenAI function definitions do not model jurisdiction metadata.",
        "legal_notes": "legal_notes merged into description - OpenAI function definitions do not model legal note metadata.",
    },
    "openai_responses_tool": {
        "output_schema": "output_schema omitted - OpenAI Responses tool definitions do not model output schemas.",
        "approval_summary_template": "approval_summary_template merged into description - OpenAI Responses tool definitions do not model approval summaries.",
        "preview_schema": "preview_schema omitted - OpenAI Responses tool definitions do not model previews.",
        "idempotency_support": "idempotency_support merged into description - OpenAI Responses tool definitions do not model idempotency hints.",
        "side_effect_summary": "side_effect_summary merged into description - OpenAI Responses tool definitions do not model side-effect summaries.",
        "quote_schema": "quote_schema omitted - OpenAI Responses tool definitions do not model payment quote schemas.",
        "currency": "currency merged into description - OpenAI Responses tool definitions do not model settlement currency metadata.",
        "settlement_mode": "settlement_mode merged into description - OpenAI Responses tool definitions do not model settlement-mode metadata.",
        "refund_or_cancellation_note": "refund_or_cancellation_note merged into description - OpenAI Responses tool definitions do not model refund policy metadata.",
        "jurisdiction": "jurisdiction merged into description - OpenAI Responses tool definitions do not model jurisdiction metadata.",
        "legal_notes": "legal_notes merged into description - OpenAI Responses tool definitions do not model legal note metadata.",
    },
    "mcp": {
        "approval_summary_template": "approval_summary_template merged into description - MCP tool descriptors do not model approval summaries.",
        "preview_schema": "preview_schema omitted - MCP tool descriptors do not model previews.",
        "side_effect_summary": "side_effect_summary merged into description - MCP tool descriptors do not model side-effect summaries.",
        "quote_schema": "quote_schema omitted - MCP tool descriptors do not model payment quote schemas.",
        "currency": "currency merged into description - MCP tool descriptors do not model settlement currency metadata.",
        "settlement_mode": "settlement_mode merged into description - MCP tool descriptors do not model settlement-mode metadata.",
        "refund_or_cancellation_note": "refund_or_cancellation_note merged into description - MCP tool descriptors do not model refund policy metadata.",
        "jurisdiction": "jurisdiction merged into description - MCP tool descriptors do not model jurisdiction metadata.",
        "legal_notes": "legal_notes merged into description - MCP tool descriptors do not model legal note metadata.",
    },
}


def to_anthropic_tool(tool_manual: Any) -> ToolSchemaExport:
    manual = _coerce_tool_manual(tool_manual)
    tool_name = _required_non_empty_string(manual, "tool_name")
    lossy_fields = _lossy_fields("anthropic", manual)
    return ToolSchemaExport(
        schema={
            "name": tool_name,
            "description": _build_description(manual),
            "input_schema": _mapping(manual.get("input_schema")),
        },
        lossy_fields=lossy_fields,
        warnings=_warnings_for("anthropic", lossy_fields),
    )


def to_openai_function(tool_manual: Any) -> ToolSchemaExport:
    manual = _coerce_tool_manual(tool_manual)
    tool_name = _required_non_empty_string(manual, "tool_name")
    lossy_fields = _lossy_fields("openai_function", manual)
    return ToolSchemaExport(
        schema={
            "name": tool_name,
            "description": _build_description(manual),
            "parameters": _mapping(manual.get("input_schema")),
            "strict": True,
        },
        lossy_fields=lossy_fields,
        warnings=_warnings_for("openai_function", lossy_fields),
    )


def to_openai_responses_tool(tool_manual: Any) -> ToolSchemaExport:
    manual = _coerce_tool_manual(tool_manual)
    tool_name = _required_non_empty_string(manual, "tool_name")
    lossy_fields = _lossy_fields("openai_responses_tool", manual)
    # OpenAI Responses API wants a flat function-tool shape (type / name /
    # description / parameters / strict at the top level), not the nested
    # Chat Completions envelope. Nesting `function: {...}` causes
    # `client.responses.create(tools=[...])` to reject the payload.
    return ToolSchemaExport(
        schema={
            "type": "function",
            "name": tool_name,
            "description": _build_description(manual),
            "parameters": _mapping(manual.get("input_schema")),
            "strict": True,
        },
        lossy_fields=lossy_fields,
        warnings=_warnings_for("openai_responses_tool", lossy_fields),
    )


def to_mcp_tool(tool_manual: Any) -> ToolSchemaExport:
    manual = _coerce_tool_manual(tool_manual)
    tool_name = _required_non_empty_string(manual, "tool_name")
    lossy_fields = _lossy_fields("mcp", manual)
    permission_class = str(manual.get("permission_class") or "read_only")
    idempotency_support = manual.get("idempotency_support")
    annotations = {
        "readOnlyHint": permission_class == "read_only",
        "destructiveHint": permission_class != "read_only",
        "idempotentHint": bool(idempotency_support) if idempotency_support is not None else permission_class == "read_only",
    }
    return ToolSchemaExport(
        schema={
            "name": tool_name,
            "description": _build_description(manual),
            "inputSchema": _mapping(manual.get("input_schema")),
            "outputSchema": _mapping(manual.get("output_schema")),
            "annotations": annotations,
        },
        lossy_fields=lossy_fields,
        warnings=_warnings_for("mcp", lossy_fields),
    )


def _coerce_tool_manual(tool_manual: Any) -> dict[str, Any]:
    payload = _to_plain_jsonable(tool_manual)
    if not isinstance(payload, dict):
        raise TypeError("tool_manual must be a mapping-like object")
    return payload


def _to_plain_jsonable(value: Any) -> Any:
    if hasattr(value, "to_dict") and callable(value.to_dict):
        return _to_plain_jsonable(value.to_dict())
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return _to_plain_jsonable(asdict(value))
    if isinstance(value, Mapping):
        return {str(key): _to_plain_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_plain_jsonable(item) for item in value]
    return value


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


def _non_empty_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def _required_non_empty_string(payload: Mapping[str, Any], field_name: str) -> str:
    value = _non_empty_string(payload.get(field_name))
    if value is None:
        raise ValueError(f"tool_manual.{field_name} must be a non-empty string")
    return value


def _build_description(manual: Mapping[str, Any]) -> str:
    sections: dict[str, str] = {}
    summary = _non_empty_string(manual.get("summary_for_model"))
    if summary:
        sections["summary"] = summary

    permission_class = _non_empty_string(manual.get("permission_class"))
    if permission_class:
        sections["permission"] = f"Permission class: {permission_class}."

    trigger_conditions = _string_list(manual.get("trigger_conditions"))
    if trigger_conditions:
        sections["when_to_use"] = _render_list_section("When to use", trigger_conditions)

    do_not_use_when = _string_list(manual.get("do_not_use_when"))
    if do_not_use_when:
        sections["avoid_when"] = _render_list_section("Avoid when", do_not_use_when)

    usage_hints = _string_list(manual.get("usage_hints"))
    if usage_hints:
        sections["usage_hints"] = _render_list_section("Usage hints", usage_hints)

    result_hints = _string_list(manual.get("result_hints"))
    if result_hints:
        sections["result_hints"] = _render_list_section("Result hints", result_hints)

    error_hints = _string_list(manual.get("error_hints"))
    if error_hints:
        sections["error_hints"] = _render_list_section("Error hints", error_hints)

    requires_connected_accounts = _string_list(manual.get("requires_connected_accounts"))
    if requires_connected_accounts:
        sections["connected_accounts"] = _render_list_section("Requires connected accounts", requires_connected_accounts)

    if "dry_run_supported" in manual:
        sections["dry_run"] = f"Dry run supported: {'yes' if bool(manual.get('dry_run_supported')) else 'no'}."

    approval_summary_template = _non_empty_string(manual.get("approval_summary_template"))
    if approval_summary_template:
        sections["approval_summary_template"] = f"Approval summary template: {approval_summary_template}"

    side_effect_summary = _non_empty_string(manual.get("side_effect_summary"))
    if side_effect_summary:
        sections["side_effect_summary"] = f"Side effects: {side_effect_summary}"

    jurisdiction = _non_empty_string(manual.get("jurisdiction"))
    if jurisdiction:
        sections["jurisdiction"] = f"Jurisdiction: {jurisdiction}."

    legal_notes = _non_empty_string(manual.get("legal_notes"))
    if legal_notes:
        sections["legal_notes"] = f"Legal notes: {legal_notes}"

    if "idempotency_support" in manual and manual.get("idempotency_support") is not None:
        sections["idempotency_support"] = (
            f"Idempotency support: {'yes' if bool(manual.get('idempotency_support')) else 'no'}."
        )

    currency = _non_empty_string(manual.get("currency"))
    if currency:
        sections["currency"] = f"Payment currency: {currency}."

    settlement_mode = _non_empty_string(manual.get("settlement_mode"))
    if settlement_mode:
        sections["settlement_mode"] = f"Settlement mode: {settlement_mode}."

    refund_or_cancellation_note = _non_empty_string(manual.get("refund_or_cancellation_note"))
    if refund_or_cancellation_note:
        sections["refund_or_cancellation_note"] = f"Refund or cancellation: {refund_or_cancellation_note}"

    ordered_sections = [sections[key] for key in _SECTION_ORDER if key in sections]
    return "\n\n".join(ordered_sections)


def _render_list_section(title: str, items: list[str]) -> str:
    lines = [title + ":"]
    lines.extend(f"- {item}" for item in items)
    return "\n".join(lines)


def _lossy_fields(provider: str, manual: Mapping[str, Any]) -> list[str]:
    present = []
    for field_name in _LOSSY_WARNING_MESSAGES[provider]:
        value = manual.get(field_name)
        if isinstance(value, Mapping) and not value:
            continue
        if isinstance(value, list) and not value:
            continue
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        present.append(field_name)
    return present


def _warnings_for(provider: str, lossy_fields: list[str]) -> list[str]:
    messages = _LOSSY_WARNING_MESSAGES[provider]
    return [messages[field_name] for field_name in lossy_fields]


__all__ = [
    "ToolSchemaExport",
    "to_anthropic_tool",
    "to_mcp_tool",
    "to_openai_function",
    "to_openai_responses_tool",
]
