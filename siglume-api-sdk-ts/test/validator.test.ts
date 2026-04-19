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

  it("rejects nested composition keywords and patternProperties", () => {
    const manual = cloneBase();
    manual.input_schema = {
      type: "object",
      properties: {
        query: {
          type: "object",
          oneOf: [{ type: "string" }, { type: "number" }],
          patternProperties: { "^x-": { type: "string" } },
        },
      },
      required: ["query"],
      additionalProperties: false,
    };

    const [ok, issues] = validate_tool_manual(manual);

    expect(ok).toBe(false);
    expect(issues.some((issue) => issue.field === "input_schema.query.oneOf")).toBe(true);
    expect(issues.some((issue) => issue.field === "input_schema.query.patternProperties")).toBe(true);
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
});
