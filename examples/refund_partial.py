"""API: issue and inspect marketplace refunds for executed receipts.
Intended user: seller support or finance automation.
Connected account: none (refund settlement is handled by Siglume on the stored receipt).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk.refunds import DisputeResponse, RefundClient, RefundReason


REFUND_POLICY_NOTE = (
    "Refunds are issued against the original receipt. The seller can offer a partial refund "
    "within the cancellation window and the buyer is notified with the refund.issued webhook."
)


def build_mock_refund_client() -> RefundClient:
    refund_payload = {
        "id": "rfnd_demo_123",
        "receipt_id": "rcp_demo_123",
        "owner_user_id": "usr_demo_123",
        "payment_mandate_id": "mand_demo_123",
        "usage_event_id": "use_demo_123",
        "chain_receipt_id": "chr_demo_123",
        "amount_minor": 500,
        "currency": "USD",
        "status": "issued",
        "reason_code": "customer-request",
        "note": "Cancelled within 7-day window",
        "idempotency_key": "rfnd_demo_001",
        "on_chain_tx_hash": "0x" + "ab" * 32,
        "metadata": {"original_amount_minor": 1200, "remaining_after_refund_minor": 700},
        "idempotent_replay": False,
        "created_at": "2026-04-20T00:00:00Z",
        "updated_at": "2026-04-20T00:00:00Z",
    }
    dispute_payload = {
        "id": "dsp_demo_123",
        "receipt_id": "rcp_demo_123",
        "owner_user_id": "usr_demo_123",
        "status": "contested",
        "reason_code": "service-failure",
        "description": "Buyer disputed the conversion result.",
        "evidence": {"receipt_id": "rcp_demo_123", "logs_url": "https://logs.example.test/refund-demo"},
        "response_decision": "contest",
        "response_note": "Server-side audit logs confirm the conversion completed successfully.",
        "responded_at": "2026-04-20T00:01:00Z",
        "metadata": {"trace_id": "trc_demo_refund"},
        "idempotent_replay": False,
        "created_at": "2026-04-20T00:00:30Z",
        "updated_at": "2026-04-20T00:01:00Z",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/refunds" and request.method == "POST":
            payload = json.loads(request.content.decode("utf-8"))
            assert payload["receipt_id"] == "rcp_demo_123"
            assert payload["reason_code"] == RefundReason.CUSTOMER_REQUEST.value
            return httpx.Response(
                201,
                json={"data": refund_payload, "meta": {"trace_id": "trc_refund", "request_id": "req_refund"}, "error": None},
            )
        if request.url.path == "/v1/market/refunds" and request.method == "GET":
            return httpx.Response(
                200,
                json={"data": [refund_payload], "meta": {"trace_id": "trc_refund", "request_id": "req_refund"}, "error": None},
            )
        if request.url.path == "/v1/market/disputes/dsp_demo_123/respond" and request.method == "POST":
            payload = json.loads(request.content.decode("utf-8"))
            assert payload["response"] == DisputeResponse.CONTEST.value
            return httpx.Response(
                200,
                json={"data": dispute_payload, "meta": {"trace_id": "trc_dispute", "request_id": "req_dispute"}, "error": None},
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    return RefundClient(
        api_key=os.environ.get("SIGLUME_API_KEY", "sig_mock_key"),
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


def run_refund_partial_example() -> list[str]:
    with build_mock_refund_client() as client:
        refund = client.issue_partial_refund(
            receipt_id="rcp_demo_123",
            amount_minor=500,
            reason=RefundReason.CUSTOMER_REQUEST,
            note="Cancelled within 7-day window",
            idempotency_key="rfnd_demo_001",
            original_amount_minor=1200,
        )
        refunds_for_receipt = client.get_refunds_for_receipt("rcp_demo_123")
        dispute = client.respond_to_dispute(
            dispute_id="dsp_demo_123",
            response=DisputeResponse.CONTEST,
            evidence={"receipt_id": "rcp_demo_123", "logs_url": "https://logs.example.test/refund-demo"},
            note="Server-side audit logs confirm the conversion completed successfully.",
        )
    return [
        f"refund_note: {REFUND_POLICY_NOTE}",
        f"refund_status: {refund.status} replay={refund.idempotent_replay}",
        f"refund_tx: {refund.on_chain_tx_hash}",
        f"refunds_for_receipt: {len(refunds_for_receipt)}",
        f"dispute_status: {dispute.status} response={dispute.response_decision}",
    ]


def main() -> None:
    for line in run_refund_partial_example():
        print(line)


if __name__ == "__main__":
    main()
