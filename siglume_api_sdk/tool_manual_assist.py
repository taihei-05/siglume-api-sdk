from __future__ import annotations

import abc
import json
import os
import sys
from dataclasses import dataclass, field
from importlib import resources, util
from pathlib import Path
from typing import Any, Mapping, Sequence

import httpx

from .client import SiglumeClientError
from .tool_manual_grader import score_tool_manual_offline


_LEGACY_MODULE_NAME = "_siglume_api_sdk_legacy"
_LEGACY_MODULE_PATH = Path(__file__).resolve().parent.parent / "siglume_api_sdk.py"
_ALL_TOOL_MANUAL_FIELDS = (
    "tool_name",
    "job_to_be_done",
    "summary_for_model",
    "trigger_conditions",
    "do_not_use_when",
    "permission_class",
    "dry_run_supported",
    "requires_connected_accounts",
    "input_schema",
    "output_schema",
    "usage_hints",
    "result_hints",
    "error_hints",
    "approval_summary_template",
    "preview_schema",
    "idempotency_support",
    "side_effect_summary",
    "quote_schema",
    "currency",
    "settlement_mode",
    "refund_or_cancellation_note",
    "jurisdiction",
    "legal_notes",
)
_BASE_REQUIRED_FIELDS = (
    "tool_name",
    "job_to_be_done",
    "summary_for_model",
    "trigger_conditions",
    "do_not_use_when",
    "permission_class",
    "dry_run_supported",
    "requires_connected_accounts",
    "input_schema",
    "output_schema",
    "usage_hints",
    "result_hints",
    "error_hints",
)
_ACTION_REQUIRED_FIELDS = (
    "approval_summary_template",
    "preview_schema",
    "idempotency_support",
    "side_effect_summary",
    "jurisdiction",
)
_PAYMENT_REQUIRED_FIELDS = (
    "quote_schema",
    "currency",
    "settlement_mode",
    "refund_or_cancellation_note",
)
_PAYMENT_SETTLEMENT_MODES = (
    "stripe_checkout",
    "stripe_payment_intent",
    "polygon_mandate",
    "embedded_wallet_charge",
)
_VALID_PERMISSION_CLASSES = {"read_only", "action", "payment"}


def _load_legacy_module() -> Any:
    existing = sys.modules.get(_LEGACY_MODULE_NAME)
    if existing is not None:
        return existing
    spec = util.spec_from_file_location(_LEGACY_MODULE_NAME, _LEGACY_MODULE_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load legacy SDK module from {_LEGACY_MODULE_PATH}")
    module = util.module_from_spec(spec)
    sys.modules[_LEGACY_MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


_legacy = _load_legacy_module()
validate_tool_manual = _legacy.validate_tool_manual


@dataclass
class ToolManualAssistAttempt:
    attempt_number: int
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    estimated_cost_usd: float | None = None
    overall_score: int = 0
    grade: str = "F"
    validation_ok: bool = False


@dataclass
class ToolManualAssistMetadata:
    mode: str
    provider: str
    model: str
    attempts: list[ToolManualAssistAttempt] = field(default_factory=list)
    attempt_count: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cache_creation_input_tokens: int = 0
    total_cache_read_input_tokens: int = 0
    total_estimated_cost_usd: float | None = 0.0

    def add_attempt(self, attempt: ToolManualAssistAttempt) -> None:
        self.attempts.append(attempt)
        self.attempt_count = len(self.attempts)
        self.total_input_tokens += attempt.input_tokens
        self.total_output_tokens += attempt.output_tokens
        self.total_cache_creation_input_tokens += attempt.cache_creation_input_tokens
        self.total_cache_read_input_tokens += attempt.cache_read_input_tokens
        if self.total_estimated_cost_usd is None or attempt.estimated_cost_usd is None:
            self.total_estimated_cost_usd = None
        else:
            self.total_estimated_cost_usd += attempt.estimated_cost_usd


@dataclass
class ToolManualAssistResult:
    tool_manual: dict[str, Any]
    quality_report: Any
    metadata: ToolManualAssistMetadata


@dataclass
class _StructuredGenerationUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


@dataclass
class _StructuredGenerationResult:
    payload: dict[str, Any]
    usage: _StructuredGenerationUsage


class SiglumeAssistError(SiglumeClientError):
    """Raised when ToolManual generation cannot reach the publish bar."""


class LLMProvider(abc.ABC):
    provider_name = "generic"
    default_model = ""
    api_key_env = ""
    price_table: Mapping[str, Mapping[str, float]] = {}

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.api_key = api_key or os.environ.get(self.api_key_env)
        if not self.api_key:
            raise SiglumeAssistError(
                f"{self.__class__.__name__} requires an API key via the constructor or {self.api_key_env}."
            )
        self.model = model or self.default_model
        self.base_url = base_url
        self.timeout = timeout

    @abc.abstractmethod
    def generate_structured(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        output_schema: Mapping[str, Any],
    ) -> _StructuredGenerationResult:
        raise NotImplementedError

    def estimate_cost_usd(self, usage: _StructuredGenerationUsage) -> float | None:
        pricing = self.price_table.get(self.model)
        if pricing is None:
            return None
        input_cost = usage.input_tokens * pricing.get("input", 0.0) / 1_000_000
        output_cost = usage.output_tokens * pricing.get("output", 0.0) / 1_000_000
        cache_write_cost = usage.cache_creation_input_tokens * pricing.get("cache_write", pricing.get("input", 0.0)) / 1_000_000
        cache_read_cost = usage.cache_read_input_tokens * pricing.get("cache_read", 0.0) / 1_000_000
        return round(input_cost + output_cost + cache_write_cost + cache_read_cost, 8)


class AnthropicProvider(LLMProvider):
    provider_name = "anthropic"
    default_model = "claude-sonnet-4-6"
    api_key_env = "ANTHROPIC_API_KEY"
    price_table = {
        "claude-sonnet-4-6": {
            "input": 3.0,
            "output": 15.0,
            "cache_write": 3.75,
            "cache_read": 0.30,
        },
    }

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        super().__init__(api_key=api_key, model=model, base_url=base_url or "https://api.anthropic.com/v1/messages", timeout=timeout)
        self._client = httpx.Client(timeout=timeout, transport=transport)

    def generate_structured(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        output_schema: Mapping[str, Any],
    ) -> _StructuredGenerationResult:
        response = self._client.post(
            self.base_url,
            headers={
                "x-api-key": self.api_key or "",
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": self.model,
                "max_tokens": 3200,
                "system": [
                    {
                        "type": "text",
                        "text": system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                "messages": [{"role": "user", "content": user_prompt}],
                "tools": [
                    {
                        "name": "emit_tool_manual",
                        "description": "Return a ToolManual payload that matches the supplied JSON schema exactly.",
                        "input_schema": output_schema,
                        "strict": True,
                    }
                ],
                "tool_choice": {"type": "tool", "name": "emit_tool_manual"},
            },
        )
        if response.status_code >= 400:
            raise SiglumeAssistError(f"Anthropic API request failed: {response.status_code} {response.text}")
        payload = response.json()
        content = payload.get("content") if isinstance(payload, dict) else None
        tool_use = None
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "tool_use" and item.get("name") == "emit_tool_manual":
                    tool_use = item.get("input")
                    break
        if not isinstance(tool_use, dict):
            raise SiglumeAssistError("AnthropicProvider did not return an emit_tool_manual tool_use payload.")
        usage_payload = payload.get("usage") if isinstance(payload, dict) else {}
        usage = _StructuredGenerationUsage(
            input_tokens=_safe_int(_mapping_get(usage_payload, "input_tokens")),
            output_tokens=_safe_int(_mapping_get(usage_payload, "output_tokens")),
            cache_creation_input_tokens=_safe_int(_mapping_get(usage_payload, "cache_creation_input_tokens")),
            cache_read_input_tokens=_safe_int(_mapping_get(usage_payload, "cache_read_input_tokens")),
        )
        return _StructuredGenerationResult(payload=tool_use, usage=usage)


class OpenAIProvider(LLMProvider):
    provider_name = "openai"
    default_model = "gpt-5.4"
    api_key_env = "OPENAI_API_KEY"
    price_table = {
        "gpt-5.4": {
            "input": 2.5,
            "output": 15.0,
        },
        "gpt-5": {
            "input": 1.25,
            "output": 10.0,
        },
    }

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        super().__init__(api_key=api_key, model=model, base_url=base_url or "https://api.openai.com/v1/responses", timeout=timeout)
        self._client = httpx.Client(timeout=timeout, transport=transport)

    def generate_structured(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        output_schema: Mapping[str, Any],
    ) -> _StructuredGenerationResult:
        response = self._client.post(
            self.base_url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "instructions": system_prompt,
                "input": user_prompt,
                "store": False,
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "tool_manual",
                        "strict": True,
                        "schema": output_schema,
                    }
                },
            },
        )
        if response.status_code >= 400:
            raise SiglumeAssistError(f"OpenAI Responses request failed: {response.status_code} {response.text}")
        payload = response.json()
        candidate = _parse_openai_payload(payload)
        usage_payload = payload.get("usage") if isinstance(payload, dict) else {}
        usage = _StructuredGenerationUsage(
            input_tokens=_safe_int(_mapping_get(usage_payload, "input_tokens")),
            output_tokens=_safe_int(_mapping_get(usage_payload, "output_tokens")),
        )
        return _StructuredGenerationResult(payload=candidate, usage=usage)


def draft_tool_manual(
    *,
    capability_key: str,
    job_to_be_done: str,
    permission_class: str,
    llm: LLMProvider,
    source_code_hint: str | None = None,
    max_attempts: int = 3,
) -> ToolManualAssistResult:
    seed_manual = _build_seed_manual(
        capability_key=capability_key,
        job_to_be_done=job_to_be_done,
        permission_class=permission_class,
    )
    schema = _build_tool_manual_schema(permission_class=permission_class, fields=_ALL_TOOL_MANUAL_FIELDS)
    return _run_assist_loop(
        llm=llm,
        mode="draft",
        seed_manual=seed_manual,
        current_manual=None,
        target_fields=_ALL_TOOL_MANUAL_FIELDS,
        output_schema=schema,
        source_code_hint=source_code_hint,
        max_attempts=max_attempts,
    )


def fill_tool_manual_gaps(
    *,
    partial_manual: Mapping[str, Any],
    source_code_hint: str | None = None,
    llm: LLMProvider,
    max_attempts: int = 3,
) -> ToolManualAssistResult:
    current_manual = _normalize_tool_manual_mapping(dict(partial_manual))
    initial_report = score_tool_manual_offline(current_manual)
    inferred_permission_class = _infer_permission_class(current_manual)
    target_fields = _collect_target_fields(current_manual, initial_report, permission_class=inferred_permission_class)
    raw_permission_class = current_manual.get("permission_class")
    if not isinstance(raw_permission_class, str) or raw_permission_class not in _VALID_PERMISSION_CLASSES:
        if inferred_permission_class is None:
            target_fields = list(_ALL_TOOL_MANUAL_FIELDS)
    if not target_fields and getattr(initial_report, "validation_ok", False) and getattr(initial_report, "grade", "F") in {"A", "B"}:
        metadata = ToolManualAssistMetadata(mode="gap_fill", provider=llm.provider_name, model=llm.model)
        return ToolManualAssistResult(tool_manual=current_manual, quality_report=initial_report, metadata=metadata)
    permission_class = inferred_permission_class or "read_only"
    schema = _build_tool_manual_schema(permission_class=permission_class, fields=target_fields)
    return _run_assist_loop(
        llm=llm,
        mode="gap_fill",
        seed_manual=None,
        current_manual=current_manual,
        target_fields=target_fields,
        output_schema=schema,
        source_code_hint=source_code_hint,
        max_attempts=max_attempts,
    )


def load_tool_manual_draft_prompt() -> str:
    return resources.files("siglume_api_sdk").joinpath("prompts", "tool_manual_draft.md").read_text(encoding="utf-8")


def _run_assist_loop(
    *,
    llm: LLMProvider,
    mode: str,
    seed_manual: Mapping[str, Any] | None,
    current_manual: Mapping[str, Any] | None,
    target_fields: Sequence[str],
    output_schema: Mapping[str, Any],
    source_code_hint: str | None,
    max_attempts: int,
) -> ToolManualAssistResult:
    if max_attempts < 1:
        raise ValueError("max_attempts must be >= 1")
    feedback: dict[str, Any] | None = None
    metadata = ToolManualAssistMetadata(mode=mode, provider=llm.provider_name, model=llm.model)
    last_report = None
    for attempt_number in range(1, max_attempts + 1):
        user_prompt = _build_user_prompt(
            mode=mode,
            seed_manual=seed_manual,
            current_manual=current_manual,
            target_fields=target_fields,
            source_code_hint=source_code_hint,
            feedback=feedback,
        )
        generation = llm.generate_structured(
            system_prompt=load_tool_manual_draft_prompt(),
            user_prompt=user_prompt,
            output_schema=output_schema,
        )
        candidate = _normalize_tool_manual_mapping(generation.payload)
        if mode == "gap_fill" and current_manual is not None:
            candidate = _merge_tool_manual_patch(current_manual, candidate, target_fields)
        report = score_tool_manual_offline(candidate)
        validation_ok, validation_issues = validate_tool_manual(candidate)
        report.validation_ok = bool(getattr(report, "validation_ok", False)) and validation_ok
        if not getattr(report, "validation_errors", None):
            report.validation_errors = [issue for issue in validation_issues if getattr(issue, "severity", "error") == "error"]
        attempt = ToolManualAssistAttempt(
            attempt_number=attempt_number,
            provider=llm.provider_name,
            model=llm.model,
            input_tokens=generation.usage.input_tokens,
            output_tokens=generation.usage.output_tokens,
            cache_creation_input_tokens=generation.usage.cache_creation_input_tokens,
            cache_read_input_tokens=generation.usage.cache_read_input_tokens,
            estimated_cost_usd=llm.estimate_cost_usd(generation.usage),
            overall_score=int(getattr(report, "overall_score", 0)),
            grade=str(getattr(report, "grade", "F")),
            validation_ok=bool(getattr(report, "validation_ok", False)),
        )
        metadata.add_attempt(attempt)
        last_report = report
        if attempt.validation_ok and attempt.grade in {"A", "B"}:
            return ToolManualAssistResult(tool_manual=candidate, quality_report=report, metadata=metadata)
        feedback = _build_feedback(report)
    raise SiglumeAssistError(
        "ToolManual generation did not reach grade B or better after "
        f"{max_attempts} attempts. Last grade: {getattr(last_report, 'grade', 'F')}."
    )


def _build_seed_manual(*, capability_key: str, job_to_be_done: str, permission_class: str) -> dict[str, Any]:
    seed = {
        "tool_name": capability_key.replace("-", "_"),
        "job_to_be_done": job_to_be_done,
        "permission_class": permission_class,
        "dry_run_supported": True,
        "requires_connected_accounts": [],
    }
    if permission_class in {"action", "payment"}:
        seed["jurisdiction"] = "US"
        seed["idempotency_support"] = True
    if permission_class == "payment":
        seed["currency"] = "USD"
    return seed


def _build_user_prompt(
    *,
    mode: str,
    seed_manual: Mapping[str, Any] | None,
    current_manual: Mapping[str, Any] | None,
    target_fields: Sequence[str],
    source_code_hint: str | None,
    feedback: Mapping[str, Any] | None,
) -> str:
    payload = {
        "mode": mode,
        "seed_manual": seed_manual,
        "current_manual": current_manual,
        "target_fields": list(target_fields),
        "source_code_hint": source_code_hint,
        "feedback_from_previous_attempt": feedback,
    }
    instructions = [
        "Generate a Siglume ToolManual payload that satisfies the requested JSON schema.",
        "Use factual, concrete wording. Avoid marketing language and vague phrases.",
        "ToolManual.permission_class must use read_only, action, or payment.",
        "For payment tools, currency must be USD.",
        "For gap_fill mode, preserve every non-target field exactly as provided in current_manual.",
        "Return only the structured payload required by the schema.",
        "",
        json.dumps(payload, ensure_ascii=False, indent=2),
    ]
    return "\n".join(instructions)


def _build_feedback(report: Any) -> dict[str, Any]:
    issues = []
    for issue in getattr(report, "issues", []) or []:
        issues.append(
            {
                "field": getattr(issue, "field", None),
                "message": getattr(issue, "message", ""),
                "severity": getattr(issue, "severity", "warning"),
                "suggestion": getattr(issue, "suggestion", None),
            }
        )
    return {
        "overall_score": int(getattr(report, "overall_score", 0)),
        "grade": str(getattr(report, "grade", "F")),
        "issues": issues,
        "improvement_suggestions": list(getattr(report, "improvement_suggestions", []) or []),
    }


def _collect_target_fields(manual: Mapping[str, Any], report: Any, *, permission_class: str | None = None) -> list[str]:
    target_fields: list[str] = []
    for field_name in _BASE_REQUIRED_FIELDS:
        if _is_field_missing_or_empty(field_name, manual.get(field_name)):
            target_fields.append(field_name)
    effective_permission_class = permission_class or str(manual.get("permission_class") or "read_only")
    if effective_permission_class in {"action", "payment"}:
        for field_name in _ACTION_REQUIRED_FIELDS:
            if _is_field_missing_or_empty(field_name, manual.get(field_name)):
                target_fields.append(field_name)
    if effective_permission_class == "payment":
        for field_name in _PAYMENT_REQUIRED_FIELDS:
            if _is_field_missing_or_empty(field_name, manual.get(field_name)):
                target_fields.append(field_name)
    validation_ok, validation_issues = validate_tool_manual(manual)
    if not validation_ok:
        for issue in validation_issues:
            root_field = _root_field(getattr(issue, "field", None))
            if root_field and root_field in _ALL_TOOL_MANUAL_FIELDS:
                target_fields.append(root_field)
    if str(getattr(report, "grade", "F")) not in {"A", "B"}:
        for issue in getattr(report, "issues", []) or []:
            root_field = _root_field(getattr(issue, "field", None))
            if root_field and root_field in _ALL_TOOL_MANUAL_FIELDS:
                target_fields.append(root_field)
    return list(dict.fromkeys(target_fields))


def _root_field(field_name: str | None) -> str | None:
    if not field_name:
        return None
    return field_name.split("[", 1)[0].split(".", 1)[0]


def _infer_permission_class(manual: Mapping[str, Any]) -> str | None:
    raw_permission_class = manual.get("permission_class")
    if isinstance(raw_permission_class, str) and raw_permission_class in _VALID_PERMISSION_CLASSES:
        return raw_permission_class
    if any(not _is_field_missing_or_empty(field_name, manual.get(field_name)) for field_name in _PAYMENT_REQUIRED_FIELDS):
        return "payment"
    if any(not _is_field_missing_or_empty(field_name, manual.get(field_name)) for field_name in _ACTION_REQUIRED_FIELDS):
        return "action"
    return None


def _is_missing_or_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def _is_field_missing_or_empty(field_name: str, value: Any) -> bool:
    if field_name == "requires_connected_accounts" and isinstance(value, list):
        return False
    return _is_missing_or_empty(value)


def _merge_tool_manual_patch(
    current_manual: Mapping[str, Any],
    patch: Mapping[str, Any],
    target_fields: Sequence[str],
) -> dict[str, Any]:
    merged = _normalize_tool_manual_mapping(dict(current_manual))
    for field_name in target_fields:
        if field_name in patch:
            merged[field_name] = patch[field_name]
    return merged


def _normalize_tool_manual_mapping(raw: Mapping[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for field_name in _ALL_TOOL_MANUAL_FIELDS:
        if field_name not in raw:
            continue
        value = raw[field_name]
        if field_name in {"trigger_conditions", "do_not_use_when", "requires_connected_accounts", "usage_hints", "result_hints", "error_hints"}:
            normalized[field_name] = _normalize_string_list(value)
        elif field_name in {"input_schema", "output_schema", "preview_schema", "quote_schema"}:
            normalized[field_name] = _normalize_mapping(value)
        elif field_name in {"dry_run_supported", "idempotency_support"}:
            # Do not coerce — bool("false") == True would mask a real type error
            # and let invalid idempotency_support slip past validation for action/payment.
            # Preserve the original so the ToolManual validator can reject it explicitly.
            normalized[field_name] = value
        elif field_name == "permission_class":
            normalized[field_name] = str(value)
        elif field_name == "currency":
            normalized[field_name] = str(value).upper() if value is not None else value
        else:
            normalized[field_name] = value
    return normalized


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _normalize_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


def _build_tool_manual_schema(*, permission_class: str | None, fields: Sequence[str]) -> dict[str, Any]:
    properties = {
        "tool_name": {"type": "string", "minLength": 3, "maxLength": 64},
        "job_to_be_done": {"type": "string", "minLength": 10, "maxLength": 500},
        "summary_for_model": {"type": "string", "minLength": 10, "maxLength": 300},
        "trigger_conditions": {
            "type": "array",
            "items": {"type": "string", "minLength": 10, "maxLength": 200},
            "minItems": 1,
        },
        "do_not_use_when": {
            "type": "array",
            "items": {"type": "string", "minLength": 1, "maxLength": 200},
            "minItems": 1,
        },
        "permission_class": {"type": "string", "enum": ["read_only", "action", "payment"]},
        "dry_run_supported": {"type": "boolean"},
        "requires_connected_accounts": {"type": "array", "items": {"type": "string"}},
        "input_schema": {"type": "object"},
        "output_schema": {"type": "object"},
        "usage_hints": {"type": "array", "items": {"type": "string"}},
        "result_hints": {"type": "array", "items": {"type": "string"}},
        "error_hints": {"type": "array", "items": {"type": "string"}},
        "approval_summary_template": {"type": "string"},
        "preview_schema": {"type": "object"},
        "idempotency_support": {"type": "boolean"},
        "side_effect_summary": {"type": "string"},
        "quote_schema": {"type": "object"},
        "currency": {"type": "string", "enum": ["USD"]},
        "settlement_mode": {"type": "string", "enum": list(_PAYMENT_SETTLEMENT_MODES)},
        "refund_or_cancellation_note": {"type": "string"},
        "jurisdiction": {"type": "string"},
        "legal_notes": {"type": "string"},
    }
    selected_fields = list(dict.fromkeys(field for field in fields if field in properties))
    required = list(selected_fields)
    if set(selected_fields) == set(_ALL_TOOL_MANUAL_FIELDS):
        required = [field for field in _BASE_REQUIRED_FIELDS]
        if permission_class in {"action", "payment"}:
            required.extend(_ACTION_REQUIRED_FIELDS)
        if permission_class == "payment":
            required.extend(_PAYMENT_REQUIRED_FIELDS)
    return {
        "type": "object",
        "properties": {field_name: properties[field_name] for field_name in selected_fields},
        "required": required,
        "additionalProperties": False,
    }


def _parse_openai_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise SiglumeAssistError("OpenAI Responses returned a non-object payload.")
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        try:
            decoded = json.loads(output_text)
        except json.JSONDecodeError as exc:
            raise SiglumeAssistError("OpenAI Responses output_text did not contain valid JSON.") from exc
        if isinstance(decoded, dict):
            return decoded
    output = payload.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            if isinstance(item.get("content"), list):
                for content_block in item["content"]:
                    if not isinstance(content_block, dict):
                        continue
                    text_value = content_block.get("text")
                    if isinstance(text_value, str) and text_value.strip():
                        try:
                            decoded = json.loads(text_value)
                        except json.JSONDecodeError:
                            continue
                        if isinstance(decoded, dict):
                            return decoded
    raise SiglumeAssistError("OpenAIProvider did not return a structured JSON object.")


def _mapping_get(value: Any, key: str) -> Any:
    if isinstance(value, Mapping):
        return value.get(key)
    return None


def _safe_int(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return max(parsed, 0)
