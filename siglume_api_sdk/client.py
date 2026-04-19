"""Typed HTTP client for the public Siglume developer API."""
from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field, is_dataclass
from enum import Enum
from typing import TYPE_CHECKING, Any, Callable, Generic, Iterator, Mapping, TypeVar

import httpx

if TYPE_CHECKING:
    from siglume_api_sdk import AppManifest, ToolManual


DEFAULT_SIGLUME_API_BASE = "https://api.siglume.com/v1"
RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503, 504})
T = TypeVar("T")


class SiglumeClientError(RuntimeError):
    """Base exception for local Siglume client failures."""


class SiglumeAPIError(SiglumeClientError):
    """Raised when the Siglume API returns a non-success response."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int,
        error_code: str | None = None,
        trace_id: str | None = None,
        request_id: str | None = None,
        details: dict[str, Any] | None = None,
        response_body: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.trace_id = trace_id
        self.request_id = request_id
        self.details = details or {}
        self.response_body = response_body


class SiglumeNotFoundError(SiglumeClientError):
    """Raised when a listing or related resource cannot be resolved."""


@dataclass
class EnvelopeMeta:
    request_id: str | None = None
    trace_id: str | None = None


@dataclass
class CursorPage(Generic[T]):
    items: list[T]
    next_cursor: str | None = None
    limit: int | None = None
    offset: int | None = None
    meta: EnvelopeMeta = field(default_factory=EnvelopeMeta)
    _fetch_next: Callable[[str], "CursorPage[T]"] | None = field(default=None, repr=False, compare=False)

    def pages(self) -> Iterator["CursorPage[T]"]:
        page: CursorPage[T] = self
        while True:
            yield page
            if not page.next_cursor or page._fetch_next is None:
                return
            page = page._fetch_next(page.next_cursor)

    def all_items(self) -> list[T]:
        results: list[T] = []
        for page in self.pages():
            results.extend(page.items)
        return results


@dataclass
class AppListingRecord:
    listing_id: str
    capability_key: str
    name: str
    status: str
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
    review_status: str | None = None
    review_note: str | None = None
    submission_blockers: list[str] = field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AutoRegistrationReceipt:
    listing_id: str
    status: str
    auto_manifest: dict[str, Any] = field(default_factory=dict)
    confidence: dict[str, Any] = field(default_factory=dict)
    review_url: str | None = None
    trace_id: str | None = None
    request_id: str | None = None


@dataclass
class RegistrationQuality:
    overall_score: int = 0
    grade: str = "F"
    issues: list[dict[str, Any]] = field(default_factory=list)
    improvement_suggestions: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class RegistrationConfirmation:
    listing_id: str
    status: str
    release: dict[str, Any] = field(default_factory=dict)
    quality: RegistrationQuality = field(default_factory=RegistrationQuality)
    trace_id: str | None = None
    request_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class DeveloperPortalSummary:
    seller_onboarding: dict[str, Any] | None = None
    platform: dict[str, Any] = field(default_factory=dict)
    monetization: dict[str, Any] = field(default_factory=dict)
    payout_readiness: dict[str, Any] = field(default_factory=dict)
    listings: dict[str, Any] = field(default_factory=dict)
    usage: dict[str, Any] = field(default_factory=dict)
    support: dict[str, Any] = field(default_factory=dict)
    apps: list[AppListingRecord] = field(default_factory=list)
    trace_id: str | None = None
    request_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class SandboxSession:
    session_id: str
    agent_id: str
    capability_key: str
    environment: str
    sandbox_support: str | None = None
    dry_run_supported: bool = False
    approval_mode: str | None = None
    required_connected_accounts: list[Any] = field(default_factory=list)
    connected_accounts: list[dict[str, Any]] = field(default_factory=list)
    stub_providers_enabled: bool = False
    simulated_receipts: bool = False
    approval_simulator: bool = False
    trace_id: str | None = None
    request_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AccessGrantRecord:
    access_grant_id: str
    capability_listing_id: str
    grant_status: str
    billing_model: str | None = None
    agent_id: str | None = None
    starts_at: str | None = None
    ends_at: str | None = None
    bindings: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class CapabilityBindingRecord:
    binding_id: str
    access_grant_id: str
    agent_id: str
    binding_status: str
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class GrantBindingResult:
    binding: CapabilityBindingRecord
    access_grant: AccessGrantRecord
    trace_id: str | None = None
    request_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class ConnectedAccountRecord:
    connected_account_id: str
    provider_key: str
    account_role: str
    display_name: str | None = None
    environment: str | None = None
    connection_status: str | None = None
    scopes: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class UsageEventRecord:
    usage_event_id: str
    capability_key: str | None = None
    agent_id: str | None = None
    environment: str | None = None
    task_type: str | None = None
    units_consumed: int = 0
    outcome: str | None = None
    execution_kind: str | None = None
    permission_class: str | None = None
    approval_mode: str | None = None
    latency_ms: int | None = None
    trace_id: str | None = None
    period_key: str | None = None
    created_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class SupportCaseRecord:
    support_case_id: str
    case_type: str
    summary: str
    status: str
    capability_key: str | None = None
    agent_id: str | None = None
    trace_id: str | None = None
    environment: str | None = None
    resolution_note: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


def _string_or_none(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _to_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _enum_value(value: Any) -> Any:
    return value.value if isinstance(value, Enum) else value


def _to_plain_jsonable(value: Any) -> Any:
    if hasattr(value, "to_dict") and callable(value.to_dict):
        return _to_plain_jsonable(value.to_dict())
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return _to_plain_jsonable(asdict(value))
    if isinstance(value, Mapping):
        return {str(key): _to_plain_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_plain_jsonable(item) for item in value]
    return value


def _coerce_mapping(value: Any, label: str) -> dict[str, Any]:
    payload = _to_plain_jsonable(value)
    if not isinstance(payload, dict):
        raise TypeError(f"{label} must be a mapping-like object")
    return payload


def _build_default_i18n(manifest_payload: Mapping[str, Any]) -> dict[str, str]:
    job = str(manifest_payload.get("job_to_be_done") or "").strip()
    short_description = str(
        manifest_payload.get("short_description")
        or manifest_payload.get("job_to_be_done")
        or manifest_payload.get("name")
        or ""
    ).strip()
    return {
        "job_to_be_done_en": job,
        "job_to_be_done_ja": job,
        "short_description_en": short_description,
        "short_description_ja": short_description,
    }


def _camel_case_from_capability_key(capability_key: str) -> str:
    words = [part for part in capability_key.replace("_", "-").split("-") if part]
    if not words:
        return "GeneratedRegistrationApp"
    return "".join(word[:1].upper() + word[1:] for word in words) + "App"


def _build_registration_stub_source(
    manifest_payload: Mapping[str, Any],
    tool_manual_payload: Mapping[str, Any],
) -> str:
    capability_key = str(manifest_payload.get("capability_key") or "generated-registration")
    job_to_be_done = str(
        manifest_payload.get("job_to_be_done")
        or tool_manual_payload.get("job_to_be_done")
        or "Register this API listing on Siglume."
    )
    name = str(manifest_payload.get("name") or capability_key.replace("-", " ").title())
    class_name = _camel_case_from_capability_key(capability_key)
    return "\n".join(
        [
            '"""Registration bootstrap generated by SiglumeClient."""',
            "from siglume_api_sdk import AppAdapter",
            "",
            f"class {class_name}(AppAdapter):",
            f"    capability_key = {json.dumps(capability_key)}",
            f"    name = {json.dumps(name)}",
            f"    job_to_be_done = {json.dumps(job_to_be_done)}",
            "",
            "    def manifest(self):",
            "        raise NotImplementedError('Registration bootstrap source is metadata-only.')",
            "",
            "    async def execute(self, ctx):",
            "        raise NotImplementedError('Registration bootstrap source is metadata-only.')",
            "",
        ]
    )


def _parse_retry_after(response: httpx.Response) -> float | None:
    retry_after = response.headers.get("Retry-After")
    if retry_after is None:
        return None
    try:
        return max(float(retry_after), 0.0)
    except ValueError:
        return None


def _parse_listing(data: Mapping[str, Any]) -> AppListingRecord:
    listing_id = str(data.get("listing_id") or data.get("id") or "")
    return AppListingRecord(
        listing_id=listing_id,
        capability_key=str(data.get("capability_key") or ""),
        name=str(data.get("name") or ""),
        status=str(data.get("status") or ""),
        category=_string_or_none(data.get("category")),
        job_to_be_done=_string_or_none(data.get("job_to_be_done")),
        permission_class=_string_or_none(data.get("permission_class")),
        approval_mode=_string_or_none(data.get("approval_mode")),
        dry_run_supported=bool(data.get("dry_run_supported") or False),
        price_model=_string_or_none(data.get("price_model")),
        price_value_minor=int(data.get("price_value_minor") or 0),
        currency=str(data.get("currency") or "USD"),
        short_description=_string_or_none(data.get("short_description")),
        docs_url=_string_or_none(data.get("docs_url")),
        support_contact=_string_or_none(data.get("support_contact")),
        review_status=_string_or_none(data.get("review_status")),
        review_note=_string_or_none(data.get("review_note")),
        submission_blockers=[
            str(item) for item in data.get("submission_blockers", []) if isinstance(item, str)
        ],
        created_at=_string_or_none(data.get("created_at")),
        updated_at=_string_or_none(data.get("updated_at")),
        raw=dict(data),
    )


def _parse_registration_quality(data: Mapping[str, Any]) -> RegistrationQuality:
    score = int(data.get("overall_score") or data.get("score") or 0)
    issues = data.get("issues") if isinstance(data.get("issues"), list) else []
    suggestions = data.get("improvement_suggestions") if isinstance(data.get("improvement_suggestions"), list) else []
    return RegistrationQuality(
        overall_score=score,
        grade=str(data.get("grade") or "F"),
        issues=[dict(item) for item in issues if isinstance(item, Mapping)],
        improvement_suggestions=[str(item) for item in suggestions if isinstance(item, str)],
        raw=dict(data),
    )


def _parse_developer_portal(data: Mapping[str, Any], meta: EnvelopeMeta) -> DeveloperPortalSummary:
    apps = data.get("apps") if isinstance(data.get("apps"), list) else []
    return DeveloperPortalSummary(
        seller_onboarding=_to_dict(data.get("seller_onboarding")) or None,
        platform=_to_dict(data.get("platform")),
        monetization=_to_dict(data.get("monetization")),
        payout_readiness=_to_dict(data.get("payout_readiness")),
        listings=_to_dict(data.get("listings")),
        usage=_to_dict(data.get("usage")),
        support=_to_dict(data.get("support")),
        apps=[_parse_listing(item) for item in apps if isinstance(item, Mapping)],
        trace_id=meta.trace_id,
        request_id=meta.request_id,
        raw=dict(data),
    )


def _parse_sandbox_session(data: Mapping[str, Any], meta: EnvelopeMeta) -> SandboxSession:
    connected_accounts = data.get("connected_accounts") if isinstance(data.get("connected_accounts"), list) else []
    required_connected_accounts = (
        data.get("required_connected_accounts") if isinstance(data.get("required_connected_accounts"), list) else []
    )
    return SandboxSession(
        session_id=str(data.get("session_id") or ""),
        agent_id=str(data.get("agent_id") or ""),
        capability_key=str(data.get("capability_key") or ""),
        environment=str(data.get("environment") or "sandbox"),
        sandbox_support=_string_or_none(data.get("sandbox_support")),
        dry_run_supported=bool(data.get("dry_run_supported") or False),
        approval_mode=_string_or_none(data.get("approval_mode")),
        required_connected_accounts=list(required_connected_accounts),
        connected_accounts=[dict(item) for item in connected_accounts if isinstance(item, Mapping)],
        stub_providers_enabled=bool(data.get("stub_providers_enabled") or False),
        simulated_receipts=bool(data.get("simulated_receipts") or False),
        approval_simulator=bool(data.get("approval_simulator") or False),
        trace_id=meta.trace_id,
        request_id=meta.request_id,
        raw=dict(data),
    )


def _parse_access_grant(data: Mapping[str, Any]) -> AccessGrantRecord:
    bindings = data.get("bindings") if isinstance(data.get("bindings"), list) else []
    return AccessGrantRecord(
        access_grant_id=str(data.get("access_grant_id") or data.get("id") or ""),
        capability_listing_id=str(data.get("capability_listing_id") or ""),
        grant_status=str(data.get("grant_status") or ""),
        billing_model=_string_or_none(data.get("billing_model")),
        agent_id=_string_or_none(data.get("agent_id")),
        starts_at=_string_or_none(data.get("starts_at")),
        ends_at=_string_or_none(data.get("ends_at")),
        bindings=[dict(item) for item in bindings if isinstance(item, Mapping)],
        metadata=_to_dict(data.get("metadata")),
        raw=dict(data),
    )


def _parse_binding(data: Mapping[str, Any]) -> CapabilityBindingRecord:
    return CapabilityBindingRecord(
        binding_id=str(data.get("binding_id") or data.get("id") or ""),
        access_grant_id=str(data.get("access_grant_id") or ""),
        agent_id=str(data.get("agent_id") or ""),
        binding_status=str(data.get("binding_status") or ""),
        created_at=_string_or_none(data.get("created_at")),
        updated_at=_string_or_none(data.get("updated_at")),
        raw=dict(data),
    )


def _parse_connected_account(data: Mapping[str, Any]) -> ConnectedAccountRecord:
    scopes = data.get("scopes") if isinstance(data.get("scopes"), list) else []
    return ConnectedAccountRecord(
        connected_account_id=str(data.get("connected_account_id") or data.get("id") or ""),
        provider_key=str(data.get("provider_key") or ""),
        account_role=str(data.get("account_role") or ""),
        display_name=_string_or_none(data.get("display_name")),
        environment=_string_or_none(data.get("environment")),
        connection_status=_string_or_none(data.get("connection_status")),
        scopes=[str(item) for item in scopes if isinstance(item, str)],
        metadata=_to_dict(data.get("metadata")),
        created_at=_string_or_none(data.get("created_at")),
        updated_at=_string_or_none(data.get("updated_at")),
        raw=dict(data),
    )


def _parse_usage_event(data: Mapping[str, Any]) -> UsageEventRecord:
    return UsageEventRecord(
        usage_event_id=str(data.get("usage_event_id") or data.get("id") or ""),
        capability_key=_string_or_none(data.get("capability_key")),
        agent_id=_string_or_none(data.get("agent_id")),
        environment=_string_or_none(data.get("environment")),
        task_type=_string_or_none(data.get("task_type")),
        units_consumed=int(data.get("units_consumed") or 0),
        outcome=_string_or_none(data.get("outcome")),
        execution_kind=_string_or_none(data.get("execution_kind")),
        permission_class=_string_or_none(data.get("permission_class")),
        approval_mode=_string_or_none(data.get("approval_mode")),
        latency_ms=int(data["latency_ms"]) if data.get("latency_ms") is not None else None,
        trace_id=_string_or_none(data.get("trace_id")),
        period_key=_string_or_none(data.get("period_key")),
        created_at=_string_or_none(data.get("created_at")),
        metadata=_to_dict(data.get("metadata")),
        raw=dict(data),
    )


def _parse_support_case(data: Mapping[str, Any]) -> SupportCaseRecord:
    return SupportCaseRecord(
        support_case_id=str(data.get("support_case_id") or data.get("id") or ""),
        case_type=str(data.get("case_type") or ""),
        summary=str(data.get("summary") or ""),
        status=str(data.get("status") or ""),
        capability_key=_string_or_none(data.get("capability_key")),
        agent_id=_string_or_none(data.get("agent_id")),
        trace_id=_string_or_none(data.get("trace_id")),
        environment=_string_or_none(data.get("environment")),
        resolution_note=_string_or_none(data.get("resolution_note")),
        metadata=_to_dict(data.get("metadata")),
        created_at=_string_or_none(data.get("created_at")),
        updated_at=_string_or_none(data.get("updated_at")),
        raw=dict(data),
    )


def _build_tool_manual_quality_report(payload: Mapping[str, Any]):
    from siglume_api_sdk import ToolManualIssue, ToolManualQualityReport

    quality_block = payload.get("quality") if isinstance(payload.get("quality"), Mapping) else payload
    issues: list[ToolManualIssue] = []
    validation_errors: list[ToolManualIssue] = []
    validation_warnings: list[ToolManualIssue] = []

    for bucket_name in ("errors", "warnings"):
        bucket = payload.get(bucket_name)
        if isinstance(bucket, list):
            default_severity = "error" if bucket_name == "errors" else "warning"
            for item in bucket:
                if not isinstance(item, Mapping):
                    continue
                issue = ToolManualIssue(
                    code=str(item.get("code") or bucket_name.upper()),
                    message=str(item.get("message") or ""),
                    field=_string_or_none(item.get("field")),
                    severity=default_severity,
                )
                issues.append(issue)
                if bucket_name == "errors":
                    validation_errors.append(issue)
                else:
                    validation_warnings.append(issue)

    quality_issues = quality_block.get("issues") if isinstance(quality_block, Mapping) else None
    if isinstance(quality_issues, list):
        for item in quality_issues:
            if not isinstance(item, Mapping):
                continue
            issues.append(
                ToolManualIssue(
                    code=str(item.get("category") or item.get("code") or "QUALITY_ISSUE"),
                    message=str(item.get("message") or ""),
                    field=_string_or_none(item.get("field")),
                    severity=str(item.get("severity") or "warning"),
                    suggestion=_string_or_none(item.get("suggestion")),
                )
            )

    suggestions = quality_block.get("improvement_suggestions") if isinstance(quality_block, Mapping) else None
    if isinstance(quality_block, Mapping):
        keyword_coverage_value = quality_block.get("keyword_coverage_estimate")
        if keyword_coverage_value is None:
            keyword_coverage_value = quality_block.get("keyword_coverage")
        score_value = quality_block.get("overall_score")
        if score_value is None:
            score_value = quality_block.get("score")
    else:
        keyword_coverage_value = 0
        score_value = 0
    keyword_coverage = int(keyword_coverage_value or 0)
    score = int(score_value or 0)
    validation_ok = bool(payload.get("ok")) if payload.get("ok") is not None else True
    publishable_value = quality_block.get("publishable") if isinstance(quality_block, Mapping) else None
    publishable = (
        bool(publishable_value)
        if publishable_value is not None
        else validation_ok and str(quality_block.get("grade") or "F") in {"A", "B"}
    )
    return ToolManualQualityReport(
        overall_score=score,
        grade=str(quality_block.get("grade") or "F") if isinstance(quality_block, Mapping) else "F",
        issues=issues,
        keyword_coverage_estimate=keyword_coverage,
        improvement_suggestions=[str(item) for item in suggestions if isinstance(item, str)] if isinstance(suggestions, list) else [],
        publishable=publishable,
        validation_ok=validation_ok,
        validation_errors=validation_errors,
        validation_warnings=validation_warnings,
    )


class SiglumeClient:
    """Typed HTTP client for the public Siglume developer API."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str | None = None,
        timeout: float = 15.0,
        max_retries: int = 3,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not api_key:
            raise SiglumeClientError("SIGLUME_API_KEY is required.")
        self.api_key = api_key
        self.base_url = (base_url or os.environ.get("SIGLUME_API_BASE") or DEFAULT_SIGLUME_API_BASE).rstrip("/")
        self.max_retries = max(1, int(max_retries))
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            transport=transport,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
                "User-Agent": "siglume-api-sdk/0.4.0",
            },
        )
        self._pending_confirmations: dict[str, dict[str, Any]] = {}

    def __enter__(self) -> "SiglumeClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def auto_register(
        self,
        manifest: "AppManifest | Mapping[str, Any]",
        tool_manual: "ToolManual | Mapping[str, Any]",
        *,
        source_code: str | None = None,
        source_url: str | None = None,
    ) -> AutoRegistrationReceipt:
        manifest_payload = _coerce_mapping(manifest, "manifest")
        tool_manual_payload = _coerce_mapping(tool_manual, "tool_manual")
        payload: dict[str, Any] = {"i18n": _build_default_i18n(manifest_payload)}
        if source_url:
            payload["source_url"] = source_url
        elif source_code is not None:
            payload["source_code"] = source_code
        else:
            payload["source_code"] = _build_registration_stub_source(manifest_payload, tool_manual_payload)
        for field_name in ("capability_key", "name", "price_model", "price_value_minor"):
            value = manifest_payload.get(field_name)
            if value is not None:
                payload[field_name] = _enum_value(value)
        data, meta = self._request("POST", "/market/capabilities/auto-register", json_body=payload)
        listing_id = str(data.get("listing_id") or "")
        if not listing_id:
            raise SiglumeClientError("Siglume auto-register response did not include listing_id.")
        self._pending_confirmations[listing_id] = {
            "manifest": manifest_payload,
            "tool_manual": tool_manual_payload,
        }
        return AutoRegistrationReceipt(
            listing_id=listing_id,
            status=str(data.get("status") or "draft"),
            auto_manifest=_to_dict(data.get("auto_manifest")),
            confidence=_to_dict(data.get("confidence")),
            review_url=_string_or_none(data.get("review_url")),
            trace_id=meta.trace_id,
            request_id=meta.request_id,
        )

    def confirm_registration(
        self,
        listing_id: str,
        *,
        manifest: "AppManifest | Mapping[str, Any] | None" = None,
        tool_manual: "ToolManual | Mapping[str, Any] | None" = None,
    ) -> RegistrationConfirmation:
        pending = self._pending_confirmations.get(listing_id, {})
        manifest_payload = _coerce_mapping(manifest, "manifest") if manifest is not None else _to_dict(pending.get("manifest"))
        tool_manual_payload = _coerce_mapping(tool_manual, "tool_manual") if tool_manual is not None else _to_dict(pending.get("tool_manual"))
        overrides: dict[str, Any] = {}
        for field_name in ("name", "job_to_be_done"):
            value = manifest_payload.get(field_name)
            if value:
                overrides[field_name] = value
        if tool_manual_payload:
            overrides["tool_manual"] = tool_manual_payload
        payload: dict[str, Any] = {"approved": True}
        if overrides:
            payload["overrides"] = overrides
        data, meta = self._request(
            "POST",
            f"/market/capabilities/{listing_id}/confirm-auto-register",
            json_body=payload,
        )
        self._pending_confirmations.pop(listing_id, None)
        quality = _parse_registration_quality(_to_dict(data.get("quality")))
        return RegistrationConfirmation(
            listing_id=str(data.get("listing_id") or listing_id),
            status=str(data.get("status") or ""),
            release=_to_dict(data.get("release")),
            quality=quality,
            trace_id=meta.trace_id,
            request_id=meta.request_id,
            raw=dict(data),
        )

    def submit_review(self, listing_id: str) -> AppListingRecord:
        data, _meta = self._request("POST", f"/market/capabilities/{listing_id}/submit-review")
        return _parse_listing(data)

    def preview_quality_score(self, tool_manual: "ToolManual | Mapping[str, Any]"):
        tool_manual_payload = _coerce_mapping(tool_manual, "tool_manual")
        data, _meta = self._request(
            "POST",
            "/market/tool-manuals/preview-quality",
            json_body={"tool_manual": tool_manual_payload},
        )
        return _build_tool_manual_quality_report(data)

    def list_capabilities(
        self,
        *,
        mine: bool | None = None,
        status: str | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> CursorPage[AppListingRecord]:
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 100))}
        if mine is not None:
            params["mine"] = str(mine).lower()
        if status:
            params["status"] = status
        if cursor:
            params["cursor"] = cursor
        data, meta = self._request("GET", "/market/capabilities", params=params)
        items = data.get("items") if isinstance(data.get("items"), list) else []
        next_cursor = _string_or_none(data.get("next_cursor"))
        return CursorPage(
            items=[_parse_listing(item) for item in items if isinstance(item, Mapping)],
            next_cursor=next_cursor,
            limit=int(data["limit"]) if data.get("limit") is not None else params["limit"],
            offset=int(data["offset"]) if data.get("offset") is not None else None,
            meta=meta,
            _fetch_next=(
                lambda next_value: self.list_capabilities(
                    mine=mine,
                    status=status,
                    limit=limit,
                    cursor=next_value,
                )
            ) if next_cursor else None,
        )

    def list_my_listings(
        self,
        *,
        status: str | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> CursorPage[AppListingRecord]:
        return self.list_capabilities(mine=True, status=status, limit=limit, cursor=cursor)

    def get_listing(self, listing_id: str) -> AppListingRecord:
        data, _meta = self._request("GET", f"/market/capabilities/{listing_id}")
        return _parse_listing(data)

    def get_developer_portal(self) -> DeveloperPortalSummary:
        data, meta = self._request("GET", "/market/developer/portal")
        return _parse_developer_portal(data, meta)

    def create_sandbox_session(self, *, agent_id: str, capability_key: str) -> SandboxSession:
        data, meta = self._request(
            "POST",
            "/market/sandbox/sessions",
            json_body={
                "agent_id": agent_id,
                "capability_key": capability_key,
            },
        )
        return _parse_sandbox_session(data, meta)

    def get_usage(
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
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 100))}
        if capability_key:
            params["capability_key"] = capability_key
        if agent_id:
            params["agent_id"] = agent_id
        if outcome:
            params["outcome"] = outcome
        if environment:
            params["environment"] = environment
        if period_key:
            params["period_key"] = period_key
        if cursor:
            params["cursor"] = cursor
        data, meta = self._request("GET", "/market/usage", params=params)
        items = data.get("items") if isinstance(data.get("items"), list) else []
        next_cursor = _string_or_none(data.get("next_cursor"))
        return CursorPage(
            items=[_parse_usage_event(item) for item in items if isinstance(item, Mapping)],
            next_cursor=next_cursor,
            limit=int(data["limit"]) if data.get("limit") is not None else params["limit"],
            offset=int(data["offset"]) if data.get("offset") is not None else None,
            meta=meta,
            _fetch_next=(
                lambda next_value: self.get_usage(
                    capability_key=capability_key,
                    agent_id=agent_id,
                    outcome=outcome,
                    environment=environment,
                    period_key=period_key,
                    limit=limit,
                    cursor=next_value,
                )
            ) if next_cursor else None,
        )

    def list_access_grants(
        self,
        *,
        status: str | None = None,
        agent_id: str | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> CursorPage[AccessGrantRecord]:
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 100))}
        if status:
            params["status"] = status
        if agent_id:
            params["agent_id"] = agent_id
        if cursor:
            params["cursor"] = cursor
        data, meta = self._request("GET", "/market/access-grants", params=params)
        items = data.get("items") if isinstance(data.get("items"), list) else []
        next_cursor = _string_or_none(data.get("next_cursor"))
        return CursorPage(
            items=[_parse_access_grant(item) for item in items if isinstance(item, Mapping)],
            next_cursor=next_cursor,
            limit=int(data["limit"]) if data.get("limit") is not None else params["limit"],
            offset=int(data["offset"]) if data.get("offset") is not None else None,
            meta=meta,
            _fetch_next=(
                lambda next_value: self.list_access_grants(
                    status=status,
                    agent_id=agent_id,
                    limit=limit,
                    cursor=next_value,
                )
            ) if next_cursor else None,
        )

    def bind_agent_to_grant(
        self,
        grant_id: str,
        *,
        agent_id: str,
        binding_status: str = "active",
    ) -> GrantBindingResult:
        data, meta = self._request(
            "POST",
            f"/market/access-grants/{grant_id}/bind-agent",
            json_body={
                "agent_id": agent_id,
                "binding_status": binding_status,
            },
        )
        binding = _parse_binding(_to_dict(data.get("binding")))
        access_grant = _parse_access_grant(_to_dict(data.get("access_grant")))
        return GrantBindingResult(
            binding=binding,
            access_grant=access_grant,
            trace_id=meta.trace_id,
            request_id=meta.request_id,
            raw=dict(data),
        )

    def list_connected_accounts(
        self,
        *,
        provider_key: str | None = None,
        environment: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> CursorPage[ConnectedAccountRecord]:
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 100))}
        if provider_key:
            params["provider_key"] = provider_key
        if environment:
            params["environment"] = environment
        if cursor:
            params["cursor"] = cursor
        data, meta = self._request("GET", "/market/connected-accounts", params=params)
        items = data.get("items") if isinstance(data.get("items"), list) else []
        next_cursor = _string_or_none(data.get("next_cursor"))
        return CursorPage(
            items=[_parse_connected_account(item) for item in items if isinstance(item, Mapping)],
            next_cursor=next_cursor,
            limit=int(data["limit"]) if data.get("limit") is not None else params["limit"],
            offset=int(data["offset"]) if data.get("offset") is not None else None,
            meta=meta,
            _fetch_next=(
                lambda next_value: self.list_connected_accounts(
                    provider_key=provider_key,
                    environment=environment,
                    limit=limit,
                    cursor=next_value,
                )
            ) if next_cursor else None,
        )

    def create_support_case(
        self,
        subject: str,
        body: str,
        *,
        trace_id: str | None = None,
        case_type: str = "app_execution",
        capability_key: str | None = None,
        agent_id: str | None = None,
        environment: str = "live",
    ) -> SupportCaseRecord:
        summary = subject.strip()
        details = body.strip()
        composed_summary = summary if not details else f"{summary}\n\n{details}"
        if not composed_summary:
            raise SiglumeClientError("Support case subject or body is required.")
        if len(composed_summary) > 2000:
            raise SiglumeClientError("Support case summary/body must fit within the 2000 character API limit.")
        payload: dict[str, Any] = {
            "case_type": case_type,
            "summary": composed_summary,
            "environment": environment,
        }
        if capability_key:
            payload["capability_key"] = capability_key
        if agent_id:
            payload["agent_id"] = agent_id
        if trace_id:
            payload["trace_id"] = trace_id
        data, _meta = self._request("POST", "/market/support-cases", json_body=payload)
        return _parse_support_case(data)

    def list_support_cases(
        self,
        *,
        status: str | None = None,
        capability_key: str | None = None,
        agent_id: str | None = None,
        environment: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> CursorPage[SupportCaseRecord]:
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 100))}
        if status:
            params["status"] = status
        if capability_key:
            params["capability_key"] = capability_key
        if agent_id:
            params["agent_id"] = agent_id
        if environment:
            params["environment"] = environment
        if cursor:
            params["cursor"] = cursor
        data, meta = self._request("GET", "/market/support-cases", params=params)
        items = data.get("items") if isinstance(data.get("items"), list) else []
        next_cursor = _string_or_none(data.get("next_cursor"))
        return CursorPage(
            items=[_parse_support_case(item) for item in items if isinstance(item, Mapping)],
            next_cursor=next_cursor,
            limit=int(data["limit"]) if data.get("limit") is not None else params["limit"],
            offset=int(data["offset"]) if data.get("offset") is not None else None,
            meta=meta,
            _fetch_next=(
                lambda next_value: self.list_support_cases(
                    status=status,
                    capability_key=capability_key,
                    agent_id=agent_id,
                    environment=environment,
                    limit=limit,
                    cursor=next_value,
                )
            ) if next_cursor else None,
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any | None = None,
        params: Mapping[str, Any] | None = None,
    ) -> tuple[dict[str, Any], EnvelopeMeta]:
        for attempt in range(self.max_retries):
            response = self._client.request(method, path, json=json_body, params=params)
            if response.status_code in RETRYABLE_STATUS_CODES and attempt + 1 < self.max_retries:
                delay = _parse_retry_after(response)
                if delay is None:
                    delay = 0.5 * (2 ** attempt)
                time.sleep(delay)
                continue
            return self._handle_response(response)
        raise SiglumeClientError("Retry loop exhausted unexpectedly.")

    def _handle_response(self, response: httpx.Response) -> tuple[dict[str, Any], EnvelopeMeta]:
        try:
            payload = response.json()
        except ValueError:
            payload = {"_raw_text": response.text}

        meta_payload = payload.get("meta") if isinstance(payload, Mapping) else None
        meta = EnvelopeMeta(
            request_id=_string_or_none(meta_payload.get("request_id")) if isinstance(meta_payload, Mapping) else None,
            trace_id=_string_or_none(meta_payload.get("trace_id")) if isinstance(meta_payload, Mapping) else None,
        )
        error_payload = payload.get("error") if isinstance(payload, Mapping) else None
        if response.is_error or error_payload:
            error_source = error_payload if isinstance(error_payload, Mapping) else payload
            message = "Siglume API request failed."
            error_code = None
            details = None
            if isinstance(error_source, Mapping):
                message = str(error_source.get("message") or message)
                error_code = _string_or_none(error_source.get("code"))
                details = _to_dict(error_source.get("details"))
            elif isinstance(payload, Mapping) and "_raw_text" in payload:
                message = str(payload.get("_raw_text") or message)
            raise SiglumeAPIError(
                message,
                status_code=response.status_code,
                error_code=error_code,
                trace_id=meta.trace_id or _string_or_none(response.headers.get("X-Trace-Id")),
                request_id=meta.request_id or _string_or_none(response.headers.get("X-Request-Id")),
                details=details,
                response_body=payload,
            )

        data = payload.get("data") if isinstance(payload, Mapping) and "data" in payload else payload
        if not isinstance(data, Mapping):
            raise SiglumeClientError("Expected the Siglume API response body to be an object.")
        return dict(data), meta
