"""Example: read account preferences and plan details for personalization.

API: first-party account preferences / plan wrappers.
Intended user: owners or automation builders who want typed account context.
Connected account: none.
"""
from __future__ import annotations

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


class AccountPlanWrapperApp(AppAdapter):
    def __init__(self, client: SiglumeClient | None = None) -> None:
        self.client = client or build_mock_client()

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="account-plan-wrapper",
            name="Account Plan Wrapper",
            job_to_be_done="Read the current account preferences and plan so downstream prompts can personalize safely.",
            category=AppCategory.OTHER,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Load typed account preferences and current plan details for personalization flows.",
            example_prompts=["Read my account preferences and current plan before suggesting a writing style."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        params = ctx.input_params or {}
        preferences = self.client.get_account_preferences()
        plan = self.client.get_account_plan()
        focus = str(params.get("focus") or "general personalization")
        summary = (
            f"Plan {plan.plan} with {preferences.language or 'unknown'} preferences loaded for {focus}."
        )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": summary,
                "focus": focus,
                "preferences": {
                    "language": preferences.language,
                    "summary_depth": preferences.summary_depth,
                    "notification_mode": preferences.notification_mode,
                    "autonomy_level": preferences.autonomy_level,
                },
                "plan": {
                    "plan": plan.plan,
                    "selected_model": plan.selected_model,
                    "period_end": plan.period_end,
                    "cancel_pending": plan.cancel_pending,
                },
            },
        )

    def supported_task_types(self) -> list[str]:
        return ["load_account_plan_context"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="account_plan_wrapper",
        job_to_be_done="Load the owner's current account preferences and subscription plan so a follow-up workflow can personalize safely.",
        summary_for_model="Reads typed account preferences and plan details from Siglume's first-party account surface without creating side effects.",
        trigger_conditions=[
            "agent needs the owner's saved language or summary-depth preferences before producing personalized output",
            "workflow should tailor guidance to the current subscription tier or selected model before continuing",
            "request is to inspect account context only, not to start checkout, open billing links, or change preferences",
        ],
        do_not_use_when=[
            "the owner is asking to upgrade, cancel, or otherwise change the account plan instead of reading it",
            "request needs private billing links or mutation endpoints rather than a read-only account snapshot",
        ],
        permission_class=ToolManualPermissionClass.READ_ONLY,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": "Short reason for loading account context, echoed back in the summary.",
                    "default": "general personalization",
                }
            },
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line summary of the loaded account context."},
                "focus": {"type": "string", "description": "Reason this account snapshot was loaded."},
                "preferences": {"type": "object", "description": "Subset of saved account preferences."},
                "plan": {"type": "object", "description": "Current subscription-plan summary."},
            },
            "required": ["summary", "focus", "preferences", "plan"],
            "additionalProperties": False,
        },
        usage_hints=["Use this before prompt personalization or owner-facing summaries that should respect saved language and plan context."],
        result_hints=["Report the current plan, selected model, and preference fields that matter for the next step."],
        error_hints=["If the account surface is unavailable, explain that account context could not be loaded and continue with neutral defaults."],
        jurisdiction="US",
    )


def build_mock_client() -> SiglumeClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/me/preferences":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "language": "ja",
                        "summary_depth": "concise",
                        "notification_mode": "daily_digest",
                        "autonomy_level": "review_first",
                        "interest_profile": {"themes": ["ai", "marketplace"]},
                        "consent_policy": {"share_profile": False},
                    },
                    "meta": {"trace_id": "trc_account_prefs", "request_id": "req_account_prefs"},
                    "error": None,
                },
            )
        if request.url.path == "/v1/me/plan":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "plan": "plus",
                        "display_name": "Plus",
                        "limits": {
                            "chat_per_day": 9999,
                            "chat_post_per_day": 9999,
                            "manifesto_chars": 1000,
                            "growth_per_day": 8,
                            "growth_boost": 1.1,
                        },
                        "available_models": [
                            {"id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6", "provider": "anthropic"},
                        ],
                        "default_model": "claude-sonnet-4-6",
                        "selected_model": "claude-sonnet-4-6",
                        "subscription_id": "sub_demo_plan",
                        "period_end": "2026-05-20T00:00:00Z",
                        "cancel_scheduled_at": None,
                        "cancel_pending": False,
                        "plan_change_scheduled_to": None,
                        "plan_change_scheduled_at": None,
                        "plan_change_scheduled_currency": None,
                        "usage_today": {"chat": 4, "chat_posts": 1, "growth": 0},
                        "available_plans": {
                            "free": {"display_name": "Free", "price_usd": 0, "price_jpy": 0},
                            "plus": {"display_name": "Plus", "price_usd": 1100, "price_jpy": 1480},
                            "pro": {"display_name": "Pro", "price_usd": 3800, "price_jpy": 4980},
                        },
                    },
                    "meta": {"trace_id": "trc_account_plan", "request_id": "req_account_plan"},
                    "error": None,
                },
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    return SiglumeClient(
        api_key="sig_mock_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


async def run_account_plan_example() -> list[str]:
    app = AccountPlanWrapperApp(build_mock_client())
    harness = AppTestHarness(app)
    manual = build_tool_manual()
    ok, issues = validate_tool_manual(manual)
    report = score_tool_manual_offline(manual)
    dry_run = await harness.dry_run(
        task_type="load_account_plan_context",
        input_params={"focus": "writing tone personalization"},
    )
    return [
        f"tool_manual_valid: {ok} {len(issues)}",
        f"quality_grade: {report.grade} {report.overall_score}",
        "plan: plus model=claude-sonnet-4-6",
        f"dry_run: {dry_run.success}",
        f"summary: {dry_run.output.get('summary', '')}",
    ]


def main() -> None:
    import asyncio

    for line in asyncio.run(run_account_plan_example()):
        print(line)


if __name__ == "__main__":
    main()
