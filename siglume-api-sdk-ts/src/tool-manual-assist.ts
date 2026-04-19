import { SiglumeAssistError } from "./errors";
import { score_tool_manual_offline } from "./tool-manual-grader";
import { validate_tool_manual } from "./tool-manual-validator";
import type { ToolManual, ToolManualQualityReport } from "./types";
import { isRecord } from "./utils";

const ALL_TOOL_MANUAL_FIELDS = [
  "tool_name",
  "job_to_be_done",
  "summary_for_model",
  "trigger_conditions",
  "do_not_use_when",
  "permission_class",
  "dry_run_supported",
  "requires_connected_accounts",
  "input_schema",
  "output_schema",
  "usage_hints",
  "result_hints",
  "error_hints",
  "approval_summary_template",
  "preview_schema",
  "idempotency_support",
  "side_effect_summary",
  "quote_schema",
  "currency",
  "settlement_mode",
  "refund_or_cancellation_note",
  "jurisdiction",
  "legal_notes",
] as const;
const BASE_REQUIRED_FIELDS = [
  "tool_name",
  "job_to_be_done",
  "summary_for_model",
  "trigger_conditions",
  "do_not_use_when",
  "permission_class",
  "dry_run_supported",
  "requires_connected_accounts",
  "input_schema",
  "output_schema",
  "usage_hints",
  "result_hints",
  "error_hints",
] as const;
const ACTION_REQUIRED_FIELDS = [
  "approval_summary_template",
  "preview_schema",
  "idempotency_support",
  "side_effect_summary",
  "jurisdiction",
] as const;
const PAYMENT_REQUIRED_FIELDS = [
  "quote_schema",
  "currency",
  "settlement_mode",
  "refund_or_cancellation_note",
] as const;
const PAYMENT_SETTLEMENT_MODES = [
  "stripe_checkout",
  "stripe_payment_intent",
  "polygon_mandate",
  "embedded_wallet_charge",
] as const;
const VALID_PERMISSION_CLASSES = new Set(["read_only", "action", "payment"]);

export const TOOL_MANUAL_DRAFT_PROMPT = `# Siglume ToolManual Draft System Prompt

You generate ToolManual payloads for the Siglume Agent API Store.

Follow these rules on every response:

1. Return only the structured payload requested by the caller's JSON schema.
2. ToolManual permission_class values are \`read_only\`, \`action\`, and \`payment\`.
3. Use factual, specific language. Do not use marketing words, hype, or vague phrases.
4. \`trigger_conditions\` must describe concrete situations where the tool is the right next step.
5. \`do_not_use_when\` must describe concrete situations where another tool or response is safer.
6. \`summary_for_model\` should explain the tool's capability in one short factual paragraph.
7. \`usage_hints\`, \`result_hints\`, and \`error_hints\` should help an agent decide how to invoke and explain the tool.
8. For \`action\` and \`payment\`, include owner-approval framing, idempotency, and a governing \`jurisdiction\`.
9. For \`payment\`, \`currency\` must be \`USD\` and \`settlement_mode\` must be one of the documented Siglume values.
10. When filling gaps, keep non-target fields unchanged and only improve the requested fields.
`;

type ToolManualField = (typeof ALL_TOOL_MANUAL_FIELDS)[number];
type FetchLike = typeof fetch;

interface ProviderConfig {
  provider_name: string;
  default_model: string;
  api_key_env: string;
  default_base_url: string;
  price_table: Record<string, { input: number; output: number; cache_write?: number; cache_read?: number }>;
}

export interface StructuredGenerationUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ToolManualAssistAttempt {
  attempt_number: number;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  estimated_cost_usd: number | null;
  overall_score: number;
  grade: string;
  validation_ok: boolean;
}

export interface ToolManualAssistMetadata {
  mode: "draft" | "gap_fill";
  provider: string;
  model: string;
  attempts: ToolManualAssistAttempt[];
  attempt_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_input_tokens: number;
  total_cache_read_input_tokens: number;
  total_estimated_cost_usd: number | null;
}

export interface ToolManualAssistResult {
  tool_manual: ToolManual;
  quality_report: ToolManualQualityReport;
  metadata: ToolManualAssistMetadata;
}

interface StructuredGenerationResult {
  payload: Record<string, unknown>;
  usage: StructuredGenerationUsage;
}

export abstract class LLMProvider {
  provider_name: string;
  model: string;
  api_key: string;
  base_url: string;
  timeout_ms: number;
  protected readonly fetchImpl: FetchLike;
  private readonly price_table: ProviderConfig["price_table"];

  protected constructor(
    options: {
      api_key?: string;
      model?: string;
      base_url?: string;
      fetch?: FetchLike;
      timeout_ms?: number;
    } = {},
    config: ProviderConfig,
  ) {
    this.provider_name = config.provider_name;
    this.model = options.model ?? config.default_model;
    this.base_url = options.base_url ?? config.default_base_url;
    this.timeout_ms = options.timeout_ms ?? 30_000;
    this.api_key = options.api_key ?? readEnv(config.api_key_env) ?? "";
    if (!this.api_key) {
      throw new SiglumeAssistError(
        `${this.constructor.name} requires an API key via the constructor or ${config.api_key_env}.`,
      );
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.price_table = config.price_table;
  }

  abstract generateStructured(options: {
    system_prompt: string;
    user_prompt: string;
    output_schema: Record<string, unknown>;
  }): Promise<StructuredGenerationResult>;

  estimate_cost_usd(usage: StructuredGenerationUsage): number | null {
    const pricing = this.price_table[this.model];
    if (!pricing) {
      return null;
    }
    const inputCost = (usage.input_tokens * pricing.input) / 1_000_000;
    const outputCost = (usage.output_tokens * pricing.output) / 1_000_000;
    const cacheWriteCost = (usage.cache_creation_input_tokens * (pricing.cache_write ?? pricing.input)) / 1_000_000;
    const cacheReadCost = (usage.cache_read_input_tokens * (pricing.cache_read ?? 0)) / 1_000_000;
    return Number((inputCost + outputCost + cacheWriteCost + cacheReadCost).toFixed(8));
  }

  protected async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timeout = controller ? setTimeout(() => controller.abort(), this.timeout_ms) : undefined;
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller?.signal });
      if (!response.ok) {
        throw new SiglumeAssistError(
          `${this.provider_name} API request failed: ${response.status} ${await response.text()}`,
        );
      }
      return response.json();
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

export class AnthropicProvider extends LLMProvider {
  constructor(options: { api_key?: string; model?: string; base_url?: string; fetch?: FetchLike; timeout_ms?: number } = {}) {
    super(options, {
      provider_name: "anthropic",
      default_model: "claude-sonnet-4-6",
      api_key_env: "ANTHROPIC_API_KEY",
      default_base_url: "https://api.anthropic.com/v1/messages",
      price_table: {
        "claude-sonnet-4-6": {
          input: 3.0,
          output: 15.0,
          cache_write: 3.75,
          cache_read: 0.3,
        },
      },
    });
  }

  async generateStructured(options: {
    system_prompt: string;
    user_prompt: string;
    output_schema: Record<string, unknown>;
  }): Promise<StructuredGenerationResult> {
    const payload = await this.fetchJson(this.base_url, {
      method: "POST",
      headers: {
        "x-api-key": this.api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 3200,
        system: [
          {
            type: "text",
            text: options.system_prompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: options.user_prompt }],
        tools: [
          {
            name: "emit_tool_manual",
            description: "Return a ToolManual payload that matches the supplied JSON schema exactly.",
            input_schema: options.output_schema,
            strict: true,
          },
        ],
        tool_choice: { type: "tool", name: "emit_tool_manual" },
      }),
    });
    if (!isRecord(payload)) {
      throw new SiglumeAssistError("AnthropicProvider returned a non-object payload.");
    }
    const content = Array.isArray(payload.content) ? payload.content : [];
    const toolUse = content.find(
      (item) => isRecord(item) && item.type === "tool_use" && item.name === "emit_tool_manual",
    );
    if (!isRecord(toolUse?.input)) {
      throw new SiglumeAssistError("AnthropicProvider did not return an emit_tool_manual tool_use payload.");
    }
    const usageBlock = isRecord(payload.usage) ? payload.usage : {};
    return {
      payload: { ...toolUse.input },
      usage: {
        input_tokens: safeInt(usageBlock.input_tokens),
        output_tokens: safeInt(usageBlock.output_tokens),
        cache_creation_input_tokens: safeInt(usageBlock.cache_creation_input_tokens),
        cache_read_input_tokens: safeInt(usageBlock.cache_read_input_tokens),
      },
    };
  }
}

export class OpenAIProvider extends LLMProvider {
  constructor(options: { api_key?: string; model?: string; base_url?: string; fetch?: FetchLike; timeout_ms?: number } = {}) {
    super(options, {
      provider_name: "openai",
      default_model: "gpt-5.4",
      api_key_env: "OPENAI_API_KEY",
      default_base_url: "https://api.openai.com/v1/responses",
      price_table: {
        "gpt-5.4": { input: 2.5, output: 15.0 },
        "gpt-5": { input: 1.25, output: 10.0 },
      },
    });
  }

  async generateStructured(options: {
    system_prompt: string;
    user_prompt: string;
    output_schema: Record<string, unknown>;
  }): Promise<StructuredGenerationResult> {
    const payload = await this.fetchJson(this.base_url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        instructions: options.system_prompt,
        input: options.user_prompt,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "tool_manual",
            strict: true,
            schema: options.output_schema,
          },
        },
      }),
    });
    if (!isRecord(payload)) {
      throw new SiglumeAssistError("OpenAIProvider returned a non-object payload.");
    }
    return {
      payload: parseOpenAIPayload(payload),
      usage: {
        input_tokens: safeInt(isRecord(payload.usage) ? payload.usage.input_tokens : undefined),
        output_tokens: safeInt(isRecord(payload.usage) ? payload.usage.output_tokens : undefined),
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
  }
}

export async function draft_tool_manual(options: {
  capability_key: string;
  job_to_be_done: string;
  permission_class: ToolManual["permission_class"];
  llm: LLMProvider;
  source_code_hint?: string;
  max_attempts?: number;
}): Promise<ToolManualAssistResult> {
  const seedManual = buildSeedManual(options);
  return runAssistLoop({
    llm: options.llm,
    mode: "draft",
    seed_manual: seedManual,
    current_manual: null,
    target_fields: [...ALL_TOOL_MANUAL_FIELDS],
    output_schema: buildToolManualSchema(options.permission_class, [...ALL_TOOL_MANUAL_FIELDS]),
    source_code_hint: options.source_code_hint,
    max_attempts: options.max_attempts ?? 3,
  });
}

export async function fill_tool_manual_gaps(options: {
  partial_manual: Record<string, unknown>;
  source_code_hint?: string;
  llm: LLMProvider;
  max_attempts?: number;
}): Promise<ToolManualAssistResult> {
  const currentManual = normalizeToolManual(options.partial_manual);
  const initialReport = score_tool_manual_offline(currentManual);
  const inferredPermissionClass = inferPermissionClass(currentManual);
  let targetFields = collectTargetFields(currentManual, initialReport, inferredPermissionClass);
  if (!VALID_PERMISSION_CLASSES.has(String(currentManual.permission_class ?? "")) && inferredPermissionClass === null) {
    targetFields = [...ALL_TOOL_MANUAL_FIELDS];
  }
  if (targetFields.length === 0 && initialReport.validation_ok && (initialReport.grade === "A" || initialReport.grade === "B")) {
    return {
      tool_manual: currentManual,
      quality_report: initialReport,
      metadata: {
        mode: "gap_fill",
        provider: options.llm.provider_name,
        model: options.llm.model,
        attempts: [],
        attempt_count: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_creation_input_tokens: 0,
        total_cache_read_input_tokens: 0,
        total_estimated_cost_usd: 0,
      },
    };
  }
  return runAssistLoop({
    llm: options.llm,
    mode: "gap_fill",
    seed_manual: null,
    current_manual: currentManual,
    target_fields: targetFields,
    output_schema: buildToolManualSchema(
      inferredPermissionClass ?? "read_only",
      targetFields,
    ),
    source_code_hint: options.source_code_hint,
    max_attempts: options.max_attempts ?? 3,
  });
}

function buildSeedManual(options: {
  capability_key: string;
  job_to_be_done: string;
  permission_class: ToolManual["permission_class"];
}): Record<string, unknown> {
  const seed: Record<string, unknown> = {
    tool_name: options.capability_key.replaceAll("-", "_"),
    job_to_be_done: options.job_to_be_done,
    permission_class: options.permission_class,
    dry_run_supported: true,
    requires_connected_accounts: [],
  };
  if (options.permission_class === "action" || options.permission_class === "payment") {
    seed.jurisdiction = "US";
    seed.idempotency_support = true;
  }
  if (options.permission_class === "payment") {
    seed.currency = "USD";
  }
  return seed;
}

async function runAssistLoop(options: {
  llm: LLMProvider;
  mode: "draft" | "gap_fill";
  seed_manual: Record<string, unknown> | null;
  current_manual: ToolManual | null;
  target_fields: readonly ToolManualField[];
  output_schema: Record<string, unknown>;
  source_code_hint?: string;
  max_attempts: number;
}): Promise<ToolManualAssistResult> {
  let feedback: Record<string, unknown> | null = null;
  const metadata: ToolManualAssistMetadata = {
    mode: options.mode,
    provider: options.llm.provider_name,
    model: options.llm.model,
    attempts: [],
    attempt_count: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cache_creation_input_tokens: 0,
    total_cache_read_input_tokens: 0,
    total_estimated_cost_usd: 0,
  };
  let lastReport: ToolManualQualityReport | null = null;
  for (let attemptNumber = 1; attemptNumber <= options.max_attempts; attemptNumber += 1) {
    const generation = await options.llm.generateStructured({
      system_prompt: TOOL_MANUAL_DRAFT_PROMPT,
      user_prompt: buildUserPrompt({
        mode: options.mode,
        seed_manual: options.seed_manual,
        current_manual: options.current_manual,
        target_fields: options.target_fields,
        source_code_hint: options.source_code_hint,
        feedback,
      }),
      output_schema: options.output_schema,
    });
    let candidate = normalizeToolManual(generation.payload);
    if (options.mode === "gap_fill" && options.current_manual) {
      candidate = mergeToolManualPatch(options.current_manual, candidate, options.target_fields);
    }
    const report = score_tool_manual_offline(candidate);
    const [validation_ok, validation_issues] = validate_tool_manual(candidate);
    report.validation_ok = Boolean(report.validation_ok) && validation_ok;
    if ((report.validation_errors?.length ?? 0) === 0) {
      report.validation_errors = validation_issues.filter((issue) => issue.severity === "error");
    }
    const attempt: ToolManualAssistAttempt = {
      attempt_number: attemptNumber,
      provider: options.llm.provider_name,
      model: options.llm.model,
      input_tokens: generation.usage.input_tokens,
      output_tokens: generation.usage.output_tokens,
      cache_creation_input_tokens: generation.usage.cache_creation_input_tokens,
      cache_read_input_tokens: generation.usage.cache_read_input_tokens,
      estimated_cost_usd: options.llm.estimate_cost_usd(generation.usage),
      overall_score: report.overall_score,
      grade: report.grade,
      validation_ok: report.validation_ok ?? false,
    };
    metadata.attempts.push(attempt);
    metadata.attempt_count = metadata.attempts.length;
    metadata.total_input_tokens += attempt.input_tokens;
    metadata.total_output_tokens += attempt.output_tokens;
    metadata.total_cache_creation_input_tokens += attempt.cache_creation_input_tokens;
    metadata.total_cache_read_input_tokens += attempt.cache_read_input_tokens;
    metadata.total_estimated_cost_usd =
      metadata.total_estimated_cost_usd === null || attempt.estimated_cost_usd === null
        ? null
        : Number((metadata.total_estimated_cost_usd + attempt.estimated_cost_usd).toFixed(8));
    lastReport = report;
    if (attempt.validation_ok && (attempt.grade === "A" || attempt.grade === "B")) {
      return {
        tool_manual: candidate,
        quality_report: report,
        metadata,
      };
    }
    feedback = buildFeedback(report);
  }
  throw new SiglumeAssistError(
    `ToolManual generation did not reach grade B or better after ${options.max_attempts} attempts. Last grade: ${lastReport?.grade ?? "F"}.`,
  );
}

function buildUserPrompt(options: {
  mode: "draft" | "gap_fill";
  seed_manual: Record<string, unknown> | null;
  current_manual: ToolManual | null;
  target_fields: readonly ToolManualField[];
  source_code_hint?: string;
  feedback: Record<string, unknown> | null;
}): string {
  return [
    "Generate a Siglume ToolManual payload that satisfies the requested JSON schema.",
    "Use factual, concrete wording. Avoid marketing language and vague phrases.",
    "ToolManual.permission_class must use read_only, action, or payment.",
    "For payment tools, currency must be USD.",
    "For gap_fill mode, preserve every non-target field exactly as provided in current_manual.",
    "Return only the structured payload required by the schema.",
    "",
    JSON.stringify(
      {
        mode: options.mode,
        seed_manual: options.seed_manual,
        current_manual: options.current_manual,
        target_fields: [...options.target_fields],
        source_code_hint: options.source_code_hint ?? null,
        feedback_from_previous_attempt: options.feedback,
      },
      null,
      2,
    ),
  ].join("\n");
}

function collectTargetFields(
  manual: ToolManual,
  report: ToolManualQualityReport,
  permissionClass: ToolManual["permission_class"] | null = null,
): ToolManualField[] {
  const targetFields = new Set<ToolManualField>();
  for (const fieldName of BASE_REQUIRED_FIELDS) {
    if (isFieldMissingOrEmpty(fieldName, manual[fieldName])) {
      targetFields.add(fieldName);
    }
  }
  const effectivePermissionClass = permissionClass ?? manual.permission_class;
  if (effectivePermissionClass === "action" || effectivePermissionClass === "payment") {
    for (const fieldName of ACTION_REQUIRED_FIELDS) {
      if (isFieldMissingOrEmpty(fieldName, manual[fieldName])) {
        targetFields.add(fieldName);
      }
    }
  }
  if (effectivePermissionClass === "payment") {
    for (const fieldName of PAYMENT_REQUIRED_FIELDS) {
      if (isFieldMissingOrEmpty(fieldName, manual[fieldName])) {
        targetFields.add(fieldName);
      }
    }
  }
  const [validation_ok, validation_issues] = validate_tool_manual(manual);
  if (!validation_ok) {
    for (const issue of validation_issues) {
      const root = rootField(issue.field);
      if (root && ALL_TOOL_MANUAL_FIELDS.includes(root)) {
        targetFields.add(root);
      }
    }
  }
  if (report.grade !== "A" && report.grade !== "B") {
    for (const issue of report.issues) {
      const root = rootField(issue.field);
      if (root && ALL_TOOL_MANUAL_FIELDS.includes(root)) {
        targetFields.add(root);
      }
    }
  }
  return [...targetFields];
}

function buildFeedback(report: ToolManualQualityReport): Record<string, unknown> {
  return {
    overall_score: report.overall_score,
    grade: report.grade,
    issues: report.issues.map((issue) => ({
      field: issue.field ?? null,
      message: issue.message,
      severity: issue.severity,
      suggestion: issue.suggestion ?? null,
    })),
    improvement_suggestions: [...report.improvement_suggestions],
  };
}

function mergeToolManualPatch(
  currentManual: ToolManual,
  patch: ToolManual,
  targetFields: readonly ToolManualField[],
): ToolManual {
  const merged: Record<string, unknown> = { ...currentManual };
  for (const fieldName of targetFields) {
    if (fieldName in patch) {
      merged[fieldName] = patch[fieldName];
    }
  }
  return normalizeToolManual(merged);
}

function normalizeToolManual(raw: Record<string, unknown>): ToolManual {
  const normalized: Record<string, unknown> = {};
  for (const fieldName of ALL_TOOL_MANUAL_FIELDS) {
    if (!(fieldName in raw)) {
      continue;
    }
    const value = raw[fieldName];
    if (fieldName === "trigger_conditions" || fieldName === "do_not_use_when" || fieldName === "requires_connected_accounts" || fieldName === "usage_hints" || fieldName === "result_hints" || fieldName === "error_hints") {
      normalized[fieldName] = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      continue;
    }
    if (fieldName === "input_schema" || fieldName === "output_schema" || fieldName === "preview_schema" || fieldName === "quote_schema") {
      normalized[fieldName] = normalizeSchema(value);
      continue;
    }
    if (fieldName === "dry_run_supported" || fieldName === "idempotency_support") {
      // Do not coerce — Boolean("false") === true would mask a real type error
      // and let invalid idempotency_support slip past validation for action/payment.
      // Preserve the original so the ToolManual validator can reject it explicitly.
      normalized[fieldName] = value;
      continue;
    }
    if (fieldName === "currency" && typeof value === "string") {
      normalized[fieldName] = value.toUpperCase();
      continue;
    }
    normalized[fieldName] = value;
  }
  return normalized as unknown as ToolManual;
}

function normalizeSchema(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return { ...value };
  }
  if (typeof value === "string") {
    try {
      const decoded = JSON.parse(value);
      return isRecord(decoded) ? decoded : {};
    } catch {
      return {};
    }
  }
  return {};
}

function buildToolManualSchema(
  permissionClass: ToolManual["permission_class"] | "read_only",
  fields: readonly ToolManualField[],
): Record<string, unknown> {
  const properties: Record<ToolManualField, Record<string, unknown>> = {
    tool_name: { type: "string", minLength: 3, maxLength: 64 },
    job_to_be_done: { type: "string", minLength: 10, maxLength: 500 },
    summary_for_model: { type: "string", minLength: 10, maxLength: 300 },
    trigger_conditions: {
      type: "array",
      items: { type: "string", minLength: 10, maxLength: 200 },
      minItems: 1,
    },
    do_not_use_when: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 200 },
      minItems: 1,
    },
    permission_class: { type: "string", enum: ["read_only", "action", "payment"] },
    dry_run_supported: { type: "boolean" },
    requires_connected_accounts: { type: "array", items: { type: "string" } },
    input_schema: { type: "object" },
    output_schema: { type: "object" },
    usage_hints: { type: "array", items: { type: "string" } },
    result_hints: { type: "array", items: { type: "string" } },
    error_hints: { type: "array", items: { type: "string" } },
    approval_summary_template: { type: "string" },
    preview_schema: { type: "object" },
    idempotency_support: { type: "boolean" },
    side_effect_summary: { type: "string" },
    quote_schema: { type: "object" },
    currency: { type: "string", enum: ["USD"] },
    settlement_mode: { type: "string", enum: [...PAYMENT_SETTLEMENT_MODES] },
    refund_or_cancellation_note: { type: "string" },
    jurisdiction: { type: "string" },
    legal_notes: { type: "string" },
  };
  const selectedFields = [...new Set(fields)];
  let required = [...selectedFields];
  if (selectedFields.length === ALL_TOOL_MANUAL_FIELDS.length) {
    required = [...BASE_REQUIRED_FIELDS];
    if (permissionClass === "action" || permissionClass === "payment") {
      required.push(...ACTION_REQUIRED_FIELDS);
    }
    if (permissionClass === "payment") {
      required.push(...PAYMENT_REQUIRED_FIELDS);
    }
  }
  return {
    type: "object",
    properties: Object.fromEntries(selectedFields.map((fieldName) => [fieldName, properties[fieldName]])),
    required,
    additionalProperties: false,
  };
}

function parseOpenAIPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    try {
      const decoded = JSON.parse(payload.output_text);
      if (isRecord(decoded)) {
        return { ...decoded };
      }
    } catch {
      throw new SiglumeAssistError("OpenAI Responses output_text did not contain valid JSON.");
    }
  }
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!isRecord(item) || !Array.isArray(item.content)) {
        continue;
      }
      for (const block of item.content) {
        if (!isRecord(block) || typeof block.text !== "string") {
          continue;
        }
        try {
          const decoded = JSON.parse(block.text);
          if (isRecord(decoded)) {
            return { ...decoded };
          }
        } catch {
          continue;
        }
      }
    }
  }
  throw new SiglumeAssistError("OpenAIProvider did not return a structured JSON object.");
}

function rootField(fieldName: string | undefined): ToolManualField | null {
  if (!fieldName) {
    return null;
  }
  const root = fieldName.split("[", 1)[0]?.split(".", 1)[0];
  if (root && ALL_TOOL_MANUAL_FIELDS.includes(root as ToolManualField)) {
    return root as ToolManualField;
  }
  return null;
}

function inferPermissionClass(manual: ToolManual): ToolManual["permission_class"] | null {
  if (VALID_PERMISSION_CLASSES.has(String(manual.permission_class ?? ""))) {
    return manual.permission_class;
  }
  if (PAYMENT_REQUIRED_FIELDS.some((fieldName) => !isFieldMissingOrEmpty(fieldName, manual[fieldName]))) {
    return "payment";
  }
  if (ACTION_REQUIRED_FIELDS.some((fieldName) => !isFieldMissingOrEmpty(fieldName, manual[fieldName]))) {
    return "action";
  }
  return null;
}

function isMissingOrEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

function isFieldMissingOrEmpty(fieldName: ToolManualField, value: unknown): boolean {
  if (fieldName === "requires_connected_accounts" && Array.isArray(value)) {
    return false;
  }
  return isMissingOrEmpty(value);
}

function safeInt(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function readEnv(name: string): string | undefined {
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (processEnv && typeof processEnv[name] === "string" && processEnv[name]) {
    return processEnv[name];
  }
  const bunEnv = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun?.env;
  if (bunEnv && typeof bunEnv[name] === "string" && bunEnv[name]) {
    return bunEnv[name];
  }
  const denoEnv = (globalThis as { Deno?: { env?: { get: (key: string) => string | undefined } } }).Deno?.env;
  if (denoEnv && typeof denoEnv.get === "function") {
    const value = denoEnv.get(name);
    if (value) {
      return value;
    }
  }
  return undefined;
}
