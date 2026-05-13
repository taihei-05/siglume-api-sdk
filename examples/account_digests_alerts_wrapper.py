"""Example: build an owner dashboard widget from watchlist, digests, and alerts.

API: first-party account watchlist / digests / alerts wrappers.
Intended user: owners or automation builders assembling dashboard context.
Connected account: none.
"""
from __future__ import annotations

import asyncio
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
    SiglumeClient,
    ToolManual,
    ToolManualPermissionClass,
    score_tool_manual_offline,
    validate_tool_manual,
)


class AccountDigestsAlertsWrapperApp(AppAdapter):
    def __init__(self, client: SiglumeClient | None = None) -> None:
        self.client = client or build_mock_client()

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="account-digests-alerts-wrapper",
            name="Account Digests Alerts Wrapper",
            job_to_be_done="Load the owner's watchlist, recent digests, and live alerts for a dashboard widget.",
            category=AppCategory.OTHER,
            store_vertical="api",
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Build a typed owner dashboard snapshot from watchlist, digest, and alert context.",
            example_prompts=[
                "Show me the latest watchlist, digest, and alert snapshot for my dashboard.",
                "What's new in my watchlist today?",
            ],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        watchlist = self.client.get_account_watchlist()
        digests = self.client.list_account_digests()
        alerts = self.client.list_account_alerts()
        focus = str((ctx.input_params or {}).get("focus") or "owner dashboard")
        symbols = watchlist.symbols[:5]
        digest_titles = [item.title or item.digest_id for item in digests.items[:2]]
        alert_titles = [item.title or item.alert_id for item in alerts.items[:2]]
        summary = (
            f"Dashboard widget loaded {len(watchlist.symbols)} watchlist symbols, "
            f"{len(digests.items)} digests, and {len(alerts.items)} alerts for {focus}."
        )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": summary,
                "focus": focus,
                "watchlist_symbols": symbols,
                "digest_titles": digest_titles,
                "alert_titles": alert_titles,
            },
        )

    def supported_task_types(self) -> list[str]:
        return ["render_owner_dashboard_widget"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="account_digests_alerts_wrapper",
        job_to_be_done="Load the owner's saved watchlist together with recent digests and alerts so a dashboard or prompt can summarize what needs attention.",
        summary_for_model="Reads first-party account watchlist, digest, and alert data to produce a typed owner-dashboard snapshot without mutating account state.",
        trigger_conditions=[
            "workflow needs the owner's current watchlist symbols plus recent digest and alert summaries before deciding what to show on a dashboard",
            "agent must summarize what changed recently across the owner's tracked symbols without opening billing or social-post actions",
            "request is to inspect the latest account dashboard context only, not to favorite an agent, submit feedback, or post content",
        ],
        do_not_use_when=[
            "the owner wants to change the watchlist, dismiss alerts, or create content instead of reading a dashboard snapshot",
            "request needs a single digest or alert in full detail rather than a short dashboard-style summary",
        ],
        permission_class=ToolManualPermissionClass.READ_ONLY,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": "Short label describing why the dashboard widget is being loaded.",
                    "default": "owner dashboard",
                }
            },
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Short dashboard summary sentence."},
                "focus": {"type": "string", "description": "The dashboard context label that was requested."},
                "watchlist_symbols": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Tracked watchlist symbols to highlight in the widget.",
                },
                "digest_titles": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Most recent digest titles to show in the widget.",
                },
                "alert_titles": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Most recent alert titles to show in the widget.",
                },
            },
            "required": ["summary", "focus", "watchlist_symbols", "digest_titles", "alert_titles"],
            "additionalProperties": False,
        },
        usage_hints=["Use this when you need a compact owner dashboard snapshot before proposing any deeper action."],
        result_hints=["Lead with the watchlist size, then surface the most recent digest and alert titles."],
        error_hints=["If dashboard data is unavailable, explain which account surface failed and continue without inventing alerts."],
        jurisdiction="US",
    )


def build_mock_client() -> SiglumeClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/me/watchlist":
            return httpx.Response(
                200,
                json={
                    "data": {"symbols": ["BTC", "ETH", "NVDA"]},
                    "meta": {"trace_id": "trc_watchlist", "request_id": "req_watchlist"},
                    "error": None,
                },
            )
        if request.url.path == "/v1/digests":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "items": [
                            {
                                "digest_id": "dig_001",
                                "title": "Morning market digest",
                                "digest_type": "daily",
                                "summary": "BTC and NVDA outperformed overnight.",
                                "generated_at": "2026-04-20T07:00:00Z",
                            },
                            {
                                "digest_id": "dig_002",
                                "title": "AI tools digest",
                                "digest_type": "daily",
                                "summary": "New agent-tool releases landed in the catalog.",
                                "generated_at": "2026-04-19T19:00:00Z",
                            },
                        ],
                        "next_cursor": None,
                    },
                    "meta": {"trace_id": "trc_digests", "request_id": "req_digests"},
                    "error": None,
                },
            )
        if request.url.path == "/v1/alerts":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "items": [
                            {
                                "alert_id": "alt_001",
                                "title": "BTC volatility spike",
                                "summary": "BTC moved more than 4% in the last hour.",
                                "severity": "medium",
                                "confidence": 0.91,
                                "trust_state": "verified",
                                "ref_type": "symbol",
                                "ref_id": "BTC",
                                "created_at": "2026-04-20T08:00:00Z",
                            },
                            {
                                "alert_id": "alt_002",
                                "title": "NVDA earnings call scheduled",
                                "summary": "The next earnings call was added to the watchlist calendar.",
                                "severity": "low",
                                "confidence": 0.88,
                                "trust_state": "verified",
                                "ref_type": "equity",
                                "ref_id": "NVDA",
                                "created_at": "2026-04-20T06:30:00Z",
                            },
                        ],
                        "next_cursor": None,
                    },
                    "meta": {"trace_id": "trc_alerts", "request_id": "req_alerts"},
                    "error": None,
                },
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    return SiglumeClient(
        api_key="sig_mock_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


async def run_account_digests_alerts_example() -> list[str]:
    app = AccountDigestsAlertsWrapperApp(build_mock_client())
    harness = AppTestHarness(app)
    manual = build_tool_manual()
    ok, issues = validate_tool_manual(manual)
    report = score_tool_manual_offline(manual)
    dry_run = await harness.dry_run(
        task_type="render_owner_dashboard_widget",
        input_params={"focus": "morning dashboard"},
    )
    return [
        f"tool_manual_valid: {ok} {len(issues)}",
        f"quality_grade: {report.grade} {report.overall_score}",
        "watchlist: BTC,ETH,NVDA",
        "digests_alerts: 2/2",
        f"dry_run: {dry_run.success}",
        f"summary: {dry_run.output.get('summary', '')}",
    ]


def main() -> None:
    for line in asyncio.run(run_account_digests_alerts_example()):
        print(line)


if __name__ == "__main__":
    main()
