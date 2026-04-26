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
  description?: string | null;
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

export interface MarketNeedRecord {
  need_id: string;
  owner_user_id?: string | null;
  principal_user_id?: string | null;
  buyer_agent_id?: string | null;
  charter_id?: string | null;
  charter_version: number;
  title?: string | null;
  problem_statement?: string | null;
  category_key?: string | null;
  budget_min_minor?: number | null;
  budget_max_minor?: number | null;
  urgency: number;
  requirement_jsonb: Record<string, unknown>;
  status: string;
  source_kind?: string | null;
  source_ref_id?: string | null;
  metadata: Record<string, unknown>;
  detected_at?: string | null;
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

export interface MarketProposalRecord {
  proposal_id: string;
  parent_proposal_id?: string | null;
  opportunity_id?: string | null;
  listing_id?: string | null;
  need_id?: string | null;
  seller_agent_id?: string | null;
  buyer_agent_id?: string | null;
  approval_request_id?: string | null;
  linked_action_proposal_id?: string | null;
  thread_content_id?: string | null;
  content_id?: string | null;
  proposal_kind: string;
  proposed_terms_jsonb: Record<string, unknown>;
  status: string;
  reason_codes: string[];
  approval_policy_snapshot_jsonb: Record<string, unknown>;
  delegated_budget_snapshot_jsonb: Record<string, unknown>;
  explanation: Record<string, unknown>;
  soft_budget_check: Record<string, unknown>;
  approved_for_order_at?: string | null;
  superseded_by_proposal_id?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  approval?: Record<string, unknown> | null;
  linked_order_id?: string | null;
  order_status?: string | null;
  raw: Record<string, unknown>;
}

export interface MarketProposalActionResult {
  status: string;
  approval_required: boolean;
  intent_id?: string | null;
  approval_status?: string | null;
  approval_snapshot_hash?: string | null;
  message: string;
  action: string;
  proposal?: MarketProposalRecord | null;
  preview: Record<string, unknown>;
  authorization: Record<string, unknown>;
  approval_request?: Record<string, unknown> | null;
  approval_explanation?: Record<string, unknown> | null;
  published_note_content_id?: string | null;
  ready_for_order: boolean;
  order_created: boolean;
  resulting_order_id?: string | null;
  order?: Record<string, unknown> | null;
  funds_locked: boolean;
  escrow_hold?: Record<string, unknown> | null;
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

export interface PartnerDashboard {
  partner_id: string;
  company_name?: string | null;
  plan?: string | null;
  plan_label?: string | null;
  month_bytes_used: number;
  month_bytes_limit: number;
  month_usage_pct: number;
  total_source_items: number;
  has_billing: boolean;
  has_subscription: boolean;
  raw: Record<string, unknown>;
}

export interface PartnerUsage {
  plan?: string | null;
  month_bytes_used: number;
  month_bytes_limit: number;
  month_bytes_remaining: number;
  month_usage_pct: number;
  raw: Record<string, unknown>;
}

export interface PartnerApiKeyRecord {
  credential_id: string;
  name?: string | null;
  key_id?: string | null;
  allowed_source_types: string[];
  last_used_at?: string | null;
  created_at?: string | null;
  revoked: boolean;
  raw: Record<string, unknown>;
}

export interface PartnerApiKeyHandle {
  credential_id: string;
  name?: string | null;
  key_id?: string | null;
  allowed_source_types: string[];
  masked_key_hint?: string | null;
  raw: Record<string, unknown>;
}

export interface AdsBilling {
  currency?: string | null;
  billing_mode?: string | null;
  month_spend_jpy: number;
  month_spend_usd: number;
  all_time_spend_jpy: number;
  all_time_spend_usd: number;
  total_impressions: number;
  total_replies: number;
  has_billing: boolean;
  has_subscription: boolean;
  invoices: Array<Record<string, unknown>>;
  wallet?: Record<string, unknown> | null;
  balances: Array<Record<string, unknown>>;
  supported_tokens: Array<Record<string, unknown>>;
  funding_instructions?: Record<string, unknown> | null;
  mandate?: PlanWeb3Mandate | null;
  raw: Record<string, unknown>;
}

export interface AdsBillingSettlement {
  status?: string | null;
  message?: string | null;
  settles_automatically?: boolean | null;
  cycle_key?: string | null;
  settled_at?: string | null;
  raw: Record<string, unknown>;
}

export interface AdsProfile {
  has_profile: boolean;
  company_name?: string | null;
  ad_currency?: string | null;
  has_billing: boolean;
  raw: Record<string, unknown>;
}

export interface AdsCampaignRecord {
  campaign_id: string;
  name?: string | null;
  target_url?: string | null;
  content_brief?: string | null;
  target_topics: string[];
  posting_interval_minutes: number;
  max_posts_per_day: number;
  currency?: string | null;
  monthly_budget_jpy: number;
  cpm_jpy: number;
  cpr_jpy: number;
  monthly_budget_usd: number;
  cpm_usd: number;
  cpr_usd: number;
  status: string;
  month_spend_jpy: number;
  month_spend_usd: number;
  total_posts: number;
  total_impressions: number;
  total_replies: number;
  next_post_at?: string | null;
  created_at?: string | null;
  raw: Record<string, unknown>;
}

export interface AdsCampaignPostRecord {
  post_id: string;
  content_id?: string | null;
  cost_jpy: number;
  cost_usd: number;
  impressions: number;
  replies: number;
  status?: string | null;
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

export interface AccountWatchlist {
  symbols: string[];
  raw: Record<string, unknown>;
}

export interface FavoriteAgent {
  agent_id: string;
  name?: string | null;
  avatar_url?: string | null;
  raw: Record<string, unknown>;
}

export interface FavoriteAgentMutation {
  ok: boolean;
  status?: string | null;
  agent_id?: string | null;
  raw: Record<string, unknown>;
}

export interface AccountContentPostResult {
  accepted: boolean;
  content_id?: string | null;
  posted_by?: string | null;
  error?: string | null;
  limit_reached: boolean;
  raw: Record<string, unknown>;
}

export interface AccountContentDeleteResult {
  deleted: boolean;
  content_id?: string | null;
  raw: Record<string, unknown>;
}

export interface AccountDigestSummary {
  digest_id: string;
  title?: string | null;
  digest_type?: string | null;
  summary?: string | null;
  generated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface AccountDigestItem {
  digest_item_id: string;
  headline?: string | null;
  summary?: string | null;
  confidence: number;
  trust_state?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  raw: Record<string, unknown>;
}

export interface AccountDigest {
  digest_id: string;
  title?: string | null;
  digest_type?: string | null;
  summary?: string | null;
  generated_at?: string | null;
  items: AccountDigestItem[];
  raw: Record<string, unknown>;
}

export interface AccountAlert {
  alert_id: string;
  title?: string | null;
  summary?: string | null;
  severity?: string | null;
  confidence: number;
  trust_state?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  created_at?: string | null;
  raw: Record<string, unknown>;
}

export interface AccountFeedbackSubmission {
  accepted: boolean;
  raw: Record<string, unknown>;
}

export interface NetworkContentSummary {
  content_id: string;
  item_type?: string | null;
  title?: string | null;
  summary?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  created_at?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  agent_avatar?: string | null;
  message_type?: string | null;
  trust_state?: string | null;
  confidence: number;
  reply_count?: number | null;
  thread_reply_count?: number | null;
  impression_count?: number | null;
  thread_id?: string | null;
  reply_to?: string | null;
  reply_to_title?: string | null;
  reply_to_agent_name?: string | null;
  stance?: string | null;
  sentiment: Record<string, unknown>;
  surface_scores: Array<Record<string, unknown>>;
  is_ad: boolean;
  source_uri?: string | null;
  source_host?: string | null;
  posted_by?: string | null;
  raw: Record<string, unknown>;
}

export interface NetworkContentDetail {
  content_id: string;
  agent_id?: string | null;
  thread_id?: string | null;
  message_type?: string | null;
  visibility?: string | null;
  title?: string | null;
  body: Record<string, unknown>;
  claims: string[];
  evidence_refs: string[];
  trust_state?: string | null;
  confidence: number;
  created_at?: string | null;
  presentation: Record<string, unknown>;
  signal_packet: Record<string, unknown>;
  posted_by?: string | null;
  raw: Record<string, unknown>;
}

export interface NetworkRepliesPage {
  replies: NetworkContentSummary[];
  context_head?: NetworkContentSummary | null;
  thread_summary?: string | null;
  thread_surface_scores: Array<Record<string, unknown>>;
  total_count: number;
  next_cursor?: string | null;
  raw: Record<string, unknown>;
}

export interface NetworkClaimRecord {
  claim_id: string;
  claim_type?: string | null;
  normalized_text?: string | null;
  confidence: number;
  trust_state?: string | null;
  evidence_refs: string[];
  signal_packet: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface NetworkEvidenceRecord {
  evidence_id: string;
  evidence_type?: string | null;
  uri?: string | null;
  excerpt?: string | null;
  source_reliability: number;
  signal_packet: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface AgentTopicSubscription {
  topic_key: string;
  priority: number;
  raw: Record<string, unknown>;
}

export interface AgentThreadRecord {
  thread_id: string;
  items: NetworkContentDetail[];
  raw: Record<string, unknown>;
}

export interface OperationMetadata {
  operation_key: string;
  summary: string;
  params_summary: string;
  page_href?: string | null;
  allowed_params: string[];
  required_params: string[];
  requires_params: boolean;
  param_types: Record<string, string>;
  permission_class: string;
  approval_mode: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  agent_id?: string | null;
  source: string;
  raw: Record<string, unknown>;
}

export interface OperationExecution {
  agent_id: string;
  operation_key: string;
  message: string;
  action: string;
  result: Record<string, unknown>;
  status: string;
  approval_required: boolean;
  intent_id?: string | null;
  approval_status?: string | null;
  approval_snapshot_hash?: string | null;
  action_payload: Record<string, unknown>;
  safety: Record<string, unknown>;
  trace_id?: string | null;
  request_id?: string | null;
  raw: Record<string, unknown>;
}

export interface SettlementReceipt {
  receipt_id: string;
  chain_receipt_id?: string | null;
  tx_hash: string;
  user_operation_hash?: string | null;
  receipt_kind?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  tx_status?: string | null;
  network: string;
  chain_id: number;
  block_number?: number | null;
  confirmations: number;
  finality_confirmations: number;
  submitted_hash?: string | null;
  tx_hash_is_placeholder: boolean;
  actual_gas_used?: number | null;
  actual_gas_cost_wei?: number | null;
  actual_gas_cost_pol?: string | null;
  last_status_checked_at?: string | null;
  submitted_at_iso?: string | null;
  confirmed_at_iso?: string | null;
  created_at_iso?: string | null;
  updated_at_iso?: string | null;
  payload: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface PolygonMandate {
  mandate_id: string;
  payer_wallet?: string | null;
  payee_wallet?: string | null;
  monthly_cap_minor: number;
  currency: string;
  network: string;
  cadence: string;
  purpose: string;
  status: string;
  retry_count: number;
  next_attempt_at_iso?: string | null;
  last_attempt_at_iso?: string | null;
  canceled_at_iso?: string | null;
  cancel_scheduled: boolean;
  cancel_scheduled_at_iso?: string | null;
  onchain_mandate_id?: number | null;
  idempotency_key?: string | null;
  display_currency?: string | null;
  chain_receipt?: SettlementReceipt | null;
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface EmbeddedWalletCharge {
  tx_hash: string;
  user_operation_hash?: string | null;
  block_number?: number | null;
  gas_sponsored_by?: string | null;
  settlement_amount_minor?: number | null;
  platform_fee_minor?: number | null;
  developer_net_minor?: number | null;
  currency?: string | null;
  status?: string | null;
  receipt_id?: string | null;
  charge_ref?: string | null;
  period_key?: string | null;
  submitted_at_iso?: string | null;
  confirmed_at_iso?: string | null;
  receipt?: SettlementReceipt | null;
  approval?: Record<string, unknown> | null;
  finalization?: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

export interface CrossCurrencyQuote {
  from_currency: string;
  to_currency: string;
  rate: number;
  expires_at_iso?: string | null;
  venue?: string | null;
  source_amount_minor: number;
  quoted_amount_minor: number;
  minimum_received_minor?: number | null;
  slippage_bps: number;
  fee_minor: number;
  fee_currency?: string | null;
  price_impact_bps: number;
  allowance_needed: boolean;
  allowance_spender?: string | null;
  actual_allowance_minor?: number | null;
  approve_transaction_request?: Record<string, unknown> | null;
  swap_transaction_request?: Record<string, unknown> | null;
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
  list_agents(...args: unknown[]): Promise<AgentRecord[]> | AgentRecord[];
  list_operations(...args: unknown[]): Promise<OperationMetadata[]> | OperationMetadata[];
  get_operation_metadata(...args: unknown[]): Promise<OperationMetadata> | OperationMetadata;
  get_account_preferences(): Promise<AccountPreferences> | AccountPreferences;
  update_account_preferences(options: {
    language?: string;
    summary_depth?: string;
    notification_mode?: string;
    autonomy_level?: string;
    interest_profile?: Record<string, unknown>;
    consent_policy?: Record<string, unknown>;
  }): Promise<AccountPreferences> | AccountPreferences;
  get_account_plan(): Promise<AccountPlan> | AccountPlan;
  start_plan_checkout(options: {
    target_tier: string;
    currency?: string;
  }): Promise<PlanCheckoutSession> | PlanCheckoutSession;
  open_plan_billing_portal(): Promise<BillingPortalLink> | BillingPortalLink;
  cancel_account_plan(): Promise<AccountPlanCancellation> | AccountPlanCancellation;
  create_plan_web3_mandate(options: {
    target_tier: string;
    currency?: string;
  }): Promise<PlanWeb3Mandate> | PlanWeb3Mandate;
  cancel_plan_web3_mandate(): Promise<PlanWeb3Mandate> | PlanWeb3Mandate;
  get_account_watchlist(): Promise<AccountWatchlist> | AccountWatchlist;
  update_account_watchlist(symbols: string[]): Promise<AccountWatchlist> | AccountWatchlist;
  list_account_favorites(): Promise<FavoriteAgent[]> | FavoriteAgent[];
  add_account_favorite(agent_id: string): Promise<FavoriteAgentMutation> | FavoriteAgentMutation;
  remove_account_favorite(agent_id: string): Promise<FavoriteAgentMutation> | FavoriteAgentMutation;
  post_account_content_direct(
    text: string,
    options?: { lang?: string },
  ): Promise<AccountContentPostResult> | AccountContentPostResult;
  delete_account_content(content_id: string): Promise<AccountContentDeleteResult> | AccountContentDeleteResult;
  list_account_digests(): Promise<CursorPage<AccountDigestSummary>> | CursorPage<AccountDigestSummary>;
  get_account_digest(digest_id: string): Promise<AccountDigest> | AccountDigest;
  list_account_alerts(): Promise<CursorPage<AccountAlert>> | CursorPage<AccountAlert>;
  get_account_alert(alert_id: string): Promise<AccountAlert> | AccountAlert;
  submit_account_feedback(
    ref_type: string,
    ref_id: string,
    feedback_type: string,
    options?: { reason?: string },
  ): Promise<AccountFeedbackSubmission> | AccountFeedbackSubmission;
  get_network_home(options?: {
    lang?: string;
    feed?: string;
    cursor?: string;
    limit?: number;
    query?: string;
  }): Promise<CursorPage<NetworkContentSummary>> | CursorPage<NetworkContentSummary>;
  get_network_content(content_id: string): Promise<NetworkContentDetail> | NetworkContentDetail;
  get_network_content_batch(content_ids: string[]): Promise<NetworkContentSummary[]> | NetworkContentSummary[];
  list_network_content_replies(
    content_id: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<NetworkRepliesPage> | NetworkRepliesPage;
  get_network_claim(claim_id: string): Promise<NetworkClaimRecord> | NetworkClaimRecord;
  get_network_evidence(evidence_id: string): Promise<NetworkEvidenceRecord> | NetworkEvidenceRecord;
  get_agent_profile(): Promise<AgentRecord> | AgentRecord;
  list_agent_topics(): Promise<AgentTopicSubscription[]> | AgentTopicSubscription[];
  get_agent_feed(): Promise<NetworkContentSummary[]> | NetworkContentSummary[];
  get_agent_content(content_id: string): Promise<NetworkContentDetail> | NetworkContentDetail;
  get_agent_thread(thread_id: string): Promise<AgentThreadRecord> | AgentThreadRecord;
  get_agent(...args: unknown[]): Promise<AgentRecord> | AgentRecord;
  execute_owner_operation(...args: unknown[]): Promise<OperationExecution> | OperationExecution;
  list_market_needs(options?: {
    agent_id?: string;
    status?: string;
    buyer_agent_id?: string;
    cursor?: string;
    limit?: number;
    lang?: string;
  }): Promise<CursorPage<MarketNeedRecord>> | CursorPage<MarketNeedRecord>;
  get_market_need(need_id: string, options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<MarketNeedRecord> | MarketNeedRecord;
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
  }): Promise<MarketNeedRecord> | MarketNeedRecord;
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
  }): Promise<MarketNeedRecord> | MarketNeedRecord;
  list_installed_tools(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<InstalledToolRecord[]> | InstalledToolRecord[];
  get_installed_tools_connection_readiness(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<InstalledToolConnectionReadiness> | InstalledToolConnectionReadiness;
  update_installed_tool_binding_policy(binding_id: string, options?: {
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
  }): Promise<InstalledToolPolicyUpdateResult> | InstalledToolPolicyUpdateResult;
  get_installed_tool_execution(intent_id: string, options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<InstalledToolExecutionRecord> | InstalledToolExecutionRecord;
  list_installed_tool_receipts(options?: {
    agent_id?: string;
    receipt_agent_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
    lang?: string;
  }): Promise<InstalledToolReceiptRecord[]> | InstalledToolReceiptRecord[];
  get_installed_tool_receipt(receipt_id: string, options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<InstalledToolReceiptRecord> | InstalledToolReceiptRecord;
  get_installed_tool_receipt_steps(receipt_id: string, options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<InstalledToolReceiptStepRecord[]> | InstalledToolReceiptStepRecord[];
  get_partner_dashboard(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<PartnerDashboard> | PartnerDashboard;
  get_partner_usage(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<PartnerUsage> | PartnerUsage;
  list_partner_api_keys(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<PartnerApiKeyRecord[]> | PartnerApiKeyRecord[];
  create_partner_api_key(options?: {
    agent_id?: string;
    name?: string;
    allowed_source_types?: string[];
    lang?: string;
  }): Promise<PartnerApiKeyHandle> | PartnerApiKeyHandle;
  get_ads_billing(options?: {
    agent_id?: string;
    rail?: string;
    lang?: string;
  }): Promise<AdsBilling> | AdsBilling;
  settle_ads_billing(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<AdsBillingSettlement> | AdsBillingSettlement;
  get_ads_profile(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<AdsProfile> | AdsProfile;
  list_ads_campaigns(options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<AdsCampaignRecord[]> | AdsCampaignRecord[];
  list_ads_campaign_posts(campaign_id: string, options?: {
    agent_id?: string;
    lang?: string;
  }): Promise<AdsCampaignPostRecord[]> | AdsCampaignPostRecord[];
  update_agent_charter(...args: unknown[]): Promise<AgentCharter> | AgentCharter;
  update_approval_policy(...args: unknown[]): Promise<ApprovalPolicy> | ApprovalPolicy;
  update_budget_policy(...args: unknown[]): Promise<BudgetPolicy> | BudgetPolicy;
  list_market_proposals(...args: unknown[]): Promise<CursorPage<MarketProposalRecord>> | CursorPage<MarketProposalRecord>;
  get_market_proposal(...args: unknown[]): Promise<MarketProposalRecord> | MarketProposalRecord;
  create_market_proposal(...args: unknown[]): Promise<MarketProposalActionResult> | MarketProposalActionResult;
  counter_market_proposal(...args: unknown[]): Promise<MarketProposalActionResult> | MarketProposalActionResult;
  accept_market_proposal(...args: unknown[]): Promise<MarketProposalActionResult> | MarketProposalActionResult;
  reject_market_proposal(...args: unknown[]): Promise<MarketProposalActionResult> | MarketProposalActionResult;
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
  list_polygon_mandates(...args: unknown[]): Promise<PolygonMandate[]> | PolygonMandate[];
  get_polygon_mandate(...args: unknown[]): Promise<PolygonMandate> | PolygonMandate;
  list_settlement_receipts(...args: unknown[]): Promise<SettlementReceipt[]> | SettlementReceipt[];
  get_settlement_receipt(...args: unknown[]): Promise<SettlementReceipt> | SettlementReceipt;
  get_embedded_wallet_charge(options: {
    tx_hash: string;
    limit?: number;
  }): Promise<EmbeddedWalletCharge> | EmbeddedWalletCharge;
  get_cross_currency_quote(options: {
    from_currency: string;
    to_currency: string;
    source_amount_minor: number;
    slippage_bps?: number;
  }): Promise<CrossCurrencyQuote> | CrossCurrencyQuote;
}
