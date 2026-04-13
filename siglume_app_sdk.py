"""Siglume Agent App SDK — interface definitions for external developers.

This module defines the contracts that app developers implement to create
agent apps for the Siglume Agent API Store.

An "agent app" is a power-up kit that gives a Siglume AI agent new capabilities.
For example: Amazon price comparison, travel booking, CRM sync, etc.

Developers implement the AppAdapter protocol and register it with Siglume.
"""
from __future__ import annotations

import abc
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


# ── Permission & Execution Models ──

class PermissionClass(str, Enum):
    READ_ONLY = "read-only"          # Search, retrieve, review
    RECOMMENDATION = "recommendation" # Compare, suggest, quote
    ACTION = "action"                 # Cart, reserve, draft
    PAYMENT = "payment"              # Pay, purchase, settle


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

    Two options: free or subscription (USD).
    Platform fee: 6.6%. Developer keeps 93.4%.
    """
    FREE = "free"                    # No charge.
    SUBSCRIPTION = "subscription"    # Monthly recurring (USD).
    USAGE_BASED = "usage_based"  # Planned post-beta per-use model.
    PER_ACTION = "per_action"  # Planned post-beta per-successful-action model.


class AppCategory(str, Enum):
    COMMERCE = "commerce"
    BOOKING = "booking"
    CRM = "crm"
    FINANCE = "finance"
    DOCUMENT = "document"
    COMMUNICATION = "communication"
    MONITORING = "monitoring"
    OTHER = "other"


# ── Data Transfer Objects ──

@dataclass
class AppManifest:
    """Declares what the app does and what it needs."""
    capability_key: str                    # unique identifier e.g. "amazon-purchase-assistant"
    version: str = "0.1.0"
    name: str = ""                         # display name
    job_to_be_done: str = ""               # what this app enables the agent to do
    category: AppCategory = AppCategory.OTHER  # e.g. "commerce", "booking", "crm"
    permission_class: PermissionClass = PermissionClass.READ_ONLY
    approval_mode: ApprovalMode = ApprovalMode.AUTO
    dry_run_supported: bool = False
    required_connected_accounts: list[str] = field(default_factory=list)  # e.g. ["amazon", "stripe"]
    permission_scopes: list[str] = field(default_factory=list)
    price_model: PriceModel = PriceModel.FREE
    price_value_minor: int = 0             # in minor currency units (e.g. cents/yen)
    currency: str = "USD"
    short_description: str = ""
    docs_url: str = ""
    support_contact: str = ""
    compatibility_tags: list[str] = field(default_factory=list)
    latency_tier: str = "normal"           # fast, normal, slow
    example_prompts: list[str] = field(default_factory=list)


@dataclass
class ConnectedAccountRef:
    """Opaque reference to a connected account. Does NOT contain raw credentials."""
    provider_key: str
    session_token: str  # short-lived, scoped token managed by Siglume
    scopes: list[str] = field(default_factory=list)
    environment: Environment = Environment.LIVE


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
    connected_accounts: dict[str, ConnectedAccountRef] = field(default_factory=dict)
    budget_remaining_minor: int | None = None
    trace_id: str | None = None
    idempotency_key: str | None = None
    request_hash: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


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
    approval_prompt: str | None = None     # human-readable approval request
    receipt_summary: dict[str, Any] = field(default_factory=dict)


@dataclass
class HealthCheckResult:
    healthy: bool
    message: str = ""
    provider_status: dict[str, str] = field(default_factory=dict)


# ── App Adapter Protocol ──

class AppAdapter(abc.ABC):
    """Base class for Siglume agent app adapters.

    External developers subclass this to create new agent apps.
    Siglume's CapabilityGateway calls these methods at runtime.
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

    async def dry_run(self, task_type: str = "default", **kwargs) -> ExecutionResult:
        ctx = ExecutionContext(
            agent_id="test-agent-001",
            owner_user_id="test-owner-001",
            task_type=task_type,
            environment=Environment.SANDBOX,
            execution_kind=ExecutionKind.DRY_RUN,
            connected_accounts={
                k: ConnectedAccountRef(provider_key=k, session_token=f"stub-token-{k}")
                for k in self.stubs
            },
            **kwargs,
        )
        return await self.app.execute(ctx)

    async def execute_action(self, task_type: str = "default", **kwargs) -> ExecutionResult:
        ctx = ExecutionContext(
            agent_id="test-agent-001",
            owner_user_id="test-owner-001",
            task_type=task_type,
            environment=Environment.SANDBOX,
            execution_kind=ExecutionKind.ACTION,
            connected_accounts={
                k: ConnectedAccountRef(provider_key=k, session_token=f"stub-token-{k}")
                for k in self.stubs
            },
            **kwargs,
        )
        return await self.app.execute(ctx)

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
        if not m.example_prompts:
            issues.append("at least one example_prompt is recommended")
        if m.permission_class in (PermissionClass.ACTION, PermissionClass.PAYMENT):
            if not m.dry_run_supported:
                issues.append("action/payment apps should support dry_run")
            if m.approval_mode == ApprovalMode.AUTO:
                issues.append("action/payment apps should not use auto approval")
        return issues
