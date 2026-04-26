"""API: recurring subscription payment via Polygon mandate + embedded wallet charge.

Intended user: seller-side payment adapter author shipping a PAYMENT tool.
Connected account: none — settlement runs on the platform's on-chain contracts
(SubscriptionHub) and the platform paymaster sponsors gas. Wallets stay
non-custodial: Siglume never holds the buyer's or seller's funds or keys, and
the SubscriptionHub contract can only pull up to the mandate cap the buyer
signed on-chain.
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
    ExecutionKind,
    ExecutionResult,
    PermissionClass,
    PriceModel,
    SettlementMode,
    SideEffectRecord,
    ToolManual,
    ToolManualPermissionClass,
    score_tool_manual_offline,
    validate_tool_manual,
)
from siglume_api_sdk.web3 import simulate_embedded_wallet_charge, simulate_polygon_mandate  # noqa: E402


DEFAULT_MONTHLY_CAP_MINOR = 148000
DEFAULT_SETTLEMENT_TOKEN = "JPYC"


class PolygonMandateAdapterApp(AppAdapter):
    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="polygon-mandate-adapter",
            name="Polygon Mandate Adapter",
            job_to_be_done="Preview and charge a recurring subscription through a Polygon mandate with platform-covered gas.",
            category=AppCategory.FINANCE,
            permission_class=PermissionClass.PAYMENT,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.SUBSCRIPTION,
            price_value_minor=1480,
            jurisdiction="US",
            short_description="Simulate mandate creation, quote the recurring cap, and emit a mock embedded-wallet receipt.",
            example_prompts=[
                "Charge the JPYC-equivalent of the Plus plan through the saved Polygon mandate.",
                "Charge this month's subscription from the connected Polygon mandate.",
            ],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        amount_minor = int(ctx.input_params.get("amount_minor") or DEFAULT_MONTHLY_CAP_MINOR)
        amount_usd = round(amount_minor / 100, 2)
        settlement_token = str(ctx.input_params.get("settlement_token") or DEFAULT_SETTLEMENT_TOKEN).upper()
        payer_wallet = str(ctx.input_params.get("payer_wallet") or "0x" + "1" * 40)
        payee_wallet = str(ctx.input_params.get("payee_wallet") or "0x" + "2" * 40)
        mandate = simulate_polygon_mandate(
            mandate_id="pmd_demo_001",
            payer_wallet=payer_wallet,
            payee_wallet=payee_wallet,
            monthly_cap_minor=amount_minor,
            currency=settlement_token,
            status="active",
            next_attempt_at_iso="2026-05-01T00:00:00Z",
            cancel_scheduled=False,
        )
        summary = f"Charge {settlement_token} {amount_minor / 100:.2f} through the saved Polygon mandate."
        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output={
                    "summary": summary,
                    "amount_usd": amount_usd,
                    "currency": "USD",
                    "mandate_id": mandate.mandate_id,
                    "settlement_token": settlement_token,
                    "monthly_cap_minor": amount_minor,
                },
                needs_approval=True,
                approval_prompt=summary,
            )
        if ctx.execution_kind == ExecutionKind.QUOTE:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output={
                    "summary": f"Quoted {settlement_token} {amount_minor / 100:.2f} for the upcoming renewal.",
                    "amount_usd": amount_usd,
                    "currency": "USD",
                    "mandate_id": mandate.mandate_id,
                    "monthly_cap_minor": amount_minor,
                    "settlement_token": settlement_token,
                },
                units_consumed=1,
                receipt_summary={
                    "action": "polygon_mandate_quote",
                    "amount_usd": amount_usd,
                    "currency": "USD",
                    "mandate_id": mandate.mandate_id,
                    "monthly_cap_minor": amount_minor,
                    "settlement_token": settlement_token,
                },
            )

        charge = simulate_embedded_wallet_charge(
            mandate=mandate,
            amount_minor=amount_minor,
            tx_hash="0x" + "a" * 64,
            user_operation_hash="0x" + "b" * 64,
            platform_fee_minor=800,
        )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": f"Charged {settlement_token} {amount_minor / 100:.2f} via embedded wallet settlement.",
                "amount_usd": amount_usd,
                "currency": "USD",
                "mandate_id": mandate.mandate_id,
                "tx_hash": charge.tx_hash,
                "user_operation_hash": charge.user_operation_hash,
                "developer_net_minor": charge.developer_net_minor,
                "settlement_token": settlement_token,
            },
            units_consumed=1,
            receipt_summary={
                "action": "polygon_mandate_charge",
                "amount_usd": amount_usd,
                "currency": "USD",
                "mandate_id": mandate.mandate_id,
                "tx_hash": charge.tx_hash,
                "user_operation_hash": charge.user_operation_hash,
                "settlement_token": settlement_token,
            },
            side_effects=[
                SideEffectRecord(
                    action="charge_polygon_mandate",
                    provider="siglume_web3",
                    external_id=mandate.mandate_id,
                    reversible=False,
                    metadata={
                        "tx_hash": charge.tx_hash,
                        "user_operation_hash": charge.user_operation_hash,
                    },
                )
            ],
        )

    def supported_task_types(self) -> list[str]:
        return ["prepare_subscription_charge", "charge_subscription"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="polygon_mandate_adapter",
        job_to_be_done="Preview, quote, and charge a recurring subscription through a Polygon mandate and embedded-wallet settlement.",
        summary_for_model="Uses Siglume's Polygon mandate rail to preview a recurring cap and then emit an embedded-wallet charge receipt after approval.",
        trigger_conditions=[
            "owner asks to renew a subscription or recurring plan through the saved Polygon mandate",
            "agent needs a dry-run or quote before charging the recurring payment",
            "request is to complete a subscription charge on Siglume's web3 settlement rail",
        ],
        do_not_use_when=[
            "the request is only to inspect a balance and does not require any payment action",
            "the owner has not approved a recurring charge or wants to compare plans without paying",
        ],
        permission_class=ToolManualPermissionClass.PAYMENT,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "amount_minor": {"type": "integer", "description": "Settlement-token amount in minor units.", "default": DEFAULT_MONTHLY_CAP_MINOR},
                "settlement_token": {"type": "string", "description": "Settlement token on Polygon (for example JPYC or USDC).", "default": DEFAULT_SETTLEMENT_TOKEN},
                "payer_wallet": {"type": "string", "description": "Owner smart-account address that authorized the mandate."},
                "payee_wallet": {"type": "string", "description": "Developer or platform payout wallet that receives settlement."},
            },
            "required": ["amount_minor"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line summary of the quote or payment result."},
                "amount_usd": {"type": "number", "description": "USD-equivalent amount shown to the owner for approval."},
                "currency": {"type": "string", "description": "Pricing currency exposed through the public SDK contract."},
                "mandate_id": {"type": "string", "description": "Siglume payment mandate identifier."},
                "tx_hash": {"type": "string", "description": "On-chain transaction hash after the payment is submitted."},
                "user_operation_hash": {"type": "string", "description": "ERC-4337 user operation hash when available."},
                "developer_net_minor": {"type": "integer", "description": "Developer net amount after the platform fee."},
                "settlement_token": {"type": "string", "description": "Settlement token used on Polygon."},
            },
            "required": ["summary", "amount_usd", "currency", "mandate_id", "settlement_token"],
            "additionalProperties": False,
        },
        usage_hints=["Run dry_run or quote first so the owner can inspect the recurring cap before the payment is submitted."],
        result_hints=["Report the mandate_id and settlement token before secondary details like developer_net_minor."],
        error_hints=["If the payer wallet or mandate is missing, ask the owner to reconnect or recreate the payment mandate."],
        approval_summary_template="Charge {amount_minor} minor units of {settlement_token} via the saved Polygon mandate.",
        preview_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Preview of the recurring web3 charge."},
                "amount_usd": {"type": "number", "description": "USD-equivalent amount that would be approved."},
                "currency": {"type": "string", "description": "Pricing currency exposed to the owner."},
                "mandate_id": {"type": "string", "description": "Mandate that would be used for settlement."},
            },
            "required": ["summary", "amount_usd", "currency", "mandate_id"],
            "additionalProperties": False,
        },
        idempotency_support=True,
        side_effect_summary="Submits an embedded-wallet charge against the saved Polygon mandate after approval.",
        quote_schema={
            "type": "object",
            "properties": {
                "monthly_cap_minor": {"type": "integer", "description": "Quoted recurring cap in the settlement token's minor units."},
                "amount_usd": {"type": "number", "description": "USD-equivalent amount shown in the quote."},
                "currency": {"type": "string", "description": "Pricing currency exposed to the owner."},
                "settlement_token": {"type": "string", "description": "Settlement token used on Polygon."},
            },
            "required": ["monthly_cap_minor", "amount_usd", "currency", "settlement_token"],
            "additionalProperties": False,
        },
        currency="USD",
        settlement_mode=SettlementMode.POLYGON_MANDATE,
        refund_or_cancellation_note="Cancellations before final settlement follow the seller policy; on-chain settlement itself is not reversed by the SDK helper.",
        jurisdiction="US",
    )


def run_polygon_mandate_example() -> list[str]:
    harness = AppTestHarness(PolygonMandateAdapterApp())
    tool_manual = build_tool_manual()
    ok, issues = validate_tool_manual(tool_manual)
    report = score_tool_manual_offline(tool_manual)
    preview_mandate = harness.simulate_polygon_mandate(
        mandate_id="pmd_test_001",
        payer_wallet="0x" + "1" * 40,
        payee_wallet="0x" + "2" * 40,
        monthly_cap_minor=DEFAULT_MONTHLY_CAP_MINOR,
        currency=DEFAULT_SETTLEMENT_TOKEN,
    )
    preview_charge = harness.simulate_embedded_wallet_charge(
        mandate=preview_mandate,
        amount_minor=DEFAULT_MONTHLY_CAP_MINOR,
        tx_hash="0x" + "a" * 64,
        user_operation_hash="0x" + "b" * 64,
        platform_fee_minor=800,
    )

    import asyncio

    async def _run() -> list[str]:
        dry_run = await harness.dry_run(
            task_type="prepare_subscription_charge",
            input_params={"amount_minor": DEFAULT_MONTHLY_CAP_MINOR, "settlement_token": DEFAULT_SETTLEMENT_TOKEN},
        )
        quote = await harness.execute_quote(
            task_type="prepare_subscription_charge",
            input_params={"amount_minor": DEFAULT_MONTHLY_CAP_MINOR, "settlement_token": DEFAULT_SETTLEMENT_TOKEN},
        )
        payment = await harness.execute_payment(
            task_type="charge_subscription",
            input_params={"amount_minor": DEFAULT_MONTHLY_CAP_MINOR, "settlement_token": DEFAULT_SETTLEMENT_TOKEN},
        )
        return [
            f"tool_manual_valid: {ok} {len(issues)}",
            f"quality_grade: {report.grade} {report.overall_score}",
            f"mandate_status: {preview_mandate.status} cancel_scheduled={preview_mandate.cancel_scheduled}",
            f"charge_tx: {preview_charge.tx_hash} user_operation={preview_charge.user_operation_hash}",
            f"dry_run: {dry_run.success}",
            f"quote: {quote.success}",
            f"payment: {payment.success}",
            f"receipt_issues: {len(harness.validate_receipt(payment))}",
        ]

    return asyncio.run(_run())


def main() -> None:
    for line in run_polygon_mandate_example():
        print(line)


if __name__ == "__main__":
    main()
