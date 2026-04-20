import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import type { SiglumeClientShape } from "../src/index";
import { runCli } from "../src/cli/index";

function createMockClient() {
  return {
    async preview_quality_score() {
      return {
        overall_score: 92,
        grade: "A",
        issues: [],
        keyword_coverage_estimate: 30,
        improvement_suggestions: [],
        publishable: true,
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
    async submit_review() {
      return {
        listing_id: "lst_123",
        capability_key: "payment-quote",
        name: "Payment Quote",
        status: "pending_review",
        dry_run_supported: true,
        price_value_minor: 0,
        currency: "USD",
        submission_blockers: [],
        raw: {},
      };
    },
    async get_usage() {
      return {
        items: [],
        meta: {},
        async all_items() {
          return [];
        },
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
    async list_operations() {
      return [
        {
          operation_key: "owner.charter.update",
          summary: "Update the owner charter.",
          params_summary: "Supports goals and constraints.",
          page_href: "/owner/charters",
          allowed_params: ["goals", "constraints"],
          required_params: ["goals"],
          requires_params: true,
          param_types: { goals: "dict", constraints: "dict" },
          permission_class: "action",
          approval_mode: "always-ask",
          input_schema: {
            type: "object",
            properties: {
              agent_id: { type: "string", default: "agt_owner_demo" },
              goals: {
                type: "object",
                properties: {
                  charter_text: { type: "string", default: "Prefer explicit approvals." },
                },
                required: ["charter_text"],
                additionalProperties: true,
              },
              constraints: { type: "object", default: {} },
            },
            required: ["goals"],
            additionalProperties: false,
          },
          output_schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              action: { type: "string" },
              result: { type: "object" },
            },
            required: ["summary", "action", "result"],
            additionalProperties: false,
          },
          agent_id: "agt_owner_demo",
          source: "live",
          raw: {},
        },
      ];
    },
    async execute_owner_operation(agent_id: string, operation_key: string, params: Record<string, unknown>) {
      return {
        agent_id,
        operation_key,
        message: `Executed ${operation_key}.`,
        action: operation_key.replaceAll(".", "_"),
        result: { ok: true, params },
        raw: {},
      };
    },
  };
}

async function createTestProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "siglume-ts-cli-"));
  const importHref = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
  const adapterSource = [
    `import { AppAdapter, AppCategory, ApprovalMode, PermissionClass, PriceModel } from "${importHref}";`,
    "",
    "export default class PaymentQuoteApp extends AppAdapter {",
    "  manifest() {",
    "    return {",
    "      capability_key: \"payment-quote\",",
    "      name: \"Payment Quote\",",
    "      job_to_be_done: \"Quote a USD charge and complete the payment only after owner approval.\",",
    "      category: AppCategory.FINANCE,",
    "      permission_class: PermissionClass.PAYMENT,",
    "      approval_mode: ApprovalMode.ALWAYS_ASK,",
    "      dry_run_supported: true,",
    "      required_connected_accounts: [],",
    "      price_model: PriceModel.FREE,",
    "      jurisdiction: \"US\",",
    "      short_description: \"Preview, quote, and complete a USD payment flow with explicit approval.\",",
    "      example_prompts: [\"Quote the charge for this premium report purchase.\"],",
    "    };",
    "  }",
    "",
    "  async execute(ctx) {",
    "    const amountUsd = Number(ctx.input_params?.amount_usd ?? 12.5);",
    "    const summary = `Charge USD ${amountUsd.toFixed(2)} for the requested purchase.`;",
    "    if (ctx.execution_kind === \"dry_run\") {",
    "      return { success: true, execution_kind: ctx.execution_kind, output: { summary, amount_usd: amountUsd, currency: \"USD\" }, needs_approval: true, approval_prompt: summary };",
    "    }",
    "    if (ctx.execution_kind === \"quote\") {",
    "      return { success: true, execution_kind: ctx.execution_kind, output: { summary: `Quoted USD ${amountUsd.toFixed(2)}.`, amount_usd: amountUsd, currency: \"USD\" }, receipt_summary: { action: \"payment_quote_generated\", amount_usd: amountUsd, currency: \"USD\" } };",
    "    }",
    "    return { success: true, execution_kind: ctx.execution_kind, output: { summary: `Charged USD ${amountUsd.toFixed(2)}.`, amount_usd: amountUsd, currency: \"USD\", payment_id: \"pay_123\" }, receipt_summary: { action: \"payment_captured\", payment_id: \"pay_123\", amount_usd: amountUsd, currency: \"USD\" } };",
    "  }",
    "",
    "  supported_task_types() {",
    "    return [\"quote_payment\", \"charge_payment\"];",
    "  }",
    "}",
    "",
  ].join("\n");
  const toolManual = {
    tool_name: "payment_quote",
    job_to_be_done: "Quote a USD payment amount and then complete the charge only after the owner approves it.",
    summary_for_model: "Previews and quotes a USD payment amount, then completes the charge after explicit owner approval.",
    trigger_conditions: [
      "owner asks for the price of a purchase before deciding whether to approve it",
      "agent needs to quote a USD charge and then complete payment after approval",
      "request is to preview or charge a payment rather than only returning read-only information",
    ],
    do_not_use_when: [
      "the owner only wants accounting advice and does not want to quote or charge a payment",
      "the request is to compare prices without initiating any payment flow",
    ],
    permission_class: "payment",
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        amount_usd: { type: "number", description: "USD amount to quote or charge." },
      },
      required: ["amount_usd"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line summary of the quote or payment result." },
        amount_usd: { type: "number", description: "USD amount that was quoted or charged." },
        currency: { type: "string", description: "Currency code for the quote or charge." },
      },
      required: ["summary", "amount_usd", "currency"],
      additionalProperties: false,
    },
    usage_hints: ["Use dry_run or quote first so the owner can review the amount before any payment is attempted."],
    result_hints: ["Show the quoted or charged USD amount before any secondary details such as payment_id."],
    error_hints: ["If the amount is missing or invalid, ask the owner for a concrete USD amount before retrying."],
    approval_summary_template: "Charge USD {amount_usd}.",
    preview_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Preview of the payment that would be charged." },
      },
      required: ["summary"],
      additionalProperties: false,
    },
    idempotency_support: true,
    side_effect_summary: "Captures a USD payment when the owner approves the charge.",
    quote_schema: {
      type: "object",
      properties: {
        amount_usd: { type: "number", description: "Quoted USD amount." },
        currency: { type: "string", description: "Currency code for the quote." },
      },
      required: ["amount_usd", "currency"],
      additionalProperties: false,
    },
    currency: "USD",
    settlement_mode: "embedded_wallet_charge",
    refund_or_cancellation_note: "Refunds are handled according to the merchant's cancellation policy.",
    jurisdiction: "US",
  };

  await writeFile(join(dir, "adapter.ts"), adapterSource, "utf8");
  await writeFile(join(dir, "tool_manual.json"), JSON.stringify(toolManual, null, 2), "utf8");
  return dir;
}

async function linkSourcePackage(projectDir: string): Promise<void> {
  const scopedDir = join(projectDir, "node_modules", "@siglume");
  const packageDir = join(scopedDir, "api-sdk");
  await mkdir(scopedDir, { recursive: true });
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify(
      {
        name: "@siglume/api-sdk",
        type: "module",
        exports: {
          ".": "./src/index.ts",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await symlink(join(process.cwd(), "src"), join(packageDir, "src"), "junction");
}

describe("siglume CLI", () => {
  it("runs offline score and harness flows", async () => {
    const projectDir = await createTestProject();
    const stdout: string[] = [];
    const clientFactory = () => createMockClient();

    const scoreExit = await runCli(["score", projectDir, "--offline", "--json"], {
      stdout: (line) => stdout.push(line),
      client_factory: clientFactory as unknown as (api_key: string, base_url?: string) => SiglumeClientShape,
      env: { SIGLUME_API_KEY: "sig_test_key" },
    });
    const testExit = await runCli(["test", projectDir, "--json"], {
      stdout: (line) => stdout.push(line),
      client_factory: clientFactory as unknown as (api_key: string, base_url?: string) => SiglumeClientShape,
      env: { SIGLUME_API_KEY: "sig_test_key" },
    });

    expect(scoreExit).toBe(0);
    expect(testExit).toBe(0);
    expect(stdout.some((line) => line.includes("\"overall_score\": 100"))).toBe(true);
    expect(stdout.some((line) => line.includes("\"ok\": true"))).toBe(true);
  });

  it("supports init and validate with a mocked remote client", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "siglume-ts-init-"));
    const stdout: string[] = [];
    const clientFactory = () => createMockClient();

    const initExit = await runCli(["init", projectDir, "--template", "echo", "--json"], {
      stdout: (line) => stdout.push(line),
    });
    await linkSourcePackage(projectDir);
    const validateExit = await runCli(["validate", projectDir, "--json"], {
      stdout: (line) => stdout.push(line),
      client_factory: clientFactory as unknown as (api_key: string, base_url?: string) => SiglumeClientShape,
      env: { SIGLUME_API_KEY: "sig_test_key" },
    });

    expect(initExit).toBe(0);
    expect(validateExit).toBe(0);
    const manifest = JSON.parse(await readFile(join(projectDir, "manifest.json"), "utf8")) as Record<string, unknown>;
    const validatePayload = JSON.parse(stdout.at(-1) as string) as Record<string, unknown>;
    expect(manifest.capability_key).toBe("echo-starter");
    expect(validatePayload.ok).toBe(true);
  });

  it("lists owner operations and generates an operation wrapper", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "siglume-ts-op-init-"));
    const stdout: string[] = [];
    const clientFactory = () => createMockClient();

    const listExit = await runCli(["init", "--list-operations", "--json"], {
      stdout: (line) => stdout.push(line),
      client_factory: clientFactory as unknown as (api_key: string, base_url?: string) => SiglumeClientShape,
      env: { SIGLUME_API_KEY: "sig_test_key" },
    });
    const initExit = await runCli(
      ["init", "--from-operation", "owner.charter.update", "--capability-key", "my-charter-wrapper", projectDir, "--json"],
      {
        stdout: (line) => stdout.push(line),
        client_factory: clientFactory as unknown as (api_key: string, base_url?: string) => SiglumeClientShape,
        env: { SIGLUME_API_KEY: "sig_test_key" },
      },
    );
    await linkSourcePackage(projectDir);
    const harnessExit = await runCli(["test", projectDir, "--json"], {
      stdout: (line) => stdout.push(line),
      client_factory: clientFactory as unknown as (api_key: string, base_url?: string) => SiglumeClientShape,
      env: { SIGLUME_API_KEY: "sig_test_key" },
    });

    expect(listExit).toBe(0);
    expect(initExit).toBe(0);
    expect(harnessExit).toBe(0);
    const listPayload = JSON.parse(stdout[0] as string) as Record<string, unknown>;
    const initPayload = JSON.parse(stdout[1] as string) as Record<string, unknown>;
    expect(listPayload.source).toBe("live");
    expect((listPayload.operations as Array<Record<string, unknown>>)[0]?.operation_key).toBe("owner.charter.update");
    expect(initPayload.mode).toBe("from-operation");
    expect((initPayload.operation as Record<string, unknown>).operation_key).toBe("owner.charter.update");
    expect(await readFile(join(projectDir, "adapter.ts"), "utf8")).toContain("execute_owner_operation");
    expect(await readFile(join(projectDir, "tool_manual.json"), "utf8")).toContain("\"owner_charter_update\"");
  });

  it("covers register, support, and usage commands with mocked client methods", async () => {
    const projectDir = await createTestProject();
    const stdout: string[] = [];
    const seen: { trace_id?: string; submit_review_calls: number } = { submit_review_calls: 0 };
    const clientFactory = () => ({
      ...createMockClient(),
      async submit_review() {
        seen.submit_review_calls += 1;
        return {
          listing_id: "lst_123",
          capability_key: "payment-quote",
          name: "Payment Quote",
          status: "pending_review",
          dry_run_supported: true,
          price_value_minor: 0,
          currency: "USD",
          submission_blockers: [],
          raw: {},
        };
      },
      async create_support_case(_subject: string, _body: string, options?: { trace_id?: string }) {
        seen.trace_id = options?.trace_id;
        return {
          support_case_id: "case_123",
          case_type: "app_execution",
          summary: "help",
          status: "open",
          metadata: {},
          raw: {},
        };
      },
    });

    const registerExit = await runCli(["register", projectDir, "--submit-review", "--json"], {
      stdout: (line) => stdout.push(line),
      client_factory: clientFactory as unknown as (api_key: string, base_url?: string) => SiglumeClientShape,
      env: { SIGLUME_API_KEY: "sig_test_key" },
    });
    const supportExit = await runCli(
      ["support", "create", "--subject", "help", "--body", "details", "--trace-id", "trc_123", "--json"],
      {
        stdout: (line) => stdout.push(line),
        client_factory: clientFactory as unknown as (api_key: string, base_url?: string) => SiglumeClientShape,
        env: { SIGLUME_API_KEY: "sig_test_key" },
      },
    );
    const usageExit = await runCli(["usage", "--window", "7d", "--json"], {
      stdout: (line) => stdout.push(line),
      client_factory: clientFactory as unknown as (api_key: string, base_url?: string) => SiglumeClientShape,
      env: { SIGLUME_API_KEY: "sig_test_key" },
    });

    expect(registerExit).toBe(0);
    expect(supportExit).toBe(0);
    expect(usageExit).toBe(0);
    expect(stdout.some((line) => line.includes("\"review\""))).toBe(true);
    expect(stdout.some((line) => line.includes("\"case\""))).toBe(true);
    expect(stdout.some((line) => line.includes("\"window\": \"7d\""))).toBe(true);
    expect(seen.submit_review_calls).toBe(1);
    expect(seen.trace_id).toBe("trc_123");
  });
});
