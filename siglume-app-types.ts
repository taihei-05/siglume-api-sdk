/**
 * Siglume Agent App SDK — TypeScript type definitions
 * For app developers building frontend components or client-side integrations.
 */

export type PermissionClass = "read-only" | "recommendation" | "action" | "payment";
export type ApprovalMode = "auto" | "budget-bounded" | "always-ask" | "deny";
export type ExecutionKind = "dry_run" | "quote" | "action" | "payment";
export type Environment = "sandbox" | "live";
export type PriceModel = "free" | "subscription" | "one_time" | "bundle" | "usage_based" | "per_action";
export type AppCategory = "commerce" | "booking" | "crm" | "finance" | "document" | "communication" | "monitoring" | "other";

export interface ConnectedAccountRef {
  provider_key: string;
  session_token: string; // short-lived, scoped token managed by Siglume
  scopes: string[];
  environment: Environment;
}

export interface AppManifest {
  capability_key: string;
  version: string;
  name: string;
  job_to_be_done: string;
  category: AppCategory;
  permission_class: PermissionClass;
  approval_mode: ApprovalMode;
  dry_run_supported: boolean;
  required_connected_accounts: string[];
  permission_scopes: string[];
  price_model: PriceModel;
  price_value_minor: number;
  currency: string;
  short_description: string;
  docs_url: string;
  support_contact: string;
  compatibility_tags: string[];
  example_prompts: string[];
  latency_tier?: string;
}

export interface ExecutionContext {
  agent_id: string;
  owner_user_id: string;
  task_type: string;
  input_params: Record<string, unknown>; // The actual query/request from the agent (e.g., "find flights to Tokyo")
  source_type?: string;
  environment: Environment;
  execution_kind: ExecutionKind;
  connected_accounts: Record<string, ConnectedAccountRef>;
  budget_remaining_minor?: number;
  trace_id?: string;
  idempotency_key?: string;
  request_hash?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionResult {
  success: boolean;
  output: Record<string, unknown>;
  execution_kind: ExecutionKind;
  units_consumed: number;
  amount_minor: number;
  currency: string;
  provider_status: string;
  error_message?: string;
  fallback_applied: boolean;
  needs_approval: boolean;
  approval_prompt?: string;
  receipt_summary: Record<string, unknown>;
}

export interface CapabilityListing {
  id: string;
  capability_key: string;
  name: string;
  job_to_be_done?: string;
  category: string;
  permission_class?: PermissionClass;
  approval_mode?: ApprovalMode;
  dry_run_supported: boolean;
  price_model: PriceModel;
  price_value_minor: number;
  currency: string;
  status: string;
  short_description?: string;
  docs_url?: string;
}

export interface AccessGrant {
  id: string;
  owner_user_id: string;
  capability_listing_id: string;
  grant_status: string;
  billing_model: string;
  usage_limit_jsonb: Record<string, unknown>;
  starts_at?: string;
  ends_at?: string;
}

export interface CapabilityBinding {
  id: string;
  access_grant_id: string;
  agent_id: string;
  binding_status: string;
  created_by_user_id?: string;
}

// ── Tool Manual Types ──
// Machine-readable contract describing when/how an LLM should invoke an API.

/**
 * Permission classes valid inside a tool manual.
 * Uses underscores (read_only) — differs from AppManifest which uses hyphens (read-only).
 * The "recommendation" tier is not applicable to tool manuals.
 */
export type ToolManualPermissionClass = "read_only" | "action" | "payment";

export type SettlementMode = "stripe_checkout" | "stripe_payment_intent";

export interface ToolManual {
  // Required (all permission classes)
  tool_name: string;                          // 3-64 chars, [A-Za-z0-9_]
  job_to_be_done: string;                     // 10-500 chars
  summary_for_model: string;                  // 10-300 chars, factual
  trigger_conditions: string[];               // 3-8 items, 10-200 chars each
  do_not_use_when: string[];                  // 1-5 items
  permission_class: ToolManualPermissionClass;
  dry_run_supported: boolean;
  requires_connected_accounts: string[];
  input_schema: Record<string, unknown>;      // JSON Schema (type=object)
  output_schema: Record<string, unknown>;     // must include "summary" property
  usage_hints: string[];
  result_hints: string[];
  error_hints: string[];

  // Required for action / payment
  approval_summary_template?: string;
  preview_schema?: Record<string, unknown>;
  idempotency_support?: boolean;              // must be true for action/payment
  side_effect_summary?: string;

  // Required for payment only
  quote_schema?: Record<string, unknown>;
  currency?: string;                          // must be "USD"
  settlement_mode?: SettlementMode;
  refund_or_cancellation_note?: string;
}

export type ToolManualIssueSeverity = "error" | "warning" | "critical" | "suggestion";

export interface ToolManualIssue {
  code: string;
  message: string;
  field?: string;
  severity: ToolManualIssueSeverity;
  suggestion?: string;
}

export type ToolManualGrade = "A" | "B" | "C" | "D" | "F";

export interface ToolManualQualityReport {
  overall_score: number;                      // 0-100
  grade: ToolManualGrade;
  issues: ToolManualIssue[];
  keyword_coverage_estimate: number;
  improvement_suggestions: string[];
}
