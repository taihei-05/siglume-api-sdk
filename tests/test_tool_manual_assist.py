from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk import (  # noqa: E402
    AnthropicProvider,
    OpenAIProvider,
    SiglumeAssistError,
    draft_tool_manual,
    fill_tool_manual_gaps,
)
from siglume_api_sdk.assist import draft_tool_manual as alias_draft_tool_manual  # noqa: E402
from siglume_api_sdk.tool_manual_assist import (  # noqa: E402
    LLMProvider,
    _build_tool_manual_schema,
    load_tool_manual_draft_prompt,
)


def good_manual() -> dict[str, object]:
    return {
        "tool_name": "price_compare_helper",
        "job_to_be_done": "Search multiple retailers for a product and return a ranked price comparison the agent can cite.",
        "summary_for_model": "Looks up current retailer offers and returns a structured comparison with the best deal first.",
        "trigger_conditions": [
            "owner asks to compare prices for a product before deciding where to buy",
            "agent needs retailer offer data to support a shopping recommendation",
            "request is to find the cheapest or best-value option for a product query",
        ],
        "do_not_use_when": [
            "the request is to complete checkout or place an order instead of comparing offers",
        ],
        "permission_class": "read_only",
        "dry_run_supported": True,
        "requires_connected_accounts": [],
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Product name, model number, or search phrase."},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        "output_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line overview of the best available deal."},
                "offers": {"type": "array", "items": {"type": "object"}, "description": "Ranked retailer offers."},
            },
            "required": ["summary", "offers"],
            "additionalProperties": False,
        },
        "usage_hints": ["Use this tool after the owner has named a product and wants evidence-backed price comparison."],
        "result_hints": ["Lead with the best offer and then summarize notable trade-offs."],
        "error_hints": ["If no offers are found, ask for a clearer product name or model number."],
    }


def weak_manual() -> dict[str, object]:
    return {
        **good_manual(),
        "summary_for_model": "Bad.",
        "trigger_conditions": ["use when helpful", "for many tasks", "any request"],
        "usage_hints": [],
        "result_hints": [],
        "error_hints": [],
    }


def good_payment_manual() -> dict[str, object]:
    return {
        **good_manual(),
        "permission_class": "payment",
        "output_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line overview of the quoted payment."},
                "amount_usd": {"type": "number", "description": "Quoted USD amount."},
                "currency": {"type": "string", "description": "Currency code for the quote."},
            },
            "required": ["summary", "amount_usd", "currency"],
            "additionalProperties": False,
        },
        "approval_summary_template": "Charge USD {amount_usd}.",
        "preview_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Preview of the payment attempt."},
            },
            "required": ["summary"],
            "additionalProperties": False,
        },
        "idempotency_support": True,
        "side_effect_summary": "Captures a USD payment if the owner approves.",
        "quote_schema": {
            "type": "object",
            "properties": {
                "amount_usd": {"type": "number", "description": "Quoted USD amount."},
                "currency": {"type": "string", "description": "Currency code for the quote."},
            },
            "required": ["amount_usd", "currency"],
            "additionalProperties": False,
        },
        "currency": "USD",
        "settlement_mode": "embedded_wallet_charge",
        "refund_or_cancellation_note": "Refunds follow the merchant cancellation policy.",
        "jurisdiction": "US",
    }


class StubProvider(LLMProvider):
    provider_name = "stub"
    default_model = "stub-model"
    api_key_env = "STUB_API_KEY"

    def __init__(self, payloads: list[dict[str, object]], *, api_key: str = "stub-key") -> None:
        super().__init__(api_key=api_key, model="stub-model")
        self.payloads = payloads
        self.calls = 0
        self.last_output_schema = None

    def generate_structured(self, *, system_prompt: str, user_prompt: str, output_schema):
        assert "Siglume ToolManual Draft System Prompt" in system_prompt
        assert output_schema["type"] == "object"
        self.last_output_schema = output_schema
        payload = self.payloads[min(self.calls, len(self.payloads) - 1)]
        self.calls += 1
        return type(
            "StructuredResult",
            (),
            {
                "payload": payload,
                "usage": type(
                    "Usage",
                    (),
                    {
                        "input_tokens": 100 * self.calls,
                        "output_tokens": 20 * self.calls,
                        "cache_creation_input_tokens": 0,
                        "cache_read_input_tokens": 0,
                    },
                )(),
            },
        )()


def test_full_draft_returns_structured_result() -> None:
    provider = StubProvider([good_manual()])

    result = draft_tool_manual(
        capability_key="price-compare-helper",
        job_to_be_done="Compare retailer prices for a product and return the best current offer.",
        permission_class="read_only",
        llm=provider,
    )

    assert result.tool_manual["tool_name"] == "price_compare_helper"
    assert result.quality_report.grade in {"A", "B"}
    assert result.metadata.attempt_count == 1
    assert result.metadata.total_input_tokens == 100


def test_gap_filler_preserves_valid_fields_and_only_fills_targets() -> None:
    partial = good_manual()
    partial.pop("summary_for_model")
    partial["usage_hints"] = []
    provider = StubProvider(
        [
            {
                "summary_for_model": "Looks up current retailer offers and returns a structured comparison with the best deal first.",
                "usage_hints": ["Use this tool after the owner has named a product and wants evidence-backed price comparison."],
            }
        ]
    )

    result = fill_tool_manual_gaps(partial_manual=partial, llm=provider)

    assert result.tool_manual["tool_name"] == "price_compare_helper"
    assert result.tool_manual["summary_for_model"].startswith("Looks up current retailer offers")
    assert result.tool_manual["usage_hints"]
    assert result.metadata.attempt_count == 1


def test_gap_filler_noops_for_already_publishable_manual() -> None:
    partial = {
        **good_manual(),
        "input_schema": json.dumps(good_manual()["input_schema"]),
        "output_schema": json.dumps(good_manual()["output_schema"]),
    }
    provider = StubProvider([good_manual()])

    result = fill_tool_manual_gaps(partial_manual=partial, llm=provider)

    assert result.metadata.attempt_count == 0
    assert provider.calls == 0
    assert result.tool_manual["input_schema"] == good_manual()["input_schema"]


def test_gap_filler_recovers_payment_fields_when_permission_class_is_missing() -> None:
    partial = good_payment_manual()
    partial.pop("permission_class")
    partial.pop("refund_or_cancellation_note")
    provider = StubProvider(
        [
            {
                "permission_class": "payment",
                "refund_or_cancellation_note": "Refunds follow the merchant cancellation policy.",
            }
        ]
    )

    result = fill_tool_manual_gaps(partial_manual=partial, llm=provider)

    assert provider.last_output_schema is not None
    assert "refund_or_cancellation_note" in provider.last_output_schema["properties"]
    assert result.tool_manual["permission_class"] == "payment"
    assert result.tool_manual["refund_or_cancellation_note"] == "Refunds follow the merchant cancellation policy."


def test_generation_retries_until_grade_b_or_better() -> None:
    provider = StubProvider([weak_manual(), good_manual()])

    result = draft_tool_manual(
        capability_key="price-compare-helper",
        job_to_be_done="Compare retailer prices for a product and return the best current offer.",
        permission_class="read_only",
        llm=provider,
    )

    assert result.metadata.attempt_count == 2
    assert result.metadata.attempts[0].grade not in {"A", "B"}
    assert result.metadata.attempts[1].grade in {"A", "B"}


def test_generation_raises_after_exhausting_attempts() -> None:
    provider = StubProvider([weak_manual(), weak_manual(), weak_manual()])

    with pytest.raises(SiglumeAssistError):
        draft_tool_manual(
            capability_key="price-compare-helper",
            job_to_be_done="Compare retailer prices for a product and return the best current offer.",
            permission_class="read_only",
            llm=provider,
            max_attempts=3,
        )


def test_alias_import_points_to_same_function() -> None:
    assert alias_draft_tool_manual is draft_tool_manual


def test_anthropic_provider_uses_prompt_caching_and_tool_use(monkeypatch) -> None:
    seen_body: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "content": [
                    {
                        "type": "tool_use",
                        "name": "emit_tool_manual",
                        "input": good_manual(),
                    }
                ],
                "usage": {
                    "input_tokens": 120,
                    "output_tokens": 40,
                    "cache_creation_input_tokens": 80,
                    "cache_read_input_tokens": 0,
                },
            },
        )

    monkeypatch.setenv("ANTHROPIC_API_KEY", "ant_test_key")
    provider = AnthropicProvider(transport=httpx.MockTransport(handler))

    result = draft_tool_manual(
        capability_key="price-compare-helper",
        job_to_be_done="Compare retailer prices for a product and return the best current offer.",
        permission_class="read_only",
        llm=provider,
    )

    assert seen_body["tool_choice"] == {"type": "tool", "name": "emit_tool_manual"}
    assert seen_body["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert result.metadata.attempts[0].estimated_cost_usd is not None


def test_openai_provider_uses_responses_text_format(monkeypatch) -> None:
    seen_body: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "output_text": json.dumps(good_manual()),
                "usage": {"input_tokens": 90, "output_tokens": 30},
            },
        )

    monkeypatch.setenv("OPENAI_API_KEY", "openai_test_key")
    provider = OpenAIProvider(transport=httpx.MockTransport(handler))
    schema = _build_tool_manual_schema(permission_class="read_only", fields=["summary_for_model"])
    response = provider.generate_structured(
        system_prompt=load_tool_manual_draft_prompt(),
        user_prompt="return a summary_for_model",
        output_schema=schema,
    )

    assert seen_body["store"] is False
    assert seen_body["text"]["format"]["type"] == "json_schema"
    assert response.payload["tool_name"] == "price_compare_helper"
