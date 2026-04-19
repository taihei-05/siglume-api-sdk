"""Web3 settlement read models and local simulation helpers."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


def _string_or_none(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return None


def _to_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _clone_json_like(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _clone_json_like(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_clone_json_like(item) for item in value]
    return value


def _first_text(*values: Any) -> str | None:
    for value in values:
        text = _string_or_none(value)
        if text:
            return text
    return None


def _iso_or_none(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat") and callable(value.isoformat):
        return str(value.isoformat())
    return _string_or_none(value)


@dataclass
class SettlementReceipt:
    receipt_id: str
    chain_receipt_id: str | None = None
    tx_hash: str = ""
    user_operation_hash: str | None = None
    receipt_kind: str | None = None
    reference_type: str | None = None
    reference_id: str | None = None
    tx_status: str | None = None
    network: str = "polygon"
    chain_id: int = 137
    block_number: int | None = None
    confirmations: int = 0
    finality_confirmations: int = 0
    submitted_hash: str | None = None
    tx_hash_is_placeholder: bool = False
    actual_gas_used: int | None = None
    actual_gas_cost_wei: int | None = None
    actual_gas_cost_pol: str | None = None
    last_status_checked_at: str | None = None
    submitted_at_iso: str | None = None
    confirmed_at_iso: str | None = None
    created_at_iso: str | None = None
    updated_at_iso: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class PolygonMandate:
    mandate_id: str
    payer_wallet: str | None = None
    payee_wallet: str | None = None
    monthly_cap_minor: int = 0
    currency: str = "USDC"
    network: str = "polygon"
    cadence: str = "monthly"
    purpose: str = "subscription"
    status: str = "active"
    retry_count: int = 0
    next_attempt_at_iso: str | None = None
    last_attempt_at_iso: str | None = None
    canceled_at_iso: str | None = None
    cancel_scheduled: bool = False
    cancel_scheduled_at_iso: str | None = None
    onchain_mandate_id: int | None = None
    idempotency_key: str | None = None
    display_currency: str | None = None
    chain_receipt: SettlementReceipt | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class EmbeddedWalletCharge:
    tx_hash: str
    user_operation_hash: str | None = None
    block_number: int | None = None
    gas_sponsored_by: str | None = None
    settlement_amount_minor: int | None = None
    platform_fee_minor: int | None = None
    developer_net_minor: int | None = None
    currency: str | None = None
    status: str | None = None
    receipt_id: str | None = None
    charge_ref: str | None = None
    period_key: str | None = None
    submitted_at_iso: str | None = None
    confirmed_at_iso: str | None = None
    receipt: SettlementReceipt | None = None
    approval: dict[str, Any] | None = None
    finalization: dict[str, Any] | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class CrossCurrencyQuote:
    from_currency: str
    to_currency: str
    rate: float = 0.0
    expires_at_iso: str | None = None
    venue: str | None = None
    source_amount_minor: int = 0
    quoted_amount_minor: int = 0
    minimum_received_minor: int | None = None
    slippage_bps: int = 0
    fee_minor: int = 0
    fee_currency: str | None = None
    price_impact_bps: int = 0
    allowance_needed: bool = False
    allowance_spender: str | None = None
    actual_allowance_minor: int | None = None
    approve_transaction_request: dict[str, Any] | None = None
    swap_transaction_request: dict[str, Any] | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


def parse_settlement_receipt(data: Mapping[str, Any]) -> SettlementReceipt:
    payload = _to_dict(data.get("payload_jsonb"))
    return SettlementReceipt(
        receipt_id=str(data.get("receipt_id") or data.get("chain_receipt_id") or ""),
        chain_receipt_id=_string_or_none(data.get("chain_receipt_id")) or _string_or_none(data.get("receipt_id")),
        tx_hash=str(data.get("tx_hash") or ""),
        user_operation_hash=_string_or_none(data.get("user_operation_hash")),
        receipt_kind=_string_or_none(data.get("receipt_kind")),
        reference_type=_string_or_none(data.get("reference_type")),
        reference_id=_string_or_none(data.get("reference_id")),
        tx_status=_string_or_none(data.get("tx_status")),
        network=str(data.get("network") or "polygon"),
        chain_id=int(data.get("chain_id") or 137),
        block_number=_optional_int(data.get("block_number")),
        confirmations=int(data.get("confirmations") or 0),
        finality_confirmations=int(data.get("finality_confirmations") or 0),
        submitted_hash=_string_or_none(data.get("submitted_hash")),
        tx_hash_is_placeholder=bool(data.get("tx_hash_is_placeholder") or False),
        actual_gas_used=_optional_int(data.get("actual_gas_used")),
        actual_gas_cost_wei=_optional_int(data.get("actual_gas_cost_wei")),
        actual_gas_cost_pol=_string_or_none(data.get("actual_gas_cost_pol")),
        last_status_checked_at=_string_or_none(data.get("last_status_checked_at")),
        submitted_at_iso=_iso_or_none(data.get("submitted_at")),
        confirmed_at_iso=_iso_or_none(data.get("confirmed_at")),
        created_at_iso=_iso_or_none(data.get("created_at")),
        updated_at_iso=_iso_or_none(data.get("updated_at")),
        payload=_clone_json_like(payload),
        raw=dict(data),
    )


def parse_polygon_mandate(data: Mapping[str, Any]) -> PolygonMandate:
    metadata = _to_dict(data.get("metadata_jsonb"))
    transaction_request = _to_dict(data.get("transaction_request"))
    approve_request = _to_dict(data.get("approve_transaction_request"))
    chain_receipt_payload = data.get("chain_receipt")
    chain_receipt = parse_settlement_receipt(chain_receipt_payload) if isinstance(chain_receipt_payload, Mapping) else None
    payer_wallet = _first_text(
        transaction_request.get("from_address"),
        approve_request.get("from_address"),
        metadata.get("wallet_address"),
        metadata.get("smart_account_address"),
    )
    payee_wallet = _first_text(data.get("payee_ref"), metadata.get("payee_wallet"))
    cancel_scheduled = bool(metadata.get("cancel_scheduled") or metadata.get("cancel_queue_required") or False)
    return PolygonMandate(
        mandate_id=str(data.get("mandate_id") or data.get("payment_mandate_id") or ""),
        payer_wallet=payer_wallet,
        payee_wallet=payee_wallet,
        monthly_cap_minor=int(data.get("max_amount_minor") or 0),
        currency=_first_text(data.get("token_symbol"), data.get("display_currency"), "USDC") or "USDC",
        network=str(data.get("network") or "polygon"),
        cadence=str(data.get("cadence") or "monthly"),
        purpose=str(data.get("purpose") or "subscription"),
        status=str(data.get("status") or "active"),
        retry_count=int(data.get("retry_count") or 0),
        next_attempt_at_iso=_iso_or_none(data.get("next_attempt_at")),
        last_attempt_at_iso=_iso_or_none(data.get("last_attempt_at")),
        canceled_at_iso=_iso_or_none(data.get("canceled_at")),
        cancel_scheduled=cancel_scheduled,
        cancel_scheduled_at_iso=_string_or_none(metadata.get("cancel_queue_requested_at")),
        onchain_mandate_id=_optional_int(metadata.get("onchain_mandate_id")),
        idempotency_key=_string_or_none(data.get("idempotency_key")),
        display_currency=_string_or_none(data.get("display_currency")),
        chain_receipt=chain_receipt,
        metadata=_clone_json_like(metadata),
        raw=dict(data),
    )


def parse_embedded_wallet_charge(
    data: Mapping[str, Any] | None = None,
    *,
    receipt: SettlementReceipt | Mapping[str, Any] | None = None,
) -> EmbeddedWalletCharge:
    charge_payload = dict(data) if isinstance(data, Mapping) else {}
    receipt_obj = (
        parse_settlement_receipt(receipt)
        if isinstance(receipt, Mapping)
        else receipt
    )
    if receipt_obj is None and isinstance(charge_payload.get("receipt"), Mapping):
        receipt_obj = parse_settlement_receipt(charge_payload["receipt"])
    payload = receipt_obj.payload if receipt_obj is not None else {}
    settlement_amount_minor = _optional_int(charge_payload.get("gross_amount_minor"))
    if settlement_amount_minor is None:
        settlement_amount_minor = _optional_int(payload.get("gross_amount_minor"))
    if settlement_amount_minor is None:
        settlement_amount_minor = _optional_int(payload.get("amount_minor"))
    platform_fee_minor = _optional_int(payload.get("platform_fee_minor"))
    if platform_fee_minor is None:
        platform_fee_minor = _optional_int(payload.get("fee_minor"))
    developer_net_minor = _optional_int(payload.get("developer_net_minor"))
    if developer_net_minor is None and settlement_amount_minor is not None and platform_fee_minor is not None:
        developer_net_minor = settlement_amount_minor - platform_fee_minor
    tx_hash = _first_text(charge_payload.get("tx_hash"), getattr(receipt_obj, "tx_hash", None)) or ""
    return EmbeddedWalletCharge(
        tx_hash=tx_hash,
        user_operation_hash=_first_text(
            getattr(receipt_obj, "user_operation_hash", None),
            charge_payload.get("user_operation_hash"),
        ),
        block_number=_optional_int(getattr(receipt_obj, "block_number", None)),
        gas_sponsored_by=_first_text(payload.get("gas_sponsored_by"), payload.get("paymaster"), "platform"),
        settlement_amount_minor=settlement_amount_minor,
        platform_fee_minor=platform_fee_minor,
        developer_net_minor=developer_net_minor,
        currency=_first_text(payload.get("token_symbol"), payload.get("display_currency")),
        status=_first_text(charge_payload.get("status"), getattr(receipt_obj, "tx_status", None)),
        receipt_id=_first_text(getattr(receipt_obj, "receipt_id", None)),
        charge_ref=_string_or_none(charge_payload.get("charge_ref")),
        period_key=_string_or_none(charge_payload.get("period_key")),
        submitted_at_iso=_string_or_none(getattr(receipt_obj, "submitted_at_iso", None)),
        confirmed_at_iso=_string_or_none(getattr(receipt_obj, "confirmed_at_iso", None)),
        receipt=receipt_obj,
        approval=_clone_json_like(charge_payload.get("approval")) if isinstance(charge_payload.get("approval"), Mapping) else None,
        finalization=_clone_json_like(charge_payload.get("finalization")) if isinstance(charge_payload.get("finalization"), Mapping) else None,
        raw=charge_payload,
    )


def parse_cross_currency_quote(data: Mapping[str, Any]) -> CrossCurrencyQuote:
    return CrossCurrencyQuote(
        from_currency=str(data.get("sell_token") or data.get("from_currency") or ""),
        to_currency=str(data.get("buy_token") or data.get("to_currency") or ""),
        rate=float(data.get("rate") or 0.0),
        expires_at_iso=_iso_or_none(data.get("quote_expires_at") or data.get("expires_at_iso")),
        venue=_first_text(data.get("provider"), data.get("venue")),
        source_amount_minor=int(data.get("amount_minor") or data.get("source_amount_minor") or 0),
        quoted_amount_minor=int(data.get("estimated_buy_minor") or data.get("quoted_amount_minor") or 0),
        minimum_received_minor=_optional_int(data.get("minimum_buy_minor")),
        slippage_bps=int(data.get("slippage_bps") or 0),
        fee_minor=int(data.get("fee_minor") or 0),
        fee_currency=_first_text(data.get("fee_token"), data.get("fee_currency")),
        price_impact_bps=int(data.get("price_impact_bps") or 0),
        allowance_needed=bool(data.get("allowance_needed") or False),
        allowance_spender=_string_or_none(data.get("allowance_spender")),
        actual_allowance_minor=_optional_int(data.get("actual_allowance_minor")),
        approve_transaction_request=_clone_json_like(data.get("approve_transaction_request")) if isinstance(data.get("approve_transaction_request"), Mapping) else None,
        swap_transaction_request=_clone_json_like(data.get("swap_transaction_request")) if isinstance(data.get("swap_transaction_request"), Mapping) else None,
        raw=dict(data),
    )


def simulate_polygon_mandate(
    *,
    mandate_id: str,
    payer_wallet: str,
    payee_wallet: str,
    monthly_cap_minor: int,
    currency: str,
    status: str = "active",
    next_attempt_at_iso: str | None = "2026-05-01T00:00:00Z",
    cancel_scheduled: bool = False,
    cadence: str = "monthly",
    purpose: str = "subscription",
) -> PolygonMandate:
    metadata = {
        "cancel_scheduled": bool(cancel_scheduled),
        "payee_wallet": payee_wallet,
    }
    return PolygonMandate(
        mandate_id=mandate_id,
        payer_wallet=payer_wallet,
        payee_wallet=payee_wallet,
        monthly_cap_minor=int(monthly_cap_minor),
        currency=str(currency).upper(),
        network="polygon",
        cadence=cadence,
        purpose=purpose,
        status=status,
        retry_count=0,
        next_attempt_at_iso=next_attempt_at_iso,
        cancel_scheduled=bool(cancel_scheduled),
        onchain_mandate_id=1,
        metadata=metadata,
        raw={
            "mandate_id": mandate_id,
            "payee_ref": payee_wallet,
            "token_symbol": str(currency).upper(),
            "max_amount_minor": int(monthly_cap_minor),
            "status": status,
            "next_attempt_at": next_attempt_at_iso,
            "metadata_jsonb": metadata,
        },
    )


def simulate_embedded_wallet_charge(
    *,
    mandate: PolygonMandate,
    amount_minor: int,
    tx_hash: str,
    user_operation_hash: str | None = None,
    block_number: int = 123456,
    gas_sponsored_by: str = "platform",
    platform_fee_minor: int = 0,
    developer_net_minor: int | None = None,
) -> EmbeddedWalletCharge:
    settlement_amount_minor = int(amount_minor)
    fee_minor = int(platform_fee_minor)
    net_minor = settlement_amount_minor - fee_minor if developer_net_minor is None else int(developer_net_minor)
    receipt = SettlementReceipt(
        receipt_id=f"chr_{mandate.mandate_id}",
        chain_receipt_id=f"chr_{mandate.mandate_id}",
        tx_hash=tx_hash,
        user_operation_hash=_string_or_none(user_operation_hash),
        receipt_kind="mandate_charge_submitted",
        reference_type="payment_mandate",
        reference_id=mandate.mandate_id,
        tx_status="confirmed",
        network=mandate.network,
        chain_id=137,
        block_number=int(block_number),
        confirmations=12,
        finality_confirmations=12,
        submitted_hash=_string_or_none(user_operation_hash) or tx_hash,
        tx_hash_is_placeholder=False,
        submitted_at_iso="2026-04-20T10:00:00Z",
        confirmed_at_iso="2026-04-20T10:00:15Z",
        payload={
            "gross_amount_minor": settlement_amount_minor,
            "platform_fee_minor": fee_minor,
            "developer_net_minor": net_minor,
            "token_symbol": mandate.currency,
            "payee_wallet": mandate.payee_wallet,
            "gas_sponsored_by": gas_sponsored_by,
        },
    )
    return EmbeddedWalletCharge(
        tx_hash=tx_hash,
        user_operation_hash=_string_or_none(user_operation_hash),
        block_number=int(block_number),
        gas_sponsored_by=gas_sponsored_by,
        settlement_amount_minor=settlement_amount_minor,
        platform_fee_minor=fee_minor,
        developer_net_minor=net_minor,
        currency=mandate.currency,
        status="confirmed",
        receipt_id=receipt.receipt_id,
        charge_ref=f"charge_{mandate.mandate_id}",
        period_key="202604",
        submitted_at_iso=receipt.submitted_at_iso,
        confirmed_at_iso=receipt.confirmed_at_iso,
        receipt=receipt,
        finalization={"await": {"confirmed": True, "attempts": 1}},
        raw={
            "status": "submitted",
            "tx_hash": tx_hash,
            "user_operation_hash": user_operation_hash,
            "gross_amount_minor": settlement_amount_minor,
            "platform_fee_minor": fee_minor,
            "developer_net_minor": net_minor,
        },
    )


__all__ = [
    "CrossCurrencyQuote",
    "EmbeddedWalletCharge",
    "PolygonMandate",
    "SettlementReceipt",
    "parse_cross_currency_quote",
    "parse_embedded_wallet_charge",
    "parse_polygon_mandate",
    "parse_settlement_receipt",
    "simulate_embedded_wallet_charge",
    "simulate_polygon_mandate",
]
