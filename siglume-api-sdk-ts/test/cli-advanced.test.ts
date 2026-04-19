import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import type { SiglumeClientShape } from "../src/index";
import { runCli } from "../src/cli/index";

function createMockClient(publishable = true): SiglumeClientShape {
  return {
    async preview_quality_score() {
      return {
        overall_score: publishable ? 92 : 72,
        grade: publishable ? "A" : "C",
        issues: [],
        keyword_coverage_estimate: 30,
        improvement_suggestions: [],
        publishable,
        validation_ok: true,
        validation_errors: [],
        validation_warnings: [],
      };
    },
    async auto_register() {
      return {
        listing_id: "lst_123",
        status: "draft",
        auto_manifest: {},
        confidence: {},
      };
    },
    async confirm_registration() {
      return {
        listing_id: "lst_123",
        status: "pending_review",
        release: {},
        quality: {
          overall_score: 84,
          grade: "B",
          issues: [],
          improvement_suggestions: [],
          raw: {},
        },
        raw: {},
      };
    },
    async get_usage() {
      return {
        items: [],
        meta: {},
      };
    },
    async create_support_case() {
      return {
        support_case_id: "case_123",
        case_type: "app_execution",
        summary: "help",
        status: "open",
        metadata: {},
        raw: {},
      };
    },
  } as unknown as SiglumeClientShape;
}

async function createEchoProject(validManual = true): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "siglume-ts-cli-advanced-"));
  const importHref = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
  const adapterSource = [
    `import { AppAdapter, AppCategory, ApprovalMode, PermissionClass, PriceModel } from "${importHref}";`,
    "",
    "export default class EchoApp extends AppAdapter {",
    "  manifest() {",
    "    return {",
    '      capability_key: "echo-helper",',
    '      name: "Echo Helper",',
    '      job_to_be_done: "Return the provided input in a structured echo response.",',
    "      category: AppCategory.OTHER,",
    "      permission_class: PermissionClass.READ_ONLY,",
    "      approval_mode: ApprovalMode.AUTO,",
    "      dry_run_supported: true,",
    "      required_connected_accounts: [],",
    "      price_model: PriceModel.FREE,",
    '      jurisdiction: "US",',
    '      short_description: "Simple echo helper.",',
    '      example_prompts: ["Echo this back to me."],',
    "    };",
    "  }",
    "  async execute(ctx) {",
    "    return { success: true, execution_kind: ctx.execution_kind, output: { summary: 'ok', input: ctx.input_params } };",
    "  }",
    "}",
    "",
  ].join("\n");
  const toolManual = {
    tool_name: "echo_helper",
    job_to_be_done: "Return the provided input in a structured echo response.",
    summary_for_model: "Echoes the provided request back in a structured response.",
    trigger_conditions: [
      "owner asks the agent to echo or repeat back a request payload",
      "agent needs a trivial read-only helper for test or wiring validation",
      "request is to mirror a provided string in a structured result",
    ],
    do_not_use_when: ["the request needs external data rather than a local echo response"],
    permission_class: "read_only",
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "String to echo back." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line echo result." },
      },
      required: ["summary"],
      additionalProperties: false,
    },
    usage_hints: validManual ? ["Use for basic read-only smoke tests."] : undefined,
    result_hints: ["Show the echoed payload in plain language."],
    error_hints: ["If input is missing, ask for the text to echo."],
  };

  await writeFile(join(dir, "adapter.ts"), adapterSource, "utf8");
  await writeFile(join(dir, "tool_manual.json"), JSON.stringify(toolManual, null, 2), "utf8");
  return dir;
}

describe("siglume CLI advanced branches", () => {
  it("prints text-mode output for init, score, support, and usage", async () => {
    const initDir = await mkdtemp(join(tmpdir(), "siglume-ts-init-text-"));
    const scoreDir = await createEchoProject();
    const stdout: string[] = [];

    const initExit = await runCli(["init", initDir], { stdout: (line) => stdout.push(line) });
    const packageLinkDir = join(initDir, "node_modules", "@siglume");
    await mkdir(packageLinkDir, { recursive: true });
    await symlink(process.cwd(), join(packageLinkDir, "api-sdk"), "junction");
    const scoreExit = await runCli(["score", scoreDir, "--offline"], {
      stdout: (line) => stdout.push(line),
      env: { SIGLUME_API_KEY: "sig_test_key" },
      client_factory: () => createMockClient(true),
    });
    const supportExit = await runCli(["support", "create", "--subject", "help", "--body", "details"], {
      stdout: (line) => stdout.push(line),
      env: { SIGLUME_API_KEY: "sig_test_key" },
      client_factory: () => createMockClient(true),
    });
    const usageExit = await runCli(["usage"], {
      stdout: (line) => stdout.push(line),
      env: { SIGLUME_API_KEY: "sig_test_key" },
      client_factory: () => createMockClient(true),
    });

    expect(initExit).toBe(0);
    expect(scoreExit).toBe(0);
    expect(supportExit).toBe(0);
    expect(usageExit).toBe(0);
    expect(stdout.some((line) => line.includes("Initialized Siglume starter template"))).toBe(true);
    expect(stdout.some((line) => line.includes("Offline quality:"))).toBe(true);
    expect(stdout.some((line) => line.includes("Support case created."))).toBe(true);
    expect(stdout.some((line) => line.includes("Usage events: 0"))).toBe(true);
    expect(await readFile(join(initDir, "README.md"), "utf8")).toContain("siglume init");
  });

  it("returns project errors for failed validate and score commands", async () => {
    const invalidProject = await createEchoProject(false);
    const stderr: string[] = [];
    const validateExit = await runCli(["validate", invalidProject], {
      stderr: (line) => stderr.push(line),
      env: { SIGLUME_API_KEY: "sig_test_key" },
      client_factory: () => createMockClient(true),
    });
    const scoreExit = await runCli(["score", invalidProject, "--remote"], {
      stderr: (line) => stderr.push(line),
      env: { SIGLUME_API_KEY: "sig_test_key" },
      client_factory: () => createMockClient(false),
    });

    expect(validateExit).toBe(1);
    expect(scoreExit).toBe(1);
    expect(stderr).toEqual(expect.arrayContaining(["Validation failed.", "Score failed."]));
  });

  it("returns commander exit codes for help and unknown commands", async () => {
    const helpExit = await runCli(["--help"]);
    const badExit = await runCli(["definitely-not-a-command"]);

    expect(helpExit).toBe(0);
    expect(badExit).toBe(1);
  });
});
