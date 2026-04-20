from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk import SiglumeClient, SiglumeNotFoundError  # noqa: E402
from siglume_api_sdk.web3 import (  # noqa: E402
    parse_cross_currency_quote,
    simulate_embedded_wallet_charge,
    simulate_polygon_mandate,
)


def envelope(data, *, trace_id: str = "trc_web3", request_id: str = "req_web3") -> dict[str, object]:
    return {
        "data": data,
        "meta": {"request_id": request_id, "trace_id": trace_id},
        "error": None,
    }


def build_client(handler) -> SiglumeClient:
    return SiglumeClient(
        api_key="sig_test_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


def test_list_and_get_polygon_mandate_normalize_public_fields() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/market/web3/mandates"
        return httpx.Response(
            200,
            json=envelope(
                {
                    "items": [
                        {
                            "mandate_id": "pmd_demo_123",
                            "payment_mandate_id": "pmd_demo_123",
                            "network": "polygon",
                            "payee_type": "platform",
                            "payee_ref": "0x" + "2" * 40,
                            "purpose": "subscription",
                            "cadence": "monthly",
                            "token_symbol": "JPYC",
                            "display_currency": "USD",
                            "max_amount_minor": 148000,
                            "status": "active",
                            "retry_count": 1,
                            "idempotency_key": "mand_demo_key",
                            "next_attempt_at": "2026-05-01T00:00:00Z",
                            "metadata_jsonb": {
                                "cancel_scheduled": True,
                                "cancel_queue_requested_at": "2026-04-21T00:00:00Z",
                                "onchain_mandate_id": 42,
                            },
                            "transaction_request": {"from_address": "0x" + "1" * 40},
                        }
                    ],
                    "next_cursor": None,
                }
            ),
        )

    with build_client(handler) as client:
        mandates = client.list_polygon_mandates(limit=10)
        mandate = client.get_polygon_mandate("pmd_demo_123")

    assert len(mandates) == 1
    assert mandate.mandate_id == "pmd_demo_123"
    assert mandate.payer_wallet == "0x" + "1" * 40
    assert mandate.payee_wallet == "0x" + "2" * 40
    assert mandate.monthly_cap_minor == 148000
    assert mandate.currency == "JPYC"
    assert mandate.cancel_scheduled is True
    assert mandate.onchain_mandate_id == 42


def test_get_embedded_wallet_charge_matches_user_operation_hash_and_derives_net_amount() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/market/web3/receipts"
        return httpx.Response(
            200,
            json=envelope(
                {
                    "items": [
                        {
                            "receipt_id": "chr_demo_123",
                            "chain_receipt_id": "chr_demo_123",
                            "tx_hash": "0x" + "a" * 64,
                            "user_operation_hash": "0x" + "b" * 64,
                            "receipt_kind": "mandate_charge_submitted",
                            "tx_status": "confirmed",
                            "network": "polygon",
                            "chain_id": 137,
                            "block_number": 123456,
                            "confirmations": 12,
                            "finality_confirmations": 12,
                            "submitted_hash": "0x" + "b" * 64,
                            "payload_jsonb": {
                                "gross_amount_minor": 148000,
                                "platform_fee_minor": 800,
                                "token_symbol": "JPYC",
                                "gas_sponsored_by": "platform",
                            },
                            "submitted_at": "2026-04-20T10:00:00Z",
                            "confirmed_at": "2026-04-20T10:00:15Z",
                        }
                    ],
                    "next_cursor": None,
                }
            ),
        )

    with build_client(handler) as client:
        charge = client.get_embedded_wallet_charge(tx_hash="0x" + "b" * 64)

    assert charge.tx_hash == "0x" + "a" * 64
    assert charge.user_operation_hash == "0x" + "b" * 64
    assert charge.settlement_amount_minor == 148000
    assert charge.platform_fee_minor == 800
    assert charge.developer_net_minor == 147200
    assert charge.gas_sponsored_by == "platform"


def test_get_cross_currency_quote_maps_live_or_mock_swap_response() -> None:
    captured_payload: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/market/web3/swap/quote"
        captured_payload.update(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json=envelope(
                {
                    "network": "polygon",
                    "provider": "0x",
                    "sell_token": "JPYC",
                    "buy_token": "USDC",
                    "amount_minor": 10000,
                    "estimated_buy_minor": 9730,
                    "minimum_buy_minor": 9680,
                    "rate": 0.973,
                    "slippage_bps": 100,
                    "fee_minor": 30,
                    "fee_token": "USDC",
                    "price_impact_bps": 4,
                    "quote_expires_at": "2026-04-20T10:05:00Z",
                    "allowance_needed": False,
                }
            ),
        )

    with build_client(handler) as client:
        quote = client.get_cross_currency_quote(
            from_currency="JPYC",
            to_currency="USDC",
            source_amount_minor=10000,
        )

    assert captured_payload == {
        "sell_token": "JPYC",
        "buy_token": "USDC",
        "amount_minor": 10000,
        "slippage_bps": 100,
    }
    assert quote.from_currency == "JPYC"
    assert quote.to_currency == "USDC"
    assert quote.venue == "0x"
    assert quote.quoted_amount_minor == 9730
    assert quote.minimum_received_minor == 9680


def test_simulate_helpers_return_deterministic_web3_models() -> None:
    mandate = simulate_polygon_mandate(
        mandate_id="pmd_test_001",
        payer_wallet="0x" + "1" * 40,
        payee_wallet="0x" + "2" * 40,
        monthly_cap_minor=148000,
        currency="JPYC",
    )
    charge = simulate_embedded_wallet_charge(
        mandate=mandate,
        amount_minor=148000,
        tx_hash="0x" + "a" * 64,
        user_operation_hash="0x" + "b" * 64,
        platform_fee_minor=800,
    )

    assert mandate.currency == "JPYC"
    assert mandate.cancel_scheduled is False
    assert charge.tx_hash == "0x" + "a" * 64
    assert charge.user_operation_hash == "0x" + "b" * 64
    assert charge.developer_net_minor == 147200
    assert charge.receipt is not None
    assert charge.receipt.reference_id == "pmd_test_001"


def test_get_polygon_mandate_raises_not_found_for_missing_id() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=envelope({"items": [], "next_cursor": None}))

    with build_client(handler) as client:
        try:
            client.get_polygon_mandate("pmd_missing")
        except SiglumeNotFoundError as exc:
            error = exc
        else:
            raise AssertionError("Expected SiglumeNotFoundError")

    assert "pmd_missing" in str(error)


def test_parse_cross_currency_quote_supports_alias_fields() -> None:
    quote = parse_cross_currency_quote(
        {
            "from_currency": "JPYC",
            "to_currency": "USDC",
            "quoted_amount_minor": 9730,
            "source_amount_minor": 10000,
            "rate": 0.973,
            "venue": "mock-0x",
            "expires_at_iso": "2026-04-20T10:05:00Z",
        }
    )

    assert quote.from_currency == "JPYC"
    assert quote.to_currency == "USDC"
    assert quote.venue == "mock-0x"


def test_web3_helpers_follow_next_cursor_pages_for_lookup_and_charge() -> None:
    mandate_calls = {"count": 0}
    receipt_calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/web3/mandates":
            mandate_calls["count"] += 1
            cursor = request.url.params.get("cursor")
            if cursor == "next_mandate":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "items": [
                                {
                                    "mandate_id": "pmd_cursor_002",
                                    "payment_mandate_id": "pmd_cursor_002",
                                    "network": "polygon",
                                    "payee_type": "platform",
                                    "payee_ref": "0x" + "2" * 40,
                                    "purpose": "subscription",
                                    "cadence": "monthly",
                                    "token_symbol": "JPYC",
                                    "display_currency": "USD",
                                    "max_amount_minor": 148000,
                                    "status": "active",
                                    "retry_count": 0,
                                    "metadata_jsonb": {},
                                }
                            ],
                            "next_cursor": None,
                        }
                    ),
                )
            return httpx.Response(200, json=envelope({"items": [], "next_cursor": "next_mandate"}))
        if request.url.path == "/v1/market/web3/receipts":
            receipt_calls["count"] += 1
            cursor = request.url.params.get("cursor")
            if cursor == "next_receipt":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "items": [
                                {
                                    "receipt_id": "chr_cursor_002",
                                    "chain_receipt_id": "chr_cursor_002",
                                    "tx_hash": "0x" + "a" * 64,
                                    "user_operation_hash": "0x" + "b" * 64,
                                    "receipt_kind": "mandate_charge_submitted",
                                    "tx_status": "confirmed",
                                    "network": "polygon",
                                    "chain_id": 137,
                                    "confirmations": 12,
                                    "finality_confirmations": 12,
                                    "payload_jsonb": {
                                        "gross_amount_minor": 148000,
                                        "platform_fee_minor": 800,
                                        "token_symbol": "JPYC",
                                    },
                                }
                            ],
                            "next_cursor": None,
                        }
                    ),
                )
            return httpx.Response(200, json=envelope({"items": [], "next_cursor": "next_receipt"}))
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        mandate = client.get_polygon_mandate("pmd_cursor_002")
        charge = client.get_embedded_wallet_charge(tx_hash="0x" + "b" * 64)

    assert mandate.mandate_id == "pmd_cursor_002"
    assert charge.receipt_id == "chr_cursor_002"
    assert charge.settlement_amount_minor == 148000
    assert mandate_calls["count"] == 2
    assert receipt_calls["count"] == 2


def test_get_embedded_wallet_charge_matches_checksummed_tx_hash() -> None:
    """EVM tx hashes are case-insensitive — caller may pass mixed case while API returns lower case."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=envelope(
                {
                    "items": [
                        {
                            "receipt_id": "chr_case_001",
                            "tx_hash": "0x" + "a" * 64,
                            "user_operation_hash": "0x" + "b" * 64,
                            "receipt_kind": "mandate_charge_succeeded",
                            "tx_status": "confirmed",
                            "network": "polygon",
                            "chain_id": 137,
                            "submitted_hash": "0x" + "b" * 64,
                            "payload_jsonb": {
                                "gross_amount_minor": 100,
                                "platform_fee_minor": 0,
                                "token_symbol": "USDC",
                            },
                        }
                    ],
                    "next_cursor": None,
                }
            ),
        )

    with build_client(handler) as client:
        charge = client.get_embedded_wallet_charge(tx_hash="0x" + "A" * 64)

    assert charge.tx_hash == "0x" + "a" * 64


def test_get_embedded_wallet_charge_accepts_tool_execution_payment_kind() -> None:
    """Capability gateway charges land as receipt_kind=tool_execution_payment_submitted."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=envelope(
                {
                    "items": [
                        {
                            "receipt_id": "chr_tool_001",
                            "tx_hash": "0x" + "d" * 64,
                            "receipt_kind": "tool_execution_payment_submitted",
                            "tx_status": "confirmed",
                            "network": "polygon",
                            "chain_id": 137,
                            "payload_jsonb": {
                                "gross_amount_minor": 50,
                                "platform_fee_minor": 0,
                                "token_symbol": "USDC",
                            },
                        }
                    ],
                    "next_cursor": None,
                }
            ),
        )

    with build_client(handler) as client:
        charge = client.get_embedded_wallet_charge(tx_hash="0x" + "d" * 64)

    assert charge.tx_hash == "0x" + "d" * 64


def test_get_embedded_wallet_charge_skips_non_charge_receipt_kinds() -> None:
    """Charge lookup must not return receipts whose kind is unrelated to charges (e.g. mandate setup)."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=envelope(
                {
                    "items": [
                        {
                            "receipt_id": "rcp_setup_001",
                            "tx_hash": "0x" + "c" * 64,
                            "receipt_kind": "mandate_create_submitted",
                            "tx_status": "confirmed",
                            "network": "polygon",
                            "chain_id": 137,
                        }
                    ],
                    "next_cursor": None,
                }
            ),
        )

    with build_client(handler) as client:
        try:
            client.get_embedded_wallet_charge(tx_hash="0x" + "c" * 64)
        except SiglumeNotFoundError:
            return
    raise AssertionError("Expected SiglumeNotFoundError for non-charge receipt_kind")
