"""Example: inspect ads billing, profile, campaigns, and recent campaign posts.

API: first-party ads.* typed wrappers over the owner-operation surface.
Intended user: operators who review billing readiness and current campaign
performance without mutating ads state.
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


class AdsCampaignWrapperApp(AppAdapter):
    def __init__(self, client: SiglumeClient | None = None) -> None:
        self.client = client or build_mock_client()

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="ads-campaign-wrapper",
            name="Ads Campaign Wrapper",
            job_to_be_done="Load ads billing and campaign context so an operator can review pacing and billing readiness without mutating campaigns.",
            category=AppCategory.MONITORING,
            store_vertical="api",
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            currency="USD",
            jurisdiction="US",
            short_description="Reads ads billing, profile, campaigns, and recent posts from the owner-operation surface.",
            example_prompts=[
                "Show the current ads billing mode and recent campaign activity.",
                "Summarize how my campaigns have been pacing this week.",
            ],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        focus = str((ctx.input_params or {}).get("focus") or "campaign pacing review")
        billing = self.client.get_ads_billing(agent_id=DEMO_AGENT_ID, rail="web3")
        profile = self.client.get_ads_profile(agent_id=DEMO_AGENT_ID)
        campaigns = self.client.list_ads_campaigns(agent_id=DEMO_AGENT_ID)
        first_campaign = campaigns[0] if campaigns else None
        posts = (
            self.client.list_ads_campaign_posts(first_campaign.campaign_id, agent_id=DEMO_AGENT_ID)
            if first_campaign
            else []
        )
        summary = (
            f"Loaded {len(campaigns)} ads campaigns for {focus}; "
            f"billing mode {billing.billing_mode or 'unknown'} with {len(posts)} recent posts "
            f"for the first campaign."
        )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": summary,
                "focus": focus,
                "billing_mode": billing.billing_mode,
                "billing_currency": billing.currency,
                "has_profile": profile.has_profile,
                "campaign_ids": [item.campaign_id for item in campaigns],
                "first_campaign_posts": [item.post_id for item in posts if item.post_id],
            },
        )

    def supported_task_types(self) -> list[str]:
        return ["review_ads_campaign_health"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="ads_campaign_wrapper",
        job_to_be_done="Read ads billing status, profile readiness, current campaigns, and recent posts for campaign-health review.",
        summary_for_model="Loads ads billing/profile/campaign reads through first-party owner-operation wrappers without mutating billing or campaign state.",
        trigger_conditions=[
            "operator wants the current ads billing mode before reviewing campaign pacing",
            "workflow needs campaign inventory and recent post ids without editing any campaign settings",
            "task is to inspect ads profile readiness and spend context only",
        ],
        do_not_use_when=[
            "the task is to activate ads billing, edit campaigns, or create a post instead of reading the current state",
            "the request is specifically about partner usage or partner ingest keys rather than ads campaign review",
        ],
        permission_class=ToolManualPermissionClass.READ_ONLY,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": "Short reason for loading the ads campaign snapshot.",
                    "default": "campaign pacing review",
                }
            },
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line ads review summary."},
                "focus": {"type": "string"},
                "billing_mode": {"type": "string"},
                "billing_currency": {"type": "string"},
                "has_profile": {"type": "boolean"},
                "campaign_ids": {"type": "array", "items": {"type": "string"}},
                "first_campaign_posts": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["summary", "focus", "billing_mode", "billing_currency", "has_profile", "campaign_ids", "first_campaign_posts"],
            "additionalProperties": False,
        },
        usage_hints=["Use this when an operator needs a read-only ads health snapshot before deciding whether to adjust billing or campaign settings."],
        result_hints=["Report the billing mode, profile readiness, campaign count, and whether the first campaign has recent posts."],
        error_hints=["If no campaigns exist yet, say so explicitly instead of inventing pacing metrics."],
        jurisdiction="US",
    )


def build_mock_client() -> SiglumeClient:
    billing = {
        "currency": "usd",
        "billing_mode": "web3",
        "month_spend_jpy": 0,
        "month_spend_usd": 12000,
        "all_time_spend_jpy": 0,
        "all_time_spend_usd": 54000,
        "total_impressions": 18300,
        "total_replies": 37,
        "has_billing": True,
        "has_subscription": True,
        "balances": [{"symbol": "USDC", "amount_minor": 700000}],
        "supported_tokens": [{"symbol": "USDC", "decimals": 6}],
        "wallet": {"user_wallet_id": "uw_ads_1", "smart_account_address": "0xabc"},
    }
    profile = {
        "has_profile": True,
        "company_name": "Demo Ads",
        "ad_currency": "usd",
        "has_billing": True,
    }
    campaigns = [
        {
            "campaign_id": "cmp_ads_1",
            "name": "Spring Launch",
            "target_url": "https://example.com/spring-launch",
            "content_brief": "Promote the launch announcement.",
            "target_topics": ["ai", "launch"],
            "posting_interval_minutes": 720,
            "max_posts_per_day": 2,
            "currency": "usd",
            "monthly_budget_jpy": 30000,
            "cpm_jpy": 250,
            "cpr_jpy": 30,
            "monthly_budget_usd": 30000,
            "cpm_usd": 250,
            "cpr_usd": 30,
            "status": "active",
            "month_spend_jpy": 0,
            "month_spend_usd": 12000,
            "total_posts": 4,
            "total_impressions": 18300,
            "total_replies": 37,
            "next_post_at": "2026-04-20T16:00:00Z",
            "created_at": "2026-04-19T09:00:00Z",
        },
        {
            "campaign_id": "cmp_ads_2",
            "name": "April Promotion",
            "target_url": "https://example.com/april-promo",
            "content_brief": "Promote the April offer.",
            "target_topics": ["promotion"],
            "posting_interval_minutes": 1440,
            "max_posts_per_day": 1,
            "currency": "usd",
            "monthly_budget_jpy": 30000,
            "cpm_jpy": 250,
            "cpr_jpy": 30,
            "monthly_budget_usd": 20000,
            "cpm_usd": 250,
            "cpr_usd": 30,
            "status": "paused",
            "month_spend_jpy": 0,
            "month_spend_usd": 0,
            "total_posts": 1,
            "total_impressions": 1200,
            "total_replies": 2,
            "next_post_at": None,
            "created_at": "2026-04-18T09:00:00Z",
        },
    ]
    posts = [
        {
            "post_id": "pst_ads_1",
            "content_id": "cnt_ads_1",
            "cost_jpy": 0,
            "cost_usd": 1200,
            "impressions": 5000,
            "replies": 11,
            "status": "served",
            "created_at": "2026-04-20T07:00:00Z",
        }
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != f"/v1/owner/agents/{DEMO_AGENT_ID}/operations/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        payload = json.loads(request.content.decode("utf-8")) if request.content else {}
        operation = payload.get("operation")
        params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
        if operation == "ads.billing.get":
            assert params == {"rail": "web3"}
            return httpx.Response(200, json={"data": {"agent_id": DEMO_AGENT_ID, "message": "Ads billing loaded.", "action": "ads_billing_get", "result": billing}, "meta": {"trace_id": "trc_ads_billing", "request_id": "req_ads_billing"}, "error": None})
        if operation == "ads.profile.get":
            return httpx.Response(200, json={"data": {"agent_id": DEMO_AGENT_ID, "message": "Ads profile loaded.", "action": "ads_profile_get", "result": profile}, "meta": {"trace_id": "trc_ads_profile", "request_id": "req_ads_profile"}, "error": None})
        if operation == "ads.campaigns.list":
            return httpx.Response(200, json={"data": {"agent_id": DEMO_AGENT_ID, "message": "Ad campaigns loaded.", "action": "ads_campaigns_list", "result": {"campaigns": campaigns}}, "meta": {"trace_id": "trc_ads_campaigns", "request_id": "req_ads_campaigns"}, "error": None})
        if operation == "ads.campaign_posts.list":
            assert params == {"campaign_id": "cmp_ads_1"}
            return httpx.Response(200, json={"data": {"agent_id": DEMO_AGENT_ID, "message": "Ad campaign posts loaded.", "action": "ads_campaign_posts_list", "result": {"posts": posts}}, "meta": {"trace_id": "trc_ads_posts", "request_id": "req_ads_posts"}, "error": None})
        raise AssertionError(f"Unexpected operation payload: {payload}")

    return SiglumeClient(
        api_key="sig_mock_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


async def run_ads_campaign_example() -> list[str]:
    app = AdsCampaignWrapperApp(build_mock_client())
    harness = AppTestHarness(app)
    manual = build_tool_manual()
    ok, issues = validate_tool_manual(manual)
    report = score_tool_manual_offline(manual)
    dry_run = await harness.dry_run(
        task_type="review_ads_campaign_health",
        input_params={"focus": "campaign pacing review"},
    )
    return [
        f"tool_manual_valid: {ok} {len(issues)}",
        f"quality_grade: {report.grade} {report.overall_score}",
        f"campaigns_loaded: {len(dry_run.output.get('campaign_ids', [])) if isinstance(dry_run.output, dict) else 0} first=cmp_ads_1",
        f"billing_profile: {dry_run.output.get('billing_mode', '') if isinstance(dry_run.output, dict) else ''}/{dry_run.output.get('billing_currency', '') if isinstance(dry_run.output, dict) else ''} profile={dry_run.output.get('has_profile', False) if isinstance(dry_run.output, dict) else False}",
        f"dry_run: {dry_run.success}",
        f"summary: {dry_run.output.get('summary', '') if isinstance(dry_run.output, dict) else ''}",
    ]


def main() -> None:
    import asyncio

    for line in asyncio.run(run_ads_campaign_example()):
        print(line)


if __name__ == "__main__":
    main()
