"""Sample Agent API: Hello Echo.

A minimal read-only API that demonstrates returning input parameters in the output.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk import (
    AppAdapter,
    AppManifest,
    AppTestHarness,
    ApprovalMode,
    AppCategory,
    ExecutionContext,
    ExecutionResult,
    PermissionClass,
    PriceModel,
    StubProvider,
)


class HelloEchoApp(AppAdapter):
    """A simple echo app that returns the input parameters."""

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="hello-echo",
            name="Hello Echo",
            job_to_be_done="Return the input parameters in the output",
            category=AppCategory.COMMERCE,  
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="A simple echo API",
            example_prompts=[
                "Echo this input",
                "Return the parameters I send you",
                "What did I just say to you?",
            ],
            compatibility_tags=["utility", "echo", "demo"],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
       

        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "input_received": ctx.input_params,
            },
            units_consumed=1,
        )

    def supported_task_types(self) -> list[str]:
        return ["echo_input"]




async def main():
    app = HelloEchoApp()
    harness = AppTestHarness(app)

    issues = harness.validate_manifest()
    if issues:
        print(f"Manifest issues: {issues}")
        return
    print("[OK] Manifest valid")

    health = await harness.health()
    print(f"[OK] Health: {health.healthy}")

    result = await harness.dry_run(task_type="compare_prices")
    print(f"[OK] Dry run: success={result.success}")
    print("\n[OK] Echo example ready.")



if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
