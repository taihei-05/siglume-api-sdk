import { describe, expect, it } from "vitest";

import { score_tool_manual_offline, validate_tool_manual } from "../src/index";
import { buildParityCases, cloneBase, EXPECTED_PARITY } from "./manual-fixtures";

describe("tool manual offline grader", () => {
  for (const [caseName, manual] of buildParityCases()) {
    it(`stays within parity window for ${caseName}`, () => {
      const report = score_tool_manual_offline(manual);
      const expected = EXPECTED_PARITY[caseName]!;
      expect(Math.abs(report.overall_score - expected.overall_score)).toBeLessThanOrEqual(5);
      expect(report.keyword_coverage_estimate).toBe(expected.keyword_coverage_estimate);
    });
  }

  it("exposes validation and publishable state", () => {
    const manual = cloneBase();
    delete manual.usage_hints;

    const report = score_tool_manual_offline(manual);

    expect(report.validation_ok).toBe(false);
    expect(report.publishable).toBe(false);
    expect(report.validation_errors?.some((issue) => issue.code === "MISSING_FIELD")).toBe(true);
    expect(report.issues.some((issue) => issue.field === "usage_hints")).toBe(true);
  });

  it("blocks publishable status for non-string hint items", () => {
    const manual = cloneBase();
    manual.usage_hints = [123];

    const report = score_tool_manual_offline(manual);

    expect(report.overall_score).toBe(90);
    expect(report.publishable).toBe(false);
    expect(report.issues.some((issue) => issue.field === "usage_hints[0]" && issue.severity === "critical")).toBe(true);
  });

  it("validates a well-formed baseline manual", () => {
    const [ok, issues] = validate_tool_manual(cloneBase());
    expect(ok).toBe(true);
    expect(issues).toHaveLength(0);
  });
});
