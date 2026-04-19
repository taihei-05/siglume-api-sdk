from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk import DisputeResponse, RefundClient, RefundReason, SiglumeClient, SiglumeClientError  # noqa: E402


def envelope(data, *, trace_id: str = "trc_refund", request_id: str = "req_refund") -> dict[str, object]:
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


def build_refund_client(handler) -> RefundClient:
    return RefundClient(
        api_key="sig_test_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


def test_issue_partial_refund_and_receipt_helpers_return_typed_records() -> None:
    refund_payload = {
        "id": "rfnd_123",
        "receipt_id": "rcp_123",
        "owner_user_id": "usr_123",
        "amount_minor": 500,
        "currency": "USD",
        "status": "issued",
        "reason_code": "customer-request",
        "idempotency_key": "rfnd_001",
        "on_chain_tx_hash": "0x" + "ab" * 32,
        "metadata": {"original_amount_minor": 1200},
        "idempotent_replay": False,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/refunds" and request.method == "POST":
            body = json.loads(request.content.decode("utf-8"))
            assert body["amount_minor"] == 500
            assert body["reason_code"] == RefundReason.CUSTOMER_REQUEST.value
            return httpx.Response(201, json=envelope(refund_payload))
        if request.url.path == "/v1/market/refunds" and request.method == "GET":
            assert request.url.params["receipt_id"] == "rcp_123"
            return httpx.Response(200, json=envelope([refund_payload]))
        if request.url.path == "/v1/market/refunds/rfnd_123":
            return httpx.Response(200, json=envelope(refund_payload))
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        refund = client.issue_partial_refund(
            "rcp_123",
            amount_minor=500,
            reason=RefundReason.CUSTOMER_REQUEST,
            note="Cancelled within 7-day window",
            idempotency_key="rfnd_001",
            original_amount_minor=1200,
        )
        listed = client.get_refunds_for_receipt("rcp_123")
        fetched = client.get_refund("rfnd_123")

    assert refund.refund_id == "rfnd_123"
    assert refund.amount_minor == 500
    assert listed[0].refund_id == refund.refund_id
    assert fetched.on_chain_tx_hash == refund.on_chain_tx_hash


def test_issue_full_refund_uses_deterministic_idempotency_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/market/refunds"
        body = json.loads(request.content.decode("utf-8"))
        assert body["receipt_id"] == "rcp_full"
        assert body["idempotency_key"] == "full-refund:rcp_full"
        assert "amount_minor" not in body
        return httpx.Response(
            201,
            json=envelope(
                {
                    "id": "rfnd_full",
                    "receipt_id": "rcp_full",
                    "amount_minor": 1200,
                    "currency": "USD",
                    "status": "issued",
                    "reason_code": "service-failure",
                    "idempotency_key": body["idempotency_key"],
                    "metadata": {},
                    "idempotent_replay": False,
                }
            ),
        )

    with build_client(handler) as client:
        refund = client.issue_full_refund("rcp_full", reason=RefundReason.SERVICE_FAILURE)

    assert refund.refund_id == "rfnd_full"
    assert refund.reason_code == RefundReason.SERVICE_FAILURE.value


def test_partial_refund_validates_amount_against_original_receipt_guard() -> None:
    with build_client(lambda request: httpx.Response(500, json={"error": {"code": "UNUSED", "message": "unused"}})) as client:
        with pytest.raises(SiglumeClientError, match="cannot exceed the original receipt amount"):
            client.issue_partial_refund(
                "rcp_guard",
                amount_minor=1500,
                reason=RefundReason.GOODWILL,
                idempotency_key="rfnd_guard",
                original_amount_minor=1200,
            )


def test_list_disputes_and_respond_to_dispute_return_typed_records() -> None:
    dispute_payload = {
        "id": "dsp_123",
        "receipt_id": "rcp_123",
        "owner_user_id": "usr_123",
        "status": "contested",
        "reason_code": "service-failure",
        "description": "Buyer disputed the conversion result.",
        "evidence": {"receipt_id": "rcp_123"},
        "response_decision": "contest",
        "response_note": "Audit logs confirm the execution succeeded.",
        "idempotent_replay": False,
        "metadata": {"trace_id": "trc_dispute"},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/disputes" and request.method == "GET":
            return httpx.Response(200, json=envelope([dispute_payload]))
        if request.url.path == "/v1/market/disputes/dsp_123" and request.method == "GET":
            return httpx.Response(200, json=envelope(dispute_payload))
        if request.url.path == "/v1/market/disputes/dsp_123/respond" and request.method == "POST":
            body = json.loads(request.content.decode("utf-8"))
            assert body["response"] == DisputeResponse.CONTEST.value
            return httpx.Response(200, json=envelope(dispute_payload))
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        disputes = client.list_disputes(receipt_id="rcp_123")
        fetched = client.get_dispute("dsp_123")
        responded = client.respond_to_dispute(
            "dsp_123",
            response=DisputeResponse.CONTEST,
            evidence={"receipt_id": "rcp_123", "logs_url": "https://logs.example.test/refund"},
        )

    assert disputes[0].dispute_id == "dsp_123"
    assert fetched.status == "contested"
    assert responded.response_decision == DisputeResponse.CONTEST.value


def test_respond_to_dispute_requires_mapping_evidence() -> None:
    with build_client(lambda request: httpx.Response(500, json={"error": {"code": "UNUSED", "message": "unused"}})) as client:
        with pytest.raises(SiglumeClientError, match="evidence must be a mapping"):
            client.respond_to_dispute("dsp_invalid", response=DisputeResponse.ACCEPT, evidence=["bad"])  # type: ignore[arg-type]


def test_refund_client_wrapper_reuses_siglume_client_surface() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/refunds":
            return httpx.Response(
                201,
                json=envelope(
                    {
                        "id": "rfnd_wrap",
                        "receipt_id": "rcp_wrap",
                        "amount_minor": 250,
                        "currency": "USD",
                        "status": "issued",
                        "reason_code": "duplicate",
                        "idempotency_key": "rfnd_wrap_001",
                        "metadata": {},
                        "idempotent_replay": False,
                    }
                ),
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_refund_client(handler) as client:
        refund = client.issue_partial_refund(
            receipt_id="rcp_wrap",
            amount_minor=250,
            reason=RefundReason.DUPLICATE,
            idempotency_key="rfnd_wrap_001",
        )

    assert refund.refund_id == "rfnd_wrap"
    assert refund.reason_code == RefundReason.DUPLICATE.value
