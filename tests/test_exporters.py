from __future__ import annotations

import json
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk import (  # noqa: E402
    ToolSchemaExport,
    to_anthropic_tool,
    to_mcp_tool,
    to_openai_function,
    to_openai_responses_tool,
)
from siglume_api_sdk.exporters import (  # noqa: E402
    to_anthropic_tool as module_anthropic_tool,
    to_mcp_tool as module_mcp_tool,
    to_openai_function as module_openai_function,
    to_openai_responses_tool as module_openai_responses_tool,
)


FIXTURE_PATH = ROOT / "tests" / "fixtures" / "exporter_cases.json"
CASES = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
EXPORTERS = {
    "anthropic": to_anthropic_tool,
    "openai_function": to_openai_function,
    "openai_responses_tool": to_openai_responses_tool,
    "mcp": to_mcp_tool,
}


@pytest.mark.parametrize(
    ("case", "provider"),
    [(case, provider) for case in CASES for provider in EXPORTERS],
    ids=[
        f"{case['name']}-{provider}"
        for case in CASES
        for provider in EXPORTERS
    ],
)
def test_exporter_outputs_match_golden_fixtures(case: dict[str, object], provider: str) -> None:
    exporter = EXPORTERS[provider]

    result = exporter(case["tool_manual"])

    assert isinstance(result, ToolSchemaExport)
    assert result.to_dict() == case["expected"][provider]


@pytest.mark.parametrize(
    ("exporter", "label"),
    [
        (to_anthropic_tool, "anthropic"),
        (to_openai_function, "openai_function"),
        (to_openai_responses_tool, "openai_responses_tool"),
        (to_mcp_tool, "mcp"),
    ],
    ids=["anthropic", "openai-function", "openai-responses", "mcp"],
)
def test_exporters_reject_non_mapping_inputs(exporter, label: str) -> None:
    with pytest.raises(TypeError, match="tool_manual must be a mapping-like object"):
        exporter(["not", "a", "tool", label])


def test_root_exports_match_module_exports() -> None:
    assert to_anthropic_tool is module_anthropic_tool
    assert to_openai_function is module_openai_function
    assert to_openai_responses_tool is module_openai_responses_tool
    assert to_mcp_tool is module_mcp_tool


@pytest.mark.parametrize(
    "exporter",
    [to_anthropic_tool, to_openai_function, to_openai_responses_tool, to_mcp_tool],
    ids=["anthropic", "openai-function", "openai-responses", "mcp"],
)
def test_exporters_require_non_empty_tool_name(exporter) -> None:
    with pytest.raises(ValueError, match="tool_manual.tool_name must be a non-empty string"):
        exporter(
            {
                "summary_for_model": "Missing tool_name should fail consistently.",
                "input_schema": {"type": "object"},
                "output_schema": {"type": "object"},
            }
        )


def test_mcp_exporter_preserves_output_schema() -> None:
    case = next(item for item in CASES if item["name"] == "payment_wallet_charge")

    exported = to_mcp_tool(case["tool_manual"])

    assert "outputSchema" in exported.schema
    assert exported.schema["outputSchema"] == case["tool_manual"]["output_schema"]


def test_mcp_annotations_track_permission_and_idempotency() -> None:
    read_only_case = next(item for item in CASES if item["name"] == "read_only_price_lookup")
    payment_case = next(item for item in CASES if item["name"] == "payment_wallet_charge")

    read_only_export = to_mcp_tool(read_only_case["tool_manual"])
    payment_export = to_mcp_tool(payment_case["tool_manual"])

    assert read_only_export.schema["annotations"] == {
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
    }
    assert payment_export.schema["annotations"] == {
        "readOnlyHint": False,
        "destructiveHint": True,
        "idempotentHint": True,
    }


def test_openai_responses_export_uses_flat_function_tool_shape() -> None:
    # Codex bot P1 on PR #102: the OpenAI Responses API expects a flat
    # { type, name, description, parameters, strict } tool object, not the
    # Chat Completions { type, function: { ... } } envelope. The nested
    # form is rejected by client.responses.create(..., tools=[...]).
    case = next(item for item in CASES if item["name"] == "read_only_price_lookup")

    exported = to_openai_responses_tool(case["tool_manual"])

    assert exported.schema["type"] == "function"
    assert exported.schema["name"] == case["tool_manual"]["tool_name"]
    assert exported.schema["strict"] is True
    assert "description" in exported.schema
    assert "parameters" in exported.schema
    # The nested function envelope MUST be absent — that is the bug we fixed.
    assert "function" not in exported.schema
