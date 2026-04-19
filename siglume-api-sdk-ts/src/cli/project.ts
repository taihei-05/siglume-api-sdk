import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

import { createJiti } from "jiti";

import {
  AppAdapter,
  AppTestHarness,
  ChangeLevel,
  PermissionClass,
  diff_manifest,
  diff_tool_manual,
  score_tool_manual_offline,
  SettlementMode,
  SiglumeClient,
  ToolManualPermissionClass,
  validate_tool_manual,
} from "../index";
import type {
  AppManifest,
  ExecutionResult,
  SiglumeClientShape,
  ToolManual,
  ToolManualIssue,
} from "../index";
import { SiglumeProjectError } from "../errors";
import { isRecord, renderJson, toJsonable } from "../utils";

const TEMPLATE_NAMES = ["echo", "price-compare", "publisher", "payment"] as const;
type TemplateName = (typeof TEMPLATE_NAMES)[number];

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const CAPABILITY_KEY_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export interface LoadedProject {
  root_dir: string;
  adapter_path: string;
  app: AppAdapter;
  manifest: AppManifest;
  tool_manual_path?: string;
  tool_manual: Record<string, unknown>;
}

export interface CliProjectDependencies {
  env?: Record<string, string | undefined>;
  client_factory?: (api_key: string, base_url?: string) => SiglumeClientShape;
}

function defaultClientFactory(api_key: string, base_url?: string): SiglumeClientShape {
  return new SiglumeClient({ api_key, base_url });
}

async function createClient(deps: CliProjectDependencies = {}, base_url?: string): Promise<SiglumeClientShape> {
  if (deps.client_factory) {
    return deps.client_factory(deps.env?.SIGLUME_API_KEY ?? "siglume_test_key", base_url);
  }
  return defaultClientFactory(await resolveApiKey(deps.env), base_url);
}

function toolManualToDict(manual: ToolManual | Record<string, unknown>): Record<string, unknown> {
  return { ...(toJsonable(manual) as Record<string, unknown>) };
}

function remoteQualityOk(report: { validation_ok?: boolean; publishable?: boolean | null; grade: string }): boolean {
  const validationOk = report.validation_ok ?? true;
  const publishable = report.publishable ?? (report.grade === "A" || report.grade === "B");
  return Boolean(validationOk) && Boolean(publishable);
}

export function buildToolManualTemplate(manifest: AppManifest): Record<string, unknown> {
  const jobText = String(manifest.job_to_be_done || manifest.name || manifest.capability_key.replaceAll("-", " "));
  const summaryText = String(
    manifest.short_description || manifest.job_to_be_done || manifest.name || manifest.capability_key.replaceAll("-", " "),
  );
  const toolName = manifest.capability_key.replaceAll("-", "_");
  const summary = manifest.short_description || manifest.job_to_be_done || `Use this tool to ${manifest.capability_key.replaceAll("-", " ")}.`;
  const manual: Record<string, unknown> = {
    tool_name: toolName,
    job_to_be_done: jobText || `Use ${manifest.name} to complete the requested task.`,
    summary_for_model: summary,
    trigger_conditions: [
      `The owner asks for help with ${jobText.toLowerCase()}`,
      `A workflow needs ${manifest.name} to complete a specific external task`,
      `The request matches the capability described as ${summaryText}`,
    ],
    do_not_use_when: [
      "The request is unrelated to this tool's documented capability",
      "A required connected account or required input is missing",
    ],
    permission_class: toolManualPermissionClass(manifest.permission_class),
    dry_run_supported: Boolean(manifest.dry_run_supported),
    requires_connected_accounts: manifest.required_connected_accounts ?? [],
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language request describing what the tool should do.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "A concise summary of the result returned by the tool.",
        },
        result: {
          type: "object",
          description: "Structured result payload returned by the tool.",
        },
      },
      required: ["summary", "result"],
      additionalProperties: false,
    },
    usage_hints: ["Use the result summary to explain the outcome in plain language."],
    result_hints: ["Highlight the most important result field before showing raw details."],
    error_hints: ["If execution fails, explain what input or connected account needs attention."],
  };

  if (manifest.permission_class === PermissionClass.ACTION || manifest.permission_class === PermissionClass.PAYMENT) {
    manual.approval_summary_template =
      manifest.permission_class === PermissionClass.ACTION
        ? `${manifest.name}: {query}`
        : `${manifest.name}: approve {query} for {amount_minor} {currency}`;
    manual.preview_schema = {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Human-readable preview of what will happen.",
        },
      },
      required: ["summary"],
      additionalProperties: false,
    };
    manual.idempotency_support = true;
    manual.side_effect_summary =
      manifest.permission_class === PermissionClass.ACTION
        ? `Using ${manifest.name} may create or modify an external resource.`
        : `Using ${manifest.name} may initiate a payment or settlement attempt.`;
    manual.jurisdiction = manifest.jurisdiction;
  }

  if (manifest.permission_class === PermissionClass.PAYMENT) {
    manual.output_schema = {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "A concise summary of the payment or quote result.",
        },
        amount_usd: {
          type: "number",
          description: "Total amount in USD for the quote or completed payment.",
        },
        currency: {
          type: "string",
          description: "Currency code for the quoted or charged amount.",
        },
        payment_id: {
          type: "string",
          description: "Provider or platform payment identifier when execution completes.",
        },
      },
      required: ["summary", "amount_usd", "currency"],
      additionalProperties: false,
    };
    manual.quote_schema = {
      type: "object",
      properties: {
        amount_minor: {
          type: "integer",
          description: "Quoted amount in minor currency units.",
        },
        currency: {
          type: "string",
          description: "Quoted currency code.",
        },
      },
      required: ["amount_minor", "currency"],
      additionalProperties: false,
    };
    manual.currency = "USD";
    manual.settlement_mode = SettlementMode.STRIPE_CHECKOUT;
    manual.refund_or_cancellation_note = "Explain the refund or cancellation policy for this payment flow.";
  }

  return manual;
}

export async function loadProject(path = "."): Promise<LoadedProject> {
  const target = resolve(path);
  const adapter_path = await findAdapterPath(target);
  const root_dir = resolve(adapter_path, "..");
  const app = await loadApp(adapter_path);
  const manifest = await app.manifest();
  const tool_manual_path = await findToolManualPath(root_dir);
  const tool_manual = tool_manual_path
    ? (JSON.parse(await readFile(tool_manual_path, "utf8")) as Record<string, unknown>)
    : buildToolManualTemplate(manifest);

  return {
    root_dir,
    adapter_path,
    app,
    manifest,
    tool_manual_path: tool_manual_path ?? undefined,
    tool_manual,
  };
}

export async function validateProject(path = ".", deps: CliProjectDependencies = {}): Promise<Record<string, unknown>> {
  const project = await loadProject(path);
  const manifest_issues = await projectValidationIssues(project);
  const [tool_manual_valid, tool_manual_issues] = validate_tool_manual(project.tool_manual);
  const client = await createClient(deps);
  const remote_quality = await client.preview_quality_score(project.tool_manual);

  return {
    adapter_path: project.adapter_path,
    manifest: toJsonable(project.manifest),
    manifest_issues,
    tool_manual_path: project.tool_manual_path ?? null,
    tool_manual: project.tool_manual,
    tool_manual_valid,
    tool_manual_issues: tool_manual_issues.map((nextIssue) => toJsonable(nextIssue)),
    remote_quality: toJsonable(remote_quality),
    ok: manifest_issues.length === 0 && tool_manual_valid && remoteQualityOk(remote_quality),
  };
}

export async function scoreProject(
  path = ".",
  mode: "remote" | "offline" = "remote",
  deps: CliProjectDependencies = {},
): Promise<Record<string, unknown>> {
  const project = await loadProject(path);
  const [tool_manual_valid, tool_manual_issues] = validate_tool_manual(project.tool_manual);
  const quality =
    mode === "remote"
      ? await (await createClient(deps)).preview_quality_score(project.tool_manual)
      : score_tool_manual_offline(project.tool_manual);

  return {
    mode,
    adapter_path: project.adapter_path,
    tool_manual_path: project.tool_manual_path ?? null,
    tool_manual_valid,
    tool_manual_issues: tool_manual_issues.map((nextIssue) => toJsonable(nextIssue)),
    quality: toJsonable(quality),
    ok: tool_manual_valid && remoteQualityOk(quality),
  };
}

export async function runRegistration(
  path = ".",
  options: { confirm?: boolean; submit_review?: boolean } = {},
  deps: CliProjectDependencies = {},
): Promise<Record<string, unknown>> {
  const project = await loadProject(path);
  const client = await createClient(deps);
  const receipt = await client.auto_register(project.manifest, project.tool_manual);
  const result: Record<string, unknown> = { receipt: toJsonable(receipt) };
  if (options.confirm) {
    result.confirmation = toJsonable(await client.confirm_registration(receipt.listing_id));
    if (options.submit_review) {
      result.submit_review_skipped = true;
    }
  } else if (options.submit_review) {
    result.review = toJsonable(await client.submit_review(receipt.listing_id));
  }
  return result;
}

export async function createSupportCaseReport(
  options: { subject: string; body: string; trace_id?: string },
  deps: CliProjectDependencies = {},
): Promise<Record<string, unknown>> {
  const client = await createClient(deps);
  const supportCase = await client.create_support_case(options.subject, options.body, { trace_id: options.trace_id });
  return { case: toJsonable(supportCase) };
}

export async function getUsageReport(
  options: { capability_key?: string; window: string },
  deps: CliProjectDependencies = {},
): Promise<Record<string, unknown>> {
  const client = await createClient(deps);
  const page = await client.get_usage({ capability_key: options.capability_key, period_key: options.window });
  const items = page.all_items ? await page.all_items() : page.items;
  return {
    window: options.window,
    capability_key: options.capability_key ?? null,
    items: items.map((item) => toJsonable(item)),
    count: items.length,
  };
}

export async function diffJsonFiles(
  oldPath: string,
  newPath: string,
): Promise<Record<string, unknown>> {
  const oldPayload = await loadJsonDocument(oldPath);
  const newPayload = await loadJsonDocument(newPath);
  const kind = detectDocumentKind(oldPayload, newPayload);
  const changes =
    kind === "manifest"
      ? diff_manifest({ old: oldPayload, new: newPayload })
      : diff_tool_manual({ old: oldPayload, new: newPayload });
  const counts = {
    breaking: changes.filter((change) => change.level === ChangeLevel.BREAKING).length,
    warning: changes.filter((change) => change.level === ChangeLevel.WARNING).length,
    info: changes.filter((change) => change.level === ChangeLevel.INFO).length,
  };
  return {
    kind,
    old_path: oldPath,
    new_path: newPath,
    exit_code: counts.breaking > 0 ? 1 : counts.warning > 0 ? 2 : 0,
    counts,
    changes: changes.map((change) => toJsonable(change)),
  };
}

export async function runHarness(path = "."): Promise<Record<string, unknown>> {
  const project = await loadProject(path);
  return runHarnessForProject(project);
}

export async function writeInitTemplate(template: TemplateName, destination: string): Promise<string[]> {
  const root = resolve(destination);
  await mkdir(root, { recursive: true });
  const adapter_path = join(root, "adapter.ts");
  const manifest_path = join(root, "manifest.json");
  const tool_manual_path = join(root, "tool_manual.json");
  const readme_path = join(root, "README.md");

  for (const filePath of [adapter_path, manifest_path, tool_manual_path, readme_path]) {
    if (existsSync(filePath)) {
      throw new SiglumeProjectError(`${basename(filePath)} already exists in ${root}`);
    }
  }

  await writeFile(adapter_path, fallbackTemplateSource(template), "utf8");
  const manifest = starterManifest(template);
  await writeFile(manifest_path, renderJson(manifest), "utf8");
  await writeFile(tool_manual_path, renderJson(buildToolManualTemplate(manifest)), "utf8");
  await writeFile(readme_path, readmeTemplate(template), "utf8");
  return [adapter_path, manifest_path, tool_manual_path, readme_path];
}

async function projectValidationIssues(project: LoadedProject): Promise<string[]> {
  const harness = new AppTestHarness(project.app);
  return harness.validate_manifest();
}

async function runHarnessForProject(project: LoadedProject): Promise<Record<string, unknown>> {
  const harness = new AppTestHarness(project.app);
  const manifest_issues = await harness.validate_manifest();
  const health = await harness.health();
  const task_type = project.app.supported_task_types()[0] ?? "default";
  const sample_input = sampleInputFromSchema(project.tool_manual.input_schema);

  const checks: Array<Record<string, unknown>> = [
    {
      name: "manifest_validation",
      ok: manifest_issues.length === 0,
      details: manifest_issues,
    },
    {
      name: "health",
      ok: Boolean(health.healthy),
      details: { healthy: health.healthy, message: health.message ?? "" },
    },
  ];

  checks.push(executionCheck("dry_run", await harness.dry_run(task_type, { input_params: sample_input }), harness));
  if (project.manifest.permission_class === PermissionClass.ACTION || project.manifest.permission_class === PermissionClass.PAYMENT) {
    checks.push(executionCheck("action", await harness.execute_action(task_type, { input_params: sample_input }), harness));
  }
  if (project.manifest.permission_class === PermissionClass.PAYMENT) {
    checks.push(executionCheck("quote", await harness.execute_quote(task_type, { input_params: sample_input }), harness));
    checks.push(executionCheck("payment", await harness.execute_payment(task_type, { input_params: sample_input }), harness));
  }
  checks.push(
    executionCheck(
      "missing_account_simulation",
      await harness.simulate_connected_account_missing(task_type, { input_params: sample_input }),
      harness,
    ),
  );

  return {
    adapter_path: project.adapter_path,
    task_type,
    sample_input,
    checks,
    ok: checks.every((check) => check.ok),
  };
}

function executionCheck(name: string, result: ExecutionResult, harness: AppTestHarness): Record<string, unknown> {
  const receipt_issues = harness.validate_receipt(result);
  return {
    name,
    ok: Boolean(result.success) && receipt_issues.length === 0,
    details: {
      success: Boolean(result.success),
      execution_kind: result.execution_kind,
      receipt_issues,
      output: toJsonable(result.output ?? {}),
    },
  };
}

function toolManualPermissionClass(permission_class: AppManifest["permission_class"]): string {
  switch (permission_class) {
    case PermissionClass.ACTION:
      return ToolManualPermissionClass.ACTION;
    case PermissionClass.PAYMENT:
      return ToolManualPermissionClass.PAYMENT;
    default:
      return ToolManualPermissionClass.READ_ONLY;
  }
}

async function loadJsonDocument(path: string): Promise<Record<string, unknown>> {
  const payload = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SiglumeProjectError(`${path} must contain a top-level JSON object.`);
  }
  return payload as Record<string, unknown>;
}

function detectDocumentKind(
  oldPayload: Record<string, unknown>,
  newPayload: Record<string, unknown>,
): "manifest" | "tool_manual" {
  const oldKind = payloadKind(oldPayload);
  const newKind = payloadKind(newPayload);
  if (oldKind !== newKind) {
    throw new SiglumeProjectError("Both files must be the same document type (manifest or tool_manual).");
  }
  if (!oldKind) {
    throw new SiglumeProjectError("Could not detect document type. Expected AppManifest or ToolManual JSON.");
  }
  return oldKind;
}

function payloadKind(payload: Record<string, unknown>): "manifest" | "tool_manual" | null {
  if (isManifestPayload(payload)) {
    return "manifest";
  }
  if (isToolManualPayload(payload)) {
    return "tool_manual";
  }
  return null;
}

function isManifestPayload(payload: Record<string, unknown>): boolean {
  // Identify AppManifest by its unique capability_key (format-checked).
  // Other fields have defaults in the dataclass shape, so requiring them
  // would reject legitimate minimal / legacy manifests; the diff engine
  // already normalizes missing defaults.
  const key = payload.capability_key;
  return typeof key === "string" && CAPABILITY_KEY_RE.test(key);
}

function isToolManualPayload(payload: Record<string, unknown>): boolean {
  // Identify ToolManual by tool_name. AppManifest has no tool_name field,
  // so this is unambiguous against manifests. Optional fields are not
  // required for discrimination — the diff engine fills in defaults.
  const toolName = payload.tool_name;
  return typeof toolName === "string" && toolName.trim().length > 0;
}

async function findAdapterPath(target: string): Promise<string> {
  if (existsSync(target) && SUPPORTED_EXTENSIONS.has(extname(target))) {
    return target;
  }

  const preferred = join(target, "adapter.ts");
  if (existsSync(preferred)) {
    return preferred;
  }

  const entries = await readdir(target, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name)))
    .map((entry) => join(target, entry.name))
    .filter((filePath) => basename(filePath) !== "register_via_client.ts");

  if (candidates.length === 0) {
    throw new SiglumeProjectError(`No adapter TypeScript/JavaScript file found in ${target}`);
  }
  if (candidates.length > 1) {
    throw new SiglumeProjectError(`Multiple adapter files found in ${target}. Pass the adapter file path explicitly.`);
  }
  return candidates[0]!;
}

async function findToolManualPath(root_dir: string): Promise<string | null> {
  for (const name of ["tool_manual.json", "tool-manual.json"]) {
    const candidate = join(root_dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function loadApp(adapter_path: string): Promise<AppAdapter> {
  const jiti = createJiti(process.cwd(), { moduleCache: false });
  const loaded = (await jiti.import(adapter_path)) as Record<string, unknown>;
  const candidates = [loaded.default, ...Object.values(loaded)];
  const seen = new Set<unknown>();
  const matches: AppAdapter[] = [];

  for (const candidate of candidates) {
    if (candidate === undefined || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (candidate instanceof AppAdapter) {
      matches.push(candidate);
      continue;
    }
    if (
      typeof candidate === "function" &&
      (candidate.prototype instanceof AppAdapter ||
        (typeof candidate.prototype?.manifest === "function" && typeof candidate.prototype?.execute === "function"))
    ) {
      matches.push(new (candidate as new () => AppAdapter)());
      continue;
    }
    if (
      candidate &&
      typeof candidate === "object" &&
      "manifest" in candidate &&
      typeof (candidate as { manifest?: unknown }).manifest === "function" &&
      "execute" in candidate &&
      typeof (candidate as { execute?: unknown }).execute === "function"
    ) {
      matches.push(candidate as AppAdapter);
    }
  }

  if (matches.length === 0) {
    throw new SiglumeProjectError(`No AppAdapter subclass found in ${adapter_path}`);
  }
  if (matches.length > 1) {
    throw new SiglumeProjectError(`Multiple AppAdapter subclasses found in ${adapter_path}. Keep one per file for CLI workflows.`);
  }
  return matches[0]!;
}

function sampleInputFromSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { query: "Run a representative test request." };
  }
  const properties = (schema as Record<string, unknown>).properties;
  const required = Array.isArray((schema as Record<string, unknown>).required)
    ? ((schema as Record<string, unknown>).required as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return { query: "Run a representative test request." };
  }
  const requiredFields = required.length > 0 ? required : Object.keys(properties);
  const output: Record<string, unknown> = {};
  for (const [fieldName, propertySchema] of Object.entries(properties)) {
    if (requiredFields.includes(fieldName)) {
      output[fieldName] = sampleValueFromProperty(propertySchema);
    }
  }
  return Object.keys(output).length > 0 ? output : { query: "Run a representative test request." };
}

function sampleValueFromProperty(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return "sample";
  }
  const property = schema as Record<string, unknown>;
  if ("default" in property) {
    return property.default;
  }
  if (Array.isArray(property.enum) && property.enum.length > 0) {
    return property.enum[0];
  }
  switch (property.type) {
    case "integer":
      return 1;
    case "number":
      return 1.0;
    case "boolean":
      return true;
    case "array":
      return [sampleValueFromProperty(property.items)];
    case "object":
      if (property.properties && typeof property.properties === "object" && !Array.isArray(property.properties)) {
        return Object.fromEntries(
          Object.entries(property.properties as Record<string, unknown>).map(([key, value]) => [key, sampleValueFromProperty(value)]),
        );
      }
      return {};
    default:
      return "sample";
  }
}

async function resolveApiKey(env: Record<string, string | undefined> = process.env): Promise<string> {
  const envValue = env.SIGLUME_API_KEY;
  if (envValue) {
    return envValue;
  }
  const credentialsPath = join(homedir(), ".siglume", "credentials.toml");
  if (existsSync(credentialsPath)) {
    const text = await readFile(credentialsPath, "utf8");
    const topLevel = text.match(/^\s*api_key\s*=\s*["']([^"']+)["']/m);
    if (topLevel?.[1]) {
      return topLevel[1].trim();
    }
    const defaultSection = text.match(/\[default\]([\s\S]*)/m)?.[1] ?? "";
    const nested = defaultSection.match(/^\s*api_key\s*=\s*["']([^"']+)["']/m);
    if (nested?.[1]) {
      return nested[1].trim();
    }
  }
  throw new SiglumeProjectError("SIGLUME_API_KEY is not set. Export it or add api_key to ~/.siglume/credentials.toml.");
}

function fallbackTemplateSource(template: TemplateName): string {
  const className = {
    echo: "StarterEchoApp",
    "price-compare": "StarterPriceCompareApp",
    publisher: "StarterPublisherApp",
    payment: "StarterPaymentApp",
  }[template];
  const permissionClass = {
    echo: "PermissionClass.READ_ONLY",
    "price-compare": "PermissionClass.READ_ONLY",
    publisher: "PermissionClass.ACTION",
    payment: "PermissionClass.PAYMENT",
  }[template];
  const approvalMode = {
    echo: "ApprovalMode.AUTO",
    "price-compare": "ApprovalMode.AUTO",
    publisher: "ApprovalMode.ALWAYS_ASK",
    payment: "ApprovalMode.ALWAYS_ASK",
  }[template];

  return [
    "import {",
    "  AppAdapter,",
    "  AppCategory,",
    "  ApprovalMode,",
    "  ExecutionResult,",
    "  PermissionClass,",
    "  PriceModel,",
    "} from \"@siglume/api-sdk\";",
    "",
    `export default class ${className} extends AppAdapter {`,
    "  manifest() {",
    "    return {",
    `      capability_key: \"${template}-starter\",`,
    `      name: \"${className}\",`,
    "      job_to_be_done: \"Describe what this starter API should do.\",",
    "      category: AppCategory.OTHER,",
    `      permission_class: ${permissionClass},`,
    `      approval_mode: ${approvalMode},`,
    "      dry_run_supported: true,",
    "      required_connected_accounts: [],",
    "      price_model: PriceModel.FREE,",
    "      jurisdiction: \"US\",",
    "      short_description: \"Starter template generated by siglume init.\",",
    "      support_contact: \"support@example.com\",",
    "      docs_url: \"https://example.com/docs\",",
    "      example_prompts: [\"Describe a realistic prompt for this API.\"],",
    "      compatibility_tags: [\"starter\"],",
    "    };",
    "  }",
    "",
    "  async execute(ctx) {",
    "    return {",
    "      success: true,",
    "      execution_kind: ctx.execution_kind,",
    "      output: {",
    "        summary: \"Starter execution completed.\",",
    "        input: ctx.input_params,",
    "      },",
    "    };",
    "  }",
    "}",
    "",
  ].join("\n");
}

function starterManifest(template: TemplateName): AppManifest {
  const className = {
    echo: "StarterEchoApp",
    "price-compare": "StarterPriceCompareApp",
    publisher: "StarterPublisherApp",
    payment: "StarterPaymentApp",
  }[template];
  const permission_class = {
    echo: PermissionClass.READ_ONLY,
    "price-compare": PermissionClass.READ_ONLY,
    publisher: PermissionClass.ACTION,
    payment: PermissionClass.PAYMENT,
  }[template];
  const approval_mode = {
    echo: "auto",
    "price-compare": "auto",
    publisher: "always-ask",
    payment: "always-ask",
  } as const;
  return {
    capability_key: `${template}-starter`,
    name: className,
    job_to_be_done: "Describe what this starter API should do.",
    category: "other",
    permission_class,
    approval_mode: approval_mode[template],
    dry_run_supported: true,
    required_connected_accounts: [],
    price_model: "free",
    jurisdiction: "US",
    short_description: "Starter template generated by siglume init.",
    support_contact: "support@example.com",
    docs_url: "https://example.com/docs",
    example_prompts: ["Describe a realistic prompt for this API."],
    compatibility_tags: ["starter"],
  };
}

function readmeTemplate(template: TemplateName): string {
  return [
    "# Siglume Starter",
    "",
    `This project was generated with \`siglume init --template ${template}\`.`,
    "",
    "Files:",
    "- `adapter.ts`: your AppAdapter implementation",
    "- `manifest.json`: serialized AppManifest snapshot",
    "- `tool_manual.json`: editable ToolManual draft for validation and registration",
    "",
    "Suggested workflow:",
    "",
    "```bash",
    "siglume validate .",
    "siglume test .",
    "siglume score . --offline",
    "siglume register . --confirm",
    "```",
    "",
  ].join("\n");
}
