"""Siglume API Store SDK — interface definitions for external developers.

This module defines the contracts that developers implement to publish
APIs on the Siglume API Store.

A listing is an HTTP API plus a machine-readable tool manual that
Siglume agents can subscribe to and invoke at runtime. Examples:
Amazon price comparison, travel booking, CRM sync.

Developers implement the AppAdapter protocol and register it with Siglume.
"""
from __future__ import annotations

import abc
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Mapping

# ISO 3166-1 alpha-2 country code, optionally with a sub-region suffix.
# Examples: "US", "US-CA", "JP", "GB", "DE", "SG".
_JURISDICTION_PATTERN = re.compile(r"^[A-Z]{2}(-[A-Z0-9]{1,3})?$")
MINIMUM_JPY_OPERATION_PRICE_MINOR = 15
_MINIMUM_JPY_OPERATION_PRICE_CURRENCIES = {"JPY", "JPYC"}
LISTING_SHORT_DESCRIPTION_MAX_LENGTH = 60
LISTING_JOB_TO_BE_DONE_MAX_LENGTH = 240
LISTING_DESCRIPTION_MAX_LENGTH = 1000
_MAX_SAVE_DATA_SCHEMA_BYTES = 8192


# ── Permission & Execution Models ──

class PermissionClass(str, Enum):
    """Permission tiers for AppManifest.

    Supported tiers: ``READ_ONLY`` / ``ACTION`` / ``PAYMENT``.
    ``RECOMMENDATION`` is a deprecated alias of ``READ_ONLY`` retained for
    backward compatibility; ``ToolManualPermissionClass`` has never accepted
    it and the platform normalizes it to ``read-only`` at registration.
    Do not use ``RECOMMENDATION`` in new manifests — it will be removed in a
    future major version.
    """
    READ_ONLY = "read-only"          # Search, retrieve, review, suggest
    ACTION = "action"                 # Cart, reserve, draft
    PAYMENT = "payment"              # Pay, purchase, settle
    RECOMMENDATION = "recommendation"  # Deprecated — behaves as READ_ONLY


class ApprovalMode(str, Enum):
    AUTO = "auto"
    BUDGET_BOUNDED = "budget-bounded"
    ALWAYS_ASK = "always-ask"
    DENY = "deny"


class ExecutionKind(str, Enum):
    DRY_RUN = "dry_run"
    QUOTE = "quote"
    ACTION = "action"
    PAYMENT = "payment"


class Environment(str, Enum):
    SANDBOX = "sandbox"
    LIVE = "live"


class PriceModel(str, Enum):
    """Pricing models for agent APIs.

    Live: free, subscription, per_request, usage_based, per_action.
    Planned: one_time, bundle.
    Platform fee: 6.6%. Developer keeps 93.4%.
    """
    FREE = "free"                    # No charge.
    SUBSCRIPTION = "subscription"    # Monthly recurring (USD).
    PER_REQUEST = "per_request"      # One direct payment requirement per invocation.
    ONE_TIME = "one_time"            # Planned: single purchase.
    BUNDLE = "bundle"                # Planned: bundled package.
    USAGE_BASED = "usage_based"      # Free upfront; execution declares billable usage.
    PER_ACTION = "per_action"        # Free upfront; successful actions declare charges.


class AppCategory(str, Enum):
    COMMERCE = "commerce"
    BOOKING = "booking"
    CRM = "crm"
    FINANCE = "finance"
    DOCUMENT = "document"
    COMMUNICATION = "communication"
    MONITORING = "monitoring"
    OTHER = "other"


class StoreVertical(str, Enum):
    API = "api"
    GAME = "game"


class PersistenceMode(str, Enum):
    NONE = "none"
    LOCAL = "local"
    PLATFORM = "platform"
    DEVELOPER_SERVER = "developer_server"


# ── Data Transfer Objects ──

class ListingCurrency(str, Enum):
    USD = "USD"
    JPY = "JPY"


@dataclass
class PersistencePolicy:
    mode: PersistenceMode | str = PersistenceMode.NONE
    schema_version: str = "1"
    scope: str = "user_capability"
    restore_required: bool = False
    max_bytes: int | None = None
    endpoint: str | None = None
    description: str = ""
    save_data_schema: dict[str, Any] | None = None


def _normalize_persistence_mapping(value: PersistencePolicy | Mapping[str, Any] | None) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, PersistencePolicy):
        mode = value.mode.value if isinstance(value.mode, PersistenceMode) else str(value.mode)
        result: dict[str, Any] = {
            "mode": mode,
            "schema_version": value.schema_version,
            "scope": value.scope,
            "restore_required": bool(value.restore_required),
        }
        if value.max_bytes is not None:
            result["max_bytes"] = value.max_bytes
        if value.endpoint is not None:
            result["endpoint"] = value.endpoint
        if value.description:
            result["description"] = value.description
        if value.save_data_schema is not None:
            result["save_data_schema"] = value.save_data_schema
        return result
    if isinstance(value, Mapping):
        return dict(value)
    raise ValueError("AppManifest.persistence must be a PersistencePolicy or mapping.")


def _persistence_mode_to_string(value: Any) -> str:
    raw = value.value if isinstance(value, PersistenceMode) else value
    return str(raw or "").strip().lower()


def _validate_save_data_schema(schema: Any, *, field_name: str) -> None:
    if not isinstance(schema, Mapping):
        raise ValueError(f"{field_name} must be a JSON Schema object.")
    try:
        schema_size = len(json.dumps(dict(schema), ensure_ascii=False, sort_keys=True).encode("utf-8"))
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be JSON-serializable.") from None
    if schema_size > _MAX_SAVE_DATA_SCHEMA_BYTES:
        raise ValueError(f"{field_name} must be at most {_MAX_SAVE_DATA_SCHEMA_BYTES} bytes.")
    schema_type = schema.get("type")
    if schema_type != "object":
        raise ValueError(f"{field_name}.type must be 'object'.")
    properties = schema.get("properties")
    if not isinstance(properties, Mapping) or not properties:
        raise ValueError(f"{field_name}.properties must be a non-empty object.")
    required = schema.get("required")
    if required is not None:
        if not isinstance(required, list) or not all(isinstance(item, str) for item in required):
            raise ValueError(f"{field_name}.required must be an array of strings when provided.")
        missing = [item for item in required if item not in properties]
        if missing:
            raise ValueError(
                f"{field_name}.required references undefined properties: {', '.join(missing)}."
            )


def _validate_pricing_plan_floor(plan: Any, *, default_currency: str) -> None:
    """Validate operation-level prices before the platform rejects the manifest."""
    if plan is None:
        return
    if not isinstance(plan, Mapping):
        raise ValueError("AppManifest.pricing_plan must be a dict/object when provided.")
    raw_items = plan.get("items")
    if raw_items is None:
        return
    if not isinstance(raw_items, list):
        raise ValueError("AppManifest.pricing_plan.items must be a list when provided.")
    plan_currency = str(plan.get("currency") or default_currency or "").strip().upper()
    seen_keys: set[str] = set()
    for index, item in enumerate(raw_items):
        if not isinstance(item, Mapping):
            raise ValueError(f"AppManifest.pricing_plan.items[{index}] must be a dict/object.")
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
            raise ValueError(f"AppManifest.pricing_plan.items[{index}].key is required.")
        if item_key in seen_keys:
            raise ValueError(f"AppManifest.pricing_plan.items[{index}].key duplicates {item_key!r}.")
        seen_keys.add(item_key)
        amount_raw = None
        for key in ("price_minor", "amount_minor", "cost_minor", "value_minor"):
            if key in item and item.get(key) is not None:
                amount_raw = item.get(key)
                break
        if amount_raw is None:
            raise ValueError(f"AppManifest.pricing_plan.items[{index}].price_minor is required.")
        try:
            amount_minor = int(amount_raw)
        except (TypeError, ValueError):
            raise ValueError(
                f"AppManifest.pricing_plan.items[{index}].price_minor must be an integer."
            ) from None
        if amount_minor < 0:
            raise ValueError(
                f"AppManifest.pricing_plan.items[{index}].price_minor must be zero or positive."
            )
        currency = str(item.get("currency") or plan_currency or default_currency or "").strip().upper()
        if (
            currency in _MINIMUM_JPY_OPERATION_PRICE_CURRENCIES
            and 0 < amount_minor < MINIMUM_JPY_OPERATION_PRICE_MINOR
        ):
            raise ValueError(
                f"AppManifest.pricing_plan.items[{index}].price_minor must be 0 or at least "
                f"{MINIMUM_JPY_OPERATION_PRICE_MINOR} for JPY/JPYC operation billing."
            )


def _pricing_plan_has_items(plan: Any) -> bool:
    return isinstance(plan, Mapping) and isinstance(plan.get("items"), list) and bool(plan.get("items"))


@dataclass
class AppManifest:
    """Declares what the app does and what it needs.

    Jurisdiction (REQUIRED):
        `jurisdiction` is an ISO 3166-1 alpha-2 country code (optionally with
        a sub-region, e.g. "US", "US-CA", "JP") declaring the governing law
        this API is designed to comply with. Consumer-protection, tax,
        payment, and data-residency regulations differ by country — the
        platform surfaces this to agent owners so they can make an informed
        subscription decision. Default market is "US".
    """
    capability_key: str                    # unique identifier e.g. "amazon-purchase-assistant"
    version: str = "0.1.0"
    name: str = ""                         # display name
    job_to_be_done: str = ""               # buyer-facing task summary, max 240 chars
    category: AppCategory = AppCategory.OTHER  # e.g. "commerce", "booking", "crm"
    permission_class: PermissionClass = PermissionClass.READ_ONLY
    approval_mode: ApprovalMode = ApprovalMode.AUTO
    dry_run_supported: bool = False
    required_connected_accounts: list[Any] = field(default_factory=list)  # e.g. {"provider_key": "slack", "managed_by": "api", "connect_url": "https://api.example.com/oauth/start"}
    permission_scopes: list[str] = field(default_factory=list)
    price_model: PriceModel = PriceModel.FREE
    price_value_minor: int = 0             # minor units for `currency` (USD cents, JPY yen)
    pricing_plan: dict[str, Any] | None = None  # optional buyer-facing operation price table
    billing_timing: str = "post"           # "post" (execute then settle) or "prepay" (quote then pay before action)
    currency: ListingCurrency | str | None = None  # REQUIRED: "USD" -> USDC, "JPY" -> JPYC
    allow_free_trial: bool | None = None   # REQUIRED: True/False must be an explicit publisher choice
    free_trial_duration_days: int = 30     # 1-90 when allow_free_trial=True
    # REQUIRED. No default — every AppManifest must explicitly declare the
    # country whose law governs the offering. Ambiguous / missing values are
    # rejected at construction time and at platform registration.
    jurisdiction: str = ""                 # must be explicitly set; ISO 3166-1 alpha-2 (e.g. "US", "JP", "US-CA")
    applicable_regulations: list[str] = field(default_factory=list)  # e.g. ["GDPR", "CCPA", "資金決済法"]
    data_residency: str | None = None      # ISO code; defaults to jurisdiction if None
    # NOTE: The SDK intentionally does NOT model served_markets / excluded_markets.
    # Whether this API is valid for a buyer's country/use-case (e.g. seismic
    # calculation under JP vs US building codes) is the buyer's judgment,
    # not something the platform enforces. The platform surfaces `jurisdiction`
    # as a flag icon so buyers can make informed decisions.
    short_description: str = ""            # catalog tagline, max 60 chars
    description: str = ""                  # optional long buyer-facing detail, max 1000 chars
    docs_url: str = ""                     # public API usage guide; not a seller homepage
    support_contact: str = ""              # real support email address or public support URL
    seller_homepage_url: str = ""          # optional official seller homepage, separate from docs_url
    seller_social_url: str = ""            # optional official seller social/profile URL
    store_vertical: StoreVertical | None = None  # REQUIRED: "api" for normal API Store, "game" for API games
    compatibility_tags: list[str] = field(default_factory=list)
    latency_tier: str = "normal"           # fast, normal, slow
    example_prompts: list[str] = field(default_factory=list)
    persistence: PersistencePolicy | dict[str, Any] | None = None

    def __post_init__(self) -> None:
        if self.currency is None or str(self.currency).strip() == "":
            raise ValueError(
                "AppManifest.currency is REQUIRED. Choose 'USD' for USDC "
                "settlement or 'JPY' for JPYC settlement."
            )
        currency = self.currency.value if isinstance(self.currency, ListingCurrency) else str(self.currency).strip().upper()
        if currency not in {ListingCurrency.USD.value, ListingCurrency.JPY.value}:
            raise ValueError(
                "AppManifest.currency must be 'USD' or 'JPY'. "
                f"Got: {self.currency!r}"
            )
        self.currency = ListingCurrency(currency)
        _validate_pricing_plan_floor(self.pricing_plan, default_currency=currency)
        billing_timing = str(self.billing_timing or "post").strip().lower()
        if billing_timing not in {"post", "prepay"}:
            raise ValueError("AppManifest.billing_timing must be 'post' or 'prepay'.")
        self.billing_timing = billing_timing
        price_model_value = self.price_model.value if isinstance(self.price_model, PriceModel) else str(self.price_model or "")
        if price_model_value in {PriceModel.USAGE_BASED.value, PriceModel.PER_ACTION.value} and not _pricing_plan_has_items(
            self.pricing_plan
        ):
            raise ValueError("AppManifest.pricing_plan.items is required for usage_based/per_action pricing.")
        for field_name, max_length in (
            ("short_description", LISTING_SHORT_DESCRIPTION_MAX_LENGTH),
            ("job_to_be_done", LISTING_JOB_TO_BE_DONE_MAX_LENGTH),
            ("description", LISTING_DESCRIPTION_MAX_LENGTH),
        ):
            value = getattr(self, field_name)
            if value and len(value) > max_length:
                raise ValueError(f"AppManifest.{field_name} must be at most {max_length} characters.")

        if self.allow_free_trial is None:
            raise ValueError(
                "AppManifest.allow_free_trial is REQUIRED. Pass True to let Plus/Pro buyers "
                "start a free trial of your paid API (counts against their monthly quota, "
                "Plus 3 / Pro 10, lifetime once per buyer per listing). Pass False to disable. "
                "Publishers can flip this later in the Developer Portal - no default is "
                "applied because monetization strategy is a conscious choice."
            )
        if self.allow_free_trial:
            if not isinstance(self.free_trial_duration_days, int) or isinstance(self.free_trial_duration_days, bool):
                raise ValueError(
                    "AppManifest.free_trial_duration_days must be an int when allow_free_trial=True"
                )
            if not (1 <= self.free_trial_duration_days <= 90):
                raise ValueError(
                    "AppManifest.free_trial_duration_days must be between 1 and 90 when "
                    f"allow_free_trial=True, got: {self.free_trial_duration_days}"
                )

        if self.store_vertical is None or str(self.store_vertical).strip() == "":
            raise ValueError(
                "AppManifest.store_vertical is REQUIRED. Choose 'api' for "
                "normal API Store listings or 'game' for API games."
            )
        vertical = self.store_vertical.value if isinstance(self.store_vertical, StoreVertical) else str(self.store_vertical).strip().lower()
        if vertical not in {StoreVertical.API.value, StoreVertical.GAME.value}:
            raise ValueError(
                "AppManifest.store_vertical must be 'api' or 'game'. "
                f"Got: {self.store_vertical!r}"
            )
        self.store_vertical = StoreVertical(vertical)
        self._validate_persistence_contract()

        if not self.jurisdiction:
            raise ValueError(
                "AppManifest.jurisdiction is REQUIRED. Every API listed on "
                "the API Store must explicitly declare its country of "
                "origin (the country whose law governs the offering) as an "
                "ISO 3166-1 alpha-2 code, e.g. 'US', 'JP', 'GB', 'DE', 'SG'. "
                "No default is applied — you must make an informed choice."
            )
        if not _JURISDICTION_PATTERN.match(self.jurisdiction):
            raise ValueError(
                f"AppManifest.jurisdiction must be ISO 3166-1 alpha-2 "
                f"(optionally -subregion), got: {self.jurisdiction!r}"
            )
        if self.data_residency is None:
            # Default: data lives in the same jurisdiction that governs the
            # offering. Matches the documented contract on the field. Without
            # this assignment, consumers that serialise the manifest see
            # `data_residency=None` and have to compute the default themselves,
            # which caused a subtle drift between the docstring and the object.
            self.data_residency = self.jurisdiction
        elif not _JURISDICTION_PATTERN.match(self.data_residency):
            raise ValueError(
                f"AppManifest.data_residency must be ISO 3166-1 alpha-2 "
                f"(optionally -subregion), got: {self.data_residency!r}"
            )

    def _validate_persistence_contract(self) -> None:
        policy = _normalize_persistence_mapping(self.persistence)
        if not policy:
            return
        mode = _persistence_mode_to_string(policy.get("mode"))
        if not mode:
            mode = "platform" if self.store_vertical == StoreVertical.GAME else "none"
            policy["mode"] = mode
        if mode not in {item.value for item in PersistenceMode}:
            raise ValueError(
                "AppManifest.persistence.mode must be one of: none, local, "
                "platform, developer_server."
            )
        schema = policy.get("save_data_schema")
        if self.store_vertical == StoreVertical.GAME and mode != PersistenceMode.NONE.value:
            if schema is None:
                raise ValueError(
                    "AppManifest.persistence.save_data_schema is REQUIRED when "
                    "store_vertical='game' and persistence.mode is not 'none'. "
                    "Declare the JSON Schema for the game's save data."
                )
        if schema is not None:
            _validate_save_data_schema(schema, field_name="AppManifest.persistence.save_data_schema")
        if policy is not self.persistence:
            self.persistence = policy


@dataclass
class ExecutionContext:
    """Provided by Siglume runtime when invoking the app."""
    agent_id: str
    owner_user_id: str
    task_type: str
    input_params: dict[str, Any] = field(default_factory=dict)  # The actual query/request from the agent (e.g., "find flights to Tokyo")
    source_type: str | None = None
    environment: Environment = Environment.LIVE
    execution_kind: ExecutionKind = ExecutionKind.DRY_RUN
    budget_remaining_minor: int | None = None
    trace_id: str | None = None
    idempotency_key: str | None = None
    request_hash: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


# ── Execution Contract Types ──
# Structured types for describing what happened during execution.
# These replace (or complement) the free-form receipt_summary dict
# so that receipts are machine-readable and can link to artifacts,
# audit trails, and rollback review.

@dataclass
class ExecutionArtifact:
    """Describes a discrete output produced by the execution.

    Examples: a generated image, a posted tweet, a created calendar event.
    Multiple artifacts can be returned from a single execution.
    """
    artifact_type: str                      # e.g. "image", "social_post", "calendar_event"
    external_id: str | None = None          # provider-side ID (tweet ID, event ID, etc.)
    external_url: str | None = None         # link to the artifact on the provider
    title: str | None = None                # human-readable label
    summary: str | None = None              # brief description of what was produced
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"artifact_type": self.artifact_type}
        if self.external_id is not None:
            d["external_id"] = self.external_id
        if self.external_url is not None:
            d["external_url"] = self.external_url
        if self.title is not None:
            d["title"] = self.title
        if self.summary is not None:
            d["summary"] = self.summary
        if self.metadata:
            d["metadata"] = self.metadata
        return d


@dataclass
class SideEffectRecord:
    """Describes an external side effect that occurred during execution.

    Side effects are actions that changed state outside the Siglume platform:
    a tweet was posted, an email was sent, a payment was charged, etc.
    This is critical for audit and rollback decisions.
    """
    action: str                             # e.g. "tweet_created", "email_sent", "payment_charged"
    provider: str                           # e.g. "x-twitter", "stripe", "google-calendar"
    external_id: str | None = None          # provider-side reference
    reversible: bool = False                # can this be undone?
    reversal_hint: str | None = None        # how to undo (e.g. "DELETE /tweets/{id}")
    timestamp_iso: str | None = None        # when the side effect occurred
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "action": self.action,
            "provider": self.provider,
            "reversible": self.reversible,
        }
        if self.external_id is not None:
            d["external_id"] = self.external_id
        if self.reversal_hint is not None:
            d["reversal_hint"] = self.reversal_hint
        if self.timestamp_iso is not None:
            d["timestamp_iso"] = self.timestamp_iso
        if self.metadata:
            d["metadata"] = self.metadata
        return d


@dataclass
class ReceiptRef:
    """Opaque reference to a CapabilityExecutionReceipt on the platform.

    Returned by the runtime after execution completes — not set by the app
    developer. Use this to link platform-side artifacts to execution receipts
    via ``execution_receipt_id``.

    Note: the link is a string reference (not a foreign key constraint),
    so orphaned references are possible if the receipt is deleted.
    """
    receipt_id: str                         # UUID of the CapabilityExecutionReceipt
    trace_id: str | None = None             # distributed trace ID for debugging
    intent_id: str | None = None            # the originating execution intent

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"receipt_id": self.receipt_id}
        if self.trace_id is not None:
            d["trace_id"] = self.trace_id
        if self.intent_id is not None:
            d["intent_id"] = self.intent_id
        return d


@dataclass
class ApprovalRequestHint:
    """Structured hint for the owner approval prompt.

    When ``needs_approval=True``, the runtime shows an approval dialog to
    the agent owner. This type provides structured context instead of
    relying solely on a free-text ``approval_prompt`` string.
    """
    action_summary: str                     # what will happen (e.g. "Post tweet to @handle")
    permission_class: str = "action"        # "action" or "payment" only
    estimated_amount_minor: int | None = None  # estimated cost in minor units
    currency: str | None = None             # ISO currency code
    side_effects: list[str] = field(default_factory=list)  # plain-text list of side effects
    preview: dict[str, Any] = field(default_factory=dict)  # structured preview payload
    reversible: bool = False                # can the action be undone?

    _VALID_PERMISSION_CLASSES = frozenset({"action", "payment"})

    def to_dict(self) -> dict[str, Any]:
        if self.permission_class not in self._VALID_PERMISSION_CLASSES:
            raise ValueError(
                f"ApprovalRequestHint.permission_class must be 'action' or 'payment', "
                f"got '{self.permission_class}'"
            )
        d: dict[str, Any] = {
            "action_summary": self.action_summary,
            "permission_class": self.permission_class,
            "reversible": self.reversible,
        }
        if self.estimated_amount_minor is not None:
            d["estimated_amount_minor"] = self.estimated_amount_minor
        if self.currency is not None:
            d["currency"] = self.currency
        if self.side_effects:
            d["side_effects"] = self.side_effects
        if self.preview:
            d["preview"] = self.preview
        return d


@dataclass
class ExecutionResult:
    """Returned by the app after execution."""
    success: bool
    output: dict[str, Any] = field(default_factory=dict)  # app-specific result data
    execution_kind: ExecutionKind = ExecutionKind.DRY_RUN
    units_consumed: int = 1
    amount_minor: int = 0                  # cost in minor units if applicable
    currency: str = "USD"
    provider_status: str = "ok"            # ok, error, timeout, rate_limited
    error_message: str | None = None
    fallback_applied: bool = False
    needs_approval: bool = False           # true if action needs owner approval
    approval_prompt: str | None = None     # human-readable approval request (legacy)
    receipt_summary: dict[str, Any] = field(default_factory=dict)  # free-form (legacy)

    # ── P1: structured execution contract ──
    artifacts: list[ExecutionArtifact] = field(default_factory=list)
    side_effects: list[SideEffectRecord] = field(default_factory=list)
    receipt_ref: ReceiptRef | None = None   # set by runtime, not by app developer
    approval_hint: ApprovalRequestHint | None = None  # structured approval context


# ── Tool Manual Types ──
# A ToolManual is the machine-readable contract that tells an LLM when and
# how to invoke an agent API.  The Siglume runtime validates these on
# release publish; the SDK mirrors the canonical types so developers get
# feedback locally before submission.

class ToolManualPermissionClass(str, Enum):
    """Permission classes valid inside a tool manual.

    NOTE: The wire values use underscores (read_only), which differs from
    AppManifest.permission_class that uses hyphens (read-only).
    ToolManual omits the "recommendation" tier.
    """
    READ_ONLY = "read_only"
    ACTION = "action"
    PAYMENT = "payment"


class SettlementMode(str, Enum):
    STRIPE_CHECKOUT = "stripe_checkout"
    STRIPE_PAYMENT_INTENT = "stripe_payment_intent"
    POLYGON_MANDATE = "polygon_mandate"
    EMBEDDED_WALLET_CHARGE = "embedded_wallet_charge"


@dataclass
class ToolManual:
    """Machine-readable contract describing when/how an LLM should use an API.

    Stored as JSON in CapabilityRelease.tool_manual_jsonb on the platform.
    Developers build this locally and submit it during release publish or
    via the confirm-auto-register endpoint.
    """
    # ── Required (all permission classes) ──
    tool_name: str                                      # 3-64 chars, [A-Za-z0-9_]
    job_to_be_done: str                                 # 10-240 chars
    summary_for_model: str                              # 10-300 chars, factual
    trigger_conditions: list[str]                       # 3-8 items, 10-200 chars each
    do_not_use_when: list[str]                          # 1-5 items
    permission_class: ToolManualPermissionClass = ToolManualPermissionClass.READ_ONLY
    dry_run_supported: bool = False
    requires_connected_accounts: list[Any] = field(default_factory=list)
    input_schema: dict[str, Any] = field(default_factory=dict)   # JSON Schema (type=object)
    output_schema: dict[str, Any] = field(default_factory=dict)  # must include "summary"
    usage_hints: list[str] = field(default_factory=list)
    result_hints: list[str] = field(default_factory=list)
    error_hints: list[str] = field(default_factory=list)

    # ── Required for action / payment ──
    approval_summary_template: str | None = None
    preview_schema: dict[str, Any] | None = None        # JSON Schema
    idempotency_support: bool | None = None              # must be True for action/payment
    side_effect_summary: str | None = None

    # ── Required for payment only ──
    quote_schema: dict[str, Any] | None = None           # JSON Schema
    currency: str | None = None                          # must be "USD"
    settlement_mode: SettlementMode | None = None
    refund_or_cancellation_note: str | None = None

    # ── Required for action / payment ──
    # Governing law declaration for this tool's execution. Must not contradict
    # AppManifest.jurisdiction. ISO 3166-1 alpha-2 (optionally -subregion).
    jurisdiction: str | None = None
    legal_notes: str | None = None                       # optional, surfaced on approval prompt

    # Declared LAST so the dataclass __init__ positional order of every
    # pre-existing field is preserved — a patch release must not shift positional
    # args (an action/payment caller passing approval_summary_template
    # positionally must not land in `supports`). Optional structured capability
    # flags an agent reads to judge fit BEFORE binding, e.g.
    # {"reply_thread": False, "scheduled_one_time": True, "images_max": 4}.
    # Surfaced verbatim on the discovery surface (market_get_capability). Keep
    # values flat (bool/int/str); express anything richer in usage_hints /
    # do_not_use_when prose.
    supports: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to the dict format expected by the platform API."""
        d: dict[str, Any] = {
            "tool_name": self.tool_name,
            "job_to_be_done": self.job_to_be_done,
            "summary_for_model": self.summary_for_model,
            "trigger_conditions": self.trigger_conditions,
            "do_not_use_when": self.do_not_use_when,
            "permission_class": self.permission_class.value,
            "dry_run_supported": self.dry_run_supported,
            "requires_connected_accounts": self.requires_connected_accounts,
            "input_schema": self.input_schema,
            "output_schema": self.output_schema,
            "usage_hints": self.usage_hints,
            "result_hints": self.result_hints,
            "error_hints": self.error_hints,
            "supports": self.supports,
        }
        if self.permission_class in (
            ToolManualPermissionClass.ACTION,
            ToolManualPermissionClass.PAYMENT,
        ):
            d["approval_summary_template"] = self.approval_summary_template or ""
            d["preview_schema"] = self.preview_schema or {}
            d["idempotency_support"] = bool(self.idempotency_support)
            d["side_effect_summary"] = self.side_effect_summary or ""
            # jurisdiction is required for action/payment
            if not self.jurisdiction:
                raise ValueError(
                    "ToolManual.jurisdiction is required for permission_class "
                    "'action' or 'payment'. Declare the ISO 3166-1 alpha-2 "
                    "country code whose law governs this tool (e.g. 'US', 'JP')."
                )
            if not _JURISDICTION_PATTERN.match(self.jurisdiction):
                raise ValueError(
                    f"ToolManual.jurisdiction must be ISO 3166-1 alpha-2 "
                    f"(optionally -subregion), got: {self.jurisdiction!r}"
                )
            d["jurisdiction"] = self.jurisdiction
            if self.legal_notes:
                d["legal_notes"] = self.legal_notes
        if self.permission_class == ToolManualPermissionClass.PAYMENT:
            d["quote_schema"] = self.quote_schema or {}
            d["currency"] = self.currency or "USD"
            d["settlement_mode"] = (
                self.settlement_mode.value if self.settlement_mode else ""
            )
            d["refund_or_cancellation_note"] = (
                self.refund_or_cancellation_note or ""
            )
        return d


@dataclass
class ToolManualIssue:
    """A single issue found during tool-manual validation or quality scoring."""
    code: str                       # e.g. "MISSING_FIELD", "trigger_specificity"
    message: str                    # human-readable description
    field: str | None = None        # e.g. "trigger_conditions[2]"
    severity: str = "error"         # "error" | "warning" | "critical" | "suggestion"
    suggestion: str | None = None   # actionable fix hint (quality scoring only)


@dataclass
class ToolManualQualityReport:
    """Result of quality scoring a tool manual (content quality, not just structure)."""
    overall_score: int              # 0-100
    grade: str                      # A / B / C / D / F
    issues: list[ToolManualIssue] = field(default_factory=list)
    keyword_coverage_estimate: int = 0
    improvement_suggestions: list[str] = field(default_factory=list)
    publishable: bool | None = None
    validation_ok: bool = True
    validation_errors: list[ToolManualIssue] = field(default_factory=list)
    validation_warnings: list[ToolManualIssue] = field(default_factory=list)


# ── Tool Manual Validation (server-mirror) ──
# Client-side mirror of the authoritative server validator at
# agent_sns.application.capability_runtime.tool_manual_validator.
# Catches common structural mistakes before a network round-trip.
# The server is always authoritative — keep rule sets in sync.

_TOOL_NAME_RE = re.compile(r'^[A-Za-z0-9_]{3,64}$')

_PLATFORM_INJECTED_FIELDS = frozenset({
    "execution_id", "trace_id", "connected_account_id",
    "dry_run", "idempotency_key", "budget_snapshot",
})

_COMPOSITION_KEYWORDS = frozenset({"oneOf", "anyOf", "allOf"})

# Forbidden keys that must not appear at any nesting depth in input_schema.
# Mirrors server `_check_forbidden_key` sweep; patternProperties is the
# headline case because loose property globs defeat schema validation.
_INPUT_SCHEMA_FORBIDDEN_KEYS = frozenset({"patternProperties"})


def _check_schema_forbidden_recursive(
    schema: Any,
    root_field: str,
    err_fn,
    *,
    path: str = "",
) -> None:
    """Recurse into a JSON Schema rejecting forbidden keys
    (patternProperties) at any nesting level while validating composition
    branch structure.

    Server parity: matches `_check_composition_keywords` and
    `_check_forbidden_key` in
    `agent_sns.application.capability_runtime.tool_manual_validator`.
    """
    if not isinstance(schema, dict):
        return

    for kw in _COMPOSITION_KEYWORDS:
        if kw not in schema:
            continue
        branches = schema.get(kw)
        if not isinstance(branches, list) or not branches:
            loc = f"{root_field}.{path}.{kw}" if path else f"{root_field}.{kw}"
            err_fn("INPUT_SCHEMA", f"{kw} must be a non-empty array", loc)
            continue
        for index, branch in enumerate(branches):
            branch_path = f"{path}.{kw}[{index}]" if path else f"{kw}[{index}]"
            loc = f"{root_field}.{branch_path}"
            if not isinstance(branch, dict):
                err_fn("INPUT_SCHEMA", f"{kw}[{index}] must be an object", loc)
                continue
            _check_schema_forbidden_recursive(branch, root_field, err_fn, path=branch_path)

    for forbidden in _INPUT_SCHEMA_FORBIDDEN_KEYS:
        if forbidden in schema:
            loc = f"{root_field}.{path}.{forbidden}" if path else f"{root_field}.{forbidden}"
            err_fn("INPUT_SCHEMA",
                   f"'{forbidden}' is not allowed{' at ' + path if path else ''}",
                   loc)

    for key, val in schema.items():
        if key == "properties" and isinstance(val, dict):
            for pname, pdef in val.items():
                sub_path = f"{path}.{pname}" if path else pname
                _check_schema_forbidden_recursive(pdef, root_field, err_fn, path=sub_path)
        elif key == "items" and isinstance(val, dict):
            sub_path = f"{path}.items" if path else "items"
            _check_schema_forbidden_recursive(val, root_field, err_fn, path=sub_path)


def validate_tool_manual(
    manual: dict[str, Any] | ToolManual,
) -> tuple[bool, list[ToolManualIssue]]:
    """Validate a tool manual locally (client-side).

    Returns ``(ok, issues)`` where *ok* is True when no errors were found.

    **Server mirror** — this function mirrors the validation rules in the
    Siglume runtime (``tool_manual_validator.validate_tool_manual``).  The
    server is always authoritative; this SDK copy catches the most common
    structural mistakes before a network round-trip.

    **Keeping in sync** — if the server validator adds or changes rules,
    this function must be updated to match.  A CI job that compares the
    rule sets (field names, regex, length bounds) is recommended to prevent
    silent drift.  See ``schemas/tool-manual.schema.json`` for the
    machine-readable contract.
    """
    if isinstance(manual, ToolManual):
        manual = manual.to_dict()

    issues: list[ToolManualIssue] = []

    def _err(code: str, msg: str, fld: str | None = None) -> None:
        issues.append(ToolManualIssue(code=code, message=msg, field=fld, severity="error"))

    def _warn(code: str, msg: str, fld: str | None = None) -> None:
        issues.append(ToolManualIssue(code=code, message=msg, field=fld, severity="warning"))

    if not isinstance(manual, dict):
        _err("INVALID_ROOT", "tool manual must be a dict")
        return False, issues

    # ── required fields ──
    required = [
        "tool_name", "job_to_be_done", "summary_for_model",
        "trigger_conditions", "do_not_use_when", "permission_class",
        "dry_run_supported", "requires_connected_accounts",
        "input_schema", "output_schema",
        "usage_hints", "result_hints", "error_hints",
    ]
    for f in required:
        if f not in manual:
            _err("MISSING_FIELD", f"required field '{f}' is missing", f)

    # ── tool_name ──
    tn = manual.get("tool_name", "")
    if isinstance(tn, str) and tn:
        if not _TOOL_NAME_RE.match(tn):
            _err("INVALID_TOOL_NAME",
                 "tool_name must be alphanumeric + underscore, 3-64 chars", "tool_name")

    # ── string length checks ──
    for fld, mn, mx in [
        ("job_to_be_done", 10, 240),
        ("summary_for_model", 10, 300),
    ]:
        v = manual.get(fld)
        if isinstance(v, str) and (len(v) < mn or len(v) > mx):
            _err("INVALID_TYPE", f"{fld} must be {mn}-{mx} characters", fld)

    # ── list checks ──
    tc = manual.get("trigger_conditions")
    if isinstance(tc, list):
        if len(tc) < 3:
            _err("TOO_FEW_ITEMS", "trigger_conditions needs at least 3 items",
                 "trigger_conditions")
        elif len(tc) > 8:
            _err("TOO_MANY_ITEMS", "trigger_conditions allows at most 8 items",
                 "trigger_conditions")
        for i, item in enumerate(tc):
            if isinstance(item, str) and (len(item) < 10 or len(item) > 200):
                _err("ITEM_TOO_SHORT" if len(item) < 10 else "ITEM_TOO_LONG",
                     f"trigger_conditions[{i}] must be 10-200 chars",
                     f"trigger_conditions[{i}]")

    dnu = manual.get("do_not_use_when")
    if isinstance(dnu, list):
        if len(dnu) < 1:
            _err("TOO_FEW_ITEMS", "do_not_use_when needs at least 1 item",
                 "do_not_use_when")
        elif len(dnu) > 5:
            _err("TOO_MANY_ITEMS", "do_not_use_when allows at most 5 items",
                 "do_not_use_when")

    # ── permission_class ──
    pc = manual.get("permission_class")
    valid_pcs = {"read_only", "action", "payment"}
    if isinstance(pc, str) and pc not in valid_pcs:
        # Detect common mistake: copying hyphenated value from AppManifest
        if pc in ("read-only", "recommendation"):
            _err("INVALID_PERMISSION_CLASS",
                 f"ToolManual uses underscored values ({sorted(valid_pcs)}), "
                 f"not the hyphenated AppManifest form '{pc}'",
                 "permission_class")
        else:
            _err("INVALID_PERMISSION_CLASS",
                 f"permission_class must be one of {sorted(valid_pcs)}",
                 "permission_class")

    # ── action/payment extra fields ──
    # Mirror the server validator in agent_sns.application.capability_runtime
    # .tool_manual_validator: schema fields accept {} as "present", string
    # fields are validated as non-empty strings, and bools are validated
    # separately. Using truthiness across all of them over-rejects valid
    # manuals (e.g. preview_schema = {}) and diverges from publish-time
    # gating — see Codex review finding.
    def _require_str(fld: str, ctx: str) -> None:
        val = manual.get(fld)
        if val is None:
            _err("MISSING_FIELD", f"'{fld}' is required for permission_class='{ctx}'", fld)
        elif not isinstance(val, str):
            _err("INVALID_TYPE", f"'{fld}' must be a string", fld)
        elif len(val) == 0:
            # Server-side `_validate_str` uses raw length (not `.strip()`),
            # so a single whitespace passes publish-time validation.
            # Mirror that behavior: reject only truly empty strings here,
            # not whitespace-only. Otherwise we block manuals the server
            # would have accepted.
            _err("TOO_SHORT", f"'{fld}' must be at least 1 char", fld)

    def _require_schema(fld: str, ctx: str) -> None:
        val = manual.get(fld)
        if val is None:
            _err("MISSING_FIELD", f"'{fld}' is required for permission_class='{ctx}'", fld)
        elif not isinstance(val, dict):
            _err("INVALID_TYPE", f"'{fld}' must be a JSON Schema object", fld)

    if pc in ("action", "payment"):
        _require_str("approval_summary_template", pc)
        _require_schema("preview_schema", pc)
        _require_str("side_effect_summary", pc)
        # `jurisdiction` became a required field for action/payment in the
        # schema (schemas/tool-manual.schema.json) but the raw-dict validator
        # did not enforce it, so manuals missing jurisdiction passed locally
        # and failed at registration. Mirror the schema here.
        _require_str("jurisdiction", pc)
        jur = manual.get("jurisdiction")
        if isinstance(jur, str) and len(jur) > 0 and not _JURISDICTION_PATTERN.match(jur):
            _err("INVALID_JURISDICTION",
                 f"jurisdiction must be ISO 3166-1 alpha-2 (optionally -subregion), got: {jur!r}",
                 "jurisdiction")
        if "idempotency_support" not in manual:
            _err("MISSING_FIELD",
                 f"'idempotency_support' is required for permission_class='{pc}'",
                 "idempotency_support")
        elif manual.get("idempotency_support") is not True:
            _err("IDEMPOTENCY_REQUIRED",
                 "idempotency_support must be true for action/payment",
                 "idempotency_support")

    if pc == "payment":
        _require_schema("quote_schema", "payment")
        _require_str("currency", "payment")
        _require_str("settlement_mode", "payment")
        _require_str("refund_or_cancellation_note", "payment")
        if isinstance(manual.get("currency"), str) and manual["currency"] != "USD":
            _err("INVALID_CURRENCY", "currency must be 'USD'", "currency")
        sm = manual.get("settlement_mode")
        valid_sm = {
            "stripe_checkout",
            "stripe_payment_intent",
            "polygon_mandate",
            "embedded_wallet_charge",
        }
        if isinstance(sm, str) and sm not in valid_sm:
            _err("INVALID_SETTLEMENT_MODE",
                 f"settlement_mode must be one of {sorted(valid_sm)}",
                 "settlement_mode")

    # ── input_schema ──
    inp = manual.get("input_schema")
    if isinstance(inp, dict):
        if inp.get("type") != "object":
            _err("INPUT_SCHEMA", "Root type must be 'object'", "input_schema")
        if inp.get("additionalProperties") is not False:
            _err("INPUT_SCHEMA",
                 "additionalProperties must be false", "input_schema")
        # Composition keywords and patternProperties are forbidden at ANY nesting
        # level, matching the server's _check_composition_keywords /
        # _check_forbidden_key recursive sweep. A top-level-only check was
        # letting nested violations through, producing false confidence.
        _check_schema_forbidden_recursive(inp, "input_schema", _err)
        # platform-injected fields (top-level properties only; matches server)
        props = inp.get("properties", {})
        if isinstance(props, dict):
            for pf in _PLATFORM_INJECTED_FIELDS & set(props):
                _warn("INPUT_SCHEMA",
                      f"'{pf}' is platform-injected; remove from input_schema",
                      f"input_schema.properties.{pf}")

    # ── output_schema ──
    out = manual.get("output_schema")
    if isinstance(out, dict):
        # must have at least one required key
        out_req = out.get("required")
        if not isinstance(out_req, list) or len(out_req) == 0:
            _err("OUTPUT_SCHEMA",
                 "output_schema must have at least one stable required key",
                 "output_schema.required")
        oprops = out.get("properties", {})
        if isinstance(oprops, dict) and "summary" not in oprops:
            _err("OUTPUT_SCHEMA",
                 "output_schema must include a 'summary' property",
                 "output_schema.properties")
        # payment-specific output checks — match server validate_output_schema
        # which requires BOTH amount_usd AND currency in properties (not just
        # amount_usd). Previous SDK check only enforced amount_usd in properties
        # while the server rejected missing currency, leading to a pass-local
        # / fail-server divergence.
        if pc == "payment":
            if isinstance(out_req, list):
                if "amount_usd" not in out_req:
                    _err("OUTPUT_SCHEMA",
                         "Payment output_schema must require 'amount_usd'",
                         "output_schema.required")
                if "currency" not in out_req:
                    _err("OUTPUT_SCHEMA",
                         "Payment output_schema must require 'currency'",
                         "output_schema.required")
            if isinstance(oprops, dict):
                if "amount_usd" not in oprops:
                    _err("OUTPUT_SCHEMA",
                         "Payment output_schema must include 'amount_usd' in properties",
                         "output_schema.properties")
                if "currency" not in oprops:
                    _err("OUTPUT_SCHEMA",
                         "Payment output_schema must include 'currency' in properties",
                         "output_schema.properties")

    ok = not any(i.severity == "error" for i in issues)
    return ok, issues


@dataclass
class HealthCheckResult:
    healthy: bool
    message: str = ""
    provider_status: dict[str, str] = field(default_factory=dict)


# ── App Adapter Protocol ──

class AppAdapter(abc.ABC):
    """Base class for Siglume API Store capability adapters.

    External developers subclass this to publish a capability on the
    Siglume API Store. Siglume's CapabilityGateway calls these methods
    at runtime when a subscribing agent invokes the capability.
    """

    @abc.abstractmethod
    def manifest(self) -> AppManifest:
        """Return the app's manifest (capability declaration)."""
        ...

    @abc.abstractmethod
    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        """Execute the app's core functionality.

        Called by Siglume runtime when an agent uses this app.
        The ctx.execution_kind indicates what level of execution is requested:
        - DRY_RUN: simulate without side effects
        - QUOTE: return a price/estimate without committing
        - ACTION: perform the action (e.g., add to cart)
        - PAYMENT: finalize payment/purchase

        For action/payment, return needs_approval=True if owner confirmation
        is required before proceeding.
        """
        ...

    async def health_check(self) -> HealthCheckResult:
        """Check if the app's external dependencies are reachable."""
        return HealthCheckResult(healthy=True)

    async def on_install(self, agent_id: str, owner_user_id: str) -> None:
        """Called when the app is installed on an agent. Optional hook."""
        pass

    async def on_uninstall(self, agent_id: str, owner_user_id: str) -> None:
        """Called when the app is removed from an agent. Optional hook."""
        pass

    def supported_task_types(self) -> list[str]:
        """Return the list of task types this app can handle."""
        return ["default"]


# ── Stub Provider for Sandbox Testing ──

class StubProvider:
    """Base class for stub providers used in sandbox testing.

    Developers create stubs that simulate external API responses
    without making real API calls.
    """

    def __init__(self, provider_key: str):
        self.provider_key = provider_key

    async def handle(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        """Handle a simulated API call. Override per provider."""
        return {"status": "stub_ok", "provider": self.provider_key, "method": method}


# ── Test Harness ──

def _normalize_usage_record_flat(record: Any) -> dict[str, Any]:
    """Flat-module fallback mirroring siglume_api_sdk.metering._normalize_usage_record.

    Keeps simulate_metering usable when the package-layout metering module is
    not available (legacy single-file consumers).
    """
    if isinstance(record, Mapping):
        payload: dict[str, Any] = dict(record)
    elif hasattr(record, "__dict__"):
        payload = {
            key: getattr(record, key)
            for key in ("capability_key", "dimension", "units", "external_id", "occurred_at_iso", "agent_id")
            if hasattr(record, key)
        }
    else:
        raise ValueError("Usage records must be mappings or UsageRecord-like objects.")

    capability_key = str(payload.get("capability_key") or "").strip()
    if not capability_key:
        raise ValueError("UsageRecord.capability_key is required.")
    dimension = str(payload.get("dimension") or "").strip()
    if not dimension:
        raise ValueError("UsageRecord.dimension is required.")
    external_id = str(payload.get("external_id") or "").strip()
    if not external_id:
        raise ValueError("UsageRecord.external_id is required.")

    occurred_text = str(payload.get("occurred_at_iso") or "").strip()
    if not occurred_text:
        raise ValueError("UsageRecord.occurred_at_iso is required.")
    candidate = occurred_text[:-1] + "+00:00" if occurred_text.endswith("Z") else occurred_text
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise ValueError("UsageRecord.occurred_at_iso must be RFC3339 with timezone.") from exc
    if parsed.tzinfo is None:
        raise ValueError("UsageRecord.occurred_at_iso must be RFC3339 with timezone.")

    units_value = payload.get("units")
    if isinstance(units_value, bool):
        raise ValueError("UsageRecord.units must be a non-negative integer.")
    if isinstance(units_value, int):
        units = units_value
    elif isinstance(units_value, str) and re.fullmatch(r"-?\d+", units_value.strip()):
        units = int(units_value.strip())
    else:
        raise ValueError("UsageRecord.units must be a non-negative integer.")
    if units < 0:
        raise ValueError("UsageRecord.units must be a non-negative integer.")

    normalized: dict[str, Any] = {
        "capability_key": capability_key,
        "dimension": dimension,
        "units": units,
        "external_id": external_id,
        "occurred_at_iso": occurred_text,
    }
    agent_id = str(payload.get("agent_id") or "").strip()
    if agent_id:
        normalized["agent_id"] = agent_id
    return normalized


class AppTestHarness:
    """Helper for testing apps locally before submission.

    Usage:
        harness = AppTestHarness(MyApp())
        result = await harness.dry_run(task_type="compare_prices")
        assert result.success
    """

    def __init__(self, app: AppAdapter, stubs: dict[str, StubProvider] | None = None):
        self.app = app
        self.stubs = stubs or {}

    async def _execute(
        self,
        execution_kind: ExecutionKind,
        task_type: str = "default",
        **kwargs,
    ) -> ExecutionResult:
        """Internal helper — build context and run execute().

        All public execute_* methods delegate here so that changes to
        context construction are made in one place.
        """
        ctx = ExecutionContext(
            agent_id="test-agent-001",
            owner_user_id="test-owner-001",
            task_type=task_type,
            environment=Environment.SANDBOX,
            execution_kind=execution_kind,
            **kwargs,
        )
        return await self.app.execute(ctx)

    async def dry_run(self, task_type: str = "default", **kwargs) -> ExecutionResult:
        return await self._execute(ExecutionKind.DRY_RUN, task_type, **kwargs)

    async def execute_action(self, task_type: str = "default", **kwargs) -> ExecutionResult:
        return await self._execute(ExecutionKind.ACTION, task_type, **kwargs)

    async def execute_quote(self, task_type: str = "default", **kwargs) -> ExecutionResult:
        """Execute a QUOTE request (price/estimate without committing)."""
        return await self._execute(ExecutionKind.QUOTE, task_type, **kwargs)

    async def execute_payment(self, task_type: str = "default", **kwargs) -> ExecutionResult:
        """Execute a PAYMENT request (in sandbox — no real charges)."""
        return await self._execute(ExecutionKind.PAYMENT, task_type, **kwargs)

    async def health(self) -> HealthCheckResult:
        return await self.app.health_check()

    def validate_manifest(self) -> list[str]:
        """Validate the app manifest. Returns list of issues (empty = valid)."""
        m = self.app.manifest()
        issues = []
        if not m.capability_key:
            issues.append("capability_key is required")
        elif not re.match(r'^[a-z0-9][a-z0-9-]*[a-z0-9]$', m.capability_key):
            issues.append("capability_key must be lowercase alphanumeric with hyphens (e.g., 'price-compare-helper')")
        if not m.name:
            issues.append("name is required")
        if not m.job_to_be_done:
            issues.append("job_to_be_done is required")
        # Platform rejects auto-register with fewer than 2 distinct non-empty
        # prompts (the detail page's "Example prompts" section would otherwise
        # render empty). Mirror the server rule client-side so preflight
        # catches it without a round-trip.
        distinct_prompts = {p.strip() for p in (m.example_prompts or []) if isinstance(p, str) and p.strip()}
        if len(distinct_prompts) < 2:
            issues.append(
                "example_prompts must include at least 2 distinct non-empty sample prompts"
            )
        try:
            _validate_pricing_plan_floor(m.pricing_plan, default_currency=str(m.currency.value if isinstance(m.currency, ListingCurrency) else m.currency))
        except ValueError as exc:
            issues.append(str(exc))
        billing_timing = str(getattr(m, "billing_timing", "post") or "post").strip().lower()
        if billing_timing not in {"post", "prepay"}:
            issues.append("billing_timing must be 'post' or 'prepay'")
        price_model_value = m.price_model.value if isinstance(m.price_model, PriceModel) else str(m.price_model or "")
        if price_model_value in {PriceModel.USAGE_BASED.value, PriceModel.PER_ACTION.value} and not _pricing_plan_has_items(
            m.pricing_plan
        ):
            issues.append("pricing_plan.items is required for usage_based/per_action pricing")
        if m.permission_class in (PermissionClass.ACTION, PermissionClass.PAYMENT):
            if not m.dry_run_supported:
                issues.append("action/payment apps should support dry_run")
            if m.approval_mode == ApprovalMode.AUTO:
                issues.append("action/payment apps should not use auto approval")
        return issues

    def validate_tool_manual(
        self, manual: dict[str, Any] | ToolManual | None = None,
    ) -> tuple[bool, list[ToolManualIssue]]:
        """Validate a tool manual using the SDK's client-side validator.

        If no manual is provided, this is a no-op returning (True, []).
        """
        if manual is None:
            return True, []
        return validate_tool_manual(manual)

    def validate_receipt(self, result: ExecutionResult) -> list[str]:
        """Check an ExecutionResult for common receipt issues.

        Returns a list of human-readable issues (empty = valid).
        Checks both legacy receipt_summary and structured artifacts/side_effects.
        """
        issues: list[str] = []

        # At least one form of receipt should be present for non-dry-run
        if result.execution_kind != ExecutionKind.DRY_RUN:
            has_legacy = bool(result.receipt_summary)
            has_structured = bool(result.artifacts) or bool(result.side_effects)
            if not has_legacy and not has_structured:
                issues.append(
                    "Non-dry-run execution should include receipt_summary "
                    "or structured artifacts/side_effects"
                )

        # Action/payment should report side effects
        if result.execution_kind in (ExecutionKind.ACTION, ExecutionKind.PAYMENT):
            if not result.side_effects and not result.receipt_summary:
                issues.append(
                    "Action/payment execution should report side effects"
                )

        # If needs_approval, should have approval context
        if result.needs_approval:
            if not result.approval_prompt and not result.approval_hint:
                issues.append(
                    "needs_approval=True but no approval_prompt or approval_hint provided"
                )

        # Artifacts should have artifact_type
        for i, art in enumerate(result.artifacts):
            if not art.artifact_type:
                issues.append(f"artifacts[{i}].artifact_type is empty")

        # Side effects should have action and provider
        for i, se in enumerate(result.side_effects):
            if not se.action:
                issues.append(f"side_effects[{i}].action is empty")
            if not se.provider:
                issues.append(f"side_effects[{i}].provider is empty")

        return issues

    def simulate_metering(
        self,
        record: Any,
        *,
        execution_result: ExecutionResult | None = None,
    ) -> dict[str, Any]:
        """Preview how a usage record would map to an invoice line.

        This helper validates the usage payload shape locally and returns a
        deterministic preview. It does not create a charge.
        """
        try:
            from siglume_api_sdk.metering import _normalize_usage_record as _normalize
        except ModuleNotFoundError:
            _normalize = _normalize_usage_record_flat

        manifest = self.app.manifest()
        usage_record = _normalize(record)

        price_model_raw = manifest.price_model
        if isinstance(price_model_raw, PriceModel):
            price_model_value = price_model_raw.value
        else:
            price_model_value = str(price_model_raw or "")

        usage_based_matches = price_model_raw == PriceModel.USAGE_BASED or price_model_value == PriceModel.USAGE_BASED.value
        per_action_matches = price_model_raw == PriceModel.PER_ACTION or price_model_value == PriceModel.PER_ACTION.value
        invoice_line_preview: dict[str, Any] | None = None

        if usage_based_matches:
            billable_units = int(usage_record["units"])
            invoice_line_preview = {
                "price_model": price_model_value,
                "billable_units": billable_units,
                "unit_amount_minor": int(manifest.price_value_minor),
                "subtotal_minor": billable_units * int(manifest.price_value_minor),
                "currency": manifest.currency,
            }
        elif per_action_matches:
            billable_units = int(
                execution_result is not None
                and execution_result.success
                and execution_result.execution_kind != ExecutionKind.DRY_RUN
            )
            invoice_line_preview = {
                "price_model": price_model_value,
                "billable_units": billable_units,
                "unit_amount_minor": int(manifest.price_value_minor),
                "subtotal_minor": billable_units * int(manifest.price_value_minor),
                "currency": manifest.currency,
            }

        return {
            "experimental": False,
            "usage_record": usage_record,
            "invoice_line_preview": invoice_line_preview,
        }

    def simulate_polygon_mandate(
        self,
        *,
        mandate_id: str,
        payer_wallet: str,
        payee_wallet: str,
        monthly_cap_minor: int,
        currency: str,
        status: str = "active",
        next_attempt_at_iso: str | None = "2026-05-01T00:00:00Z",
        cancel_scheduled: bool = False,
    ):
        from siglume_api_sdk.web3 import simulate_polygon_mandate as _simulate_polygon_mandate

        return _simulate_polygon_mandate(
            mandate_id=mandate_id,
            payer_wallet=payer_wallet,
            payee_wallet=payee_wallet,
            monthly_cap_minor=monthly_cap_minor,
            currency=currency,
            status=status,
            next_attempt_at_iso=next_attempt_at_iso,
            cancel_scheduled=cancel_scheduled,
        )

    def simulate_embedded_wallet_charge(
        self,
        *,
        mandate: Any,
        amount_minor: int,
        tx_hash: str,
        user_operation_hash: str | None = None,
        block_number: int = 123456,
        gas_sponsored_by: str = "platform",
        platform_fee_minor: int = 0,
        developer_net_minor: int | None = None,
    ):
        from siglume_api_sdk.web3 import simulate_embedded_wallet_charge as _simulate_embedded_wallet_charge

        return _simulate_embedded_wallet_charge(
            mandate=mandate,
            amount_minor=amount_minor,
            tx_hash=tx_hash,
            user_operation_hash=user_operation_hash,
            block_number=block_number,
            gas_sponsored_by=gas_sponsored_by,
            platform_fee_minor=platform_fee_minor,
            developer_net_minor=developer_net_minor,
        )

    def record(
        self,
        cassette_path: str,
        *,
        ignore_body_fields: list[str] | None = None,
    ) -> "_HarnessRecorderScope":
        from siglume_api_sdk.testing import Recorder, RecordMode

        return _HarnessRecorderScope(
            self,
            Recorder(
                cassette_path,
                mode=RecordMode.RECORD,
                ignore_body_fields=ignore_body_fields,
            ),
        )

    def replay(
        self,
        cassette_path: str,
        *,
        ignore_body_fields: list[str] | None = None,
    ) -> "_HarnessRecorderScope":
        from siglume_api_sdk.testing import Recorder, RecordMode

        return _HarnessRecorderScope(
            self,
            Recorder(
                cassette_path,
                mode=RecordMode.REPLAY,
                ignore_body_fields=ignore_body_fields,
            ),
        )


class _HarnessRecorderScope:
    def __init__(self, harness: AppTestHarness, recorder: Any) -> None:
        self.harness = harness
        self.recorder = recorder

    def __enter__(self) -> AppTestHarness:
        self.recorder.__enter__()
        return self.harness

    def __exit__(self, exc_type, exc, tb) -> None:
        self.recorder.__exit__(exc_type, exc, tb)
