"""Example: inspect installed tools and recent execution receipts.

API: first-party installed_tools.* typed wrappers over the owner-operation surface.
Intended user: owners or orchestration builders who need a safe snapshot of installed-tool posture.
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


class InstalledToolsWrapperApp(AppAdapter):
    def __init__(self, client: SiglumeClient | None = None) -> None:
        self.client = client or build_mock_client()

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="installed-tools-wrapper",
            name="Installed Tools Wrapper",
            job_to_be_done="Load installed tool posture, readiness, and recent receipt detail so an owner can triage operational health without mutating policies.",
            category=AppCategory.OTHER,
            store_vertical="api",
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            currency="USD",
            allow_free_trial=False,
            jurisdiction="US",
            short_description="Read installed tools, readiness, and receipts.",
            example_prompts=[
                "Show which installed tools are ready before I troubleshoot a recent execution.",
                "List my agent's installed tools and their connection status.",
            ],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        focus = str((ctx.input_params or {}).get("focus") or "installed tool readiness triage")
        tools = self.client.list_installed_tools(agent_id=DEMO_AGENT_ID)
        readiness = self.client.get_installed_tools_connection_readiness(agent_id=DEMO_AGENT_ID)
        receipts = self.client.list_installed_tool_receipts(
            agent_id=DEMO_AGENT_ID,
            status="completed",
            limit=1,
        )
        first_receipt = (
            self.client.get_installed_tool_receipt(receipts[0].receipt_id, agent_id=DEMO_AGENT_ID)
            if receipts else None
        )
        steps = (
            self.client.get_installed_tool_receipt_steps(first_receipt.receipt_id, agent_id=DEMO_AGENT_ID)
            if first_receipt is not None else []
        )
        execution = (
            self.client.get_installed_tool_execution(first_receipt.intent_id, agent_id=DEMO_AGENT_ID)
            if first_receipt is not None else None
        )
        summary = (
            f"Loaded {len(tools)} installed tools for {focus}; "
            f"first receipt: {first_receipt.receipt_id if first_receipt else 'n/a'} "
            f"({execution.status if execution else 'n/a'})."
        )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": summary,
                "focus": focus,
                "binding_ids": [item.binding_id for item in tools],
                "readiness": readiness.bindings,
                "first_receipt": {
                    "receipt_id": first_receipt.receipt_id if first_receipt else None,
                    "status": first_receipt.status if first_receipt else None,
                    "step_count": first_receipt.step_count if first_receipt else None,
                    "execution_status": execution.status if execution else None,
                    "step_ids": [item.step_id for item in steps],
                },
            },
        )

    def supported_task_types(self) -> list[str]:
        return ["review_installed_tools"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="installed_tools_wrapper",
        job_to_be_done="Read installed tool posture, connected-account readiness, and recent receipt detail without changing any execution policy.",
        summary_for_model="Lists installed tools, loads readiness, and hydrates a recent receipt plus its execution/step detail through Siglume's first-party owner-operation surface without mutating bindings.",
        trigger_conditions=[
            "owner wants to inspect installed tool readiness before debugging a failed execution or missing connected account",
            "workflow needs a read-only snapshot of installed tools and recent receipts before deciding whether to request a policy change",
            "request is to review installed tool health or recent activity only, not to pause, resume, or update a binding policy",
        ],
        do_not_use_when=[
            "the owner is explicitly asking to update an installed tool binding policy or any other guarded installed_tools write path",
            "workflow already has the exact receipt or intent payload and does not need a broader installed-tool posture snapshot",
        ],
        permission_class=ToolManualPermissionClass.READ_ONLY,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": "Short reason for loading the installed-tool snapshot, echoed back in the summary.",
                    "default": "installed tool readiness triage",
                }
            },
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line summary of the installed-tool inspection."},
                "focus": {"type": "string", "description": "Reason the installed-tool snapshot was loaded."},
                "binding_ids": {"type": "array", "items": {"type": "string"}},
                "readiness": {"type": "object", "description": "Binding readiness map keyed by binding id."},
                "first_receipt": {"type": "object", "description": "Hydrated receipt, execution, and step summary for the first matching receipt."},
            },
            "required": ["summary", "focus", "binding_ids", "readiness", "first_receipt"],
            "additionalProperties": False,
        },
        usage_hints=["Use this before policy changes or support escalation when the workflow first needs a read-only installed-tool health snapshot."],
        result_hints=["Report how many installed tools were found, whether all bindings are ready, and the first receipt/execution status explicitly."],
        error_hints=["If the owner-operation surface is unavailable, explain that installed tool posture could not be loaded and avoid inventing readiness or receipt details."],
        jurisdiction="US",
    )


def build_mock_client() -> SiglumeClient:
    tool_one = {
        "binding_id": "bind_inst_1",
        "listing_id": "lst_inst_1",
        "release_id": "rel_inst_1",
        "display_name": "Seller Search",
        "permission_class": "action",
        "binding_status": "active",
        "account_readiness": "ready",
        "settlement_mode": "embedded_wallet_charge",
        "settlement_currency": "USD",
        "settlement_network": "polygon",
        "accepted_payment_tokens": ["USDC"],
        "last_used_at": "2026-04-20T08:30:00Z",
    }
    tool_two = {
        "binding_id": "bind_inst_2",
        "listing_id": "lst_inst_2",
        "release_id": "rel_inst_2",
        "display_name": "Invoice Mailer",
        "permission_class": "read-only",
        "binding_status": "active",
        "account_readiness": "missing_connected_account",
        "settlement_mode": "free",
        "accepted_payment_tokens": [],
        "last_used_at": None,
    }
    execution = {
        "id": "int_inst_1",
        "agent_id": DEMO_AGENT_ID,
        "owner_user_id": "usr_owner_demo",
        "binding_id": "bind_inst_1",
        "release_id": "rel_inst_1",
        "source": "owner_ui",
        "goal": "Run seller search",
        "input_payload_jsonb": {"binding_id": "bind_inst_1", "query": "translation seller"},
        "plan_jsonb": {"steps": [{"tool_name": "seller_api_search"}]},
        "status": "queued",
        "approval_snapshot_jsonb": {},
        "metadata_jsonb": {"source": "sdk-test"},
        "queued_at": "2026-04-20T08:31:00Z",
        "created_at": "2026-04-20T08:31:00Z",
        "updated_at": "2026-04-20T08:31:00Z",
    }
    receipt = {
        "id": "rcp_inst_1",
        "intent_id": "int_inst_1",
        "agent_id": DEMO_AGENT_ID,
        "owner_user_id": "usr_owner_demo",
        "binding_id": "bind_inst_1",
        "grant_id": "grt_inst_1",
        "release_ids_jsonb": ["rel_inst_1"],
        "execution_source": "owner_http",
        "status": "completed",
        "permission_class": "action",
        "approval_status": "approved",
        "step_count": 1,
        "total_latency_ms": 1820,
        "total_billable_units": 2,
        "total_amount_usd_cents": 45,
        "summary": "Seller search completed.",
        "trace_id": "trc_inst_receipt",
        "metadata_jsonb": {"source": "sdk-test"},
        "started_at": "2026-04-20T08:31:05Z",
        "completed_at": "2026-04-20T08:31:07Z",
        "created_at": "2026-04-20T08:31:07Z",
    }
    step = {
        "id": "stp_inst_1",
        "intent_id": "int_inst_1",
        "step_id": "step_1",
        "tool_name": "seller_api_search",
        "binding_id": "bind_inst_1",
        "release_id": "rel_inst_1",
        "dry_run": False,
        "status": "completed",
        "args_hash": "hash_args_1",
        "args_preview_redacted": "{\"query\":\"translation seller\"}",
        "output_hash": "hash_output_1",
        "output_preview_redacted": "{\"matches\":3}",
        "provider_latency_ms": 910,
        "retry_count": 0,
        "connected_account_ref": "acct_google_demo",
        "metadata_jsonb": {"source": "sdk-test"},
        "created_at": "2026-04-20T08:31:06Z",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != f"/v1/owner/agents/{DEMO_AGENT_ID}/operations/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        payload = json.loads(request.content.decode("utf-8")) if request.content else {}
        operation = payload.get("operation")
        params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
        if operation == "installed_tools.list":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "agent_id": DEMO_AGENT_ID,
                        "status": "completed",
                        "message": "Installed tools loaded.",
                        "result": [tool_one, tool_two],
                    },
                    "meta": {"trace_id": "trc_installed_tools_list", "request_id": "req_installed_tools_list"},
                    "error": None,
                },
            )
        if operation == "installed_tools.connection_readiness":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "agent_id": DEMO_AGENT_ID,
                        "status": "completed",
                        "message": "Installed tool readiness loaded.",
                        "result": {
                            "agent_id": DEMO_AGENT_ID,
                            "all_ready": False,
                            "bindings": {
                                "bind_inst_1": "ready",
                                "bind_inst_2": "missing_connected_account",
                            },
                        },
                    },
                    "meta": {"trace_id": "trc_installed_tools_ready", "request_id": "req_installed_tools_ready"},
                    "error": None,
                },
            )
        if operation == "installed_tools.receipts.list":
            assert params.get("status") == "completed"
            assert params.get("limit") == 1
            return httpx.Response(
                200,
                json={
                    "data": {
                        "agent_id": DEMO_AGENT_ID,
                        "status": "completed",
                        "message": "Installed tool receipts loaded.",
                        "result": [receipt],
                    },
                    "meta": {"trace_id": "trc_installed_tools_receipts", "request_id": "req_installed_tools_receipts"},
                    "error": None,
                },
            )
        if operation == "installed_tools.receipts.get":
            assert params.get("receipt_id") == "rcp_inst_1"
            return httpx.Response(
                200,
                json={
                    "data": {
                        "agent_id": DEMO_AGENT_ID,
                        "status": "completed",
                        "message": "Installed tool receipt loaded.",
                        "result": receipt,
                    },
                    "meta": {"trace_id": "trc_installed_tools_receipt", "request_id": "req_installed_tools_receipt"},
                    "error": None,
                },
            )
        if operation == "installed_tools.receipts.steps.get":
            assert params.get("receipt_id") == "rcp_inst_1"
            return httpx.Response(
                200,
                json={
                    "data": {
                        "agent_id": DEMO_AGENT_ID,
                        "status": "completed",
                        "message": "Installed tool receipt steps loaded.",
                        "result": [step],
                    },
                    "meta": {"trace_id": "trc_installed_tools_steps", "request_id": "req_installed_tools_steps"},
                    "error": None,
                },
            )
        if operation == "installed_tools.execution.get":
            assert params.get("intent_id") == "int_inst_1"
            return httpx.Response(
                200,
                json={
                    "data": {
                        "agent_id": DEMO_AGENT_ID,
                        "status": "completed",
                        "message": "Installed tool execution loaded.",
                        "result": execution,
                    },
                    "meta": {"trace_id": "trc_installed_tools_execution", "request_id": "req_installed_tools_execution"},
                    "error": None,
                },
            )
        raise AssertionError(f"Unexpected operation payload: {payload}")

    return SiglumeClient(
        api_key="sig_mock_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


async def run_installed_tools_example() -> list[str]:
    app = InstalledToolsWrapperApp(build_mock_client())
    harness = AppTestHarness(app)
    manual = build_tool_manual()
    ok, issues = validate_tool_manual(manual)
    report = score_tool_manual_offline(manual)
    dry_run = await harness.dry_run(
        task_type="review_installed_tools",
        input_params={"focus": "installed tool readiness triage"},
    )
    output = dry_run.output if isinstance(dry_run.output, dict) else {}
    first_receipt = output.get("first_receipt") if isinstance(output.get("first_receipt"), dict) else {}
    readiness = output.get("readiness") if isinstance(output.get("readiness"), dict) else {}
    all_ready = all(value == "ready" for value in readiness.values()) if readiness else True
    return [
        f"tool_manual_valid: {ok} {len(issues)}",
        f"quality_grade: {report.grade} {report.overall_score}",
        f"installed_tools: {len(output.get('binding_ids', [])) if isinstance(output.get('binding_ids'), list) else 0} ready={all_ready}",
        f"receipt_steps: {len(first_receipt.get('step_ids', [])) if isinstance(first_receipt.get('step_ids'), list) else 0} execution={first_receipt.get('execution_status', '')}",
        f"dry_run: {dry_run.success}",
        f"summary: {output.get('summary', '')}",
    ]


def main() -> None:
    import asyncio

    for line in asyncio.run(run_installed_tools_example()):
        print(line)


if __name__ == "__main__":
    main()
