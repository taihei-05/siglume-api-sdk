import { isRecord, stringOrNull, toRecord } from "./utils";

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

export function parse_settlement_receipt(data: Record<string, unknown>): SettlementReceipt {
  const payload = toRecord(data.payload_jsonb);
  return {
    receipt_id: String(data.receipt_id ?? data.chain_receipt_id ?? ""),
    chain_receipt_id: stringOrNull(data.chain_receipt_id) ?? stringOrNull(data.receipt_id),
    tx_hash: String(data.tx_hash ?? ""),
    user_operation_hash: stringOrNull(data.user_operation_hash),
    receipt_kind: stringOrNull(data.receipt_kind),
    reference_type: stringOrNull(data.reference_type),
    reference_id: stringOrNull(data.reference_id),
    tx_status: stringOrNull(data.tx_status),
    network: String(data.network ?? "polygon"),
    chain_id: Number(data.chain_id ?? 137),
    block_number: numberOrNull(data.block_number),
    confirmations: Number(data.confirmations ?? 0),
    finality_confirmations: Number(data.finality_confirmations ?? 0),
    submitted_hash: stringOrNull(data.submitted_hash),
    tx_hash_is_placeholder: Boolean(data.tx_hash_is_placeholder ?? false),
    actual_gas_used: numberOrNull(data.actual_gas_used),
    actual_gas_cost_wei: numberOrNull(data.actual_gas_cost_wei),
    actual_gas_cost_pol: stringOrNull(data.actual_gas_cost_pol),
    last_status_checked_at: stringOrNull(data.last_status_checked_at),
    submitted_at_iso: stringOrNull(data.submitted_at),
    confirmed_at_iso: stringOrNull(data.confirmed_at),
    created_at_iso: stringOrNull(data.created_at),
    updated_at_iso: stringOrNull(data.updated_at),
    payload,
    raw: { ...data },
  };
}

export function parse_polygon_mandate(data: Record<string, unknown>): PolygonMandate {
  const metadata = toRecord(data.metadata_jsonb);
  const transaction_request = toRecord(data.transaction_request);
  const approve_transaction_request = toRecord(data.approve_transaction_request);
  const chain_receipt = isRecord(data.chain_receipt) ? parse_settlement_receipt(data.chain_receipt) : null;
  return {
    mandate_id: String(data.mandate_id ?? data.payment_mandate_id ?? ""),
    payer_wallet:
      firstText(
        transaction_request.from_address,
        approve_transaction_request.from_address,
        metadata.wallet_address,
        metadata.smart_account_address,
      ) ?? null,
    payee_wallet: firstText(data.payee_ref, metadata.payee_wallet) ?? null,
    monthly_cap_minor: Number(data.max_amount_minor ?? 0),
    currency: firstText(data.token_symbol, data.display_currency, "USDC") ?? "USDC",
    network: String(data.network ?? "polygon"),
    cadence: String(data.cadence ?? "monthly"),
    purpose: String(data.purpose ?? "subscription"),
    status: String(data.status ?? "active"),
    retry_count: Number(data.retry_count ?? 0),
    next_attempt_at_iso: stringOrNull(data.next_attempt_at),
    last_attempt_at_iso: stringOrNull(data.last_attempt_at),
    canceled_at_iso: stringOrNull(data.canceled_at),
    cancel_scheduled: Boolean(metadata.cancel_scheduled) || Boolean(metadata.cancel_queue_required),
    cancel_scheduled_at_iso: stringOrNull(metadata.cancel_queue_requested_at),
    onchain_mandate_id: numberOrNull(metadata.onchain_mandate_id),
    idempotency_key: stringOrNull(data.idempotency_key),
    display_currency: stringOrNull(data.display_currency),
    chain_receipt,
    metadata,
    raw: { ...data },
  };
}

export function parse_embedded_wallet_charge(
  data: Record<string, unknown> = {},
  options: { receipt?: SettlementReceipt | Record<string, unknown> | null } = {},
): EmbeddedWalletCharge {
  const receipt = isSettlementReceipt(options.receipt)
    ? options.receipt
    : isRecord(options.receipt)
      ? parse_settlement_receipt(options.receipt)
      : options.receipt ?? (isRecord(data.receipt) ? parse_settlement_receipt(data.receipt) : null);
  const payload = receipt?.payload ?? {};
  const settlement_amount_minor = numberOrNull(data.gross_amount_minor)
    ?? numberOrNull(payload.gross_amount_minor)
    ?? numberOrNull(payload.amount_minor);
  const platform_fee_minor = numberOrNull(payload.platform_fee_minor) ?? numberOrNull(payload.fee_minor);
  const developer_net_minor = numberOrNull(payload.developer_net_minor)
    ?? (settlement_amount_minor !== null && platform_fee_minor !== null
      ? settlement_amount_minor - platform_fee_minor
      : null);
  return {
    tx_hash: firstText(data.tx_hash, receipt?.tx_hash) ?? "",
    user_operation_hash: firstText(receipt?.user_operation_hash, data.user_operation_hash) ?? null,
    block_number: receipt?.block_number ?? null,
    gas_sponsored_by: firstText(payload.gas_sponsored_by, payload.paymaster, "platform") ?? null,
    settlement_amount_minor,
    platform_fee_minor,
    developer_net_minor,
    currency: firstText(payload.token_symbol, payload.display_currency) ?? null,
    status: firstText(data.status, receipt?.tx_status) ?? null,
    receipt_id: receipt?.receipt_id ?? null,
    charge_ref: stringOrNull(data.charge_ref),
    period_key: stringOrNull(data.period_key),
    submitted_at_iso: receipt?.submitted_at_iso ?? null,
    confirmed_at_iso: receipt?.confirmed_at_iso ?? null,
    receipt,
    approval: isRecord(data.approval) ? { ...data.approval } : null,
    finalization: isRecord(data.finalization) ? { ...data.finalization } : null,
    raw: { ...data },
  };
}

export function parse_cross_currency_quote(data: Record<string, unknown>): CrossCurrencyQuote {
  return {
    from_currency: String(data.sell_token ?? data.from_currency ?? ""),
    to_currency: String(data.buy_token ?? data.to_currency ?? ""),
    rate: Number(data.rate ?? 0),
    expires_at_iso: stringOrNull(data.quote_expires_at ?? data.expires_at_iso),
    venue: firstText(data.provider, data.venue) ?? null,
    source_amount_minor: Number(data.amount_minor ?? data.source_amount_minor ?? 0),
    quoted_amount_minor: Number(data.estimated_buy_minor ?? data.quoted_amount_minor ?? 0),
    minimum_received_minor: numberOrNull(data.minimum_buy_minor),
    slippage_bps: Number(data.slippage_bps ?? 0),
    fee_minor: Number(data.fee_minor ?? 0),
    fee_currency: firstText(data.fee_token, data.fee_currency) ?? null,
    price_impact_bps: Number(data.price_impact_bps ?? 0),
    allowance_needed: Boolean(data.allowance_needed ?? false),
    allowance_spender: stringOrNull(data.allowance_spender),
    actual_allowance_minor: numberOrNull(data.actual_allowance_minor),
    approve_transaction_request: isRecord(data.approve_transaction_request) ? { ...data.approve_transaction_request } : null,
    swap_transaction_request: isRecord(data.swap_transaction_request) ? { ...data.swap_transaction_request } : null,
    raw: { ...data },
  };
}

export function simulate_polygon_mandate(options: {
  mandate_id: string;
  payer_wallet: string;
  payee_wallet: string;
  monthly_cap_minor: number;
  currency: string;
  status?: string;
  next_attempt_at_iso?: string | null;
  cancel_scheduled?: boolean;
  cadence?: string;
  purpose?: string;
}): PolygonMandate {
  const metadata: Record<string, unknown> = {
    cancel_scheduled: Boolean(options.cancel_scheduled ?? false),
    payee_wallet: options.payee_wallet,
  };
  return {
    mandate_id: options.mandate_id,
    payer_wallet: options.payer_wallet,
    payee_wallet: options.payee_wallet,
    monthly_cap_minor: Math.trunc(options.monthly_cap_minor),
    currency: String(options.currency).toUpperCase(),
    network: "polygon",
    cadence: options.cadence ?? "monthly",
    purpose: options.purpose ?? "subscription",
    status: options.status ?? "active",
    retry_count: 0,
    next_attempt_at_iso: options.next_attempt_at_iso ?? "2026-05-01T00:00:00Z",
    cancel_scheduled: Boolean(options.cancel_scheduled ?? false),
    onchain_mandate_id: 1,
    metadata,
    raw: {
      mandate_id: options.mandate_id,
      payee_ref: options.payee_wallet,
      token_symbol: String(options.currency).toUpperCase(),
      max_amount_minor: Math.trunc(options.monthly_cap_minor),
      status: options.status ?? "active",
      next_attempt_at: options.next_attempt_at_iso ?? "2026-05-01T00:00:00Z",
      metadata_jsonb: metadata,
    },
  };
}

export function simulate_embedded_wallet_charge(options: {
  mandate: PolygonMandate;
  amount_minor: number;
  tx_hash: string;
  user_operation_hash?: string | null;
  block_number?: number;
  gas_sponsored_by?: string;
  platform_fee_minor?: number;
  developer_net_minor?: number | null;
}): EmbeddedWalletCharge {
  const settlement_amount_minor = Math.trunc(options.amount_minor);
  const platform_fee_minor = Math.trunc(options.platform_fee_minor ?? 0);
  const developer_net_minor = options.developer_net_minor == null
    ? settlement_amount_minor - platform_fee_minor
    : Math.trunc(options.developer_net_minor);
  const receipt: SettlementReceipt = {
    receipt_id: `chr_${options.mandate.mandate_id}`,
    chain_receipt_id: `chr_${options.mandate.mandate_id}`,
    tx_hash: options.tx_hash,
    user_operation_hash: stringOrNull(options.user_operation_hash),
    receipt_kind: "mandate_charge_submitted",
    reference_type: "payment_mandate",
    reference_id: options.mandate.mandate_id,
    tx_status: "confirmed",
    network: options.mandate.network,
    chain_id: 137,
    block_number: Math.trunc(options.block_number ?? 123456),
    confirmations: 12,
    finality_confirmations: 12,
    submitted_hash: stringOrNull(options.user_operation_hash) ?? options.tx_hash,
    tx_hash_is_placeholder: false,
    submitted_at_iso: "2026-04-20T10:00:00Z",
    confirmed_at_iso: "2026-04-20T10:00:15Z",
    payload: {
      gross_amount_minor: settlement_amount_minor,
      platform_fee_minor,
      developer_net_minor,
      token_symbol: options.mandate.currency,
      payee_wallet: options.mandate.payee_wallet,
      gas_sponsored_by: options.gas_sponsored_by ?? "platform",
    },
    raw: {},
  };
  return {
    tx_hash: options.tx_hash,
    user_operation_hash: stringOrNull(options.user_operation_hash),
    block_number: receipt.block_number,
    gas_sponsored_by: options.gas_sponsored_by ?? "platform",
    settlement_amount_minor,
    platform_fee_minor,
    developer_net_minor,
    currency: options.mandate.currency,
    status: "confirmed",
    receipt_id: receipt.receipt_id,
    charge_ref: `charge_${options.mandate.mandate_id}`,
    period_key: "202604",
    submitted_at_iso: receipt.submitted_at_iso,
    confirmed_at_iso: receipt.confirmed_at_iso,
    receipt,
    finalization: { await: { confirmed: true, attempts: 1 } },
    raw: {
      status: "submitted",
      tx_hash: options.tx_hash,
      user_operation_hash: options.user_operation_hash ?? null,
      gross_amount_minor: settlement_amount_minor,
      platform_fee_minor,
      developer_net_minor,
    },
  };
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = stringOrNull(value);
    if (text) {
      return text;
    }
  }
  return null;
}

function isSettlementReceipt(value: unknown): value is SettlementReceipt {
  return isRecord(value) && typeof value.receipt_id === "string" && isRecord(value.payload);
}
