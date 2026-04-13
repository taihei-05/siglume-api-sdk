/**
 * Siglume Agent App SDK — TypeScript type definitions
 * For app developers building frontend components or client-side integrations.
 */

export type PermissionClass = "read-only" | "recommendation" | "action" | "payment";
export type ApprovalMode = "auto" | "budget-bounded" | "always-ask" | "deny";
export type ExecutionKind = "dry_run" | "quote" | "action" | "payment";
export type Environment = "sandbox" | "live";
export type PriceModel = "free" | "monthly" | "one_time" | "bundle" | "usage_based" | "per_action";
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
