"""Typed refund and dispute helpers for the Siglume marketplace API."""
from __future__ import annotations

import os
from typing import Any, Mapping

import httpx

from .client import (
    DEFAULT_SIGLUME_API_BASE,
    Dispute,
    DisputeResponse,
    DisputeStatus,
    Refund,
    RefundReason,
    RefundStatus,
    SiglumeClient,
)


class RefundClient:
    """High-level wrapper around `SiglumeClient` for refund/dispute workflows."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str | None = None,
        timeout: float = 15.0,
        max_retries: int = 3,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._client = SiglumeClient(
            api_key=api_key,
            base_url=base_url or os.environ.get("SIGLUME_API_BASE") or DEFAULT_SIGLUME_API_BASE,
            timeout=timeout,
            max_retries=max_retries,
            transport=transport,
        )

    def __enter__(self) -> "RefundClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def issue_partial_refund(
        self,
        *,
        receipt_id: str,
        amount_minor: int,
        reason: RefundReason | str = RefundReason.CUSTOMER_REQUEST,
        note: str | None = None,
        idempotency_key: str,
        original_amount_minor: int | None = None,
    ) -> Refund:
        return self._client.issue_partial_refund(
            receipt_id,
            amount_minor=amount_minor,
            reason=reason,
            note=note,
            idempotency_key=idempotency_key,
            original_amount_minor=original_amount_minor,
        )

    def issue_full_refund(
        self,
        *,
        receipt_id: str,
        reason: RefundReason | str = RefundReason.CUSTOMER_REQUEST,
        note: str | None = None,
        idempotency_key: str | None = None,
    ) -> Refund:
        return self._client.issue_full_refund(
            receipt_id,
            reason=reason,
            note=note,
            idempotency_key=idempotency_key,
        )

    def list_refunds(self, *, receipt_id: str | None = None, limit: int = 50) -> list[Refund]:
        return self._client.list_refunds(receipt_id=receipt_id, limit=limit)

    def get_refund(self, refund_id: str) -> Refund:
        return self._client.get_refund(refund_id)

    def get_refunds_for_receipt(self, receipt_id: str, *, limit: int = 50) -> list[Refund]:
        return self._client.get_refunds_for_receipt(receipt_id, limit=limit)

    def list_disputes(self, *, receipt_id: str | None = None, limit: int = 50) -> list[Dispute]:
        return self._client.list_disputes(receipt_id=receipt_id, limit=limit)

    def get_dispute(self, dispute_id: str) -> Dispute:
        return self._client.get_dispute(dispute_id)

    def respond_to_dispute(
        self,
        *,
        dispute_id: str,
        response: DisputeResponse | str,
        evidence: Mapping[str, Any],
        note: str | None = None,
    ) -> Dispute:
        return self._client.respond_to_dispute(
            dispute_id,
            response=response,
            evidence=evidence,
            note=note,
        )


__all__ = [
    "Dispute",
    "DisputeResponse",
    "DisputeStatus",
    "Refund",
    "RefundClient",
    "RefundReason",
    "RefundStatus",
]
