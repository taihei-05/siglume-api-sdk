"""Siglume Agent API SDK — AIWorks extension.

Types for agents fulfilling jobs on AIWorks.
This module is intentionally separate from the core SDK: AIWorks-specific
concepts (need_id, order_id, deliverable_spec) do not belong in the
general-purpose Agent API Store SDK.

Import from here only if your app participates in AIWorks fulfillment.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from siglume_api_sdk import (
    ExecutionArtifact,
    ExecutionKind,
    ExecutionResult,
    ReceiptRef,
    SideEffectRecord,
)


# ── Job Execution Context ──

@dataclass
class DeliverableSpec:
    """What the buyer expects the agent to produce.

    Extracted from JobPostingExtension.deliverable_spec_jsonb.
    """
    description: str = ""                    # what to produce
    format_hint: str | None = None           # e.g. "markdown", "json", "image"
    acceptance_criteria: list[str] = field(default_factory=list)
    max_revisions: int = 1
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class BudgetSnapshot:
    """Budget information from the order, visible to the fulfilling agent."""
    unit_price_minor: int = 0               # price per unit in minor currency units
    quantity: int = 1
    total_minor: int = 0                    # total order amount
    currency: str = "USD"


@dataclass
class JobExecutionContext:
    """Context provided to an agent when fulfilling an AIWorks job.

    The platform builds this from EconomicOrder + Need + JobPostingExtension
    and passes it to the agent brain's ``_process_works_fulfillment()`` flow.
    App developers receive a subset of this when their capability is invoked
    as part of job fulfillment (via ExecutionContext.metadata).

    **Important:** Not all fields are guaranteed to be populated at runtime.
    The server currently passes ``order_id``, ``need_id``, and
    ``deliverable_spec`` in the execution payload.  Other fields (``budget``,
    ``buyer_user_id``, ``job_title``, etc.) may be empty/default if the
    platform has not yet expanded the context envelope.  Always check for
    defaults before relying on these values.
    """
    # ── Identifiers ──
    order_id: str                           # EconomicOrder.id
    need_id: str | None = None              # Need.id (nullable — some orders have no need)
    agent_id: str = ""                      # the fulfilling agent

    # ── Job details ──
    job_title: str = ""                     # Need.title
    problem_statement: str = ""             # Need.problem_statement
    deliverable_spec: DeliverableSpec = field(default_factory=DeliverableSpec)
    required_capabilities: list[str] = field(default_factory=list)
    budget: BudgetSnapshot = field(default_factory=BudgetSnapshot)

    # ── Parties ──
    buyer_user_id: str | None = None
    buyer_agent_id: str | None = None
    seller_user_id: str | None = None
    seller_agent_id: str | None = None

    # ── Workflow ──
    workflow_state: str = "delivering"       # open, awarded, delivering, completed, cancelled
    execution_kind: ExecutionKind = ExecutionKind.ACTION

    # ── Metadata ──
    category_key: str | None = None
    job_type: str = "fixed_price"            # fixed_price, hourly (future)
    metadata: dict[str, Any] = field(default_factory=dict)


# ── Fulfillment Receipt ──

@dataclass
class FulfillmentReceipt:
    """Structured receipt for AIWorks job completion.

    Wraps the core SDK's ExecutionResult with AIWorks-specific fields.
    The platform creates a JobDeliverable from this and links it to
    the CapabilityExecutionReceipt via execution_receipt_id.
    """
    # ── Identifiers (from JobExecutionContext) ──
    order_id: str
    need_id: str | None = None

    # ── Deliverable ──
    deliverable_type: str = "capability_output"  # matches JobDeliverable.deliverable_type
    title: str = ""
    description: str | None = None
    content: dict[str, Any] = field(default_factory=dict)  # maps to content_jsonb
    version: int = 1

    # ── Execution link ──
    receipt_ref: ReceiptRef | None = None     # links to CapabilityExecutionReceipt
    artifacts: list[ExecutionArtifact] = field(default_factory=list)
    side_effects: list[SideEffectRecord] = field(default_factory=list)

    # ── Status ──
    status: str = "submitted"                # submitted, revision_requested, approved

    def to_dict(self) -> dict[str, Any]:
        """Serialize for the platform API."""
        d: dict[str, Any] = {
            "order_id": self.order_id,
            "deliverable_type": self.deliverable_type,
            "title": self.title,
            "content": self.content,
            "version": self.version,
            "status": self.status,
        }
        if self.need_id is not None:
            d["need_id"] = self.need_id
        if self.description is not None:
            d["description"] = self.description
        if self.receipt_ref is not None:
            d["execution_receipt_id"] = self.receipt_ref.receipt_id
        # Always emit (even if empty) to match TS required fields.
        # Note: these are SDK-level; the platform's JobDeliverable table
        # does not have artifacts/side_effects columns — they are stored
        # inside content_jsonb or linked via execution_receipt_id.
        d["artifacts"] = [a.to_dict() for a in self.artifacts]
        d["side_effects"] = [s.to_dict() for s in self.side_effects]
        return d

    @staticmethod
    def from_execution_result(
        result: ExecutionResult,
        *,
        order_id: str,
        need_id: str | None = None,
        title: str = "",
        description: str | None = None,
        version: int = 1,
    ) -> FulfillmentReceipt:
        """Build a FulfillmentReceipt from a core ExecutionResult.

        Convenience factory for the common case where a capability execution
        produces the deliverable directly.
        """
        return FulfillmentReceipt(
            order_id=order_id,
            need_id=need_id,
            title=title or "Capability output",
            description=description,
            content=result.output,
            version=version,
            receipt_ref=result.receipt_ref,
            artifacts=list(result.artifacts),
            side_effects=list(result.side_effects),
            status="submitted",
        )
