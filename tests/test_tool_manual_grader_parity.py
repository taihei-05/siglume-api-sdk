from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk import score_tool_manual_offline  # noqa: E402


EXPECTED_PARITY = {
    "baseline_read_only": {"overall_score": 100, "keyword_coverage_estimate": 40},
    "action_good": {"overall_score": 100, "keyword_coverage_estimate": 40},
    "payment_good": {"overall_score": 100, "keyword_coverage_estimate": 40},
    "short_triggers": {"overall_score": 85, "keyword_coverage_estimate": 30},
    "vague_triggers": {"overall_score": 83, "keyword_coverage_estimate": 34},
    "marketing_triggers": {"overall_score": 91, "keyword_coverage_estimate": 41},
    "imperative_triggers": {"overall_score": 89, "keyword_coverage_estimate": 37},
    "too_few_triggers": {"overall_score": 95, "keyword_coverage_estimate": 34},
    "overlapping_do_not_use": {"overall_score": 97, "keyword_coverage_estimate": 40},
    "short_do_not_use": {"overall_score": 98, "keyword_coverage_estimate": 40},
    "short_summary": {"overall_score": 97, "keyword_coverage_estimate": 35},
    "marketing_summary": {"overall_score": 97, "keyword_coverage_estimate": 40},
    "missing_input_descriptions": {"overall_score": 90, "keyword_coverage_estimate": 40},
    "short_input_descriptions": {"overall_score": 96, "keyword_coverage_estimate": 40},
    "trivial_enum_values": {"overall_score": 95, "keyword_coverage_estimate": 40},
    "missing_output_descriptions": {"overall_score": 96, "keyword_coverage_estimate": 40},
    "empty_hints": {"overall_score": 94, "keyword_coverage_estimate": 33},
    "short_hints": {"overall_score": 98, "keyword_coverage_estimate": 34},
    "low_keyword_coverage": {"overall_score": 60, "keyword_coverage_estimate": 6},
    "invalid_root": {"overall_score": 0, "keyword_coverage_estimate": 0},
}


def _base_manual() -> dict[str, object]:
    return {
        "tool_name": "price_compare_helper",
        "job_to_be_done": "Compare retailer prices for a product and return the best current offer with supporting details.",
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
                "max_price_usd": {"type": "number", "description": "Optional maximum budget in USD for filtering offers."},
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
        "usage_hints": [
            "Use this tool after the owner has named a product and wants evidence-backed price comparison.",
        ],
        "result_hints": [
            "Lead with the best offer and then summarize notable trade-offs.",
        ],
        "error_hints": [
            "If no offers are found, ask for a clearer product name or model number.",
        ],
    }


def _clone_base() -> dict[str, object]:
    return copy.deepcopy(_base_manual())


def _build_parity_cases() -> list[tuple[str, object]]:
    cases: list[tuple[str, object]] = []

    manual = _clone_base()
    cases.append(("baseline_read_only", manual))

    manual = _clone_base()
    manual["permission_class"] = "action"
    manual["tool_name"] = "draft_creator"
    manual["approval_summary_template"] = "Create draft for {query}"
    manual["preview_schema"] = {
        "type": "object",
        "properties": {"summary": {"type": "string", "description": "Preview of the action to perform."}},
        "required": ["summary"],
        "additionalProperties": False,
    }
    manual["idempotency_support"] = True
    manual["side_effect_summary"] = "Creates or updates an external draft resource."
    manual["jurisdiction"] = "US"
    cases.append(("action_good", manual))

    manual = _clone_base()
    manual["permission_class"] = "payment"
    manual["tool_name"] = "payment_quote"
    manual["approval_summary_template"] = "Charge USD {amount_usd} for {query}"
    manual["preview_schema"] = {
        "type": "object",
        "properties": {"summary": {"type": "string", "description": "Preview of the payment attempt."}},
        "required": ["summary"],
        "additionalProperties": False,
    }
    manual["idempotency_support"] = True
    manual["side_effect_summary"] = "Captures a USD payment if the owner approves."
    manual["jurisdiction"] = "US"
    manual["quote_schema"] = {
        "type": "object",
        "properties": {
            "amount_usd": {"type": "number", "description": "Quoted USD amount."},
            "currency": {"type": "string", "description": "Currency code for the quote."},
        },
        "required": ["amount_usd", "currency"],
        "additionalProperties": False,
    }
    manual["currency"] = "USD"
    manual["settlement_mode"] = "embedded_wallet_charge"
    manual["refund_or_cancellation_note"] = "Refunds follow the merchant cancellation policy."
    output_schema = manual["output_schema"]
    assert isinstance(output_schema, dict)
    properties = output_schema["properties"]
    assert isinstance(properties, dict)
    properties["amount_usd"] = {"type": "number", "description": "USD amount that was quoted or charged."}
    properties["currency"] = {"type": "string", "description": "Currency code for the quote or charge."}
    output_schema["required"] = ["summary", "offers", "amount_usd", "currency"]
    cases.append(("payment_good", manual))

    manual = _clone_base()
    manual["trigger_conditions"] = ["short one", "tiny trigger", "brief"]
    cases.append(("short_triggers", manual))

    manual = _clone_base()
    manual["trigger_conditions"] = [
        "Use when helpful for shopping tasks",
        "Use this tool as needed for many tasks",
        "If appropriate, use for productivity shopping support",
    ]
    cases.append(("vague_triggers", manual))

    manual = _clone_base()
    manual["trigger_conditions"] = [
        "Ultimate price comparison for amazing shopping decisions",
        "Game-changing offer search for world-class bargain hunting",
        "Next-generation retailer scan for unbeatable deals",
    ]
    cases.append(("marketing_triggers", manual))

    manual = _clone_base()
    manual["trigger_conditions"] = [
        "Use this tool to compare the latest retailer offers for the requested product",
        "Call this tool to gather seller price information for a named item",
        "Execute this tool to identify the best-value option for a purchase",
    ]
    cases.append(("imperative_triggers", manual))

    manual = _clone_base()
    trigger_conditions = manual["trigger_conditions"]
    assert isinstance(trigger_conditions, list)
    manual["trigger_conditions"] = trigger_conditions[:2]
    cases.append(("too_few_triggers", manual))

    manual = _clone_base()
    manual["do_not_use_when"] = ["compare prices for a product before deciding where to buy"]
    cases.append(("overlapping_do_not_use", manual))

    manual = _clone_base()
    manual["do_not_use_when"] = ["skip"]
    cases.append(("short_do_not_use", manual))

    manual = _clone_base()
    manual["summary_for_model"] = "Compares prices."
    cases.append(("short_summary", manual))

    manual = _clone_base()
    manual["summary_for_model"] = "Amazing revolutionary world-class price comparison assistant for unbeatable shopping."
    cases.append(("marketing_summary", manual))

    manual = _clone_base()
    input_schema = manual["input_schema"]
    assert isinstance(input_schema, dict)
    input_properties = input_schema["properties"]
    assert isinstance(input_properties, dict)
    query = input_properties["query"]
    max_price = input_properties["max_price_usd"]
    assert isinstance(query, dict)
    assert isinstance(max_price, dict)
    query.pop("description", None)
    max_price.pop("description", None)
    cases.append(("missing_input_descriptions", manual))

    manual = _clone_base()
    input_schema = manual["input_schema"]
    assert isinstance(input_schema, dict)
    input_properties = input_schema["properties"]
    assert isinstance(input_properties, dict)
    query = input_properties["query"]
    max_price = input_properties["max_price_usd"]
    assert isinstance(query, dict)
    assert isinstance(max_price, dict)
    query["description"] = "Name"
    max_price["description"] = "Cap"
    cases.append(("short_input_descriptions", manual))

    manual = _clone_base()
    input_schema = manual["input_schema"]
    assert isinstance(input_schema, dict)
    input_properties = input_schema["properties"]
    assert isinstance(input_properties, dict)
    input_properties["unit"] = {
        "type": "string",
        "description": "Preferred unit system for the returned offer metrics.",
        "enum": ["a", "b", "c"],
    }
    cases.append(("trivial_enum_values", manual))

    manual = _clone_base()
    output_schema = manual["output_schema"]
    assert isinstance(output_schema, dict)
    output_properties = output_schema["properties"]
    assert isinstance(output_properties, dict)
    summary = output_properties["summary"]
    offers = output_properties["offers"]
    assert isinstance(summary, dict)
    assert isinstance(offers, dict)
    summary.pop("description", None)
    offers.pop("description", None)
    cases.append(("missing_output_descriptions", manual))

    manual = _clone_base()
    manual["usage_hints"] = []
    manual["result_hints"] = []
    cases.append(("empty_hints", manual))

    manual = _clone_base()
    manual["usage_hints"] = ["brief"]
    manual["result_hints"] = ["tiny"]
    cases.append(("short_hints", manual))

    manual = _clone_base()
    manual["job_to_be_done"] = "Do task"
    manual["summary_for_model"] = "Do thing"
    manual["trigger_conditions"] = ["when needed", "as needed", "if appropriate"]
    manual["usage_hints"] = ["use"]
    cases.append(("low_keyword_coverage", manual))

    cases.append(("invalid_root", "not a dict"))

    assert len(cases) == 20
    return cases


@pytest.mark.parametrize(("case_name", "manual"), _build_parity_cases())
def test_score_tool_manual_offline_stays_within_server_parity_window(case_name: str, manual: object) -> None:
    report = score_tool_manual_offline(manual)
    expected = EXPECTED_PARITY[case_name]

    assert abs(report.overall_score - expected["overall_score"]) <= 5
    assert report.keyword_coverage_estimate == expected["keyword_coverage_estimate"]


def test_score_tool_manual_offline_exposes_validation_and_publishable_state() -> None:
    manual = _clone_base()
    manual.pop("usage_hints", None)

    report = score_tool_manual_offline(manual)

    assert report.validation_ok is False
    assert report.publishable is False
    assert any(issue.code == "MISSING_FIELD" for issue in report.validation_errors)
    assert any(issue.field == "usage_hints" for issue in report.issues)


def test_score_tool_manual_offline_penalizes_malformed_field_types() -> None:
    trigger_manual = _clone_base()
    trigger_manual["trigger_conditions"] = [None, None, None]

    trigger_report = score_tool_manual_offline(trigger_manual)

    assert trigger_report.overall_score <= 85
    assert any(issue.field == "trigger_conditions[0]" for issue in trigger_report.issues)

    description_manual = _clone_base()
    input_schema = description_manual["input_schema"]
    assert isinstance(input_schema, dict)
    input_properties = input_schema["properties"]
    assert isinstance(input_properties, dict)
    query = input_properties["query"]
    assert isinstance(query, dict)
    query["description"] = 123

    description_report = score_tool_manual_offline(description_manual)

    assert description_report.overall_score <= 95
    assert any(issue.field == "input_schema.properties.query" for issue in description_report.issues)

    output_manual = _clone_base()
    output_schema = output_manual["output_schema"]
    assert isinstance(output_schema, dict)
    output_schema["properties"] = []

    output_report = score_tool_manual_offline(output_manual)

    assert output_report.overall_score <= 90
    assert any(issue.field == "output_schema.properties" for issue in output_report.issues)

    summary_manual = _clone_base()
    summary_manual["summary_for_model"] = 123

    summary_report = score_tool_manual_offline(summary_manual)

    assert summary_report.overall_score <= 90
    assert any(issue.field == "summary_for_model" for issue in summary_report.issues)

    input_manual = _clone_base()
    input_manual["input_schema"] = []

    input_report = score_tool_manual_offline(input_manual)

    assert input_report.overall_score <= 80
    assert any(issue.field == "input_schema" for issue in input_report.issues)

    hints_manual = _clone_base()
    hints_manual["usage_hints"] = "not-a-list"

    hints_report = score_tool_manual_offline(hints_manual)

    assert hints_report.overall_score <= 95
    assert any(issue.field == "usage_hints" for issue in hints_report.issues)


@pytest.mark.parametrize(
    ("field_name", "bad_item"),
    [
        ("usage_hints", 123),
        ("result_hints", {"bad": True}),
        ("error_hints", 456),
    ],
)
def test_score_tool_manual_offline_penalizes_non_string_hint_items(
    field_name: str,
    bad_item: object,
) -> None:
    manual = _clone_base()
    manual[field_name] = [bad_item]

    report = score_tool_manual_offline(manual)

    assert report.overall_score == 90
    assert report.publishable is False
    assert any(
        issue.field == f"{field_name}[0]" and issue.severity == "critical"
        for issue in report.issues
    )
