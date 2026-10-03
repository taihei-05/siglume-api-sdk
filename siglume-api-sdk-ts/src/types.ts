import type { SettlementReceipt } from "./web3";

export type Awaitable<T> = T | Promise<T>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * Permission tiers for AppManifest.
 *
 * Supported tiers: READ_ONLY / ACTION / PAYMENT.
 * RECOMMENDATION is a deprecated alias of READ_ONLY retained for backward
 * compatibility; ToolManualPermissionClass has never accepted it and the
 * platform normalizes it to "read-only" at registration. Do not use
 * RECOMMENDATION in new manifests — it will be removed in a future major
 * version.
 */
export const PermissionClass = {
  READ_ONLY: "read-only",
  ACTION: "action",
  PAYMENT: "payment",
  /** @deprecated Use READ_ONLY. Behaves identically. */
  RECOMMENDATION: "recommendation",
} as const;
export type PermissionClass = (typeof PermissionClass)[keyof typeof PermissionClass];

export const ApprovalMode = {
  AUTO: "auto",
  BUDGET_BOUNDED: "budget-bounded",
  ALWAYS_ASK: "always-ask",
  DENY: "deny",
} as const;
export type ApprovalMode = (typeof ApprovalMode)[keyof typeof ApprovalMode];

export const ExecutionKind = {
  DRY_RUN: "dry_run",
  QUOTE: "quote",
  ACTION: "action",
  PAYMENT: "payment",
} as const;
export type ExecutionKind = (typeof ExecutionKind)[keyof typeof ExecutionKind];

export const Environment = {
  SANDBOX: "sandbox",
  LIVE: "live",
} as const;
export type Environment = (typeof Environment)[keyof typeof Environment];

export const PriceModel = {
  FREE: "free",
  SUBSCRIPTION: "subscription",
  ONE_TIME: "one_time",
  BUNDLE: "bundle",
  USAGE_BASED: "usage_based",
  PER_ACTION: "per_action",
} as const;
export type PriceModel = (typeof PriceModel)[keyof typeof PriceModel];
export type BillingTiming = "post" | "prepay";

export const AppCategory = {
  COMMERCE: "commerce",
  BOOKING: "booking",
  CRM: "crm",
  FINANCE: "finance",
  DOCUMENT: "document",
  COMMUNICATION: "communication",
  MONITORING: "monitoring",
  OTHER: "other",
} as const;
export type AppCategory = (typeof AppCategory)[keyof typeof AppCategory];

export const StoreVertical = {
  API: "api",
  GAME: "game",
} as const;
export type StoreVertical = (typeof StoreVertical)[keyof typeof StoreVertical];

export const ListingCurrency = {
  USD: "USD",
  JPY: "JPY",
} as const;
export type ListingCurrency = (typeof ListingCurrency)[keyof typeof ListingCurrency];

export const MINIMUM_JPY_OPERATION_PRICE_MINOR = 15;

export const PersistenceMode = {
  NONE: "none",
  LOCAL: "local",
  PLATFORM: "platform",
  DEVELOPER_SERVER: "developer_server",
} as const;
export type PersistenceMode = (typeof PersistenceMode)[keyof typeof PersistenceMode];

export interface CapabilityPersistencePolicy {
  mode: PersistenceMode;
  schema_version?: string;
  scope?: string;
  restore_required?: boolean;
  max_bytes?: number;
  endpoint?: string | null;
  description?: string;
  /**
   * JSON Schema for persisted game save data.
   * Required when store_vertical is "game" and mode is not "none".
   */
  save_data_schema?: Record<string, unknown>;
}

export interface AppManifest {
  capability_key: string;
  version?: string;
  name: string;
  /** Buyer-facing task summary, max 240 characters. */
  job_to_be_done: string;
  category?: AppCategory;
  permission_class: PermissionClass;
  approval_mode?: ApprovalMode;
  dry_run_supported?: boolean;
  required_connected_accounts?: unknown[];
  permission_scopes?: string[];
  price_model?: PriceModel;
  price_value_minor?: number;
  pricing_plan?: PricingPlan;
  billing_timing?: BillingTiming;
  currency: ListingCurrency;
  allow_free_trial: boolean;
  free_trial_duration_days?: number;
  jurisdiction: string;
  applicable_regulations?: string[];
  data_residency?: string;
  /** Catalog tagline shown on cards and the detail header, max 60 characters. */
  short_description?: string;
  /** Detail-page copy for limits, approval behavior, pricing notes, and expected results, max 1000 characters. */
  description?: string;
  docs_url?: string;
  support_contact?: string;
  seller_homepage_url?: string;
  seller_social_url?: string;
  store_vertical: StoreVertical;
  compatibility_tags?: string[];
  example_prompts?: string[];
  latency_tier?: string;
  persistence?: CapabilityPersistencePolicy;
}

export interface ExecutionContext {
  agent_id: string;
  owner_user_id: string;
  task_type: string;
  input_params?: Record<string, unknown>;
  source_type?: string;
  environment?: Environment;
  execution_kind?: ExecutionKind;
  budget_remaining_minor?: number | null;
  trace_id?: string;
  idempotency_key?: string;
  request_hash?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionArtifact {
  artifact_type: string;
  external_id?: string;
  external_url?: string;
  title?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface SideEffectRecord {
  action: string;
  provider: string;
  external_id?: string;
  reversible?: boolean;
  reversal_hint?: string;
  timestamp_iso?: string;
  metadata?: Record<string, unknown>;
}

export interface ReceiptRef {
  receipt_id: string;
  trace_id?: string;
  intent_id?: string;
}

export interface ApprovalRequestHint {
  action_summary: string;
  permission_class: "action" | "payment";
  estimated_amount_minor?: number;
  currency?: string;
  side_effects?: string[];
  preview?: Record<string, unknown>;
  reversible?: boolean;
}

export interface ExecutionResult {
  success: boolean;
  output?: Record<string, unknown>;
  execution_kind?: ExecutionKind;
  units_consumed?: number;
  amount_minor?: number;
  currency?: string;
  provider_status?: string;
  error_message?: string;
  fallback_applied?: boolean;
  needs_approval?: boolean;
  approval_prompt?: string;
  receipt_summary?: Record<string, unknown>;
  artifacts?: ExecutionArtifact[];
  side_effects?: SideEffectRecord[];
  receipt_ref?: ReceiptRef;
  approval_hint?: ApprovalRequestHint;
}

export const ToolManualPermissionClass = {
  READ_ONLY: "read_only",
  ACTION: "action",
  PAYMENT: "payment",
} as const;
export type ToolManualPermissionClass =
  (typeof ToolManualPermissionClass)[keyof typeof ToolManualPermissionClass];

export const SettlementMode = {
  STRIPE_CHECKOUT: "stripe_checkout",
  STRIPE_PAYMENT_INTENT: "stripe_payment_intent",
  POLYGON_MANDATE: "polygon_mandate",
  EMBEDDED_WALLET_CHARGE: "embedded_wallet_charge",
} as const;
export type SettlementMode = (typeof SettlementMode)[keyof typeof SettlementMode];

export interface ToolManual {
  tool_name: string;
  job_to_be_done: string;
  summary_for_model: string;
  trigger_conditions: string[];
  do_not_use_when: string[];
  permission_class: ToolManualPermissionClass;
  dry_run_supported: boolean;
  requires_connected_accounts: string[];
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  usage_hints: string[];
  result_hints: string[];
  error_hints: string[];
  /**
   * Optional structured capability flags (flat boolean/number/string values,
   * e.g. `{ reply_thread: false, scheduled_one_time: true, images_max: 4 }`)
   * surfaced verbatim on the API Store discovery responses so an agent can
   * judge what a capability can/can't do before binding it.
   */
  supports?: Record<string, boolean | number | string>;
  approval_summary_template?: string;
  preview_schema?: Record<string, unknown>;
  idempotency_support?: boolean;
  side_effect_summary?: string;
  quote_schema?: Record<string, unknown>;
  currency?: string;
  settlement_mode?: SettlementMode;
  refund_or_cancellation_note?: string;
  jurisdiction?: string;
  legal_notes?: string;
}

export type ToolManualIssueSeverity = "error" | "warning" | "critical" | "suggestion";
export type ToolManualGrade = "A" | "B" | "C" | "D" | "F";

export interface ToolManualIssue {
  code: string;
  message: string;
  field?: string;
  severity: ToolManualIssueSeverity;
  suggestion?: string;
}

export interface ToolManualQualityReport {
  overall_score: number;
  grade: ToolManualGrade;
  issues: ToolManualIssue[];
  keyword_coverage_estimate: number;
  improvement_suggestions: string[];
  publishable?: boolean | null;
  validation_ok?: boolean;
  validation_errors?: ToolManualIssue[];
  validation_warnings?: ToolManualIssue[];
}

export interface HealthCheckResult {
  healthy: boolean;
  message?: string;
  provider_status?: Record<string, string>;
}

export interface EnvelopeMeta {
  request_id?: string | null;
  trace_id?: string | null;
}

export interface PricingPlanItem {
  key?: string | null;
  label?: string | null;
  price_minor?: number | null;
  amount_minor?: number | null;
  currency?: string | null;
  unit_label?: string | null;
  description?: string | null;
  conditions?: unknown;
  receipt_code?: string | null;
}

export interface PricingPlan {
  billing_model?: string | null;
  display_name?: string | null;
  summary?: string | null;
  description?: string | null;
  currency?: string | null;
  unit_label?: string | null;
  free_upfront_invocation?: boolean | null;
  fallback_note?: string | null;
  items?: PricingPlanItem[];
}

export interface CursorPage<T> {
  items: T[];
  next_cursor?: string | null;
  limit?: number | null;
  offset?: number | null;
  meta: EnvelopeMeta;
  all_items?: () => Promise<T[]>;
  allItems?: () => Promise<T[]>;
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
  pricing_plan?: PricingPlan | null;
  billing_timing?: BillingTiming | string | null;
  currency: string;
  allow_free_trial: boolean;
  free_trial_duration_days: number;
  short_description?: string | null;
  description?: string | null;
  docs_url?: string | null;
  support_contact?: string | null;
  seller_display_name?: string | null;
  seller_homepage_url?: string | null;
  seller_social_url?: string | null;
  review_status?: string | null;
  review_note?: string | null;
  submission_blockers: string[];
  persistence: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface CapabilitySaveStateRecord {
  capability_key: string;
  save_key: string;
  schema_version: string;
  revision: number;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  checksum?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  exists: boolean;
  raw: Record<string, unknown>;
}

export interface AutoRegistrationReceipt {
  listing_id: string;
  status: string;
  registration_mode?: string | null;
  listing_status?: string | null;
  auto_manifest: Record<string, unknown>;
  confidence: Record<string, unknown>;
  validation_report?: Record<string, unknown>;
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
  visibility?: string | null;
  message?: string | null;
  checklist?: Record<string, boolean>;
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

export interface UsageEventRecord {
  usage_event_id: string;
  capability_key?: string | null;
  agent_id?: string | null;
  dimension?: string | null;
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
  external_id?: string | null;
  occurred_at_iso?: string | null;
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

export interface AgentRecord {
  agent_id: string;
  name: string;
  avatar_url?: string | null;
  description?: string | null;
  agent_type?: string | null;
  status?: string | null;
  expertise: string[];
  paused?: boolean | null;
  style?: string | null;
  manifesto_text?: string | null;
  capabilities: Record<string, unknown>;
  settings: Record<string, unknown>;
  growth: Record<string, unknown>;
  plan: Record<string, unknown>;
  reputation: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface AgentCharter {
  charter_id: string;
  agent_id: string;
  principal_user_id?: string | null;
  version: number;
  active: boolean;
  role: string;
  charter_text?: string | null;
  goals: Record<string, unknown>;
  target_profile: Record<string, unknown>;
  qualification_criteria: Record<string, unknown>;
  success_metrics: Record<string, unknown>;
  constraints: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface ApprovalPolicy {
  approval_policy_id: string;
  agent_id: string;
  principal_user_id?: string | null;
  version: number;
  active: boolean;
  auto_approve_below: Record<string, number>;
  always_require_approval_for: string[];
  deny_if: Record<string, unknown>;
  approval_ttl_minutes: number;
  structured_only: boolean;
  default_requires_approval: boolean;
  merchant_allowlist: string[];
  merchant_denylist: string[];
  category_allowlist: string[];
  category_denylist: string[];
  risk_policy: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface BudgetPolicy {
  budget_id: string;
  agent_id: string;
  principal_user_id?: string | null;
  currency: string;
  period_start?: string | null;
  period_end?: string | null;
  period_limit_minor: number;
  spent_minor: number;
  reserved_minor: number;
  per_order_limit_minor: number;
  auto_approve_below_minor: number;
  limits: Record<string, number>;
  metadata: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface InstalledToolRecord {
  binding_id: string;
  listing_id: string;
  release_id?: string | null;
  display_name?: string | null;
  permission_class?: string | null;
  binding_status?: string | null;
  account_readiness?: string | null;
  settlement_mode?: string | null;
  settlement_currency?: string | null;
  settlement_network?: string | null;
  accepted_payment_tokens: string[];
  last_used_at?: string | null;
  raw: Record<string, unknown>;
}

export interface InstalledToolConnectionReadiness {
  agent_id: string;
  all_ready: boolean;
  bindings: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface InstalledToolBindingPolicyRecord {
  policy_id: string;
  capability_listing_id?: string | null;
  owner_user_id?: string | null;
  permission_class?: string | null;
  max_calls_per_day?: number | null;
  monthly_usage_cap?: number | null;
  max_spend_per_execution?: number | null;
  allowed_tasks_jsonb: string[];
  allowed_source_types_jsonb: string[];
  timeout_ms?: number | null;
  cooldown_seconds?: number | null;
  require_owner_approval: boolean;
  require_owner_approval_over_cost?: number | null;
  dry_run_only: boolean;
  retry_policy_jsonb: Record<string, unknown>;
  fallback_mode?: string | null;
  auto_execute_read_only: boolean;
  allow_background_execution: boolean;
  max_calls_per_hour?: number | null;
  max_chain_steps?: number | null;
  max_parallel_executions: number;
  max_spend_usd_cents_per_day?: number | null;
  approval_mode: string;
  kill_switch_state: string;
  allowed_connected_account_ids_jsonb: string[];
  metadata_jsonb: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface InstalledToolPolicyUpdateResult {
  agent_id: string;
  operation_key: string;
  status: string;
  approval_required: boolean;
  intent_id?: string | null;
  approval_status?: string | null;
  approval_snapshot_hash?: string | null;
  message: string;
  action: Record<string, unknown>;
  preview: Record<string, unknown>;
  safety: Record<string, unknown>;
  policy?: InstalledToolBindingPolicyRecord | null;
  trace_id?: string | null;
  request_id?: string | null;
  raw: Record<string, unknown>;
}

export interface InstalledToolExecutionRecord {
  intent_id: string;
  agent_id: string;
  owner_user_id?: string | null;
  binding_id?: string | null;
  release_id?: string | null;
  source?: string | null;
  goal?: string | null;
  input_payload_jsonb: Record<string, unknown>;
  plan_jsonb: Record<string, unknown>;
  status: string;
  approval_status?: string | null;
  approval_snapshot_hash?: string | null;
  approval_snapshot_jsonb: Record<string, unknown>;
  approval_note?: string | null;
  rejection_reason?: string | null;
  permission_class?: string | null;
  idempotency_key?: string | null;
  trace_id?: string | null;
  error_class?: string | null;
  error_message?: string | null;
  metadata_jsonb: Record<string, unknown>;
  queued_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface InstalledToolReceiptRecord {
  receipt_id: string;
  intent_id: string;
  agent_id: string;
  owner_user_id?: string | null;
  binding_id?: string | null;
  grant_id?: string | null;
  release_ids_jsonb: string[];
  execution_source?: string | null;
  status: string;
  permission_class?: string | null;
  approval_status?: string | null;
  step_count: number;
  total_latency_ms?: number | null;
  total_billable_units: number;
  total_amount_usd_cents?: number | null;
  summary?: string | null;
  failure_reason?: string | null;
  trace_id?: string | null;
  metadata_jsonb: Record<string, unknown>;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  raw: Record<string, unknown>;
}

export interface InstalledToolReceiptStepRecord {
  step_receipt_id: string;
  intent_id: string;
  step_id: string;
  tool_name: string;
  binding_id?: string | null;
  release_id?: string | null;
  dry_run: boolean;
  status: string;
  args_hash?: string | null;
  args_preview_redacted?: string | null;
  output_hash?: string | null;
  output_preview_redacted?: string | null;
  provider_latency_ms?: number | null;
  retry_count: number;
  error_class?: string | null;
  connected_account_ref?: string | null;
  metadata_jsonb: Record<string, unknown>;
  created_at?: string | null;
  raw: Record<string, unknown>;
}

export interface AccountPreferences {
  language?: string | null;
  summary_depth?: string | null;
  notification_mode?: string | null;
  autonomy_level?: string | null;
  interest_profile: Record<string, unknown>;
  consent_policy: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface AccountPlan {
  plan: string;
  display_name?: string | null;
  limits: Record<string, unknown>;
  available_models: Array<Record<string, unknown>>;
  default_model?: string | null;
  selected_model?: string | null;
  subscription_id?: string | null;
  period_end?: string | null;
  cancel_scheduled_at?: string | null;
  cancel_pending: boolean;
  plan_change_scheduled_to?: string | null;
  plan_change_scheduled_at?: string | null;
  plan_change_scheduled_currency?: string | null;
  usage_today: Record<string, unknown>;
  available_plans: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface PlanCheckoutSession {
  checkout_url?: string | null;
  expires_at_iso?: string | null;
  plan?: string | null;
  currency?: string | null;
  customer_id?: string | null;
  raw: Record<string, unknown>;
}

export interface BillingPortalLink {
  portal_url?: string | null;
  expires_at_iso?: string | null;
  raw: Record<string, unknown>;
}

export interface AccountPlanCancellation {
  cancelled: boolean;
  effective_at?: string | null;
  cancel_scheduled_at?: string | null;
  plan?: string | null;
  subscription_id?: string | null;
  rail?: string | null;
  raw: Record<string, unknown>;
}

export interface PlanWeb3Mandate {
  mandate_id: string;
  payment_mandate_id?: string | null;
  principal_user_id?: string | null;
  user_wallet_id?: string | null;
  network: string;
  payee_type?: string | null;
  payee_ref?: string | null;
  fee_recipient_ref?: string | null;
  purpose?: string | null;
  cadence?: string | null;
  token_symbol?: string | null;
  display_currency?: string | null;
  max_amount_minor: number;
  status: string;
  retry_count: number;
  idempotency_key?: string | null;
  last_attempt_at?: string | null;
  next_attempt_at?: string | null;
  canceled_at?: string | null;
  metadata: Record<string, unknown>;
  transaction_request?: Record<string, unknown> | null;
  approve_transaction_request?: Record<string, unknown> | null;
  cancel_transaction_request?: Record<string, unknown> | null;
  chain_receipt?: SettlementReceipt | null;
  raw: Record<string, unknown>;
}

export interface AccountFeedbackSubmission {
  accepted: boolean;
  raw: Record<string, unknown>;
}
