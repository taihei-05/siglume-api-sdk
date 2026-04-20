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

export type RefundReason =
  | "customer-request"
  | "duplicate"
  | "fraudulent"
  | "service-failure"
  | "goodwill";

export type DisputeResponse = "accept" | "contest";
export type RefundStatus = "issued" | "failed";
export type DisputeStatus = "open" | "accepted" | "contested";

export interface RefundRecord {
  refund_id: string;
  receipt_id: string;
  owner_user_id?: string | null;
  payment_mandate_id?: string | null;
  usage_event_id?: string | null;
  chain_receipt_id?: string | null;
  amount_minor: number;
  currency: string;
  status: RefundStatus | string;
  reason_code: RefundReason | string;
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
  status: DisputeStatus | string;
  reason_code: string;
  description?: string | null;
  evidence: Record<string, unknown>;
  response_decision?: DisputeResponse | string | null;
  response_note?: string | null;
  responded_at?: string | null;
  metadata: Record<string, unknown>;
  idempotent_replay: boolean;
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
  get_agent(...args: unknown[]): Promise<AgentRecord> | AgentRecord;
  execute_owner_operation(...args: unknown[]): Promise<OperationExecution> | OperationExecution;
  update_agent_charter(...args: unknown[]): Promise<AgentCharter> | AgentCharter;
  update_approval_policy(...args: unknown[]): Promise<ApprovalPolicy> | ApprovalPolicy;
  update_budget_policy(...args: unknown[]): Promise<BudgetPolicy> | BudgetPolicy;
  list_access_grants(...args: unknown[]): Promise<CursorPage<AccessGrantRecord>> | CursorPage<AccessGrantRecord>;
  bind_agent_to_grant(...args: unknown[]): Promise<GrantBindingResult> | GrantBindingResult;
  list_connected_accounts(...args: unknown[]): Promise<CursorPage<ConnectedAccountRecord>> | CursorPage<ConnectedAccountRecord>;
  create_support_case(...args: unknown[]): Promise<SupportCaseRecord> | SupportCaseRecord;
  list_support_cases(...args: unknown[]): Promise<CursorPage<SupportCaseRecord>> | CursorPage<SupportCaseRecord>;
  issue_partial_refund(options: {
    receipt_id: string;
    amount_minor: number;
    reason?: RefundReason | string;
    note?: string;
    idempotency_key: string;
    original_amount_minor?: number;
  }): Promise<RefundRecord> | RefundRecord;
  issue_full_refund(options: {
    receipt_id: string;
    reason?: RefundReason | string;
    note?: string;
    idempotency_key?: string;
  }): Promise<RefundRecord> | RefundRecord;
  list_refunds(...args: unknown[]): Promise<RefundRecord[]> | RefundRecord[];
  get_refund(refund_id: string): Promise<RefundRecord> | RefundRecord;
  get_refunds_for_receipt(...args: unknown[]): Promise<RefundRecord[]> | RefundRecord[];
  list_disputes(...args: unknown[]): Promise<DisputeRecord[]> | DisputeRecord[];
  get_dispute(dispute_id: string): Promise<DisputeRecord> | DisputeRecord;
  respond_to_dispute(options: {
    dispute_id: string;
    response: DisputeResponse | string;
    evidence: Record<string, unknown>;
    note?: string;
  }): Promise<DisputeRecord> | DisputeRecord;
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
