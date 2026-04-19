"""Experimental seller-side usage metering helpers for the Siglume API."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import os
import re
from typing import Any, Iterable, Mapping

import httpx

from .client import (
    DEFAULT_SIGLUME_API_BASE,
    CursorPage,
    SiglumeClient,
    SiglumeClientError,
    UsageEventRecord,
    _string_or_none,
)


_DIGITS_RE = re.compile(r"^-?\d+$")
_MAX_BATCH_SIZE = 1000


@dataclass(frozen=True)
class UsageRecord:
    capability_key: str
    dimension: str
    units: int
    external_id: str
    occurred_at_iso: str
    agent_id: str | None = None


@dataclass
class MeterRecordResult:
    accepted: bool
    external_id: str
    server_id: str | None = None
    replayed: bool = False
    capability_key: str | None = None
    agent_id: str | None = None
    period_key: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


class MeterClient:
    """Experimental analytics / pre-billing wrapper for usage-event ingest."""

    experimental = True

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

    def __enter__(self) -> "MeterClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def record(self, record: UsageRecord | Mapping[str, Any]) -> MeterRecordResult:
        """Record a single usage event.

        This confirms receipt of usage data for analytics / future billing.
        It does not mean that a charge was created immediately.
        """
        results = self.record_batch([record])
        if not results:
            raise SiglumeClientError("Siglume usage metering response did not include any results.")
        return results[0]

    def record_batch(self, records: Iterable[UsageRecord | Mapping[str, Any]]) -> list[MeterRecordResult]:
        """Record up to N usage events, chunking at 1000 items per request."""
        normalized = [_normalize_usage_record(record) for record in records]
        if not normalized:
            return []

        results: list[MeterRecordResult] = []
        for start in range(0, len(normalized), _MAX_BATCH_SIZE):
            chunk = normalized[start:start + _MAX_BATCH_SIZE]
            data, _meta = self._client._request(  # noqa: SLF001 - shared package-internal transport reuse
                "POST",
                "/market/usage-events",
                json_body={"events": chunk},
            )
            items = data.get("items")
            if not isinstance(items, list):
                raise SiglumeClientError("Siglume usage metering response did not include an items array.")
            results.extend(_parse_meter_record_result(item) for item in items if isinstance(item, Mapping))
        return results

    def list_usage_events(
        self,
        *,
        capability_key: str | None = None,
        agent_id: str | None = None,
        outcome: str | None = None,
        environment: str | None = None,
        period_key: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> CursorPage[UsageEventRecord]:
        return self._client.get_usage(
            capability_key=capability_key,
            agent_id=agent_id,
            outcome=outcome,
            environment=environment,
            period_key=period_key,
            limit=limit,
            cursor=cursor,
        )


def _parse_meter_record_result(data: Mapping[str, Any]) -> MeterRecordResult:
    return MeterRecordResult(
        accepted=bool(data.get("accepted", False)),
        external_id=str(data.get("external_id") or data.get("idempotency_key") or ""),
        server_id=_string_or_none(data.get("server_id") or data.get("usage_event_id") or data.get("id")),
        replayed=bool(data.get("replayed", False)),
        capability_key=_string_or_none(data.get("capability_key")),
        agent_id=_string_or_none(data.get("agent_id")),
        period_key=_string_or_none(data.get("period_key")),
        raw=dict(data),
    )


def _normalize_usage_record(record: UsageRecord | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(record, UsageRecord):
        payload: dict[str, Any] = {
            "capability_key": record.capability_key,
            "dimension": record.dimension,
            "units": record.units,
            "external_id": record.external_id,
            "occurred_at_iso": record.occurred_at_iso,
            "agent_id": record.agent_id,
        }
    elif isinstance(record, Mapping):
        payload = dict(record)
    else:
        raise SiglumeClientError("Usage records must be UsageRecord instances or mappings.")

    capability_key = str(payload.get("capability_key") or "").strip()
    if not capability_key:
        raise SiglumeClientError("UsageRecord.capability_key is required.")

    dimension = str(payload.get("dimension") or "").strip()
    if not dimension:
        raise SiglumeClientError("UsageRecord.dimension is required.")

    external_id = str(payload.get("external_id") or "").strip()
    if not external_id:
        raise SiglumeClientError("UsageRecord.external_id is required.")

    occurred_at_iso = _normalize_rfc3339(payload.get("occurred_at_iso"))
    units = _coerce_non_negative_int(payload.get("units"), "UsageRecord.units")

    normalized: dict[str, Any] = {
        "capability_key": capability_key,
        "dimension": dimension,
        "units": units,
        "external_id": external_id,
        "occurred_at_iso": occurred_at_iso,
    }
    agent_id = str(payload.get("agent_id") or "").strip()
    if agent_id:
        normalized["agent_id"] = agent_id
    return normalized


def _coerce_non_negative_int(value: Any, field_name: str) -> int:
    if isinstance(value, bool):
        raise SiglumeClientError(f"{field_name} must be a non-negative integer.")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str) and _DIGITS_RE.fullmatch(value.strip()):
        parsed = int(value.strip())
    else:
        raise SiglumeClientError(f"{field_name} must be a non-negative integer.")
    if parsed < 0:
        raise SiglumeClientError(f"{field_name} must be a non-negative integer.")
    return parsed


def _normalize_rfc3339(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise SiglumeClientError("UsageRecord.occurred_at_iso is required.")
    candidate = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise SiglumeClientError("UsageRecord.occurred_at_iso must be RFC3339 with timezone.") from exc
    if parsed.tzinfo is None:
        raise SiglumeClientError("UsageRecord.occurred_at_iso must be RFC3339 with timezone.")
    return text


__all__ = [
    "MeterClient",
    "MeterRecordResult",
    "UsageEventRecord",
    "UsageRecord",
]
