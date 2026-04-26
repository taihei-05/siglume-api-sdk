"""Experimental buyer-side helpers for consuming Siglume marketplace listings."""
from __future__ import annotations

import os
import re
import warnings
from dataclasses import dataclass, field
from typing import Any, Mapping

import httpx

from .client import (
    DEFAULT_SIGLUME_API_BASE,
    AccessGrantRecord,
    AppListingRecord,
    CapabilityBindingRecord,
    GrantBindingResult,
    SiglumeClient,
    SiglumeClientError,
    SiglumeNotFoundError,
    _parse_access_grant,
    _string_or_none,
    _to_dict,
)


_QUERY_TOKEN_RE = re.compile(r"[a-z0-9]+")
_EXPERIMENTAL_EXECUTE_PATH = "/internal/market/capability/execute"
_SEARCH_FIELD_WEIGHTS = (
    ("capability_key", 40),
    ("name", 36),
    ("description", 30),
    ("short_description", 24),
    ("job_to_be_done", 20),
    ("category", 8),
)


class SiglumeExperimentalWarning(UserWarning):
    """Warns when the SDK falls back to a platform-gap workaround."""


class SiglumeExperimentalError(SiglumeClientError):
    """Raised when an experimental buyer flow cannot run on the public API yet."""


@dataclass
class CapabilityListing:
    listing_id: str
    capability_key: str
    name: str
    status: str
    description: str | None = None
    category: str | None = None
    job_to_be_done: str | None = None
    permission_class: str | None = None
    approval_mode: str | None = None
    dry_run_supported: bool = False
    price_model: str | None = None
    price_value_minor: int = 0
    currency: str = "USD"
    short_description: str | None = None
    docs_url: str | None = None
    support_contact: str | None = None
    seller_display_name: str | None = None
    seller_homepage_url: str | None = None
    seller_social_url: str | None = None
    review_status: str | None = None
    review_note: str | None = None
    submission_blockers: list[str] = field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None
    tool_manual: dict[str, Any] = field(default_factory=dict)
    score: float = 0.0
    snippet: str | None = None
    match_fields: list[str] = field(default_factory=list)
    experimental: bool = False
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_app_listing(
        cls,
        listing: AppListingRecord,
        *,
        score: float = 0.0,
        snippet: str | None = None,
        match_fields: list[str] | None = None,
        experimental: bool = False,
    ) -> "CapabilityListing":
        raw = dict(listing.raw)
        return cls(
            listing_id=listing.listing_id,
            capability_key=listing.capability_key,
            name=listing.name,
            status=listing.status,
            description=listing.description or _string_or_none(raw.get("description")),
            category=listing.category,
            job_to_be_done=listing.job_to_be_done,
            permission_class=listing.permission_class,
            approval_mode=listing.approval_mode,
            dry_run_supported=listing.dry_run_supported,
            price_model=listing.price_model,
            price_value_minor=listing.price_value_minor,
            currency=listing.currency,
            short_description=listing.short_description,
            docs_url=listing.docs_url,
            support_contact=listing.support_contact,
            seller_display_name=listing.seller_display_name,
            seller_homepage_url=listing.seller_homepage_url,
            seller_social_url=listing.seller_social_url,
            review_status=listing.review_status,
            review_note=listing.review_note,
            submission_blockers=list(listing.submission_blockers),
            created_at=listing.created_at,
            updated_at=listing.updated_at,
            tool_manual=_build_listing_tool_manual(listing),
            score=float(score),
            snippet=snippet,
            match_fields=list(match_fields or []),
            experimental=experimental,
            raw=raw,
        )


@dataclass
class Subscription:
    access_grant_id: str
    capability_listing_id: str
    capability_key: str
    purchase_status: str
    grant_status: str | None = None
    agent_id: str | None = None
    binding_id: str | None = None
    binding_status: str | None = None
    access_grant: AccessGrantRecord | None = None
    binding: CapabilityBindingRecord | None = None
    trace_id: str | None = None
    request_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


class SiglumeBuyerClient:
    """Experimental buyer-side SDK.

    Search is implemented client-side because the platform does not expose a
    public capability search endpoint yet. Invocation is also experimental: the
    public buyer execute route is not available, so `invoke()` can only run when
    `allow_internal_execute=True` is explicitly enabled for mocked or privileged
    environments.
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        timeout: float = 15.0,
        max_retries: int = 3,
        transport: httpx.BaseTransport | None = None,
        default_agent_id: str | None = None,
        allow_internal_execute: bool = False,
        experimental_execute_path: str = _EXPERIMENTAL_EXECUTE_PATH,
    ) -> None:
        self._client = SiglumeClient(
            api_key=api_key,
            base_url=base_url or os.environ.get("SIGLUME_API_BASE") or DEFAULT_SIGLUME_API_BASE,
            timeout=timeout,
            max_retries=max_retries,
            transport=transport,
        )
        self.default_agent_id = default_agent_id or os.environ.get("SIGLUME_AGENT_ID")
        self.allow_internal_execute = bool(allow_internal_execute)
        self.experimental_execute_path = "/" + experimental_execute_path.strip("/")
        self._warned_features: set[str] = set()

    def __enter__(self) -> "SiglumeBuyerClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def search_capabilities(
        self,
        *,
        query: str,
        permission_class: str | None = None,
        limit: int = 10,
        status: str = "published",
    ) -> list[CapabilityListing]:
        query_text = str(query or "").strip()
        if not query_text:
            raise SiglumeClientError("search_capabilities requires a non-empty query.")
        self._warn_experimental(
            "search",
            "SiglumeBuyerClient.search_capabilities() uses local substring matching because the platform search API is not public yet.",
        )
        normalized_permission = _normalize_permission(permission_class)
        matches: list[tuple[int, CapabilityListing]] = []
        for listing in self._list_all_capabilities(status=status):
            listing_permission = _normalize_permission(listing.permission_class)
            if normalized_permission and listing_permission != normalized_permission:
                continue
            score, match_fields, snippet = _score_listing(listing, query_text)
            if score <= 0:
                continue
            matches.append(
                (
                    -score,
                    CapabilityListing.from_app_listing(
                        listing,
                        score=score,
                        snippet=snippet,
                        match_fields=match_fields,
                        experimental=True,
                    ),
                )
            )
        matches.sort(key=lambda item: (item[0], item[1].name.lower(), item[1].capability_key.lower()))
        return [item[1] for item in matches[: max(1, min(int(limit), 100))]]

    def get_listing(self, capability_key: str) -> CapabilityListing:
        lookup = str(capability_key or "").strip()
        if not lookup:
            raise SiglumeClientError("capability_key is required.")
        lowered = lookup.lower()
        for listing in self._list_all_capabilities(status="published"):
            if listing.capability_key.lower() == lowered:
                self._warn_experimental(
                    "tool-manual",
                    "Buyer listings currently synthesize a minimal tool_manual because the public listing surface does not expose the full ToolManual payload yet.",
                )
                return CapabilityListing.from_app_listing(listing, experimental=True)
        try:
            listing = self._client.get_listing(lookup)
        except SiglumeNotFoundError as exc:
            raise SiglumeNotFoundError(f"Capability listing not found: {lookup}") from exc
        self._warn_experimental(
            "tool-manual",
            "Buyer listings currently synthesize a minimal tool_manual because the public listing surface does not expose the full ToolManual payload yet.",
        )
        return CapabilityListing.from_app_listing(listing, experimental=True)

    def subscribe(
        self,
        *,
        capability_key: str,
        agent_id: str | None = None,
        bind_agent: bool | None = None,
        binding_status: str = "active",
        buyer_currency: str | None = None,
        buyer_token: str | None = None,
    ) -> Subscription:
        listing = self.get_listing(capability_key)
        payload: dict[str, Any] = {}
        if buyer_currency:
            payload["buyer_currency"] = buyer_currency
        if buyer_token:
            payload["buyer_token"] = buyer_token
        data, meta = self._client._request(  # noqa: SLF001 - internal reuse within the SDK package
            "POST",
            f"/market/capabilities/{listing.listing_id}/purchase",
            json_body=payload,
        )
        access_grant = _parse_access_grant(_to_dict(data.get("access_grant")))
        if not access_grant.access_grant_id:
            purchase_status = str(data.get("purchase_status") or "unknown")
            raise SiglumeExperimentalError(
                f"Purchase completed with status '{purchase_status}' but did not return an access grant. "
                "Buyer-side subscription flows are still experimental on the public API."
            )
        target_agent_id = _resolve_agent_id(agent_id, self.default_agent_id)
        should_bind = bind_agent if bind_agent is not None else bool(target_agent_id)
        binding_result: GrantBindingResult | None = None
        if should_bind:
            if not target_agent_id:
                raise SiglumeClientError("agent_id is required to bind a purchased access grant.")
            binding_result = self._client.bind_agent_to_grant(
                access_grant.access_grant_id,
                agent_id=target_agent_id,
                binding_status=binding_status,
            )
        return Subscription(
            access_grant_id=access_grant.access_grant_id,
            capability_listing_id=access_grant.capability_listing_id or listing.listing_id,
            capability_key=listing.capability_key,
            purchase_status=str(data.get("purchase_status") or "created"),
            grant_status=access_grant.grant_status or None,
            agent_id=binding_result.binding.agent_id if binding_result is not None else target_agent_id,
            binding_id=binding_result.binding.binding_id if binding_result is not None else None,
            binding_status=binding_result.binding.binding_status if binding_result is not None else None,
            access_grant=access_grant,
            binding=binding_result.binding if binding_result is not None else None,
            trace_id=(binding_result.trace_id if binding_result is not None else meta.trace_id),
            request_id=(binding_result.request_id if binding_result is not None else meta.request_id),
            raw={
                "purchase": dict(data),
                "binding": binding_result.raw if binding_result is not None else None,
            },
        )

    def invoke(
        self,
        *,
        capability_key: str,
        input: Mapping[str, Any],
        idempotency_key: str | None = None,
        dry_run: bool = False,
        agent_id: str | None = None,
        task_type: str = "default",
        execution_kind: str | None = None,
        source_type: str | None = None,
        environment: str = "live",
        metadata: Mapping[str, Any] | None = None,
    ) -> Any:
        """Invoke a subscribed capability.

        Owner approval is surfaced as an ``ExecutionResult`` with
        ``needs_approval=True`` and a populated ``approval_hint`` instead of
        raising. Transport-level failures and missing public platform support
        still raise ``SiglumeClientError`` / ``SiglumeExperimentalError``.
        """
        if not self.allow_internal_execute:
            raise SiglumeExperimentalError(
                "SiglumeBuyerClient.invoke() requires allow_internal_execute=True because the public buyer execute endpoint is not available yet."
            )
        self._warn_experimental(
            "invoke",
            "SiglumeBuyerClient.invoke() uses an internal execution endpoint until a public buyer invoke API is available.",
        )
        target_agent_id = _resolve_agent_id(agent_id, self.default_agent_id)
        if not target_agent_id:
            raise SiglumeClientError("agent_id is required for invoke(); pass it explicitly or set SIGLUME_AGENT_ID.")
        payload: dict[str, Any] = {
            "agent_id": target_agent_id,
            "capability_key": capability_key,
            "task_type": task_type,
            "arguments": dict(input),
            "dry_run": bool(dry_run),
            "environment": environment,
            "metadata": dict(metadata or {}),
        }
        if execution_kind:
            payload["execution_kind"] = execution_kind
        elif dry_run:
            payload["execution_kind"] = "dry_run"
        if source_type:
            payload["source_type"] = source_type
        if idempotency_key:
            payload["idempotency_key"] = idempotency_key
        data, _meta = self._client._request(  # noqa: SLF001 - internal reuse within the SDK package
            "POST",
            self.experimental_execute_path,
            json_body=payload,
        )
        return _build_execution_result(data, payload=payload)

    def _list_all_capabilities(self, *, status: str = "published") -> list[AppListingRecord]:
        return self._client.list_capabilities(status=status, limit=100).all_items()

    def _warn_experimental(self, key: str, message: str) -> None:
        if key in self._warned_features:
            return
        self._warned_features.add(key)
        warnings.warn(message, SiglumeExperimentalWarning, stacklevel=2)


def _normalize_permission(value: str | None) -> str | None:
    text = str(value or "").strip().lower()
    if not text:
        return None
    return text.replace("_", "-")


def _tool_manual_permission(value: str | None) -> str:
    normalized = _normalize_permission(value)
    if normalized == "payment":
        return "payment"
    if normalized == "action":
        return "action"
    return "read_only"


def _resolve_agent_id(explicit: str | None, default: str | None) -> str | None:
    candidate = explicit or default
    return str(candidate).strip() if candidate else None


def _score_listing(listing: AppListingRecord, query: str) -> tuple[int, list[str], str | None]:
    normalized_query = query.lower().strip()
    tokens = [token for token in _QUERY_TOKEN_RE.findall(normalized_query) if token]
    matched_fields: list[str] = []
    score = 0
    snippet: str | None = None
    for field_name, weight in _SEARCH_FIELD_WEIGHTS:
        text = _listing_field_text(listing, field_name)
        if not text:
            continue
        lowered = text.lower()
        field_matched = False
        if normalized_query and normalized_query in lowered:
            score += weight * 3
            field_matched = True
            if snippet is None:
                snippet = _snippet(text, normalized_query)
        else:
            token_hits = sum(1 for token in tokens if token in lowered)
            if token_hits:
                score += weight * token_hits
                field_matched = True
                if snippet is None:
                    snippet = _snippet(text, tokens[0])
        if field_matched:
            matched_fields.append(field_name)
    return score, matched_fields, snippet


def _listing_field_text(listing: AppListingRecord, field_name: str) -> str:
    if field_name == "description":
        return str(listing.raw.get("description") or "").strip()
    value = getattr(listing, field_name, None)
    return str(value or "").strip()


def _snippet(text: str, term: str) -> str:
    lowered = text.lower()
    index = lowered.find(term.lower())
    if index < 0:
        return text[:96].strip()
    start = max(index - 24, 0)
    end = min(index + len(term) + 56, len(text))
    excerpt = text[start:end].strip()
    if start > 0:
        excerpt = "..." + excerpt
    if end < len(text):
        excerpt = excerpt + "..."
    return excerpt


def _build_listing_tool_manual(listing: AppListingRecord) -> dict[str, Any]:
    raw = dict(listing.raw)
    existing = raw.get("tool_manual")
    if isinstance(existing, Mapping):
        return dict(existing)
    description = listing.description or _string_or_none(raw.get("description")) or listing.short_description or listing.job_to_be_done or listing.name
    permission_class = _tool_manual_permission(listing.permission_class)
    input_schema = _to_dict(raw.get("input_schema")) or {
        "type": "object",
        "properties": {},
        "additionalProperties": True,
    }
    output_schema = _to_dict(raw.get("output_schema")) or {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "Summary of what the capability returned.",
            }
        },
        "required": ["summary"],
        "additionalProperties": True,
    }
    tool_manual: dict[str, Any] = {
        "tool_name": listing.capability_key.replace("-", "_") or "siglume_capability",
        "job_to_be_done": listing.job_to_be_done or description,
        "summary_for_model": _bounded_summary(listing, description),
        "trigger_conditions": [
            f"Use when the owner asks for {description.lower()}." if description else f"Use when the owner requests capability {listing.capability_key}.",
            f"Use when the task explicitly matches capability key '{listing.capability_key}'.",
            f"Use when the workflow needs the output of {listing.name}.",
        ],
        "do_not_use_when": [
            "Do not use when the request needs a different capability or lacks the required input context.",
        ],
        "permission_class": permission_class,
        "dry_run_supported": bool(listing.dry_run_supported),
        "requires_connected_accounts": [
            str(item)
            for item in raw.get("required_connected_accounts", [])
            if isinstance(item, str)
        ],
        "input_schema": input_schema,
        "output_schema": output_schema,
        "usage_hints": [
            text
            for text in (
                listing.short_description,
                f"Read docs at {listing.docs_url} before relying on provider-specific behavior." if listing.docs_url else None,
            )
            if text
        ]
        or [f"Invoke {listing.capability_key} with the fields described in its input schema."],
        "result_hints": [str(raw.get("result_summary") or "Return the provider result as structured JSON with a concise summary.")],
        "error_hints": [
            "If the invocation is denied or requires approval, surface the platform reason to the owner.",
        ],
    }
    if permission_class in {"action", "payment"}:
        tool_manual["approval_summary_template"] = f"Review {listing.name} before approving the external side effect."
        tool_manual["preview_schema"] = {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Preview of the action that would be executed after approval.",
                }
            },
            "required": ["summary"],
            "additionalProperties": True,
        }
        tool_manual["idempotency_support"] = True
        tool_manual["side_effect_summary"] = str(
            raw.get("receipt_summary")
            or raw.get("result_summary")
            or f"{listing.name} may perform an external side effect after approval."
        )
    if permission_class == "payment":
        tool_manual["quote_schema"] = {
            "type": "object",
            "properties": {
                "amount_minor": {"type": "integer", "description": "Quoted amount in minor units."},
                "currency": {"type": "string", "description": "Currency code for the quoted amount."},
            },
            "required": ["amount_minor", "currency"],
            "additionalProperties": True,
        }
        tool_manual["currency"] = listing.currency or "USD"
        tool_manual["settlement_mode"] = str(raw.get("settlement_mode") or "stripe_checkout")
        tool_manual["refund_or_cancellation_note"] = str(
            raw.get("refund_or_cancellation_note")
            or "Refunds and cancellations follow the seller policy shown on the listing."
        )
        tool_manual["jurisdiction"] = str(raw.get("jurisdiction") or "US")
    return tool_manual


def _bounded_summary(listing: AppListingRecord, description: str) -> str:
    summary = description or listing.name or listing.capability_key
    summary = re.sub(r"\s+", " ", summary).strip()
    if len(summary) < 10:
        summary = f"{listing.name} capability for {listing.capability_key}."
    return summary[:300]


def _build_execution_result(data: Mapping[str, Any], *, payload: Mapping[str, Any]) -> Any:
    from siglume_api_sdk import ApprovalRequestHint, ExecutionKind, ExecutionResult

    accepted = bool(data.get("accepted"))
    reason = str(data.get("reason") or "")
    reason_code = _string_or_none(data.get("reason_code"))
    usage_event = _to_dict(data.get("usage_event"))
    receipt = _to_dict(data.get("receipt"))
    execution_kind = _coerce_execution_kind(str(receipt.get("execution_kind") or payload.get("execution_kind") or "action"), ExecutionKind)
    # Use explicit None checks instead of `or` chains so a legitimate zero
    # (free execution, denied execution, metered-but-zero-units run) does
    # not silently collapse to the next fallback. The TS implementation
    # uses `??` for the same reason — keep parity.
    amount_minor_raw = receipt.get("amount_minor") if receipt.get("amount_minor") is not None else usage_event.get("amount_minor")
    amount_minor = int(amount_minor_raw) if amount_minor_raw is not None else 0
    currency = str(receipt.get("currency") or usage_event.get("currency") or "USD")
    units_raw = usage_event.get("units_consumed")
    units_consumed = int(units_raw) if units_raw is not None else 1
    if accepted:
        return ExecutionResult(
            success=True,
            output=_to_dict(data.get("result")),
            execution_kind=execution_kind,
            units_consumed=units_consumed,
            amount_minor=amount_minor,
            currency=currency,
            provider_status="ok",
            fallback_applied=bool(receipt.get("fallback_applied") or False),
            receipt_summary=receipt,
        )
    approval_request = _to_dict(data.get("approval_request"))
    approval_explanation = _to_dict(data.get("approval_explanation"))
    needs_approval = reason_code == "APPROVAL_REQUIRED" or bool(approval_request)
    approval_hint = None
    if needs_approval:
        preview = _to_dict(approval_explanation.get("preview"))
        approval_hint = ApprovalRequestHint(
            action_summary=str(approval_explanation.get("title") or approval_explanation.get("summary") or reason or "Owner approval required"),
            permission_class="payment" if str(execution_kind.value) == "payment" else "action",
            estimated_amount_minor=amount_minor or None,
            currency=currency if receipt.get("currency") else None,
            side_effects=[
                str(item)
                for item in approval_explanation.get("side_effects", [])
                if isinstance(item, str)
            ],
            preview=preview,
            reversible=False,
        )
    return ExecutionResult(
        success=False,
        output={
            "reason_code": reason_code,
            "approval_request": approval_request,
            "approval_explanation": approval_explanation,
        },
        execution_kind=execution_kind,
        units_consumed=units_consumed,
        amount_minor=amount_minor,
        currency=currency,
        provider_status="denied" if needs_approval or reason_code else "error",
        error_message=reason or reason_code,
        needs_approval=needs_approval,
        approval_prompt=(reason or "Owner approval is required.") if needs_approval else None,
        fallback_applied=bool(receipt.get("fallback_applied") or False),
        receipt_summary=receipt,
        approval_hint=approval_hint,
    )


def _coerce_execution_kind(value: str, execution_kind_enum: Any) -> Any:
    normalized = str(value or "action").strip().lower()
    try:
        if normalized == "dryrun":
            normalized = "dry_run"
        return execution_kind_enum(normalized)
    except Exception:  # pragma: no cover - defensive fallback
        return execution_kind_enum.ACTION


__all__ = [
    "CapabilityListing",
    "SiglumeBuyerClient",
    "SiglumeExperimentalError",
    "SiglumeExperimentalWarning",
    "Subscription",
]
