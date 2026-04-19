import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  to_anthropic_tool,
  to_mcp_tool,
  to_openai_function,
  to_openai_responses_tool,
} from "../src/exporters";
import type { ToolSchemaExport } from "../src/exporters";
import {
  to_anthropic_tool as root_anthropic_tool,
  to_mcp_tool as root_mcp_tool,
  to_openai_function as root_openai_function,
  to_openai_responses_tool as root_openai_responses_tool,
} from "../src/index";

interface ExporterCase {
  name: string;
  tool_manual: Record<string, unknown>;
  expected: Record<string, { schema: Record<string, unknown>; lossy_fields: string[]; warnings: string[] }>;
}

async function loadCases(): Promise<ExporterCase[]> {
  const raw = await readFile(join(process.cwd(), "..", "tests", "fixtures", "exporter_cases.json"), "utf8");
  return JSON.parse(raw) as ExporterCase[];
}

const EXPORTERS = {
  anthropic: to_anthropic_tool,
  openai_function: to_openai_function,
  openai_responses_tool: to_openai_responses_tool,
  mcp: to_mcp_tool,
} as const;

describe("tool schema exporters", () => {
  it("re-exports the exporter helpers from the package root", () => {
    expect(root_anthropic_tool).toBe(to_anthropic_tool);
    expect(root_openai_function).toBe(to_openai_function);
    expect(root_openai_responses_tool).toBe(to_openai_responses_tool);
    expect(root_mcp_tool).toBe(to_mcp_tool);
  });

  it.each([
    ["read_only_price_lookup", "anthropic"],
    ["read_only_price_lookup", "openai_function"],
    ["read_only_price_lookup", "openai_responses_tool"],
    ["read_only_price_lookup", "mcp"],
    ["payment_wallet_charge", "anthropic"],
    ["payment_wallet_charge", "openai_function"],
    ["payment_wallet_charge", "openai_responses_tool"],
    ["payment_wallet_charge", "mcp"],
  ] as const)("matches the golden fixture for %s via %s", async (caseName, provider) => {
    const cases = await loadCases();
    const fixture = cases.find((item) => item.name === caseName);
    expect(fixture).toBeDefined();

    const result = EXPORTERS[provider](fixture!.tool_manual);
    const typedResult: ToolSchemaExport<unknown> = result;

    expect(typedResult).toEqual(fixture!.expected[provider]);
  });

  it.each([
    ["anthropic", to_anthropic_tool],
    ["openai_function", to_openai_function],
    ["openai_responses_tool", to_openai_responses_tool],
    ["mcp", to_mcp_tool],
  ] as const)("rejects non-mapping input for %s", (_label, exporter) => {
    expect(() => exporter(["not", "a", "tool"] as unknown as Record<string, unknown>)).toThrow(
      /tool_manual must be a mapping-like object/,
    );
  });

  it.each([
    ["anthropic", to_anthropic_tool],
    ["openai_function", to_openai_function],
    ["openai_responses_tool", to_openai_responses_tool],
    ["mcp", to_mcp_tool],
  ] as const)("requires a non-empty tool_name for %s", (_label, exporter) => {
    expect(() =>
      exporter({
        summary_for_model: "Missing tool_name should fail consistently.",
        input_schema: { type: "object" },
        output_schema: { type: "object" },
      }),
    ).toThrow(/tool_manual\.tool_name must be a non-empty string/);
  });

  it("keeps the MCP output schema intact", async () => {
    const cases = await loadCases();
    const fixture = cases.find((item) => item.name === "payment_wallet_charge")!;

    const exported = to_mcp_tool(fixture.tool_manual);

    expect(exported.schema.outputSchema).toEqual(fixture.tool_manual.output_schema);
  });

  it("maps MCP annotations from permission and idempotency semantics", async () => {
    const cases = await loadCases();
    const readOnly = cases.find((item) => item.name === "read_only_price_lookup")!;
    const payment = cases.find((item) => item.name === "payment_wallet_charge")!;

    expect(to_mcp_tool(readOnly.tool_manual).schema.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(to_mcp_tool(payment.tool_manual).schema.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
  });

  it("exports a flat function-tool shape for the OpenAI Responses API", async () => {
    // Codex bot P1 on PR #102: the Responses API requires { type, name,
    // description, parameters, strict } at the top level; the Chat
    // Completions { type, function: {...} } envelope is rejected by
    // client.responses.create(..., tools=[...]).
    const cases = await loadCases();
    const fixture = cases.find((item) => item.name === "read_only_price_lookup")!;

    const exported = to_openai_responses_tool(fixture.tool_manual);

    expect(exported.schema.type).toBe("function");
    expect(exported.schema.name).toBe("product_price_lookup");
    expect(exported.schema.strict).toBe(true);
    expect(exported.schema.description).toBeTypeOf("string");
    expect(exported.schema.parameters).toBeTypeOf("object");
    // The nested Chat-Completions envelope MUST be absent.
    expect((exported.schema as unknown as { function?: unknown }).function).toBeUndefined();
  });
});
