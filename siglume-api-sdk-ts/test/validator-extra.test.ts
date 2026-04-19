import { describe, expect, it } from "vitest";

import { tool_manual_to_dict, validate_tool_manual } from "../src/tool-manual-validator";
import { cloneBase } from "./manual-fixtures";

describe("validate_tool_manual extra branches", () => {
  it("rejects invalid roots and bad scalar constraints", () => {
    const [invalidRootOk, invalidRootIssues] = validate_tool_manual("not a dict");
    expect(invalidRootOk).toBe(false);
    expect(invalidRootIssues[0]?.code).toBe("INVALID_ROOT");

    const manual = cloneBase();
    manual.tool_name = "bad name!";
    manual.job_to_be_done = "short";
    manual.summary_for_model = "short";
    manual.trigger_conditions = new Array(9).fill(
      "owner asks to compare prices for a product before deciding where to buy",
    );
    manual.do_not_use_when = new Array(6).fill(
      "the request is to complete checkout or place an order instead of comparing offers",
    );

    const [ok, issues] = validate_tool_manual(manual);
    expect(ok).toBe(false);
    expect(issues.some((issue) => issue.code === "INVALID_TOOL_NAME")).toBe(true);
    expect(issues.some((issue) => issue.field === "trigger_conditions" && issue.code === "TOO_MANY_ITEMS")).toBe(true);
    expect(issues.some((issue) => issue.field === "do_not_use_when" && issue.code === "TOO_MANY_ITEMS")).toBe(true);
  });

  it("supports to_dict coercion and action/payment field validation", () => {
    const wrapped = {
      to_dict() {
        const manual = cloneBase();
        manual.permission_class = "payment";
        manual.approval_summary_template = "";
        manual.preview_schema = "bad";
        manual.side_effect_summary = "";
        manual.jurisdiction = "usa";
        manual.idempotency_support = false;
        manual.quote_schema = "bad";
        manual.currency = "JPY";
        manual.settlement_mode = "invalid";
        manual.refund_or_cancellation_note = "";
        manual.output_schema = {
          type: "object",
          properties: {
            total: { type: "number" },
          },
          required: [],
          additionalProperties: false,
        };
        return manual;
      },
    };

    const [ok, issues] = validate_tool_manual(wrapped);

    expect(ok).toBe(false);
    expect(issues.some((issue) => issue.field === "approval_summary_template")).toBe(true);
    expect(issues.some((issue) => issue.field === "preview_schema")).toBe(true);
    expect(issues.some((issue) => issue.field === "jurisdiction" && issue.code === "INVALID_JURISDICTION")).toBe(true);
    expect(issues.some((issue) => issue.field === "idempotency_support" && issue.code === "IDEMPOTENCY_REQUIRED")).toBe(true);
    expect(issues.some((issue) => issue.field === "currency" && issue.code === "INVALID_CURRENCY")).toBe(true);
    expect(issues.some((issue) => issue.field === "settlement_mode" && issue.code === "INVALID_SETTLEMENT_MODE")).toBe(true);
    expect(issues.some((issue) => issue.field === "output_schema.properties" && issue.code === "OUTPUT_SCHEMA")).toBe(true);
    expect(issues.some((issue) => issue.field === "output_schema.required" && issue.code === "OUTPUT_SCHEMA")).toBe(true);
  });

  it("exports mapping-like manuals as plain dicts", () => {
    expect(tool_manual_to_dict({ tool_name: "echo_tool" })).toEqual({ tool_name: "echo_tool" });
    expect(tool_manual_to_dict("bad" as unknown as Record<string, unknown>)).toEqual({});
  });
});
