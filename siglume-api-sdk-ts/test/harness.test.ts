import { describe, expect, it } from "vitest";

import {
  AppAdapter,
  AppCategory,
  AppTestHarness,
  ApprovalMode,
  PermissionClass,
  PriceModel,
} from "../src/index";
import type { ExecutionContext, ExecutionResult } from "../src/index";

class PaymentQuoteApp extends AppAdapter {
  manifest() {
    return {
      capability_key: "payment-quote",
      name: "Payment Quote",
      job_to_be_done: "Quote a USD charge and complete the payment only after owner approval.",
      category: AppCategory.FINANCE,
      permission_class: PermissionClass.PAYMENT,
      approval_mode: ApprovalMode.ALWAYS_ASK,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
      jurisdiction: "US",
      short_description: "Preview, quote, and complete a USD payment flow with explicit approval.",
      example_prompts: ["Quote the charge for this premium report purchase."],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const amount_usd = Number(ctx.input_params?.amount_usd ?? 12.5);
    const summary = `Charge USD ${amount_usd.toFixed(2)} for the requested purchase.`;
    if (ctx.execution_kind === "dry_run") {
      return {
        success: true,
        execution_kind: ctx.execution_kind,
        output: { summary, amount_usd, currency: "USD" },
        needs_approval: true,
        approval_prompt: summary,
      };
    }
    if (ctx.execution_kind === "quote") {
      return {
        success: true,
        execution_kind: ctx.execution_kind,
        output: { summary: `Quoted USD ${amount_usd.toFixed(2)}.`, amount_usd, currency: "USD" },
        receipt_summary: { action: "payment_quote_generated", amount_usd, currency: "USD" },
      };
    }
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: { summary: `Charged USD ${amount_usd.toFixed(2)}.`, amount_usd, currency: "USD", payment_id: "pay_123" },
      receipt_summary: { action: "payment_captured", payment_id: "pay_123", amount_usd, currency: "USD" },
    };
  }

  supported_task_types() {
    return ["quote_payment", "charge_payment"];
  }
}

describe("AppTestHarness", () => {
  it("runs dry-run, quote, and payment flows", async () => {
    const harness = new AppTestHarness(new PaymentQuoteApp());

    expect(await harness.validate_manifest()).toEqual([]);
    expect((await harness.dry_run("quote_payment", { input_params: { amount_usd: 12.5 } })).success).toBe(true);
    expect((await harness.execute_quote("quote_payment", { input_params: { amount_usd: 12.5 } })).success).toBe(true);
    expect((await harness.execute_payment("charge_payment", { input_params: { amount_usd: 12.5 } })).success).toBe(true);
  });

  it("reports receipt issues when an action omits receipt details", () => {
    const harness = new AppTestHarness(new PaymentQuoteApp());
    const issues = harness.validate_receipt({
      success: true,
      execution_kind: "action",
      output: { summary: "done" },
      side_effects: [],
    });
    expect(issues).toContain("Action/payment execution should report side effects");
  });

  it("supports health checks and missing-account simulation", async () => {
    const harness = new AppTestHarness(new PaymentQuoteApp());

    const health = await harness.health();
    const missing = await harness.simulate_connected_account_missing("quote_payment", { input_params: { amount_usd: 5 } });

    expect(health.healthy).toBe(true);
    expect(missing.success).toBe(true);
  });
});
