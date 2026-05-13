"""Example: inspect partner dashboard state and issue a handle-only API key.

API: first-party partner.* typed wrappers over the owner-operation surface.
Intended user: operators who review partner usage, existing ingest keys, and
optionally prepare a new source credential handle for onboarding.
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
    ApprovalRequestHint,
    ExecutionContext,
    ExecutionArtifact,
    ExecutionKind,
    ExecutionResult,
    PermissionClass,
    PriceModel,
    SideEffectRecord,
    SiglumeClient,
    ToolManual,
    ToolManualPermissionClass,
    score_tool_manual_offline,
    validate_tool_manual,
)


DEMO_AGENT_ID = "agt_owner_demo"


class PartnerDashboardWrapperApp(AppAdapter):
    def __init__(self, client: SiglumeClient | None = None) -> None:
        self.client = client or build_mock_client()

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="partner-dashboard-wrapper",
            name="Partner Dashboard Wrapper",
            job_to_be_done="Review Partner dashboard state and optionally prepare a handle-only API key reference for source onboarding.",
            category=AppCategory.FINANCE,
            store_vertical="api",
            permission_class=PermissionClass.ACTION,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            currency="USD",
            allow_free_trial=False,
            jurisdiction="US",
            short_description="Loads partner dashboard usage plus existing keys, then creates only the credential handle via the owner-operation bus.",
            example_prompts=[
                "Prepare a partner source onboarding snapshot and issue a new ingest-key handle.",
                "Rotate the ingest-key for the partner onboarding dashboard.",
            ],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        focus = str((ctx.input_params or {}).get("focus") or "source onboarding")
        source_name = str((ctx.input_params or {}).get("source_name") or "SDK Feed").strip() or "SDK Feed"
        dashboard = self.client.get_partner_dashboard(agent_id=DEMO_AGENT_ID)
        usage = self.client.get_partner_usage(agent_id=DEMO_AGENT_ID)
        keys = self.client.list_partner_api_keys(agent_id=DEMO_AGENT_ID)
        preview = {
            "focus": focus,
            "plan": dashboard.plan,
            "month_usage_pct": usage.month_usage_pct,
            "existing_key_ids": [item.key_id for item in keys if item.key_id],
            "requested_source_name": source_name,
            "allowed_source_types": ["rss", "partner_api"],
            "legacy_http_note": "Use POST /v1/partner/keys to reveal the raw ingest_key once; the owner-operation bus returns only the handle.",
        }
        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output=preview,
                needs_approval=True,
                approval_prompt=f"Create a handle-only partner source credential for {source_name}.",
                approval_hint=ApprovalRequestHint(
                    action_summary=f"Create a handle-only partner source credential for {source_name}",
                    permission_class="action",
                    side_effects=["Creates a new Partner API key handle; the raw ingest_key is not returned on the owner-operation bus."],
                    preview=preview,
                    reversible=True,
                ),
            )

        created_handle = self.client.create_partner_api_key(
            agent_id=DEMO_AGENT_ID,
            name=source_name,
            allowed_source_types=["rss", "partner_api"],
        )
        summary = (
            f"Loaded Partner dashboard for {focus}; plan {dashboard.plan or 'unknown'} "
            f"at {usage.month_usage_pct:.1f}% monthly usage across {len(keys)} existing keys."
        )
        summary += (
            f" Created handle {created_handle.key_id}; raw ingest_key is available "
            "only via POST /v1/partner/keys."
        )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": summary,
                "focus": focus,
                "plan": dashboard.plan,
                "month_usage_pct": usage.month_usage_pct,
                "existing_key_ids": [item.key_id for item in keys if item.key_id],
                "created_key_handle": {
                    "credential_id": created_handle.credential_id if created_handle else None,
                    "key_id": created_handle.key_id if created_handle else None,
                    "masked_key_hint": created_handle.masked_key_hint if created_handle else None,
                },
                "legacy_http_note": "Use POST /v1/partner/keys to reveal the raw ingest_key once; the owner-operation bus returns only the handle.",
            },
            receipt_summary={
                "action": "partner_key_handle_created",
                "credential_id": created_handle.credential_id,
                "key_id": created_handle.key_id,
            },
            artifacts=[
                ExecutionArtifact(
                    artifact_type="partner_api_key_handle",
                    external_id=created_handle.credential_id,
                    title=f"Partner API key handle for {source_name}",
                    summary="Handle-only Partner API key reference returned by the owner-operation bus.",
                    metadata={
                        "key_id": created_handle.key_id,
                        "masked_key_hint": created_handle.masked_key_hint,
                    },
                )
            ],
            side_effects=[
                SideEffectRecord(
                    action="partner_key_handle_created",
                    provider="siglume-owner-operations",
                    external_id=created_handle.credential_id,
                    reversible=True,
                    reversal_hint="Revoke the created Partner API key from the partner dashboard if it is no longer needed.",
                    metadata={
                        "key_id": created_handle.key_id,
                        "masked_key_hint": created_handle.masked_key_hint,
                    },
                )
            ],
        )

    def supported_task_types(self) -> list[str]:
        return ["prepare_partner_source_onboarding"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="partner_dashboard_wrapper",
        job_to_be_done="Inspect Partner dashboard usage and existing API keys, then optionally create a handle-only partner source credential for onboarding.",
        summary_for_model="Loads partner dashboard state and returns the created key handle without exposing the raw ingest_key on the owner-operation bus.",
        trigger_conditions=[
            "operator wants a partner dashboard snapshot before onboarding a new source feed",
            "workflow needs current partner usage plus existing key inventory before deciding whether to create another key",
            "the task is to prepare a handle-only partner credential reference instead of revealing the one-time raw secret",
        ],
        do_not_use_when=[
            "the human specifically needs the one-time raw ingest_key value instead of the handle-only owner-operation result",
            "the task is only to inspect ads billing or campaigns rather than partner source onboarding",
        ],
        permission_class=ToolManualPermissionClass.ACTION,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": "Short reason for loading the partner dashboard snapshot.",
                    "default": "source onboarding",
                },
                "source_name": {
                    "type": "string",
                    "description": "Display name for the new partner source key handle when the action path runs.",
                    "default": "SDK Feed",
                },
            },
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line dashboard and onboarding summary."},
                "focus": {"type": "string"},
                "plan": {"type": "string"},
                "month_usage_pct": {"type": "number"},
                "existing_key_ids": {"type": "array", "items": {"type": "string"}},
                "created_key_handle": {"type": "object", "description": "Handle-only result for the created partner key."},
                "legacy_http_note": {"type": "string", "description": "Reminder that the raw ingest_key is only available from the legacy HTTP route."},
            },
            "required": ["summary", "focus", "plan", "month_usage_pct", "existing_key_ids", "created_key_handle", "legacy_http_note"],
            "additionalProperties": False,
        },
        preview_schema={
            "type": "object",
            "properties": {
                "focus": {"type": "string"},
                "plan": {"type": "string"},
                "month_usage_pct": {"type": "number"},
                "existing_key_ids": {"type": "array", "items": {"type": "string"}},
                "requested_source_name": {"type": "string"},
                "allowed_source_types": {"type": "array", "items": {"type": "string"}},
                "legacy_http_note": {"type": "string"},
            },
            "required": ["focus", "plan", "month_usage_pct", "existing_key_ids", "requested_source_name", "allowed_source_types", "legacy_http_note"],
            "additionalProperties": False,
        },
        usage_hints=["Use this when a partner operator needs billing/usage context plus a new handle-only source credential reference."],
        result_hints=["If a key was created, report the masked hint and explicitly state that the raw ingest_key is not included here."],
        error_hints=["If the human needs the raw key, direct them to the legacy POST /v1/partner/keys route instead of fabricating a secret."],
        approval_summary_template="Create a handle-only partner source credential for {source_name}.",
        idempotency_support=True,
        side_effect_summary="Creates a handle-only Partner API key reference and never returns the raw ingest_key on the owner-operation bus.",
        jurisdiction="US",
    )


def build_mock_client() -> SiglumeClient:
    dashboard = {
        "partner_id": "usr_partner_demo",
        "company_name": "Demo Feeds",
        "plan": "starter",
        "plan_label": "Starter",
        "month_bytes_used": 1048576,
        "month_bytes_limit": 10485760,
        "month_usage_pct": 10.0,
        "total_source_items": 3,
        "has_billing": True,
        "has_subscription": True,
    }
    usage = {
        "plan": "starter",
        "month_bytes_used": 1048576,
        "month_bytes_limit": 10485760,
        "month_bytes_remaining": 9437184,
        "month_usage_pct": 10.0,
    }
    keys = [
        {
            "credential_id": "cred_partner_1",
            "name": "Primary Feed",
            "key_id": "src_partner_1",
            "allowed_source_types": ["partner_api", "rss"],
            "last_used_at": "2026-04-20T08:40:00Z",
            "created_at": "2026-04-19T23:10:00Z",
            "revoked": False,
        },
        {
            "credential_id": "cred_partner_2",
            "name": "Archive Feed",
            "key_id": "src_partner_2",
            "allowed_source_types": ["partner_api"],
            "last_used_at": None,
            "created_at": "2026-04-18T11:00:00Z",
            "revoked": False,
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != f"/v1/owner/agents/{DEMO_AGENT_ID}/operations/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        payload = json.loads(request.content.decode("utf-8")) if request.content else {}
        operation = payload.get("operation")
        params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
        if operation == "partner.dashboard.get":
            return httpx.Response(
                200,
                json={"data": {"agent_id": DEMO_AGENT_ID, "message": "Partner dashboard loaded.", "action": "partner_dashboard_get", "result": dashboard}, "meta": {"trace_id": "trc_partner_dashboard", "request_id": "req_partner_dashboard"}, "error": None},
            )
        if operation == "partner.usage.get":
            return httpx.Response(
                200,
                json={"data": {"agent_id": DEMO_AGENT_ID, "message": "Partner usage loaded.", "action": "partner_usage_get", "result": usage}, "meta": {"trace_id": "trc_partner_usage", "request_id": "req_partner_usage"}, "error": None},
            )
        if operation == "partner.keys.list":
            return httpx.Response(
                200,
                json={"data": {"agent_id": DEMO_AGENT_ID, "message": "Partner API keys loaded.", "action": "partner_keys_list", "result": {"keys": keys}}, "meta": {"trace_id": "trc_partner_keys_list", "request_id": "req_partner_keys_list"}, "error": None},
            )
        if operation == "partner.keys.create":
            assert params == {"name": "SDK Feed", "allowed_source_types": ["rss", "partner_api"]}
            return httpx.Response(
                200,
                json={
                    "data": {
                        "agent_id": DEMO_AGENT_ID,
                        "message": "Partner API key created.",
                        "action": "partner_keys_create",
                        "result": {
                            "credential_id": "cred_partner_3",
                            "name": "SDK Feed",
                            "key_id": "src_partner_3",
                            "allowed_source_types": ["rss", "partner_api"],
                            "masked_key_hint": "src_partner_3.********",
                        },
                    },
                    "meta": {"trace_id": "trc_partner_keys_create", "request_id": "req_partner_keys_create"},
                    "error": None,
                },
            )
        raise AssertionError(f"Unexpected operation payload: {payload}")

    return SiglumeClient(
        api_key="sig_mock_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


async def run_partner_dashboard_example() -> list[str]:
    app = PartnerDashboardWrapperApp(build_mock_client())
    harness = AppTestHarness(app)
    manual = build_tool_manual()
    ok, issues = validate_tool_manual(manual)
    report = score_tool_manual_offline(manual)
    dry_run = await harness.dry_run(
        task_type="prepare_partner_source_onboarding",
        input_params={"focus": "source onboarding", "source_name": "SDK Feed"},
    )
    action = await harness.execute_action(
        task_type="prepare_partner_source_onboarding",
        input_params={"focus": "source onboarding", "source_name": "SDK Feed"},
    )
    created_handle = action.output.get("created_key_handle", {}) if isinstance(action.output, dict) else {}
    return [
        f"tool_manual_valid: {ok} {len(issues)}",
        f"quality_grade: {report.grade} {report.overall_score}",
        f"dashboard: plan={dry_run.output.get('plan', '') if isinstance(dry_run.output, dict) else ''} usage={dry_run.output.get('month_usage_pct', 0) if isinstance(dry_run.output, dict) else 0} keys={len(dry_run.output.get('existing_key_ids', [])) if isinstance(dry_run.output, dict) else 0}",
        f"created_key: {created_handle.get('credential_id', '')} hint={created_handle.get('masked_key_hint', '')}",
        f"dry_run: {dry_run.success}",
        f"action: {action.success}",
        f"summary: {action.output.get('summary', '') if isinstance(action.output, dict) else ''}",
    ]


def main() -> None:
    import asyncio

    for line in asyncio.run(run_partner_dashboard_example()):
        print(line)


if __name__ == "__main__":
    main()
