"""Example: read wallet balances through a connected wallet account.

API: wallet balance lookup across Ethereum or Polygon.
Intended user: treasury or portfolio monitoring agents.
Connected account: metamask.
"""
from __future__ import annotations

import sys
from pathlib import Path

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
    StubProvider,
    ToolManual,
    ToolManualPermissionClass,
    score_tool_manual_offline,
    validate_tool_manual,
)


CHAIN_DEFAULTS: dict[str, tuple[str, float, float]] = {
    "ethereum": ("ETH", 1.2345, 3200.0),
    "polygon": ("MATIC", 542.1, 0.75),
}

TOKEN_PRICES: dict[str, float] = {
    "ETH": 3200.0,
    "MATIC": 0.75,
    "USDC": 1.0,
}


class WalletBalanceApp(AppAdapter):
    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="wallet-balance",
            name="Wallet Balance",
            job_to_be_done="Read the owner's connected wallet balance on Ethereum or Polygon without moving funds.",
            category=AppCategory.FINANCE,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=["metamask"],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Read native-token or ERC-20 balances from a connected MetaMask wallet.",
            example_prompts=["Check my Polygon wallet balance."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        chain = str(ctx.input_params.get("chain") or "ethereum").lower()
        default_symbol, default_balance, default_price = CHAIN_DEFAULTS.get(chain, CHAIN_DEFAULTS["ethereum"])
        raw_symbol = str(ctx.input_params.get("token_symbol") or default_symbol).upper()
        # Tool manual defaults token_symbol to "native" to mean "chain's
        # native asset" (ETH on Ethereum, MATIC on Polygon). Resolve NATIVE
        # to the chain's concrete symbol before routing, otherwise the
        # equality check below misses and we fall through to the synthetic
        # ERC-20 branch, contradicting the manual's own contract.
        token_symbol = default_symbol if raw_symbol == "NATIVE" else raw_symbol
        if token_symbol == default_symbol:
            balance = default_balance
            usd_price = default_price
        else:
            balance = 250.0 if token_symbol == "USDC" else 18.75
            usd_price = TOKEN_PRICES.get(token_symbol, 1.25)
        usd_equivalent = round(balance * usd_price, 2)
        provider_key = (
            ctx.connected_accounts.get("metamask").provider_key
            if ctx.connected_accounts.get("metamask")
            else "metamask"
        )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": f"{chain.title()} wallet holds {balance:.4f} {token_symbol} (~USD {usd_equivalent:.2f}).",
                "chain": chain,
                "token_symbol": token_symbol,
                "balance": balance,
                "usd_equivalent": usd_equivalent,
                "provider": provider_key,
            },
        )

    def supported_task_types(self) -> list[str]:
        return ["wallet_balance", "check_wallet_balance"]


def build_stubs() -> dict[str, StubProvider]:
    return {"metamask": StubProvider("metamask")}


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="wallet_balance",
        job_to_be_done="Read the owner's connected MetaMask wallet balance on Ethereum or Polygon without creating any blockchain side effects.",
        summary_for_model="Returns native-token or ERC-20 wallet balances plus a USD equivalent for a connected MetaMask wallet on Ethereum or Polygon.",
        trigger_conditions=[
            "owner asks to check a wallet balance on Ethereum or Polygon",
            "agent needs a read-only on-chain balance snapshot before planning a payment or treasury action",
            "request is to inspect holdings rather than transfer funds or approve a transaction",
        ],
        do_not_use_when=[
            "the request is to sign, send, swap, or bridge assets",
            "the owner has not connected a MetaMask wallet for the target chain",
        ],
        permission_class=ToolManualPermissionClass.READ_ONLY,
        dry_run_supported=True,
        requires_connected_accounts=["metamask"],
        input_schema={
            "type": "object",
            "properties": {
                "chain": {
                    "type": "string",
                    "description": "Target chain to inspect.",
                    "enum": ["ethereum", "polygon"],
                },
                "token_symbol": {
                    "type": "string",
                    "description": "Optional token symbol; omit to read the native asset.",
                    "default": "native",
                },
            },
            "required": ["chain"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line balance summary."},
                "chain": {"type": "string", "description": "Chain that was queried."},
                "token_symbol": {"type": "string", "description": "Token that was priced."},
                "balance": {"type": "number", "description": "Token balance on the requested chain."},
                "usd_equivalent": {"type": "number", "description": "Approximate USD equivalent."},
            },
            "required": ["summary", "chain", "token_symbol", "balance", "usd_equivalent"],
            "additionalProperties": False,
        },
        usage_hints=["Use this tool before payment planning when the owner needs a read-only wallet balance snapshot."],
        result_hints=["State the chain, token, and USD equivalent in the first sentence so the owner can sanity-check the result quickly."],
        error_hints=["If the owner has not connected MetaMask for the requested chain, ask them to connect the wallet before retrying."],
    )


async def main() -> None:
    harness = AppTestHarness(WalletBalanceApp(), stubs=build_stubs())
    ok, issues = validate_tool_manual(build_tool_manual())
    report = score_tool_manual_offline(build_tool_manual())
    dry_run = await harness.dry_run(task_type="wallet_balance", input_params={"chain": "polygon"})
    print("tool_manual_valid:", ok, len(issues))
    print("quality_grade:", report.grade, report.overall_score)
    print("manifest_issues:", harness.validate_manifest())
    print("dry_run:", dry_run.success)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
