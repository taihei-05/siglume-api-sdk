import { describe, expect, it } from "vitest";

import { score_tool_manual_offline, score_tool_manual_remote } from "../src/index";
import { cloneBase } from "./manual-fixtures";

describe("tool manual grader extra branches", () => {
  it("covers the remote scorer wrapper", async () => {
    const report = await score_tool_manual_remote(cloneBase(), {
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            quality: {
              overall_score: 95,
              grade: "A",
              publishable: true,
              keyword_coverage_estimate: 24,
              issues: [],
              improvement_suggestions: [],
            },
          }),
          { status: 200 },
        ),
    });

    expect(report.grade).toBe("A");
    expect(report.publishable).toBe(true);
  });

  it("reports missing and malformed major sections", () => {
    const manual = cloneBase();
    manual.trigger_conditions = [123, "Use when helpful", "Ultimate shopping tool"];
    manual.do_not_use_when = [456, "same words as helpful shopping tool"];
    manual.summary_for_model = 123;
    manual.input_schema = "bad";
    manual.output_schema = { type: "object", properties: {}, required: ["summary"], additionalProperties: false };
    manual.usage_hints = "bad";
    manual.result_hints = [];
    manual.error_hints = ["short"];

    const report = score_tool_manual_offline(manual);

    expect(report.issues.some((issue) => issue.field === "trigger_conditions[0]")).toBe(true);
    expect(report.issues.some((issue) => issue.field === "do_not_use_when[0]")).toBe(true);
    expect(report.issues.some((issue) => issue.field === "summary_for_model")).toBe(true);
    expect(report.issues.some((issue) => issue.field === "input_schema")).toBe(true);
    expect(report.issues.some((issue) => issue.field === "output_schema" && issue.severity === "warning")).toBe(true);
    expect(report.issues.some((issue) => issue.field === "usage_hints")).toBe(true);
    expect(report.issues.some((issue) => issue.field === "result_hints")).toBe(true);
    expect(report.issues.some((issue) => issue.field === "error_hints" && issue.severity === "suggestion")).toBe(true);
  });

  it("checks nested schema descriptions and enum quality", () => {
    const manual = cloneBase();
    manual.input_schema = {
      type: "object",
      properties: {
        query: { type: "string", description: 99 },
        filters: {
          type: "object",
          properties: {
            nested: "bad",
          },
        },
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string", description: "tiny", enum: ["a", "b"] },
            },
          },
        },
      },
      required: ["query"],
      additionalProperties: false,
    };

    const report = score_tool_manual_offline(manual);

    expect(report.issues.some((issue) => issue.field === "input_schema.properties.query")).toBe(true);
    expect(report.issues.some((issue) => issue.field === "input_schema.properties.nested")).toBe(true);
    expect(report.issues.some((issue) => issue.field === "input_schema.properties.code")).toBe(true);
  });

  it("emits every improvement suggestion when quality is broadly weak", () => {
    const manual = cloneBase();
    manual.trigger_conditions = ["Use this", "Call tool", "If helpful"];
    manual.do_not_use_when = [123, "short"];
    manual.summary_for_model = "Amazing";
    manual.input_schema = {
      type: "object",
      properties: {
        query: { type: "string", description: "" },
        store: { type: "string", description: 99 },
      },
      required: ["query"],
      additionalProperties: false,
    };
    manual.output_schema = {
      type: "object",
      properties: {
        summary: { type: "string" },
        details: { type: "string" },
        url: { type: "string" },
      },
      required: ["summary", "details", "url"],
      additionalProperties: false,
    };
    manual.usage_hints = [];
    manual.result_hints = [];
    manual.error_hints = [];

    const report = score_tool_manual_offline(manual);

    expect(["C", "D"]).toContain(report.grade);
    expect(report.improvement_suggestions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Improve trigger_conditions"),
        expect.stringContaining("Add descriptions to all input_schema properties"),
        expect.stringContaining("Rewrite summary_for_model"),
        expect.stringContaining("Add concrete do_not_use_when conditions"),
        expect.stringContaining("Add descriptions to output_schema properties"),
        expect.stringContaining("Expand usage_hints and result_hints"),
      ]),
    );
  });

  it("handles to_dict wrappers and critical hint issues", () => {
    const wrapped = {
      to_dict() {
        const manual = cloneBase();
        manual.usage_hints = [{ bad: true }];
        manual.result_hints = [123];
        manual.error_hints = [false];
        return manual;
      },
    };

    const report = score_tool_manual_offline(wrapped);

    expect(report.publishable).toBe(false);
    expect(report.issues.filter((issue) => issue.severity === "critical")).toHaveLength(3);
  });
});
