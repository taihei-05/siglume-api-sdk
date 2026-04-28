import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AppCategory,
  ApprovalMode,
  PermissionClass,
  PriceModel,
  type SiglumeClientShape,
} from "../src/index";
import {
  buildToolManualTemplate,
  createSupportCaseReport,
  getUsageReport,
  loadProject,
  runRegistration,
  scoreProject,
  validateProject,
  writeInitTemplate,
} from "../src/cli/project";

function manifestBase(permission_class: PermissionClass = PermissionClass.READ_ONLY) {
  return {
    capability_key: permission_class === PermissionClass.PAYMENT ? "payment-quote" : "price-compare-helper",
    name: permission_class === PermissionClass.PAYMENT ? "Payment Quote" : "Price Compare Helper",
    job_to_be_done:
      permission_class === PermissionClass.PAYMENT
        ? "Quote and complete a USD payment after explicit owner approval."
        : "Compare retailer prices for a product and return the best current offer.",
    category: permission_class === PermissionClass.PAYMENT ? AppCategory.FINANCE : AppCategory.COMMERCE,
    permission_class,
    approval_mode: permission_class === PermissionClass.READ_ONLY ? ApprovalMode.AUTO : ApprovalMode.ALWAYS_ASK,
    dry_run_supported: true,
    required_connected_accounts: [],
    price_model: PriceModel.FREE,
    jurisdiction: "US",
    docs_url: "https://docs.siglume.test/price-compare-helper",
    support_contact: "https://support.siglume.test/price-compare-helper",
    short_description:
      permission_class === PermissionClass.PAYMENT
        ? "Preview, quote, and capture a USD payment with approval."
        : "Returns a structured offer comparison.",
    example_prompts: ["Example prompt."],
  };
}

function manualBase() {
  return {
    tool_name: "price_compare_helper",
    job_to_be_done: "Compare retailer prices for a product and return the best current offer with supporting details.",
    summary_for_model: "Looks up current retailer offers and returns a structured comparison with the best deal first.",
    trigger_conditions: [
      "owner asks to compare prices for a product before deciding where to buy",
      "agent needs retailer offer data to support a shopping recommendation",
      "request is to find the cheapest or best-value option for a product query",
    ],
    do_not_use_when: ["the request is to complete checkout or place an order instead of comparing offers"],
    permission_class: "read_only",
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product name, model number, or search phrase." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line overview of the best available deal." },
      },
      required: ["summary"],
      additionalProperties: false,
    },
    usage_hints: ["Use this tool after the owner has named a product and wants evidence-backed price comparison."],
    result_hints: ["Lead with the best offer and then summarize notable trade-offs."],
    error_hints: ["If no offers are found, ask for a clearer product name or model number."],
  };
}

async function createObjectProject(options: {
  manualFileName?: "tool_manual.json" | "tool-manual.json";
  toolManual?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  oauthCredentials?: Record<string, unknown> | unknown[];
} = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "siglume-ts-project-"));
  const adapterSource = [
    "const app = {",
    "  async manifest() {",
    `    return ${JSON.stringify(options.manifest ?? manifestBase(), null, 2).replaceAll("\n", "\n    ")};`,
    "  },",
    "  async execute(ctx) {",
    "    return { success: true, execution_kind: ctx.execution_kind, output: { summary: 'ok' } };",
    "  },",
    "};",
    "export default app;",
    "",
  ].join("\n");
  await writeFile(join(dir, "adapter.mjs"), adapterSource, "utf8");
  await writeFile(
    join(dir, options.manualFileName ?? "tool_manual.json"),
    JSON.stringify(options.toolManual ?? manualBase(), null, 2),
    "utf8",
  );
  await writeFile(
    join(dir, "runtime_validation.json"),
    JSON.stringify(
      {
        public_base_url: "https://runtime.example.test",
        healthcheck_url: "https://runtime.example.test/health",
        invoke_url: "https://runtime.example.test/invoke",
        test_auth_header_name: "X-Siglume-Review-Key",
        test_auth_header_value: "review-secret",
        request_payload: { query: "Sony WH-1000XM5" },
        expected_response_fields: ["summary"],
      },
      null,
      2,
    ),
    "utf8",
  );
  if (options.oauthCredentials !== undefined) {
    await writeFile(join(dir, "oauth_credentials.json"), JSON.stringify(options.oauthCredentials, null, 2), "utf8");
  }
  return dir;
}

function usageClientFactory(
  capture: { api_key?: string; usage_calls: number },
  allItems = false,
): (api_key: string, base_url?: string) => SiglumeClientShape {
  return (api_key: string) => {
    capture.api_key = api_key;
    return {
      async get_usage() {
        capture.usage_calls += 1;
        const page = {
          items: [
            {
              usage_event_id: "use_1",
              capability_key: "price-compare-helper",
              units_consumed: 2,
              raw: {},
            },
          ],
          meta: {},
        };
        if (allItems) {
          return {
            ...page,
            async all_items() {
              return page.items;
            },
          };
        }
        return page;
      },
    } as unknown as SiglumeClientShape;
  };
}

function publishableQualityReport(overrides: Record<string, unknown> = {}) {
  return {
    overall_score: 91,
    grade: "A",
    issues: [],
    keyword_coverage_estimate: 64,
    improvement_suggestions: [],
    publishable: true,
    validation_ok: true,
    validation_errors: [],
    validation_warnings: [],
    ...overrides,
  };
}

describe("cli project helpers", () => {
  it("builds action and payment tool-manual templates with required fields", () => {
    const actionTemplate = buildToolManualTemplate(manifestBase(PermissionClass.ACTION));
    const paymentTemplate = buildToolManualTemplate(manifestBase(PermissionClass.PAYMENT));

    expect(actionTemplate.permission_class).toBe("action");
    expect(actionTemplate.preview_schema).toBeTruthy();
    expect(paymentTemplate.currency).toBe("USD");
    expect(paymentTemplate.quote_schema).toBeTruthy();
    expect(paymentTemplate.refund_or_cancellation_note).toBeTruthy();
  });

  it("loads projects from duck-typed default exports and hyphenated tool-manual paths", async () => {
    const projectDir = await createObjectProject({ manualFileName: "tool-manual.json" });

    const project = await loadProject(projectDir);

    expect(project.adapter_path).toMatch(/adapter\.mjs$/);
    expect(project.tool_manual_path).toMatch(/tool-manual\.json$/);
    expect(project.manifest.capability_key).toBe("price-compare-helper");
  });

  it("rejects empty and ambiguous project roots", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "siglume-empty-project-"));
    await expect(loadProject(emptyDir)).rejects.toThrow("No adapter TypeScript/JavaScript file found");

    const ambiguousDir = await mkdtemp(join(tmpdir(), "siglume-ambiguous-project-"));
    await writeFile(join(ambiguousDir, "a.mjs"), "export default {};\n", "utf8");
    await writeFile(join(ambiguousDir, "b.mjs"), "export default {};\n", "utf8");
    await expect(loadProject(ambiguousDir)).rejects.toThrow("Multiple adapter files found");
  });

  it("guards init template collisions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "siglume-init-project-"));
    await writeInitTemplate("echo", dir);
    await expect(writeInitTemplate("echo", dir)).rejects.toThrow("adapter.ts already exists");
  });

  it("merges generated ignores into an existing .gitignore during init", async () => {
    const dir = await mkdtemp(join(tmpdir(), "siglume-init-existing-gitignore-"));
    await writeFile(join(dir, ".gitignore"), "custom-local.log\nnode_modules/\n", "utf8");
    await writeInitTemplate("echo", dir);
    const gitignore = await readFile(join(dir, ".gitignore"), "utf8");

    expect(gitignore).toContain("custom-local.log");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain("runtime_validation.json");
    expect(gitignore).toContain("oauth_credentials.json");
  });

  it("scores remote projects and marks non-publishable remote reports as failed", async () => {
    const projectDir = await createObjectProject();
    const report = await scoreProject(projectDir, "remote", {
      env: { SIGLUME_API_KEY: "sig_test_key" },
      client_factory: () =>
        ({
          async preview_quality_score() {
            return {
              overall_score: 82,
              grade: "B",
              issues: [],
              keyword_coverage_estimate: 18,
              improvement_suggestions: [],
              publishable: false,
              validation_ok: true,
              validation_errors: [],
              validation_warnings: [],
            };
          },
        }) as unknown as SiglumeClientShape,
    });

    expect(report.mode).toBe("remote");
    expect(report.ok).toBe(false);
  });

  it("allows injected clients without resolving real credentials", async () => {
    const projectDir = await createObjectProject();
    let receivedApiKey: string | null = null;

    const report = await validateProject(projectDir, {
      env: {},
      client_factory: (api_key: string) => {
        receivedApiKey = api_key;
        return {
          async preview_quality_score() {
            return {
              overall_score: 95,
              grade: "A",
              issues: [],
              keyword_coverage_estimate: 20,
              improvement_suggestions: [],
              publishable: true,
              validation_ok: true,
              validation_errors: [],
              validation_warnings: [],
            };
          },
        } as unknown as SiglumeClientShape;
      },
    });

    expect(report.ok).toBe(true);
    expect(receivedApiKey).toBe("siglume_test_key");
  });

  it("requires an explicit tool manual before registration", async () => {
    const projectDir = await createObjectProject();
    await rm(join(projectDir, "tool_manual.json"));

    await expect(
      runRegistration(
        projectDir,
        {},
        {
          env: { SIGLUME_API_KEY: "sig_test_key" },
          client_factory: () => ({}) as unknown as SiglumeClientShape,
        },
      ),
    ).rejects.toThrow("tool_manual.json is required for `siglume register`");
  });

  it("blocks registration before auto-register when remote quality is not publishable", async () => {
    const projectDir = await createObjectProject();
    let autoRegisterCalled = false;

    await expect(
      runRegistration(
        projectDir,
        {},
        {
          env: { SIGLUME_API_KEY: "sig_test_key" },
          client_factory: () =>
            ({
              async preview_quality_score() {
                return publishableQualityReport({ overall_score: 61, grade: "C", publishable: false });
              },
              async auto_register() {
                autoRegisterCalled = true;
                throw new Error("auto_register should not run");
              },
            }) as unknown as SiglumeClientShape,
        },
      ),
    ).rejects.toThrow("remote Tool Manual quality is not publishable: C (61/100)");
    expect(autoRegisterCalled).toBe(false);
  });

  it("allows API-managed connected accounts without oauth_credentials.json", async () => {
    const projectDir = await createObjectProject({
      manifest: {
        ...manifestBase(),
        required_connected_accounts: ["twitter"],
      },
    });

    const report = await runRegistration(
      projectDir,
      {},
      {
        env: { SIGLUME_API_KEY: "sig_test_key" },
        client_factory: () =>
          ({
            async preview_quality_score() {
              return publishableQualityReport();
            },
            async auto_register(_manifest: unknown, _toolManual: unknown, options?: { oauth_credentials?: unknown }) {
              expect(options?.oauth_credentials).toBeUndefined();
              return { listing_id: "lst_api_managed", status: "draft", auto_manifest: {}, confidence: {} };
            },
          }) as unknown as SiglumeClientShape,
      },
    );

    expect((report.receipt as { listing_id: string }).listing_id).toBe("lst_api_managed");
  });

  it("blocks registration when a platform-managed OAuth API does not provide oauth_credentials.json", async () => {
    const projectDir = await createObjectProject({
      manifest: {
        ...manifestBase(),
        required_connected_accounts: [{ provider_key: "twitter", platform_managed: true }],
      },
    });
    let autoRegisterCalled = false;

    await expect(
      runRegistration(
        projectDir,
        {},
        {
          env: { SIGLUME_API_KEY: "sig_test_key" },
          client_factory: () =>
            ({
              async preview_quality_score() {
                return publishableQualityReport();
              },
              async auto_register() {
                autoRegisterCalled = true;
                throw new Error("auto_register should not run");
              },
            }) as unknown as SiglumeClientShape,
        },
      ),
    ).rejects.toThrow("oauth_credentials.json is required for platform-managed OAuth APIs");
    expect(autoRegisterCalled).toBe(false);
  });

  it("rejects platform-managed OAuth requirements without a provider key", async () => {
    const projectDir = await createObjectProject({
      manifest: {
        ...manifestBase(),
        required_connected_accounts: [{ platform_managed: true, required_scopes: ["chat:write"] }],
      },
    });

    await expect(
      runRegistration(
        projectDir,
        {},
        {
          env: { SIGLUME_API_KEY: "sig_test_key" },
          client_factory: () =>
            ({
              async preview_quality_score() {
                return publishableQualityReport();
              },
              async auto_register() {
                throw new Error("auto_register should not run");
              },
            }) as unknown as SiglumeClientShape,
        },
      ),
    ).rejects.toThrow("platform-managed entries must include a supported provider_key");
  });

  it("canonicalizes OAuth seed payloads before auto-register", async () => {
    const projectDir = await createObjectProject({
      manifest: {
        ...manifestBase(),
        required_connected_accounts: [{ provider_key: "google-drive", platform_managed: true }],
      },
      oauthCredentials: [
        {
          provider: "gmail",
          client_id: "google-client",
          client_secret: "google-secret",
          scopes: ["gmail.readonly"],
        },
      ],
    });

    const report = await runRegistration(
      projectDir,
      {},
      {
        env: { SIGLUME_API_KEY: "sig_test_key" },
        client_factory: () =>
          ({
            async preview_quality_score() {
              return publishableQualityReport();
            },
            async auto_register(
              _manifest: unknown,
              _tool_manual: unknown,
              options?: { oauth_credentials?: Record<string, unknown> | unknown[] },
            ) {
              expect(options?.oauth_credentials).toEqual({
                items: [
                  {
                    provider_key: "google",
                    client_id: "google-client",
                    client_secret: "google-secret",
                    required_scopes: ["gmail.readonly"],
                  },
                ],
              });
              return { listing_id: "lst_oauth", status: "draft", auto_manifest: {}, confidence: {} };
            },
          }) as unknown as SiglumeClientShape,
      },
    );

    expect((report.receipt as { listing_id: string }).listing_id).toBe("lst_oauth");
  });

  it("rejects string OAuth scopes", async () => {
    const projectDir = await createObjectProject({
      manifest: {
        ...manifestBase(),
        required_connected_accounts: ["google"],
      },
      oauthCredentials: [
        {
          provider: "gmail",
          client_id: "google-client",
          client_secret: "google-secret",
          scopes: "gmail.readonly",
        },
      ],
    });

    await expect(
      runRegistration(
        projectDir,
        {},
        {
          env: { SIGLUME_API_KEY: "sig_test_key" },
          client_factory: () => ({}) as unknown as SiglumeClientShape,
        },
      ),
    ).rejects.toThrow("required_scopes must be a JSON array");
  });

  it("allows Tool Manual warnings during registration preflight", async () => {
    const toolManual = manualBase();
    (toolManual.input_schema.properties as Record<string, unknown>).trace_id = {
      type: "string",
      description: "Platform-injected trace identifier.",
    };
    const projectDir = await createObjectProject({ toolManual });
    let autoRegisterCalled = false;

    const report = await runRegistration(
      projectDir,
      {},
      {
        env: { SIGLUME_API_KEY: "sig_test_key" },
        client_factory: () =>
          ({
            async preview_quality_score() {
              return publishableQualityReport();
            },
            async auto_register() {
              autoRegisterCalled = true;
              return { listing_id: "lst_warning", status: "draft", auto_manifest: {}, confidence: {} };
            },
          }) as unknown as SiglumeClientShape,
      },
    );

    expect((report.receipt as { listing_id: string }).listing_id).toBe("lst_warning");
    expect((report.registration_preflight as { ok: boolean }).ok).toBe(true);
    expect(autoRegisterCalled).toBe(true);
  });

  it("covers registration, support, and usage helper branches", async () => {
    const projectDir = await createObjectProject();
    const usageCapture = { api_key: undefined as string | undefined, usage_calls: 0 };

    const submitReview = await runRegistration(
      projectDir,
      { submit_review: true },
      {
        env: { SIGLUME_API_KEY: "sig_test_key" },
        client_factory: () =>
          ({
            async preview_quality_score() {
              return publishableQualityReport();
            },
            async auto_register() {
              return {
                listing_id: "lst_123",
                status: "draft",
                review_url: "https://siglume.com/owner/publish?listing=lst_123",
                trace_id: "trc_reg",
                request_id: "req_reg",
                auto_manifest: {},
                confidence: {},
              };
            },
            async submit_review() {
              return {
                listing_id: "lst_123",
                capability_key: "price-compare-helper",
                name: "Price Compare Helper",
                status: "active",
                dry_run_supported: true,
                price_value_minor: 0,
                currency: "USD",
                submission_blockers: [],
                raw: {},
              };
            },
          }) as unknown as SiglumeClientShape,
      },
    );

    const confirmSkip = await runRegistration(
      projectDir,
      { confirm: true, submit_review: true },
      {
        env: { SIGLUME_API_KEY: "sig_test_key" },
        client_factory: () =>
          ({
            async preview_quality_score() {
              return publishableQualityReport();
            },
            async auto_register() {
              return { listing_id: "lst_123", status: "draft", auto_manifest: {}, confidence: {} };
            },
            async confirm_registration() {
              return {
                listing_id: "lst_123",
                status: "active",
                release: { release_status: "published" },
                quality: { overall_score: 80, grade: "B", issues: [], improvement_suggestions: [], raw: {} },
                raw: {},
              };
            },
          }) as unknown as SiglumeClientShape,
      },
    );

    const supportReport = await createSupportCaseReport(
      { subject: "Need help", body: "details", trace_id: "trc_123" },
      {
        env: { SIGLUME_API_KEY: "sig_test_key" },
        client_factory: () =>
          ({
            async create_support_case(subject: string, body: string, options?: { trace_id?: string }) {
              return {
                support_case_id: "case_1",
                case_type: "app_execution",
                summary: `${subject}:${body}:${options?.trace_id}`,
                status: "open",
                metadata: {},
                raw: {},
              };
            },
          }) as unknown as SiglumeClientShape,
      },
    );

    const usageTopLevelHome = await mkdtemp(join(tmpdir(), "siglume-home-top-"));
    await mkdir(join(usageTopLevelHome, ".siglume"), { recursive: true });
    await writeFile(join(usageTopLevelHome, ".siglume", "credentials.toml"), 'api_key = "sig_top"\n', "utf8");

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = usageTopLevelHome;
    process.env.USERPROFILE = usageTopLevelHome;
    try {
      const usageReport = await getUsageReport(
        { window: "7d" },
        {
          env: {},
          client_factory: usageClientFactory(usageCapture, false),
        },
      );

      expect(usageReport.count).toBe(1);
      expect(usageCapture.api_key).toBe("siglume_test_key");
    } finally {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
    }

    const usageNestedHome = await mkdtemp(join(tmpdir(), "siglume-home-nested-"));
    await mkdir(join(usageNestedHome, ".siglume"), { recursive: true });
    await writeFile(
      join(usageNestedHome, ".siglume", "credentials.toml"),
      ['[default]', 'api_key = "sig_nested"', ""].join("\n"),
      "utf8",
    );

    process.env.HOME = usageNestedHome;
    process.env.USERPROFILE = usageNestedHome;
    try {
      const usageCaptureNested = { api_key: undefined as string | undefined, usage_calls: 0 };
      const usageReport = await getUsageReport(
        { window: "30d" },
        {
          env: {},
          client_factory: usageClientFactory(usageCaptureNested, true),
        },
      );

      expect(usageReport.window).toBe("30d");
      expect(usageCaptureNested.api_key).toBe("siglume_test_key");
    } finally {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
    }

    expect((submitReview.review as { listing_id: string }).listing_id).toBe("lst_123");
    expect((submitReview.receipt as { review_url: string }).review_url).toBe("https://siglume.com/owner/publish?listing=lst_123");
    expect((submitReview.registration_preflight as { ok: boolean }).ok).toBe(true);
    expect(confirmSkip.submit_review_skipped).toBe(true);
    expect((confirmSkip.confirmation as { status: string }).status).toBe("active");
    expect(((confirmSkip.confirmation as { release: { release_status?: string } }).release).release_status).toBe("published");
    expect((supportReport.case as { summary: string }).summary).toBe("Need help:details:trc_123");
    expect(usageCapture.usage_calls).toBe(1);
  });

  it("resolves credentials files when using the default client path", async () => {
    const credentialsHome = await mkdtemp(join(tmpdir(), "siglume-home-default-client-"));
    await mkdir(join(credentialsHome, ".siglume"), { recursive: true });
    await writeFile(join(credentialsHome, ".siglume", "credentials.toml"), 'api_key = "sig_top"\n', "utf8");

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const originalFetch = globalThis.fetch;
    let authorizationHeader: string | null = null;
    process.env.HOME = credentialsHome;
    process.env.USERPROFILE = credentialsHome;
    globalThis.fetch = (async (_input, init) => {
      const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
      authorizationHeader = headers.get("authorization");
      return new Response(
        JSON.stringify({
          data: {
            items: [],
            next_cursor: null,
            limit: 50,
            offset: 0,
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const usageReport = await getUsageReport({ window: "7d" }, { env: {} });
      expect(usageReport.count).toBe(0);
      expect(authorizationHeader).toBe("Bearer sig_top");
    } finally {
      globalThis.fetch = originalFetch;
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
    }
  });
});
