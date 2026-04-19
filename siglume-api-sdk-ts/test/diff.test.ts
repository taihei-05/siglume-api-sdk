import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BreakingChange, ChangeLevel, diff_manifest, diff_tool_manual } from "../src/diff";

interface FixtureCase {
  name: string;
  kind: "manifest" | "tool_manual";
  old: Record<string, unknown>;
  new: Record<string, unknown>;
  expected: Array<{ level: string; path: string }>;
  exit_code: number;
}

async function loadCases(): Promise<FixtureCase[]> {
  const raw = await readFile(join(process.cwd(), "..", "tests", "fixtures", "diff_cases.json"), "utf8");
  return JSON.parse(raw) as FixtureCase[];
}

describe("diff rules", () => {
  it("exports the breaking level constant", () => {
    expect(BreakingChange).toBe(ChangeLevel.BREAKING);
  });

  it("matches the manifest and tool-manual golden fixtures", async () => {
    const cases = await loadCases();
    for (const fixture of cases) {
      const changes =
        fixture.kind === "manifest"
          ? diff_manifest({ old: fixture.old, new: fixture.new })
          : diff_tool_manual({ old: fixture.old, new: fixture.new });
      expect(
        changes.map((change) => ({ level: change.level, path: change.path })),
        fixture.name,
      ).toEqual(fixture.expected);
    }
  });

  it("marks breaking changes with is_breaking", async () => {
    const caseData = (await loadCases())[0]!;
    const changes = diff_manifest({ old: caseData.old, new: caseData.new });

    expect(changes.some((change) => change.level === ChangeLevel.BREAKING)).toBe(true);
    expect(changes.every((change) => change.is_breaking === (change.level === ChangeLevel.BREAKING))).toBe(true);
  });

  it("treats identical documents as no-op", async () => {
    const caseData = (await loadCases())[0]!;
    expect(diff_manifest({ old: caseData.old, new: caseData.old })).toEqual([]);
  });

  it("classifies smaller trigger changes as info instead of warning", () => {
    const oldManual = {
      tool_name: "echo_helper",
      job_to_be_done: "Echo the provided query in a structured response.",
      summary_for_model: "Returns the provided query inside a stable echo result.",
      trigger_conditions: [
        "owner asks the agent to echo a request payload",
        "agent needs a trivial read-only smoke-test helper",
        "request is to mirror a provided string in a structured result",
      ],
      do_not_use_when: ["the request needs fresh external data rather than a local echo response"],
      permission_class: "read_only",
      dry_run_supported: true,
      requires_connected_accounts: [],
      input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
      output_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
      usage_hints: ["Use for simple echo smoke tests."],
      result_hints: ["Return the echoed string clearly."],
      error_hints: ["If query is missing, ask for the text to echo."],
    };
    const newManual = {
      ...oldManual,
      trigger_conditions: [
        "owner asks the agent to echo a request payload",
        "agent needs a trivial read-only helper for a smoke test",
        "request is to mirror a provided string in a structured result",
      ],
    };

    const changes = diff_tool_manual({ old: oldManual, new: newManual });

    expect(changes).toEqual([
      expect.objectContaining({ level: ChangeLevel.INFO, path: "trigger_conditions" }),
    ]);
  });

  it("ignores key-order-only changes inside nested schemas", () => {
    const oldManual = {
      tool_name: "schema_echo",
      job_to_be_done: "Echo structured data.",
      summary_for_model: "Returns structured data without mutating state.",
      trigger_conditions: ["owner asks for schema echo"],
      do_not_use_when: ["the request needs side effects"],
      permission_class: "read_only",
      dry_run_supported: true,
      requires_connected_accounts: [],
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Echo payload.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      output_schema: {
        type: "object",
        properties: {
          summary: {
            description: "Summary text.",
            type: "string",
          },
        },
        required: ["summary"],
        additionalProperties: false,
      },
      usage_hints: ["Use for schema smoke tests."],
      result_hints: ["Return the summary first."],
      error_hints: ["Explain missing input clearly."],
    };
    const newManual = {
      ...oldManual,
      output_schema: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Summary text.",
          },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    };

    expect(diff_tool_manual({ old: oldManual, new: newManual })).toEqual([]);
  });

  it("reports required-field additions and removals together", () => {
    const oldManual = {
      tool_name: "echo_helper",
      job_to_be_done: "Echo the provided query in a structured response.",
      summary_for_model: "Returns the provided query inside a stable echo result.",
      trigger_conditions: [
        "owner asks the agent to echo a request payload",
        "agent needs a trivial read-only smoke-test helper",
        "request is to mirror a provided string in a structured result",
      ],
      do_not_use_when: ["the request needs fresh external data rather than a local echo response"],
      permission_class: "read_only",
      dry_run_supported: true,
      requires_connected_accounts: [],
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          locale: { type: "string" },
        },
        required: ["query", "locale"],
        additionalProperties: false,
      },
      output_schema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
        additionalProperties: false,
      },
      usage_hints: ["Use for simple echo smoke tests."],
      result_hints: ["Return the echoed string clearly."],
      error_hints: ["If query is missing, ask for the text to echo."],
    };
    const newManual = {
      ...oldManual,
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          timezone: { type: "string" },
        },
        required: ["query", "timezone"],
        additionalProperties: false,
      },
    };

    const changes = diff_tool_manual({ old: oldManual, new: newManual });

    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: ChangeLevel.BREAKING, path: "input_schema.required" }),
        expect.objectContaining({ level: ChangeLevel.INFO, path: "input_schema.required" }),
      ]),
    );
  });

  it("defaults manifest permission_class to read-only so upgrades from missing are BREAKING (Codex P1 on PR #60)", () => {
    // When an old / legacy manifest omits permission_class, the new
    // manifest escalating to action must still register as BREAKING.
    // Pre-fix, normaliseManifest did not default permission_class, leaving
    // oldRank undefined and downgrading the change to INFO — letting
    // `siglume diff` exit 0 on a genuinely breaking permission escalation.
    const changes = diff_manifest({
      old: { capability_key: "legacy-app", jurisdiction: "US" },
      new: {
        capability_key: "legacy-app",
        jurisdiction: "US",
        permission_class: "action",
      },
    });

    expect(
      changes.some(
        (change) => change.path === "permission_class" && change.level === ChangeLevel.BREAKING,
      ),
    ).toBe(true);
  });
});
