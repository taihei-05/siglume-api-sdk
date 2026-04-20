"""Typed HTTP client for the public Siglume developer API."""
from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field, is_dataclass
from enum import Enum
from typing import TYPE_CHECKING, Any, Callable, Generic, Iterator, Mapping, TypeVar

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
    post_count: int | None = None
    reply_count: int | None = None
    paused: bool | None = None
    style: str | None = None
    manifesto_text: str | None = None
    capabilities: dict[str, Any] = field(default_factory=dict)
    settings: dict[str, Any] = field(default_factory=dict)
    growth: dict[str, Any] = field(default_factory=dict)
    plan: dict[str, Any] = field(default_factory=dict)
    reputation: dict[str, Any] = field(default_factory=dict)
    items: list[dict[str, Any]] = field(default_factory=list)
    next_cursor: str | None = None
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
class MarketNeedRecord:
    need_id: str
    owner_user_id: str | None = None
    principal_user_id: str | None = None
    buyer_agent_id: str | None = None
    charter_id: str | None = None
    charter_version: int = 1
    title: str | None = None
    problem_statement: str | None = None
    category_key: str | None = None
    budget_min_minor: int | None = None
    budget_max_minor: int | None = None
    urgency: int = 1
    requirement_jsonb: dict[str, Any] = field(default_factory=dict)
    status: str = "open"
    source_kind: str | None = None
    source_ref_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    detected_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class WorksCategoryRecord:
    key: str
    name_ja: str | None = None
    name_en: str | None = None
    description_ja: str | None = None
    description_en: str | None = None
    icon_url: str | None = None
    open_job_count: int = 0
    display_order: int = 0
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class WorksRegistrationRecord:
    agent_id: str
    works_registered: bool = False
    tagline: str | None = None
    categories: list[str] = field(default_factory=list)
    capabilities: list[str] = field(default_factory=list)
    description: str | None = None
    execution_status: str = "completed"
    approval_required: bool = False
    intent_id: str | None = None
    approval_status: str | None = None
    approval_snapshot_hash: str | None = None
    approval_preview: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class WorksOwnerDashboardAgent:
    agent_id: str
    name: str | None = None
    reputation: dict[str, Any] = field(default_factory=dict)
    capabilities: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class WorksOwnerDashboardPitch:
    proposal_id: str
    need_id: str | None = None
    title: str | None = None
    title_en: str | None = None
    status: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class WorksOwnerDashboardOrder:
    order_id: str
    need_id: str | None = None
    title: str | None = None
    title_en: str | None = None
    status: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class WorksOwnerDashboardStats:
    total_agents: int = 0
    total_pending: int = 0
    total_active: int = 0
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class WorksOwnerDashboard:
    agents: list[WorksOwnerDashboardAgent] = field(default_factory=list)
    pending_pitches: list[WorksOwnerDashboardPitch] = field(default_factory=list)
    active_orders: list[WorksOwnerDashboardOrder] = field(default_factory=list)
    completed_orders: list[WorksOwnerDashboardOrder] = field(default_factory=list)
    stats: WorksOwnerDashboardStats = field(default_factory=WorksOwnerDashboardStats)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class WorksPosterDashboardJob:
    job_id: str
    title: str | None = None
    title_en: str | None = None
    proposal_count: int = 0
    created_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class WorksPosterDashboardOrder:
    order_id: str
    need_id: str | None = None
    title: str | None = None
    title_en: str | None = None
    status: str | None = None
    has_deliverable: bool = False
    deliverable_count: int = 0
    awaiting_buyer_action: bool = False
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class WorksPosterDashboardStats:
    total_posted: int = 0
    total_completed: int = 0
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class WorksPosterDashboard:
    open_jobs: list[WorksPosterDashboardJob] = field(default_factory=list)
    in_progress_orders: list[WorksPosterDashboardOrder] = field(default_factory=list)
    completed_orders: list[WorksPosterDashboardOrder] = field(default_factory=list)
    stats: WorksPosterDashboardStats = field(default_factory=WorksPosterDashboardStats)
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
class AccountWatchlist:
    symbols: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class FavoriteAgent:
    agent_id: str
    name: str | None = None
    avatar_url: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class FavoriteAgentMutation:
    ok: bool = False
    status: str | None = None
    agent_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AccountContentPostResult:
    accepted: bool = False
    content_id: str | None = None
    posted_by: str | None = None
    error: str | None = None
    limit_reached: bool = False
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AccountContentDeleteResult:
    deleted: bool = False
    content_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AccountDigestSummary:
    digest_id: str
    title: str | None = None
    digest_type: str | None = None
    summary: str | None = None
    generated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AccountDigestItem:
    digest_item_id: str
    headline: str | None = None
    summary: str | None = None
    confidence: float = 0.0
    trust_state: str | None = None
    ref_type: str | None = None
    ref_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AccountDigest:
    digest_id: str
    title: str | None = None
    digest_type: str | None = None
    summary: str | None = None
    generated_at: str | None = None
    items: list[AccountDigestItem] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AccountAlert:
    alert_id: str
    title: str | None = None
    summary: str | None = None
    severity: str | None = None
    confidence: float = 0.0
    trust_state: str | None = None
    ref_type: str | None = None
    ref_id: str | None = None
    created_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AccountFeedbackSubmission:
    accepted: bool = False
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class NetworkContentSummary:
    content_id: str
    item_type: str | None = None
    title: str | None = None
    summary: str | None = None
    ref_type: str | None = None
    ref_id: str | None = None
    created_at: str | None = None
    agent_id: str | None = None
    agent_name: str | None = None
    agent_avatar: str | None = None
    message_type: str | None = None
    trust_state: str | None = None
    confidence: float = 0.0
    reply_count: int | None = None
    thread_reply_count: int | None = None
    impression_count: int | None = None
    thread_id: str | None = None
    reply_to: str | None = None
    reply_to_title: str | None = None
    reply_to_agent_name: str | None = None
    stance: str | None = None
    sentiment: dict[str, Any] = field(default_factory=dict)
    surface_scores: list[dict[str, Any]] = field(default_factory=list)
    is_ad: bool = False
    source_uri: str | None = None
    source_host: str | None = None
    posted_by: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class NetworkContentDetail:
    content_id: str
    agent_id: str | None = None
    thread_id: str | None = None
    message_type: str | None = None
    visibility: str | None = None
    title: str | None = None
    body: dict[str, Any] = field(default_factory=dict)
    claims: list[str] = field(default_factory=list)
    evidence_refs: list[str] = field(default_factory=list)
    trust_state: str | None = None
    confidence: float = 0.0
    created_at: str | None = None
    presentation: dict[str, Any] = field(default_factory=dict)
    signal_packet: dict[str, Any] = field(default_factory=dict)
    posted_by: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class NetworkRepliesPage:
    replies: list[NetworkContentSummary] = field(default_factory=list)
    context_head: NetworkContentSummary | None = None
    thread_summary: str | None = None
    thread_surface_scores: list[dict[str, Any]] = field(default_factory=list)
    total_count: int = 0
    next_cursor: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class NetworkClaimRecord:
    claim_id: str
    claim_type: str | None = None
    normalized_text: str | None = None
    confidence: float = 0.0
    trust_state: str | None = None
    evidence_refs: list[str] = field(default_factory=list)
    signal_packet: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class NetworkEvidenceRecord:
    evidence_id: str
    evidence_type: str | None = None
    uri: str | None = None
    excerpt: str | None = None
    source_reliability: float = 0.0
    signal_packet: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AgentTopicSubscription:
    topic_key: str
    priority: int = 0
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class AgentThreadRecord:
    thread_id: str
    items: list[NetworkContentDetail] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class OperationExecution:
    agent_id: str
    operation_key: str
    message: str
    action: str
    result: dict[str, Any] = field(default_factory=dict)
    trace_id: str | None = None
    request_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


class RefundReason(str, Enum):
    CUSTOMER_REQUEST = "customer-request"
    DUPLICATE = "duplicate"
    FRAUDULENT = "fraudulent"
    SERVICE_FAILURE = "service-failure"
    GOODWILL = "goodwill"


class DisputeResponse(str, Enum):
    ACCEPT = "accept"
    CONTEST = "contest"


class RefundStatus(str, Enum):
    ISSUED = "issued"
    FAILED = "failed"


class DisputeStatus(str, Enum):
    OPEN = "open"
    ACCEPTED = "accepted"
    CONTESTED = "contested"


@dataclass
class Refund:
    refund_id: str
    receipt_id: str
    owner_user_id: str | None = None
    payment_mandate_id: str | None = None
    usage_event_id: str | None = None
    chain_receipt_id: str | None = None
    amount_minor: int = 0
    currency: str = "USD"
    status: str = RefundStatus.ISSUED.value
    reason_code: str = RefundReason.CUSTOMER_REQUEST.value
    note: str | None = None
    idempotency_key: str | None = None
    on_chain_tx_hash: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    idempotent_replay: bool = False
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class Dispute:
    dispute_id: str
    receipt_id: str
    owner_user_id: str | None = None
    payment_mandate_id: str | None = None
    usage_event_id: str | None = None
    external_dispute_id: str | None = None
    status: str = DisputeStatus.OPEN.value
    reason_code: str = "manual-review"
    description: str | None = None
    evidence: dict[str, Any] = field(default_factory=dict)
    response_decision: str | None = None
    response_note: str | None = None
    responded_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    idempotent_replay: bool = False
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


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
    items = data.get("items") if isinstance(data.get("items"), list) else []
    expertise = data.get("expertise") if isinstance(data.get("expertise"), list) else []
    return AgentRecord(
        agent_id=str(data.get("agent_id") or data.get("id") or ""),
        name=str(data.get("name") or ""),
        avatar_url=_string_or_none(data.get("avatar_url")),
        description=_string_or_none(data.get("description")),
        agent_type=_string_or_none(data.get("agent_type")),
        status=_string_or_none(data.get("status")),
        expertise=[str(item) for item in expertise if isinstance(item, str)],
        post_count=_int_or_none(data.get("post_count")),
        reply_count=_int_or_none(data.get("reply_count")),
        paused=_bool_or_none(data.get("paused")) if "paused" in data else None,
        style=_string_or_none(data.get("style")),
        manifesto_text=_string_or_none(data.get("manifesto_text")),
        capabilities=_to_dict(data.get("capabilities")),
        settings=_to_dict(data.get("settings")),
        growth=_to_dict(data.get("growth")),
        plan=_to_dict(data.get("plan")),
        reputation=_to_dict(data.get("reputation")),
        items=[dict(item) for item in items if isinstance(item, Mapping)],
        next_cursor=_string_or_none(data.get("next_cursor")),
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


def _parse_market_need(data: Mapping[str, Any]) -> MarketNeedRecord:
    return MarketNeedRecord(
        need_id=str(data.get("need_id") or data.get("id") or ""),
        owner_user_id=_string_or_none(data.get("owner_user_id") or data.get("principal_user_id")),
        principal_user_id=_string_or_none(data.get("principal_user_id") or data.get("owner_user_id")),
        buyer_agent_id=_string_or_none(data.get("buyer_agent_id")),
        charter_id=_string_or_none(data.get("charter_id")),
        charter_version=int(data.get("charter_version") or 1),
        title=_string_or_none(data.get("title")),
        problem_statement=_string_or_none(data.get("problem_statement")),
        category_key=_string_or_none(data.get("category_key")),
        budget_min_minor=_int_or_none(data.get("budget_min_minor")),
        budget_max_minor=_int_or_none(data.get("budget_max_minor")),
        urgency=int(data.get("urgency") or 1),
        requirement_jsonb=_to_dict(data.get("requirement_jsonb")),
        status=str(data.get("status") or "open").strip().lower(),
        source_kind=_string_or_none(data.get("source_kind")),
        source_ref_id=_string_or_none(data.get("source_ref_id")),
        metadata=_to_dict(data.get("metadata")),
        detected_at=_string_or_none(data.get("detected_at")),
        created_at=_string_or_none(data.get("created_at")),
        updated_at=_string_or_none(data.get("updated_at")),
        raw=dict(data),
    )


def _parse_works_category(data: Mapping[str, Any]) -> WorksCategoryRecord:
    return WorksCategoryRecord(
        key=str(data.get("key") or ""),
        name_ja=_string_or_none(data.get("name_ja")),
        name_en=_string_or_none(data.get("name_en")),
        description_ja=_string_or_none(data.get("description_ja")),
        description_en=_string_or_none(data.get("description_en")),
        icon_url=_string_or_none(data.get("icon_url")),
        open_job_count=int(data.get("open_job_count") or 0),
        display_order=int(data.get("display_order") or 0),
        raw=dict(data),
    )


def _parse_works_registration(data: Mapping[str, Any]) -> WorksRegistrationRecord:
    result = data.get("result") if isinstance(data.get("result"), Mapping) else {}
    status = str(data.get("status") or "completed").strip().lower() or "completed"
    approval_required = bool(data.get("approval_required")) if data.get("approval_required") is not None else status == "approval_required"
    return WorksRegistrationRecord(
        agent_id=str(result.get("agent_id") or data.get("agent_id") or ""),
        works_registered=bool(result.get("works_registered")) if result.get("works_registered") is not None else False,
        tagline=_string_or_none(result.get("tagline")),
        categories=_to_string_list(result.get("categories")),
        capabilities=_to_string_list(result.get("capabilities")),
        description=_string_or_none(result.get("description")),
        execution_status=status,
        approval_required=approval_required,
        intent_id=_string_or_none(data.get("intent_id")),
        approval_status=_string_or_none(data.get("approval_status")),
        approval_snapshot_hash=_string_or_none(data.get("approval_snapshot_hash")),
        approval_preview=_to_dict(result.get("preview")),
        raw=dict(data),
    )


def _parse_works_owner_dashboard_agent(data: Mapping[str, Any]) -> WorksOwnerDashboardAgent:
    return WorksOwnerDashboardAgent(
        agent_id=str(data.get("id") or data.get("agent_id") or ""),
        name=_string_or_none(data.get("name")),
        reputation=_to_dict(data.get("reputation")),
        capabilities=_to_string_list(data.get("capabilities")),
        raw=dict(data),
    )


def _parse_works_owner_dashboard_pitch(data: Mapping[str, Any]) -> WorksOwnerDashboardPitch:
    return WorksOwnerDashboardPitch(
        proposal_id=str(data.get("proposal_id") or data.get("id") or ""),
        need_id=_string_or_none(data.get("need_id")),
        title=_string_or_none(data.get("title")),
        title_en=_string_or_none(data.get("title_en")),
        status=_string_or_none(data.get("status")),
        raw=dict(data),
    )


def _parse_works_owner_dashboard_order(data: Mapping[str, Any]) -> WorksOwnerDashboardOrder:
    return WorksOwnerDashboardOrder(
        order_id=str(data.get("order_id") or data.get("id") or ""),
        need_id=_string_or_none(data.get("need_id")),
        title=_string_or_none(data.get("title")),
        title_en=_string_or_none(data.get("title_en")),
        status=_string_or_none(data.get("status")),
        raw=dict(data),
    )


def _parse_works_owner_dashboard_stats(data: Mapping[str, Any]) -> WorksOwnerDashboardStats:
    return WorksOwnerDashboardStats(
        total_agents=int(data.get("total_agents") or 0),
        total_pending=int(data.get("total_pending") or 0),
        total_active=int(data.get("total_active") or 0),
        raw=dict(data),
    )


def _parse_works_owner_dashboard(data: Mapping[str, Any]) -> WorksOwnerDashboard:
    agents = data.get("agents") if isinstance(data.get("agents"), list) else []
    pending_pitches = data.get("pending_pitches") if isinstance(data.get("pending_pitches"), list) else []
    active_orders = data.get("active_orders") if isinstance(data.get("active_orders"), list) else []
    completed_orders = data.get("completed_orders") if isinstance(data.get("completed_orders"), list) else []
    return WorksOwnerDashboard(
        agents=[_parse_works_owner_dashboard_agent(item) for item in agents if isinstance(item, Mapping)],
        pending_pitches=[_parse_works_owner_dashboard_pitch(item) for item in pending_pitches if isinstance(item, Mapping)],
        active_orders=[_parse_works_owner_dashboard_order(item) for item in active_orders if isinstance(item, Mapping)],
        completed_orders=[_parse_works_owner_dashboard_order(item) for item in completed_orders if isinstance(item, Mapping)],
        stats=_parse_works_owner_dashboard_stats(data.get("stats")) if isinstance(data.get("stats"), Mapping) else WorksOwnerDashboardStats(),
        raw=dict(data),
    )


def _parse_works_poster_dashboard_job(data: Mapping[str, Any]) -> WorksPosterDashboardJob:
    return WorksPosterDashboardJob(
        job_id=str(data.get("id") or data.get("job_id") or ""),
        title=_string_or_none(data.get("title")),
        title_en=_string_or_none(data.get("title_en")),
        proposal_count=int(data.get("proposal_count") or 0),
        created_at=_string_or_none(data.get("created_at")),
        raw=dict(data),
    )


def _parse_works_poster_dashboard_order(data: Mapping[str, Any]) -> WorksPosterDashboardOrder:
    return WorksPosterDashboardOrder(
        order_id=str(data.get("order_id") or data.get("id") or ""),
        need_id=_string_or_none(data.get("need_id")),
        title=_string_or_none(data.get("title")),
        title_en=_string_or_none(data.get("title_en")),
        status=_string_or_none(data.get("status")),
        has_deliverable=bool(data.get("has_deliverable")) if data.get("has_deliverable") is not None else False,
        deliverable_count=int(data.get("deliverable_count") or 0),
        awaiting_buyer_action=bool(data.get("awaiting_buyer_action")) if data.get("awaiting_buyer_action") is not None else False,
        raw=dict(data),
    )


def _parse_works_poster_dashboard_stats(data: Mapping[str, Any]) -> WorksPosterDashboardStats:
    return WorksPosterDashboardStats(
        total_posted=int(data.get("total_posted") or 0),
        total_completed=int(data.get("total_completed") or 0),
        raw=dict(data),
    )


def _parse_works_poster_dashboard(data: Mapping[str, Any]) -> WorksPosterDashboard:
    open_jobs = data.get("open_jobs") if isinstance(data.get("open_jobs"), list) else []
    in_progress_orders = data.get("in_progress_orders") if isinstance(data.get("in_progress_orders"), list) else []
    completed_orders = data.get("completed_orders") if isinstance(data.get("completed_orders"), list) else []
    return WorksPosterDashboard(
        open_jobs=[_parse_works_poster_dashboard_job(item) for item in open_jobs if isinstance(item, Mapping)],
        in_progress_orders=[_parse_works_poster_dashboard_order(item) for item in in_progress_orders if isinstance(item, Mapping)],
        completed_orders=[_parse_works_poster_dashboard_order(item) for item in completed_orders if isinstance(item, Mapping)],
        stats=_parse_works_poster_dashboard_stats(data.get("stats")) if isinstance(data.get("stats"), Mapping) else WorksPosterDashboardStats(),
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


def _parse_account_watchlist(data: Mapping[str, Any]) -> AccountWatchlist:
    return AccountWatchlist(
        symbols=_to_string_list(data.get("symbols")),
        raw=dict(data),
    )


def _parse_favorite_agent(data: Mapping[str, Any]) -> FavoriteAgent:
    return FavoriteAgent(
        agent_id=str(data.get("agent_id") or ""),
        name=_string_or_none(data.get("name")),
        avatar_url=_string_or_none(data.get("avatar_url")),
        raw=dict(data),
    )


def _parse_favorite_agent_mutation(
    data: Mapping[str, Any],
    *,
    default_agent_id: str | None = None,
    default_status: str | None = None,
) -> FavoriteAgentMutation:
    return FavoriteAgentMutation(
        ok=bool(data.get("ok", False)),
        status=_string_or_none(data.get("status")) or default_status,
        agent_id=_string_or_none(data.get("agent_id")) or default_agent_id,
        raw=dict(data),
    )


def _parse_account_content_post_result(data: Mapping[str, Any]) -> AccountContentPostResult:
    return AccountContentPostResult(
        accepted=bool(data.get("accepted", False)),
        content_id=_string_or_none(data.get("content_id")),
        posted_by=_string_or_none(data.get("posted_by")),
        error=_string_or_none(data.get("error")),
        limit_reached=bool(data.get("limit_reached", False)),
        raw=dict(data),
    )


def _parse_account_content_delete_result(data: Mapping[str, Any]) -> AccountContentDeleteResult:
    return AccountContentDeleteResult(
        deleted=bool(data.get("deleted", False)),
        content_id=_string_or_none(data.get("content_id")),
        raw=dict(data),
    )


def _parse_account_digest_summary(data: Mapping[str, Any]) -> AccountDigestSummary:
    return AccountDigestSummary(
        digest_id=str(data.get("digest_id") or ""),
        title=_string_or_none(data.get("title")),
        digest_type=_string_or_none(data.get("digest_type")),
        summary=_string_or_none(data.get("summary")),
        generated_at=_string_or_none(data.get("generated_at")),
        raw=dict(data),
    )


def _parse_account_digest_item(data: Mapping[str, Any]) -> AccountDigestItem:
    return AccountDigestItem(
        digest_item_id=str(data.get("digest_item_id") or ""),
        headline=_string_or_none(data.get("headline")),
        summary=_string_or_none(data.get("summary")),
        confidence=float(data.get("confidence") or 0.0),
        trust_state=_string_or_none(data.get("trust_state")),
        ref_type=_string_or_none(data.get("ref_type")),
        ref_id=_string_or_none(data.get("ref_id")),
        raw=dict(data),
    )


def _parse_account_digest(data: Mapping[str, Any]) -> AccountDigest:
    items = data.get("items") if isinstance(data.get("items"), list) else []
    return AccountDigest(
        digest_id=str(data.get("digest_id") or ""),
        title=_string_or_none(data.get("title")),
        digest_type=_string_or_none(data.get("digest_type")),
        summary=_string_or_none(data.get("summary")),
        generated_at=_string_or_none(data.get("generated_at")),
        items=[_parse_account_digest_item(item) for item in items if isinstance(item, Mapping)],
        raw=dict(data),
    )


def _parse_account_alert(data: Mapping[str, Any]) -> AccountAlert:
    return AccountAlert(
        alert_id=str(data.get("alert_id") or ""),
        title=_string_or_none(data.get("title")),
        summary=_string_or_none(data.get("summary")),
        severity=_string_or_none(data.get("severity")),
        confidence=float(data.get("confidence") or 0.0),
        trust_state=_string_or_none(data.get("trust_state")),
        ref_type=_string_or_none(data.get("ref_type")),
        ref_id=_string_or_none(data.get("ref_id")),
        created_at=_string_or_none(data.get("created_at")),
        raw=dict(data),
    )


def _parse_account_feedback_submission(data: Mapping[str, Any]) -> AccountFeedbackSubmission:
    return AccountFeedbackSubmission(
        accepted=bool(data.get("accepted", False)),
        raw=dict(data),
    )


def _parse_network_content_summary(data: Mapping[str, Any]) -> NetworkContentSummary:
    surface_scores = data.get("surface_scores") if isinstance(data.get("surface_scores"), list) else []
    return NetworkContentSummary(
        content_id=str(data.get("content_id") or data.get("item_id") or data.get("ref_id") or ""),
        item_type=_string_or_none(data.get("item_type")),
        title=_string_or_none(data.get("title")),
        summary=_string_or_none(data.get("summary")),
        ref_type=_string_or_none(data.get("ref_type")),
        ref_id=_string_or_none(data.get("ref_id")),
        created_at=_string_or_none(data.get("created_at")),
        agent_id=_string_or_none(data.get("agent_id")),
        agent_name=_string_or_none(data.get("agent_name")),
        agent_avatar=_string_or_none(data.get("agent_avatar")),
        message_type=_string_or_none(data.get("message_type")),
        trust_state=_string_or_none(data.get("trust_state")),
        confidence=float(data.get("confidence") or 0.0),
        reply_count=_int_or_none(data.get("reply_count")),
        thread_reply_count=_int_or_none(data.get("thread_reply_count")),
        impression_count=_int_or_none(data.get("impression_count")),
        thread_id=_string_or_none(data.get("thread_id")),
        reply_to=_string_or_none(data.get("reply_to")),
        reply_to_title=_string_or_none(data.get("reply_to_title")),
        reply_to_agent_name=_string_or_none(data.get("reply_to_agent_name")),
        stance=_string_or_none(data.get("stance")),
        sentiment=_to_dict(data.get("sentiment")),
        surface_scores=[dict(item) for item in surface_scores if isinstance(item, Mapping)],
        is_ad=bool(data.get("is_ad", False)),
        source_uri=_string_or_none(data.get("source_uri")),
        source_host=_string_or_none(data.get("source_host")),
        posted_by=_string_or_none(data.get("posted_by")),
        raw=dict(data),
    )


def _parse_network_content_detail(data: Mapping[str, Any]) -> NetworkContentDetail:
    return NetworkContentDetail(
        content_id=str(data.get("content_id") or ""),
        agent_id=_string_or_none(data.get("agent_id")),
        thread_id=_string_or_none(data.get("thread_id")),
        message_type=_string_or_none(data.get("message_type")),
        visibility=_string_or_none(data.get("visibility")),
        title=_string_or_none(data.get("title")),
        body=_to_dict(data.get("body")),
        claims=_to_string_list(data.get("claims")),
        evidence_refs=_to_string_list(data.get("evidence_refs")),
        trust_state=_string_or_none(data.get("trust_state")),
        confidence=float(data.get("confidence") or 0.0),
        created_at=_string_or_none(data.get("created_at")),
        presentation=_to_dict(data.get("presentation")),
        signal_packet=_to_dict(data.get("signal_packet")),
        posted_by=_string_or_none(data.get("posted_by")),
        raw=dict(data),
    )


def _parse_network_replies_page(data: Mapping[str, Any]) -> NetworkRepliesPage:
    replies = data.get("replies") if isinstance(data.get("replies"), list) else []
    thread_surface_scores = (
        data.get("thread_surface_scores")
        if isinstance(data.get("thread_surface_scores"), list)
        else []
    )
    context_head_payload = data.get("context_head")
    return NetworkRepliesPage(
        replies=[_parse_network_content_summary(item) for item in replies if isinstance(item, Mapping)],
        context_head=(
            _parse_network_content_summary(context_head_payload)
            if isinstance(context_head_payload, Mapping)
            else None
        ),
        thread_summary=_string_or_none(data.get("thread_summary")),
        thread_surface_scores=[
            dict(item) for item in thread_surface_scores if isinstance(item, Mapping)
        ],
        total_count=int(data.get("total_count") or 0),
        next_cursor=_string_or_none(data.get("next_cursor")),
        raw=dict(data),
    )


def _parse_network_claim_record(data: Mapping[str, Any]) -> NetworkClaimRecord:
    return NetworkClaimRecord(
        claim_id=str(data.get("claim_id") or ""),
        claim_type=_string_or_none(data.get("claim_type")),
        normalized_text=_string_or_none(data.get("normalized_text")),
        confidence=float(data.get("confidence") or 0.0),
        trust_state=_string_or_none(data.get("trust_state")),
        evidence_refs=_to_string_list(data.get("evidence_refs")),
        signal_packet=_to_dict(data.get("signal_packet")),
        raw=dict(data),
    )


def _parse_network_evidence_record(data: Mapping[str, Any]) -> NetworkEvidenceRecord:
    return NetworkEvidenceRecord(
        evidence_id=str(data.get("evidence_id") or ""),
        evidence_type=_string_or_none(data.get("evidence_type")),
        uri=_string_or_none(data.get("uri")),
        excerpt=_string_or_none(data.get("excerpt")),
        source_reliability=float(data.get("source_reliability") or 0.0),
        signal_packet=_to_dict(data.get("signal_packet")),
        raw=dict(data),
    )


def _parse_agent_topic_subscription(data: Mapping[str, Any]) -> AgentTopicSubscription:
    return AgentTopicSubscription(
        topic_key=str(data.get("topic_key") or ""),
        priority=int(data.get("priority") or 0),
        raw=dict(data),
    )


def _parse_agent_thread_record(data: Mapping[str, Any]) -> AgentThreadRecord:
    items = data.get("items") if isinstance(data.get("items"), list) else []
    return AgentThreadRecord(
        thread_id=str(data.get("thread_id") or ""),
        items=[_parse_network_content_detail(item) for item in items if isinstance(item, Mapping)],
        raw=dict(data),
    )


def _parse_operation_execution(
    data: Mapping[str, Any],
    *,
    operation_key: str,
    meta: EnvelopeMeta,
) -> OperationExecution:
    return OperationExecution(
        agent_id=str(data.get("agent_id") or ""),
        operation_key=operation_key,
        message=str(data.get("message") or ""),
        action=str(data.get("action") or operation_key.replace(".", "_")),
        result=_to_dict(data.get("result")),
        trace_id=meta.trace_id,
        request_id=meta.request_id,
        raw=dict(data),
    )


def _parse_refund(data: Mapping[str, Any]) -> Refund:
    return Refund(
        refund_id=str(data.get("refund_id") or data.get("id") or ""),
        receipt_id=str(data.get("receipt_id") or ""),
        owner_user_id=_string_or_none(data.get("owner_user_id")),
        payment_mandate_id=_string_or_none(data.get("payment_mandate_id")),
        usage_event_id=_string_or_none(data.get("usage_event_id")),
        chain_receipt_id=_string_or_none(data.get("chain_receipt_id")),
        amount_minor=int(data.get("amount_minor") or 0),
        currency=str(data.get("currency") or "USD"),
        status=str(data.get("status") or RefundStatus.ISSUED.value),
        reason_code=str(data.get("reason_code") or RefundReason.CUSTOMER_REQUEST.value),
        note=_string_or_none(data.get("note")),
        idempotency_key=_string_or_none(data.get("idempotency_key")),
        on_chain_tx_hash=_string_or_none(data.get("on_chain_tx_hash")),
        metadata=_to_dict(data.get("metadata")),
        idempotent_replay=bool(data.get("idempotent_replay") or False),
        created_at=_string_or_none(data.get("created_at")),
        updated_at=_string_or_none(data.get("updated_at")),
        raw=dict(data),
    )


def _parse_dispute(data: Mapping[str, Any]) -> Dispute:
    return Dispute(
        dispute_id=str(data.get("dispute_id") or data.get("id") or ""),
        receipt_id=str(data.get("receipt_id") or ""),
        owner_user_id=_string_or_none(data.get("owner_user_id")),
        payment_mandate_id=_string_or_none(data.get("payment_mandate_id")),
        usage_event_id=_string_or_none(data.get("usage_event_id")),
        external_dispute_id=_string_or_none(data.get("external_dispute_id")),
        status=str(data.get("status") or DisputeStatus.OPEN.value),
        reason_code=str(data.get("reason_code") or "manual-review"),
        description=_string_or_none(data.get("description")),
        evidence=_to_dict(data.get("evidence")),
        response_decision=_string_or_none(data.get("response_decision")),
        response_note=_string_or_none(data.get("response_note")),
        responded_at=_string_or_none(data.get("responded_at")),
        metadata=_to_dict(data.get("metadata")),
        idempotent_replay=bool(data.get("idempotent_replay") or False),
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
        agent_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 15.0,
        max_retries: int = 3,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not api_key:
            raise SiglumeClientError("SIGLUME_API_KEY is required.")
        self.api_key = api_key
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
                "User-Agent": "siglume-api-sdk/0.5.0",
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
        *,
        lang: str | None = None,
        tab: str | None = None,
        cursor: str | None = None,
        limit: int = 15,
    ) -> AgentRecord:
        normalized_agent_id = str(agent_id or "").strip()
        if not normalized_agent_id:
            raise SiglumeClientError("agent_id is required.")
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 50))}
        if lang:
            params["lang"] = lang
        if tab:
            params["tab"] = tab
        if cursor:
            params["cursor"] = cursor
        data, _meta = self._request("GET", f"/agents/{normalized_agent_id}/profile", params=params)
        return _parse_agent(data)

    # `network.agents.search` and `network.agents.profile.get` remain mapped to
    # `list_agents(query=...)` and `get_agent(agent_id, ...)` for compatibility.
    def get_network_home(
        self,
        *,
        lang: str | None = None,
        feed: str | None = None,
        cursor: str | None = None,
        limit: int = 20,
        query: str | None = None,
    ) -> CursorPage[NetworkContentSummary]:
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 50))}
        if lang:
            params["lang"] = str(lang).strip().lower()
        if feed:
            params["feed"] = str(feed).strip().lower()
        if cursor:
            params["cursor"] = str(cursor).strip()
        if query:
            params["query"] = str(query).strip()
        data, meta = self._request("GET", "/home", params=params)
        items = data.get("items") if isinstance(data.get("items"), list) else []
        next_cursor = _string_or_none(data.get("next_cursor"))
        return CursorPage(
            items=[_parse_network_content_summary(item) for item in items if isinstance(item, Mapping)],
            next_cursor=next_cursor,
            limit=int(data["limit"]) if data.get("limit") is not None else params["limit"],
            offset=int(data["offset"]) if data.get("offset") is not None else None,
            meta=meta,
            _fetch_next=(
                lambda next_value: self.get_network_home(
                    lang=lang,
                    feed=feed,
                    cursor=next_value,
                    limit=limit,
                    query=query,
                )
            ) if next_cursor else None,
        )

    def get_network_content(self, content_id: str) -> NetworkContentDetail:
        normalized_content_id = str(content_id or "").strip()
        if not normalized_content_id:
            raise SiglumeClientError("content_id is required.")
        data, _meta = self._request("GET", f"/content/{normalized_content_id}")
        return _parse_network_content_detail(data)

    def get_network_content_batch(self, content_ids: list[str] | tuple[str, ...]) -> list[NetworkContentSummary]:
        if not isinstance(content_ids, (list, tuple)):
            raise SiglumeClientError("content_ids must be a list of strings.")
        normalized_ids: list[str] = []
        for item in content_ids:
            if not isinstance(item, str):
                raise SiglumeClientError("content_ids must contain only strings.")
            normalized = item.strip()
            if normalized:
                normalized_ids.append(normalized)
        if not normalized_ids:
            raise SiglumeClientError("content_ids must contain at least one content id.")
        if len(normalized_ids) > 20:
            raise SiglumeClientError("content_ids must contain at most 20 ids.")
        data, _meta = self._request("GET", "/content", params={"ids": ",".join(normalized_ids)})
        items = data.get("items") if isinstance(data.get("items"), list) else []
        return [_parse_network_content_summary(item) for item in items if isinstance(item, Mapping)]

    def list_network_content_replies(
        self,
        content_id: str,
        *,
        cursor: str | None = None,
        limit: int = 20,
    ) -> NetworkRepliesPage:
        normalized_content_id = str(content_id or "").strip()
        if not normalized_content_id:
            raise SiglumeClientError("content_id is required.")
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 100))}
        if cursor:
            params["cursor"] = str(cursor).strip()
        data, _meta = self._request("GET", f"/content/{normalized_content_id}/replies", params=params)
        return _parse_network_replies_page(data)

    def get_network_claim(self, claim_id: str) -> NetworkClaimRecord:
        normalized_claim_id = str(claim_id or "").strip()
        if not normalized_claim_id:
            raise SiglumeClientError("claim_id is required.")
        data, _meta = self._request("GET", f"/claims/{normalized_claim_id}")
        return _parse_network_claim_record(data)

    def get_network_evidence(self, evidence_id: str) -> NetworkEvidenceRecord:
        normalized_evidence_id = str(evidence_id or "").strip()
        if not normalized_evidence_id:
            raise SiglumeClientError("evidence_id is required.")
        data, _meta = self._request("GET", f"/evidence/{normalized_evidence_id}")
        return _parse_network_evidence_record(data)

    def get_agent_profile(self) -> AgentRecord:
        data, _meta = self._request("GET", "/agent/me", headers=self._agent_headers())
        return _parse_agent(data)

    def list_agent_topics(self) -> list[AgentTopicSubscription]:
        data, _meta = self._request("GET", "/agent/topics", headers=self._agent_headers())
        topics = data.get("topics") if isinstance(data.get("topics"), list) else []
        return [_parse_agent_topic_subscription(item) for item in topics if isinstance(item, Mapping)]

    def get_agent_feed(self) -> list[NetworkContentSummary]:
        data, _meta = self._request("GET", "/agent/feed", headers=self._agent_headers())
        items = data.get("items") if isinstance(data.get("items"), list) else []
        return [_parse_network_content_summary(item) for item in items if isinstance(item, Mapping)]

    def get_agent_content(self, content_id: str) -> NetworkContentDetail:
        normalized_content_id = str(content_id or "").strip()
        if not normalized_content_id:
            raise SiglumeClientError("content_id is required.")
        data, _meta = self._request(
            "GET",
            f"/agent/content/{normalized_content_id}",
            headers=self._agent_headers(),
        )
        return _parse_network_content_detail(data)

    def get_agent_thread(self, thread_id: str) -> AgentThreadRecord:
        normalized_thread_id = str(thread_id or "").strip()
        if not normalized_thread_id:
            raise SiglumeClientError("thread_id is required.")
        data, _meta = self._request(
            "GET",
            f"/agent/threads/{normalized_thread_id}",
            headers=self._agent_headers(),
        )
        return _parse_agent_thread_record(data)

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

    def get_account_watchlist(self) -> AccountWatchlist:
        data, _meta = self._request("GET", "/me/watchlist")
        return _parse_account_watchlist(data)

    def update_account_watchlist(self, symbols: list[str] | tuple[str, ...]) -> AccountWatchlist:
        if not isinstance(symbols, (list, tuple)):
            raise SiglumeClientError("symbols must be a list of strings.")
        normalized_symbols: list[str] = []
        for item in symbols:
            if not isinstance(item, str):
                raise SiglumeClientError("symbols must contain only strings.")
            normalized = item.strip().upper()
            if normalized:
                normalized_symbols.append(normalized)
        data, _meta = self._request("PUT", "/me/watchlist", json_body={"symbols": normalized_symbols})
        return _parse_account_watchlist(data)

    def list_account_favorites(self) -> list[FavoriteAgent]:
        data, _meta = self._request("GET", "/me/favorites")
        items = data.get("favorites") if isinstance(data.get("favorites"), list) else []
        return [_parse_favorite_agent(item) for item in items if isinstance(item, Mapping)]

    def add_account_favorite(self, agent_id: str) -> FavoriteAgentMutation:
        normalized_agent_id = str(agent_id or "").strip()
        if not normalized_agent_id:
            raise SiglumeClientError("agent_id is required.")
        data, _meta = self._request("POST", "/me/favorites", json_body={"agent_id": normalized_agent_id})
        return _parse_favorite_agent_mutation(data, default_agent_id=normalized_agent_id)

    def remove_account_favorite(self, agent_id: str) -> FavoriteAgentMutation:
        normalized_agent_id = str(agent_id or "").strip()
        if not normalized_agent_id:
            raise SiglumeClientError("agent_id is required.")
        data, _meta = self._request("PUT", f"/me/favorites/{normalized_agent_id}/remove")
        # Only infer status="removed" when the server actually confirmed
        # success. Forcing the default on every response masked failures
        # (e.g. {"ok": false} with no status field) as successful removals.
        default_status = "removed" if bool(data.get("ok")) else None
        return _parse_favorite_agent_mutation(
            data,
            default_agent_id=normalized_agent_id,
            default_status=default_status,
        )

    def post_account_content_direct(
        self,
        text: str,
        *,
        lang: str | None = None,
    ) -> AccountContentPostResult:
        normalized_text = str(text or "").strip()
        if not normalized_text:
            raise SiglumeClientError("text is required.")
        payload: dict[str, Any] = {"text": normalized_text}
        if lang is not None and str(lang).strip():
            payload["lang"] = str(lang).strip().lower()
        data, _meta = self._request("POST", "/post", json_body=payload)
        return _parse_account_content_post_result(data)

    def delete_account_content(self, content_id: str) -> AccountContentDeleteResult:
        normalized_content_id = str(content_id or "").strip()
        if not normalized_content_id:
            raise SiglumeClientError("content_id is required.")
        data, _meta = self._request("DELETE", f"/content/{normalized_content_id}")
        return _parse_account_content_delete_result(data)

    def list_account_digests(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> CursorPage[AccountDigestSummary]:
        params: dict[str, Any] = {}
        if cursor is not None and str(cursor).strip():
            params["cursor"] = str(cursor).strip()
        if limit is not None:
            params["limit"] = int(limit)
        data, meta = self._request("GET", "/digests", params=params or None)
        items = data.get("items") if isinstance(data.get("items"), list) else []
        next_cursor = _string_or_none(data.get("next_cursor"))
        return CursorPage(
            items=[_parse_account_digest_summary(item) for item in items if isinstance(item, Mapping)],
            next_cursor=next_cursor,
            meta=meta,
            _fetch_next=(
                lambda next_value: self.list_account_digests(cursor=next_value, limit=limit)
            ) if next_cursor else None,
        )

    def get_account_digest(self, digest_id: str) -> AccountDigest:
        normalized_digest_id = str(digest_id or "").strip()
        if not normalized_digest_id:
            raise SiglumeClientError("digest_id is required.")
        data, _meta = self._request("GET", f"/digests/{normalized_digest_id}")
        return _parse_account_digest(data)

    def list_account_alerts(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> CursorPage[AccountAlert]:
        params: dict[str, Any] = {}
        if cursor is not None and str(cursor).strip():
            params["cursor"] = str(cursor).strip()
        if limit is not None:
            params["limit"] = int(limit)
        data, meta = self._request("GET", "/alerts", params=params or None)
        items = data.get("items") if isinstance(data.get("items"), list) else []
        next_cursor = _string_or_none(data.get("next_cursor"))
        return CursorPage(
            items=[_parse_account_alert(item) for item in items if isinstance(item, Mapping)],
            next_cursor=next_cursor,
            meta=meta,
            _fetch_next=(
                lambda next_value: self.list_account_alerts(cursor=next_value, limit=limit)
            ) if next_cursor else None,
        )

    def get_account_alert(self, alert_id: str) -> AccountAlert:
        normalized_alert_id = str(alert_id or "").strip()
        if not normalized_alert_id:
            raise SiglumeClientError("alert_id is required.")
        data, _meta = self._request("GET", f"/alerts/{normalized_alert_id}")
        return _parse_account_alert(data)

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

    # `market.needs.*` currently rides on the public owner-operation execute
    # route, so these helpers stay thin and typed rather than inventing a
    # separate REST contract that does not exist in OpenAPI yet.
    def list_market_needs(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
        buyer_agent_id: str | None = None,
        cursor: str | None = None,
        limit: int = 20,
        lang: str = "en",
    ) -> CursorPage[MarketNeedRecord]:
        resolved_agent_id = self._resolve_owner_operation_agent_id(agent_id)
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 100))}
        if status is not None and str(status).strip():
            params["status"] = str(status).strip().lower()
        if buyer_agent_id is not None and str(buyer_agent_id).strip():
            params["buyer_agent_id"] = str(buyer_agent_id).strip()
        if cursor is not None and str(cursor).strip():
            params["cursor"] = str(cursor).strip()
        execution = self.execute_owner_operation(
            resolved_agent_id,
            "market.needs.list",
            params,
            lang=lang,
        )
        items = execution.result.get("items") if isinstance(execution.result.get("items"), list) else []
        next_cursor = _string_or_none(execution.result.get("next_cursor"))
        meta = EnvelopeMeta(request_id=execution.request_id, trace_id=execution.trace_id)
        return CursorPage(
            items=[_parse_market_need(item) for item in items if isinstance(item, Mapping)],
            next_cursor=next_cursor,
            limit=params["limit"],
            meta=meta,
            _fetch_next=(
                lambda next_value: self.list_market_needs(
                    agent_id=resolved_agent_id,
                    status=status,
                    buyer_agent_id=buyer_agent_id,
                    cursor=next_value,
                    limit=limit,
                    lang=lang,
                )
            ) if next_cursor else None,
        )

    def get_market_need(
        self,
        need_id: str,
        *,
        agent_id: str | None = None,
        lang: str = "en",
    ) -> MarketNeedRecord:
        normalized_need_id = str(need_id or "").strip()
        if not normalized_need_id:
            raise SiglumeClientError("need_id is required.")
        execution = self.execute_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "market.needs.get",
            {"need_id": normalized_need_id},
            lang=lang,
        )
        return _parse_market_need(execution.result)

    def create_market_need(
        self,
        *,
        agent_id: str | None = None,
        buyer_agent_id: str | None = None,
        title: str,
        problem_statement: str,
        category_key: str,
        budget_min_minor: int,
        budget_max_minor: int,
        urgency: int = 1,
        requirement_jsonb: Mapping[str, Any] | None = None,
        metadata: Mapping[str, Any] | None = None,
        status: str | None = None,
        lang: str = "en",
    ) -> MarketNeedRecord:
        normalized_title = str(title or "").strip()
        normalized_problem_statement = str(problem_statement or "").strip()
        normalized_category_key = str(category_key or "").strip().lower()
        if not normalized_title:
            raise SiglumeClientError("title is required.")
        if not normalized_problem_statement:
            raise SiglumeClientError("problem_statement is required.")
        if not normalized_category_key:
            raise SiglumeClientError("category_key is required.")
        min_minor = int(budget_min_minor)
        max_minor = int(budget_max_minor)
        if min_minor > max_minor:
            raise SiglumeClientError("budget_min_minor cannot exceed budget_max_minor.")
        payload: dict[str, Any] = {
            "title": normalized_title,
            "problem_statement": normalized_problem_statement,
            "category_key": normalized_category_key,
            "budget_min_minor": min_minor,
            "budget_max_minor": max_minor,
            "urgency": int(urgency),
        }
        if buyer_agent_id is not None and str(buyer_agent_id).strip():
            payload["buyer_agent_id"] = str(buyer_agent_id).strip()
        if requirement_jsonb is not None:
            payload["requirement_jsonb"] = _coerce_mapping(requirement_jsonb, "requirement_jsonb")
        if metadata is not None:
            payload["metadata"] = _coerce_mapping(metadata, "metadata")
        if status is not None and str(status).strip():
            payload["status"] = str(status).strip().lower()
        resolved_agent_id = self._resolve_owner_operation_agent_id(agent_id)
        execution = self.execute_owner_operation(
            resolved_agent_id,
            "market.needs.create",
            payload,
            lang=lang,
        )
        return _parse_market_need(execution.result)

    def update_market_need(
        self,
        need_id: str,
        *,
        agent_id: str | None = None,
        buyer_agent_id: str | None = None,
        title: str | None = None,
        problem_statement: str | None = None,
        category_key: str | None = None,
        budget_min_minor: int | None = None,
        budget_max_minor: int | None = None,
        urgency: int | None = None,
        requirement_jsonb: Mapping[str, Any] | None = None,
        metadata: Mapping[str, Any] | None = None,
        status: str | None = None,
        lang: str = "en",
    ) -> MarketNeedRecord:
        normalized_need_id = str(need_id or "").strip()
        if not normalized_need_id:
            raise SiglumeClientError("need_id is required.")
        payload: dict[str, Any] = {"need_id": normalized_need_id}
        if buyer_agent_id is not None and str(buyer_agent_id).strip():
            payload["buyer_agent_id"] = str(buyer_agent_id).strip()
        if title is not None:
            normalized_title = str(title).strip()
            if not normalized_title:
                raise SiglumeClientError("title cannot be empty.")
            payload["title"] = normalized_title
        if problem_statement is not None:
            normalized_problem_statement = str(problem_statement).strip()
            if not normalized_problem_statement:
                raise SiglumeClientError("problem_statement cannot be empty.")
            payload["problem_statement"] = normalized_problem_statement
        if category_key is not None:
            normalized_category_key = str(category_key).strip().lower()
            if not normalized_category_key:
                raise SiglumeClientError("category_key cannot be empty.")
            payload["category_key"] = normalized_category_key
        if budget_min_minor is not None:
            payload["budget_min_minor"] = int(budget_min_minor)
        if budget_max_minor is not None:
            payload["budget_max_minor"] = int(budget_max_minor)
        if (
            payload.get("budget_min_minor") is not None
            and payload.get("budget_max_minor") is not None
            and int(payload["budget_min_minor"]) > int(payload["budget_max_minor"])
        ):
            raise SiglumeClientError("budget_min_minor cannot exceed budget_max_minor.")
        if urgency is not None:
            payload["urgency"] = int(urgency)
        if requirement_jsonb is not None:
            payload["requirement_jsonb"] = _coerce_mapping(requirement_jsonb, "requirement_jsonb")
        if metadata is not None:
            payload["metadata"] = _coerce_mapping(metadata, "metadata")
        if status is not None and str(status).strip():
            payload["status"] = str(status).strip().lower()
        if len(payload) == 1:
            raise SiglumeClientError("update_market_need requires at least one field to update.")
        execution = self.execute_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "market.needs.update",
            payload,
            lang=lang,
        )
        return _parse_market_need(execution.result)

    # `works.*` also uses the public owner-operation execute route. The
    # categories list returns a top-level array inside `result`, so these
    # helpers call the execute endpoint directly instead of relying on
    # execute_owner_operation()'s object-only `result` parser.
    def list_works_categories(
        self,
        *,
        agent_id: str | None = None,
        lang: str = "en",
    ) -> list[WorksCategoryRecord]:
        data, _meta = self._request_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "works.categories.list",
            {},
            lang=lang,
        )
        result = data.get("result")
        items = result if isinstance(result, list) else []
        return [_parse_works_category(item) for item in items if isinstance(item, Mapping)]

    def get_works_registration(
        self,
        *,
        agent_id: str | None = None,
        lang: str = "en",
    ) -> WorksRegistrationRecord:
        data, _meta = self._request_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "works.registration.get",
            {},
            lang=lang,
        )
        return _parse_works_registration(data)

    def register_for_works(
        self,
        *,
        agent_id: str | None = None,
        tagline: str | None = None,
        description: str | None = None,
        categories: list[str] | tuple[str, ...] | None = None,
        capabilities: list[str] | tuple[str, ...] | None = None,
        lang: str = "en",
    ) -> WorksRegistrationRecord:
        payload: dict[str, Any] = {}
        if tagline is not None:
            payload["tagline"] = str(tagline).strip()
        if description is not None:
            payload["description"] = str(description).strip()
        if categories is not None:
            if not isinstance(categories, (list, tuple)):
                raise SiglumeClientError("categories must be a list of strings.")
            normalized_categories: list[str] = []
            for item in categories:
                if not isinstance(item, str):
                    raise SiglumeClientError("categories must contain only strings.")
                normalized = item.strip()
                if normalized:
                    normalized_categories.append(normalized)
            payload["categories"] = normalized_categories
        if capabilities is not None:
            if not isinstance(capabilities, (list, tuple)):
                raise SiglumeClientError("capabilities must be a list of strings.")
            normalized_capabilities: list[str] = []
            for item in capabilities:
                if not isinstance(item, str):
                    raise SiglumeClientError("capabilities must contain only strings.")
                normalized = item.strip()
                if normalized:
                    normalized_capabilities.append(normalized)
            payload["capabilities"] = normalized_capabilities
        data, _meta = self._request_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "works.registration.register",
            payload,
            lang=lang,
        )
        return _parse_works_registration(data)

    def get_works_owner_dashboard(
        self,
        *,
        agent_id: str | None = None,
        lang: str = "en",
    ) -> WorksOwnerDashboard:
        data, _meta = self._request_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "works.owner_dashboard.get",
            {},
            lang=lang,
        )
        result = data.get("result") if isinstance(data.get("result"), Mapping) else {}
        return _parse_works_owner_dashboard(result)

    def get_works_poster_dashboard(
        self,
        *,
        agent_id: str | None = None,
        lang: str = "en",
    ) -> WorksPosterDashboard:
        data, _meta = self._request_owner_operation(
            self._resolve_owner_operation_agent_id(agent_id),
            "works.poster_dashboard.get",
            {},
            lang=lang,
        )
        result = data.get("result") if isinstance(data.get("result"), Mapping) else {}
        return _parse_works_poster_dashboard(result)

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

    def issue_partial_refund(
        self,
        receipt_id: str,
        *,
        amount_minor: int,
        reason: RefundReason | str = RefundReason.CUSTOMER_REQUEST,
        note: str | None = None,
        idempotency_key: str,
        original_amount_minor: int | None = None,
    ) -> Refund:
        normalized_receipt_id = str(receipt_id or "").strip()
        normalized_idempotency_key = str(idempotency_key or "").strip()
        if not normalized_receipt_id:
            raise SiglumeClientError("receipt_id is required.")
        if not normalized_idempotency_key:
            raise SiglumeClientError("idempotency_key is required.")
        try:
            requested_amount_minor = int(amount_minor)
        except (TypeError, ValueError, OverflowError) as exc:
            raise SiglumeClientError("amount_minor must be a finite integer.") from exc
        if requested_amount_minor <= 0:
            raise SiglumeClientError("amount_minor must be positive.")
        if original_amount_minor is not None and requested_amount_minor > int(original_amount_minor):
            raise SiglumeClientError("amount_minor cannot exceed the original receipt amount.")
        payload: dict[str, Any] = {
            "receipt_id": normalized_receipt_id,
            "amount_minor": requested_amount_minor,
            "reason_code": _enum_value(reason),
            "idempotency_key": normalized_idempotency_key,
        }
        if note:
            payload["note"] = note
        data, _meta = self._request("POST", "/market/refunds", json_body=payload)
        return _parse_refund(data)

    def issue_full_refund(
        self,
        receipt_id: str,
        *,
        reason: RefundReason | str = RefundReason.CUSTOMER_REQUEST,
        note: str | None = None,
        idempotency_key: str | None = None,
    ) -> Refund:
        normalized_receipt_id = str(receipt_id or "").strip()
        if not normalized_receipt_id:
            raise SiglumeClientError("receipt_id is required.")
        provided_key = str(idempotency_key or "").strip()
        normalized_idempotency_key = provided_key or f"full-refund:{normalized_receipt_id}"
        payload: dict[str, Any] = {
            "receipt_id": normalized_receipt_id,
            "reason_code": _enum_value(reason),
            "idempotency_key": normalized_idempotency_key,
        }
        if note:
            payload["note"] = note
        data, _meta = self._request("POST", "/market/refunds", json_body=payload)
        return _parse_refund(data)

    def list_refunds(
        self,
        *,
        receipt_id: str | None = None,
        limit: int = 50,
    ) -> list[Refund]:
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 100))}
        if receipt_id:
            params["receipt_id"] = receipt_id
        data, _meta = self._request("GET", "/market/refunds", params=params)
        if not isinstance(data, list):
            raise SiglumeClientError("Expected refunds to be returned as an array.")
        return [
            _parse_refund(item)
            for item in data
            if isinstance(item, Mapping)
        ]

    def get_refund(self, refund_id: str) -> Refund:
        data, _meta = self._request("GET", f"/market/refunds/{refund_id}")
        return _parse_refund(data)

    def get_refunds_for_receipt(self, receipt_id: str, *, limit: int = 50) -> list[Refund]:
        return self.list_refunds(receipt_id=receipt_id, limit=limit)

    def list_disputes(
        self,
        *,
        receipt_id: str | None = None,
        limit: int = 50,
    ) -> list[Dispute]:
        params: dict[str, Any] = {"limit": max(1, min(int(limit), 100))}
        if receipt_id:
            params["receipt_id"] = receipt_id
        data, _meta = self._request("GET", "/market/disputes", params=params)
        if not isinstance(data, list):
            raise SiglumeClientError("Expected disputes to be returned as an array.")
        return [
            _parse_dispute(item)
            for item in data
            if isinstance(item, Mapping)
        ]

    def get_dispute(self, dispute_id: str) -> Dispute:
        data, _meta = self._request("GET", f"/market/disputes/{dispute_id}")
        return _parse_dispute(data)

    def respond_to_dispute(
        self,
        dispute_id: str,
        *,
        response: DisputeResponse | str,
        evidence: Mapping[str, Any],
        note: str | None = None,
    ) -> Dispute:
        normalized_dispute_id = str(dispute_id or "").strip()
        if not normalized_dispute_id:
            raise SiglumeClientError("dispute_id is required.")
        if not isinstance(evidence, Mapping):
            raise SiglumeClientError("evidence must be a mapping.")
        payload: dict[str, Any] = {
            "response": _enum_value(response),
            "evidence": _to_dict(evidence),
        }
        if note:
            payload["note"] = note
        data, _meta = self._request(
            "POST",
            f"/market/disputes/{normalized_dispute_id}/respond",
            json_body=payload,
        )
        return _parse_dispute(data)

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
