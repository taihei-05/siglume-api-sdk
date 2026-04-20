import type {
  AccessGrantRecord,
  AccountPlan,
  AccountPlanCancellation,
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
  ConnectedAccountRecord,
  CursorPage,
  DeveloperPortalSummary,
  DisputeRecord,
  DisputeResponse,
  EnvelopeMeta,
  GrantBindingResult,
  RegistrationConfirmation,
  RegistrationQuality,
  RefundReason,
  RefundRecord,
  SandboxSession,
  PlanCheckoutSession,
  PlanWeb3Mandate,
  SupportCaseRecord,
  ToolManual,
  ToolManualIssue,
  ToolManualQualityReport,
  UsageEventRecord,
} from "./types";
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
  buildDefaultI18n,
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

export const DEFAULT_SIGLUME_API_BASE = "https://api.siglume.com/v1";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

type FetchLike = typeof fetch;

type RequestOptions = {
  params?: Record<string, string | number | boolean | undefined | null>;
  json_body?: Record<string, unknown>;
};

export interface SiglumeClientOptions {
  api_key: string;
  base_url?: string;
  timeout_ms?: number;
  max_retries?: number;
  fetch?: FetchLike;
}

type PendingConfirmation = {
  manifest: Record<string, unknown>;
  tool_manual: Record<string, unknown>;
};

type RequestMetaTuple = [Record<string, unknown>, EnvelopeMeta];
type RequestAnyTuple = [unknown, EnvelopeMeta];

export interface SiglumeClientShape {
  auto_register(
    manifest: AppManifest | Record<string, unknown>,
    tool_manual: ToolManual | Record<string, unknown>,
    options?: { source_code?: string; source_url?: string },
  ): Promise<AutoRegistrationReceipt>;
  confirm_registration(
    listing_id: string,
    options?: { manifest?: AppManifest | Record<string, unknown>; tool_manual?: ToolManual | Record<string, unknown> },
  ): Promise<RegistrationConfirmation>;
  preview_quality_score(tool_manual: ToolManual | Record<string, unknown>): Promise<ToolManualQualityReport>;
  submit_review(listing_id: string): Promise<AppListingRecord>;
  list_my_listings(options?: { status?: string; limit?: number; cursor?: string }): Promise<CursorPage<AppListingRecord>>;
  get_listing(listing_id: string): Promise<AppListingRecord>;
  list_capabilities(options?: {
    mine?: boolean;
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CursorPage<AppListingRecord>>;
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
  get_agent(
    agent_id: string,
    options?: { lang?: string; tab?: string; cursor?: string; limit?: number },
  ): Promise<AgentRecord>;
  execute_owner_operation(
    agent_id: string,
    operation_key: string,
    params?: Record<string, unknown>,
    options?: { lang?: string },
  ): Promise<OperationExecution>;
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
  list_connected_accounts(options?: {
    provider_key?: string;
    environment?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CursorPage<ConnectedAccountRecord>>;
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
  issue_partial_refund(options: {
    receipt_id: string;
    amount_minor: number;
    reason?: RefundReason | string;
    note?: string;
    idempotency_key: string;
    original_amount_minor?: number;
  }): Promise<RefundRecord>;
  issue_full_refund(options: {
    receipt_id: string;
    reason?: RefundReason | string;
    note?: string;
    idempotency_key?: string;
  }): Promise<RefundRecord>;
  list_refunds(options?: {
    receipt_id?: string;
    limit?: number;
  }): Promise<RefundRecord[]>;
  get_refund(refund_id: string): Promise<RefundRecord>;
  get_refunds_for_receipt(receipt_id: string, options?: { limit?: number }): Promise<RefundRecord[]>;
  list_disputes(options?: {
    receipt_id?: string;
    limit?: number;
  }): Promise<DisputeRecord[]>;
  get_dispute(dispute_id: string): Promise<DisputeRecord>;
  respond_to_dispute(options: {
    dispute_id: string;
    response: DisputeResponse | string;
    evidence: Record<string, unknown>;
    note?: string;
  }): Promise<DisputeRecord>;
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
    currency: String(data.currency ?? "USD"),
    short_description: stringOrNull(data.short_description),
    docs_url: stringOrNull(data.docs_url),
    support_contact: stringOrNull(data.support_contact),
    review_status: stringOrNull(data.review_status),
    review_note: stringOrNull(data.review_note),
    submission_blockers: Array.isArray(data.submission_blockers)
      ? data.submission_blockers.filter((item): item is string => typeof item === "string")
      : [],
    created_at: stringOrNull(data.created_at),
    updated_at: stringOrNull(data.updated_at),
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

function parseConnectedAccount(data: Record<string, unknown>): ConnectedAccountRecord {
  return {
    connected_account_id: String(data.connected_account_id ?? data.id ?? ""),
    provider_key: String(data.provider_key ?? ""),
    account_role: String(data.account_role ?? ""),
    display_name: stringOrNull(data.display_name),
    environment: stringOrNull(data.environment),
    connection_status: stringOrNull(data.connection_status),
    scopes: Array.isArray(data.scopes) ? data.scopes.filter((item): item is string => typeof item === "string") : [],
    metadata: toRecord(data.metadata),
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
    post_count: typeof data.post_count === "number" ? data.post_count : null,
    reply_count: typeof data.reply_count === "number" ? data.reply_count : null,
    paused: typeof data.paused === "boolean" ? data.paused : null,
    style: stringOrNull(data.style),
    manifesto_text: stringOrNull(data.manifesto_text),
    capabilities: toRecord(data.capabilities),
    settings: toRecord(data.settings),
    growth: toRecord(data.growth),
    plan: toRecord(data.plan),
    reputation: toRecord(data.reputation),
    items: Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => ({ ...item }))
      : [],
    next_cursor: stringOrNull(data.next_cursor),
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

function parseOperationExecution(
  data: Record<string, unknown>,
  operation_key: string,
  meta: EnvelopeMeta,
): OperationExecution {
  return {
    agent_id: String(data.agent_id ?? ""),
    operation_key,
    message: String(data.message ?? ""),
    action: String(data.action ?? operation_key.replaceAll(".", "_")),
    result: toRecord(data.result),
    trace_id: meta.trace_id ?? null,
    request_id: meta.request_id ?? null,
    raw: { ...data },
  };
}

function parseRefund(data: Record<string, unknown>): RefundRecord {
  return {
    refund_id: String(data.refund_id ?? data.id ?? ""),
    receipt_id: String(data.receipt_id ?? ""),
    owner_user_id: stringOrNull(data.owner_user_id) ?? undefined,
    payment_mandate_id: stringOrNull(data.payment_mandate_id) ?? undefined,
    usage_event_id: stringOrNull(data.usage_event_id) ?? undefined,
    chain_receipt_id: stringOrNull(data.chain_receipt_id) ?? undefined,
    amount_minor: Number(data.amount_minor ?? 0),
    currency: String(data.currency ?? "USD"),
    status: String(data.status ?? "issued"),
    reason_code: String(data.reason_code ?? "customer-request"),
    note: stringOrNull(data.note) ?? undefined,
    idempotency_key: stringOrNull(data.idempotency_key) ?? undefined,
    on_chain_tx_hash: stringOrNull(data.on_chain_tx_hash) ?? undefined,
    metadata: toRecord(data.metadata),
    idempotent_replay: Boolean(data.idempotent_replay ?? false),
    created_at: stringOrNull(data.created_at) ?? undefined,
    updated_at: stringOrNull(data.updated_at) ?? undefined,
    raw: { ...data },
  };
}

function parseDispute(data: Record<string, unknown>): DisputeRecord {
  return {
    dispute_id: String(data.dispute_id ?? data.id ?? ""),
    receipt_id: String(data.receipt_id ?? ""),
    owner_user_id: stringOrNull(data.owner_user_id) ?? undefined,
    payment_mandate_id: stringOrNull(data.payment_mandate_id) ?? undefined,
    usage_event_id: stringOrNull(data.usage_event_id) ?? undefined,
    external_dispute_id: stringOrNull(data.external_dispute_id) ?? undefined,
    status: String(data.status ?? "open"),
    reason_code: String(data.reason_code ?? "manual-review"),
    description: stringOrNull(data.description) ?? undefined,
    evidence: toRecord(data.evidence),
    response_decision: stringOrNull(data.response_decision) ?? undefined,
    response_note: stringOrNull(data.response_note) ?? undefined,
    responded_at: stringOrNull(data.responded_at) ?? undefined,
    metadata: toRecord(data.metadata),
    idempotent_replay: Boolean(data.idempotent_replay ?? false),
    created_at: stringOrNull(data.created_at) ?? undefined,
    updated_at: stringOrNull(data.updated_at) ?? undefined,
    raw: { ...data },
  };
}

export class SiglumeClient implements SiglumeClientShape {
  readonly api_key: string;
  readonly base_url: string;
  readonly timeout_ms: number;
  readonly max_retries: number;
  private readonly fetchImpl: FetchLike;
  private readonly pendingConfirmations = new Map<string, PendingConfirmation>();

  constructor(options: SiglumeClientOptions) {
    if (!options.api_key) {
      throw new SiglumeClientError("SIGLUME_API_KEY is required.");
    }
    this.api_key = options.api_key;
    this.base_url = (options.base_url ?? DEFAULT_SIGLUME_API_BASE).replace(/\/+$/, "");
    this.timeout_ms = Math.max(1, options.timeout_ms ?? 15_000);
    this.max_retries = Math.max(1, Math.trunc(options.max_retries ?? 3));
    this.fetchImpl = options.fetch ?? fetch;
  }

  close(): void {}

  async auto_register(
    manifest: AppManifest | Record<string, unknown>,
    tool_manual: ToolManual | Record<string, unknown>,
    options: { source_code?: string; source_url?: string } = {},
  ): Promise<AutoRegistrationReceipt> {
    const manifestPayload = coerceMapping(manifest, "manifest");
    const toolManualPayload = coerceMapping(tool_manual, "tool_manual");
    const payload: Record<string, unknown> = { i18n: buildDefaultI18n(manifestPayload) };
    if (options.source_url) {
      payload.source_url = options.source_url;
    } else if (options.source_code !== undefined) {
      payload.source_code = options.source_code;
    } else {
      payload.source_code = buildRegistrationStubSource(manifestPayload, toolManualPayload);
    }
    for (const fieldName of ["capability_key", "name", "price_model", "price_value_minor"]) {
      const value = manifestPayload[fieldName];
      if (value !== undefined && value !== null) {
        payload[fieldName] = value as string | number;
      }
    }
    const [data, meta] = await this.request("POST", "/market/capabilities/auto-register", { json_body: payload });
    const listing_id = String(data.listing_id ?? "");
    if (!listing_id) {
      throw new SiglumeClientError("Siglume auto-register response did not include listing_id.");
    }
    this.pendingConfirmations.set(listing_id, { manifest: manifestPayload, tool_manual: toolManualPayload });
    return {
      listing_id,
      status: String(data.status ?? "draft"),
      auto_manifest: toRecord(data.auto_manifest),
      confidence: toRecord(data.confidence),
      review_url: stringOrNull(data.review_url),
      trace_id: meta.trace_id,
      request_id: meta.request_id,
    };
  }

  async confirm_registration(
    listing_id: string,
    options: { manifest?: AppManifest | Record<string, unknown>; tool_manual?: ToolManual | Record<string, unknown> } = {},
  ): Promise<RegistrationConfirmation> {
    const pending = this.pendingConfirmations.get(listing_id);
    const manifestPayload = options.manifest ? coerceMapping(options.manifest, "manifest") : pending?.manifest ?? {};
    const toolManualPayload = options.tool_manual ? coerceMapping(options.tool_manual, "tool_manual") : pending?.tool_manual ?? {};
    const overrides: Record<string, unknown> = {};
    for (const fieldName of ["name", "job_to_be_done"]) {
      if (manifestPayload[fieldName]) {
        overrides[fieldName] = manifestPayload[fieldName];
      }
    }
    if (Object.keys(toolManualPayload).length > 0) {
      overrides.tool_manual = toolManualPayload;
    }
    const payload: Record<string, unknown> = { approved: true };
    if (Object.keys(overrides).length > 0) {
      payload.overrides = overrides;
    }
    const [data, meta] = await this.request("POST", `/market/capabilities/${listing_id}/confirm-auto-register`, { json_body: payload });
    this.pendingConfirmations.delete(listing_id);
    return {
      listing_id: String(data.listing_id ?? listing_id),
      status: String(data.status ?? ""),
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
      connected_accounts: Array.isArray(data.connected_accounts)
        ? data.connected_accounts.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => ({ ...item }))
        : [],
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

  async get_agent(
    agent_id: string,
    options: { lang?: string; tab?: string; cursor?: string; limit?: number } = {},
  ): Promise<AgentRecord> {
    const normalizedAgentId = String(agent_id ?? "").trim();
    if (!normalizedAgentId) {
      throw new SiglumeClientError("agent_id is required.");
    }
    const [data] = await this.request("GET", `/agents/${normalizedAgentId}/profile`, {
      params: {
        lang: options.lang,
        tab: options.tab,
        cursor: options.cursor,
        limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 15), 50)),
      },
    });
    return parseAgent(data);
  }

  async execute_owner_operation(
    agent_id: string,
    operation_key: string,
    params: Record<string, unknown> = {},
    options: { lang?: string } = {},
  ): Promise<OperationExecution> {
    const normalizedAgentId = String(agent_id ?? "").trim();
    const normalizedKey = String(operation_key ?? "").trim();
    if (!normalizedAgentId) {
      throw new SiglumeClientError("agent_id is required.");
    }
    if (!normalizedKey) {
      throw new SiglumeClientError("operation_key is required.");
    }
    const [data, meta] = await this.request("POST", `/owner/agents/${normalizedAgentId}/operations/execute`, {
      json_body: {
        operation: normalizedKey,
        params: toRecord(params),
        lang: String(options.lang ?? "en").trim().toLowerCase() === "ja" ? "ja" : "en",
      },
    });
    return parseOperationExecution(data, normalizedKey, meta);
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

  async list_connected_accounts(options: {
    provider_key?: string;
    environment?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<CursorPageResult<ConnectedAccountRecord>> {
    const params = {
      provider_key: options.provider_key,
      environment: options.environment,
      limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 50), 100)),
      cursor: options.cursor,
    };
    const [data, meta] = await this.request("GET", "/market/connected-accounts", { params });
    const items = Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map(parseConnectedAccount)
      : [];
    const next_cursor = stringOrNull(data.next_cursor);
    return new CursorPageResult({
      items,
      next_cursor,
      limit: typeof data.limit === "number" ? data.limit : params.limit,
      offset: typeof data.offset === "number" ? data.offset : null,
      meta,
      fetchNext: next_cursor
        ? (cursor) => this.list_connected_accounts({ ...options, cursor })
        : undefined,
    });
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

  async issue_partial_refund(options: {
    receipt_id: string;
    amount_minor: number;
    reason?: RefundReason | string;
    note?: string;
    idempotency_key: string;
    original_amount_minor?: number;
  }): Promise<RefundRecord> {
    const receipt_id = String(options.receipt_id ?? "").trim();
    const idempotency_key = String(options.idempotency_key ?? "").trim();
    if (!receipt_id) {
      throw new SiglumeClientError("receipt_id is required.");
    }
    if (!idempotency_key) {
      throw new SiglumeClientError("idempotency_key is required.");
    }
    if (!Number.isFinite(options.amount_minor)) {
      throw new SiglumeClientError("amount_minor must be a finite number.");
    }
    const amount_minor = Math.trunc(options.amount_minor);
    if (amount_minor <= 0) {
      throw new SiglumeClientError("amount_minor must be positive.");
    }
    if (
      typeof options.original_amount_minor === "number"
      && amount_minor > Math.trunc(options.original_amount_minor)
    ) {
      throw new SiglumeClientError("amount_minor cannot exceed the original receipt amount.");
    }
    const [data] = await this.request("POST", "/market/refunds", {
      json_body: {
        receipt_id,
        amount_minor,
        reason_code: options.reason ?? "customer-request",
        note: options.note,
        idempotency_key,
      },
    });
    return parseRefund(data);
  }

  async issue_full_refund(options: {
    receipt_id: string;
    reason?: RefundReason | string;
    note?: string;
    idempotency_key?: string;
  }): Promise<RefundRecord> {
    const receipt_id = String(options.receipt_id ?? "").trim();
    if (!receipt_id) {
      throw new SiglumeClientError("receipt_id is required.");
    }
    const provided_key = String(options.idempotency_key ?? "").trim();
    const idempotency_key = provided_key || `full-refund:${receipt_id}`;
    const [data] = await this.request("POST", "/market/refunds", {
      json_body: {
        receipt_id,
        reason_code: options.reason ?? "customer-request",
        note: options.note,
        idempotency_key,
      },
    });
    return parseRefund(data);
  }

  async list_refunds(options: { receipt_id?: string; limit?: number } = {}): Promise<RefundRecord[]> {
    const [data] = await this.requestAny("GET", "/market/refunds", {
      params: {
        receipt_id: options.receipt_id,
        limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 50), 100)),
      },
    });
    if (!Array.isArray(data)) {
      throw new SiglumeClientError("Expected refunds to be returned as an array.");
    }
    return data.filter((item): item is Record<string, unknown> => isRecord(item)).map(parseRefund);
  }

  async get_refund(refund_id: string): Promise<RefundRecord> {
    const [data] = await this.request("GET", `/market/refunds/${refund_id}`);
    return parseRefund(data);
  }

  async get_refunds_for_receipt(receipt_id: string, options: { limit?: number } = {}): Promise<RefundRecord[]> {
    return this.list_refunds({ receipt_id, limit: options.limit });
  }

  async list_disputes(options: { receipt_id?: string; limit?: number } = {}): Promise<DisputeRecord[]> {
    const [data] = await this.requestAny("GET", "/market/disputes", {
      params: {
        receipt_id: options.receipt_id,
        limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 50), 100)),
      },
    });
    if (!Array.isArray(data)) {
      throw new SiglumeClientError("Expected disputes to be returned as an array.");
    }
    return data.filter((item): item is Record<string, unknown> => isRecord(item)).map(parseDispute);
  }

  async get_dispute(dispute_id: string): Promise<DisputeRecord> {
    const [data] = await this.request("GET", `/market/disputes/${dispute_id}`);
    return parseDispute(data);
  }

  async respond_to_dispute(options: {
    dispute_id: string;
    response: DisputeResponse | string;
    evidence: Record<string, unknown>;
    note?: string;
  }): Promise<DisputeRecord> {
    const dispute_id = String(options.dispute_id ?? "").trim();
    if (!dispute_id) {
      throw new SiglumeClientError("dispute_id is required.");
    }
    if (!isRecord(options.evidence)) {
      throw new SiglumeClientError("evidence must be an object.");
    }
    const [data] = await this.request("POST", `/market/disputes/${dispute_id}/respond`, {
      json_body: {
        response: options.response,
        evidence: toRecord(options.evidence),
        note: options.note,
      },
    });
    return parseDispute(data);
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
      "User-Agent": "siglume-api-sdk-ts/0.5.0",
    });
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
