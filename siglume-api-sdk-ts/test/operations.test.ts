import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPERATION_AGENT_ID,
  buildOperationMetadata,
  defaultCapabilityKeyForOperation,
  defaultOperationOutputSchema,
  fallbackOperationCatalog,
} from "../src/operations";

describe("owner operation metadata helpers", () => {
  it("normalizes capability keys for operation wrappers", () => {
    expect(defaultCapabilityKeyForOperation("owner.approval_policy.update")).toBe(
      "my-owner-approval-policy-update-wrapper",
    );
  });

  it("returns the bundled fallback catalog with a stable agent id", () => {
    const catalog = fallbackOperationCatalog("agt_owner_custom");

    expect(catalog).toHaveLength(6);
    expect(catalog.every((item) => item.agent_id === "agt_owner_custom")).toBe(true);
    expect(catalog.map((item) => item.operation_key)).toContain("owner.budget.update");
  });

  it("applies rich override metadata for known operations", () => {
    const metadata = buildOperationMetadata(
      { name: "owner.charter.update" },
      { agent_id: "agt_override", source: "fallback" },
    );

    expect(metadata.permission_class).toBe("action");
    expect(metadata.approval_mode).toBe("always-ask");
    expect(metadata.required_params).toEqual(["goals"]);
    expect(
      ((metadata.input_schema.properties as Record<string, unknown>).agent_id as Record<string, unknown>).default,
    ).toBe("agt_override");
    expect(metadata.output_schema).toEqual(defaultOperationOutputSchema());
  });

  it("builds inferred schemas for unknown operations", () => {
    const metadata = buildOperationMetadata(
      {
        name: "owner.inventory.update",
        summary: "Update inventory thresholds.",
        allowed_params: ["limit", "structured_only", "metadata", "always_require_approval_for"],
        required_params: [],
        requires_params: true,
      },
      { agent_id: "agt_inventory", source: "live" },
    );

    const properties = metadata.input_schema.properties as Record<string, Record<string, unknown>>;

    expect(metadata.permission_class).toBe("action");
    expect(metadata.approval_mode).toBe("always-ask");
    expect(metadata.required_params).toEqual([]);
    expect(metadata.input_schema.required).toEqual(["limit"]);
    expect(properties.limit?.type).toBe("integer");
    expect(properties.structured_only?.type).toBe("boolean");
    expect(properties.metadata?.type).toBe("object");
    expect(properties.always_require_approval_for?.type).toBe("array");
  });

  it("prefers explicit payload fields over inferred defaults", () => {
    const metadata = buildOperationMetadata(
      {
        operation_key: "owner.inventory.get",
        summary: "Read inventory thresholds.",
        params_summary: "Optional projection.",
        permission_class: "read-only",
        approval_mode: "auto",
        allowed_params: ["projection"],
        required_params: ["projection"],
        requires_params: true,
        param_types: { projection: "dict" },
        input_schema: {
          type: "object",
          properties: {
            projection: { type: "object", default: { fields: ["sku"] } },
          },
          required: ["projection"],
          additionalProperties: false,
        },
        output_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            result: { type: "object" },
          },
          required: ["summary", "result"],
          additionalProperties: false,
        },
        page_href: "/owner/inventory",
      },
      { agent_id: "agt_inventory", source: "live" },
    );

    expect(metadata.summary).toBe("Read inventory thresholds.");
    expect(metadata.params_summary).toBe("Optional projection.");
    expect(metadata.page_href).toBe("/owner/inventory");
    expect(metadata.param_types).toEqual({ projection: "dict" });
    expect(metadata.input_schema.required).toEqual(["projection"]);
    expect((metadata.output_schema.properties as Record<string, unknown>).result).toBeTruthy();
  });

  it("uses the default agent id when fallback catalog is requested without one", () => {
    const catalog = fallbackOperationCatalog();

    expect(catalog.every((item) => item.agent_id === DEFAULT_OPERATION_AGENT_ID)).toBe(true);
  });

  it("throws when operation_key is missing", () => {
    expect(() => buildOperationMetadata({}, { source: "live" })).toThrow("operation_key is required");
  });
});
