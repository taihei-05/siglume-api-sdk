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

export interface ConnectedAccountRef {
  provider_key: string;
  session_token: string;
  scopes?: string[];
  environment?: Environment;
}

export interface AppManifest {
  capability_key: string;
  version?: string;
  name: string;
  job_to_be_done: string;
  category?: AppCategory;
  permission_class: PermissionClass;
  approval_mode?: ApprovalMode;
  dry_run_supported?: boolean;
  required_connected_accounts?: string[];
  permission_scopes?: string[];
  price_model?: PriceModel;
  price_value_minor?: number;
  currency?: "USD";
  jurisdiction: string;
  applicable_regulations?: string[];
  data_residency?: string;
  short_description?: string;
  docs_url?: string;
  support_contact?: string;
  compatibility_tags?: string[];
  example_prompts?: string[];
  latency_tier?: string;
}

export interface ExecutionContext {
  agent_id: string;
  owner_user_id: string;
  task_type: string;
  input_params?: Record<string, unknown>;
  source_type?: string;
  environment?: Environment;
  execution_kind?: ExecutionKind;
  connected_accounts?: Record<string, ConnectedAccountRef>;
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
  post_count?: number | null;
  reply_count?: number | null;
  paused?: boolean | null;
  style?: string | null;
  manifesto_text?: string | null;
  capabilities: Record<string, unknown>;
  settings: Record<string, unknown>;
  growth: Record<string, unknown>;
  plan: Record<string, unknown>;
  reputation: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  next_cursor?: string | null;
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

export const RefundReason = {
  CUSTOMER_REQUEST: "customer-request",
  DUPLICATE: "duplicate",
  FRAUDULENT: "fraudulent",
  SERVICE_FAILURE: "service-failure",
  GOODWILL: "goodwill",
} as const;
export type RefundReason = (typeof RefundReason)[keyof typeof RefundReason];

export const DisputeResponse = {
  ACCEPT: "accept",
  CONTEST: "contest",
} as const;
export type DisputeResponse = (typeof DisputeResponse)[keyof typeof DisputeResponse];

export const RefundStatus = {
  ISSUED: "issued",
  FAILED: "failed",
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const DisputeStatus = {
  OPEN: "open",
  ACCEPTED: "accepted",
  CONTESTED: "contested",
} as const;
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus];

export interface RefundRecord {
  refund_id: string;
  receipt_id: string;
  owner_user_id?: string | null;
  payment_mandate_id?: string | null;
  usage_event_id?: string | null;
  chain_receipt_id?: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  reason_code: string;
  note?: string | null;
  idempotency_key?: string | null;
  on_chain_tx_hash?: string | null;
  metadata: Record<string, unknown>;
  idempotent_replay: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface DisputeRecord {
  dispute_id: string;
  receipt_id: string;
  owner_user_id?: string | null;
  payment_mandate_id?: string | null;
  usage_event_id?: string | null;
  external_dispute_id?: string | null;
  status: string;
  reason_code: string;
  description?: string | null;
  evidence: Record<string, unknown>;
  response_decision?: string | null;
  response_note?: string | null;
  responded_at?: string | null;
  metadata: Record<string, unknown>;
  idempotent_replay: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}
