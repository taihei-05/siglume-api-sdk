"""Example: quote and charge a payment with dry-run + quote support."""
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
    ToolManual,
    ToolManualPermissionClass,
    validate_tool_manual,
)


class PaymentQuoteApp(AppAdapter):
    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="payment-quote",
            name="Payment Quote",
            job_to_be_done="Quote a USD charge and complete the payment only after owner approval.",
            category=AppCategory.FINANCE,
            permission_class=PermissionClass.PAYMENT,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Preview, quote, and complete a USD payment flow with explicit approval.",
            example_prompts=["Quote the charge for this premium report purchase."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        amount_usd = float(ctx.input_params.get("amount_usd") or 12.5)
        summary = f"Charge USD {amount_usd:.2f} for the requested purchase."
        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output={"summary": summary, "amount_usd": amount_usd, "currency": "USD"},
                needs_approval=True,
                approval_prompt=summary,
            )
        if ctx.execution_kind == ExecutionKind.QUOTE:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output={"summary": f"Quoted USD {amount_usd:.2f}.", "amount_usd": amount_usd, "currency": "USD"},
                units_consumed=1,
                receipt_summary={"action": "payment_quote_generated", "amount_usd": amount_usd, "currency": "USD"},
            )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={"summary": f"Charged USD {amount_usd:.2f}.", "amount_usd": amount_usd, "currency": "USD", "payment_id": "pay_123"},
            units_consumed=1,
            receipt_summary={"action": "payment_captured", "payment_id": "pay_123", "amount_usd": amount_usd, "currency": "USD"},
        )

    def supported_task_types(self) -> list[str]:
        return ["quote_payment", "charge_payment"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="payment_quote",
        job_to_be_done="Quote a USD payment amount and then complete the charge only after the owner approves it.",
        summary_for_model="Previews and quotes a USD payment amount, then completes the charge after explicit owner approval.",
        trigger_conditions=[
            "owner asks for the price of a purchase before deciding whether to approve it",
            "agent needs to quote a USD charge and then complete payment after approval",
            "request is to preview or charge a payment rather than only returning read-only information",
        ],
        do_not_use_when=[
            "the owner only wants accounting advice and does not want to quote or charge a payment",
            "the request is to compare prices without initiating any payment flow",
        ],
        permission_class=ToolManualPermissionClass.PAYMENT,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "amount_usd": {"type": "number", "description": "USD amount to quote or charge."},
                "purchase_label": {"type": "string", "description": "Human-readable description of the purchase.", "default": "premium report"},
            },
            "required": ["amount_usd"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line summary of the quote or payment result."},
                "amount_usd": {"type": "number", "description": "USD amount that was quoted or charged."},
                "currency": {"type": "string", "description": "Currency code for the quote or charge."},
                "payment_id": {"type": "string", "description": "Payment identifier when a charge is completed."},
            },
            "required": ["summary", "amount_usd", "currency"],
            "additionalProperties": False,
        },
        usage_hints=["Use dry_run or quote first so the owner can review the amount before any payment is attempted."],
        result_hints=["Show the quoted or charged USD amount before any secondary details such as payment_id."],
        error_hints=["If the amount is missing or invalid, ask the owner for a concrete USD amount before retrying."],
        approval_summary_template="Charge USD {amount_usd} for {purchase_label}.",
        preview_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Preview of the payment that would be charged."},
            },
            "required": ["summary"],
            "additionalProperties": False,
        },
        idempotency_support=True,
        side_effect_summary="Captures a USD payment when the owner approves the charge.",
        quote_schema={
            "type": "object",
            "properties": {
                "amount_usd": {"type": "number", "description": "Quoted USD amount."},
                "currency": {"type": "string", "description": "Currency code for the quote."},
            },
            "required": ["amount_usd", "currency"],
            "additionalProperties": False,
        },
        currency="USD",
        settlement_mode=SettlementMode.EMBEDDED_WALLET_CHARGE,
        refund_or_cancellation_note="Refunds are handled according to the merchant's cancellation policy before settlement is finalized.",
        jurisdiction="US",
    )


async def main() -> None:
    harness = AppTestHarness(PaymentQuoteApp())
    ok, issues = validate_tool_manual(build_tool_manual())
    print("tool_manual_valid:", ok, len(issues))
    print("manifest_issues:", harness.validate_manifest())
    print("dry_run:", (await harness.dry_run(task_type="quote_payment", input_params={"amount_usd": 12.5})).success)
    print("quote:", (await harness.execute_quote(task_type="quote_payment", input_params={"amount_usd": 12.5})).success)
    print("payment:", (await harness.execute_payment(task_type="charge_payment", input_params={"amount_usd": 12.5})).success)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
