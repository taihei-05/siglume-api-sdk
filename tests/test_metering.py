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
    AppAdapter,
    AppCategory,
    AppManifest,
    AppTestHarness,
    ApprovalMode,
    ExecutionContext,
    ExecutionKind,
    ExecutionResult,
    MeterClient,
    PermissionClass,
    PriceModel,
    SiglumeClientError,
    UsageRecord,
)


def envelope(data, *, trace_id: str = "trc_meter", request_id: str = "req_meter") -> dict[str, object]:
    return {
        "data": data,
        "meta": {"request_id": request_id, "trace_id": trace_id},
        "error": None,
    }


class MeteredApp(AppAdapter):
    def __init__(self, price_model: PriceModel) -> None:
        self._price_model = price_model

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="translation-hub",
            name="Translation Hub",
            job_to_be_done="Translate text and report usage for analytics or future usage-based billing.",
            category=AppCategory.COMMUNICATION,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=self._price_model,
            price_value_minor=5,
            jurisdiction="US",
            short_description="Translate text while previewing future metering line items.",
            example_prompts=["Translate this release note into Japanese."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={"summary": "translated"},
        )


def build_meter_client(handler) -> MeterClient:
    return MeterClient(
        api_key="sig_test_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


def test_meter_client_records_single_usage_event() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/market/usage-events"
        body = json.loads(request.content.decode("utf-8"))
        assert body["events"][0]["dimension"] == "tokens_in"
        return httpx.Response(
            202,
            json=envelope(
                {
                    "items": [
                        {
                            "accepted": True,
                            "external_id": "evt_usage_001",
                            "server_id": "use_001",
                            "replayed": False,
                            "capability_key": "translation-hub",
                            "agent_id": "agent_demo",
                            "period_key": "202604",
                        }
                    ],
                    "count": 1,
                }
            ),
        )

    with build_meter_client(handler) as client:
        result = client.record(
            UsageRecord(
                capability_key="translation-hub",
                dimension="tokens_in",
                units=1523,
                external_id="evt_usage_001",
                occurred_at_iso="2026-04-19T10:00:00Z",
                agent_id="agent_demo",
            )
        )

    assert result.accepted is True
    assert result.server_id == "use_001"
    assert result.period_key == "202604"


def test_meter_client_chunks_large_batches() -> None:
    batch_sizes: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        batch_sizes.append(len(body["events"]))
        items = [
            {
                "accepted": True,
                "external_id": event["external_id"],
                "server_id": f"use_{index}",
                "replayed": False,
                "capability_key": event["capability_key"],
                "agent_id": event.get("agent_id"),
                "period_key": "202604",
            }
            for index, event in enumerate(body["events"])
        ]
        return httpx.Response(202, json=envelope({"items": items, "count": len(items)}))

    records = [
        UsageRecord(
            capability_key="translation-hub",
            dimension="calls",
            units=1,
            external_id=f"evt_batch_{index}",
            occurred_at_iso="2026-04-19T10:00:00Z",
        )
        for index in range(1001)
    ]

    with build_meter_client(handler) as client:
        results = client.record_batch(records)

    assert batch_sizes == [1000, 1]
    assert len(results) == 1001
    assert results[-1].external_id == "evt_batch_1000"


@pytest.mark.parametrize(
    ("record", "message"),
    [
        (
            UsageRecord(
                capability_key="translation-hub",
                dimension="tokens_in",
                units=-1,
                external_id="evt_bad_units",
                occurred_at_iso="2026-04-19T10:00:00Z",
            ),
            "UsageRecord.units must be a non-negative integer.",
        ),
        (
            UsageRecord(
                capability_key="translation-hub",
                dimension="tokens_in",
                units=1,
                external_id="",
                occurred_at_iso="2026-04-19T10:00:00Z",
            ),
            "UsageRecord.external_id is required.",
        ),
        (
            UsageRecord(
                capability_key="translation-hub",
                dimension="tokens_in",
                units=1,
                external_id="evt_bad_time",
                occurred_at_iso="2026-04-19 10:00:00",
            ),
            "UsageRecord.occurred_at_iso must be RFC3339 with timezone.",
        ),
    ],
)
def test_meter_client_validates_usage_records_client_side(record: UsageRecord, message: str) -> None:
    with build_meter_client(lambda request: httpx.Response(500, json={"error": {"code": "UNUSED", "message": "unused"}})) as client:
        with pytest.raises(SiglumeClientError, match=message):
            client.record(record)


def test_meter_client_lists_usage_events_with_extended_fields() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/market/usage"
        return httpx.Response(
            200,
            json=envelope(
                {
                    "items": [
                        {
                            "id": "use_123",
                            "capability_key": "translation-hub",
                            "agent_id": "agent_demo",
                            "dimension": "tokens_out",
                            "units_consumed": 240,
                            "external_id": "evt_usage_123",
                            "occurred_at_iso": "2026-04-19T10:05:00Z",
                            "period_key": "202604",
                            "created_at": "2026-04-19T10:05:01Z",
                            "metadata": {"source": "test"},
                        }
                    ],
                    "next_cursor": None,
                    "limit": 50,
                    "offset": 0,
                }
            ),
        )

    with build_meter_client(handler) as client:
        page = client.list_usage_events(capability_key="translation-hub", period_key="202604")

    assert page.items[0].dimension == "tokens_out"
    assert page.items[0].external_id == "evt_usage_123"
    assert page.items[0].occurred_at_iso == "2026-04-19T10:05:00Z"


def test_meter_client_raises_typed_error_for_empty_single_record_results() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/market/usage-events"
        return httpx.Response(202, json=envelope({"items": [], "count": 0}))

    with build_meter_client(handler) as client:
        with pytest.raises(SiglumeClientError, match="did not include any results"):
            client.record(
                UsageRecord(
                    capability_key="translation-hub",
                    dimension="calls",
                    units=1,
                    external_id="evt_usage_empty",
                    occurred_at_iso="2026-04-19T10:00:00Z",
                )
            )


def test_app_test_harness_simulates_usage_based_metering() -> None:
    harness = AppTestHarness(MeteredApp(PriceModel.USAGE_BASED))

    preview = harness.simulate_metering(
        UsageRecord(
            capability_key="translation-hub",
            dimension="tokens_in",
            units=1523,
            external_id="evt_usage_001",
            occurred_at_iso="2026-04-19T10:00:00Z",
        )
    )

    assert preview["experimental"] is True
    assert preview["invoice_line_preview"]["subtotal_minor"] == 7615
    assert preview["invoice_line_preview"]["billable_units"] == 1523


def test_app_test_harness_simulates_per_action_metering() -> None:
    harness = AppTestHarness(MeteredApp(PriceModel.PER_ACTION))
    execution = ExecutionResult(success=True, execution_kind=ExecutionKind.ACTION, output={"summary": "done"})

    preview = harness.simulate_metering(
        UsageRecord(
            capability_key="translation-hub",
            dimension="calls",
            units=99,
            external_id="evt_usage_002",
            occurred_at_iso="2026-04-19T10:00:00Z",
        ),
        execution_result=execution,
    )

    assert preview["invoice_line_preview"]["billable_units"] == 1
    assert preview["invoice_line_preview"]["subtotal_minor"] == 5


def test_app_test_harness_returns_no_invoice_preview_for_non_metered_models() -> None:
    harness = AppTestHarness(MeteredApp(PriceModel.SUBSCRIPTION))

    preview = harness.simulate_metering(
        UsageRecord(
            capability_key="translation-hub",
            dimension="calls",
            units=1,
            external_id="evt_usage_003",
            occurred_at_iso="2026-04-19T10:00:00Z",
        )
    )

    assert preview["experimental"] is False
    assert preview["invoice_line_preview"] is None
