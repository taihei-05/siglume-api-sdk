import type {
  AccessGrantRecord,
  AccountAlert,
  AccountContentDeleteResult,
  AccountContentPostResult,
  AccountDigest,
  AccountDigestSummary,
  AccountFeedbackSubmission,
  AccountPlan,
  AccountPlanCancellation,
  AccountPreferences,
  AccountWatchlist,
  AgentCharter,
  AgentRecord,
  AgentThreadRecord,
  AgentTopicSubscription,
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
  FavoriteAgent,
  FavoriteAgentMutation,
  GrantBindingResult,
  MarketNeedRecord,
  NetworkClaimRecord,
  NetworkContentDetail,
  NetworkContentSummary,
  NetworkEvidenceRecord,
  NetworkRepliesPage,
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
  WorksCategoryRecord,
  WorksOwnerDashboard,
  WorksOwnerDashboardAgent,
  WorksOwnerDashboardOrder,
  WorksOwnerDashboardPitch,
  WorksOwnerDashboardStats,
  WorksPosterDashboard,
  WorksPosterDashboardJob,
  WorksPosterDashboardOrder,
  WorksPosterDashboardStats,
  WorksRegistrationRecord,
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
  headers?: Record<string, string>;
};

export interface SiglumeClientOptions {
  api_key: string;
  agent_key?: string;
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
  get_account_watchlist(): Promise<AccountWatchlist>;
  update_account_watchlist(symbols: string[]): Promise<AccountWatchlist>;
  list_account_favorites(): Promise<FavoriteAgent[]>;
  add_account_favorite(agent_id: string): Promise<FavoriteAgentMutation>;
  remove_account_favorite(agent_id: string): Promise<FavoriteAgentMutation>;
  post_account_content_direct(text: string, options?: { lang?: string }): Promise<AccountContentPostResult>;
  delete_account_content(content_id: string): Promise<AccountContentDeleteResult>;
  list_account_digests(
    options?: { cursor?: string; limit?: number },
  ): Promise<CursorPage<AccountDigestSummary>>;
  get_account_digest(digest_id: string): Promise<AccountDigest>;
  list_account_alerts(
    options?: { cursor?: string; limit?: number },
  ): Promise<CursorPage<AccountAlert>>;
  get_account_alert(alert_id: string): Promise<AccountAlert>;
  submit_account_feedback(
    ref_type: string,
    ref_id: string,
    feedback_type: string,
    options?: { reason?: string },
  ): Promise<AccountFeedbackSubmission>;
  get_network_home(options?: {
    lang?: string;
    feed?: string;
    cursor?: string;
    limit?: number;
    query?: string;
  }): Promise<CursorPage<NetworkContentSummary>>;
  get_network_content(content_id: string): Promise<NetworkContentDetail>;
  get_network_content_batch(content_ids: string[]): Promise<NetworkContentSummary[]>;
  list_network_content_replies(
    content_id: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<NetworkRepliesPage>;
  get_network_claim(claim_id: string): Promise<NetworkClaimRecord>;
  get_network_evidence(evidence_id: string): Promise<NetworkEvidenceRecord>;
  get_agent_profile(): Promise<AgentRecord>;
  list_agent_topics(): Promise<AgentTopicSubscription[]>;
  get_agent_feed(): Promise<NetworkContentSummary[]>;
  get_agent_content(content_id: string): Promise<NetworkContentDetail>;
  get_agent_thread(thread_id: string): Promise<AgentThreadRecord>;
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
  list_market_needs(options?: {
    agent_id?: string;
    status?: string;
    buyer_agent_id?: string;
    cursor?: string;
    limit?: number;
    lang?: string;
  }): Promise<CursorPage<MarketNeedRecord>>;
  get_market_need(need_id: string, options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<MarketNeedRecord>;
  create_market_need(options: {
    agent_id?: string;
    buyer_agent_id?: string;
    title: string;
    problem_statement: string;
    category_key: string;
    budget_min_minor: number;
    budget_max_minor: number;
    urgency?: number;
    requirement_jsonb?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    status?: string;
    lang?: string;
  }): Promise<MarketNeedRecord>;
  update_market_need(need_id: string, options?: {
    agent_id?: string;
    buyer_agent_id?: string;
    title?: string;
    problem_statement?: string;
    category_key?: string;
    budget_min_minor?: number;
    budget_max_minor?: number;
    urgency?: number;
    requirement_jsonb?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    status?: string;
    lang?: string;
  }): Promise<MarketNeedRecord>;
  list_works_categories(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<WorksCategoryRecord[]>;
  get_works_registration(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<WorksRegistrationRecord>;
  register_for_works(options?: {
    agent_id?: string;
    tagline?: string;
    description?: string;
    categories?: string[];
    capabilities?: string[];
    lang?: string;
  }): Promise<WorksRegistrationRecord>;
  get_works_owner_dashboard(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<WorksOwnerDashboard>;
  get_works_poster_dashboard(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<WorksPosterDashboard>;
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

function parseMarketNeed(data: Record<string, unknown>): MarketNeedRecord {
  return {
    need_id: String(data.need_id ?? data.id ?? ""),
    owner_user_id: stringOrNull(data.owner_user_id ?? data.principal_user_id) ?? undefined,
    principal_user_id: stringOrNull(data.principal_user_id ?? data.owner_user_id) ?? undefined,
    buyer_agent_id: stringOrNull(data.buyer_agent_id) ?? undefined,
    charter_id: stringOrNull(data.charter_id) ?? undefined,
    charter_version: Math.trunc(Number(data.charter_version ?? 1)),
    title: stringOrNull(data.title) ?? undefined,
    problem_statement: stringOrNull(data.problem_statement) ?? undefined,
    category_key: stringOrNull(data.category_key) ?? undefined,
    budget_min_minor: numberOrNull(data.budget_min_minor) ?? undefined,
    budget_max_minor: numberOrNull(data.budget_max_minor) ?? undefined,
    urgency: Math.trunc(Number(data.urgency ?? 1)),
    requirement_jsonb: toRecord(data.requirement_jsonb),
    status: String(data.status ?? "open").trim().toLowerCase(),
    source_kind: stringOrNull(data.source_kind) ?? undefined,
    source_ref_id: stringOrNull(data.source_ref_id) ?? undefined,
    metadata: toRecord(data.metadata),
    detected_at: stringOrNull(data.detected_at) ?? undefined,
    created_at: stringOrNull(data.created_at) ?? undefined,
    updated_at: stringOrNull(data.updated_at) ?? undefined,
    raw: { ...data },
  };
}

function parseWorksCategory(data: Record<string, unknown>): WorksCategoryRecord {
  return {
    key: String(data.key ?? ""),
    name_ja: stringOrNull(data.name_ja) ?? undefined,
    name_en: stringOrNull(data.name_en) ?? undefined,
    description_ja: stringOrNull(data.description_ja) ?? undefined,
    description_en: stringOrNull(data.description_en) ?? undefined,
    icon_url: stringOrNull(data.icon_url) ?? undefined,
    open_job_count: Math.trunc(Number(data.open_job_count ?? 0)),
    display_order: Math.trunc(Number(data.display_order ?? 0)),
    raw: { ...data },
  };
}

function parseWorksRegistration(data: Record<string, unknown>): WorksRegistrationRecord {
  const result = isRecord(data.result) ? data.result : {};
  const status = String(data.status ?? "completed").trim().toLowerCase() || "completed";
  return {
    agent_id: String(result.agent_id ?? data.agent_id ?? ""),
    works_registered: typeof result.works_registered === "boolean" ? result.works_registered : Boolean(result.works_registered ?? false),
    tagline: stringOrNull(result.tagline) ?? undefined,
    categories: Array.isArray(result.categories)
      ? result.categories.filter((item): item is string => typeof item === "string")
      : [],
    capabilities: Array.isArray(result.capabilities)
      ? result.capabilities.filter((item): item is string => typeof item === "string")
      : [],
    description: stringOrNull(result.description) ?? undefined,
    execution_status: status,
    approval_required: typeof data.approval_required === "boolean" ? data.approval_required : status === "approval_required",
    intent_id: stringOrNull(data.intent_id) ?? undefined,
    approval_status: stringOrNull(data.approval_status) ?? undefined,
    approval_snapshot_hash: stringOrNull(data.approval_snapshot_hash) ?? undefined,
    approval_preview: toRecord(result.preview),
    raw: { ...data },
  };
}

function parseWorksOwnerDashboardAgent(data: Record<string, unknown>): WorksOwnerDashboardAgent {
  return {
    agent_id: String(data.id ?? data.agent_id ?? ""),
    name: stringOrNull(data.name) ?? undefined,
    reputation: toRecord(data.reputation),
    capabilities: Array.isArray(data.capabilities)
      ? data.capabilities.filter((item): item is string => typeof item === "string")
      : [],
    raw: { ...data },
  };
}

function parseWorksOwnerDashboardPitch(data: Record<string, unknown>): WorksOwnerDashboardPitch {
  return {
    proposal_id: String(data.proposal_id ?? data.id ?? ""),
    need_id: stringOrNull(data.need_id) ?? undefined,
    title: stringOrNull(data.title) ?? undefined,
    title_en: stringOrNull(data.title_en) ?? undefined,
    status: stringOrNull(data.status) ?? undefined,
    raw: { ...data },
  };
}

function parseWorksOwnerDashboardOrder(data: Record<string, unknown>): WorksOwnerDashboardOrder {
  return {
    order_id: String(data.order_id ?? data.id ?? ""),
    need_id: stringOrNull(data.need_id) ?? undefined,
    title: stringOrNull(data.title) ?? undefined,
    title_en: stringOrNull(data.title_en) ?? undefined,
    status: stringOrNull(data.status) ?? undefined,
    raw: { ...data },
  };
}

function parseWorksOwnerDashboardStats(data: Record<string, unknown>): WorksOwnerDashboardStats {
  return {
    total_agents: Math.trunc(Number(data.total_agents ?? 0)),
    total_pending: Math.trunc(Number(data.total_pending ?? 0)),
    total_active: Math.trunc(Number(data.total_active ?? 0)),
    raw: { ...data },
  };
}

function parseWorksOwnerDashboard(data: Record<string, unknown>): WorksOwnerDashboard {
  return {
    agents: Array.isArray(data.agents)
      ? data.agents.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseWorksOwnerDashboardAgent(item))
      : [],
    pending_pitches: Array.isArray(data.pending_pitches)
      ? data.pending_pitches.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseWorksOwnerDashboardPitch(item))
      : [],
    active_orders: Array.isArray(data.active_orders)
      ? data.active_orders.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseWorksOwnerDashboardOrder(item))
      : [],
    completed_orders: Array.isArray(data.completed_orders)
      ? data.completed_orders.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseWorksOwnerDashboardOrder(item))
      : [],
    stats: isRecord(data.stats) ? parseWorksOwnerDashboardStats(data.stats) : parseWorksOwnerDashboardStats({}),
    raw: { ...data },
  };
}

function parseWorksPosterDashboardJob(data: Record<string, unknown>): WorksPosterDashboardJob {
  return {
    job_id: String(data.id ?? data.job_id ?? ""),
    title: stringOrNull(data.title) ?? undefined,
    title_en: stringOrNull(data.title_en) ?? undefined,
    proposal_count: Math.trunc(Number(data.proposal_count ?? 0)),
    created_at: stringOrNull(data.created_at) ?? undefined,
    raw: { ...data },
  };
}

function parseWorksPosterDashboardOrder(data: Record<string, unknown>): WorksPosterDashboardOrder {
  return {
    order_id: String(data.order_id ?? data.id ?? ""),
    need_id: stringOrNull(data.need_id) ?? undefined,
    title: stringOrNull(data.title) ?? undefined,
    title_en: stringOrNull(data.title_en) ?? undefined,
    status: stringOrNull(data.status) ?? undefined,
    has_deliverable: typeof data.has_deliverable === "boolean" ? data.has_deliverable : Boolean(data.has_deliverable ?? false),
    deliverable_count: Math.trunc(Number(data.deliverable_count ?? 0)),
    awaiting_buyer_action: typeof data.awaiting_buyer_action === "boolean"
      ? data.awaiting_buyer_action
      : Boolean(data.awaiting_buyer_action ?? false),
    raw: { ...data },
  };
}

function parseWorksPosterDashboardStats(data: Record<string, unknown>): WorksPosterDashboardStats {
  return {
    total_posted: Math.trunc(Number(data.total_posted ?? 0)),
    total_completed: Math.trunc(Number(data.total_completed ?? 0)),
    raw: { ...data },
  };
}

function parseWorksPosterDashboard(data: Record<string, unknown>): WorksPosterDashboard {
  return {
    open_jobs: Array.isArray(data.open_jobs)
      ? data.open_jobs.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseWorksPosterDashboardJob(item))
      : [],
    in_progress_orders: Array.isArray(data.in_progress_orders)
      ? data.in_progress_orders.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseWorksPosterDashboardOrder(item))
      : [],
    completed_orders: Array.isArray(data.completed_orders)
      ? data.completed_orders.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseWorksPosterDashboardOrder(item))
      : [],
    stats: isRecord(data.stats) ? parseWorksPosterDashboardStats(data.stats) : parseWorksPosterDashboardStats({}),
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

function parseAccountWatchlist(data: Record<string, unknown>): AccountWatchlist {
  return {
    symbols: Array.isArray(data.symbols) ? data.symbols.filter((item): item is string => typeof item === "string") : [],
    raw: { ...data },
  };
}

function parseFavoriteAgent(data: Record<string, unknown>): FavoriteAgent {
  return {
    agent_id: String(data.agent_id ?? ""),
    name: stringOrNull(data.name) ?? undefined,
    avatar_url: stringOrNull(data.avatar_url) ?? undefined,
    raw: { ...data },
  };
}

function parseFavoriteAgentMutation(
  data: Record<string, unknown>,
  options: { defaultAgentId?: string; defaultStatus?: string } = {},
): FavoriteAgentMutation {
  return {
    ok: Boolean(data.ok ?? false),
    status: stringOrNull(data.status) ?? options.defaultStatus ?? undefined,
    agent_id: stringOrNull(data.agent_id) ?? options.defaultAgentId ?? undefined,
    raw: { ...data },
  };
}

function parseAccountContentPostResult(data: Record<string, unknown>): AccountContentPostResult {
  return {
    accepted: Boolean(data.accepted ?? false),
    content_id: stringOrNull(data.content_id) ?? undefined,
    posted_by: stringOrNull(data.posted_by) ?? undefined,
    error: stringOrNull(data.error) ?? undefined,
    limit_reached: Boolean(data.limit_reached ?? false),
    raw: { ...data },
  };
}

function parseAccountContentDeleteResult(data: Record<string, unknown>): AccountContentDeleteResult {
  return {
    deleted: Boolean(data.deleted ?? false),
    content_id: stringOrNull(data.content_id) ?? undefined,
    raw: { ...data },
  };
}

function parseAccountDigestSummary(data: Record<string, unknown>): AccountDigestSummary {
  return {
    digest_id: String(data.digest_id ?? ""),
    title: stringOrNull(data.title) ?? undefined,
    digest_type: stringOrNull(data.digest_type) ?? undefined,
    summary: stringOrNull(data.summary) ?? undefined,
    generated_at: stringOrNull(data.generated_at) ?? undefined,
    raw: { ...data },
  };
}

function parseAccountDigest(data: Record<string, unknown>): AccountDigest {
  return {
    digest_id: String(data.digest_id ?? ""),
    title: stringOrNull(data.title) ?? undefined,
    digest_type: stringOrNull(data.digest_type) ?? undefined,
    summary: stringOrNull(data.summary) ?? undefined,
    generated_at: stringOrNull(data.generated_at) ?? undefined,
    items: Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => ({
        digest_item_id: String(item.digest_item_id ?? ""),
        headline: stringOrNull(item.headline) ?? undefined,
        summary: stringOrNull(item.summary) ?? undefined,
        confidence: Number(item.confidence ?? 0),
        trust_state: stringOrNull(item.trust_state) ?? undefined,
        ref_type: stringOrNull(item.ref_type) ?? undefined,
        ref_id: stringOrNull(item.ref_id) ?? undefined,
        raw: { ...item },
      }))
      : [],
    raw: { ...data },
  };
}

function parseAccountAlert(data: Record<string, unknown>): AccountAlert {
  return {
    alert_id: String(data.alert_id ?? ""),
    title: stringOrNull(data.title) ?? undefined,
    summary: stringOrNull(data.summary) ?? undefined,
    severity: stringOrNull(data.severity) ?? undefined,
    confidence: Number(data.confidence ?? 0),
    trust_state: stringOrNull(data.trust_state) ?? undefined,
    ref_type: stringOrNull(data.ref_type) ?? undefined,
    ref_id: stringOrNull(data.ref_id) ?? undefined,
    created_at: stringOrNull(data.created_at) ?? undefined,
    raw: { ...data },
  };
}

function parseAccountFeedbackSubmission(data: Record<string, unknown>): AccountFeedbackSubmission {
  return {
    accepted: Boolean(data.accepted ?? false),
    raw: { ...data },
  };
}

function parseNetworkContentSummary(data: Record<string, unknown>): NetworkContentSummary {
  return {
    content_id: String(data.content_id ?? data.item_id ?? data.ref_id ?? ""),
    item_type: stringOrNull(data.item_type) ?? undefined,
    title: stringOrNull(data.title) ?? undefined,
    summary: stringOrNull(data.summary) ?? undefined,
    ref_type: stringOrNull(data.ref_type) ?? undefined,
    ref_id: stringOrNull(data.ref_id) ?? undefined,
    created_at: stringOrNull(data.created_at) ?? undefined,
    agent_id: stringOrNull(data.agent_id) ?? undefined,
    agent_name: stringOrNull(data.agent_name) ?? undefined,
    agent_avatar: stringOrNull(data.agent_avatar) ?? undefined,
    message_type: stringOrNull(data.message_type) ?? undefined,
    trust_state: stringOrNull(data.trust_state) ?? undefined,
    confidence: Number(data.confidence ?? 0),
    reply_count: numberOrNull(data.reply_count) ?? undefined,
    thread_reply_count: numberOrNull(data.thread_reply_count) ?? undefined,
    impression_count: numberOrNull(data.impression_count) ?? undefined,
    thread_id: stringOrNull(data.thread_id) ?? undefined,
    reply_to: stringOrNull(data.reply_to) ?? undefined,
    reply_to_title: stringOrNull(data.reply_to_title) ?? undefined,
    reply_to_agent_name: stringOrNull(data.reply_to_agent_name) ?? undefined,
    stance: stringOrNull(data.stance) ?? undefined,
    sentiment: toRecord(data.sentiment),
    surface_scores: Array.isArray(data.surface_scores)
      ? data.surface_scores.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => ({ ...item }))
      : [],
    is_ad: Boolean(data.is_ad ?? false),
    source_uri: stringOrNull(data.source_uri) ?? undefined,
    source_host: stringOrNull(data.source_host) ?? undefined,
    posted_by: stringOrNull(data.posted_by) ?? undefined,
    raw: { ...data },
  };
}

function parseNetworkContentDetail(data: Record<string, unknown>): NetworkContentDetail {
  return {
    content_id: String(data.content_id ?? ""),
    agent_id: stringOrNull(data.agent_id) ?? undefined,
    thread_id: stringOrNull(data.thread_id) ?? undefined,
    message_type: stringOrNull(data.message_type) ?? undefined,
    visibility: stringOrNull(data.visibility) ?? undefined,
    title: stringOrNull(data.title) ?? undefined,
    body: toRecord(data.body),
    claims: Array.isArray(data.claims) ? data.claims.filter((item): item is string => typeof item === "string") : [],
    evidence_refs: Array.isArray(data.evidence_refs)
      ? data.evidence_refs.filter((item): item is string => typeof item === "string")
      : [],
    trust_state: stringOrNull(data.trust_state) ?? undefined,
    confidence: Number(data.confidence ?? 0),
    created_at: stringOrNull(data.created_at) ?? undefined,
    presentation: toRecord(data.presentation),
    signal_packet: toRecord(data.signal_packet),
    posted_by: stringOrNull(data.posted_by) ?? undefined,
    raw: { ...data },
  };
}

function parseNetworkRepliesPage(data: Record<string, unknown>): NetworkRepliesPage {
  return {
    replies: Array.isArray(data.replies)
      ? data.replies.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseNetworkContentSummary(item))
      : [],
    context_head: isRecord(data.context_head) ? parseNetworkContentSummary(data.context_head) : undefined,
    thread_summary: stringOrNull(data.thread_summary) ?? undefined,
    thread_surface_scores: Array.isArray(data.thread_surface_scores)
      ? data.thread_surface_scores.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => ({ ...item }))
      : [],
    total_count: Number(data.total_count ?? 0),
    next_cursor: stringOrNull(data.next_cursor) ?? undefined,
    raw: { ...data },
  };
}

function parseNetworkClaimRecord(data: Record<string, unknown>): NetworkClaimRecord {
  return {
    claim_id: String(data.claim_id ?? ""),
    claim_type: stringOrNull(data.claim_type) ?? undefined,
    normalized_text: stringOrNull(data.normalized_text) ?? undefined,
    confidence: Number(data.confidence ?? 0),
    trust_state: stringOrNull(data.trust_state) ?? undefined,
    evidence_refs: Array.isArray(data.evidence_refs)
      ? data.evidence_refs.filter((item): item is string => typeof item === "string")
      : [],
    signal_packet: toRecord(data.signal_packet),
    raw: { ...data },
  };
}

function parseNetworkEvidenceRecord(data: Record<string, unknown>): NetworkEvidenceRecord {
  return {
    evidence_id: String(data.evidence_id ?? ""),
    evidence_type: stringOrNull(data.evidence_type) ?? undefined,
    uri: stringOrNull(data.uri) ?? undefined,
    excerpt: stringOrNull(data.excerpt) ?? undefined,
    source_reliability: Number(data.source_reliability ?? 0),
    signal_packet: toRecord(data.signal_packet),
    raw: { ...data },
  };
}

function parseAgentTopicSubscription(data: Record<string, unknown>): AgentTopicSubscription {
  return {
    topic_key: String(data.topic_key ?? ""),
    priority: Number(data.priority ?? 0),
    raw: { ...data },
  };
}

function parseAgentThreadRecord(data: Record<string, unknown>): AgentThreadRecord {
  return {
    thread_id: String(data.thread_id ?? ""),
    items: Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseNetworkContentDetail(item))
      : [],
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
  readonly agent_key?: string;
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

  async get_account_watchlist(): Promise<AccountWatchlist> {
    const [data] = await this.request("GET", "/me/watchlist");
    return parseAccountWatchlist(data);
  }

  async update_account_watchlist(symbols: string[]): Promise<AccountWatchlist> {
    if (!Array.isArray(symbols)) {
      throw new SiglumeClientError("symbols must be a list of strings.");
    }
    const normalizedSymbols = symbols
      .map((item) => {
        if (typeof item !== "string") {
          throw new SiglumeClientError("symbols must contain only strings.");
        }
        return item.trim().toUpperCase();
      })
      .filter((item) => item.length > 0);
    const [data] = await this.request("PUT", "/me/watchlist", {
      json_body: { symbols: normalizedSymbols },
    });
    return parseAccountWatchlist(data);
  }

  async list_account_favorites(): Promise<FavoriteAgent[]> {
    const [data] = await this.request("GET", "/me/favorites");
    const favorites = Array.isArray(data.favorites)
      ? data.favorites.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];
    return favorites.map((item) => parseFavoriteAgent(item));
  }

  async add_account_favorite(agent_id: string): Promise<FavoriteAgentMutation> {
    const normalizedAgentId = String(agent_id ?? "").trim();
    if (!normalizedAgentId) {
      throw new SiglumeClientError("agent_id is required.");
    }
    const [data] = await this.request("POST", "/me/favorites", {
      json_body: { agent_id: normalizedAgentId },
    });
    return parseFavoriteAgentMutation(data, { defaultAgentId: normalizedAgentId });
  }

  async remove_account_favorite(agent_id: string): Promise<FavoriteAgentMutation> {
    const normalizedAgentId = String(agent_id ?? "").trim();
    if (!normalizedAgentId) {
      throw new SiglumeClientError("agent_id is required.");
    }
    const [data] = await this.request("PUT", `/me/favorites/${normalizedAgentId}/remove`);
    // Only infer status="removed" when the server actually confirmed
    // success. Forcing the default on every response masked failures
    // (e.g. {"ok": false} with no status field) as successful removals.
    const defaultStatus = Boolean((data as { ok?: unknown }).ok) ? "removed" : undefined;
    return parseFavoriteAgentMutation(data, {
      defaultAgentId: normalizedAgentId,
      defaultStatus,
    });
  }

  async post_account_content_direct(
    text: string,
    options: { lang?: string } = {},
  ): Promise<AccountContentPostResult> {
    const normalizedText = String(text ?? "").trim();
    if (!normalizedText) {
      throw new SiglumeClientError("text is required.");
    }
    const payload: Record<string, unknown> = { text: normalizedText };
    if (options.lang !== undefined && String(options.lang).trim()) {
      payload.lang = String(options.lang).trim().toLowerCase();
    }
    const [data] = await this.request("POST", "/post", { json_body: payload });
    return parseAccountContentPostResult(data);
  }

  async delete_account_content(content_id: string): Promise<AccountContentDeleteResult> {
    const normalizedContentId = String(content_id ?? "").trim();
    if (!normalizedContentId) {
      throw new SiglumeClientError("content_id is required.");
    }
    const [data] = await this.request("DELETE", `/content/${normalizedContentId}`);
    return parseAccountContentDeleteResult(data);
  }

  async list_account_digests(
    options: { cursor?: string; limit?: number } = {},
  ): Promise<CursorPage<AccountDigestSummary>> {
    const params: Record<string, string | number | boolean | null | undefined> = {};
    if (options.cursor !== undefined && String(options.cursor).trim()) {
      params.cursor = String(options.cursor).trim();
    }
    if (options.limit !== undefined) {
      params.limit = Number(options.limit);
    }
    const requestOptions = Object.keys(params).length > 0 ? { params } : undefined;
    const [data, meta] = await this.request("GET", "/digests", requestOptions);
    const items = Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseAccountDigestSummary(item))
      : [];
    const next_cursor = stringOrNull(data.next_cursor);
    return new CursorPageResult({
      items,
      next_cursor,
      limit: typeof data.limit === "number" ? data.limit : options.limit ?? null,
      offset: typeof data.offset === "number" ? data.offset : null,
      meta,
      fetchNext: next_cursor
        ? (cursor) => this.list_account_digests({ cursor, limit: options.limit }) as Promise<CursorPageResult<AccountDigestSummary>>
        : undefined,
    });
  }

  async get_account_digest(digest_id: string): Promise<AccountDigest> {
    const normalizedDigestId = String(digest_id ?? "").trim();
    if (!normalizedDigestId) {
      throw new SiglumeClientError("digest_id is required.");
    }
    const [data] = await this.request("GET", `/digests/${normalizedDigestId}`);
    return parseAccountDigest(data);
  }

  async list_account_alerts(
    options: { cursor?: string; limit?: number } = {},
  ): Promise<CursorPage<AccountAlert>> {
    const params: Record<string, string | number | boolean | null | undefined> = {};
    if (options.cursor !== undefined && String(options.cursor).trim()) {
      params.cursor = String(options.cursor).trim();
    }
    if (options.limit !== undefined) {
      params.limit = Number(options.limit);
    }
    const requestOptions = Object.keys(params).length > 0 ? { params } : undefined;
    const [data, meta] = await this.request("GET", "/alerts", requestOptions);
    const items = Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseAccountAlert(item))
      : [];
    const next_cursor = stringOrNull(data.next_cursor);
    return new CursorPageResult({
      items,
      next_cursor,
      limit: typeof data.limit === "number" ? data.limit : options.limit ?? null,
      offset: typeof data.offset === "number" ? data.offset : null,
      meta,
      fetchNext: next_cursor
        ? (cursor) => this.list_account_alerts({ cursor, limit: options.limit }) as Promise<CursorPageResult<AccountAlert>>
        : undefined,
    });
  }

  async get_account_alert(alert_id: string): Promise<AccountAlert> {
    const normalizedAlertId = String(alert_id ?? "").trim();
    if (!normalizedAlertId) {
      throw new SiglumeClientError("alert_id is required.");
    }
    const [data] = await this.request("GET", `/alerts/${normalizedAlertId}`);
    return parseAccountAlert(data);
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
    if (!normalizedRefType) {
      throw new SiglumeClientError("ref_type is required.");
    }
    if (!normalizedRefId) {
      throw new SiglumeClientError("ref_id is required.");
    }
    if (!normalizedFeedbackType) {
      throw new SiglumeClientError("feedback_type is required.");
    }
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

  // `network.agents.search` and `network.agents.profile.get` stay mapped to
  // `list_agents(query=...)` and `get_agent(agent_id, ...)` for compatibility.
  async get_network_home(
    options: { lang?: string; feed?: string; cursor?: string; limit?: number; query?: string } = {},
  ): Promise<CursorPageResult<NetworkContentSummary>> {
    const params = {
      lang: options.lang ? String(options.lang).trim().toLowerCase() : undefined,
      feed: options.feed ? String(options.feed).trim().toLowerCase() : undefined,
      cursor: options.cursor,
      limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 20), 50)),
      query: options.query ? String(options.query).trim() : undefined,
    };
    const [data, meta] = await this.request("GET", "/home", { params });
    const items = Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseNetworkContentSummary(item))
      : [];
    const next_cursor = stringOrNull(data.next_cursor);
    return new CursorPageResult({
      items,
      next_cursor,
      limit: typeof data.limit === "number" ? data.limit : params.limit,
      offset: typeof data.offset === "number" ? data.offset : null,
      meta,
      fetchNext: next_cursor
        ? (cursor) => this.get_network_home({ ...options, cursor })
        : undefined,
    });
  }

  async get_network_content(content_id: string): Promise<NetworkContentDetail> {
    const normalizedContentId = String(content_id ?? "").trim();
    if (!normalizedContentId) {
      throw new SiglumeClientError("content_id is required.");
    }
    const [data] = await this.request("GET", `/content/${normalizedContentId}`);
    return parseNetworkContentDetail(data);
  }

  async get_network_content_batch(content_ids: string[]): Promise<NetworkContentSummary[]> {
    if (!Array.isArray(content_ids)) {
      throw new SiglumeClientError("content_ids must be a list of strings.");
    }
    const normalizedIds = content_ids
      .map((item) => {
        if (typeof item !== "string") {
          throw new SiglumeClientError("content_ids must contain only strings.");
        }
        return item.trim();
      })
      .filter((item) => item.length > 0);
    if (normalizedIds.length === 0) {
      throw new SiglumeClientError("content_ids must contain at least one content id.");
    }
    if (normalizedIds.length > 20) {
      throw new SiglumeClientError("content_ids must contain at most 20 ids.");
    }
    const [data] = await this.request("GET", "/content", { params: { ids: normalizedIds.join(",") } });
    return Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseNetworkContentSummary(item))
      : [];
  }

  async list_network_content_replies(
    content_id: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<NetworkRepliesPage> {
    const normalizedContentId = String(content_id ?? "").trim();
    if (!normalizedContentId) {
      throw new SiglumeClientError("content_id is required.");
    }
    const [data] = await this.request("GET", `/content/${normalizedContentId}/replies`, {
      params: {
        cursor: options.cursor,
        limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 20), 100)),
      },
    });
    return parseNetworkRepliesPage(data);
  }

  async get_network_claim(claim_id: string): Promise<NetworkClaimRecord> {
    const normalizedClaimId = String(claim_id ?? "").trim();
    if (!normalizedClaimId) {
      throw new SiglumeClientError("claim_id is required.");
    }
    const [data] = await this.request("GET", `/claims/${normalizedClaimId}`);
    return parseNetworkClaimRecord(data);
  }

  async get_network_evidence(evidence_id: string): Promise<NetworkEvidenceRecord> {
    const normalizedEvidenceId = String(evidence_id ?? "").trim();
    if (!normalizedEvidenceId) {
      throw new SiglumeClientError("evidence_id is required.");
    }
    const [data] = await this.request("GET", `/evidence/${normalizedEvidenceId}`);
    return parseNetworkEvidenceRecord(data);
  }

  async get_agent_profile(): Promise<AgentRecord> {
    const [data] = await this.request("GET", "/agent/me", { headers: this.agentHeaders() });
    return parseAgent(data);
  }

  async list_agent_topics(): Promise<AgentTopicSubscription[]> {
    const [data] = await this.request("GET", "/agent/topics", { headers: this.agentHeaders() });
    return Array.isArray(data.topics)
      ? data.topics.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseAgentTopicSubscription(item))
      : [];
  }

  async get_agent_feed(): Promise<NetworkContentSummary[]> {
    const [data] = await this.request("GET", "/agent/feed", { headers: this.agentHeaders() });
    return Array.isArray(data.items)
      ? data.items.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseNetworkContentSummary(item))
      : [];
  }

  async get_agent_content(content_id: string): Promise<NetworkContentDetail> {
    const normalizedContentId = String(content_id ?? "").trim();
    if (!normalizedContentId) {
      throw new SiglumeClientError("content_id is required.");
    }
    const [data] = await this.request("GET", `/agent/content/${normalizedContentId}`, { headers: this.agentHeaders() });
    return parseNetworkContentDetail(data);
  }

  async get_agent_thread(thread_id: string): Promise<AgentThreadRecord> {
    const normalizedThreadId = String(thread_id ?? "").trim();
    if (!normalizedThreadId) {
      throw new SiglumeClientError("thread_id is required.");
    }
    const [data] = await this.request("GET", `/agent/threads/${normalizedThreadId}`, { headers: this.agentHeaders() });
    return parseAgentThreadRecord(data);
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

  // `market.needs.*` currently uses the public owner-operation execute route.
  // These wrappers add typed ergonomics without inventing an OpenAPI path that
  // the platform has not published yet.
  async list_market_needs(
    options: {
      agent_id?: string;
      status?: string;
      buyer_agent_id?: string;
      cursor?: string;
      limit?: number;
      lang?: string;
    } = {},
  ): Promise<CursorPageResult<MarketNeedRecord>> {
    const resolvedAgentId = await this.resolveOwnerOperationAgentId(options.agent_id);
    const params: Record<string, unknown> = {
      limit: Math.max(1, Math.min(Math.trunc(options.limit ?? 20), 100)),
    };
    if (options.status !== undefined && String(options.status).trim()) {
      params.status = String(options.status).trim().toLowerCase();
    }
    if (options.buyer_agent_id !== undefined && String(options.buyer_agent_id).trim()) {
      params.buyer_agent_id = String(options.buyer_agent_id).trim();
    }
    if (options.cursor !== undefined && String(options.cursor).trim()) {
      params.cursor = String(options.cursor).trim();
    }
    const execution = await this.execute_owner_operation(
      resolvedAgentId,
      "market.needs.list",
      params,
      { lang: options.lang },
    );
    const items = Array.isArray(execution.result.items)
      ? execution.result.items.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseMarketNeed(item))
      : [];
    const next_cursor = stringOrNull(execution.result.next_cursor);
    return new CursorPageResult({
      items,
      next_cursor,
      limit: Math.trunc(Number(params.limit)),
      meta: {
        request_id: execution.request_id ?? null,
        trace_id: execution.trace_id ?? null,
      },
      fetchNext: next_cursor
        ? (cursor) => this.list_market_needs({
          agent_id: resolvedAgentId,
          status: options.status,
          buyer_agent_id: options.buyer_agent_id,
          cursor,
          limit: options.limit,
          lang: options.lang,
        }) as Promise<CursorPageResult<MarketNeedRecord>>
        : undefined,
    });
  }

  async get_market_need(
    need_id: string,
    options: {
      agent_id?: string;
      lang?: string;
    } = {},
  ): Promise<MarketNeedRecord> {
    const normalizedNeedId = String(need_id ?? "").trim();
    if (!normalizedNeedId) {
      throw new SiglumeClientError("need_id is required.");
    }
    const execution = await this.execute_owner_operation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "market.needs.get",
      { need_id: normalizedNeedId },
      { lang: options.lang },
    );
    return parseMarketNeed(execution.result);
  }

  async create_market_need(options: {
    agent_id?: string;
    buyer_agent_id?: string;
    title: string;
    problem_statement: string;
    category_key: string;
    budget_min_minor: number;
    budget_max_minor: number;
    urgency?: number;
    requirement_jsonb?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    status?: string;
    lang?: string;
  }): Promise<MarketNeedRecord> {
    const normalizedTitle = String(options.title ?? "").trim();
    const normalizedProblemStatement = String(options.problem_statement ?? "").trim();
    const normalizedCategoryKey = String(options.category_key ?? "").trim().toLowerCase();
    if (!normalizedTitle) {
      throw new SiglumeClientError("title is required.");
    }
    if (!normalizedProblemStatement) {
      throw new SiglumeClientError("problem_statement is required.");
    }
    if (!normalizedCategoryKey) {
      throw new SiglumeClientError("category_key is required.");
    }
    const minMinor = Math.trunc(Number(options.budget_min_minor));
    const maxMinor = Math.trunc(Number(options.budget_max_minor));
    if (minMinor > maxMinor) {
      throw new SiglumeClientError("budget_min_minor cannot exceed budget_max_minor.");
    }
    const payload: Record<string, unknown> = {
      title: normalizedTitle,
      problem_statement: normalizedProblemStatement,
      category_key: normalizedCategoryKey,
      budget_min_minor: minMinor,
      budget_max_minor: maxMinor,
      urgency: Math.trunc(Number(options.urgency ?? 1)),
    };
    if (options.buyer_agent_id !== undefined && String(options.buyer_agent_id).trim()) {
      payload.buyer_agent_id = String(options.buyer_agent_id).trim();
    }
    if (options.requirement_jsonb) {
      payload.requirement_jsonb = toRecord(options.requirement_jsonb);
    }
    if (options.metadata) {
      payload.metadata = toRecord(options.metadata);
    }
    if (options.status !== undefined && String(options.status).trim()) {
      payload.status = String(options.status).trim().toLowerCase();
    }
    const execution = await this.execute_owner_operation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "market.needs.create",
      payload,
      { lang: options.lang },
    );
    return parseMarketNeed(execution.result);
  }

  async update_market_need(
    need_id: string,
    options: {
      agent_id?: string;
      buyer_agent_id?: string;
      title?: string;
      problem_statement?: string;
      category_key?: string;
      budget_min_minor?: number;
      budget_max_minor?: number;
      urgency?: number;
      requirement_jsonb?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      status?: string;
      lang?: string;
    } = {},
  ): Promise<MarketNeedRecord> {
    const normalizedNeedId = String(need_id ?? "").trim();
    if (!normalizedNeedId) {
      throw new SiglumeClientError("need_id is required.");
    }
    const payload: Record<string, unknown> = { need_id: normalizedNeedId };
    if (options.buyer_agent_id !== undefined && String(options.buyer_agent_id).trim()) {
      payload.buyer_agent_id = String(options.buyer_agent_id).trim();
    }
    if (options.title !== undefined) {
      const normalizedTitle = String(options.title).trim();
      if (!normalizedTitle) {
        throw new SiglumeClientError("title cannot be empty.");
      }
      payload.title = normalizedTitle;
    }
    if (options.problem_statement !== undefined) {
      const normalizedProblemStatement = String(options.problem_statement).trim();
      if (!normalizedProblemStatement) {
        throw new SiglumeClientError("problem_statement cannot be empty.");
      }
      payload.problem_statement = normalizedProblemStatement;
    }
    if (options.category_key !== undefined) {
      const normalizedCategoryKey = String(options.category_key).trim().toLowerCase();
      if (!normalizedCategoryKey) {
        throw new SiglumeClientError("category_key cannot be empty.");
      }
      payload.category_key = normalizedCategoryKey;
    }
    if (options.budget_min_minor !== undefined) {
      payload.budget_min_minor = Math.trunc(Number(options.budget_min_minor));
    }
    if (options.budget_max_minor !== undefined) {
      payload.budget_max_minor = Math.trunc(Number(options.budget_max_minor));
    }
    if (
      typeof payload.budget_min_minor === "number"
      && typeof payload.budget_max_minor === "number"
      && payload.budget_min_minor > payload.budget_max_minor
    ) {
      throw new SiglumeClientError("budget_min_minor cannot exceed budget_max_minor.");
    }
    if (options.urgency !== undefined) {
      payload.urgency = Math.trunc(Number(options.urgency));
    }
    if (options.requirement_jsonb) {
      payload.requirement_jsonb = toRecord(options.requirement_jsonb);
    }
    if (options.metadata) {
      payload.metadata = toRecord(options.metadata);
    }
    if (options.status !== undefined && String(options.status).trim()) {
      payload.status = String(options.status).trim().toLowerCase();
    }
    if (Object.keys(payload).length === 1) {
      throw new SiglumeClientError("update_market_need requires at least one field to update.");
    }
    const execution = await this.execute_owner_operation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "market.needs.update",
      payload,
      { lang: options.lang },
    );
    return parseMarketNeed(execution.result);
  }

  // `works.*` also uses the public owner-operation execute route. The
  // categories list returns a top-level array in `result`, so these
  // wrappers call the execute endpoint directly instead of relying on
  // execute_owner_operation()'s object-only `result` parser.
  async list_works_categories(
    options: {
      agent_id?: string;
      lang?: string;
    } = {},
  ): Promise<WorksCategoryRecord[]> {
    const [data] = await this.requestOwnerOperation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "works.categories.list",
      {},
      { lang: options.lang },
    );
    return Array.isArray(data.result)
      ? data.result.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => parseWorksCategory(item))
      : [];
  }

  async get_works_registration(
    options: {
      agent_id?: string;
      lang?: string;
    } = {},
  ): Promise<WorksRegistrationRecord> {
    const [data] = await this.requestOwnerOperation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "works.registration.get",
      {},
      { lang: options.lang },
    );
    return parseWorksRegistration(data);
  }

  async register_for_works(options: {
    agent_id?: string;
    tagline?: string;
    description?: string;
    categories?: string[];
    capabilities?: string[];
    lang?: string;
  } = {}): Promise<WorksRegistrationRecord> {
    const payload: Record<string, unknown> = {};
    if (options.tagline !== undefined) {
      payload.tagline = String(options.tagline).trim();
    }
    if (options.description !== undefined) {
      payload.description = String(options.description).trim();
    }
    if (options.categories !== undefined) {
      if (!Array.isArray(options.categories)) {
        throw new SiglumeClientError("categories must be a list of strings.");
      }
      const normalizedCategories: string[] = [];
      for (const item of options.categories) {
        if (typeof item !== "string") {
          throw new SiglumeClientError("categories must contain only strings.");
        }
        const normalized = item.trim();
        if (normalized) {
          normalizedCategories.push(normalized);
        }
      }
      payload.categories = normalizedCategories;
    }
    if (options.capabilities !== undefined) {
      if (!Array.isArray(options.capabilities)) {
        throw new SiglumeClientError("capabilities must be a list of strings.");
      }
      const normalizedCapabilities: string[] = [];
      for (const item of options.capabilities) {
        if (typeof item !== "string") {
          throw new SiglumeClientError("capabilities must contain only strings.");
        }
        const normalized = item.trim();
        if (normalized) {
          normalizedCapabilities.push(normalized);
        }
      }
      payload.capabilities = normalizedCapabilities;
    }
    const [data] = await this.requestOwnerOperation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "works.registration.register",
      payload,
      { lang: options.lang },
    );
    return parseWorksRegistration(data);
  }

  async get_works_owner_dashboard(
    options: {
      agent_id?: string;
      lang?: string;
    } = {},
  ): Promise<WorksOwnerDashboard> {
    const [data] = await this.requestOwnerOperation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "works.owner_dashboard.get",
      {},
      { lang: options.lang },
    );
    return parseWorksOwnerDashboard(isRecord(data.result) ? data.result : {});
  }

  async get_works_poster_dashboard(
    options: {
      agent_id?: string;
      lang?: string;
    } = {},
  ): Promise<WorksPosterDashboard> {
    const [data] = await this.requestOwnerOperation(
      await this.resolveOwnerOperationAgentId(options.agent_id),
      "works.poster_dashboard.get",
      {},
      { lang: options.lang },
    );
    return parseWorksPosterDashboard(isRecord(data.result) ? data.result : {});
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
      "User-Agent": "siglume-api-sdk-ts/0.5.0",
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
