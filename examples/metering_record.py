"""API: record usage events for analytics and future usage-based billing previews.
Intended user: sellers operating token/call-metered capabilities.
Connected account: none.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk import (  # noqa: E402
    AppAdapter,
    AppCategory,
    AppManifest,
    AppTestHarness,
    ApprovalMode,
    ExecutionContext,
    ExecutionResult,
    PermissionClass,
    PriceModel,
)
from siglume_api_sdk.metering import MeterClient, UsageRecord  # noqa: E402


EXPERIMENTAL_NOTE = (
    "usage_based / per_action remain planned price models on the public platform. "
    "Metering currently confirms receipt of events for analytics and future billing previews."
)


class TranslationHubMeteredApp(AppAdapter):
    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="translation-hub",
            name="Translation Hub",
            job_to_be_done="Translate text while previewing token-based usage metering.",
            category=AppCategory.COMMUNICATION,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.USAGE_BASED,
            price_value_minor=5,
            jurisdiction="US",
            short_description="Translate text and preview token-based usage line items.",
            example_prompts=["Translate this roadmap update into Japanese."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        text = str(ctx.input_params.get("text") or "hello world")
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={"summary": f"Translated {len(text.split())} tokens."},
        )


def build_mock_meter_client() -> MeterClient:
    stored_events = [
        {
            "id": "use_demo_001",
            "usage_event_id": "use_demo_001",
            "capability_key": "translation-hub",
            "agent_id": "agent_demo",
            "dimension": "tokens_in",
            "units_consumed": 1523,
            "external_id": "evt_usage_001",
            "occurred_at_iso": "2026-04-19T10:00:00Z",
            "period_key": "202604",
            "created_at": "2026-04-19T10:00:01Z",
            "metadata": {"source": "example"},
        },
        {
            "id": "use_demo_002",
            "usage_event_id": "use_demo_002",
            "capability_key": "translation-hub",
            "agent_id": "agent_demo",
            "dimension": "tokens_out",
            "units_consumed": 731,
            "external_id": "evt_usage_002",
            "occurred_at_iso": "2026-04-19T10:00:02Z",
            "period_key": "202604",
            "created_at": "2026-04-19T10:00:02Z",
            "metadata": {"source": "example"},
        },
        {
            "id": "use_demo_003",
            "usage_event_id": "use_demo_003",
            "capability_key": "translation-hub",
            "agent_id": "agent_demo",
            "dimension": "calls",
            "units_consumed": 1,
            "external_id": "evt_usage_003",
            "occurred_at_iso": "2026-04-19T10:00:03Z",
            "period_key": "202604",
            "created_at": "2026-04-19T10:00:03Z",
            "metadata": {"source": "example"},
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/usage-events" and request.method == "POST":
            payload = json.loads(request.content.decode("utf-8"))
            items = []
            for index, event in enumerate(payload["events"]):
                items.append(
                    {
                        "accepted": True,
                        "external_id": event["external_id"],
                        "server_id": f"use_demo_{index + 1:03d}",
                        "replayed": False,
                        "capability_key": event["capability_key"],
                        "agent_id": event.get("agent_id"),
                        "period_key": "202604",
                    }
                )
            return httpx.Response(
                202,
                json={"data": {"items": items, "count": len(items)}, "meta": {"trace_id": "trc_meter", "request_id": "req_meter"}, "error": None},
            )
        if request.url.path == "/v1/market/usage" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {"items": stored_events, "next_cursor": None, "limit": 50, "offset": 0},
                    "meta": {"trace_id": "trc_meter", "request_id": "req_meter"},
                    "error": None,
                },
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    return MeterClient(
        api_key=os.environ.get("SIGLUME_API_KEY", "sig_mock_key"),
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


def run_metering_example() -> list[str]:
    harness = AppTestHarness(TranslationHubMeteredApp())
    preview = harness.simulate_metering(
        UsageRecord(
            capability_key="translation-hub",
            dimension="tokens_in",
            units=1523,
            external_id="evt_usage_001",
            occurred_at_iso="2026-04-19T10:00:00Z",
            agent_id="agent_demo",
        )
    )

    with build_mock_meter_client() as client:
        recorded = client.record(preview["usage_record"])
        batched = client.record_batch(
            [
                UsageRecord(
                    capability_key="translation-hub",
                    dimension="tokens_out",
                    units=731,
                    external_id="evt_usage_002",
                    occurred_at_iso="2026-04-19T10:00:02Z",
                    agent_id="agent_demo",
                ),
                UsageRecord(
                    capability_key="translation-hub",
                    dimension="calls",
                    units=1,
                    external_id="evt_usage_003",
                    occurred_at_iso="2026-04-19T10:00:03Z",
                    agent_id="agent_demo",
                ),
            ]
        )
        listed = client.list_usage_events(capability_key="translation-hub", period_key="202604")

    dimensions = ",".join(item.dimension or "" for item in listed.items)
    return [
        f"experimental_note: {EXPERIMENTAL_NOTE}",
        f"record_status: accepted={recorded.accepted} replayed={recorded.replayed} external_id={recorded.external_id}",
        f"batch_items: {len(batched)} last_period={batched[-1].period_key}",
        f"preview_subtotal_minor: {preview['invoice_line_preview']['subtotal_minor']}",
        f"usage_dimensions: {dimensions}",
    ]


def main() -> None:
    for line in run_metering_example():
        print(line)


if __name__ == "__main__":
    main()
