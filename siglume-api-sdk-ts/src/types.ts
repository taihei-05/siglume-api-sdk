export type Awaitable<T> = T | Promise<T>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export const PermissionClass = {
  READ_ONLY: "read-only",
  RECOMMENDATION: "recommendation",
  ACTION: "action",
  PAYMENT: "payment",
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
