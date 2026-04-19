import type { ToolManual, ToolManualQualityReport } from "./siglume-api-types";

export interface EnvelopeMeta {
  request_id?: string | null;
  trace_id?: string | null;
}

export interface CursorPage<T> {
  items: T[];
  next_cursor?: string | null;
  limit?: number | null;
  offset?: number | null;
  meta: EnvelopeMeta;
}

export interface AppListingRecord {
  listing_id: string;
  capability_key: string;
  name: string;
  status: string;
  category?: string | null;
  job_to_be_done?: string | null;
  permission_class?: string | null;
  approval_mode?: string | null;
  dry_run_supported: boolean;
  price_model?: string | null;
  price_value_minor: number;
  currency: string;
  short_description?: string | null;
  docs_url?: string | null;
  support_contact?: string | null;
  review_status?: string | null;
  review_note?: string | null;
  submission_blockers: string[];
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface AutoRegistrationReceipt {
  listing_id: string;
  status: string;
  auto_manifest: Record<string, unknown>;
  confidence: Record<string, unknown>;
  review_url?: string | null;
  trace_id?: string | null;
  request_id?: string | null;
}

export interface RegistrationQuality {
  overall_score: number;
  grade: string;
  issues: Array<Record<string, unknown>>;
  improvement_suggestions: string[];
  raw: Record<string, unknown>;
}

export interface RegistrationConfirmation {
  listing_id: string;
  status: string;
  release: Record<string, unknown>;
  quality: RegistrationQuality;
  trace_id?: string | null;
  request_id?: string | null;
  raw: Record<string, unknown>;
}

export interface DeveloperPortalSummary {
  seller_onboarding?: Record<string, unknown> | null;
  platform: Record<string, unknown>;
  monetization: Record<string, unknown>;
  payout_readiness: Record<string, unknown>;
  listings: Record<string, unknown>;
  usage: Record<string, unknown>;
  support: Record<string, unknown>;
  apps: AppListingRecord[];
  trace_id?: string | null;
  request_id?: string | null;
  raw: Record<string, unknown>;
}

export interface SandboxSession {
  session_id: string;
  agent_id: string;
  capability_key: string;
  environment: string;
  sandbox_support?: string | null;
  dry_run_supported: boolean;
  approval_mode?: string | null;
  required_connected_accounts: unknown[];
  connected_accounts: Array<Record<string, unknown>>;
  stub_providers_enabled: boolean;
  simulated_receipts: boolean;
  approval_simulator: boolean;
  trace_id?: string | null;
  request_id?: string | null;
  raw: Record<string, unknown>;
}

export interface AccessGrantRecord {
  access_grant_id: string;
  capability_listing_id: string;
  grant_status: string;
  billing_model?: string | null;
  agent_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  bindings: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface CapabilityBindingRecord {
  binding_id: string;
  access_grant_id: string;
  agent_id: string;
  binding_status: string;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface GrantBindingResult {
  binding: CapabilityBindingRecord;
  access_grant: AccessGrantRecord;
  trace_id?: string | null;
  request_id?: string | null;
  raw: Record<string, unknown>;
}

export interface ConnectedAccountRecord {
  connected_account_id: string;
  provider_key: string;
  account_role: string;
  display_name?: string | null;
  environment?: string | null;
  connection_status?: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface UsageEventRecord {
  usage_event_id: string;
  capability_key?: string | null;
  agent_id?: string | null;
  environment?: string | null;
  task_type?: string | null;
  units_consumed: number;
  outcome?: string | null;
  execution_kind?: string | null;
  permission_class?: string | null;
  approval_mode?: string | null;
  latency_ms?: number | null;
  trace_id?: string | null;
  period_key?: string | null;
  created_at?: string | null;
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface SupportCaseRecord {
  support_case_id: string;
  case_type: string;
  summary: string;
  status: string;
  capability_key?: string | null;
  agent_id?: string | null;
  trace_id?: string | null;
  environment?: string | null;
  resolution_note?: string | null;
  metadata: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface WebhookSubscriptionRecord {
  subscription_id: string;
  owner_user_id: string;
  callback_url: string;
  status: string;
  event_types: string[];
  description?: string | null;
  signing_secret_hint?: string | null;
  signing_secret?: string | null;
  metadata: Record<string, unknown>;
  last_delivery_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface WebhookDeliveryRecord {
  delivery_id: string;
  subscription_id: string;
  event_id: string;
  event_type: string;
  idempotency_key: string;
  callback_url: string;
  delivery_status: string;
  request_headers: Record<string, unknown>;
  request_body: Record<string, unknown>;
  response_status?: number | null;
  response_headers: Record<string, unknown>;
  response_body?: unknown;
  duration_ms?: number | null;
  attempt_count: number;
  last_attempt_at?: string | null;
  delivered_at?: string | null;
  error_message?: string | null;
  trace_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface SiglumeClientShape {
  auto_register(...args: unknown[]): Promise<AutoRegistrationReceipt> | AutoRegistrationReceipt;
  confirm_registration(...args: unknown[]): Promise<RegistrationConfirmation> | RegistrationConfirmation;
  preview_quality_score(tool_manual: ToolManual): Promise<ToolManualQualityReport> | ToolManualQualityReport;
  submit_review(listingId: string): Promise<AppListingRecord> | AppListingRecord;
  list_my_listings(...args: unknown[]): Promise<CursorPage<AppListingRecord>> | CursorPage<AppListingRecord>;
  get_listing(listingId: string): Promise<AppListingRecord> | AppListingRecord;
  list_capabilities(...args: unknown[]): Promise<CursorPage<AppListingRecord>> | CursorPage<AppListingRecord>;
  get_developer_portal(): Promise<DeveloperPortalSummary> | DeveloperPortalSummary;
  create_sandbox_session(...args: unknown[]): Promise<SandboxSession> | SandboxSession;
  get_usage(...args: unknown[]): Promise<CursorPage<UsageEventRecord>> | CursorPage<UsageEventRecord>;
  list_access_grants(...args: unknown[]): Promise<CursorPage<AccessGrantRecord>> | CursorPage<AccessGrantRecord>;
  bind_agent_to_grant(...args: unknown[]): Promise<GrantBindingResult> | GrantBindingResult;
  list_connected_accounts(...args: unknown[]): Promise<CursorPage<ConnectedAccountRecord>> | CursorPage<ConnectedAccountRecord>;
  create_support_case(...args: unknown[]): Promise<SupportCaseRecord> | SupportCaseRecord;
  list_support_cases(...args: unknown[]): Promise<CursorPage<SupportCaseRecord>> | CursorPage<SupportCaseRecord>;
  create_webhook_subscription(options: {
    callback_url: string;
    description?: string;
    event_types: string[];
    metadata?: Record<string, unknown>;
  }): Promise<WebhookSubscriptionRecord> | WebhookSubscriptionRecord;
  list_webhook_subscriptions(...args: unknown[]): Promise<WebhookSubscriptionRecord[]> | WebhookSubscriptionRecord[];
  get_webhook_subscription(...args: unknown[]): Promise<WebhookSubscriptionRecord> | WebhookSubscriptionRecord;
  rotate_webhook_subscription_secret(...args: unknown[]): Promise<WebhookSubscriptionRecord> | WebhookSubscriptionRecord;
  pause_webhook_subscription(...args: unknown[]): Promise<WebhookSubscriptionRecord> | WebhookSubscriptionRecord;
  resume_webhook_subscription(...args: unknown[]): Promise<WebhookSubscriptionRecord> | WebhookSubscriptionRecord;
  list_webhook_deliveries(...args: unknown[]): Promise<WebhookDeliveryRecord[]> | WebhookDeliveryRecord[];
  redeliver_webhook_delivery(...args: unknown[]): Promise<WebhookDeliveryRecord> | WebhookDeliveryRecord;
  send_test_webhook_delivery(...args: unknown[]): Promise<Record<string, unknown>> | Record<string, unknown>;
}
