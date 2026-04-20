"""Generated Siglume wrapper for `owner.budget.get`."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

try:
    from siglume_api_sdk import (
        AppAdapter,
        AppCategory,
        AppManifest,
        AppTestHarness,
        ApprovalMode,
        ExecutionContext,
        ExecutionKind,
        ExecutionResult,
        PermissionClass,
        PriceModel,
        SideEffectRecord,
        SiglumeClient,
    )
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
    from siglume_api_sdk import (
        AppAdapter,
        AppCategory,
        AppManifest,
        AppTestHarness,
        ApprovalMode,
        ExecutionContext,
        ExecutionKind,
        ExecutionResult,
        PermissionClass,
        PriceModel,
        SideEffectRecord,
        SiglumeClient,
    )

try:
    from .stubs import GeneratedOperationStub, build_stubs
except ImportError:
    from stubs import GeneratedOperationStub, build_stubs

OPERATION_KEY = "owner.budget.get"
DEFAULT_AGENT_ID = "agt_owner_demo"
DEFAULT_LANGUAGE = "en"


class OwnerBudgetGetWrapperApp(AppAdapter):
    def __init__(self, client: SiglumeClient | None = None, stub_provider: GeneratedOperationStub | None = None) -> None:
        self._client = client
        self._stub_provider = stub_provider or GeneratedOperationStub(OPERATION_KEY)

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="my-owner-budget-get-wrapper",
            name="Owner Budget Get Wrapper",
            job_to_be_done="Wrap the Siglume first-party operation `owner.budget.get` for owned agents.",
            category=AppCategory.OTHER,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Read the current delegated budget.",
            example_prompts=["Run owner.budget.get for my owned agent."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        payload = dict(ctx.input_params or {})
        agent_id = str(payload.pop("agent_id", DEFAULT_AGENT_ID) or DEFAULT_AGENT_ID)
        preview = {
            "summary": f"Would run {OPERATION_KEY} for {agent_id}.",
            "operation_key": OPERATION_KEY,
            "agent_id": agent_id,
            "params": payload,
        }
        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output=preview,
                needs_approval=False,

            )

        execution = await self._invoke_operation(agent_id, payload)
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": execution["message"],
                "action": execution["action"],
                "result": execution["result"],
            },
            receipt_summary={
                "action": execution["action"],
                "operation_key": OPERATION_KEY,
                "agent_id": agent_id,
            },
            side_effects=[
                SideEffectRecord(
                    action=execution["action"],
                    provider="siglume_owner_operation",
                    external_id=agent_id,
                    reversible=False,
                    metadata={"operation_key": OPERATION_KEY},
                )
            ] if ctx.execution_kind != ExecutionKind.DRY_RUN else [],
        )

    async def _invoke_operation(self, agent_id: str, params: dict[str, object]) -> dict[str, object]:
        if self._client is not None:
            result = self._client.execute_owner_operation(agent_id, OPERATION_KEY, params, lang=DEFAULT_LANGUAGE)
            return {"message": result.message, "action": result.action, "result": result.result}
        api_key = str(os.environ.get("SIGLUME_API_KEY") or "").strip()
        if api_key:
            with SiglumeClient(api_key=api_key) as client:
                result = client.execute_owner_operation(agent_id, OPERATION_KEY, params, lang=DEFAULT_LANGUAGE)
            return {"message": result.message, "action": result.action, "result": result.result}
        return await self._stub_provider.handle("execute", {"operation": OPERATION_KEY, "agent_id": agent_id, "params": params})

    def supported_task_types(self) -> list[str]:
        return ["wrap_owner_budget_get"]


async def main() -> None:
    harness = AppTestHarness(OwnerBudgetGetWrapperApp(), stubs=build_stubs())
    print("manifest_issues:", harness.validate_manifest())
    dry_run = await harness.dry_run(task_type="wrap_owner_budget_get")
    print("dry_run:", dry_run.success)
    if False:
        action = await harness.execute_action(task_type="wrap_owner_budget_get")
        print("action:", action.success)
        print("receipt_issues:", len(harness.validate_receipt(action)))


if __name__ == "__main__":
    asyncio.run(main())
