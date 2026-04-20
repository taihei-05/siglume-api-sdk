"""Example: read an owner's market-need backlog for triage.

API: first-party market.needs.* typed wrappers over the owner-operation surface.
Intended user: owners or orchestration builders who triage demand before proposal work starts.
Connected account: none.
"""
from __future__ import annotations

import json
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


DEMO_AGENT_ID = "agt_owner_demo"


class MarketNeedsWrapperApp(AppAdapter):
    def __init__(self, client: SiglumeClient | None = None) -> None:
        self.client = client or build_mock_client()

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="market-needs-wrapper",
            name="Market Needs Wrapper",
            job_to_be_done="Load the owner's open market needs so a downstream workflow can triage demand before writing proposals.",
            category=AppCategory.OTHER,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Reads typed market needs from the owner-operation surface without creating or updating any need.",
            example_prompts=["Show the top open market needs before drafting a seller proposal."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        focus = str((ctx.input_params or {}).get("focus") or "translation coverage triage")
        page = self.client.list_market_needs(agent_id=DEMO_AGENT_ID, status="open", limit=2)
        items = page.items
        first = self.client.get_market_need(items[0].need_id, agent_id=DEMO_AGENT_ID) if items else None
        summary = (
            f"Loaded {len(items)} open market needs for {focus}; "
            f"first need: {first.title if first and first.title else 'n/a'}."
        )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": summary,
                "focus": focus,
                "need_ids": [item.need_id for item in items],
                "titles": [item.title for item in items if item.title],
                "first_need": {
                    "need_id": first.need_id if first else None,
                    "title": first.title if first else None,
                    "category_key": first.category_key if first else None,
                    "budget_max_minor": first.budget_max_minor if first else None,
                    "status": first.status if first else None,
                },
            },
        )

    def supported_task_types(self) -> list[str]:
        return ["review_market_needs"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="market_needs_wrapper",
        job_to_be_done="Read the owner's typed market-need backlog so a downstream workflow can prioritize unmet demand before writing proposals.",
        summary_for_model="Lists open market needs and hydrates the first need detail through Siglume's first-party owner-operation surface without mutating any need.",
        trigger_conditions=[
            "agent should inspect open market demand before drafting a proposal, pitch, or seller recommendation",
            "workflow needs the owner's current backlog of needs, budgets, and categories without changing any stored state",
            "request is to triage or summarize needs only, not to create, edit, or close a market need",
        ],
        do_not_use_when=[
            "the owner is asking to create or update a market need instead of reading the current backlog",
            "workflow already has the exact need id and only needs a seller-side proposal mutation rather than a read-only backlog snapshot",
        ],
        permission_class=ToolManualPermissionClass.READ_ONLY,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": "Short reason for loading the need backlog, echoed back in the summary.",
                    "default": "translation coverage triage",
                }
            },
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line summary of the market-need triage read."},
                "focus": {"type": "string", "description": "Reason the backlog snapshot was loaded."},
                "need_ids": {"type": "array", "items": {"type": "string"}},
                "titles": {"type": "array", "items": {"type": "string"}},
                "first_need": {"type": "object", "description": "Hydrated detail for the first open need."},
            },
            "required": ["summary", "focus", "need_ids", "titles", "first_need"],
            "additionalProperties": False,
        },
        usage_hints=["Use this before seller matching or proposal drafting when the workflow should start from the owner's open demand backlog."],
        result_hints=["Report the number of open needs, then name the first need title, category, and budget range explicitly."],
        error_hints=["If the owner-operation surface is unavailable, explain that market needs could not be loaded and avoid fabricating demand details."],
        jurisdiction="US",
    )


def build_mock_client() -> SiglumeClient:
    need_one = {
        "need_id": "need_demo_1",
        "owner_user_id": "usr_owner_demo",
        "principal_user_id": "usr_owner_demo",
        "buyer_agent_id": DEMO_AGENT_ID,
        "charter_id": "chr_owner_demo",
        "charter_version": 3,
        "title": "Localize release notes into Japanese",
        "problem_statement": "We publish English release notes first and need a reviewable Japanese translation within 24 hours.",
        "category_key": "translation",
        "budget_min_minor": 8000,
        "budget_max_minor": 15000,
        "urgency": 7,
        "requirement_jsonb": {"languages": ["en", "ja"], "sla_hours": 24},
        "status": "open",
        "metadata": {"source": "owner-dashboard"},
        "detected_at": "2026-04-20T08:00:00Z",
        "created_at": "2026-04-20T08:00:00Z",
        "updated_at": "2026-04-20T08:10:00Z",
    }
    need_two = {
        "need_id": "need_demo_2",
        "owner_user_id": "usr_owner_demo",
        "principal_user_id": "usr_owner_demo",
        "buyer_agent_id": DEMO_AGENT_ID,
        "charter_id": "chr_owner_demo",
        "charter_version": 3,
        "title": "Summarize partner invoices",
        "problem_statement": "We need a monthly invoice summary with anomalies highlighted before the finance review.",
        "category_key": "finance",
        "budget_min_minor": 6000,
        "budget_max_minor": 12000,
        "urgency": 5,
        "requirement_jsonb": {"period": "monthly"},
        "status": "open",
        "metadata": {"source": "owner-dashboard"},
        "detected_at": "2026-04-19T21:00:00Z",
        "created_at": "2026-04-19T21:00:00Z",
        "updated_at": "2026-04-20T07:00:00Z",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != f"/v1/owner/agents/{DEMO_AGENT_ID}/operations/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        payload = json.loads(request.content.decode("utf-8")) if request.content else {}
        operation = payload.get("operation")
        params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
        if operation == "market.needs.list":
            assert params.get("status") == "open"
            assert params.get("limit") == 2
            return httpx.Response(
                200,
                json={
                    "data": {
                        "agent_id": DEMO_AGENT_ID,
                        "message": "Market needs loaded.",
                        "action": "market_needs_list",
                        "result": {"items": [need_one, need_two], "next_cursor": None},
                    },
                    "meta": {"trace_id": "trc_market_needs_list", "request_id": "req_market_needs_list"},
                    "error": None,
                },
            )
        if operation == "market.needs.get":
            assert params.get("need_id") == "need_demo_1"
            return httpx.Response(
                200,
                json={
                    "data": {
                        "agent_id": DEMO_AGENT_ID,
                        "message": "Market need loaded.",
                        "action": "market_needs_get",
                        "result": need_one,
                    },
                    "meta": {"trace_id": "trc_market_need_get", "request_id": "req_market_need_get"},
                    "error": None,
                },
            )
        raise AssertionError(f"Unexpected operation payload: {payload}")

    return SiglumeClient(
        api_key="sig_mock_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


async def run_market_needs_example() -> list[str]:
    app = MarketNeedsWrapperApp(build_mock_client())
    harness = AppTestHarness(app)
    manual = build_tool_manual()
    ok, issues = validate_tool_manual(manual)
    report = score_tool_manual_offline(manual)
    dry_run = await harness.dry_run(
        task_type="review_market_needs",
        input_params={"focus": "translation coverage triage"},
    )
    titles = dry_run.output.get("titles", []) if isinstance(dry_run.output, dict) else []
    return [
        f"tool_manual_valid: {ok} {len(issues)}",
        f"quality_grade: {report.grade} {report.overall_score}",
        f"needs_loaded: {len(dry_run.output.get('need_ids', [])) if isinstance(dry_run.output, dict) else 0} first=need_demo_1",
        f"titles: {'|'.join(str(item) for item in titles)}",
        f"dry_run: {dry_run.success}",
        f"summary: {dry_run.output.get('summary', '')}",
    ]


def main() -> None:
    import asyncio

    for line in asyncio.run(run_market_needs_example()):
        print(line)


if __name__ == "__main__":
    main()
