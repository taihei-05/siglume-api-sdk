import type {
  AccessGrantRecord,
  AccountPlan,
  AccountPlanCancellation,
  AccountFeedbackSubmission,
  AccountPreferences,
  AgentCharter,
  AgentRecord,
  AppListingRecord,
  AppManifest,
  ApprovalPolicy,
  AutoRegistrationReceipt,
  BillingPortalLink,
  BudgetPolicy,
  CapabilityBindingRecord,
  CapabilitySaveStateRecord,
  CursorPage,
  DeveloperPortalSummary,
  EnvelopeMeta,
  GrantBindingResult,
  InstalledToolBindingPolicyRecord,
  InstalledToolConnectionReadiness,
  InstalledToolExecutionRecord,
  InstalledToolPolicyUpdateResult,
  InstalledToolReceiptRecord,
  InstalledToolReceiptStepRecord,
  InstalledToolRecord,
  RegistrationConfirmation,
  RegistrationQuality,
  SandboxSession,
  PlanCheckoutSession,
  PlanWeb3Mandate,
  SupportCaseRecord,
  ToolManual,
  ToolManualIssue,
  ToolManualQualityReport,
  UsageEventRecord,
} from "./types";
import { MINIMUM_JPY_OPERATION_PRICE_MINOR } from "./types";
import { SiglumeAPIError, SiglumeClientError, SiglumeNotFoundError } from "./errors";
import {
  type QueuedWebhookEvent,
  type WebhookDeliveryRecord,
  type WebhookSubscriptionRecord,
  parse_queued_webhook_event,
  parse_webhook_delivery,
  parse_webhook_subscription,
} from "./webhooks";
import {
  type CrossCurrencyQuote,
  type EmbeddedWalletCharge,
  type PolygonMandate,
  type SettlementReceipt,
  parse_cross_currency_quote,
  parse_embedded_wallet_charge,
  parse_polygon_mandate,
  parse_settlement_receipt,
} from "./web3";
import {
  type OperationExecution,
  type OperationMetadata,
  buildOperationMetadata,
  fallbackOperationCatalog,
} from "./operations";
import {
  buildRegistrationStubSource,
  coerceMapping,
  isRecord,
  numberOrNull,
  parseRetryAfter,
  sleep,
  stringOrNull,
  toJsonable,
  toRecord,
} from "./utils";

export const DEFAULT_SIGLUME_API_BASE = "https://siglume.com/v1";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MINIMUM_JPY_OPERATION_PRICE_CURRENCIES = new Set(["JPY", "JPYC"]);
const LISTING_SHORT_DESCRIPTION_MAX_LENGTH = 60;
const LISTING_JOB_TO_BE_DONE_MAX_LENGTH = 240;
const LISTING_DESCRIPTION_MAX_LENGTH = 1000;

type FetchLike = typeof fetch;

type RequestOptions = {
  params?: Record<string, string | number | boolean | undefined | null>;
  json_body?: Record<string, unknown>;
  headers?: Record<string, string>;
};

export interface SiglumeClientOptions {
  api_key?: string;
  agent_key?: string;
  base_url?: string;
  timeout_ms?: number;
  max_retries?: number;
  fetch?: FetchLike;
}

function validateManifestPersistenceContract(payload: Record<string, unknown>): void {
  const vertical = String(payload.store_vertical ?? "").trim().toLowerCase();
  const persistence = payload.persistence;
  if (persistence === undefined || persistence === null) {
    return;
  }
  if (!isRecord(persistence)) {
    throw new SiglumeClientError("AppManifest.persistence must be an object.");
  }
  const mode = String(persistence.mode ?? (vertical === "game" ? "platform" : "none"))
    .trim()
    .toLowerCase();
  if (!["none", "local", "platform", "developer_server"].includes(mode)) {
    throw new SiglumeClientError(
      "AppManifest.persistence.mode must be one of: none, local, platform, developer_server.",
    );
  }
  const schema = persistence.save_data_schema;
  if (vertical === "game" && mode !== "none" && schema === undefined) {
    throw new SiglumeClientError(
      "AppManifest.persistence.save_data_schema is required when store_vertical='game' and persistence.mode is not 'none'.",
    );
  }
  if (schema !== undefined) {
    validateSaveDataSchema(schema, "AppManifest.persistence.save_data_schema");
  }
}

function validateSaveDataSchema(schema: unknown, fieldName: string): void {
  if (!isRecord(schema)) {
    throw new SiglumeClientError(`${fieldName} must be a JSON Schema object.`);
  }
  const schemaSize = new TextEncoder().encode(JSON.stringify(schema)).length;
  if (schemaSize > 8192) {
    throw new SiglumeClientError(`${fieldName} must be at most 8192 bytes.`);
  }
  if (schema.type !== "object") {
    throw new SiglumeClientError(`${fieldName}.type must be 'object'.`);
  }
  const properties = schema.properties;
  if (!isRecord(properties) || Object.keys(properties).length === 0) {
    throw new SiglumeClientError(`${fieldName}.properties must be a non-empty object.`);
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || !schema.required.every((item) => typeof item === "string")) {
      throw new SiglumeClientError(`${fieldName}.required must be an array of strings when provided.`);
    }
    const missing = schema.required.filter((item) => !(item in properties));
    if (missing.length > 0) {
      throw new SiglumeClientError(`${fieldName}.required references undefined properties: ${missing.join(", ")}.`);
    }
  }
}

function validatePricingPlanFloor(plan: unknown, defaultCurrency: string): void {
  if (plan === undefined || plan === null) {
    return;
  }
  if (!isRecord(plan)) {
    throw new SiglumeClientError("AppManifest.pricing_plan must be an object when provided.");
  }
  const items = plan.items;
  if (items === undefined || items === null) {
    return;
  }
  if (!Array.isArray(items)) {
    throw new SiglumeClientError("AppManifest.pricing_plan.items must be an array when provided.");
  }
  const planCurrency = String(plan.currency ?? defaultCurrency ?? "").trim().toUpperCase();
  const seenKeys = new Set<string>();
  items.forEach((item, index) => {
    if (!isRecord(item)) {
      throw new SiglumeClientError(`AppManifest.pricing_plan.items[${index}] must be an object.`);
    }
    const itemKey = String(
      item.key ?? item.operation ?? item.operation_key ?? item.request_type ?? item.receipt_code ?? item.action ?? "",
    ).trim();
    if (!itemKey) {
      throw new SiglumeClientError(`AppManifest.pricing_plan.items[${index}].key is required.`);
    }
    if (seenKeys.has(itemKey)) {
      throw new SiglumeClientError(`AppManifest.pricing_plan.items[${index}].key duplicates ${itemKey}.`);
    }
    seenKeys.add(itemKey);
    const amountRaw = item.price_minor ?? item.amount_minor ?? item.cost_minor ?? item.value_minor;
    if (amountRaw === undefined || amountRaw === null) {
      throw new SiglumeClientError(`AppManifest.pricing_plan.items[${index}].price_minor is required.`);
    }
    const amountMinor =
      typeof amountRaw === "number" ? amountRaw : typeof amountRaw === "string" && amountRaw.trim() ? Number(amountRaw) : NaN;
    if (!Number.isInteger(amountMinor)) {
      throw new SiglumeClientError(`AppManifest.pricing_plan.items[${index}].price_minor must be an integer.`);
    }
    if (amountMinor < 0) {
      throw new SiglumeClientError(`AppManifest.pricing_plan.items[${index}].price_minor must be zero or positive.`);
    }
    const currency = String(item.currency ?? planCurrency ?? defaultCurrency ?? "").trim().toUpperCase();
    if (
      MINIMUM_JPY_OPERATION_PRICE_CURRENCIES.has(currency) &&
      amountMinor > 0 &&
      amountMinor < MINIMUM_JPY_OPERATION_PRICE_MINOR
    ) {
      throw new SiglumeClientError(
        `AppManifest.pricing_plan.items[${index}].price_minor must be 0 or at least ${MINIMUM_JPY_OPERATION_PRICE_MINOR} for JPY/JPYC operation billing.`,
      );
    }
  });
}

function pricingPlanHasItems(plan: unknown): boolean {
  return isRecord(plan) && Array.isArray(plan.items) && plan.items.length > 0;
}

function validateListingTextLengths(payload: Record<string, unknown>): void {
  const limits: Record<string, number> = {
    short_description: LISTING_SHORT_DESCRIPTION_MAX_LENGTH,
    job_to_be_done: LISTING_JOB_TO_BE_DONE_MAX_LENGTH,
    description: LISTING_DESCRIPTION_MAX_LENGTH,
  };
  for (const [fieldName, maxLength] of Object.entries(limits)) {
    const value = payload[fieldName];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      throw new SiglumeClientError(`AppManifest.${fieldName} must be a string when provided.`);
    }
    // Count Unicode code points (Array.from), not UTF-16 code units, so the
    // limit matches the Python SDK / OpenAPI maxLength for non-BMP text (emoji).
    if (Array.from(value).length > maxLength) {
      throw new SiglumeClientError(`AppManifest.${fieldName} must be at most ${maxLength} characters.`);
    }
  }
}

type PendingConfirmation = {
  manifest: Record<string, unknown>;
  tool_manual: Record<string, unknown>;
  input_form_spec: Record<string, unknown>;
};

type RequestMetaTuple = [Record<string, unknown>, EnvelopeMeta];
type RequestAnyTuple = [unknown, EnvelopeMeta];

export interface SiglumeClientShape {
  auto_register(
    manifest: AppManifest | Record<string, unknown>,
    tool_manual: ToolManual | Record<string, unknown>,
    options?: {
      source_code?: string;
      source_url?: string;
      runtime_validation?: Record<string, unknown>;
      source_context?: Record<string, unknown>;
      input_form_spec?: Record<string, unknown>;
    },
  ): Promise<AutoRegistrationReceipt>;
  confirm_registration(
    listing_id: string,
    options?: {
      manifest?: AppManifest | Record<string, unknown>;
      tool_manual?: ToolManual | Record<string, unknown>;
      version_bump?: "patch" | "minor" | "major";
      visibility?: "public" | "private";
    },
  ): Promise<RegistrationConfirmation>;
  preview_quality_score(tool_manual: ToolManual | Record<string, unknown>): Promise<ToolManualQualityReport>;
  submit_review(listing_id: string): Promise<AppListingRecord>;
  list_my_listings(options?: { status?: string; limit?: number; cursor?: string }): Promise<CursorPage<AppListingRecord>>;
  get_listing(listing_id: string): Promise<AppListingRecord>;
  get_capability_state(capability_key: string, save_key?: string): Promise<CapabilitySaveStateRecord>;
  put_capability_state(
    capability_key: string,
    save_key?: string,
    payload?: Record<string, unknown>,
    options?: { schema_version?: string; expected_revision?: number | null; metadata?: Record<string, unknown> },
  ): Promise<CapabilitySaveStateRecord>;
  delete_capability_state(capability_key: string, save_key?: string): Promise<CapabilitySaveStateRecord>;
  list_capabilities(options?: {
    mine?: boolean;
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CursorPage<AppListingRecord>>;
  // Connected accounts: publisher APIs own external OAuth and token storage.

  get_developer_portal(): Promise<DeveloperPortalSummary>;
  create_sandbox_session(options: { agent_id: string; capability_key: string }): Promise<SandboxSession>;
  get_usage(options?: {
    capability_key?: string;
    agent_id?: string;
    outcome?: string;
    environment?: string;
    period_key?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CursorPage<UsageEventRecord>>;
  list_agents(options?: { query?: string; limit?: number }): Promise<AgentRecord[]>;
  list_operations(options?: { agent_id?: string; lang?: string }): Promise<OperationMetadata[]>;
  get_operation_metadata(operation_key: string, options?: { agent_id?: string; lang?: string }): Promise<OperationMetadata>;
  get_account_preferences(): Promise<AccountPreferences>;
  update_account_preferences(options: {
    language?: string;
    summary_depth?: string;
    notification_mode?: string;
    autonomy_level?: string;
    interest_profile?: Record<string, unknown>;
    consent_policy?: Record<string, unknown>;
  }): Promise<AccountPreferences>;
  get_account_plan(): Promise<AccountPlan>;
  start_plan_checkout(options: { target_tier: string; currency?: string }): Promise<PlanCheckoutSession>;
  open_plan_billing_portal(): Promise<BillingPortalLink>;
  cancel_account_plan(): Promise<AccountPlanCancellation>;
  create_plan_web3_mandate(options: { target_tier: string; currency?: string }): Promise<PlanWeb3Mandate>;
  cancel_plan_web3_mandate(): Promise<PlanWeb3Mandate>;
  submit_account_feedback(
    ref_type: string,
    ref_id: string,
    feedback_type: string,
    options?: { reason?: string },
  ): Promise<AccountFeedbackSubmission>;
  get_agent(
    agent_id: string,
  ): Promise<AgentRecord>;
  execute_owner_operation(
    agent_id: string,
    operation_key: string,
    params?: Record<string, unknown>,
    options?: { lang?: string },
  ): Promise<OperationExecution>;
  list_installed_tools(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<InstalledToolRecord[]>;
  get_installed_tools_connection_readiness(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<InstalledToolConnectionReadiness>;
  update_installed_tool_binding_policy(
    binding_id: string,
    options?: {
      agent_id?: string;
      permission_class?: string;
      max_calls_per_day?: number;
      monthly_usage_cap?: number;
      max_spend_per_execution?: number;
      allowed_tasks_jsonb?: string[];
      allowed_source_types_jsonb?: string[];
      timeout_ms?: number;
      cooldown_seconds?: number;
      require_owner_approval?: boolean;
      require_owner_approval_over_cost?: number;
      dry_run_only?: boolean;
      retry_policy_jsonb?: Record<string, unknown>;
      fallback_mode?: string;
      auto_execute_read_only?: boolean;
      allow_background_execution?: boolean;
      max_calls_per_hour?: number;
      max_chain_steps?: number;
      max_parallel_executions?: number;
      max_spend_usd_cents_per_day?: number;
      approval_mode?: string;
      kill_switch_state?: string;
      allowed_connected_account_ids_jsonb?: string[];
      metadata_jsonb?: Record<string, unknown>;
      lang?: string;
    },
  ): Promise<InstalledToolPolicyUpdateResult>;
  get_installed_tool_execution(
    intent_id: string,
    options?: { agent_id?: string; lang?: string },
  ): Promise<InstalledToolExecutionRecord>;
  list_installed_tool_receipts(options?: {
    agent_id?: string;
    receipt_agent_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
    lang?: string;
  }): Promise<InstalledToolReceiptRecord[]>;
  get_installed_tool_receipt(
    receipt_id: string,
    options?: { agent_id?: string; lang?: string },
  ): Promise<InstalledToolReceiptRecord>;
  get_installed_tool_receipt_steps(
    receipt_id: string,
    options?: { agent_id?: string; lang?: string },
  ): Promise<InstalledToolReceiptStepRecord[]>;
  update_agent_charter(
    agent_id: string,
    charter_text: string,
    options?: {
      role?: string;
      target_profile?: Record<string, unknown>;
      qualification_criteria?: Record<string, unknown>;
      success_metrics?: Record<string, unknown>;
      constraints?: Record<string, unknown>;
      wait_for_completion?: boolean;
    },
  ): Promise<AgentCharter>;
  update_approval_policy(
    agent_id: string,
    policy: Record<string, unknown>,
    options?: { wait_for_completion?: boolean },
  ): Promise<ApprovalPolicy>;
  update_budget_policy(
    agent_id: string,
    policy: Record<string, unknown>,
    options?: { wait_for_completion?: boolean },
  ): Promise<BudgetPolicy>;
  list_access_grants(options?: {
    status?: string;
    agent_id?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CursorPage<AccessGrantRecord>>;
  bind_agent_to_grant(
    grant_id: string,
    options: { agent_id: string; binding_status?: string },
  ): Promise<GrantBindingResult>;
  create_support_case(
    subject: string,
    body: string,
    options?: {
      trace_id?: string;
      case_type?: string;
      capability_key?: string;
      agent_id?: string;
      environment?: string;
    },
  ): Promise<SupportCaseRecord>;
  list_support_cases(options?: {
    capability_key?: string;
    trace_id?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CursorPage<SupportCaseRecord>>;
  create_webhook_subscription(options: {
    callback_url: string;
    description?: string;
    // Required by the concrete implementation (SiglumeClient.
    // create_webhook_subscription immediately calls
    // options.event_types.map(...)). Make it required at the type
    // level so TS consumers get a compile-time error instead of a
    // runtime TypeError before the intended validation runs.
    event_types: string[];
    metadata?: Record<string, unknown>;
  }): Promise<WebhookSubscriptionRecord>;
  list_webhook_subscriptions(): Promise<WebhookSubscriptionRecord[]>;
  get_webhook_subscription(subscription_id: string): Promise<WebhookSubscriptionRecord>;
  rotate_webhook_subscription_secret(subscription_id: string): Promise<WebhookSubscriptionRecord>;
  pause_webhook_subscription(subscription_id: string): Promise<WebhookSubscriptionRecord>;
  resume_webhook_subscription(subscription_id: string): Promise<WebhookSubscriptionRecord>;
  list_webhook_deliveries(options?: {
    subscription_id?: string;
    event_type?: string;
    status?: string;
    limit?: number;
  }): Promise<WebhookDeliveryRecord[]>;
  redeliver_webhook_delivery(delivery_id: string): Promise<WebhookDeliveryRecord>;
  send_test_webhook_delivery(options: {
    event_type: string;
    subscription_ids?: string[];
    data?: Record<string, unknown>;
  }): Promise<QueuedWebhookEvent>;
  list_polygon_mandates(options?: {
    status?: string;
    purpose?: string;
    limit?: number;
  }): Promise<PolygonMandate[]>;
  get_polygon_mandate(mandate_id: string, options?: {
    status?: string;
    purpose?: string;
    limit?: number;
  }): Promise<PolygonMandate>;
  list_settlement_receipts(options?: {
    receipt_kind?: string;
    limit?: number;
  }): Promise<SettlementReceipt[]>;
  get_settlement_receipt(receipt_id: string, options?: {
    receipt_kind?: string;
    limit?: number;
  }): Promise<SettlementReceipt>;
  get_embedded_wallet_charge(options: {
    tx_hash: string;
    limit?: number;
  }): Promise<EmbeddedWalletCharge>;
  get_cross_currency_quote(options: {
    from_currency: string;
    to_currency: string;
    source_amount_minor: number;
    slippage_bps?: number;
  }): Promise<CrossCurrencyQuote>;
}

class CursorPageResult<T> implements CursorPage<T> {
  items: T[];
  next_cursor?: string | null;
  limit?: number | null;
  offset?: number | null;
  meta: EnvelopeMeta;
  private readonly fetchNext?: (cursor: string) => Promise<CursorPageResult<T>>;

  constructor(options: {
    items: T[];
    next_cursor?: string | null;
    limit?: number | null;
    offset?: number | null;
    meta: EnvelopeMeta;
    fetchNext?: (cursor: string) => Promise<CursorPageResult<T>>;
  }) {
    this.items = options.items;
    this.next_cursor = options.next_cursor;
    this.limit = options.limit;
    this.offset = options.offset;
    this.meta = options.meta;
    this.fetchNext = options.fetchNext;
  }

  async *pages(): AsyncGenerator<CursorPageResult<T>> {
    let page: CursorPageResult<T> | undefined = this;
    while (page) {
      yield page;
      if (!page.next_cursor || !page.fetchNext) {
        return;
      }
      page = await page.fetchNext(page.next_cursor);
    }
  }

  async all_items(): Promise<T[]> {
    const items: T[] = [];
    for await (const page of this.pages()) {
      items.push(...page.items);
    }
    return items;
  }

  async allItems(): Promise<T[]> {
    return this.all_items();
  }
}

function buildToolManualQualityReport(payload: Record<string, unknown>): ToolManualQualityReport {
  const qualityBlock = isRecord(payload.quality) ? payload.quality : payload;
  const issues: ToolManualIssue[] = [];
  const validation_errors: ToolManualIssue[] = [];
  const validation_warnings: ToolManualIssue[] = [];

  for (const [bucketName, severity] of [
    ["errors", "error"],
    ["warnings", "warning"],
  ] as const) {
    const bucket = payload[bucketName];
    if (!Array.isArray(bucket)) {
      continue;
    }
    for (const item of bucket) {
      if (!isRecord(item)) {
        continue;
      }
      const nextIssue: ToolManualIssue = {
        code: String(item.code ?? bucketName.toUpperCase()),
        message: String(item.message ?? ""),
        field: stringOrNull(item.field) ?? undefined,
        severity,
      };
      issues.push(nextIssue);
      if (bucketName === "errors") {
        validation_errors.push(nextIssue);
      } else {
        validation_warnings.push(nextIssue);
      }
    }
  }

  const qualityIssues = qualityBlock.issues;
  if (Array.isArray(qualityIssues)) {
    for (const item of qualityIssues) {
      if (!isRecord(item)) {
        continue;
      }
      issues.push({
        code: String(item.category ?? item.code ?? "QUALITY_ISSUE"),
        message: String(item.message ?? ""),
        field: stringOrNull(item.field) ?? undefined,
        severity: (String(item.severity ?? "warning") as ToolManualIssue["severity"]),
        suggestion: stringOrNull(item.suggestion) ?? undefined,
      });
    }
  }

  const suggestions = Array.isArray(qualityBlock.improvement_suggestions)
    ? qualityBlock.improvement_suggestions.filter((item): item is string => typeof item === "string")
    : [];
  const keywordCoverage = Number(qualityBlock.keyword_coverage_estimate ?? qualityBlock.keyword_coverage ?? 0);
  const overallScore = Number(qualityBlock.overall_score ?? qualityBlock.score ?? 0);
  const validation_ok = typeof payload.ok === "boolean" ? payload.ok : true;
  const publishable = typeof qualityBlock.publishable === "boolean"
    ? qualityBlock.publishable
    : validation_ok && String(qualityBlock.grade ?? "F") in { A: true, B: true };

  return {
    overall_score: Number.isFinite(overallScore) ? overallScore : 0,
    grade: String(qualityBlock.grade ?? "F") as ToolManualQualityReport["grade"],
    issues,
    keyword_coverage_estimate: Number.isFinite(keywordCoverage) ? keywordCoverage : 0,
    improvement_suggestions: suggestions,
    publishable,
    validation_ok,
    validation_errors,
    validation_warnings,
  };
}

function buildUrl(baseUrl: string, path: string, params?: RequestOptions["params"]): string {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function parseListing(data: Record<string, unknown>): AppListingRecord {
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const pricing_plan = isRecord(data.pricing_plan)
    ? data.pricing_plan
    : isRecord(metadata.pricing_plan)
      ? metadata.pricing_plan
      : null;
  const persistence = isRecord(data.persistence)
    ? data.persistence
    : isRecord(metadata.persistence)
      ? metadata.persistence
      : {};
  return {
    listing_id: String(data.listing_id ?? data.id ?? ""),
    capability_key: String(data.capability_key ?? ""),
    name: String(data.name ?? ""),
    status: String(data.status ?? ""),
    category: stringOrNull(data.category),
    job_to_be_done: stringOrNull(data.job_to_be_done),
    permission_class: stringOrNull(data.permission_class),
    approval_mode: stringOrNull(data.approval_mode),
    dry_run_supported: Boolean(data.dry_run_supported ?? false),
    price_model: stringOrNull(data.price_model),
    price_value_minor: Number(data.price_value_minor ?? 0),
    pricing_plan: pricing_plan as AppListingRecord["pricing_plan"],
    billing_timing: String(data.billing_timing ?? metadata.billing_timing ?? "post"),
    currency: String(data.currency ?? "USD"),
    allow_free_trial: Boolean(data.allow_free_trial ?? false),
    free_trial_duration_days: Number(data.free_trial_duration_days ?? 30),
    short_description: stringOrNull(data.short_description),
    description: stringOrNull(data.description),
    docs_url: stringOrNull(data.docs_url),
    support_contact: stringOrNull(data.support_contact),
    seller_display_name: stringOrNull(data.seller_display_name),
    seller_homepage_url: stringOrNull(data.seller_homepage_url),
    seller_social_url: stringOrNull(data.seller_social_url),
    review_status: stringOrNull(data.review_status),
    review_note: stringOrNull(data.review_note),
    submission_blockers: Array.isArray(data.submission_blockers)
      ? data.submission_blockers.filter((item): item is string => typeof item === "string")
      : [],
    persistence: { ...persistence },
    created_at: stringOrNull(data.created_at),
    updated_at: stringOrNull(data.updated_at),
    raw: { ...data },
  };
}

function parseCapabilitySaveState(data: Record<string, unknown>): CapabilitySaveStateRecord {
  return {
    capability_key: String(data.capability_key ?? ""),
    save_key: String(data.save_key ?? ""),
    schema_version: String(data.schema_version ?? "1"),
    revision: Number(data.revision ?? 0),
    payload: toRecord(data.payload),
    metadata: toRecord(data.metadata),
    checksum: stringOrNull(data.checksum),
    updated_at: stringOrNull(data.updated_at),
    created_at: stringOrNull(data.created_at),
    exists: Boolean(data.exists ?? false),
    raw: { ...data },
  };
}

function parseRegistrationQuality(data: Record<string, unknown>): RegistrationQuality {
  return {
    overall_score: Number(data.overall_score ?? data.score ?? 0),
    grade: String(data.grade ?? "F"),
    issues: Array.isArray(data.issues)
      ? data.issues.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => ({ ...item }))
      : [],
    improvement_suggestions: Array.isArray(data.improvement_suggestions)
      ? data.improvement_suggestions.filter((item): item is string => typeof item === "string")
      : [],
    raw: { ...data },
  };
}

function parseUsageEvent(data: Record<string, unknown>): UsageEventRecord {
  return {
    usage_event_id: String(data.usage_event_id ?? data.id ?? ""),
    capability_key: stringOrNull(data.capability_key),
    agent_id: stringOrNull(data.agent_id),
    dimension: stringOrNull(data.dimension),
    environment: stringOrNull(data.environment),
    task_type: stringOrNull(data.task_type),
    units_consumed: Number(data.units_consumed ?? data.units ?? 0),
    outcome: stringOrNull(data.outcome),
    execution_kind: stringOrNull(data.execution_kind),
    permission_class: stringOrNull(data.permission_class),
    approval_mode: stringOrNull(data.approval_mode),
    latency_ms: typeof data.latency_ms === "number" ? data.latency_ms : null,
    trace_id: stringOrNull(data.trace_id),
    period_key: stringOrNull(data.period_key),
    external_id: stringOrNull(data.external_id ?? data.idempotency_key),
    occurred_at_iso: stringOrNull(data.occurred_at_iso ?? data.occurred_at),
    created_at: stringOrNull(data.created_at),
    metadata: toRecord(data.metadata),
    raw: { ...data },
  };
}

function parseAccessGrant(data: Record<string, unknown>): AccessGrantRecord {
  return {
    access_grant_id: String(data.access_grant_id ?? data.id ?? ""),
    capability_listing_id: String(data.capability_listing_id ?? ""),
    grant_status: String(data.grant_status ?? ""),
    billing_model: stringOrNull(data.billing_model),
    agent_id: stringOrNull(data.agent_id),
    starts_at: stringOrNull(data.starts_at),
    ends_at: stringOrNull(data.ends_at),
    bindings: Array.isArray(data.bindings)
      ? data.bindings.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => ({ ...item }))
      : [],
    metadata: toRecord(data.metadata),
    raw: { ...data },
  };
}

function parseBinding(data: Record<string, unknown>): CapabilityBindingRecord {
  return {
    binding_id: String(data.binding_id ?? data.id ?? ""),
    access_grant_id: String(data.access_grant_id ?? ""),
    agent_id: String(data.agent_id ?? ""),
    binding_status: String(data.binding_status ?? ""),
    created_at: stringOrNull(data.created_at),
    updated_at: stringOrNull(data.updated_at),
    raw: { ...data },
  };
}

function parseSupportCase(data: Record<string, unknown>): SupportCaseRecord {
  return {
    support_case_id: String(data.support_case_id ?? data.id ?? ""),
    case_type: String(data.case_type ?? ""),
    summary: String(data.summary ?? ""),
    status: String(data.status ?? ""),
    capability_key: stringOrNull(data.capability_key),
    agent_id: stringOrNull(data.agent_id),
    trace_id: stringOrNull(data.trace_id),
    environment: stringOrNull(data.environment),
    resolution_note: stringOrNull(data.resolution_note),
    metadata: toRecord(data.metadata),
    created_at: stringOrNull(data.created_at),
    updated_at: stringOrNull(data.updated_at),
    raw: { ...data },
  };
}

function parseAgent(data: Record<string, unknown>): AgentRecord {
  return {
    agent_id: String(data.agent_id ?? data.id ?? ""),
    name: String(data.name ?? ""),
    avatar_url: stringOrNull(data.avatar_url),
    description: stringOrNull(data.description),
    agent_type: stringOrNull(data.agent_type),
    status: stringOrNull(data.status),
    expertise: Array.isArray(data.expertise)
      ? data.expertise.filter((item): item is string => typeof item === "string")
      : [],
    paused: typeof data.paused === "boolean" ? data.paused : null,
    style: stringOrNull(data.style),
    manifesto_text: stringOrNull(data.manifesto_text),
    capabilities: toRecord(data.capabilities),
    settings: toRecord(data.settings),
    growth: toRecord(data.growth),
    plan: toRecord(data.plan),
    reputation: toRecord(data.reputation),
    raw: { ...data },
  };
}

function parseAgentCharter(data: Record<string, unknown>): AgentCharter {
  const goals = toRecord(data.goals);
  return {
    charter_id: String(data.charter_id ?? data.id ?? ""),
    agent_id: String(data.agent_id ?? ""),
    principal_user_id: stringOrNull(data.principal_user_id),
    version: Number(data.version ?? 1),
    active: Boolean(data.active ?? true),
    role: String(data.role ?? "hybrid"),
    charter_text: stringOrNull(data.charter_text ?? goals.charter_text),
    goals,
    target_profile: toRecord(data.target_profile),
    qualification_criteria: toRecord(data.qualification_criteria),
    success_metrics: toRecord(data.success_metrics),
    constraints: toRecord(data.constraints),
    created_at: stringOrNull(data.created_at),
    updated_at: stringOrNull(data.updated_at),
    raw: { ...data },
  };
}

function parseApprovalPolicy(data: Record<string, unknown>): ApprovalPolicy {
  const auto_approve_below = Object.fromEntries(
    Object.entries(toRecord(data.auto_approve_below)).flatMap(([currency, amount]) => {
      const numericAmount = numberOrNull(amount);
      return numericAmount === null ? [] : [[currency, Math.trunc(numericAmount)]];
    }),
  );
  return {
    approval_policy_id: String(data.approval_policy_id ?? data.id ?? ""),
    agent_id: String(data.agent_id ?? ""),
    principal_user_id: stringOrNull(data.principal_user_id),
    version: Number(data.version ?? 1),
    active: Boolean(data.active ?? true),
    auto_approve_below,
    always_require_approval_for: Array.isArray(data.always_require_approval_for)
      ? data.always_require_approval_for.filter((item): item is string => typeof item === "string")
      : [],
    deny_if: toRecord(data.deny_if),
    approval_ttl_minutes: Number(data.approval_ttl_minutes ?? 1440),
    structured_only: Boolean(data.structured_only ?? true),
    default_requires_approval: Boolean(data.default_requires_approval ?? true),
    merchant_allowlist: Array.isArray(data.merchant_allowlist)
      ? data.merchant_allowlist.filter((item): item is string => typeof item === "string")
      : [],
    merchant_denylist: Array.isArray(data.merchant_denylist)
      ? data.merchant_denylist.filter((item): item is string => typeof item === "string")
      : [],
    category_allowlist: Array.isArray(data.category_allowlist)
      ? data.category_allowlist.filter((item): item is string => typeof item === "string")
      : [],
    category_denylist: Array.isArray(data.category_denylist)
      ? data.category_denylist.filter((item): item is string => typeof item === "string")
      : [],
    risk_policy: toRecord(data.risk_policy),
    created_at: stringOrNull(data.created_at),
    updated_at: stringOrNull(data.updated_at),
    raw: { ...data },
  };
}

function parseBudgetPolicy(data: Record<string, unknown>): BudgetPolicy {
  const limitsSource = toRecord(data.limits);
  const limits = Object.keys(limitsSource).length > 0
    ? Object.fromEntries(
        Object.entries(limitsSource).flatMap(([key, value]) => {
          const numericValue = numberOrNull(value);
          return numericValue === null ? [] : [[key, Math.trunc(numericValue)]];
        }),
      )
    : {
        period_limit: Math.trunc(Number(data.period_limit_minor ?? 0)),
        per_order_limit: Math.trunc(Number(data.per_order_limit_minor ?? 0)),
        auto_approve_below: Math.trunc(Number(data.auto_approve_below_minor ?? 0)),
      };
  return {
    budget_id: String(data.budget_id ?? data.id ?? ""),
    agent_id: String(data.agent_id ?? ""),
    principal_user_id: stringOrNull(data.principal_user_id),
    currency: String(data.currency ?? "JPY"),
    period_start: stringOrNull(data.period_start),
    period_end: stringOrNull(data.period_end),
    period_limit_minor: Math.trunc(Number(data.period_limit_minor ?? 0)),
    spent_minor: Math.trunc(Number(data.spent_minor ?? 0)),
    reserved_minor: Math.trunc(Number(data.reserved_minor ?? 0)),
    per_order_limit_minor: Math.trunc(Number(data.per_order_limit_minor ?? 0)),
    auto_approve_below_minor: Math.trunc(Number(data.auto_approve_below_minor ?? 0)),
    limits,
    metadata: toRecord(data.metadata),
    created_at: stringOrNull(data.created_at),
    updated_at: stringOrNull(data.updated_at),
    raw: { ...data },
  };
}

function parseInstalledTool(data: Record<string, unknown>): InstalledToolRecord {
  return {
    binding_id: String(data.binding_id ?? data.id ?? ""),
    listing_id: String(data.listing_id ?? ""),
    release_id: stringOrNull(data.release_id) ?? undefined,
    display_name: stringOrNull(data.display_name) ?? undefined,
    permission_class: stringOrNull(data.permission_class) ?? undefined,
    binding_status: stringOrNull(data.binding_status) ?? undefined,
    account_readiness: stringOrNull(data.account_readiness) ?? undefined,
    settlement_mode: stringOrNull(data.settlement_mode) ?? undefined,
    settlement_currency: stringOrNull(data.settlement_currency) ?? undefined,
    settlement_network: stringOrNull(data.settlement_network) ?? undefined,
    accepted_payment_tokens: Array.isArray(data.accepted_payment_tokens)
      ? data.accepted_payment_tokens.filter((item): item is string => typeof item === "string")
      : [],
    last_used_at: stringOrNull(data.last_used_at) ?? undefined,
    raw: { ...data },
  };
}

function parseInstalledToolConnectionReadiness(data: Record<string, unknown>): InstalledToolConnectionReadiness {
  const bindings = toRecord(data.bindings);
  const parsedBindings: Record<string, string> = {};
  for (const [key, value] of Object.entries(bindings)) {
    const status = typeof value === "string" ? value.trim() : String(value ?? "").trim();
    if (status.length > 0) {
      parsedBindings[String(key)] = status;
    }
  }
  return {
    agent_id: String(data.agent_id ?? ""),
    all_ready: Boolean(data.all_ready ?? true),
    bindings: parsedBindings,
    raw: { ...data },
  };
}

function parseInstalledToolBindingPolicy(data: Record<string, unknown>): InstalledToolBindingPolicyRecord {
  return {
    policy_id: String(data.policy_id ?? data.execution_policy_id ?? data.id ?? ""),
    capability_listing_id: stringOrNull(data.capability_listing_id) ?? undefined,
    owner_user_id: stringOrNull(data.owner_user_id) ?? undefined,
    permission_class: stringOrNull(data.permission_class) ?? undefined,
    max_calls_per_day: numberOrNull(data.max_calls_per_day) ?? undefined,
    monthly_usage_cap: numberOrNull(data.monthly_usage_cap) ?? undefined,
    max_spend_per_execution: numberOrNull(data.max_spend_per_execution) ?? undefined,
    allowed_tasks_jsonb: Array.isArray(data.allowed_tasks_jsonb)
      ? data.allowed_tasks_jsonb.filter((item): item is string => typeof item === "string")
      : [],
    allowed_source_types_jsonb: Array.isArray(data.allowed_source_types_jsonb)
      ? data.allowed_source_types_jsonb.filter((item): item is string => typeof item === "string")
      : [],
    timeout_ms: numberOrNull(data.timeout_ms) ?? undefined,
    cooldown_seconds: numberOrNull(data.cooldown_seconds) ?? undefined,
    require_owner_approval: Boolean(data.require_owner_approval ?? false),
    require_owner_approval_over_cost: numberOrNull(data.require_owner_approval_over_cost) ?? undefined,
    dry_run_only: Boolean(data.dry_run_only ?? false),
    retry_policy_jsonb: toRecord(data.retry_policy_jsonb),
    fallback_mode: stringOrNull(data.fallback_mode) ?? undefined,
    auto_execute_read_only: Boolean(data.auto_execute_read_only ?? true),
    allow_background_execution: Boolean(data.allow_background_execution ?? false),
    max_calls_per_hour: numberOrNull(data.max_calls_per_hour) ?? undefined,
    max_chain_steps: numberOrNull(data.max_chain_steps) ?? undefined,
    max_parallel_executions: Number(data.max_parallel_executions ?? 1),
    max_spend_usd_cents_per_day: numberOrNull(data.max_spend_usd_cents_per_day) ?? undefined,
    approval_mode: String(data.approval_mode ?? "always_ask"),
    kill_switch_state: String(data.kill_switch_state ?? "active"),
    allowed_connected_account_ids_jsonb: Array.isArray(data.allowed_connected_account_ids_jsonb)
      ? data.allowed_connected_account_ids_jsonb.filter((item): item is string => typeof item === "string")
      : [],
    metadata_jsonb: toRecord(data.metadata_jsonb),
    created_at: stringOrNull(data.created_at) ?? undefined,
    updated_at: stringOrNull(data.updated_at) ?? undefined,
    raw: { ...data },
  };
}

function parseInstalledToolPolicyUpdateResult(
  data: Record<string, unknown>,
  operation_key: string,
  meta: EnvelopeMeta,
): InstalledToolPolicyUpdateResult {
  const result = isRecord(data.result) ? data.result : {};
  const status = String(data.status ?? "completed");
  return {
    agent_id: String(data.agent_id ?? ""),
    operation_key,
    status,
    approval_required: Boolean(data.approval_required ?? status === "approval_required"),
    intent_id: stringOrNull(data.intent_id) ?? undefined,
    approval_status: stringOrNull(data.approval_status) ?? undefined,
    approval_snapshot_hash: stringOrNull(data.approval_snapshot_hash ?? result.approval_snapshot_hash) ?? undefined,
    message: String(data.message ?? ""),
    action: toRecord(data.action),
    preview: toRecord(result.preview),
    safety: toRecord(data.safety),
    policy: status === "completed" ? parseInstalledToolBindingPolicy(result) : null,
    trace_id: meta.trace_id ?? null,
    request_id: meta.request_id ?? null,
    raw: { ...data },
  };
}

function parseInstalledToolExecution(data: Record<string, unknown>): InstalledToolExecutionRecord {
  return {
    intent_id: String(data.intent_id ?? data.id ?? ""),
    agent_id: String(data.agent_id ?? ""),
    owner_user_id: stringOrNull(data.owner_user_id) ?? undefined,
    binding_id: stringOrNull(data.binding_id) ?? undefined,
    release_id: stringOrNull(data.release_id) ?? undefined,
    source: stringOrNull(data.source) ?? undefined,
    goal: stringOrNull(data.goal) ?? undefined,
    input_payload_jsonb: toRecord(data.input_payload_jsonb ?? data.input_payload),
    plan_jsonb: toRecord(data.plan_jsonb),
    status: String(data.status ?? ""),
    approval_status: stringOrNull(data.approval_status) ?? undefined,
    approval_snapshot_hash: stringOrNull(data.approval_snapshot_hash) ?? undefined,
    approval_snapshot_jsonb: toRecord(data.approval_snapshot_jsonb),
    approval_note: stringOrNull(data.approval_note) ?? undefined,
    rejection_reason: stringOrNull(data.rejection_reason) ?? undefined,
    permission_class: stringOrNull(data.permission_class) ?? undefined,
    idempotency_key: stringOrNull(data.idempotency_key) ?? undefined,
    trace_id: stringOrNull(data.trace_id) ?? undefined,
    error_class: stringOrNull(data.error_class) ?? undefined,
    error_message: stringOrNull(data.error_message) ?? undefined,
    metadata_jsonb: toRecord(data.metadata_jsonb),
    queued_at: stringOrNull(data.queued_at) ?? undefined,
    started_at: stringOrNull(data.started_at) ?? undefined,
    completed_at: stringOrNull(data.completed_at) ?? undefined,
    created_at: stringOrNull(data.created_at) ?? undefined,
    updated_at: stringOrNull(data.updated_at) ?? undefined,
    raw: { ...data },
  };
}

function parseInstalledToolReceipt(data: Record<string, unknown>): InstalledToolReceiptRecord {
  return {
    receipt_id: String(data.receipt_id ?? data.id ?? ""),
    intent_id: String(data.intent_id ?? ""),
    agent_id: String(data.agent_id ?? ""),
    owner_user_id: stringOrNull(data.owner_user_id) ?? undefined,
    binding_id: stringOrNull(data.binding_id) ?? undefined,
    grant_id: stringOrNull(data.grant_id) ?? undefined,
    release_ids_jsonb: Array.isArray(data.release_ids_jsonb)
      ? data.release_ids_jsonb.filter((item): item is string => typeof item === "string")
      : [],
    execution_source: stringOrNull(data.execution_source) ?? undefined,
    status: String(data.status ?? ""),
    permission_class: stringOrNull(data.permission_class) ?? undefined,
    approval_status: stringOrNull(data.approval_status) ?? undefined,
    step_count: Number(data.step_count ?? 0),
    total_latency_ms: numberOrNull(data.total_latency_ms) ?? undefined,
    total_billable_units: Number(data.total_billable_units ?? 0),
    total_amount_usd_cents: numberOrNull(data.total_amount_usd_cents) ?? undefined,
    summary: stringOrNull(data.summary) ?? undefined,
    failure_reason: stringOrNull(data.failure_reason) ?? undefined,
    trace_id: stringOrNull(data.trace_id) ?? undefined,
    metadata_jsonb: toRecord(data.metadata_jsonb),
    started_at: stringOrNull(data.started_at) ?? undefined,
    completed_at: stringOrNull(data.completed_at) ?? undefined,
    created_at: stringOrNull(data.created_at) ?? undefined,
    raw: { ...data },
  };
}

function parseInstalledToolReceiptStep(data: Record<string, unknown>): InstalledToolReceiptStepRecord {
  return {
    step_receipt_id: String(data.step_receipt_id ?? data.id ?? ""),
    intent_id: String(data.intent_id ?? ""),
    step_id: String(data.step_id ?? ""),
    tool_name: String(data.tool_name ?? ""),
    binding_id: stringOrNull(data.binding_id) ?? undefined,
    release_id: stringOrNull(data.release_id) ?? undefined,
    dry_run: Boolean(data.dry_run ?? false),
    status: String(data.status ?? ""),
    args_hash: stringOrNull(data.args_hash) ?? undefined,
    args_preview_redacted: stringOrNull(data.args_preview_redacted) ?? undefined,
    output_hash: stringOrNull(data.output_hash) ?? undefined,
    output_preview_redacted: stringOrNull(data.output_preview_redacted) ?? undefined,
    provider_latency_ms: numberOrNull(data.provider_latency_ms) ?? undefined,
    retry_count: Number(data.retry_count ?? 0),
    error_class: stringOrNull(data.error_class) ?? undefined,
    connected_account_ref: stringOrNull(data.connected_account_ref) ?? undefined,
    metadata_jsonb: toRecord(data.metadata_jsonb),
    created_at: stringOrNull(data.created_at) ?? undefined,
    raw: { ...data },
  };
}

function toRecordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => ({ ...item }))
    : [];
}

function parseAccountPreferences(data: Record<string, unknown>): AccountPreferences {
  return {
    language: stringOrNull(data.language) ?? undefined,
    summary_depth: stringOrNull(data.summary_depth) ?? undefined,
    notification_mode: stringOrNull(data.notification_mode) ?? undefined,
    autonomy_level: stringOrNull(data.autonomy_level) ?? undefined,
    interest_profile: toRecord(data.interest_profile),
    consent_policy: toRecord(data.consent_policy),
    raw: { ...data },
  };
}

function parseAccountPlan(data: Record<string, unknown>): AccountPlan {
  return {
    plan: String(data.plan ?? ""),
    display_name: stringOrNull(data.display_name) ?? undefined,
    limits: toRecord(data.limits),
    available_models: Array.isArray(data.available_models)
      ? data.available_models.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => ({ ...item }))
      : [],
    default_model: stringOrNull(data.default_model) ?? undefined,
    selected_model: stringOrNull(data.selected_model) ?? undefined,
    subscription_id: stringOrNull(data.subscription_id) ?? undefined,
    period_end: stringOrNull(data.period_end) ?? undefined,
    cancel_scheduled_at: stringOrNull(data.cancel_scheduled_at) ?? undefined,
    cancel_pending: Boolean(data.cancel_pending ?? false),
    plan_change_scheduled_to: stringOrNull(data.plan_change_scheduled_to) ?? undefined,
    plan_change_scheduled_at: stringOrNull(data.plan_change_scheduled_at) ?? undefined,
    plan_change_scheduled_currency: stringOrNull(data.plan_change_scheduled_currency) ?? undefined,
    usage_today: toRecord(data.usage_today),
    available_plans: toRecord(data.available_plans),
    raw: { ...data },
  };
}

function parsePlanCheckoutSession(data: Record<string, unknown>): PlanCheckoutSession {
  return {
    checkout_url: stringOrNull(data.checkout_url) ?? undefined,
    expires_at_iso: stringOrNull(data.expires_at_iso ?? data.expires_at) ?? undefined,
    plan: stringOrNull(data.plan) ?? undefined,
    currency: stringOrNull(data.currency) ?? undefined,
    customer_id: stringOrNull(data.customer_id) ?? undefined,
    raw: { ...data },
  };
}

function parseBillingPortalLink(data: Record<string, unknown>): BillingPortalLink {
  return {
    portal_url: stringOrNull(data.portal_url) ?? undefined,
    expires_at_iso: stringOrNull(data.expires_at_iso ?? data.expires_at) ?? undefined,
    raw: { ...data },
  };
}

function parseAccountPlanCancellation(data: Record<string, unknown>): AccountPlanCancellation {
  return {
    cancelled: Boolean(data.cancelled ?? false),
    effective_at: stringOrNull(data.effective_at) ?? undefined,
    cancel_scheduled_at: stringOrNull(data.cancel_scheduled_at) ?? undefined,
    plan: stringOrNull(data.plan) ?? undefined,
    subscription_id: stringOrNull(data.subscription_id) ?? undefined,
    rail: stringOrNull(data.rail) ?? undefined,
    raw: { ...data },
  };
}

function parsePlanWeb3Mandate(data: Record<string, unknown>): PlanWeb3Mandate {
  return {
    mandate_id: String(data.mandate_id ?? data.payment_mandate_id ?? ""),
    payment_mandate_id: stringOrNull(data.payment_mandate_id) ?? undefined,
    principal_user_id: stringOrNull(data.principal_user_id) ?? undefined,
    user_wallet_id: stringOrNull(data.user_wallet_id) ?? undefined,
    network: String(data.network ?? "polygon"),
    payee_type: stringOrNull(data.payee_type) ?? undefined,
    payee_ref: stringOrNull(data.payee_ref) ?? undefined,
    fee_recipient_ref: stringOrNull(data.fee_recipient_ref) ?? undefined,
    purpose: stringOrNull(data.purpose) ?? undefined,
    cadence: stringOrNull(data.cadence) ?? undefined,
    token_symbol: stringOrNull(data.token_symbol) ?? undefined,
    display_currency: stringOrNull(data.display_currency) ?? undefined,
    max_amount_minor: Math.trunc(Number(data.max_amount_minor ?? 0)),
    status: String(data.status ?? "active"),
    retry_count: Math.trunc(Number(data.retry_count ?? 0)),
    idempotency_key: stringOrNull(data.idempotency_key) ?? undefined,
    last_attempt_at: stringOrNull(data.last_attempt_at) ?? undefined,
    next_attempt_at: stringOrNull(data.next_attempt_at) ?? undefined,
    canceled_at: stringOrNull(data.canceled_at) ?? undefined,
    metadata: toRecord(data.metadata_jsonb ?? data.metadata),
    transaction_request: isRecord(data.transaction_request) ? { ...data.transaction_request } : null,
    approve_transaction_request: isRecord(data.approve_transaction_request) ? { ...data.approve_transaction_request } : null,
    cancel_transaction_request: isRecord(data.cancel_transaction_request) ? { ...data.cancel_transaction_request } : null,
    chain_receipt: isRecord(data.chain_receipt) ? parse_settlement_receipt(data.chain_receipt) : null,
    raw: { ...data },
  };
}

function parseAccountFeedbackSubmission(data: Record<string, unknown>): AccountFeedbackSubmission {
  return {
    accepted: Boolean(data.accepted ?? false),
    raw: { ...data },
  };
}

function parseOperationExecution(
  data: Record<string, unknown>,
  operation_key: string,
  meta: EnvelopeMeta,
): OperationExecution {
  const action_payload = isRecord(data.action) ? toRecord(data.action) : {};
  const action = isRecord(data.action)
    ? String(data.action.operation ?? data.action.type ?? operation_key.replaceAll(".", "_"))
    : String(data.action ?? operation_key.replaceAll(".", "_"));
  return {
    agent_id: String(data.agent_id ?? ""),
    operation_key,
    message: String(data.message ?? ""),
    action,
    result: toRecord(data.result),
    status: String(data.status ?? "completed"),
    // Use logical OR (not nullish coalescing) so that an explicit
    // `approval_required: false` from the server still gets upgraded to
    // true when `status === "approval_required"`. This matches the
    // Python client's `bool(data.get("approval_required") or status ==
    // "approval_required")` behavior and prevents partially-rolled-out
    // or defaulted server payloads from silently skipping owner approval.
    approval_required: Boolean(
      data.approval_required || String(data.status ?? "").trim().toLowerCase() === "approval_required",
    ),
    intent_id: stringOrNull(data.intent_id) ?? undefined,
    approval_status: stringOrNull(data.approval_status) ?? undefined,
    approval_snapshot_hash: stringOrNull(data.approval_snapshot_hash) ?? undefined,
    action_payload,
    safety: toRecord(data.safety),
    trace_id: meta.trace_id ?? null,
    request_id: meta.request_id ?? null,
    raw: { ...data },
  };
}

export class SiglumeClient implements SiglumeClientShape {
  readonly api_key: string;
  readonly agent_key?: string;
  readonly base_url: string;
  readonly timeout_ms: number;
  readonly max_retries: number;
  private readonly fetchImpl: FetchLike;
  private readonly pendingConfirmations = new Map<string, PendingConfirmation>();

  constructor(options: SiglumeClientOptions = {}) {
    const envApiKey = typeof process !== "undefined" ? process.env?.SIGLUME_API_KEY : undefined;
    const resolvedApiKey = (options.api_key ?? envApiKey ?? "").trim();
    if (!resolvedApiKey) {
      throw new SiglumeClientError(
        "SIGLUME_API_KEY is required. Pass it as the api_key option or set the SIGLUME_API_KEY env var.",
      );
    }
    this.api_key = resolvedApiKey;
    this.agent_key = options.agent_key?.trim() || undefined;
    this.base_url = (options.base_url ?? DEFAULT_SIGLUME_API_BASE).replace(/\/+$/, "");
    this.timeout_ms = Math.max(1, options.timeout_ms ?? 15_000);
    this.max_retries = Math.max(1, Math.trunc(options.max_retries ?? 3));
    this.fetchImpl = options.fetch ?? fetch;
  }

  close(): void {}

  async auto_register(
    manifest: AppManifest | Record<string, unknown>,
    tool_manual: ToolManual | Record<string, unknown>,
    options: {
      source_code?: string;
      source_url?: string;
      runtime_validation?: Record<string, unknown>;
      source_context?: Record<string, unknown>;
      input_form_spec?: Record<string, unknown>;
    } = {},
  ): Promise<AutoRegistrationReceipt> {
    const manifestPayload = coerceMapping(manifest, "manifest");
    const toolManualPayload = coerceMapping(tool_manual, "tool_manual");
    const toolManualForRequest = { ...toolManualPayload };
    const embeddedInputFormSpec = toolManualForRequest.input_form_spec;
    delete toolManualForRequest.input_form_spec;
    const inputFormSpec = options.input_form_spec ?? embeddedInputFormSpec;
    const payload: Record<string, unknown> = {
      manifest: { ...manifestPayload },
      tool_manual: toolManualForRequest,
    };
    if (options.source_url) {
      payload.source_url = options.source_url;
    } else if (options.source_code !== undefined) {
      payload.source_code = options.source_code;
    } else {
      payload.source_code = buildRegistrationStubSource(manifestPayload, toolManualPayload);
    }
    if (options.runtime_validation) {
      payload.runtime_validation = coerceMapping(options.runtime_validation, "runtime_validation");
    }
    if (options.source_context) {
      payload.source_context = coerceMapping(options.source_context, "source_context");
    }
    if (inputFormSpec !== undefined && inputFormSpec !== null) {
      payload.input_form_spec = coerceMapping(inputFormSpec, "input_form_spec");
    }
    // Manifest fields forwarded to the top-level auto-register payload.
    // `version` is intentionally NOT forwarded — the platform auto-assigns
    // `release_semver` and rejects submissions that declare a version.
    // `description` (long-form sales copy), `permission_scopes`, and
    // `compatibility_tags` are forwarded so the seller's buyer-facing
    // description, OAuth scope declarations, and discovery tags actually
    // survive the auto-register pipeline.
    for (const fieldName of [
      "capability_key",
      "name",
      "job_to_be_done",
      "short_description",
      "description",
      "category",
      "docs_url",
      "documentation_url",
      "support_contact",
      "seller_homepage_url",
      "seller_social_url",
      "store_vertical",
      "jurisdiction",
      "price_model",
      "price_value_minor",
      "pricing_plan",
      "billing_timing",
      "currency",
      "allow_free_trial",
      "free_trial_duration_days",
      "permission_class",
      "approval_mode",
      "dry_run_supported",
      "required_connected_accounts",
      "permission_scopes",
      "compatibility_tags",
      "persistence",
    ]) {
      const value = manifestPayload[fieldName];
      if (value !== undefined && value !== null) {
        payload[fieldName] = value;
      }
    }
    if (
      payload.pricing_plan !== undefined &&
      (typeof payload.pricing_plan !== "object" || Array.isArray(payload.pricing_plan))
    ) {
      throw new SiglumeClientError("AppManifest.pricing_plan must be an object when provided.");
    }
    if (payload.billing_timing !== undefined && payload.billing_timing !== null) {
      const billingTiming = String(payload.billing_timing || "post").trim().toLowerCase();
      if (billingTiming !== "post" && billingTiming !== "prepay") {
        throw new SiglumeClientError("AppManifest.billing_timing must be 'post' or 'prepay'.");
      }
      payload.billing_timing = billingTiming;
    }
    if (payload.store_vertical === undefined || payload.store_vertical === null) {
      throw new SiglumeClientError(
        "AppManifest.store_vertical is required. Choose 'api' for normal API Store listings or 'game' for API games.",
      );
    }
    const currency = String(payload.currency ?? "").trim().toUpperCase();
    if (!currency) {
      throw new SiglumeClientError(
        "AppManifest.currency is required. Choose 'USD' for USDC settlement or 'JPY' for JPYC settlement.",
      );
    }
    if (currency !== "USD" && currency !== "JPY") {
      throw new SiglumeClientError(`AppManifest.currency must be 'USD' or 'JPY'. Got ${String(payload.currency)}.`);
    }
    payload.currency = currency;
    if (payload.pricing_plan !== undefined) {
      validatePricingPlanFloor(payload.pricing_plan, currency);
    }
    validateListingTextLengths(payload);
    const priceModel = String(payload.price_model ?? "free").trim().toLowerCase();
    if ((priceModel === "usage_based" || priceModel === "per_action") && !pricingPlanHasItems(payload.pricing_plan)) {
      throw new SiglumeClientError("AppManifest.pricing_plan.items is required for usage_based/per_action pricing.");
    }
    if (payload.allow_free_trial === undefined || payload.allow_free_trial === null) {
      throw new SiglumeClientError(
        "AppManifest.allow_free_trial is required. Pass true to offer a Plus/Pro buyer free trial or false to disable trials.",
      );
    }
    if (Boolean(payload.allow_free_trial)) {
      const duration = payload.free_trial_duration_days ?? 30;
      if (typeof duration !== "number" || !Number.isInteger(duration)) {
        throw new SiglumeClientError(
          "AppManifest.free_trial_duration_days must be an integer when allow_free_trial=true.",
        );
      }
      if (duration < 1 || duration > 90) {
        throw new SiglumeClientError(
          `AppManifest.free_trial_duration_days must be between 1 and 90 when allow_free_trial=true, got: ${duration}.`,
        );
      }
    }
    validateManifestPersistenceContract(payload);
    // Strip `version` from the embedded manifest sub-dict too so the
    // platform's reject-on-manifest-version check cannot trip on the SDK's
    // local-tracking default. The SDK's AppManifest.version is local-only
    // and must not reach the server.
    if (payload.manifest && typeof payload.manifest === "object") {
      delete (payload.manifest as Record<string, unknown>).version;
    }
    const docsUrl = String(manifestPayload.docs_url ?? manifestPayload.documentation_url ?? "").trim();
    const supportContact = String(manifestPayload.support_contact ?? "").trim();
    const sellerHomepageUrl = String(manifestPayload.seller_homepage_url ?? "").trim();
    const sellerSocialUrl = String(manifestPayload.seller_social_url ?? "").trim();
    if (docsUrl || supportContact || sellerHomepageUrl || sellerSocialUrl) {
      const publisherIdentity = {
        documentation_url: docsUrl || null,
        support_contact: supportContact || null,
        seller_homepage_url: sellerHomepageUrl || null,
        seller_social_url: sellerSocialUrl || null,
      };
      payload.publisher_identity = publisherIdentity;
      payload.legal = { publisher_identity: publisherIdentity };
    }
    const [data, meta] = await this.request("POST", "/market/capabilities/auto-register", { json_body: payload });
    const listing_id = String(data.listing_id ?? "");
    if (!listing_id) {
      throw new SiglumeClientError("Siglume auto-register response did not include listing_id.");
    }
    this.pendingConfirmations.set(listing_id, {
      manifest: manifestPayload,
      tool_manual: toRecord(payload.tool_manual),
      input_form_spec: toRecord(payload.input_form_spec),
    });
    return {
      listing_id,
      status: String(data.status ?? "draft"),
      registration_mode: stringOrNull(data.registration_mode),
      listing_status: stringOrNull(data.listing_status),
      auto_manifest: toRecord(data.auto_manifest),
      confidence: toRecord(data.confidence),
      validation_report: toRecord(data.validation_report),
      review_url: stringOrNull(data.review_url),
      trace_id: meta.trace_id,
      request_id: meta.request_id,
    };
  }

  async confirm_registration(
    listing_id: string,
    options: {
      manifest?: AppManifest | Record<string, unknown>;
      tool_manual?: ToolManual | Record<string, unknown>;
      version_bump?: "patch" | "minor" | "major";
      visibility?: "public" | "private";
    } = {},
  ): Promise<RegistrationConfirmation> {
    // Registration content is immutable after auto-register. Keep the
    // historical options source-compatible, but do not send them as
    // post-draft overrides. `version_bump` (optional) opts into a
    // minor/major semver bump on the newly-created CapabilityRelease;
    // platform defaults to "patch" when omitted.
    const { version_bump: versionBump, visibility = "public" } = options;
    const payload: Record<string, unknown> = { approved: true };
    if (visibility !== "public" && visibility !== "private") {
      throw new Error(`visibility must be one of ["public","private"], got ${JSON.stringify(visibility)}`);
    }
    payload.visibility = visibility;
    if (versionBump !== undefined) {
      const allowed = ["patch", "minor", "major"] as const;
      if (!(allowed as readonly string[]).includes(versionBump)) {
        throw new Error(
          `version_bump must be one of ${JSON.stringify(allowed)}, got ${JSON.stringify(versionBump)}`,
        );
      }
      payload.version_bump = versionBump;
    }
    const [data, meta] = await this.request("POST", `/market/capabilities/${listing_id}/confirm-auto-register`, { json_body: payload });
    this.pendingConfirmations.delete(listing_id);
    const checklist = isRecord(data.checklist)
      ? Object.fromEntries(
          Object.entries(data.checklist).map(([key, value]) => [key, Boolean(value)]),
        )
      : {};
    return {
      listing_id: String(data.listing_id ?? listing_id),
      status: String(data.status ?? ""),
      visibility: stringOrNull(data.visibility),
      message: stringOrNull(data.message),
      checklist,
      release: toRecord(data.release),
      quality: parseRegistrationQuality(toRecord(data.quality)),
      trace_id: meta.trace_id,
      request_id: meta.request_id,
      raw: { ...data },
    };
  }

  async submit_review(listing_id: string): Promise<AppListingRecord> {
    const [data] = await this.request("POST", `/market/capabilities/${listing_id}/submit-review`);
    return parseListing(data);
  }

  async preview_quality_score(tool_manual: ToolManual | Record<string, unknown>): Promise<ToolManualQualityReport> {
    const toolManualPayload = coerceMapping(tool_manual, "tool_manual");
    const [data] = await this.request("POST", "/market/tool-manuals/preview-quality", {
      json_body: { tool_manual: toolManualPayload },
    });
    return buildToolManualQualityReport(data);
  }

  async list_capabilities(options: {
    mine?: boolean;
    status?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<CursorPageResult<AppListingRecord>> {
    const params = {
      mine: options.mine,
      status: options.status,
      limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 20), 100)),
      cursor: options.cursor,
    };
    const [data, meta] = await this.request("GET", "/market/capabilities", { params });
    const items = Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map(parseListing)
      : [];
    const next_cursor = stringOrNull(data.next_cursor);
    return new CursorPageResult({
      items,
      next_cursor,
      limit: typeof data.limit === "number" ? data.limit : params.limit,
      offset: typeof data.offset === "number" ? data.offset : null,
      meta,
      fetchNext: next_cursor
        ? (cursor) => this.list_capabilities({ ...options, cursor })
        : undefined,
    });
  }

  async list_my_listings(options: { status?: string; limit?: number; cursor?: string } = {}) {
    return this.list_capabilities({ ...options, mine: true });
  }

  async get_listing(listing_id: string): Promise<AppListingRecord> {
    const [data] = await this.request("GET", `/market/capabilities/${listing_id}`);
    return parseListing(data);
  }

  async get_capability_state(
    capability_key: string,
    save_key = "default",
  ): Promise<CapabilitySaveStateRecord> {
    const [data] = await this.request("GET", `/market/capability-state/${capability_key}/${save_key}`);
    return parseCapabilitySaveState(data);
  }

  async put_capability_state(
    capability_key: string,
    save_key = "default",
    payload: Record<string, unknown> = {},
    options: { schema_version?: string; expected_revision?: number | null; metadata?: Record<string, unknown> } = {},
  ): Promise<CapabilitySaveStateRecord> {
    const body: Record<string, unknown> = {
      payload: toRecord(payload),
      schema_version: options.schema_version ?? "1",
      metadata: toRecord(options.metadata),
    };
    if (options.expected_revision !== undefined && options.expected_revision !== null) {
      body.expected_revision = Math.trunc(options.expected_revision);
    }
    const [data] = await this.request("PUT", `/market/capability-state/${capability_key}/${save_key}`, { json_body: body });
    return parseCapabilitySaveState(data);
  }

  async delete_capability_state(
    capability_key: string,
    save_key = "default",
  ): Promise<CapabilitySaveStateRecord> {
    const [data] = await this.request("DELETE", `/market/capability-state/${capability_key}/${save_key}`);
    return parseCapabilitySaveState(data);
  }

  // ----- Connected accounts ------------------------------------------------
  // Architecture B: publisher APIs own external OAuth and token storage.
  // The SDK no longer exposes platform OAuth or listing credential APIs.

  async get_developer_portal(): Promise<DeveloperPortalSummary> {
    const [data, meta] = await this.request("GET", "/market/developer/portal");
    return {
      seller_onboarding: Object.keys(toRecord(data.seller_onboarding)).length > 0 ? toRecord(data.seller_onboarding) : null,
      platform: toRecord(data.platform),
      monetization: toRecord(data.monetization),
      payout_readiness: toRecord(data.payout_readiness),
      listings: toRecord(data.listings),
      usage: toRecord(data.usage),
      support: toRecord(data.support),
      apps: Array.isArray(data.apps) ? data.apps.filter((item): item is Record<string, unknown> => isRecord(item)).map(parseListing) : [],
      trace_id: meta.trace_id,
      request_id: meta.request_id,
      raw: { ...data },
    };
  }

  async create_sandbox_session(options: { agent_id: string; capability_key: string }): Promise<SandboxSession> {
    const [data, meta] = await this.request("POST", "/market/sandbox/sessions", {
      json_body: {
        agent_id: options.agent_id,
        capability_key: options.capability_key,
      },
    });
    return {
      session_id: String(data.session_id ?? ""),
      agent_id: String(data.agent_id ?? ""),
      capability_key: String(data.capability_key ?? ""),
      environment: String(data.environment ?? "sandbox"),
      sandbox_support: stringOrNull(data.sandbox_support),
      dry_run_supported: Boolean(data.dry_run_supported ?? false),
      approval_mode: stringOrNull(data.approval_mode),
      required_connected_accounts: Array.isArray(data.required_connected_accounts) ? data.required_connected_accounts : [],
      stub_providers_enabled: Boolean(data.stub_providers_enabled ?? false),
      simulated_receipts: Boolean(data.simulated_receipts ?? false),
      approval_simulator: Boolean(data.approval_simulator ?? false),
      trace_id: meta.trace_id,
      request_id: meta.request_id,
      raw: { ...data },
    };
  }

  async get_usage(options: {
    capability_key?: string;
    agent_id?: string;
    outcome?: string;
    environment?: string;
    period_key?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<CursorPageResult<UsageEventRecord>> {
    const params = {
      capability_key: options.capability_key,
      agent_id: options.agent_id,
      outcome: options.outcome,
      environment: options.environment,
      period_key: options.period_key,
      limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 50), 100)),
      cursor: options.cursor,
    };
    const [data, meta] = await this.request("GET", "/market/usage", { params });
    const items = Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map(parseUsageEvent)
      : [];
    const next_cursor = stringOrNull(data.next_cursor);
    return new CursorPageResult({
      items,
      next_cursor,
      limit: typeof data.limit === "number" ? data.limit : params.limit,
      offset: typeof data.offset === "number" ? data.offset : null,
      meta,
      fetchNext: next_cursor
        ? (cursor) => this.get_usage({ ...options, cursor })
        : undefined,
    });
  }

  async list_agents(options: { query?: string; limit?: number } = {}): Promise<AgentRecord[]> {
    const normalizedQuery = String(options.query ?? "").trim();
    if (normalizedQuery) {
      const targetLimit = Math.max(1, Math.min(Math.trunc(options.limit ?? 20), 20));
      const agents: AgentRecord[] = [];
      let cursor: string | null = null;
      const seenCursors = new Set<string>();
      while (agents.length < targetLimit) {
        const [data] = await this.request("GET", "/search/agents", {
          params: {
            query: normalizedQuery,
            cursor,
            limit: Math.max(1, Math.min(targetLimit - agents.length, 20)),
          },
        });
        const pageItems = Array.isArray(data.items)
          ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map(parseAgent)
          : [];
        agents.push(...pageItems);
        cursor = stringOrNull(data.next_cursor);
        if (!cursor || seenCursors.has(cursor)) {
          break;
        }
        seenCursors.add(cursor);
      }
      return agents.slice(0, targetLimit);
    }
    const [data] = await this.request("GET", "/me/agent");
    return [parseAgent(data)];
  }

  async list_operations(options: { agent_id?: string; lang?: string } = {}): Promise<OperationMetadata[]> {
    let resolvedAgentId = String(options.agent_id ?? "").trim();
    if (!resolvedAgentId) {
      const agents = await this.list_agents();
      if (agents.length === 0) {
        return fallbackOperationCatalog();
      }
      resolvedAgentId = agents[0]!.agent_id;
    }
    try {
      const [data] = await this.request("GET", `/owner/agents/${resolvedAgentId}/operations`, {
        params: {
          lang: String(options.lang ?? "en").trim().toLowerCase() === "ja" ? "ja" : "en",
        },
      });
      const items = Array.isArray(data.items)
        ? data.items.filter((item): item is Record<string, unknown> => isRecord(item))
        : [];
      if (items.length === 0) {
        return fallbackOperationCatalog(resolvedAgentId);
      }
      return items.map((item) => buildOperationMetadata(item, { agent_id: resolvedAgentId, source: "live" }));
    } catch {
      return fallbackOperationCatalog(resolvedAgentId);
    }
  }

  async get_operation_metadata(
    operation_key: string,
    options: { agent_id?: string; lang?: string } = {},
  ): Promise<OperationMetadata> {
    const normalizedKey = String(operation_key ?? "").trim();
    if (!normalizedKey) {
      throw new SiglumeClientError("operation_key is required.");
    }
    const operations = await this.list_operations(options);
    const match = operations.find((item) => item.operation_key === normalizedKey);
    if (!match) {
      throw new SiglumeNotFoundError(`Operation not found: ${normalizedKey}`);
    }
    return match;
  }

  async get_account_preferences(): Promise<AccountPreferences> {
    const [data] = await this.request("GET", "/me/preferences");
    return parseAccountPreferences(data);
  }

  async update_account_preferences(options: {
    language?: string;
    summary_depth?: string;
    notification_mode?: string;
    autonomy_level?: string;
    interest_profile?: Record<string, unknown>;
    consent_policy?: Record<string, unknown>;
  }): Promise<AccountPreferences> {
    const payload: Record<string, unknown> = {};
    if (options.language !== undefined) {
      payload.language = String(options.language).trim();
    }
    if (options.summary_depth !== undefined) {
      payload.summary_depth = String(options.summary_depth).trim();
    }
    if (options.notification_mode !== undefined) {
      payload.notification_mode = String(options.notification_mode).trim();
    }
    if (options.autonomy_level !== undefined) {
      payload.autonomy_level = String(options.autonomy_level).trim();
    }
    if (options.interest_profile !== undefined) {
      payload.interest_profile = toRecord(options.interest_profile);
    }
    if (options.consent_policy !== undefined) {
      payload.consent_policy = toRecord(options.consent_policy);
    }
    if (Object.keys(payload).length === 0) {
      throw new SiglumeClientError("update_account_preferences requires at least one preference field.");
    }
    const [data] = await this.request("PUT", "/me/preferences", { json_body: payload });
    return parseAccountPreferences(data);
  }

  async get_account_plan(): Promise<AccountPlan> {
    const [data] = await this.request("GET", "/me/plan");
    return parseAccountPlan(data);
  }

  async start_plan_checkout(options: { target_tier: string; currency?: string }): Promise<PlanCheckoutSession> {
    const target_tier = String(options.target_tier ?? "").trim().toLowerCase();
    if (!target_tier) {
      throw new SiglumeClientError("target_tier is required.");
    }
    const [data] = await this.request("POST", "/me/plan/checkout", {
      params: {
        plan: target_tier,
        currency: options.currency ? String(options.currency).trim().toLowerCase() : undefined,
      },
    });
    return parsePlanCheckoutSession(data);
  }

  async open_plan_billing_portal(): Promise<BillingPortalLink> {
    const [data] = await this.request("GET", "/me/plan/billing-portal");
    return parseBillingPortalLink(data);
  }

  async cancel_account_plan(): Promise<AccountPlanCancellation> {
    const [data] = await this.request("POST", "/me/plan/cancel");
    return parseAccountPlanCancellation(data);
  }

  async create_plan_web3_mandate(options: {
    target_tier: string;
    currency?: string;
  }): Promise<PlanWeb3Mandate> {
    const target_tier = String(options.target_tier ?? "").trim().toLowerCase();
    if (!target_tier) {
      throw new SiglumeClientError("target_tier is required.");
    }
    const [data] = await this.request("POST", "/me/plan/web3-mandate", {
      params: {
        plan: target_tier,
        currency: options.currency ? String(options.currency).trim().toLowerCase() : undefined,
      },
    });
    return parsePlanWeb3Mandate(data);
  }

  async cancel_plan_web3_mandate(): Promise<PlanWeb3Mandate> {
    const [data] = await this.request("POST", "/me/plan/web3-cancel");
    return parsePlanWeb3Mandate(data);
  }

  async submit_account_feedback(
    ref_type: string,
    ref_id: string,
    feedback_type: string,
    options: { reason?: string } = {},
  ): Promise<AccountFeedbackSubmission> {
    const normalizedRefType = String(ref_type ?? "").trim();
    const normalizedRefId = String(ref_id ?? "").trim();
    const normalizedFeedbackType = String(feedback_type ?? "").trim();
    if (!normalizedRefType) throw new SiglumeClientError("ref_type is required.");
    if (!normalizedRefId) throw new SiglumeClientError("ref_id is required.");
    if (!normalizedFeedbackType) throw new SiglumeClientError("feedback_type is required.");
    const payload: Record<string, unknown> = {
      ref_type: normalizedRefType,
      ref_id: normalizedRefId,
      feedback_type: normalizedFeedbackType,
    };
    if (options.reason !== undefined && String(options.reason).trim()) {
      payload.reason = String(options.reason).trim();
    }
    const [data] = await this.request("POST", "/feedback", { json_body: payload });
    return parseAccountFeedbackSubmission(data);
  }

  async get_agent(
    agent_id: string,
  ): Promise<AgentRecord> {
    const normalizedAgentId = String(agent_id ?? "").trim();
    if (!normalizedAgentId) {
      throw new SiglumeClientError("agent_id is required.");
    }
    const [data] = await this.request("GET", `/agents/${normalizedAgentId}/profile`);
    return parseAgent(data);
  }

  async execute_owner_operation(
    agent_id: string,
    operation_key: string,
    params: Record<string, unknown> = {},
    options: { lang?: string } = {},
  ): Promise<OperationExecution> {
    const normalizedKey = String(operation_key ?? "").trim();
    const [data, meta] = await this.requestOwnerOperation(agent_id, operation_key, params, options);
    return parseOperationExecution(data, normalizedKey, meta);
  }

  async list_installed_tools(
    options: {
      agent_id?: string;
      lang?: string;
    } = {},
  ): Promise<InstalledToolRecord[]> {
    const resolvedAgentId = await this.resolveOwnerOperationAgentId(options.agent_id);
    const [data] = await this.requestOwnerOperation(
      resolvedAgentId,
      "installed_tools.list",
      {},
      { lang: options.lang },
    );
    return Array.isArray(data.result)
      ? data.result.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseInstalledTool(item))
      : [];
  }

  async get_installed_tools_connection_readiness(
    options: {
      agent_id?: string;
      lang?: string;
    } = {},
  ): Promise<InstalledToolConnectionReadiness> {
    const [data] = await this.requestOwnerOperation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "installed_tools.connection_readiness",
      {},
      { lang: options.lang },
    );
    return parseInstalledToolConnectionReadiness(isRecord(data.result) ? data.result : {});
  }

  async update_installed_tool_binding_policy(
    binding_id: string,
    options: {
      agent_id?: string;
      permission_class?: string;
      max_calls_per_day?: number;
      monthly_usage_cap?: number;
      max_spend_per_execution?: number;
      allowed_tasks_jsonb?: string[];
      allowed_source_types_jsonb?: string[];
      timeout_ms?: number;
      cooldown_seconds?: number;
      require_owner_approval?: boolean;
      require_owner_approval_over_cost?: number;
      dry_run_only?: boolean;
      retry_policy_jsonb?: Record<string, unknown>;
      fallback_mode?: string;
      auto_execute_read_only?: boolean;
      allow_background_execution?: boolean;
      max_calls_per_hour?: number;
      max_chain_steps?: number;
      max_parallel_executions?: number;
      max_spend_usd_cents_per_day?: number;
      approval_mode?: string;
      kill_switch_state?: string;
      allowed_connected_account_ids_jsonb?: string[];
      metadata_jsonb?: Record<string, unknown>;
      lang?: string;
    } = {},
  ): Promise<InstalledToolPolicyUpdateResult> {
    const normalizedBindingId = String(binding_id ?? "").trim();
    if (!normalizedBindingId) {
      throw new SiglumeClientError("binding_id is required.");
    }
    const payload: Record<string, unknown> = { binding_id: normalizedBindingId };
    if (options.permission_class !== undefined && String(options.permission_class).trim()) {
      payload.permission_class = String(options.permission_class).trim();
    }
    if (options.max_calls_per_day !== undefined) {
      payload.max_calls_per_day = Math.trunc(Number(options.max_calls_per_day));
    }
    if (options.monthly_usage_cap !== undefined) {
      payload.monthly_usage_cap = Math.trunc(Number(options.monthly_usage_cap));
    }
    if (options.max_spend_per_execution !== undefined) {
      payload.max_spend_per_execution = Math.trunc(Number(options.max_spend_per_execution));
    }
    if (options.allowed_tasks_jsonb !== undefined) {
      payload.allowed_tasks_jsonb = options.allowed_tasks_jsonb.filter((item) => String(item).trim().length > 0).map((item) => String(item));
    }
    if (options.allowed_source_types_jsonb !== undefined) {
      payload.allowed_source_types_jsonb = options.allowed_source_types_jsonb.filter((item) => String(item).trim().length > 0).map((item) => String(item));
    }
    if (options.timeout_ms !== undefined) {
      payload.timeout_ms = Math.trunc(Number(options.timeout_ms));
    }
    if (options.cooldown_seconds !== undefined) {
      payload.cooldown_seconds = Math.trunc(Number(options.cooldown_seconds));
    }
    if (options.require_owner_approval !== undefined) {
      payload.require_owner_approval = Boolean(options.require_owner_approval);
    }
    if (options.require_owner_approval_over_cost !== undefined) {
      payload.require_owner_approval_over_cost = Math.trunc(Number(options.require_owner_approval_over_cost));
    }
    if (options.dry_run_only !== undefined) {
      payload.dry_run_only = Boolean(options.dry_run_only);
    }
    if (options.retry_policy_jsonb !== undefined) {
      payload.retry_policy_jsonb = toRecord(options.retry_policy_jsonb);
    }
    if (options.fallback_mode !== undefined && String(options.fallback_mode).trim()) {
      payload.fallback_mode = String(options.fallback_mode).trim();
    }
    if (options.auto_execute_read_only !== undefined) {
      payload.auto_execute_read_only = Boolean(options.auto_execute_read_only);
    }
    if (options.allow_background_execution !== undefined) {
      payload.allow_background_execution = Boolean(options.allow_background_execution);
    }
    if (options.max_calls_per_hour !== undefined) {
      payload.max_calls_per_hour = Math.trunc(Number(options.max_calls_per_hour));
    }
    if (options.max_chain_steps !== undefined) {
      payload.max_chain_steps = Math.trunc(Number(options.max_chain_steps));
    }
    if (options.max_parallel_executions !== undefined) {
      payload.max_parallel_executions = Math.trunc(Number(options.max_parallel_executions));
    }
    if (options.max_spend_usd_cents_per_day !== undefined) {
      payload.max_spend_usd_cents_per_day = Math.trunc(Number(options.max_spend_usd_cents_per_day));
    }
    if (options.approval_mode !== undefined && String(options.approval_mode).trim()) {
      payload.approval_mode = String(options.approval_mode).trim();
    }
    if (options.kill_switch_state !== undefined && String(options.kill_switch_state).trim()) {
      payload.kill_switch_state = String(options.kill_switch_state).trim();
    }
    if (options.allowed_connected_account_ids_jsonb !== undefined) {
      payload.allowed_connected_account_ids_jsonb = options.allowed_connected_account_ids_jsonb
        .filter((item) => String(item).trim().length > 0)
        .map((item) => String(item));
    }
    if (options.metadata_jsonb !== undefined) {
      payload.metadata_jsonb = toRecord(options.metadata_jsonb);
    }
    if (Object.keys(payload).length === 1) {
      throw new SiglumeClientError("update_installed_tool_binding_policy requires at least one policy field to update.");
    }
    const [data, meta] = await this.requestOwnerOperation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "installed_tools.binding.update_policy",
      payload,
      { lang: options.lang },
    );
    return parseInstalledToolPolicyUpdateResult(data, "installed_tools.binding.update_policy", meta);
  }

  async get_installed_tool_execution(
    intent_id: string,
    options: { agent_id?: string; lang?: string } = {},
  ): Promise<InstalledToolExecutionRecord> {
    const normalizedIntentId = String(intent_id ?? "").trim();
    if (!normalizedIntentId) {
      throw new SiglumeClientError("intent_id is required.");
    }
    const [data] = await this.requestOwnerOperation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "installed_tools.execution.get",
      { intent_id: normalizedIntentId },
      { lang: options.lang },
    );
    return parseInstalledToolExecution(isRecord(data.result) ? data.result : {});
  }

  async list_installed_tool_receipts(
    options: {
      agent_id?: string;
      receipt_agent_id?: string;
      status?: string;
      limit?: number;
      offset?: number;
      lang?: string;
    } = {},
  ): Promise<InstalledToolReceiptRecord[]> {
    const payload: Record<string, unknown> = {
      limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 20), 100)),
      offset: Math.max(0, Math.trunc(options.offset ?? 0)),
    };
    if (options.receipt_agent_id !== undefined && String(options.receipt_agent_id).trim()) {
      payload.agent_id = String(options.receipt_agent_id).trim();
    }
    if (options.status !== undefined && String(options.status).trim()) {
      payload.status = String(options.status).trim();
    }
    const [data] = await this.requestOwnerOperation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "installed_tools.receipts.list",
      payload,
      { lang: options.lang },
    );
    return Array.isArray(data.result)
      ? data.result.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseInstalledToolReceipt(item))
      : [];
  }

  async get_installed_tool_receipt(
    receipt_id: string,
    options: { agent_id?: string; lang?: string } = {},
  ): Promise<InstalledToolReceiptRecord> {
    const normalizedReceiptId = String(receipt_id ?? "").trim();
    if (!normalizedReceiptId) {
      throw new SiglumeClientError("receipt_id is required.");
    }
    const [data] = await this.requestOwnerOperation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "installed_tools.receipts.get",
      { receipt_id: normalizedReceiptId },
      { lang: options.lang },
    );
    return parseInstalledToolReceipt(isRecord(data.result) ? data.result : {});
  }

  async get_installed_tool_receipt_steps(
    receipt_id: string,
    options: { agent_id?: string; lang?: string } = {},
  ): Promise<InstalledToolReceiptStepRecord[]> {
    const normalizedReceiptId = String(receipt_id ?? "").trim();
    if (!normalizedReceiptId) {
      throw new SiglumeClientError("receipt_id is required.");
    }
    const [data] = await this.requestOwnerOperation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "installed_tools.receipts.steps.get",
      { receipt_id: normalizedReceiptId },
      { lang: options.lang },
    );
    return Array.isArray(data.result)
      ? data.result.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseInstalledToolReceiptStep(item))
      : [];
  }

  async update_agent_charter(
    agent_id: string,
    charter_text: string,
    options: {
      role?: string;
      target_profile?: Record<string, unknown>;
      qualification_criteria?: Record<string, unknown>;
      success_metrics?: Record<string, unknown>;
      constraints?: Record<string, unknown>;
      wait_for_completion?: boolean;
    } = {},
  ): Promise<AgentCharter> {
    const normalizedAgentId = String(agent_id ?? "").trim();
    const normalizedCharterText = String(charter_text ?? "").trim();
    if (!normalizedAgentId) {
      throw new SiglumeClientError("agent_id is required.");
    }
    if (!normalizedCharterText) {
      throw new SiglumeClientError("charter_text is required.");
    }
    void options.wait_for_completion;
    const payload: Record<string, unknown> = {
      goals: { charter_text: normalizedCharterText },
    };
    if (options.role) {
      payload.role = String(options.role).trim().toLowerCase();
    }
    if (options.target_profile) {
      payload.target_profile = toRecord(options.target_profile);
    }
    if (options.qualification_criteria) {
      payload.qualification_criteria = toRecord(options.qualification_criteria);
    }
    if (options.success_metrics) {
      payload.success_metrics = toRecord(options.success_metrics);
    }
    if (options.constraints) {
      payload.constraints = toRecord(options.constraints);
    }
    const [data] = await this.request("PUT", `/owner/agents/${normalizedAgentId}/charter`, {
      json_body: payload,
    });
    return parseAgentCharter(data);
  }

  async update_approval_policy(
    agent_id: string,
    policy: Record<string, unknown>,
    options: { wait_for_completion?: boolean } = {},
  ): Promise<ApprovalPolicy> {
    const normalizedAgentId = String(agent_id ?? "").trim();
    if (!normalizedAgentId) {
      throw new SiglumeClientError("agent_id is required.");
    }
    const policyPayload = toRecord(policy);
    const allowedFields = [
      "auto_approve_below",
      "always_require_approval_for",
      "deny_if",
      "approval_ttl_minutes",
      "structured_only",
      "merchant_allowlist",
      "merchant_denylist",
      "category_allowlist",
      "category_denylist",
      "risk_policy",
    ] as const;
    const payload = Object.fromEntries(
      allowedFields
        .filter((field) => policyPayload[field] !== undefined && policyPayload[field] !== null)
        .map((field) => [field, policyPayload[field]]),
    );
    if (Object.keys(payload).length === 0) {
      throw new SiglumeClientError("policy must include at least one supported approval-policy field.");
    }
    void options.wait_for_completion;
    const [data] = await this.request("PUT", `/owner/agents/${normalizedAgentId}/approval-policy`, {
      json_body: payload,
    });
    return parseApprovalPolicy(data);
  }

  async update_budget_policy(
    agent_id: string,
    policy: Record<string, unknown>,
    options: { wait_for_completion?: boolean } = {},
  ): Promise<BudgetPolicy> {
    const normalizedAgentId = String(agent_id ?? "").trim();
    if (!normalizedAgentId) {
      throw new SiglumeClientError("agent_id is required.");
    }
    const policyPayload = toRecord(policy);
    const allowedFields = [
      "currency",
      "period_start",
      "period_end",
      "period_limit_minor",
      "per_order_limit_minor",
      "auto_approve_below_minor",
      "limits",
      "metadata",
    ] as const;
    const nullableFields = new Set<string>(["period_start", "period_end"]);
    const payload: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (!Object.prototype.hasOwnProperty.call(policyPayload, field)) {
        continue;
      }
      const value = policyPayload[field];
      if (value === undefined) {
        continue;
      }
      if (value === null && !nullableFields.has(field)) {
        continue;
      }
      payload[field] = value;
    }
    if (Object.keys(payload).length === 0) {
      throw new SiglumeClientError("policy must include at least one supported budget-policy field.");
    }
    void options.wait_for_completion;
    const [data] = await this.request("PUT", `/owner/agents/${normalizedAgentId}/budget`, {
      json_body: payload,
    });
    return parseBudgetPolicy(data);
  }

  async list_access_grants(options: {
    status?: string;
    agent_id?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<CursorPageResult<AccessGrantRecord>> {
    const params = {
      status: options.status,
      agent_id: options.agent_id,
      limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 20), 100)),
      cursor: options.cursor,
    };
    const [data, meta] = await this.request("GET", "/market/access-grants", { params });
    const items = Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map(parseAccessGrant)
      : [];
    const next_cursor = stringOrNull(data.next_cursor);
    return new CursorPageResult({
      items,
      next_cursor,
      limit: typeof data.limit === "number" ? data.limit : params.limit,
      offset: typeof data.offset === "number" ? data.offset : null,
      meta,
      fetchNext: next_cursor
        ? (cursor) => this.list_access_grants({ ...options, cursor })
        : undefined,
    });
  }

  async bind_agent_to_grant(
    grant_id: string,
    options: { agent_id: string; binding_status?: string },
  ): Promise<GrantBindingResult> {
    const [data, meta] = await this.request("POST", `/market/access-grants/${grant_id}/bind-agent`, {
      json_body: {
        agent_id: options.agent_id,
        binding_status: options.binding_status ?? "active",
      },
    });
    return {
      binding: parseBinding(toRecord(data.binding)),
      access_grant: parseAccessGrant(toRecord(data.access_grant)),
      trace_id: meta.trace_id,
      request_id: meta.request_id,
      raw: { ...data },
    };
  }

  async create_support_case(
    subject: string,
    body: string,
    options: {
      trace_id?: string;
      case_type?: string;
      capability_key?: string;
      agent_id?: string;
      environment?: string;
    } = {},
  ): Promise<SupportCaseRecord> {
    const summary = subject.trim();
    const details = body.trim();
    const composedSummary = details ? `${summary}\n\n${details}` : summary;
    if (!composedSummary) {
      throw new SiglumeClientError("Support case subject or body is required.");
    }
    if (composedSummary.length > 2000) {
      throw new SiglumeClientError("Support case summary/body must fit within the 2000 character API limit.");
    }
    const [data] = await this.request("POST", "/market/support-cases", {
      json_body: {
        case_type: options.case_type ?? "app_execution",
        summary: composedSummary,
        environment: options.environment ?? "live",
        capability_key: options.capability_key,
        agent_id: options.agent_id,
        trace_id: options.trace_id,
      },
    });
    return parseSupportCase(data);
  }

  async list_support_cases(options: {
    capability_key?: string;
    trace_id?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<CursorPageResult<SupportCaseRecord>> {
    const params = {
      capability_key: options.capability_key,
      trace_id: options.trace_id,
      status: options.status,
      limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 50), 100)),
      cursor: options.cursor,
    };
    const [data, meta] = await this.request("GET", "/market/support-cases", { params });
    const items = Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map(parseSupportCase)
      : [];
    const next_cursor = stringOrNull(data.next_cursor);
    return new CursorPageResult({
      items,
      next_cursor,
      limit: typeof data.limit === "number" ? data.limit : params.limit,
      offset: typeof data.offset === "number" ? data.offset : null,
      meta,
      fetchNext: next_cursor
        ? (cursor) => this.list_support_cases({ ...options, cursor })
        : undefined,
    });
  }

  async create_webhook_subscription(options: {
    callback_url: string;
    description?: string;
    event_types: string[];
    metadata?: Record<string, unknown>;
  }): Promise<WebhookSubscriptionRecord> {
    const normalizedEventTypes = options.event_types
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
    if (normalizedEventTypes.length === 0) {
      throw new SiglumeClientError("event_types must contain at least one webhook event type.");
    }
    const payload: Record<string, unknown> = { callback_url: options.callback_url };
    if (options.description) {
      payload.description = options.description;
    }
    payload.event_types = normalizedEventTypes;
    if (options.metadata) {
      payload.metadata = options.metadata;
    }
    const [data] = await this.request("POST", "/market/webhooks/subscriptions", { json_body: payload });
    return parse_webhook_subscription(data);
  }

  async list_webhook_subscriptions(): Promise<WebhookSubscriptionRecord[]> {
    const [data] = await this.requestAny("GET", "/market/webhooks/subscriptions");
    if (!Array.isArray(data)) {
      throw new SiglumeClientError("Expected webhook subscriptions to be returned as an array.");
    }
    return data.filter((item): item is Record<string, unknown> => isRecord(item)).map(parse_webhook_subscription);
  }

  async get_webhook_subscription(subscription_id: string): Promise<WebhookSubscriptionRecord> {
    const [data] = await this.request("GET", `/market/webhooks/subscriptions/${subscription_id}`);
    return parse_webhook_subscription(data);
  }

  async rotate_webhook_subscription_secret(subscription_id: string): Promise<WebhookSubscriptionRecord> {
    const [data] = await this.request("POST", `/market/webhooks/subscriptions/${subscription_id}/rotate-secret`);
    return parse_webhook_subscription(data);
  }

  async pause_webhook_subscription(subscription_id: string): Promise<WebhookSubscriptionRecord> {
    const [data] = await this.request("POST", `/market/webhooks/subscriptions/${subscription_id}/pause`);
    return parse_webhook_subscription(data);
  }

  async resume_webhook_subscription(subscription_id: string): Promise<WebhookSubscriptionRecord> {
    const [data] = await this.request("POST", `/market/webhooks/subscriptions/${subscription_id}/resume`);
    return parse_webhook_subscription(data);
  }

  async list_webhook_deliveries(options: {
    subscription_id?: string;
    event_type?: string;
    status?: string;
    limit?: number;
  } = {}): Promise<WebhookDeliveryRecord[]> {
    const params = {
      subscription_id: options.subscription_id,
      event_type: options.event_type,
      status: options.status,
      limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 20), 100)),
    };
    const [data] = await this.requestAny("GET", "/market/webhooks/deliveries", { params });
    if (!Array.isArray(data)) {
      throw new SiglumeClientError("Expected webhook deliveries to be returned as an array.");
    }
    return data.filter((item): item is Record<string, unknown> => isRecord(item)).map(parse_webhook_delivery);
  }

  async redeliver_webhook_delivery(delivery_id: string): Promise<WebhookDeliveryRecord> {
    const [data] = await this.request("POST", `/market/webhooks/deliveries/${delivery_id}/redeliver`);
    return parse_webhook_delivery(data);
  }

  async send_test_webhook_delivery(options: {
    event_type: string;
    subscription_ids?: string[];
    data?: Record<string, unknown>;
  }): Promise<QueuedWebhookEvent> {
    const payload: Record<string, unknown> = { event_type: options.event_type };
    if (options.subscription_ids) {
      payload.subscription_ids = options.subscription_ids.filter((item) => String(item).trim().length > 0);
    }
    if (options.data) {
      payload.data = options.data;
    }
    const [data] = await this.request("POST", "/market/webhooks/test-deliveries", { json_body: payload });
    return parse_queued_webhook_event(data);
  }

  async list_polygon_mandates(options: {
    status?: string;
    purpose?: string;
    limit?: number;
  } = {}): Promise<PolygonMandate[]> {
    const targetLimit = Math.max(1, Math.trunc(options.limit ?? 50));
    const mandates: PolygonMandate[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    while (mandates.length < targetLimit) {
      const [data] = await this.request("GET", "/market/web3/mandates", {
        params: {
          status: options.status,
          purpose: options.purpose,
          cursor,
          limit: Math.max(1, Math.min(targetLimit - mandates.length, 100)),
        },
      });
      const items = Array.isArray(data.items)
        ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map(parse_polygon_mandate)
        : [];
      mandates.push(...items);
      cursor = stringOrNull(data.next_cursor);
      if (!cursor || seenCursors.has(cursor)) {
        break;
      }
      seenCursors.add(cursor);
    }
    return mandates.slice(0, targetLimit);
  }

  async get_polygon_mandate(
    mandate_id: string,
    options: { status?: string; purpose?: string; limit?: number | null } = {},
  ): Promise<PolygonMandate> {
    const normalizedMandateId = String(mandate_id ?? "").trim();
    if (!normalizedMandateId) {
      throw new SiglumeClientError("mandate_id is required.");
    }
    let remaining = options.limit == null ? null : Math.max(1, Math.trunc(options.limit));
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    while (true) {
      const [data] = await this.request("GET", "/market/web3/mandates", {
        params: {
          status: options.status,
          purpose: options.purpose,
          cursor,
          limit: remaining == null ? 100 : Math.max(1, Math.min(remaining, 100)),
        },
      });
      const items = Array.isArray(data.items)
        ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map(parse_polygon_mandate)
        : [];
      const found = items.find((item) => item.mandate_id === normalizedMandateId);
      if (found) {
        return found;
      }
      if (remaining != null) {
        remaining -= remaining == null ? 0 : Math.max(1, Math.min(remaining, 100));
        if (remaining <= 0) {
          break;
        }
      }
      cursor = stringOrNull(data.next_cursor);
      if (!cursor || seenCursors.has(cursor)) {
        break;
      }
      seenCursors.add(cursor);
    }
    throw new SiglumeNotFoundError(`Polygon mandate not found: ${normalizedMandateId}`);
  }

  async list_settlement_receipts(options: { receipt_kind?: string; limit?: number } = {}): Promise<SettlementReceipt[]> {
    const targetLimit = Math.max(1, Math.trunc(options.limit ?? 50));
    const receipts: SettlementReceipt[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    while (receipts.length < targetLimit) {
      const [data] = await this.request("GET", "/market/web3/receipts", {
        params: {
          receipt_kind: options.receipt_kind,
          cursor,
          limit: Math.max(1, Math.min(targetLimit - receipts.length, 100)),
        },
      });
      const items = Array.isArray(data.items)
        ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map(parse_settlement_receipt)
        : [];
      receipts.push(...items);
      cursor = stringOrNull(data.next_cursor);
      if (!cursor || seenCursors.has(cursor)) {
        break;
      }
      seenCursors.add(cursor);
    }
    return receipts.slice(0, targetLimit);
  }

  async get_settlement_receipt(
    receipt_id: string,
    options: { receipt_kind?: string; limit?: number | null } = {},
  ): Promise<SettlementReceipt> {
    const normalizedReceiptId = String(receipt_id ?? "").trim();
    if (!normalizedReceiptId) {
      throw new SiglumeClientError("receipt_id is required.");
    }
    let remaining = options.limit == null ? null : Math.max(1, Math.trunc(options.limit));
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    while (true) {
      const [data] = await this.request("GET", "/market/web3/receipts", {
        params: {
          receipt_kind: options.receipt_kind,
          cursor,
          limit: remaining == null ? 100 : Math.max(1, Math.min(remaining, 100)),
        },
      });
      const items = Array.isArray(data.items)
        ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map(parse_settlement_receipt)
        : [];
      const found = items.find((item) => item.receipt_id === normalizedReceiptId || item.chain_receipt_id === normalizedReceiptId);
      if (found) {
        return found;
      }
      if (remaining != null) {
        remaining -= remaining == null ? 0 : Math.max(1, Math.min(remaining, 100));
        if (remaining <= 0) {
          break;
        }
      }
      cursor = stringOrNull(data.next_cursor);
      if (!cursor || seenCursors.has(cursor)) {
        break;
      }
      seenCursors.add(cursor);
    }
    throw new SiglumeNotFoundError(`Settlement receipt not found: ${normalizedReceiptId}`);
  }

  async get_embedded_wallet_charge(options: { tx_hash: string; limit?: number | null }): Promise<EmbeddedWalletCharge> {
    const normalizedTxHash = String(options.tx_hash ?? "").trim();
    if (!normalizedTxHash) {
      throw new SiglumeClientError("tx_hash is required.");
    }
    const lookupHash = normalizedTxHash.toLowerCase();
    let remaining = options.limit == null ? null : Math.max(1, Math.trunc(options.limit));
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    while (true) {
      const [data] = await this.request("GET", "/market/web3/receipts", {
        params: {
          cursor,
          limit: remaining == null ? 100 : Math.max(1, Math.min(remaining, 100)),
        },
      });
      const items = Array.isArray(data.items)
        ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map(parse_settlement_receipt)
        : [];
      const found = items.find((item) => {
        const kind = String(item.receipt_kind ?? "").toLowerCase();
        if (!kind.includes("charge") && !kind.includes("payment")) {
          return false;
        }
        const candidates = [item.tx_hash, item.user_operation_hash, item.submitted_hash]
          .map((h) => String(h ?? "").toLowerCase())
          .filter((h) => h.length > 0);
        return candidates.includes(lookupHash);
      });
      if (found) {
        return parse_embedded_wallet_charge({}, { receipt: found });
      }
      if (remaining != null) {
        remaining -= remaining == null ? 0 : Math.max(1, Math.min(remaining, 100));
        if (remaining <= 0) {
          break;
        }
      }
      cursor = stringOrNull(data.next_cursor);
      if (!cursor || seenCursors.has(cursor)) {
        break;
      }
      seenCursors.add(cursor);
    }
    throw new SiglumeNotFoundError(`Embedded wallet charge not found: ${normalizedTxHash}`);
  }

  async get_cross_currency_quote(options: {
    from_currency: string;
    to_currency: string;
    source_amount_minor: number;
    slippage_bps?: number;
  }): Promise<CrossCurrencyQuote> {
    const from_currency = String(options.from_currency ?? "").trim().toUpperCase();
    const to_currency = String(options.to_currency ?? "").trim().toUpperCase();
    if (!from_currency) {
      throw new SiglumeClientError("from_currency is required.");
    }
    if (!to_currency) {
      throw new SiglumeClientError("to_currency is required.");
    }
    if (!Number.isFinite(options.source_amount_minor)) {
      throw new SiglumeClientError("source_amount_minor must be a finite number.");
    }
    const source_amount_minor = Math.trunc(options.source_amount_minor);
    if (source_amount_minor <= 0) {
      throw new SiglumeClientError("source_amount_minor must be positive.");
    }
    const slippage_input = options.slippage_bps ?? 100;
    if (!Number.isFinite(slippage_input)) {
      throw new SiglumeClientError("slippage_bps must be a finite number.");
    }
    const slippage_bps = Math.max(0, Math.min(Math.trunc(slippage_input), 5000));
    const [data] = await this.request("POST", "/market/web3/swap/quote", {
      json_body: {
        sell_token: from_currency,
        buy_token: to_currency,
        amount_minor: source_amount_minor,
        slippage_bps,
      },
    });
    return parse_cross_currency_quote(data);
  }

  private async resolveOwnerOperationAgentId(agent_id?: string): Promise<string> {
    const resolvedAgentId = String(agent_id ?? "").trim();
    if (resolvedAgentId) {
      return resolvedAgentId;
    }
    const [data] = await this.request("GET", "/me/agent");
    // `/me/agent` may return the identifier under either `agent_id`
    // (current contract) or the legacy `id` field. parseAgent already
    // accepts both; mirror that here so callers that rely on the
    // omitted-`agent_id` path do not hard-fail against servers still
    // emitting the legacy shape.
    const agentIdFromMe =
      stringOrNull(data.agent_id) ?? stringOrNull(data.id);
    if (agentIdFromMe) {
      return agentIdFromMe;
    }
    throw new SiglumeClientError("agent_id is required.");
  }

  private async requestOwnerOperation(
    agent_id: string,
    operation_key: string,
    params: Record<string, unknown> = {},
    options: { lang?: string } = {},
  ): Promise<RequestMetaTuple> {
    const normalizedAgentId = String(agent_id ?? "").trim();
    const normalizedKey = String(operation_key ?? "").trim();
    if (!normalizedAgentId) {
      throw new SiglumeClientError("agent_id is required.");
    }
    if (!normalizedKey) {
      throw new SiglumeClientError("operation_key is required.");
    }
    return this.request("POST", `/owner/agents/${normalizedAgentId}/operations/execute`, {
      json_body: {
        operation: normalizedKey,
        params: toRecord(params),
        lang: String(options.lang ?? "en").trim().toLowerCase() === "ja" ? "ja" : "en",
      },
    });
  }

  private async request(method: string, path: string, options: RequestOptions = {}): Promise<RequestMetaTuple> {
    const [data, meta] = await this.requestAny(method, path, options);
    if (!isRecord(data)) {
      throw new SiglumeClientError("Expected the Siglume API response body to be an object.");
    }
    return [data, meta];
  }

  private async requestAny(method: string, path: string, options: RequestOptions = {}): Promise<RequestAnyTuple> {
    const url = buildUrl(this.base_url, path, options.params);
    const headers = new Headers({
      Authorization: `Bearer ${this.api_key}`,
      Accept: "application/json",
      "User-Agent": "siglume-api-sdk-ts/0.7.6",
    });
    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        headers.set(key, value);
      }
    }
    let body: string | undefined;
    if (options.json_body) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(toJsonable(options.json_body));
    }

    for (let attempt = 0; attempt < this.max_retries; attempt += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.timeout_ms);
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timeoutHandle);
        const text = response.status === 204 ? "" : await response.text();
        const parsed = text ? this.safeParseJson(text) : {};
        const envelope = isRecord(parsed) ? parsed : {};
        const data = Array.isArray(envelope.data)
          ? envelope.data.map((item) => cloneJsonLike(item))
          : isRecord(envelope.data)
            ? envelope.data
            : isRecord(parsed)
              ? parsed
              : Array.isArray(parsed)
                ? parsed.map((item) => cloneJsonLike(item))
                : {};
        const meta: EnvelopeMeta = isRecord(envelope.meta)
          ? {
              request_id: stringOrNull(envelope.meta.request_id),
              trace_id: stringOrNull(envelope.meta.trace_id),
            }
          : {
              request_id: stringOrNull(response.headers.get("x-request-id")),
              trace_id: stringOrNull(response.headers.get("x-trace-id")),
            };

        if (response.ok) {
          return [data, meta];
        }

        if (RETRYABLE_STATUS_CODES.has(response.status) && attempt + 1 < this.max_retries) {
          await sleep(parseRetryAfter(response.headers.get("Retry-After")) ?? (250 * (2 ** attempt)));
          continue;
        }

        const errorBlock = isRecord(envelope.error) ? envelope.error : {};
        const message = String(
          errorBlock.message ??
            (isRecord(parsed) ? parsed.message : undefined) ??
            response.statusText ??
            "Siglume API request failed.",
        );
        const error_code = stringOrNull(errorBlock.code) ?? undefined;
        if (response.status === 404) {
          throw new SiglumeNotFoundError(message);
        }
        throw new SiglumeAPIError(message, {
          status_code: response.status,
          error_code,
          trace_id: meta.trace_id,
          request_id: meta.request_id,
          details: toRecord(errorBlock.details),
          response_body: parsed,
        });
      } catch (error) {
        clearTimeout(timeoutHandle);
        if (error instanceof SiglumeAPIError || error instanceof SiglumeNotFoundError) {
          throw error;
        }
        if (attempt + 1 < this.max_retries) {
          await sleep(250 * (2 ** attempt));
          continue;
        }
        if (error instanceof Error) {
          throw new SiglumeClientError(error.message);
        }
        throw new SiglumeClientError("Siglume request failed.");
      }
    }
    throw new SiglumeClientError("Siglume request failed after retries.");
  }

  private safeParseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  private agentHeaders(): Record<string, string> {
    if (!this.agent_key) {
      throw new SiglumeClientError("agent_key is required for agent.* routes. Pass agent_key when constructing SiglumeClient.");
    }
    return { "X-Agent-Key": this.agent_key };
  }
}

function cloneJsonLike(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonLike(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonLike(item)]));
  }
  return value;
}
