from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk import SiglumeBuyerClient

try:  # pragma: no cover - optional dependency
    from langchain_core.tools import StructuredTool
except ImportError:  # pragma: no cover - optional dependency
    StructuredTool = None

try:  # pragma: no cover - optional dependency
    from pydantic import create_model
except ImportError:  # pragma: no cover - optional dependency
    create_model = None


class CompatTool:
    def __init__(self, name: str, description: str, args_schema: type[Any] | None, runner: Any) -> None:
        self.name = name
        self.description = description
        self.args_schema = args_schema
        self._runner = runner

    def invoke(self, payload: dict[str, Any]) -> Any:
        return self._runner(**payload)


def siglume_to_langchain_tool(buyer: SiglumeBuyerClient, capability_key: str) -> Any:
    listing = buyer.get_listing(capability_key)
    args_schema = _args_schema_from_json_schema(listing.tool_manual.get("input_schema", {}))

    def _run(**kwargs: Any) -> dict[str, Any]:
        return buyer.invoke(
            capability_key=capability_key,
            input=kwargs,
        ).output

    if StructuredTool is not None:
        return StructuredTool.from_function(
            func=lambda **kwargs: json.dumps(_run(**kwargs), ensure_ascii=False),
            name=str(listing.tool_manual.get("tool_name") or listing.capability_key),
            description=str(listing.tool_manual.get("summary_for_model") or listing.name),
            args_schema=args_schema,
        )
    return CompatTool(
        name=str(listing.tool_manual.get("tool_name") or listing.capability_key),
        description=str(listing.tool_manual.get("summary_for_model") or listing.name),
        args_schema=args_schema,
        runner=_run,
    )


def build_mock_buyer_client() -> SiglumeBuyerClient:
    listing = {
        "id": "lst_currency",
        "capability_key": "currency-converter-v2",
        "name": "Currency Converter",
        "description": "Convert USD amounts to JPY with live exchange rates and return a concise summary.",
        "job_to_be_done": "Convert currency amounts between USD and JPY.",
        "permission_class": "read-only",
        "approval_mode": "auto",
        "dry_run_supported": True,
        "price_model": "free",
        "price_value_minor": 0,
        "currency": "USD",
        "short_description": "Convert currency with live rates.",
        "status": "published",
        "input_schema": {
            "type": "object",
            "properties": {
                "amount_usd": {"type": "number", "description": "USD amount to convert."},
                "to": {"type": "string", "description": "Target currency code."},
            },
            "required": ["amount_usd", "to"],
            "additionalProperties": False,
        },
        "output_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line conversion summary."},
                "amount": {"type": "number", "description": "Converted amount."},
                "currency": {"type": "string", "description": "Target currency."},
            },
            "required": ["summary", "amount", "currency"],
            "additionalProperties": False,
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/capabilities":
            return httpx.Response(
                200,
                json={
                    "data": {"items": [listing], "next_cursor": None, "limit": 20, "offset": 0},
                    "meta": {"trace_id": "trc_buyer", "request_id": "req_buyer"},
                    "error": None,
                },
            )
        if request.url.path == "/v1/internal/market/capability/execute":
            payload = json.loads(request.content.decode("utf-8"))
            amount_usd = float(payload.get("arguments", {}).get("amount_usd", 0))
            target_currency = str(payload.get("arguments", {}).get("to", "JPY"))
            converted = round(amount_usd * 150.0, 2)
            return httpx.Response(
                200,
                json={
                    "data": {
                        "accepted": True,
                        "allowed": True,
                        "reason": "accepted",
                        "reason_code": None,
                        "usage_event": {"units_consumed": 1, "execution_kind": "action"},
                        "result": {
                            "summary": f"Converted USD {amount_usd:.2f} to {target_currency} {converted:.2f}.",
                            "amount": converted,
                            "currency": target_currency,
                        },
                        "receipt": {"execution_kind": "action", "currency": target_currency, "amount_minor": 0},
                    },
                    "meta": {"trace_id": "trc_exec", "request_id": "req_exec"},
                    "error": None,
                },
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    return SiglumeBuyerClient(
        api_key=os.environ.get("SIGLUME_API_KEY", "sig_mock_key"),
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
        default_agent_id=os.environ.get("SIGLUME_AGENT_ID", "agent_mock_demo"),
        allow_internal_execute=True,
    )


def main() -> None:
    buyer = build_mock_buyer_client()
    tool = siglume_to_langchain_tool(buyer, "currency-converter-v2")
    payload = {"amount_usd": 100, "to": "JPY"}
    if hasattr(tool, "invoke"):
        result = tool.invoke(payload)
    else:  # pragma: no cover - defensive
        result = tool.func(**payload)
    if isinstance(result, str):
        result = json.loads(result)
    print(f"tool_name: {tool.name}")
    print(f"description: {tool.description}")
    print(f"args_schema: {getattr(getattr(tool, 'args_schema', None), '__name__', 'dynamic')}")
    print(f"result_summary: {result['summary']}")
    print(f"result_currency: {result['currency']}")


def _args_schema_from_json_schema(schema: dict[str, Any]) -> type[Any] | None:
    if create_model is None:
        return None
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return None
    required = {
        str(item)
        for item in schema.get("required", [])
        if isinstance(item, str)
    }
    fields: dict[str, tuple[type[Any], Any]] = {}
    for name, definition in properties.items():
        if not isinstance(definition, dict):
            continue
        fields[name] = (_python_type(definition.get("type")), ... if name in required else None)
    if not fields:
        return None
    return create_model("SiglumeBuyerInput", **fields)


def _python_type(json_type: Any) -> type[Any]:
    normalized = str(json_type or "").strip().lower()
    if normalized == "integer":
        return int
    if normalized == "number":
        return float
    if normalized == "boolean":
        return bool
    return str


if __name__ == "__main__":
    main()
