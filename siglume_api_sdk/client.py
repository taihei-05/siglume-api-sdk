"""Typed HTTP client for the public Siglume developer API."""
from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field, is_dataclass
from enum import Enum
from typing import TYPE_CHECKING, Any, Callable, Generic, Iterator, Mapping, Sequence, TypeVar
from urllib.parse import quote

import httpx

from .operations import (
    OperationMetadata,
    build_operation_metadata,
    fallback_operation_catalog,
)
from .webhooks import (
    QueuedWebhookEvent,
    WebhookDeliveryRecord,
    WebhookSubscriptionRecord,
    parse_queued_webhook_event,
    parse_webhook_delivery,
    parse_webhook_subscription,
)
from .web3 import (
    CrossCurrencyQuote,
    EmbeddedWalletCharge,
    PolygonMandate,
    SettlementReceipt,
    parse_cross_currency_quote,
    parse_embedded_wallet_charge,
    parse_polygon_mandate,
    parse_settlement_receipt,
)

if TYPE_CHECKING:
    from siglume_api_sdk import AppManifest, ToolManual


DEFAULT_SIGLUME_API_BASE = "https://siglume.com/v1"
RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503, 504})
MINIMUM_JPY_OPERATION_PRICE_MINOR = 15
_MINIMUM_JPY_OPERATION_PRICE_CURRENCIES = {"JPY", "JPYC"}
LISTING_SHORT_DESCRIPTION_MAX_LENGTH = 60
LISTING_JOB_TO_BE_DONE_MAX_LENGTH = 240
LISTING_DESCRIPTION_MAX_LENGTH = 1000
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
    pricing_plan: dict[str, Any] | None = None
    billing_timing: str = "post"
    currency: str = "USD"
    allow_free_trial: bool = False
    free_trial_duration_days: int = 30
    short_description: str | None = None
    description: str | None = None
    docs_url: str | None = None
    support_contact: str | None = None
    seller_display_name: str | None = None
    seller_homepage_url: str | None = None
    seller_social_url: str | None = None
    review_status: str | None = None
    review_note: str | None = None
    submission_blockers: list[str] = field(default_factory=list)
    persistence: dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class CapabilitySaveStateRecord:
    capability_key: str
    save_key: str
    schema_version: str = "1"
    revision: int = 0
    payload: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    checksum: str | None = None
    updated_at: str | None = None
    created_at: str | None = None
    exists: bool = False
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AutoRegistrationReceipt:
    listing_id: str
    status: str
    registration_mode: str | None = None
    listing_status: str | None = None
    auto_manifest: dict[str, Any] = field(default_factory=dict)
    confidence: dict[str, Any] = field(default_factory=dict)
    validation_report: dict[str, Any] = field(default_factory=dict)
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
    message: str = ""
    checklist: dict[str, bool] = field(default_factory=dict)
    visibility: str | None = None


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
class UsageEventRecord:
    usage_event_id: str
    capability_key: str | None = None
    agent_id: str | None = None
    dimension: str | None = None
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
    external_id: str | None = None
    occurred_at_iso: str | None = None
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


@dataclass
class AgentRecord:
    agent_id: str
    name: str
    avatar_url: str | None = None
    description: str | None = None
    agent_type: str | None = None
    status: str | None = None
    expertise: list[str] = field(default_factory=list)
    paused: bool | None = None
    style: str | None = None
    manifesto_text: str | None = None
    capabilities: dict[str, Any] = field(default_factory=dict)
    settings: dict[str, Any] = field(default_factory=dict)
    growth: dict[str, Any] = field(default_factory=dict)
    plan: dict[str, Any] = field(default_factory=dict)
    reputation: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AgentCharter:
    charter_id: str
    agent_id: str
    principal_user_id: str | None = None
    version: int = 1
    active: bool = True
    role: str = "hybrid"
    charter_text: str | None = None
    goals: dict[str, Any] = field(default_factory=dict)
    target_profile: dict[str, Any] = field(default_factory=dict)
    qualification_criteria: dict[str, Any] = field(default_factory=dict)
    success_metrics: dict[str, Any] = field(default_factory=dict)
    constraints: dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class ApprovalPolicy:
    approval_policy_id: str
    agent_id: str
    principal_user_id: str | None = None
    version: int = 1
    active: bool = True
    auto_approve_below: dict[str, int] = field(default_factory=dict)
    always_require_approval_for: list[str] = field(default_factory=list)
    deny_if: dict[str, Any] = field(default_factory=dict)
    approval_ttl_minutes: int = 1440
    structured_only: bool = True
    default_requires_approval: bool = True
    merchant_allowlist: list[str] = field(default_factory=list)
    merchant_denylist: list[str] = field(default_factory=list)
    category_allowlist: list[str] = field(default_factory=list)
    category_denylist: list[str] = field(default_factory=list)
    risk_policy: dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class BudgetPolicy:
    budget_id: str
    agent_id: str
    principal_user_id: str | None = None
    currency: str = "JPY"
    period_start: str | None = None
    period_end: str | None = None
    period_limit_minor: int = 0
    spent_minor: int = 0
    reserved_minor: int = 0
    per_order_limit_minor: int = 0
    auto_approve_below_minor: int = 0
    limits: dict[str, int] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class InstalledToolRecord:
    binding_id: str
    listing_id: str
    release_id: str | None = None
    display_name: str | None = None
    permission_class: str | None = None
    binding_status: str | None = None
    account_readiness: str | None = None
    settlement_mode: str | None = None
    settlement_currency: str | None = None
    settlement_network: str | None = None
    accepted_payment_tokens: list[str] = field(default_factory=list)
    last_used_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class InstalledToolConnectionReadiness:
    agent_id: str
    all_ready: bool = True
    bindings: dict[str, str] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class InstalledToolBindingPolicyRecord:
    policy_id: str
    capability_listing_id: str | None = None
    owner_user_id: str | None = None
    permission_class: str | None = None
    max_calls_per_day: int | None = None
    monthly_usage_cap: int | None = None
    max_spend_per_execution: int | None = None
    allowed_tasks_jsonb: list[str] = field(default_factory=list)
    allowed_source_types_jsonb: list[str] = field(default_factory=list)
    timeout_ms: int | None = None
    cooldown_seconds: int | None = None
    require_owner_approval: bool = False
    require_owner_approval_over_cost: int | None = None
    dry_run_only: bool = False
    retry_policy_jsonb: dict[str, Any] = field(default_factory=dict)
    fallback_mode: str | None = None
    auto_execute_read_only: bool = True
    allow_background_execution: bool = False
    max_calls_per_hour: int | None = None
    max_chain_steps: int | None = None
    max_parallel_executions: int = 1
    max_spend_usd_cents_per_day: int | None = None
    approval_mode: str = "always_ask"
    kill_switch_state: str = "active"
    allowed_connected_account_ids_jsonb: list[str] = field(default_factory=list)
    metadata_jsonb: dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class InstalledToolPolicyUpdateResult:
    agent_id: str
    operation_key: str
    status: str
    approval_required: bool = False
    intent_id: str | None = None
    approval_status: str | None = None
    approval_snapshot_hash: str | None = None
    message: str = ""
    action: dict[str, Any] = field(default_factory=dict)
    preview: dict[str, Any] = field(default_factory=dict)
    safety: dict[str, Any] = field(default_factory=dict)
    policy: InstalledToolBindingPolicyRecord | None = None
    trace_id: str | None = None
    request_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class InstalledToolExecutionRecord:
    intent_id: str
    agent_id: str
    owner_user_id: str | None = None
    binding_id: str | None = None
    release_id: str | None = None
    source: str | None = None
    goal: str | None = None
    input_payload_jsonb: dict[str, Any] = field(default_factory=dict)
    plan_jsonb: dict[str, Any] = field(default_factory=dict)
    status: str = ""
    approval_status: str | None = None
    approval_snapshot_hash: str | None = None
    approval_snapshot_jsonb: dict[str, Any] = field(default_factory=dict)
    approval_note: str | None = None
    rejection_reason: str | None = None
    permission_class: str | None = None
    idempotency_key: str | None = None
    trace_id: str | None = None
    error_class: str | None = None
    error_message: str | None = None
    metadata_jsonb: dict[str, Any] = field(default_factory=dict)
    queued_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class InstalledToolReceiptRecord:
    receipt_id: str
    intent_id: str
    agent_id: str
    owner_user_id: str | None = None
    binding_id: str | None = None
    grant_id: str | None = None
    release_ids_jsonb: list[str] = field(default_factory=list)
    execution_source: str | None = None
    status: str = ""
    permission_class: str | None = None
    approval_status: str | None = None
    step_count: int = 0
    total_latency_ms: int | None = None
    total_billable_units: int = 0
    total_amount_usd_cents: int | None = None
    summary: str | None = None
    failure_reason: str | None = None
    trace_id: str | None = None
    metadata_jsonb: dict[str, Any] = field(default_factory=dict)
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class InstalledToolReceiptStepRecord:
    step_receipt_id: str
    intent_id: str
    step_id: str
    tool_name: str
    binding_id: str | None = None
    release_id: str | None = None
    dry_run: bool = False
    status: str = ""
    args_hash: str | None = None
    args_preview_redacted: str | None = None
    output_hash: str | None = None
    output_preview_redacted: str | None = None
    provider_latency_ms: int | None = None
    retry_count: int = 0
    error_class: str | None = None
    connected_account_ref: str | None = None
    metadata_jsonb: dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AccountPreferences:
    language: str | None = None
    summary_depth: str | None = None
    notification_mode: str | None = None
    autonomy_level: str | None = None
    interest_profile: dict[str, Any] = field(default_factory=dict)
    consent_policy: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AccountPlan:
    plan: str
    display_name: str | None = None
    limits: dict[str, Any] = field(default_factory=dict)
    available_models: list[dict[str, Any]] = field(default_factory=list)
    default_model: str | None = None
    selected_model: str | None = None
    subscription_id: str | None = None
    period_end: str | None = None
    cancel_scheduled_at: str | None = None
    cancel_pending: bool = False
    plan_change_scheduled_to: str | None = None
    plan_change_scheduled_at: str | None = None
    plan_change_scheduled_currency: str | None = None
    usage_today: dict[str, Any] = field(default_factory=dict)
    available_plans: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class PlanCheckoutSession:
    checkout_url: str | None = None
    expires_at_iso: str | None = None
    plan: str | None = None
    currency: str | None = None
    customer_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class BillingPortalLink:
    portal_url: str | None = None
    expires_at_iso: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AccountPlanCancellation:
    cancelled: bool = False
    effective_at: str | None = None
    cancel_scheduled_at: str | None = None
    plan: str | None = None
    subscription_id: str | None = None
    rail: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class PlanWeb3Mandate:
    mandate_id: str
    payment_mandate_id: str | None = None
    principal_user_id: str | None = None
    user_wallet_id: str | None = None
    network: str = "polygon"
    payee_type: str | None = None
    payee_ref: str | None = None
    fee_recipient_ref: str | None = None
    purpose: str | None = None
    cadence: str | None = None
    token_symbol: str | None = None
    display_currency: str | None = None
    max_amount_minor: int = 0
    status: str = "active"
    retry_count: int = 0
    idempotency_key: str | None = None
    last_attempt_at: str | None = None
    next_attempt_at: str | None = None
    canceled_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    transaction_request: dict[str, Any] | None = None
    approve_transaction_request: dict[str, Any] | None = None
    cancel_transaction_request: dict[str, Any] | None = None
    chain_receipt: SettlementReceipt | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AccountFeedbackSubmission:
    accepted: bool = False
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class OperationExecution:
    # IMPORTANT: the positional signature through `raw` is part of the
    # public SDK surface. New fields MUST be appended after `raw` (or
    # marked keyword-only) so that legacy callers like
    # `OperationExecution(agent_id, operation_key, message, action,
    # result, trace_id, request_id, raw_dict)` do not silently remap
    # their positional arguments onto the new slots.
    agent_id: str
    operation_key: str
    message: str
    action: str
    result: dict[str, Any] = field(default_factory=dict)
    trace_id: str | None = None
    request_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)
    # New in v0.6 (PR-S2b): keyword-only to avoid breaking the historical
    # positional constructor signature.
    status: str = field(default="completed", kw_only=True)
    approval_required: bool = field(default=False, kw_only=True)
    intent_id: str | None = field(default=None, kw_only=True)
    approval_status: str | None = field(default=None, kw_only=True)
    approval_snapshot_hash: str | None = field(default=None, kw_only=True)
    action_payload: dict[str, Any] = field(default_factory=dict, kw_only=True)
    safety: dict[str, Any] = field(default_factory=dict, kw_only=True)


def _string_or_none(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _int_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return None


def _bool_or_none(value: Any) -> bool | None:
    if value is None:
        return None
    return bool(value)


def _to_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _to_string_list(value: Any) -> list[str]:
    return [str(item) for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _to_record_list(value: Any) -> list[dict[str, Any]]:
    return [dict(item) for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []


def _clone_json_like(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _clone_json_like(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_clone_json_like(item) for item in value]
    return value


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


def _build_auto_register_request(
    *,
    manifest_payload: Mapping[str, Any],
    tool_manual_payload: Mapping[str, Any],
    source_code: str | None,
    source_url: str | None,
    runtime_validation: Mapping[str, Any] | None,
    source_context: Mapping[str, Any] | None,
    input_form_spec: Mapping[str, Any] | None,
) -> dict[str, Any]:
    tool_manual_for_request = dict(tool_manual_payload)
    embedded_input_form_spec = tool_manual_for_request.pop("input_form_spec", None)
    input_form_spec_for_request = (
        input_form_spec
        if input_form_spec is not None
        else embedded_input_form_spec
    )
    payload: dict[str, Any] = {
        "manifest": dict(manifest_payload),
        "tool_manual": tool_manual_for_request,
    }
    if source_url:
        payload["source_url"] = source_url
    elif source_code is not None:
        payload["source_code"] = source_code
    else:
        payload["source_code"] = _build_registration_stub_source(manifest_payload, tool_manual_payload)
    if runtime_validation is not None:
        payload["runtime_validation"] = _coerce_mapping(runtime_validation, "runtime_validation")
    if source_context is not None:
        payload["source_context"] = _coerce_mapping(source_context, "source_context")
    if input_form_spec_for_request is not None:
        payload["input_form_spec"] = _coerce_mapping(input_form_spec_for_request, "input_form_spec")

    # Manifest fields forwarded to the top-level auto-register payload.
    # ``version`` is intentionally NOT forwarded — the platform auto-assigns
    # ``release_semver`` and rejects submissions that declare a version.
    # ``description`` (long-form sales copy), ``permission_scopes``, and
    # ``compatibility_tags`` are forwarded so the seller's buyer-facing
    # description, OAuth scope declarations, and discovery tags actually
    # survive the auto-register pipeline (they previously got dropped
    # silently and ended up null/[] on the public detail page).
    for field_name in (
        "capability_key",
        "name",
        "job_to_be_done",
        "short_description",
        "description",
        "category",
        "docs_url",
        "documentation_url",
        "support_contact",
        "seller_homepage_url",
        "seller_social_url",
        "store_vertical",
        "jurisdiction",
        "price_model",
        "price_value_minor",
        "pricing_plan",
        "billing_timing",
        "currency",
        "allow_free_trial",
        "free_trial_duration_days",
        "permission_class",
        "approval_mode",
        "dry_run_supported",
        "required_connected_accounts",
        "permission_scopes",
        "compatibility_tags",
        "persistence",
    ):
        value = manifest_payload.get(field_name)
        if value is not None:
            payload[field_name] = _enum_value(value)
    if "pricing_plan" in payload and not isinstance(payload["pricing_plan"], Mapping):
        raise SiglumeClientError("AppManifest.pricing_plan must be an object when provided.")
    if "billing_timing" in payload:
        billing_timing = str(payload.get("billing_timing") or "post").strip().lower()
        if billing_timing not in {"post", "prepay"}:
            raise SiglumeClientError("AppManifest.billing_timing must be 'post' or 'prepay'.")
        payload["billing_timing"] = billing_timing
    if "store_vertical" not in payload:
        raise SiglumeClientError(
            "AppManifest.store_vertical is required. Choose 'api' for normal "
            "API Store listings or 'game' for API games."
        )
    currency = str(payload.get("currency") or "").strip().upper()
    if not currency:
        raise SiglumeClientError(
            "AppManifest.currency is required. Choose 'USD' for USDC settlement "
            "or 'JPY' for JPYC settlement."
        )
    if currency not in {"USD", "JPY"}:
        raise SiglumeClientError(
            f"AppManifest.currency must be 'USD' or 'JPY'. Got {payload.get('currency')!r}."
        )
    payload["currency"] = currency
    if "pricing_plan" in payload:
        _validate_pricing_plan_floor(payload.get("pricing_plan"), default_currency=currency)
    _validate_listing_text_lengths(payload)
    price_model = str(payload.get("price_model") or "free").strip().lower()
    if price_model in {"usage_based", "per_action"} and not _pricing_plan_has_items(payload.get("pricing_plan")):
        raise SiglumeClientError("AppManifest.pricing_plan.items is required for usage_based/per_action pricing.")
    if "allow_free_trial" not in payload:
        raise SiglumeClientError(
            "AppManifest.allow_free_trial is required. Pass True to offer a Plus/Pro "
            "buyer free trial or False to disable trials."
        )
    if bool(payload.get("allow_free_trial")):
        duration = payload.get("free_trial_duration_days", 30)
        if not isinstance(duration, int) or isinstance(duration, bool):
            raise SiglumeClientError(
                "AppManifest.free_trial_duration_days must be an int when allow_free_trial=True."
            )
        if not 1 <= duration <= 90:
            raise SiglumeClientError(
                "AppManifest.free_trial_duration_days must be between 1 and 90 when "
                f"allow_free_trial=True, got: {duration}."
            )
    _validate_manifest_persistence_contract(payload)

    # Strip ``version`` from the embedded manifest sub-dict too so the
    # platform's reject-on-manifest-version check cannot trip on the SDK's
    # local-tracking default. The SDK's AppManifest.version is documented
    # as local-only and must not reach the server.
    if isinstance(payload.get("manifest"), dict):
        payload["manifest"].pop("version", None)

    docs_url = str(manifest_payload.get("docs_url") or manifest_payload.get("documentation_url") or "").strip()
    support_contact = str(manifest_payload.get("support_contact") or "").strip()
    seller_homepage_url = str(manifest_payload.get("seller_homepage_url") or "").strip()
    seller_social_url = str(manifest_payload.get("seller_social_url") or "").strip()
    if docs_url or support_contact or seller_homepage_url or seller_social_url:
        publisher_identity = {
            "documentation_url": docs_url or None,
            "support_contact": support_contact or None,
            "seller_homepage_url": seller_homepage_url or None,
            "seller_social_url": seller_social_url or None,
        }
        payload["publisher_identity"] = publisher_identity
        payload["legal"] = {"publisher_identity": publisher_identity}
    return payload


def _validate_pricing_plan_floor(plan: Any, *, default_currency: str) -> None:
    if plan is None:
        return
    if not isinstance(plan, Mapping):
        raise SiglumeClientError("AppManifest.pricing_plan must be an object when provided.")
    raw_items = plan.get("items")
    if raw_items is None:
        return
    if not isinstance(raw_items, list):
        raise SiglumeClientError("AppManifest.pricing_plan.items must be an array when provided.")
    plan_currency = str(plan.get("currency") or default_currency or "").strip().upper()
    seen_keys: set[str] = set()
    for index, item in enumerate(raw_items):
        if not isinstance(item, Mapping):
            raise SiglumeClientError(f"AppManifest.pricing_plan.items[{index}] must be an object.")
        item_key = str(
            item.get("key")
            or item.get("operation")
            or item.get("operation_key")
            or item.get("request_type")
            or item.get("receipt_code")
            or item.get("action")
            or ""
        ).strip()
        if not item_key:
            raise SiglumeClientError(f"AppManifest.pricing_plan.items[{index}].key is required.")
        if item_key in seen_keys:
            raise SiglumeClientError(f"AppManifest.pricing_plan.items[{index}].key duplicates {item_key!r}.")
        seen_keys.add(item_key)
        amount_raw = None
        for key in ("price_minor", "amount_minor", "cost_minor", "value_minor"):
            if key in item and item.get(key) is not None:
                amount_raw = item.get(key)
                break
        if amount_raw is None:
            raise SiglumeClientError(f"AppManifest.pricing_plan.items[{index}].price_minor is required.")
        try:
            amount_minor = int(amount_raw)
        except (TypeError, ValueError):
            raise SiglumeClientError(
                f"AppManifest.pricing_plan.items[{index}].price_minor must be an integer."
            ) from None
        if amount_minor < 0:
            raise SiglumeClientError(
                f"AppManifest.pricing_plan.items[{index}].price_minor must be zero or positive."
            )
        currency = str(item.get("currency") or plan_currency or default_currency or "").strip().upper()
        if (
            currency in _MINIMUM_JPY_OPERATION_PRICE_CURRENCIES
            and 0 < amount_minor < MINIMUM_JPY_OPERATION_PRICE_MINOR
        ):
            raise SiglumeClientError(
                f"AppManifest.pricing_plan.items[{index}].price_minor must be 0 or at least "
                f"{MINIMUM_JPY_OPERATION_PRICE_MINOR} for JPY/JPYC operation billing."
            )


def _validate_listing_text_lengths(payload: dict[str, Any]) -> None:
    limits = {
        "short_description": LISTING_SHORT_DESCRIPTION_MAX_LENGTH,
        "job_to_be_done": LISTING_JOB_TO_BE_DONE_MAX_LENGTH,
        "description": LISTING_DESCRIPTION_MAX_LENGTH,
    }
    for field_name, max_length in limits.items():
        value = payload.get(field_name)
        if value is None:
            continue
        if not isinstance(value, str):
            raise SiglumeClientError(f"AppManifest.{field_name} must be a string when provided.")
        if len(value) > max_length:
            raise SiglumeClientError(f"AppManifest.{field_name} must be at most {max_length} characters.")


def _pricing_plan_has_items(plan: Any) -> bool:
    return isinstance(plan, Mapping) and isinstance(plan.get("items"), list) and bool(plan.get("items"))


def _validate_manifest_persistence_contract(payload: Mapping[str, Any]) -> None:
    vertical = str(payload.get("store_vertical") or "").strip().lower()
    persistence = payload.get("persistence")
    if persistence is None:
        return
    if not isinstance(persistence, Mapping):
        raise SiglumeClientError("AppManifest.persistence must be an object.")
    raw_mode = persistence.get("mode") or ("platform" if vertical == "game" else "none")
    mode = str(getattr(raw_mode, "value", raw_mode)).strip().lower()
    if mode not in {"none", "local", "platform", "developer_server"}:
        raise SiglumeClientError(
            "AppManifest.persistence.mode must be one of: none, local, platform, developer_server."
        )
    schema = persistence.get("save_data_schema")
    if vertical == "game" and mode != "none" and schema is None:
        raise SiglumeClientError(
            "AppManifest.persistence.save_data_schema is required when "
            "store_vertical='game' and persistence.mode is not 'none'."
        )
    if schema is not None:
        _validate_save_data_schema(schema, field_name="AppManifest.persistence.save_data_schema")


def _validate_save_data_schema(schema: Any, *, field_name: str) -> None:
    if not isinstance(schema, Mapping):
        raise SiglumeClientError(f"{field_name} must be a JSON Schema object.")
    try:
        schema_size = len(json.dumps(dict(schema), ensure_ascii=False, sort_keys=True).encode("utf-8"))
    except (TypeError, ValueError):
        raise SiglumeClientError(f"{field_name} must be JSON-serializable.") from None
    if schema_size > 8192:
        raise SiglumeClientError(f"{field_name} must be at most 8192 bytes.")
    if schema.get("type") != "object":
        raise SiglumeClientError(f"{field_name}.type must be 'object'.")
    properties = schema.get("properties")
    if not isinstance(properties, Mapping) or not properties:
        raise SiglumeClientError(f"{field_name}.properties must be a non-empty object.")
    required = schema.get("required")
    if required is not None:
        if not isinstance(required, list) or not all(isinstance(item, str) for item in required):
            raise SiglumeClientError(f"{field_name}.required must be an array of strings when provided.")
        missing = [item for item in required if item not in properties]
        if missing:
            raise SiglumeClientError(
                f"{field_name}.required references undefined properties: {', '.join(missing)}."
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
    metadata = data.get("metadata") if isinstance(data.get("metadata"), Mapping) else {}
    persistence = data.get("persistence")
    if not isinstance(persistence, Mapping):
        persistence = metadata.get("persistence") if isinstance(metadata, Mapping) else {}
    pricing_plan = data.get("pricing_plan")
    if not isinstance(pricing_plan, Mapping) and isinstance(metadata, Mapping):
        pricing_plan = metadata.get("pricing_plan")
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
        pricing_plan=dict(pricing_plan) if isinstance(pricing_plan, Mapping) else None,
        billing_timing=str(data.get("billing_timing") or metadata.get("billing_timing") or "post"),
        currency=str(data.get("currency") or "USD"),
        allow_free_trial=bool(data.get("allow_free_trial") or False),
        free_trial_duration_days=int(data.get("free_trial_duration_days") or 30),
        short_description=_string_or_none(data.get("short_description")),
        description=_string_or_none(data.get("description")),
        docs_url=_string_or_none(data.get("docs_url")),
        support_contact=_string_or_none(data.get("support_contact")),
        seller_display_name=_string_or_none(data.get("seller_display_name")),
        seller_homepage_url=_string_or_none(data.get("seller_homepage_url")),
        seller_social_url=_string_or_none(data.get("seller_social_url")),
        review_status=_string_or_none(data.get("review_status")),
        review_note=_string_or_none(data.get("review_note")),
        submission_blockers=[
            str(item) for item in data.get("submission_blockers", []) if isinstance(item, str)
        ],
        persistence=dict(persistence) if isinstance(persistence, Mapping) else {},
        created_at=_string_or_none(data.get("created_at")),
        updated_at=_string_or_none(data.get("updated_at")),
        raw=dict(data),
    )


def _parse_capability_save_state(data: Mapping[str, Any]) -> CapabilitySaveStateRecord:
    return CapabilitySaveStateRecord(
        capability_key=str(data.get("capability_key") or ""),
        save_key=str(data.get("save_key") or ""),
        schema_version=str(data.get("schema_version") or "1"),
        revision=int(data.get("revision") or 0),
        payload=_to_dict(data.get("payload")),
        metadata=_to_dict(data.get("metadata")),
        checksum=_string_or_none(data.get("checksum")),
        updated_at=_string_or_none(data.get("updated_at")),
        created_at=_string_or_none(data.get("created_at")),
        exists=bool(data.get("exists") or False),
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


def _parse_usage_event(data: Mapping[str, Any]) -> UsageEventRecord:
    return UsageEventRecord(
        usage_event_id=str(data.get("usage_event_id") or data.get("id") or ""),
        capability_key=_string_or_none(data.get("capability_key")),
        agent_id=_string_or_none(data.get("agent_id")),
        dimension=_string_or_none(data.get("dimension")),
        environment=_string_or_none(data.get("environment")),
        task_type=_string_or_none(data.get("task_type")),
        units_consumed=int(
            data["units_consumed"]
            if data.get("units_consumed") is not None
            else (data["units"] if data.get("units") is not None else 0)
        ),
        outcome=_string_or_none(data.get("outcome")),
        execution_kind=_string_or_none(data.get("execution_kind")),
        permission_class=_string_or_none(data.get("permission_class")),
        approval_mode=_string_or_none(data.get("approval_mode")),
        latency_ms=int(data["latency_ms"]) if data.get("latency_ms") is not None else None,
        trace_id=_string_or_none(data.get("trace_id")),
        period_key=_string_or_none(data.get("period_key")),
        external_id=_string_or_none(data.get("external_id") or data.get("idempotency_key")),
        occurred_at_iso=_string_or_none(data.get("occurred_at_iso") or data.get("occurred_at")),
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


def _parse_agent(data: Mapping[str, Any]) -> AgentRecord:
    expertise = data.get("expertise") if isinstance(data.get("expertise"), list) else []
    return AgentRecord(
        agent_id=str(data.get("agent_id") or data.get("id") or ""),
        name=str(data.get("name") or ""),
        avatar_url=_string_or_none(data.get("avatar_url")),
        description=_string_or_none(data.get("description")),
        agent_type=_string_or_none(data.get("agent_type")),
        status=_string_or_none(data.get("status")),
        expertise=[str(item) for item in expertise if isinstance(item, str)],
        paused=_bool_or_none(data.get("paused")) if "paused" in data else None,
        style=_string_or_none(data.get("style")),
        manifesto_text=_string_or_none(data.get("manifesto_text")),
        capabilities=_to_dict(data.get("capabilities")),
        settings=_to_dict(data.get("settings")),
        growth=_to_dict(data.get("growth")),
        plan=_to_dict(data.get("plan")),
        reputation=_to_dict(data.get("reputation")),
        raw=dict(data),
    )


def _parse_agent_charter(data: Mapping[str, Any]) -> AgentCharter:
    goals = _to_dict(data.get("goals"))
    return AgentCharter(
        charter_id=str(data.get("charter_id") or data.get("id") or ""),
        agent_id=str(data.get("agent_id") or ""),
        principal_user_id=_string_or_none(data.get("principal_user_id")),
        version=int(data.get("version") or 1),
        active=bool(data.get("active", True)),
        role=str(data.get("role") or "hybrid"),
        charter_text=_string_or_none(data.get("charter_text")) or _string_or_none(goals.get("charter_text")),
        goals=goals,
        target_profile=_to_dict(data.get("target_profile")),
        qualification_criteria=_to_dict(data.get("qualification_criteria")),
        success_metrics=_to_dict(data.get("success_metrics")),
        constraints=_to_dict(data.get("constraints")),
        created_at=_string_or_none(data.get("created_at")),
        updated_at=_string_or_none(data.get("updated_at")),
        raw=dict(data),
    )


def _parse_approval_policy(data: Mapping[str, Any]) -> ApprovalPolicy:
    auto_approve_below_raw = _to_dict(data.get("auto_approve_below"))
    auto_approve_below = {
        str(currency): int(amount)
        for currency, amount in auto_approve_below_raw.items()
        if _int_or_none(amount) is not None
    }
    return ApprovalPolicy(
        approval_policy_id=str(data.get("approval_policy_id") or data.get("id") or ""),
        agent_id=str(data.get("agent_id") or ""),
        principal_user_id=_string_or_none(data.get("principal_user_id")),
        version=int(data.get("version") or 1),
        active=bool(data.get("active", True)),
        auto_approve_below=auto_approve_below,
        always_require_approval_for=[
            str(item)
            for item in data.get("always_require_approval_for", [])
            if isinstance(item, str)
        ] if isinstance(data.get("always_require_approval_for"), list) else [],
        deny_if=_to_dict(data.get("deny_if")),
        approval_ttl_minutes=int(data.get("approval_ttl_minutes") or 1440),
        structured_only=bool(data.get("structured_only", True)),
        default_requires_approval=bool(data.get("default_requires_approval", True)),
        merchant_allowlist=[
            str(item) for item in data.get("merchant_allowlist", []) if isinstance(item, str)
        ] if isinstance(data.get("merchant_allowlist"), list) else [],
        merchant_denylist=[
            str(item) for item in data.get("merchant_denylist", []) if isinstance(item, str)
        ] if isinstance(data.get("merchant_denylist"), list) else [],
        category_allowlist=[
            str(item) for item in data.get("category_allowlist", []) if isinstance(item, str)
        ] if isinstance(data.get("category_allowlist"), list) else [],
        category_denylist=[
            str(item) for item in data.get("category_denylist", []) if isinstance(item, str)
        ] if isinstance(data.get("category_denylist"), list) else [],
        risk_policy=_to_dict(data.get("risk_policy")),
        created_at=_string_or_none(data.get("created_at")),
        updated_at=_string_or_none(data.get("updated_at")),
        raw=dict(data),
    )


def _parse_budget_policy(data: Mapping[str, Any]) -> BudgetPolicy:
    limits = _to_dict(data.get("limits"))
    return BudgetPolicy(
        budget_id=str(data.get("budget_id") or data.get("id") or ""),
        agent_id=str(data.get("agent_id") or ""),
        principal_user_id=_string_or_none(data.get("principal_user_id")),
        currency=str(data.get("currency") or "JPY"),
        period_start=_string_or_none(data.get("period_start")),
        period_end=_string_or_none(data.get("period_end")),
        period_limit_minor=int(data.get("period_limit_minor") or 0),
        spent_minor=int(data.get("spent_minor") or 0),
        reserved_minor=int(data.get("reserved_minor") or 0),
        per_order_limit_minor=int(data.get("per_order_limit_minor") or 0),
        auto_approve_below_minor=int(data.get("auto_approve_below_minor") or 0),
        limits={
            str(key): int(value)
            for key, value in limits.items()
            if _int_or_none(value) is not None
        } or {
            "period_limit": int(data.get("period_limit_minor") or 0),
            "per_order_limit": int(data.get("per_order_limit_minor") or 0),
            "auto_approve_below": int(data.get("auto_approve_below_minor") or 0),
        },
        metadata=_to_dict(data.get("metadata")),
        created_at=_string_or_none(data.get("created_at")),
        updated_at=_string_or_none(data.get("updated_at")),
        raw=dict(data),
    )


def _parse_installed_tool(data: Mapping[str, Any]) -> InstalledToolRecord:
    return InstalledToolRecord(
        binding_id=str(data.get("binding_id") or data.get("id") or ""),
        listing_id=str(data.get("listing_id") or ""),
        release_id=_string_or_none(data.get("release_id")),
        display_name=_string_or_none(data.get("display_name")),
        permission_class=_string_or_none(data.get("permission_class")),
        binding_status=_string_or_none(data.get("binding_status")),
        account_readiness=_string_or_none(data.get("account_readiness")),
        settlement_mode=_string_or_none(data.get("settlement_mode")),
        settlement_currency=_string_or_none(data.get("settlement_currency")),
        settlement_network=_string_or_none(data.get("settlement_network")),
        accepted_payment_tokens=_to_string_list(data.get("accepted_payment_tokens")),
        last_used_at=_string_or_none(data.get("last_used_at")),
        raw=dict(data),
    )


def _parse_installed_tool_connection_readiness(data: Mapping[str, Any]) -> InstalledToolConnectionReadiness:
    bindings_raw = _to_dict(data.get("bindings"))
    return InstalledToolConnectionReadiness(
        agent_id=str(data.get("agent_id") or ""),
        all_ready=bool(data.get("all_ready")) if data.get("all_ready") is not None else True,
        bindings={str(key): str(value) for key, value in bindings_raw.items() if _string_or_none(value)},
        raw=dict(data),
    )


def _parse_installed_tool_binding_policy(data: Mapping[str, Any]) -> InstalledToolBindingPolicyRecord:
    return InstalledToolBindingPolicyRecord(
        policy_id=str(data.get("policy_id") or data.get("execution_policy_id") or data.get("id") or ""),
        capability_listing_id=_string_or_none(data.get("capability_listing_id")),
        owner_user_id=_string_or_none(data.get("owner_user_id")),
        permission_class=_string_or_none(data.get("permission_class")),
        max_calls_per_day=_int_or_none(data.get("max_calls_per_day")),
        monthly_usage_cap=_int_or_none(data.get("monthly_usage_cap")),
        max_spend_per_execution=_int_or_none(data.get("max_spend_per_execution")),
        allowed_tasks_jsonb=_to_string_list(data.get("allowed_tasks_jsonb")),
        allowed_source_types_jsonb=_to_string_list(data.get("allowed_source_types_jsonb")),
        timeout_ms=_int_or_none(data.get("timeout_ms")),
        cooldown_seconds=_int_or_none(data.get("cooldown_seconds")),
        require_owner_approval=bool(data.get("require_owner_approval", False)),
        require_owner_approval_over_cost=_int_or_none(data.get("require_owner_approval_over_cost")),
        dry_run_only=bool(data.get("dry_run_only", False)),
        retry_policy_jsonb=_to_dict(data.get("retry_policy_jsonb")),
        fallback_mode=_string_or_none(data.get("fallback_mode")),
        auto_execute_read_only=bool(data.get("auto_execute_read_only", True)),
        allow_background_execution=bool(data.get("allow_background_execution", False)),
        max_calls_per_hour=_int_or_none(data.get("max_calls_per_hour")),
        max_chain_steps=_int_or_none(data.get("max_chain_steps")),
        max_parallel_executions=int(data.get("max_parallel_executions") or 1),
        max_spend_usd_cents_per_day=_int_or_none(data.get("max_spend_usd_cents_per_day")),
        approval_mode=str(data.get("approval_mode") or "always_ask"),
        kill_switch_state=str(data.get("kill_switch_state") or "active"),
        allowed_connected_account_ids_jsonb=_to_string_list(data.get("allowed_connected_account_ids_jsonb")),
        metadata_jsonb=_to_dict(data.get("metadata_jsonb")),
        created_at=_string_or_none(data.get("created_at")),
        updated_at=_string_or_none(data.get("updated_at")),
        raw=dict(data),
    )


def _parse_installed_tool_policy_update_result(
    data: Mapping[str, Any],
    *,
    operation_key: str,
    meta: EnvelopeMeta,
) -> InstalledToolPolicyUpdateResult:
    result_payload = data.get("result")
    preview = {}
    policy = None
    approval_snapshot_hash = _string_or_none(data.get("approval_snapshot_hash"))
    if isinstance(result_payload, Mapping):
        preview = _to_dict(result_payload.get("preview"))
        approval_snapshot_hash = approval_snapshot_hash or _string_or_none(result_payload.get("approval_snapshot_hash"))
        if str(data.get("status") or "").strip().lower() == "completed":
            policy = _parse_installed_tool_binding_policy(result_payload)
    return InstalledToolPolicyUpdateResult(
        agent_id=str(data.get("agent_id") or ""),
        operation_key=operation_key,
        status=str(data.get("status") or "completed"),
        approval_required=bool(data.get("approval_required")) or str(data.get("status") or "").strip().lower() == "approval_required",
        intent_id=_string_or_none(data.get("intent_id")),
        approval_status=_string_or_none(data.get("approval_status")),
        approval_snapshot_hash=approval_snapshot_hash,
        message=str(data.get("message") or ""),
        action=_to_dict(data.get("action")),
        preview=preview,
        safety=_to_dict(data.get("safety")),
        policy=policy,
        trace_id=meta.trace_id,
        request_id=meta.request_id,
        raw=dict(data),
    )


def _parse_installed_tool_execution(data: Mapping[str, Any]) -> InstalledToolExecutionRecord:
    return InstalledToolExecutionRecord(
        intent_id=str(data.get("intent_id") or data.get("id") or ""),
        agent_id=str(data.get("agent_id") or ""),
        owner_user_id=_string_or_none(data.get("owner_user_id")),
        binding_id=_string_or_none(data.get("binding_id")),
        release_id=_string_or_none(data.get("release_id")),
        source=_string_or_none(data.get("source")),
        goal=_string_or_none(data.get("goal")),
        input_payload_jsonb=_to_dict(data.get("input_payload_jsonb") or data.get("input_payload")),
        plan_jsonb=_to_dict(data.get("plan_jsonb")),
        status=str(data.get("status") or ""),
        approval_status=_string_or_none(data.get("approval_status")),
        approval_snapshot_hash=_string_or_none(data.get("approval_snapshot_hash")),
        approval_snapshot_jsonb=_to_dict(data.get("approval_snapshot_jsonb")),
        approval_note=_string_or_none(data.get("approval_note")),
        rejection_reason=_string_or_none(data.get("rejection_reason")),
        permission_class=_string_or_none(data.get("permission_class")),
        idempotency_key=_string_or_none(data.get("idempotency_key")),
        trace_id=_string_or_none(data.get("trace_id")),
        error_class=_string_or_none(data.get("error_class")),
        error_message=_string_or_none(data.get("error_message")),
        metadata_jsonb=_to_dict(data.get("metadata_jsonb")),
        queued_at=_string_or_none(data.get("queued_at")),
        started_at=_string_or_none(data.get("started_at")),
        completed_at=_string_or_none(data.get("completed_at")),
        created_at=_string_or_none(data.get("created_at")),
        updated_at=_string_or_none(data.get("updated_at")),
        raw=dict(data),
    )


def _parse_installed_tool_receipt(data: Mapping[str, Any]) -> InstalledToolReceiptRecord:
    return InstalledToolReceiptRecord(
        receipt_id=str(data.get("receipt_id") or data.get("id") or ""),
        intent_id=str(data.get("intent_id") or ""),
        agent_id=str(data.get("agent_id") or ""),
        owner_user_id=_string_or_none(data.get("owner_user_id")),
        binding_id=_string_or_none(data.get("binding_id")),
        grant_id=_string_or_none(data.get("grant_id")),
        release_ids_jsonb=_to_string_list(data.get("release_ids_jsonb")),
        execution_source=_string_or_none(data.get("execution_source")),
        status=str(data.get("status") or ""),
        permission_class=_string_or_none(data.get("permission_class")),
        approval_status=_string_or_none(data.get("approval_status")),
        step_count=int(data.get("step_count") or 0),
        total_latency_ms=_int_or_none(data.get("total_latency_ms")),
        total_billable_units=int(data.get("total_billable_units") or 0),
        total_amount_usd_cents=_int_or_none(data.get("total_amount_usd_cents")),
        summary=_string_or_none(data.get("summary")),
        failure_reason=_string_or_none(data.get("failure_reason")),
        trace_id=_string_or_none(data.get("trace_id")),
        metadata_jsonb=_to_dict(data.get("metadata_jsonb")),
        started_at=_string_or_none(data.get("started_at")),
        completed_at=_string_or_none(data.get("completed_at")),
        created_at=_string_or_none(data.get("created_at")),
        raw=dict(data),
    )


def _parse_installed_tool_receipt_step(data: Mapping[str, Any]) -> InstalledToolReceiptStepRecord:
    return InstalledToolReceiptStepRecord(
        step_receipt_id=str(data.get("step_receipt_id") or data.get("id") or ""),
        intent_id=str(data.get("intent_id") or ""),
        step_id=str(data.get("step_id") or ""),
        tool_name=str(data.get("tool_name") or ""),
        binding_id=_string_or_none(data.get("binding_id")),
        release_id=_string_or_none(data.get("release_id")),
        dry_run=bool(data.get("dry_run", False)),
        status=str(data.get("status") or ""),
        args_hash=_string_or_none(data.get("args_hash")),
        args_preview_redacted=_string_or_none(data.get("args_preview_redacted")),
        output_hash=_string_or_none(data.get("output_hash")),
        output_preview_redacted=_string_or_none(data.get("output_preview_redacted")),
        provider_latency_ms=_int_or_none(data.get("provider_latency_ms")),
        retry_count=int(data.get("retry_count") or 0),
        error_class=_string_or_none(data.get("error_class")),
        connected_account_ref=_string_or_none(data.get("connected_account_ref")),
        metadata_jsonb=_to_dict(data.get("metadata_jsonb")),
        created_at=_string_or_none(data.get("created_at")),
        raw=dict(data),
    )


def _parse_account_preferences(data: Mapping[str, Any]) -> AccountPreferences:
    return AccountPreferences(
        language=_string_or_none(data.get("language")),
        summary_depth=_string_or_none(data.get("summary_depth")),
        notification_mode=_string_or_none(data.get("notification_mode")),
        autonomy_level=_string_or_none(data.get("autonomy_level")),
        interest_profile=_to_dict(data.get("interest_profile")),
        consent_policy=_to_dict(data.get("consent_policy")),
        raw=dict(data),
    )


def _parse_account_plan(data: Mapping[str, Any]) -> AccountPlan:
    available_models = data.get("available_models") if isinstance(data.get("available_models"), list) else []
    return AccountPlan(
        plan=str(data.get("plan") or ""),
        display_name=_string_or_none(data.get("display_name")),
        limits=_to_dict(data.get("limits")),
        available_models=[dict(item) for item in available_models if isinstance(item, Mapping)],
        default_model=_string_or_none(data.get("default_model")),
        selected_model=_string_or_none(data.get("selected_model")),
        subscription_id=_string_or_none(data.get("subscription_id")),
        period_end=_string_or_none(data.get("period_end")),
        cancel_scheduled_at=_string_or_none(data.get("cancel_scheduled_at")),
        cancel_pending=bool(data.get("cancel_pending")) if data.get("cancel_pending") is not None else False,
        plan_change_scheduled_to=_string_or_none(data.get("plan_change_scheduled_to")),
        plan_change_scheduled_at=_string_or_none(data.get("plan_change_scheduled_at")),
        plan_change_scheduled_currency=_string_or_none(data.get("plan_change_scheduled_currency")),
        usage_today=_to_dict(data.get("usage_today")),
        available_plans=_to_dict(data.get("available_plans")),
        raw=dict(data),
    )


def _parse_plan_checkout_session(data: Mapping[str, Any]) -> PlanCheckoutSession:
    return PlanCheckoutSession(
        checkout_url=_string_or_none(data.get("checkout_url")),
        expires_at_iso=_string_or_none(data.get("expires_at_iso") or data.get("expires_at")),
        plan=_string_or_none(data.get("plan")),
        currency=_string_or_none(data.get("currency")),
        customer_id=_string_or_none(data.get("customer_id")),
        raw=dict(data),
    )


def _parse_billing_portal_link(data: Mapping[str, Any]) -> BillingPortalLink:
    return BillingPortalLink(
        portal_url=_string_or_none(data.get("portal_url")),
        expires_at_iso=_string_or_none(data.get("expires_at_iso") or data.get("expires_at")),
        raw=dict(data),
    )


def _parse_account_plan_cancellation(data: Mapping[str, Any]) -> AccountPlanCancellation:
    return AccountPlanCancellation(
        cancelled=bool(data.get("cancelled")) if data.get("cancelled") is not None else False,
        effective_at=_string_or_none(data.get("effective_at")),
        cancel_scheduled_at=_string_or_none(data.get("cancel_scheduled_at")),
        plan=_string_or_none(data.get("plan")),
        subscription_id=_string_or_none(data.get("subscription_id")),
        rail=_string_or_none(data.get("rail")),
        raw=dict(data),
    )


def _parse_plan_web3_mandate(data: Mapping[str, Any]) -> PlanWeb3Mandate:
    chain_receipt_payload = data.get("chain_receipt")
    return PlanWeb3Mandate(
        mandate_id=str(data.get("mandate_id") or data.get("payment_mandate_id") or ""),
        payment_mandate_id=_string_or_none(data.get("payment_mandate_id")),
        principal_user_id=_string_or_none(data.get("principal_user_id")),
        user_wallet_id=_string_or_none(data.get("user_wallet_id")),
        network=str(data.get("network") or "polygon"),
        payee_type=_string_or_none(data.get("payee_type")),
        payee_ref=_string_or_none(data.get("payee_ref")),
        fee_recipient_ref=_string_or_none(data.get("fee_recipient_ref")),
        purpose=_string_or_none(data.get("purpose")),
        cadence=_string_or_none(data.get("cadence")),
        token_symbol=_string_or_none(data.get("token_symbol")),
        display_currency=_string_or_none(data.get("display_currency")),
        max_amount_minor=int(data.get("max_amount_minor") or 0),
        status=str(data.get("status") or "active"),
        retry_count=int(data.get("retry_count") or 0),
        idempotency_key=_string_or_none(data.get("idempotency_key")),
        last_attempt_at=_string_or_none(data.get("last_attempt_at")),
        next_attempt_at=_string_or_none(data.get("next_attempt_at")),
        canceled_at=_string_or_none(data.get("canceled_at")),
        metadata=_to_dict(data.get("metadata_jsonb") or data.get("metadata")),
        transaction_request=_to_dict(data.get("transaction_request")) or None,
        approve_transaction_request=_to_dict(data.get("approve_transaction_request")) or None,
        cancel_transaction_request=_to_dict(data.get("cancel_transaction_request")) or None,
        chain_receipt=parse_settlement_receipt(chain_receipt_payload)
        if isinstance(chain_receipt_payload, Mapping)
        else None,
        raw=dict(data),
    )


def _parse_account_feedback_submission(data: Mapping[str, Any]) -> AccountFeedbackSubmission:
    return AccountFeedbackSubmission(
        accepted=bool(data.get("accepted", False)),
        raw=dict(data),
    )


def _parse_operation_execution(
    data: Mapping[str, Any],
    *,
    operation_key: str,
    meta: EnvelopeMeta,
) -> OperationExecution:
    action_value = data.get("action")
    action_payload = _to_dict(action_value) if isinstance(action_value, Mapping) else {}
    if isinstance(action_value, Mapping):
        action_name = (
            _string_or_none(action_value.get("operation"))
            or _string_or_none(action_value.get("type"))
            or operation_key.replace(".", "_")
        )
    else:
        action_name = str(action_value or operation_key.replace(".", "_"))
    return OperationExecution(
        agent_id=str(data.get("agent_id") or ""),
        operation_key=operation_key,
        message=str(data.get("message") or ""),
        action=action_name,
        result=_to_dict(data.get("result")),
        status=str(data.get("status") or "completed"),
        approval_required=bool(data.get("approval_required") or str(data.get("status") or "").strip().lower() == "approval_required"),
        intent_id=_string_or_none(data.get("intent_id")),
        approval_status=_string_or_none(data.get("approval_status")),
        approval_snapshot_hash=_string_or_none(data.get("approval_snapshot_hash")),
        action_payload=action_payload,
        safety=_to_dict(data.get("safety")),
        trace_id=meta.trace_id,
        request_id=meta.request_id,
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
        api_key: str | None = None,
        *,
        agent_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 15.0,
        max_retries: int = 3,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        raw_api_key = os.environ.get("SIGLUME_API_KEY") if api_key is None else api_key
        resolved_api_key = str(raw_api_key or "").strip()
        if not resolved_api_key:
            raise SiglumeClientError(
                "SIGLUME_API_KEY is required. Pass it as api_key=... or set the SIGLUME_API_KEY env var."
            )
        self.api_key = resolved_api_key
        self.agent_key = str(agent_key or "").strip() or None
        self.base_url = (base_url or os.environ.get("SIGLUME_API_BASE") or DEFAULT_SIGLUME_API_BASE).rstrip("/")
        self.max_retries = max(1, int(max_retries))
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            transport=transport,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
                "User-Agent": "siglume-api-sdk/0.7.6",
            },
        )
        self._pending_confirmations: dict[str, dict[str, Any]] = {}

    def get_mcp_router_account(self) -> dict[str, Any]:
        """Return the Siglume account resolved from this API key/session."""
        data, _ = self._request("GET", "/mcp-router/account")
        return _to_dict(data)

    def list_mcp_router_servers(self) -> list[dict[str, Any]]:
        """List MCP Router servers owned by this API key's Siglume account."""
        data, _ = self._request("GET", "/mcp-router/servers")
        if not isinstance(data, Mapping):
            return []
        return _to_record_list(data.get("items"))

    def register_mcp_router_server(
        self,
        *,
        name: str,
        base_url: str,
        description: str | None = None,
        upstream_auth_mode: str = "none",
        bearer_secret: str | None = None,
        monetization: str = "free",
        currency: str = "USD",
        jurisdiction: str = "US",
        payee_address: str | None = None,
    ) -> dict[str, Any]:
        """Register an upstream MCP server under this API key's owner account."""
        payload: dict[str, Any] = {
            "name": name,
            "base_url": base_url,
            "upstream_auth_mode": upstream_auth_mode,
            "monetization": monetization,
            "currency": currency,
            "jurisdiction": jurisdiction,
        }
        if description:
            payload["description"] = description
        if bearer_secret:
            payload["bearer_secret"] = bearer_secret
        if payee_address:
            payload["payee_address"] = payee_address
        data, _ = self._request("POST", "/mcp-router/servers", json_body=payload)
        return _to_dict(data)

    def unregister_mcp_router_server(self, server_id: str) -> dict[str, Any]:
        """Unregister an MCP Router server owned by this API key's account."""
        data, _ = self._request("DELETE", f"/mcp-router/servers/{quote(server_id, safe='')}")
        return _to_dict(data)

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
        runtime_validation: Mapping[str, Any] | None = None,
        source_context: Mapping[str, Any] | None = None,
        input_form_spec: Mapping[str, Any] | None = None,
    ) -> AutoRegistrationReceipt:
        manifest_payload = _coerce_mapping(manifest, "manifest")
        tool_manual_payload = _coerce_mapping(tool_manual, "tool_manual")
        input_form_spec_payload = (
            _coerce_mapping(input_form_spec, "input_form_spec")
            if input_form_spec is not None
            else None
        )
        payload = _build_auto_register_request(
            manifest_payload=manifest_payload,
            tool_manual_payload=tool_manual_payload,
            source_code=source_code,
            source_url=source_url,
            runtime_validation=runtime_validation,
            source_context=source_context,
            input_form_spec=input_form_spec_payload,
        )
        data, meta = self._request("POST", "/market/capabilities/auto-register", json_body=payload)
        listing_id = str(data.get("listing_id") or "")
        if not listing_id:
            raise SiglumeClientError("Siglume auto-register response did not include listing_id.")
        self._pending_confirmations[listing_id] = {
            "manifest": manifest_payload,
            "tool_manual": _to_dict(payload.get("tool_manual")),
            "input_form_spec": _to_dict(payload.get("input_form_spec")),
        }
        return AutoRegistrationReceipt(
            listing_id=listing_id,
            status=str(data.get("status") or "draft"),
            registration_mode=_string_or_none(data.get("registration_mode")),
            listing_status=_string_or_none(data.get("listing_status")),
            auto_manifest=_to_dict(data.get("auto_manifest")),
            confidence=_to_dict(data.get("confidence")),
            validation_report=_to_dict(data.get("validation_report")),
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
        version_bump: str | None = None,
        visibility: str = "public",
    ) -> RegistrationConfirmation:
        # Registration content is immutable after auto-register. Keep the
        # historical keyword arguments source-compatible, but do not send them
        # as post-draft overrides.
        _ = (manifest, tool_manual)
        payload: dict[str, Any] = {"approved": True}
        if visibility not in ("public", "private"):
            raise SiglumeClientError(
                f"visibility must be one of ['public', 'private'], got {visibility!r}"
            )
        payload["visibility"] = visibility
        if version_bump is not None:
            # Platform accepts "patch" (default), "minor", or "major". Any
            # other value is rejected server-side. Validate client-side too
            # so the caller gets a clear error before the network round-trip.
            allowed = ("patch", "minor", "major")
            if not isinstance(version_bump, str) or version_bump not in allowed:
                raise SiglumeClientError(
                    f"version_bump must be one of {list(allowed)}, got {version_bump!r}"
                )
            payload["version_bump"] = version_bump
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
            visibility=_string_or_none(data.get("visibility")),
            message=str(data.get("message") or ""),
            checklist={str(key): bool(value) for key, value in _to_dict(data.get("checklist")).items()},
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

    def get_capability_state(self, capability_key: str, save_key: str = "default") -> CapabilitySaveStateRecord:
        data, _meta = self._request(
            "GET",
            f"/market/capability-state/{capability_key}/{save_key}",
        )
        return _parse_capability_save_state(data)

    def put_capability_state(
        self,
        capability_key: str,
        save_key: str = "default",
        payload: Mapping[str, Any] | None = None,
        *,
        schema_version: str = "1",
        expected_revision: int | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> CapabilitySaveStateRecord:
        body: dict[str, Any] = {
            "payload": _coerce_mapping(payload or {}, "payload"),
            "schema_version": str(schema_version or "1"),
            "metadata": _coerce_mapping(metadata or {}, "metadata"),
        }
        if expected_revision is not None:
            body["expected_revision"] = int(expected_revision)
        data, _meta = self._request(
            "PUT",
            f"/market/capability-state/{capability_key}/{save_key}",
            json_body=body,
        )
        return _parse_capability_save_state(data)

    def delete_capability_state(self, capability_key: str, save_key: str = "default") -> CapabilitySaveStateRecord:
        data, _meta = self._request(
            "DELETE",
            f"/market/capability-state/{capability_key}/{save_key}",
        )
        return _parse_capability_save_state(data)

    # ----- Connected accounts ------------------------------------------------
    # Architecture B: publisher APIs own external OAuth and token storage.
    # The SDK no longer exposes platform OAuth or listing credential APIs.

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

    # ------------------------------------------------------------------
    # Publisher dev tools (Phase 1) — observability into marketplace performance
    # ------------------------------------------------------------------

    def get_gap_report(
        self,
        *,
        days: int = 30,
        min_occurrences: int = 3,
        limit: int = 50,
    ) -> tuple[dict[str, Any], EnvelopeMeta]:
        """Cross-publisher gap report: capability shapes the planner asked for but no tool matched.

        Anonymized aggregate. Server enforces ``min_occurrences >= 3`` floor as
        privacy guardrail against singleton fingerprinting. Never includes
        buyer prompts, agent IDs, or owner IDs.
        """
        params: dict[str, Any] = {
            "days": int(days),
            "min_occurrences": int(min_occurrences),
            "limit": int(limit),
        }
        return self._request("GET", "/seller/analytics/gap-report", params=params)

    def get_market_vitals(
        self,
        *,
        days: int = 7,
    ) -> tuple[dict[str, Any], EnvelopeMeta]:
        """Publisher market vitals overview for API Store orchestrator traffic."""
        return self._request(
            "GET",
            "/seller/analytics/market-vitals",
            params={"days": int(days)},
        )

    def get_seller_listing_stats(
        self,
        listing_id: str,
        *,
        days: int = 30,
    ) -> tuple[dict[str, Any], EnvelopeMeta]:
        """Per-listing stats — installs, revenue, executions, success and selection rates."""
        return self._request(
            "GET",
            f"/seller/analytics/listings/{listing_id}/stats",
            params={"days": int(days)},
        )

    def get_seller_selection_analysis(
        self,
        listing_id: str,
        *,
        days: int = 30,
    ) -> tuple[dict[str, Any], EnvelopeMeta]:
        """Why your listing was a candidate but NOT selected — actionable improvement signal."""
        return self._request(
            "GET",
            f"/seller/analytics/listings/{listing_id}/selection-analysis",
            params={"days": int(days)},
        )

    def get_seller_keyword_suggestions(
        self,
        listing_id: str,
    ) -> tuple[dict[str, Any], EnvelopeMeta]:
        """Keyword suggestions to add to the tool manual to improve discoverability."""
        return self._request(
            "GET",
            f"/seller/analytics/listings/{listing_id}/keyword-suggestions",
        )

    def list_execution_receipts(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], EnvelopeMeta]:
        """List recent execution receipts in the caller's owner scope.

        Returns a list of receipt dicts (most recent first). Used by
        ``siglume dev tail`` to surface live execution activity to publishers
        debugging their own listing's behavior.
        """
        params: dict[str, Any] = {
            "limit": int(limit),
            "offset": int(offset),
        }
        if agent_id:
            params["agent_id"] = str(agent_id)
        if status:
            params["status"] = str(status)
        return self._request("GET", "/capability-execution-receipts", params=params)

    def list_listing_recent_receipts(
        self,
        listing_id: str,
        *,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], EnvelopeMeta]:
        """Receipts where any step touched this publisher's listing.

        Publisher-scoped (Q3): caller must own the listing. Returns receipts
        that surface execution metadata only — buyer agent IDs, owner IDs,
        summary, and failure_reason are intentionally NOT in the response.
        Used by ``siglume dev tail --listing-id`` to answer "who is calling
        my listing" without exposing identifying buyer detail.
        """
        params: dict[str, Any] = {"limit": int(limit), "offset": int(offset)}
        return self._request(
            "GET",
            f"/seller/analytics/listings/{listing_id}/recent-receipts",
            params=params,
        )

    def simulate_planner(
        self,
        *,
        offer_text: str,
        max_candidates: int = 10,
    ) -> tuple[dict[str, Any], EnvelopeMeta]:
        """Predict the orchestrator's tool chain for an offer text without dispatching.

        Rate-limited server-side (10 calls / publisher / UTC day). Beyond the
        cap the server returns ``429`` with a ``SIMULATE_QUOTA_EXCEEDED``
        error code and a ``reset_at`` timestamp. Privacy: never includes
        buyer prompts or other publishers' tool outputs.
        """
        body: dict[str, Any] = {
            "offer_text": str(offer_text),
            "max_candidates": int(max_candidates),
        }
        return self._request("POST", "/seller/dev/simulate", json_body=body)

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

    def list_agents(
        self,
        *,
        query: str | None = None,
        limit: int = 20,
    ) -> list[AgentRecord]:
        normalized_query = str(query or "").strip()
        if normalized_query:
            target_limit = max(1, min(int(limit), 20))
            items: list[AgentRecord] = []
            cursor: str | None = None
            seen_cursors: set[str] = set()
            while len(items) < target_limit:
                params: dict[str, Any] = {
                    "query": normalized_query,
                    "limit": max(1, min(target_limit - len(items), 20)),
                }
                if cursor:
                    params["cursor"] = cursor
                data, _meta = self._request("GET", "/search/agents", params=params)
                page_items = data.get("items") if isinstance(data.get("items"), list) else []
                items.extend(
                    _parse_agent(item)
                    for item in page_items
                    if isinstance(item, Mapping)
                )
                next_cursor = _string_or_none(data.get("next_cursor"))
                if not next_cursor or next_cursor in seen_cursors:
                    break
                seen_cursors.add(next_cursor)
                cursor = next_cursor
            return items[:target_limit]
        data, _meta = self._request("GET", "/me/agent")
        return [_parse_agent(data)]

    def get_agent(
        self,
        agent_id: str,
    ) -> AgentRecord:
        normalized_agent_id = str(agent_id or "").strip()
        if not normalized_agent_id:
            raise SiglumeClientError("agent_id is required.")
        data, _meta = self._request("GET", f"/agents/{normalized_agent_id}/profile")
        return _parse_agent(data)

    def list_operations(
        self,
        *,
        agent_id: str | None = None,
        lang: str = "en",
    ) -> list[OperationMetadata]:
        resolved_agent_id = str(agent_id or "").strip()
        if not resolved_agent_id:
            agents = self.list_agents()
            if not agents:
                return fallback_operation_catalog()
            resolved_agent_id = agents[0].agent_id
        try:
            data, _meta = self._request(
                "GET",
                f"/owner/agents/{resolved_agent_id}/operations",
                params={"lang": "ja" if str(lang or "").strip().lower() == "ja" else "en"},
            )
        except SiglumeClientError:
            return fallback_operation_catalog(agent_id=resolved_agent_id)
        items = data.get("items") if isinstance(data.get("items"), list) else []
        if not items:
            return fallback_operation_catalog(agent_id=resolved_agent_id)
        return [
            build_operation_metadata(item, agent_id=resolved_agent_id, source="live")
            for item in items
            if isinstance(item, Mapping)
        ]

    def get_operation_metadata(
        self,
        operation_key: str,
        *,
        agent_id: str | None = None,
        lang: str = "en",
    ) -> OperationMetadata:
        normalized_key = str(operation_key or "").strip()
        if not normalized_key:
            raise SiglumeClientError("operation_key is required.")
        for item in self.list_operations(agent_id=agent_id, lang=lang):
            if item.operation_key == normalized_key:
                return item
        raise SiglumeNotFoundError(f"Operation not found: {normalized_key}")

    def get_account_preferences(self) -> AccountPreferences:
        data, _meta = self._request("GET", "/me/preferences")
        return _parse_account_preferences(data)

    def update_account_preferences(
        self,
        *,
        language: str | None = None,
        summary_depth: str | None = None,
        notification_mode: str | None = None,
        autonomy_level: str | None = None,
        interest_profile: Mapping[str, Any] | None = None,
        consent_policy: Mapping[str, Any] | None = None,
    ) -> AccountPreferences:
        payload: dict[str, Any] = {}
        if language is not None:
            payload["language"] = str(language).strip()
        if summary_depth is not None:
            payload["summary_depth"] = str(summary_depth).strip()
        if notification_mode is not None:
            payload["notification_mode"] = str(notification_mode).strip()
        if autonomy_level is not None:
            payload["autonomy_level"] = str(autonomy_level).strip()
        if interest_profile is not None:
            payload["interest_profile"] = _coerce_mapping(interest_profile, "interest_profile")
        if consent_policy is not None:
            payload["consent_policy"] = _coerce_mapping(consent_policy, "consent_policy")
        if not payload:
            raise SiglumeClientError("update_account_preferences requires at least one preference field.")
        data, _meta = self._request("PUT", "/me/preferences", json_body=payload)
        return _parse_account_preferences(data)

    def get_account_plan(self) -> AccountPlan:
        data, _meta = self._request("GET", "/me/plan")
        return _parse_account_plan(data)

    def start_plan_checkout(
        self,
        target_tier: str,
        *,
        currency: str | None = None,
    ) -> PlanCheckoutSession:
        normalized_tier = str(target_tier or "").strip().lower()
        if not normalized_tier:
            raise SiglumeClientError("target_tier is required.")
        params: dict[str, Any] = {"plan": normalized_tier}
        if currency is not None and str(currency).strip():
            params["currency"] = str(currency).strip().lower()
        data, _meta = self._request("POST", "/me/plan/checkout", params=params)
        return _parse_plan_checkout_session(data)

    def open_plan_billing_portal(self) -> BillingPortalLink:
        data, _meta = self._request("GET", "/me/plan/billing-portal")
        return _parse_billing_portal_link(data)

    def cancel_account_plan(self) -> AccountPlanCancellation:
        data, _meta = self._request("POST", "/me/plan/cancel")
        return _parse_account_plan_cancellation(data)

    def create_plan_web3_mandate(
        self,
        target_tier: str,
        *,
        currency: str | None = None,
    ) -> PlanWeb3Mandate:
        normalized_tier = str(target_tier or "").strip().lower()
        if not normalized_tier:
            raise SiglumeClientError("target_tier is required.")
        params: dict[str, Any] = {"plan": normalized_tier}
        if currency is not None and str(currency).strip():
            params["currency"] = str(currency).strip().lower()
        data, _meta = self._request("POST", "/me/plan/web3-mandate", params=params)
        return _parse_plan_web3_mandate(data)

    def cancel_plan_web3_mandate(self) -> PlanWeb3Mandate:
        data, _meta = self._request("POST", "/me/plan/web3-cancel")
        return _parse_plan_web3_mandate(data)

    def submit_account_feedback(
        self,
        ref_type: str,
        ref_id: str,
        feedback_type: str,
        *,
        reason: str | None = None,
    ) -> AccountFeedbackSubmission:
        normalized_ref_type = str(ref_type or "").strip()
        normalized_ref_id = str(ref_id or "").strip()
        normalized_feedback_type = str(feedback_type or "").strip()
        if not normalized_ref_type:
            raise SiglumeClientError("ref_type is required.")
        if not normalized_ref_id:
            raise SiglumeClientError("ref_id is required.")
        if not normalized_feedback_type:
            raise SiglumeClientError("feedback_type is required.")
        payload: dict[str, Any] = {
            "ref_type": normalized_ref_type,
            "ref_id": normalized_ref_id,
            "feedback_type": normalized_feedback_type,
        }
        if reason is not None and str(reason).strip():
            payload["reason"] = str(reason).strip()
        data, _meta = self._request("POST", "/feedback", json_body=payload)
        return _parse_account_feedback_submission(data)

    def update_agent_charter(
        self,
        agent_id: str,
        charter_text: str,
        *,
        role: str | None = None,
        target_profile: Mapping[str, Any] | None = None,
        qualification_criteria: Mapping[str, Any] | None = None,
        success_metrics: Mapping[str, Any] | None = None,
        constraints: Mapping[str, Any] | None = None,
        wait_for_completion: bool = False,
    ) -> AgentCharter:
        normalized_agent_id = str(agent_id or "").strip()
        normalized_charter_text = str(charter_text or "").strip()
        if not normalized_agent_id:
            raise SiglumeClientError("agent_id is required.")
        if not normalized_charter_text:
            raise SiglumeClientError("charter_text is required.")
        payload: dict[str, Any] = {"goals": {"charter_text": normalized_charter_text}}
        if role:
            payload["role"] = str(role).strip().lower()
        if target_profile is not None:
            payload["target_profile"] = _coerce_mapping(target_profile, "target_profile")
        if qualification_criteria is not None:
            payload["qualification_criteria"] = _coerce_mapping(qualification_criteria, "qualification_criteria")
        if success_metrics is not None:
            payload["success_metrics"] = _coerce_mapping(success_metrics, "success_metrics")
        if constraints is not None:
            payload["constraints"] = _coerce_mapping(constraints, "constraints")
        _ = wait_for_completion
        data, _meta = self._request(
            "PUT",
            f"/owner/agents/{normalized_agent_id}/charter",
            json_body=payload,
        )
        return _parse_agent_charter(data)

    def update_approval_policy(
        self,
        agent_id: str,
        policy: Mapping[str, Any],
        *,
        wait_for_completion: bool = False,
    ) -> ApprovalPolicy:
        normalized_agent_id = str(agent_id or "").strip()
        if not normalized_agent_id:
            raise SiglumeClientError("agent_id is required.")
        policy_payload = _coerce_mapping(policy, "policy")
        allowed_fields = (
            "auto_approve_below",
            "always_require_approval_for",
            "deny_if",
            "approval_ttl_minutes",
            "structured_only",
            "merchant_allowlist",
            "merchant_denylist",
            "category_allowlist",
            "category_denylist",
            "risk_policy",
        )
        payload = {
            field_name: policy_payload[field_name]
            for field_name in allowed_fields
            if policy_payload.get(field_name) is not None
        }
        if not payload:
            raise SiglumeClientError("policy must include at least one supported approval-policy field.")
        _ = wait_for_completion
        data, _meta = self._request(
            "PUT",
            f"/owner/agents/{normalized_agent_id}/approval-policy",
            json_body=payload,
        )
        return _parse_approval_policy(data)

    def update_budget_policy(
        self,
        agent_id: str,
        policy: Mapping[str, Any],
        *,
        wait_for_completion: bool = False,
    ) -> BudgetPolicy:
        normalized_agent_id = str(agent_id or "").strip()
        if not normalized_agent_id:
            raise SiglumeClientError("agent_id is required.")
        policy_payload = _coerce_mapping(policy, "policy")
        allowed_fields = (
            "currency",
            "period_start",
            "period_end",
            "period_limit_minor",
            "per_order_limit_minor",
            "auto_approve_below_minor",
            "limits",
            "metadata",
        )
        nullable_fields = frozenset({"period_start", "period_end"})
        payload: dict[str, Any] = {}
        for field_name in allowed_fields:
            if field_name not in policy_payload:
                continue
            value = policy_payload[field_name]
            if value is None and field_name not in nullable_fields:
                continue
            payload[field_name] = value
        if not payload:
            raise SiglumeClientError("policy must include at least one supported budget-policy field.")
        _ = wait_for_completion
        data, _meta = self._request(
            "PUT",
            f"/owner/agents/{normalized_agent_id}/budget",
            json_body=payload,
        )
        return _parse_budget_policy(data)

    def execute_owner_operation(
        self,
        agent_id: str,
        operation_key: str,
        params: Mapping[str, Any] | None = None,
        *,
        lang: str = "en",
    ) -> OperationExecution:
        data, meta = self._request_owner_operation(
            agent_id,
            operation_key,
            params,
            lang=lang,
        )
        return _parse_operation_execution(data, operation_key=str(operation_key or "").strip(), meta=meta)

    def _request_owner_operation(
        self,
        agent_id: str,
        operation_key: str,
        params: Mapping[str, Any] | None = None,
        *,
        lang: str = "en",
    ) -> tuple[dict[str, Any], EnvelopeMeta]:
        normalized_agent_id = str(agent_id or "").strip()
        normalized_key = str(operation_key or "").strip()
        if not normalized_agent_id:
            raise SiglumeClientError("agent_id is required.")
        if not normalized_key:
            raise SiglumeClientError("operation_key is required.")
        payload = {
            "operation": normalized_key,
            "params": _coerce_mapping(params or {}, "params"),
            "lang": "ja" if str(lang or "").strip().lower() == "ja" else "en",
        }
        data, meta = self._request(
            "POST",
            f"/owner/agents/{normalized_agent_id}/operations/execute",
            json_body=payload,
        )
        if not isinstance(data, Mapping):
            raise SiglumeClientError("Expected the owner-operation response body to be an object.")
        return dict(data), meta

    def _resolve_owner_operation_agent_id(self, agent_id: str | None = None) -> str:
        resolved_agent_id = str(agent_id or "").strip()
        if resolved_agent_id:
            return resolved_agent_id
        data, _meta = self._request("GET", "/me/agent")
        # `/me/agent` may return the identifier under either `agent_id`
        # (current contract) or the legacy `id` field. `_parse_agent`
        # already accepts both; mirror that here so callers that rely on
        # the omitted-`agent_id` path do not hard-fail against servers
        # still emitting the legacy shape.
        agent_id_from_me = (
            _string_or_none(data.get("agent_id"))
            or _string_or_none(data.get("id"))
        )
        if agent_id_from_me:
            return agent_id_from_me
        raise SiglumeClientError("agent_id is required.")

    def list_installed_tools(
        self,
        *,
        agent_id: str | None = None,
        lang: str = "en",
    ) -> list[InstalledToolRecord]:
        resolved_agent_id = self._resolve_owner_operation_agent_id(agent_id)
        data, _meta = self._request_owner_operation(
            resolved_agent_id,
            "installed_tools.list",
            {},
            lang=lang,
        )
        items = data.get("result") if isinstance(data.get("result"), list) else []
        return [_parse_installed_tool(item) for item in items if isinstance(item, Mapping)]

    def get_installed_tools_connection_readiness(
        self,
        *,
        agent_id: str | None = None,
        lang: str = "en",
    ) -> InstalledToolConnectionReadiness:
        data, _meta = self._request_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "installed_tools.connection_readiness",
            {},
            lang=lang,
        )
        result = data.get("result") if isinstance(data.get("result"), Mapping) else {}
        return _parse_installed_tool_connection_readiness(result)

    def update_installed_tool_binding_policy(
        self,
        binding_id: str,
        *,
        agent_id: str | None = None,
        permission_class: str | None = None,
        max_calls_per_day: int | None = None,
        monthly_usage_cap: int | None = None,
        max_spend_per_execution: int | None = None,
        allowed_tasks_jsonb: Sequence[str] | None = None,
        allowed_source_types_jsonb: Sequence[str] | None = None,
        timeout_ms: int | None = None,
        cooldown_seconds: int | None = None,
        require_owner_approval: bool | None = None,
        require_owner_approval_over_cost: int | None = None,
        dry_run_only: bool | None = None,
        retry_policy_jsonb: Mapping[str, Any] | None = None,
        fallback_mode: str | None = None,
        auto_execute_read_only: bool | None = None,
        allow_background_execution: bool | None = None,
        max_calls_per_hour: int | None = None,
        max_chain_steps: int | None = None,
        max_parallel_executions: int | None = None,
        max_spend_usd_cents_per_day: int | None = None,
        approval_mode: str | None = None,
        kill_switch_state: str | None = None,
        allowed_connected_account_ids_jsonb: Sequence[str] | None = None,
        metadata_jsonb: Mapping[str, Any] | None = None,
        lang: str = "en",
    ) -> InstalledToolPolicyUpdateResult:
        normalized_binding_id = str(binding_id or "").strip()
        if not normalized_binding_id:
            raise SiglumeClientError("binding_id is required.")
        payload: dict[str, Any] = {"binding_id": normalized_binding_id}
        if permission_class is not None and str(permission_class).strip():
            payload["permission_class"] = str(permission_class).strip()
        if max_calls_per_day is not None:
            payload["max_calls_per_day"] = int(max_calls_per_day)
        if monthly_usage_cap is not None:
            payload["monthly_usage_cap"] = int(monthly_usage_cap)
        if max_spend_per_execution is not None:
            payload["max_spend_per_execution"] = int(max_spend_per_execution)
        if allowed_tasks_jsonb is not None:
            payload["allowed_tasks_jsonb"] = [str(item) for item in allowed_tasks_jsonb if str(item).strip()]
        if allowed_source_types_jsonb is not None:
            payload["allowed_source_types_jsonb"] = [str(item) for item in allowed_source_types_jsonb if str(item).strip()]
        if timeout_ms is not None:
            payload["timeout_ms"] = int(timeout_ms)
        if cooldown_seconds is not None:
            payload["cooldown_seconds"] = int(cooldown_seconds)
        if require_owner_approval is not None:
            payload["require_owner_approval"] = bool(require_owner_approval)
        if require_owner_approval_over_cost is not None:
            payload["require_owner_approval_over_cost"] = int(require_owner_approval_over_cost)
        if dry_run_only is not None:
            payload["dry_run_only"] = bool(dry_run_only)
        if retry_policy_jsonb is not None:
            payload["retry_policy_jsonb"] = _coerce_mapping(retry_policy_jsonb, "retry_policy_jsonb")
        if fallback_mode is not None and str(fallback_mode).strip():
            payload["fallback_mode"] = str(fallback_mode).strip()
        if auto_execute_read_only is not None:
            payload["auto_execute_read_only"] = bool(auto_execute_read_only)
        if allow_background_execution is not None:
            payload["allow_background_execution"] = bool(allow_background_execution)
        if max_calls_per_hour is not None:
            payload["max_calls_per_hour"] = int(max_calls_per_hour)
        if max_chain_steps is not None:
            payload["max_chain_steps"] = int(max_chain_steps)
        if max_parallel_executions is not None:
            payload["max_parallel_executions"] = int(max_parallel_executions)
        if max_spend_usd_cents_per_day is not None:
            payload["max_spend_usd_cents_per_day"] = int(max_spend_usd_cents_per_day)
        if approval_mode is not None and str(approval_mode).strip():
            payload["approval_mode"] = str(approval_mode).strip()
        if kill_switch_state is not None and str(kill_switch_state).strip():
            payload["kill_switch_state"] = str(kill_switch_state).strip()
        if allowed_connected_account_ids_jsonb is not None:
            payload["allowed_connected_account_ids_jsonb"] = [
                str(item) for item in allowed_connected_account_ids_jsonb if str(item).strip()
            ]
        if metadata_jsonb is not None:
            payload["metadata_jsonb"] = _coerce_mapping(metadata_jsonb, "metadata_jsonb")
        if len(payload) == 1:
            raise SiglumeClientError(
                "update_installed_tool_binding_policy requires at least one policy field to update."
            )
        data, meta = self._request_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "installed_tools.binding.update_policy",
            payload,
            lang=lang,
        )
        return _parse_installed_tool_policy_update_result(
            data,
            operation_key="installed_tools.binding.update_policy",
            meta=meta,
        )

    def get_installed_tool_execution(
        self,
        intent_id: str,
        *,
        agent_id: str | None = None,
        lang: str = "en",
    ) -> InstalledToolExecutionRecord:
        normalized_intent_id = str(intent_id or "").strip()
        if not normalized_intent_id:
            raise SiglumeClientError("intent_id is required.")
        data, _meta = self._request_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "installed_tools.execution.get",
            {"intent_id": normalized_intent_id},
            lang=lang,
        )
        result = data.get("result") if isinstance(data.get("result"), Mapping) else {}
        return _parse_installed_tool_execution(result)

    def list_installed_tool_receipts(
        self,
        *,
        agent_id: str | None = None,
        receipt_agent_id: str | None = None,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
        lang: str = "en",
    ) -> list[InstalledToolReceiptRecord]:
        payload: dict[str, Any] = {
            "limit": max(1, min(int(limit), 100)),
            "offset": max(0, int(offset)),
        }
        if receipt_agent_id is not None and str(receipt_agent_id).strip():
            payload["agent_id"] = str(receipt_agent_id).strip()
        if status is not None and str(status).strip():
            payload["status"] = str(status).strip()
        data, _meta = self._request_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "installed_tools.receipts.list",
            payload,
            lang=lang,
        )
        items = data.get("result") if isinstance(data.get("result"), list) else []
        return [_parse_installed_tool_receipt(item) for item in items if isinstance(item, Mapping)]

    def get_installed_tool_receipt(
        self,
        receipt_id: str,
        *,
        agent_id: str | None = None,
        lang: str = "en",
    ) -> InstalledToolReceiptRecord:
        normalized_receipt_id = str(receipt_id or "").strip()
        if not normalized_receipt_id:
            raise SiglumeClientError("receipt_id is required.")
        data, _meta = self._request_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "installed_tools.receipts.get",
            {"receipt_id": normalized_receipt_id},
            lang=lang,
        )
        result = data.get("result") if isinstance(data.get("result"), Mapping) else {}
        return _parse_installed_tool_receipt(result)

    def get_installed_tool_receipt_steps(
        self,
        receipt_id: str,
        *,
        agent_id: str | None = None,
        lang: str = "en",
    ) -> list[InstalledToolReceiptStepRecord]:
        normalized_receipt_id = str(receipt_id or "").strip()
        if not normalized_receipt_id:
            raise SiglumeClientError("receipt_id is required.")
        data, _meta = self._request_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "installed_tools.receipts.steps.get",
            {"receipt_id": normalized_receipt_id},
            lang=lang,
        )
        items = data.get("result") if isinstance(data.get("result"), list) else []
        return [_parse_installed_tool_receipt_step(item) for item in items if isinstance(item, Mapping)]

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

    def create_webhook_subscription(
        self,
        callback_url: str,
        *,
        description: str | None = None,
        event_types: list[str],
        metadata: Mapping[str, Any] | None = None,
    ) -> WebhookSubscriptionRecord:
        normalized_event_types = [str(item).strip() for item in event_types if str(item).strip()]
        if not normalized_event_types:
            raise SiglumeClientError("event_types must contain at least one webhook event type.")
        payload: dict[str, Any] = {"callback_url": callback_url}
        if description:
            payload["description"] = description
        payload["event_types"] = normalized_event_types
        if metadata:
            payload["metadata"] = _to_dict(metadata)
        data, _meta = self._request("POST", "/market/webhooks/subscriptions", json_body=payload)
        return parse_webhook_subscription(data)

    def list_webhook_subscriptions(self) -> list[WebhookSubscriptionRecord]:
        data, _meta = self._request("GET", "/market/webhooks/subscriptions")
        if not isinstance(data, list):
            raise SiglumeClientError("Expected webhook subscriptions to be returned as an array.")
        return [
            parse_webhook_subscription(item)
            for item in data
            if isinstance(item, Mapping)
        ]

    def get_webhook_subscription(self, subscription_id: str) -> WebhookSubscriptionRecord:
        data, _meta = self._request("GET", f"/market/webhooks/subscriptions/{subscription_id}")
        return parse_webhook_subscription(data)

    def rotate_webhook_subscription_secret(self, subscription_id: str) -> WebhookSubscriptionRecord:
        data, _meta = self._request(
            "POST",
            f"/market/webhooks/subscriptions/{subscription_id}/rotate-secret",
        )
        return parse_webhook_subscription(data)

    def pause_webhook_subscription(self, subscription_id: str) -> WebhookSubscriptionRecord:
        data, _meta = self._request(
            "POST",
            f"/market/webhooks/subscriptions/{subscription_id}/pause",
        )
        return parse_webhook_subscription(data)

    def resume_webhook_subscription(self, subscription_id: str) -> WebhookSubscriptionRecord:
        data, _meta = self._request(
            "POST",
            f"/market/webhooks/subscriptions/{subscription_id}/resume",
        )
        return parse_webhook_subscription(data)

    def list_webhook_deliveries(
        self,
        *,
        subscription_id: str | None = None,
        event_type: str | None = None,
        status: str | None = None,
        limit: int = 20,
    ) -> list[WebhookDeliveryRecord]:
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 100))}
        if subscription_id:
            params["subscription_id"] = subscription_id
        if event_type:
            params["event_type"] = event_type
        if status:
            params["status"] = status
        data, _meta = self._request("GET", "/market/webhooks/deliveries", params=params)
        if not isinstance(data, list):
            raise SiglumeClientError("Expected webhook deliveries to be returned as an array.")
        return [
            parse_webhook_delivery(item)
            for item in data
            if isinstance(item, Mapping)
        ]

    def redeliver_webhook_delivery(self, delivery_id: str) -> WebhookDeliveryRecord:
        data, _meta = self._request(
            "POST",
            f"/market/webhooks/deliveries/{delivery_id}/redeliver",
        )
        return parse_webhook_delivery(data)

    def send_test_webhook_delivery(
        self,
        event_type: str,
        *,
        subscription_ids: list[str] | None = None,
        data: Mapping[str, Any] | None = None,
    ) -> QueuedWebhookEvent:
        payload: dict[str, Any] = {"event_type": event_type}
        if subscription_ids is not None:
            payload["subscription_ids"] = [
                str(item).strip() for item in subscription_ids if str(item).strip()
            ]
        if data:
            payload["data"] = _to_dict(data)
        response_data, _meta = self._request(
            "POST",
            "/market/webhooks/test-deliveries",
            json_body=payload,
        )
        return parse_queued_webhook_event(response_data)

    def list_polygon_mandates(
        self,
        *,
        status: str | None = None,
        purpose: str | None = None,
        limit: int = 50,
    ) -> list[PolygonMandate]:
        target_limit = max(1, int(limit))
        params_base: dict[str, Any] = {}
        if status:
            params_base["status"] = status
        if purpose:
            params_base["purpose"] = purpose
        mandates: list[PolygonMandate] = []
        cursor: str | None = None
        seen_cursors: set[str] = set()
        while len(mandates) < target_limit:
            page_limit = max(1, min(target_limit - len(mandates), 100))
            params: dict[str, Any] = {**params_base, "limit": page_limit}
            if cursor:
                params["cursor"] = cursor
            data, _meta = self._request("GET", "/market/web3/mandates", params=params)
            items = data.get("items") if isinstance(data.get("items"), list) else []
            mandates.extend(
                parse_polygon_mandate(item)
                for item in items
                if isinstance(item, Mapping)
            )
            cursor = _string_or_none(data.get("next_cursor"))
            if not cursor or cursor in seen_cursors:
                break
            seen_cursors.add(cursor)
        return mandates[:target_limit]

    def get_polygon_mandate(
        self,
        mandate_id: str,
        *,
        status: str | None = None,
        purpose: str | None = None,
        limit: int | None = None,
    ) -> PolygonMandate:
        normalized_mandate_id = str(mandate_id or "").strip()
        if not normalized_mandate_id:
            raise SiglumeClientError("mandate_id is required.")
        params_base: dict[str, Any] = {}
        if status:
            params_base["status"] = status
        if purpose:
            params_base["purpose"] = purpose
        remaining = None if limit is None else max(1, int(limit))
        cursor: str | None = None
        seen_cursors: set[str] = set()
        while True:
            page_limit = 100 if remaining is None else max(1, min(remaining, 100))
            params: dict[str, Any] = {**params_base, "limit": page_limit}
            if cursor:
                params["cursor"] = cursor
            data, _meta = self._request("GET", "/market/web3/mandates", params=params)
            items = data.get("items") if isinstance(data.get("items"), list) else []
            parsed_items = [
                parse_polygon_mandate(item)
                for item in items
                if isinstance(item, Mapping)
            ]
            for mandate in parsed_items:
                if mandate.mandate_id == normalized_mandate_id:
                    return mandate
            if remaining is not None:
                remaining -= page_limit
                if remaining <= 0:
                    break
            cursor = _string_or_none(data.get("next_cursor"))
            if not cursor or cursor in seen_cursors:
                break
            seen_cursors.add(cursor)
        raise SiglumeNotFoundError(f"Polygon mandate not found: {normalized_mandate_id}")

    def list_settlement_receipts(
        self,
        *,
        receipt_kind: str | None = None,
        limit: int = 50,
    ) -> list[SettlementReceipt]:
        target_limit = max(1, int(limit))
        params_base: dict[str, Any] = {}
        if receipt_kind:
            params_base["receipt_kind"] = receipt_kind
        receipts: list[SettlementReceipt] = []
        cursor: str | None = None
        seen_cursors: set[str] = set()
        while len(receipts) < target_limit:
            page_limit = max(1, min(target_limit - len(receipts), 100))
            params: dict[str, Any] = {**params_base, "limit": page_limit}
            if cursor:
                params["cursor"] = cursor
            data, _meta = self._request("GET", "/market/web3/receipts", params=params)
            items = data.get("items") if isinstance(data.get("items"), list) else []
            receipts.extend(
                parse_settlement_receipt(item)
                for item in items
                if isinstance(item, Mapping)
            )
            cursor = _string_or_none(data.get("next_cursor"))
            if not cursor or cursor in seen_cursors:
                break
            seen_cursors.add(cursor)
        return receipts[:target_limit]

    def get_settlement_receipt(
        self,
        receipt_id: str,
        *,
        receipt_kind: str | None = None,
        limit: int | None = None,
    ) -> SettlementReceipt:
        normalized_receipt_id = str(receipt_id or "").strip()
        if not normalized_receipt_id:
            raise SiglumeClientError("receipt_id is required.")
        params_base: dict[str, Any] = {}
        if receipt_kind:
            params_base["receipt_kind"] = receipt_kind
        remaining = None if limit is None else max(1, int(limit))
        cursor: str | None = None
        seen_cursors: set[str] = set()
        while True:
            page_limit = 100 if remaining is None else max(1, min(remaining, 100))
            params: dict[str, Any] = {**params_base, "limit": page_limit}
            if cursor:
                params["cursor"] = cursor
            data, _meta = self._request("GET", "/market/web3/receipts", params=params)
            items = data.get("items") if isinstance(data.get("items"), list) else []
            parsed_items = [
                parse_settlement_receipt(item)
                for item in items
                if isinstance(item, Mapping)
            ]
            for receipt in parsed_items:
                if receipt.receipt_id == normalized_receipt_id or receipt.chain_receipt_id == normalized_receipt_id:
                    return receipt
            if remaining is not None:
                remaining -= page_limit
                if remaining <= 0:
                    break
            cursor = _string_or_none(data.get("next_cursor"))
            if not cursor or cursor in seen_cursors:
                break
            seen_cursors.add(cursor)
        raise SiglumeNotFoundError(f"Settlement receipt not found: {normalized_receipt_id}")

    def get_embedded_wallet_charge(
        self,
        *,
        tx_hash: str,
        limit: int | None = None,
    ) -> EmbeddedWalletCharge:
        normalized_tx_hash = str(tx_hash or "").strip()
        if not normalized_tx_hash:
            raise SiglumeClientError("tx_hash is required.")
        lookup_hash = normalized_tx_hash.lower()
        remaining = None if limit is None else max(1, int(limit))
        cursor: str | None = None
        seen_cursors: set[str] = set()
        while True:
            page_limit = 100 if remaining is None else max(1, min(remaining, 100))
            params: dict[str, Any] = {"limit": page_limit}
            if cursor:
                params["cursor"] = cursor
            data, _meta = self._request("GET", "/market/web3/receipts", params=params)
            items = data.get("items") if isinstance(data.get("items"), list) else []
            parsed_items = [
                parse_settlement_receipt(item)
                for item in items
                if isinstance(item, Mapping)
            ]
            for receipt in parsed_items:
                kind = (receipt.receipt_kind or "").lower()
                if "charge" not in kind and "payment" not in kind:
                    continue
                candidate_hashes = {
                    (receipt.tx_hash or "").lower(),
                    (receipt.user_operation_hash or "").lower(),
                    (receipt.submitted_hash or "").lower(),
                }
                candidate_hashes.discard("")
                if lookup_hash in candidate_hashes:
                    return parse_embedded_wallet_charge(receipt=receipt)
            if remaining is not None:
                remaining -= page_limit
                if remaining <= 0:
                    break
            cursor = _string_or_none(data.get("next_cursor"))
            if not cursor or cursor in seen_cursors:
                break
            seen_cursors.add(cursor)
        raise SiglumeNotFoundError(f"Embedded wallet charge not found: {normalized_tx_hash}")

    def get_cross_currency_quote(
        self,
        *,
        from_currency: str,
        to_currency: str,
        source_amount_minor: int,
        slippage_bps: int = 100,
    ) -> CrossCurrencyQuote:
        normalized_from_currency = str(from_currency or "").strip().upper()
        normalized_to_currency = str(to_currency or "").strip().upper()
        if not normalized_from_currency:
            raise SiglumeClientError("from_currency is required.")
        if not normalized_to_currency:
            raise SiglumeClientError("to_currency is required.")
        try:
            normalized_amount_minor = int(source_amount_minor)
        except (TypeError, ValueError, OverflowError) as exc:
            raise SiglumeClientError("source_amount_minor must be a finite integer.") from exc
        if normalized_amount_minor <= 0:
            raise SiglumeClientError("source_amount_minor must be positive.")
        normalized_slippage_bps = max(0, min(int(slippage_bps), 5_000))
        data, _meta = self._request(
            "POST",
            "/market/web3/swap/quote",
            json_body={
                "sell_token": normalized_from_currency,
                "buy_token": normalized_to_currency,
                "amount_minor": normalized_amount_minor,
                "slippage_bps": normalized_slippage_bps,
            },
        )
        return parse_cross_currency_quote(data)

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any | None = None,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> tuple[Any, EnvelopeMeta]:
        for attempt in range(self.max_retries):
            response = self._client.request(method, path, json=json_body, params=params, headers=headers)
            if response.status_code in RETRYABLE_STATUS_CODES and attempt + 1 < self.max_retries:
                delay = _parse_retry_after(response)
                if delay is None:
                    delay = 0.5 * (2 ** attempt)
                time.sleep(delay)
                continue
            return self._handle_response(response)
        raise SiglumeClientError("Retry loop exhausted unexpectedly.")

    def _agent_headers(self) -> dict[str, str]:
        if not self.agent_key:
            raise SiglumeClientError(
                "agent_key is required for agent.* routes. Pass agent_key=... when constructing SiglumeClient."
            )
        return {"X-Agent-Key": self.agent_key}

    def _handle_response(self, response: httpx.Response) -> tuple[Any, EnvelopeMeta]:
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
        if isinstance(data, Mapping):
            return dict(data), meta
        if isinstance(data, list):
            return [_clone_json_like(item) for item in data], meta
        raise SiglumeClientError("Expected the Siglume API response body to be an object or array.")
