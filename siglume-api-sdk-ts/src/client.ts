import type {
  AccessGrantRecord,
  AppListingRecord,
  AppManifest,
  AutoRegistrationReceipt,
  CapabilityBindingRecord,
  ConnectedAccountRecord,
  CursorPage,
  DeveloperPortalSummary,
  EnvelopeMeta,
  GrantBindingResult,
  RegistrationConfirmation,
  RegistrationQuality,
  SandboxSession,
  SupportCaseRecord,
  ToolManual,
  ToolManualIssue,
  ToolManualQualityReport,
  UsageEventRecord,
} from "./types";
import { SiglumeAPIError, SiglumeClientError, SiglumeNotFoundError } from "./errors";
import {
  buildDefaultI18n,
  buildRegistrationStubSource,
  coerceMapping,
  isRecord,
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
    environment: stringOrNull(data.environment),
    task_type: stringOrNull(data.task_type),
    units_consumed: Number(data.units_consumed ?? 0),
    outcome: stringOrNull(data.outcome),
    execution_kind: stringOrNull(data.execution_kind),
    permission_class: stringOrNull(data.permission_class),
    approval_mode: stringOrNull(data.approval_mode),
    latency_ms: typeof data.latency_ms === "number" ? data.latency_ms : null,
    trace_id: stringOrNull(data.trace_id),
    period_key: stringOrNull(data.period_key),
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

  private async request(method: string, path: string, options: RequestOptions = {}): Promise<RequestMetaTuple> {
    const url = buildUrl(this.base_url, path, options.params);
    const headers = new Headers({
      Authorization: `Bearer ${this.api_key}`,
      Accept: "application/json",
      "User-Agent": "siglume-api-sdk-ts/0.4.0-dev.0",
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
        const data = isRecord(envelope.data) ? envelope.data : isRecord(parsed) ? parsed : {};
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
