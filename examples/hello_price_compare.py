"""Sample Agent API: Price Comparison Helper.

A read-only API that demonstrates how to build a Siglume agent API.
When installed on an agent, it enables the agent to compare product prices
across multiple sources.

This is a reference implementation; replace the stub logic with real API calls.
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


class PriceCompareApp(AppAdapter):
    """Compare product prices across sources."""

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="price-compare-helper",
            name="Price Compare Helper",
            job_to_be_done="Compare product prices across Amazon, Rakuten, and other sources to find the best deal",
            category=AppCategory.COMMERCE,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Find the best price for any product across major retailers",
            docs_url="https://github.com/taihei-05/siglume-api-sdk/blob/main/examples/hello_price_compare.py",
            support_contact="https://github.com/taihei-05/siglume-api-sdk/issues",
            example_prompts=[
                "Compare prices for Sony WH-1000XM5",
                "Compare prices for AirPods Pro across retailers",
                "Find the cheapest retailer for this item",
            ],
            compatibility_tags=["commerce", "comparison", "japanese-market"],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        query = ctx.input_params.get("query", "Sony WH-1000XM5")

        sample_results = [
            {"source": "Amazon JP", "price": 38000, "currency": "JPY", "url": "https://amazon.co.jp/..."},
            {"source": "Rakuten", "price": 39800, "currency": "JPY", "url": "https://rakuten.co.jp/..."},
            {"source": "Yahoo Shopping", "price": 37500, "currency": "JPY", "url": "https://shopping.yahoo.co.jp/..."},
        ]

        best = min(sample_results, key=lambda item: item["price"])

        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "task": ctx.task_type,
                "query": query,
                "results": sample_results,
                "best_deal": best,
                "summary": f"Best price: {best['source']} at JPY {best['price']:,}",
            },
            units_consumed=1,
        )

    def supported_task_types(self) -> list[str]:
        return ["compare_prices", "find_cheapest", "price_check"]


class MockRetailerAPI(StubProvider):
    """Simulates retailer API responses for sandbox testing."""

    async def handle(self, method: str, params: dict) -> dict:
        if method == "search":
            return {
                "items": [
                    {"name": params.get("query", "Test Product"), "price": 35000, "currency": "JPY"},
                ],
            }
        return await super().handle(method, params)


async def main():
    app = PriceCompareApp()
    harness = AppTestHarness(
        app,
        stubs={"amazon": MockRetailerAPI("amazon"), "rakuten": MockRetailerAPI("rakuten")},
    )

    issues = harness.validate_manifest()
    if issues:
        print(f"Manifest issues: {issues}")
        return
    print("[OK] Manifest valid")

    health = await harness.health()
    print(f"[OK] Health: {health.healthy}")

    result = await harness.dry_run(task_type="compare_prices")
    print(f"[OK] Dry run: success={result.success}")
    print(f"  Output: {result.output.get('summary')}")

    print("\n[OK] All checks passed -- this manifest is ready to register.")
    print("")
    print("Next steps to go live on the API Store:")
    print("  1. Replace the stub data in execute() with real retailer calls")
    print("  2. Keep this first version FREE + READ_ONLY unless you need side effects")
    print("  3. Write tool_manual.json -- see GETTING_STARTED.md #13")
    print("  4. Run: siglume test . && siglume score . --offline")
    print("  5. Deploy, fill runtime_validation.json, then run:")
    print("     siglume validate .")
    print("     siglume score . --remote")
    print("     siglume register . --confirm")
    print("")
    print("Revenue share: 93.4% developer / 6.6% platform.")
    print("Settlement: migrating from Stripe Connect to on-chain embedded wallet")
    print("(gas covered by the platform). See PAYMENT_MIGRATION.md for details.")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
