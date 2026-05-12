from __future__ import annotations

from typing import Any

from siglume_api_sdk import score_tool_manual_offline, validate_tool_manual


def _valid_manual() -> dict[str, Any]:
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


def test_valid_tool_manual_scores_a_and_is_publishable() -> None:
    report = score_tool_manual_offline(_valid_manual())

    assert report.validation_ok is True
    assert report.grade == "A"
    assert report.publishable is True


def test_missing_required_field_produces_blocking_issue() -> None:
    manual = _valid_manual()
    manual.pop("usage_hints")

    ok, issues = validate_tool_manual(manual)

    assert ok is False
    assert any(
        issue.code == "MISSING_FIELD" and issue.field == "usage_hints" and issue.severity == "error"
        for issue in issues
    )


def test_invalid_root_scores_f_and_is_not_publishable() -> None:
    report = score_tool_manual_offline("not-a-manual")

    assert report.grade == "F"
    assert report.publishable is False
    assert any(issue.code == "INVALID_ROOT" for issue in report.validation_errors)


def test_too_few_triggers_fail_validation() -> None:
    manual = _valid_manual()
    manual["trigger_conditions"] = ["owner asks to compare prices"]

    ok, issues = validate_tool_manual(manual)

    assert ok is False
    assert any(issue.code == "TOO_FEW_ITEMS" and issue.field == "trigger_conditions" for issue in issues)


def test_forbidden_input_schema_keywords_fail_validation() -> None:
    manual = _valid_manual()
    manual["input_schema"] = {
        "type": "object",
        "patternProperties": {"^x-": {"type": "string"}},
        "properties": {},
        "additionalProperties": False,
    }

    ok, issues = validate_tool_manual(manual)

    assert ok is False
    assert any(issue.code == "INPUT_SCHEMA" and issue.field == "input_schema.patternProperties" for issue in issues)
