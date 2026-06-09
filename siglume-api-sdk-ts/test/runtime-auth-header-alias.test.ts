import { describe, expect, it } from "vitest";

import { buildRuntimeValidationTemplate, runtimePlaceholderIssues } from "../src/cli/project";

const TOOL_MANUAL = {
  input_schema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  output_schema: { required: ["summary"] },
};

function baseRuntimeValidation(): Record<string, unknown> {
  return {
    public_base_url: "https://api.acme.dev",
    healthcheck_url: "https://api.acme.dev/health",
    invoke_url: "https://api.acme.dev/invoke",
    request_payload: { query: "hello" },
    expected_response_fields: ["summary"],
  };
}

describe("runtime auth header alias", () => {
  it("scaffolds the canonical runtime_auth_header_* fields, not the legacy names", () => {
    const runtimeValidation = buildRuntimeValidationTemplate(TOOL_MANUAL);
    expect(runtimeValidation).toHaveProperty("runtime_auth_header_name");
    expect(runtimeValidation).toHaveProperty("runtime_auth_header_value");
    expect(runtimeValidation).not.toHaveProperty("test_auth_header_name");
    expect(runtimeValidation).not.toHaveProperty("test_auth_header_value");
    expect(String(runtimeValidation.runtime_auth_header_value)).toMatch(/^replace-with-/);
  });

  it("accepts the canonical runtime_auth_header_* alias in preflight", () => {
    const runtimeValidation = {
      ...baseRuntimeValidation(),
      runtime_auth_header_name: "X-Siglume-Auth",
      runtime_auth_header_value: "strong-random-shared-secret",
    };
    const issues = runtimePlaceholderIssues(runtimeValidation);
    expect(issues.some((issue) => issue.includes("auth_header"))).toBe(false);
  });

  it("still accepts the legacy test_auth_header_* alias in preflight", () => {
    const runtimeValidation = {
      ...baseRuntimeValidation(),
      test_auth_header_name: "X-Legacy",
      test_auth_header_value: "strong-random-shared-secret",
    };
    const issues = runtimePlaceholderIssues(runtimeValidation);
    expect(issues.some((issue) => issue.includes("auth_header"))).toBe(false);
  });

  it("flags a missing auth header with the runtime-named message", () => {
    const issues = runtimePlaceholderIssues(baseRuntimeValidation());
    expect(issues.some((issue) => issue.includes("runtime_auth_header_name is required"))).toBe(true);
  });

  it("flags a placeholder runtime auth secret", () => {
    const runtimeValidation = {
      ...baseRuntimeValidation(),
      runtime_auth_header_name: "X-Siglume-Auth",
      runtime_auth_header_value: "replace-with-strong-random-runtime-auth-secret",
    };
    const issues = runtimePlaceholderIssues(runtimeValidation);
    expect(issues.some((issue) => issue.includes("runtime_auth_header_value must be a strong"))).toBe(true);
  });

  it("falls back to the legacy alias when the new key is an empty string", () => {
    const runtimeValidation = {
      ...baseRuntimeValidation(),
      runtime_auth_header_name: "",
      runtime_auth_header_value: "",
      test_auth_header_name: "X-Legacy",
      test_auth_header_value: "strong-random-shared-secret",
    };
    const issues = runtimePlaceholderIssues(runtimeValidation);
    expect(issues.some((issue) => issue.includes("auth_header"))).toBe(false);
  });
});
