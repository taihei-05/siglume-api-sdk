"""Generate or repair a ToolManual with the bundled LLM providers."""
from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk import (  # noqa: E402
    AnthropicProvider,
    OpenAIProvider,
    draft_tool_manual,
    fill_tool_manual_gaps,
)


def build_partial_manual() -> dict[str, Any]:
    return {
        "tool_name": "currency_converter_jp",
        "job_to_be_done": "Convert USD amounts to JPY with live rates for quoting and reporting tasks.",
        "permission_class": "read_only",
        "dry_run_supported": True,
        "requires_connected_accounts": [],
        "input_schema": {
            "type": "object",
            "properties": {
                "amount_usd": {"type": "number", "description": "USD amount to convert."},
            },
            "required": ["amount_usd"],
            "additionalProperties": False,
        },
        "output_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line summary of the converted amount."},
                "amount_jpy": {"type": "number", "description": "Converted amount in JPY."},
            },
            "required": ["summary", "amount_jpy"],
            "additionalProperties": False,
        },
    }


def _serialize(value: Any) -> Any:
    if is_dataclass(value):
        return {key: _serialize(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {key: _serialize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_serialize(item) for item in value]
    return value


def build_provider():
    if os.environ.get("ANTHROPIC_API_KEY"):
        return AnthropicProvider()
    if os.environ.get("OPENAI_API_KEY"):
        return OpenAIProvider()
    raise SystemExit("Set ANTHROPIC_API_KEY or OPENAI_API_KEY before running this example.")


def main() -> None:
    provider = build_provider()

    draft = draft_tool_manual(
        capability_key="currency-converter-jp",
        job_to_be_done="Convert USD amounts to JPY with live rates",
        permission_class="read_only",
        llm=provider,
    )
    print("=== full draft ===")
    print(json.dumps(_serialize(draft), indent=2, ensure_ascii=False))

    filled = fill_tool_manual_gaps(
        partial_manual=build_partial_manual(),
        source_code_hint="""
def convert(amount_usd: float) -> dict[str, object]:
    # returns live USD/JPY conversion data for quoting tasks
    return {"summary": "...", "amount_jpy": 1512.0}
""".strip(),
        llm=provider,
    )
    print("=== gap filler ===")
    print(json.dumps(_serialize(filled), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
