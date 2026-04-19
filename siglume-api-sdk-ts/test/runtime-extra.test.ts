import { describe, expect, it } from "vitest";

import {
  AppAdapter,
  AppCategory,
  AppTestHarness,
  ApprovalMode,
  PermissionClass,
  PriceModel,
  StubProvider,
} from "../src/index";
import type { ExecutionContext, ExecutionResult } from "../src/index";

class RecordingApp extends AppAdapter {
  lastContext: ExecutionContext | null = null;

  manifest() {
    return {
      capability_key: "price-compare-helper",
      name: "Price Compare Helper",
      job_to_be_done: "Compare retailer prices for a product and return the best offer.",
      category: AppCategory.COMMERCE,
      permission_class: PermissionClass.READ_ONLY,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
      jurisdiction: "US",
      short_description: "Returns a structured offer comparison.",
      example_prompts: ["Compare prices for Sony headphones."],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    this.lastContext = ctx;
    return {
      success: true,
      output: { summary: "ok", task_type: ctx.task_type },
    };
  }
}

class BrokenManifestApp extends AppAdapter {
  manifest() {
    return {
      capability_key: "Bad Key",
      name: "",
      job_to_be_done: "",
      category: AppCategory.FINANCE,
      permission_class: PermissionClass.PAYMENT,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: false,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
      jurisdiction: "US",
      example_prompts: [],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: { summary: "broken" },
    };
  }
}

describe("runtime helpers", () => {
  it("normalizes execution results and injects stub connected accounts", async () => {
    const app = new RecordingApp();
    const harness = new AppTestHarness(app, { stripe: new StubProvider("stripe") });

    const result = await harness.dry_run("lookup_price", {
      input_params: { query: "Sony WH-1000XM5" },
      trace_id: "trc_123",
      idempotency_key: "idem_123",
      metadata: { source: "test" },
    });

    expect(result.success).toBe(true);
    expect(result.execution_kind).toBe("dry_run");
    expect(result.units_consumed).toBe(1);
    expect(result.amount_minor).toBe(0);
    expect(result.currency).toBe("USD");
    expect(result.provider_status).toBe("ok");
    expect(app.lastContext?.connected_accounts?.stripe?.provider_key).toBe("stripe");
    expect(app.lastContext?.metadata).toEqual({ source: "test" });
    expect(app.lastContext?.trace_id).toBe("trc_123");
    expect(app.supported_task_types()).toEqual(["default"]);
    await expect(app.on_install("agent", "owner")).resolves.toBeUndefined();
    await expect(app.on_uninstall("agent", "owner")).resolves.toBeUndefined();
    await expect(app.health_check()).resolves.toEqual({ healthy: true, message: "" });
  });

  it("reports manifest and receipt issues for risky app definitions", async () => {
    const harness = new AppTestHarness(new BrokenManifestApp());

    expect(await harness.validate_manifest()).toEqual(
      expect.arrayContaining([
        "capability_key must be lowercase alphanumeric with hyphens (e.g., 'price-compare-helper')",
        "name is required",
        "job_to_be_done is required",
        "at least one example_prompt is recommended",
        "action/payment apps should support dry_run",
        "action/payment apps should not use auto approval",
      ]),
    );

    const issues = harness.validate_receipt({
      success: true,
      execution_kind: "payment",
      output: { summary: "charged" },
      needs_approval: true,
      artifacts: [{} as never],
      side_effects: [{ action: "", provider: "" }],
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        "needs_approval=True but no approval_prompt or approval_hint provided",
        "artifacts[0].artifact_type is empty",
        "side_effects[0].action is empty",
        "side_effects[0].provider is empty",
      ]),
    );
  });

  it("supports stub providers and optional tool-manual validation", async () => {
    const stub = new StubProvider("stripe");
    await expect(stub.handle("quotes.create", { amount_minor: 1500 })).resolves.toEqual({
      status: "stub_ok",
      provider: "stripe",
      method: "quotes.create",
      params: { amount_minor: 1500 },
    });

    const harness = new AppTestHarness(new RecordingApp());
    expect(harness.validate_tool_manual()).toEqual([true, []]);
    const missing = await harness.simulate_connected_account_missing("lookup_price", {
      input_params: { query: "headphones" },
    });
    expect(missing.execution_kind).toBe("dry_run");
  });
});
