import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validate_tool_manual } from "../src/index";
import { cloneBase } from "./manual-fixtures";

describe("validate_tool_manual", () => {
  it("flags hyphenated permission classes and missing payment fields", () => {
    const manual = cloneBase();
    manual.permission_class = "read-only";

    const [ok, issues] = validate_tool_manual(manual);

    expect(ok).toBe(false);
    expect(issues.some((issue) => issue.code === "INVALID_PERMISSION_CLASS")).toBe(true);
  });

  it("allows composition keywords but rejects nested patternProperties", () => {
    const manual = cloneBase();
    manual.input_schema = {
      type: "object",
      properties: {
        query: {
          oneOf: [
            { type: "string" },
            {
              type: "object",
              patternProperties: { "^x-": { type: "string" } },
            },
          ],
        },
      },
      required: ["query"],
      additionalProperties: false,
    };

    const [ok, issues] = validate_tool_manual(manual);

    expect(ok).toBe(false);
    expect(issues.some((issue) => issue.field === "input_schema.query.oneOf")).toBe(false);
    expect(issues.some((issue) => issue.field === "input_schema.query.oneOf[1].patternProperties")).toBe(true);
  });

  it("warns about platform-injected input fields", () => {
    const manual = cloneBase();
    (manual.input_schema as Record<string, unknown>).properties = {
      query: { type: "string", description: "Product query." },
      trace_id: { type: "string", description: "should be omitted" },
    };

    const [, issues] = validate_tool_manual(manual);

    expect(issues.some((issue) => issue.field === "input_schema.properties.trace_id" && issue.severity === "warning")).toBe(true);
  });

  it("requires payment-specific output fields", () => {
    const manual = cloneBase();
    manual.permission_class = "payment";
    manual.approval_summary_template = "Charge USD {amount_usd}.";
    manual.preview_schema = { type: "object", properties: { summary: { type: "string", description: "Preview" } }, required: ["summary"], additionalProperties: false };
    manual.idempotency_support = true;
    manual.side_effect_summary = "Captures a USD payment.";
    manual.quote_schema = { type: "object", properties: { amount_usd: { type: "number", description: "Amount" } }, required: ["amount_usd"], additionalProperties: false };
    manual.currency = "USD";
    manual.settlement_mode = "embedded_wallet_charge";
    manual.refund_or_cancellation_note = "Refunds follow merchant policy.";
    manual.jurisdiction = "US";

    const [ok, issues] = validate_tool_manual(manual);

    expect(ok).toBe(false);
    expect(issues.some((issue) => issue.field === "output_schema.required")).toBe(true);
  });

  it("accepts the paid Action subscription auto-register template", () => {
    const payload = JSON.parse(
      readFileSync(new URL("../../examples/paid_action_subscription/auto_register_payload.json", import.meta.url), "utf8"),
    ) as { tool_manual: Record<string, unknown> };

    const [ok, issues] = validate_tool_manual(payload.tool_manual);
    const inputSchema = payload.tool_manual.input_schema as { properties: Record<string, unknown> };

    expect(ok).toBe(true);
    expect(payload.tool_manual.jurisdiction).toBe("US");
    expect(inputSchema.properties.dry_run).toBeUndefined();
    expect(issues.some((issue) => issue.field === "input_schema.properties.dry_run")).toBe(false);
  });
});
