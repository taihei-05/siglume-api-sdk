"""Example: stage market proposal approval intents for owner review.

API: first-party market.proposals.* typed wrappers over the owner-operation surface.
Intended user: owners or orchestration builders who negotiate buyer/seller proposals safely.
Connected account: none.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk import (  # noqa: E402
    AppAdapter,
    AppCategory,
    AppManifest,
    AppTestHarness,
    ApprovalMode,
    ApprovalRequestHint,
    ExecutionArtifact,
    ExecutionContext,
    ExecutionKind,
    ExecutionResult,
    PermissionClass,
    PriceModel,
    SideEffectRecord,
    SiglumeClient,
    ToolManual,
    ToolManualPermissionClass,
    score_tool_manual_offline,
    validate_tool_manual,
)


DEMO_AGENT_ID = "agt_owner_demo"


class MarketProposalsWrapperApp(AppAdapter):
    def __init__(self, client: SiglumeClient | None = None) -> None:
        self.client = client or build_mock_client()

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="market-proposals-wrapper",
            name="Market Proposals Wrapper",
            job_to_be_done="Prepare owner-reviewed proposal negotiation steps through the first-party market proposal surface.",
            category=AppCategory.OTHER,
            store_vertical="api",
            permission_class=PermissionClass.ACTION,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            currency="USD",
            allow_free_trial=False,
            jurisdiction="US",
            short_description="Loads existing proposals, then prepares create / counter / accept approval intents without inventing an unpublished REST contract.",
            example_prompts=[
                "Prepare the next proposal step for the translation opportunity without sending anything live yet.",
                "Draft a proposal for this market need but keep it in staging.",
            ],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        input_params = ctx.input_params or {}
        target_opportunity = str(input_params.get("opportunity_id") or "opp_demo_1")
        target_proposal_id = str(input_params.get("proposal_id") or "prop_demo_1")
        page = self.client.list_market_proposals(agent_id=DEMO_AGENT_ID, status="draft", limit=2)
        proposals = page.items
        first = self.client.get_market_proposal(target_proposal_id, agent_id=DEMO_AGENT_ID)
        preview = {
            "summary": f"Would prepare proposal approval requests for {target_opportunity} after reviewing {len(proposals)} existing proposal(s).",
            "opportunity_id": target_opportunity,
            "proposal_id": first.proposal_id,
            "proposal_count": len(proposals),
            "first_status": first.status,
        }

        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output=preview,
                needs_approval=True,
                approval_prompt=f"Create market proposal approval intents for {target_opportunity}.",
                approval_hint=ApprovalRequestHint(
                    action_summary=f"Prepare proposal negotiation for {target_opportunity}",
                    permission_class="action",
                    side_effects=[
                        "Creates approval intents for proposal create / counter / accept; nothing is published or accepted until the owner approves.",
                    ],
                    preview=preview,
                    reversible=True,
                ),
            )

        created = self.client.create_market_proposal(
            agent_id=DEMO_AGENT_ID,
            opportunity_id=target_opportunity,
            proposal_kind="proposal",
            currency="USD",
            amount_minor=25000,
            proposed_terms_jsonb={"delivery_days": 7, "scope": "translation+review"},
            publish_to_thread=True,
            thread_content_id="thr_demo_1",
            note_title="Initial proposal",
            note_summary="Opening proposal for the opportunity.",
            note_body="Prepared for owner approval before publishing.",
            note_visibility="owner_only",
            note_content_kind="proposal_note",
            expires_at="2026-04-30T00:00:00Z",
        )
        countered = self.client.counter_market_proposal(
            target_proposal_id,
            agent_id=DEMO_AGENT_ID,
            proposal_kind="counter",
            proposed_terms_jsonb={"delivery_days": 5, "scope": "translation+qa"},
            publish_to_thread=True,
            thread_content_id="thr_demo_1",
            note_title="Counter proposal",
            note_summary="Tighter turnaround for the same budget.",
            note_body="Prepared for owner approval before publishing.",
            note_visibility="owner_only",
            note_content_kind="proposal_note",
            expires_at="2026-04-28T00:00:00Z",
        )
        accepted = self.client.accept_market_proposal(
            target_proposal_id,
            agent_id=DEMO_AGENT_ID,
            comment="Accept if the owner agrees with the delivery timeline.",
            publish_to_thread=True,
            thread_content_id="thr_demo_1",
            note_title="Accept proposal",
            note_summary="Accept the current proposal after owner review.",
            note_visibility="owner_only",
            note_content_kind="proposal_note",
        )
        intent_ids = [
            intent_id
            for intent_id in [created.intent_id, countered.intent_id, accepted.intent_id]
            if intent_id
        ]
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": f"Prepared {len(intent_ids)} proposal approval requests for {target_opportunity}.",
                "opportunity_id": target_opportunity,
                "proposal_id": first.proposal_id,
                "approval_intent_ids": intent_ids,
                "approval_required": [
                    created.approval_required,
                    countered.approval_required,
                    accepted.approval_required,
                ],
            },
            receipt_summary={
                "action": "market_proposal_approval_intents_created",
                "opportunity_id": target_opportunity,
                "approval_intent_ids": intent_ids,
            },
            artifacts=[
                ExecutionArtifact(
                    artifact_type="owner_operation_proposal",
                    external_id=intent_id,
                    title=f"Proposal approval intent {index + 1}",
                    summary="Owner approval intent created through market.proposals.*.",
                )
                for index, intent_id in enumerate(intent_ids)
            ],
            side_effects=[
                SideEffectRecord(
                    action="market_proposal_approval_intent_created",
                    provider="siglume-owner-operations",
                    external_id=intent_id,
                    reversible=True,
                    reversal_hint="Discard the pending approval intent before the owner approves it.",
                    metadata={"opportunity_id": target_opportunity, "proposal_id": first.proposal_id},
                )
                for intent_id in intent_ids
            ],
        )

    def supported_task_types(self) -> list[str]:
        return ["stage_market_proposal_negotiation"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="market_proposals_wrapper",
        job_to_be_done="Prepare owner-reviewed proposal negotiation steps for a market opportunity without sending them live immediately.",
        summary_for_model="Loads typed proposal records, previews the current negotiation state, and creates approval intents for create / counter / accept actions only after the owner reviews the plan.",
        trigger_conditions=[
            "owner asks to draft, counter, or accept a market proposal but wants an approval preview first",
            "workflow needs typed proposal context before sending any negotiation step into the shared thread",
            "agent should prepare proposal negotiation safely through Siglume's first-party owner-operation surface",
        ],
        do_not_use_when=[
            "workflow only needs to read proposals without staging any owner-reviewed action",
            "the proposal belongs to a different owner or the owner has not chosen the target opportunity yet",
        ],
        permission_class=ToolManualPermissionClass.ACTION,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "opportunity_id": {"type": "string", "description": "Opportunity to target when staging a new proposal."},
                "proposal_id": {"type": "string", "description": "Existing proposal to inspect or counter.", "default": "prop_demo_1"},
            },
            "required": ["opportunity_id"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line summary of the staged approval intents."},
                "opportunity_id": {"type": "string"},
                "proposal_id": {"type": "string"},
                "approval_intent_ids": {"type": "array", "items": {"type": "string"}},
                "approval_required": {"type": "array", "items": {"type": "boolean"}},
            },
            "required": ["summary", "opportunity_id", "proposal_id", "approval_intent_ids", "approval_required"],
            "additionalProperties": False,
        },
        usage_hints=["Use dry_run first so the owner can see the current proposal and the staged negotiation path before approval intents are created."],
        result_hints=["Report the returned approval_intent_ids explicitly so the owner can review or discard them later."],
        error_hints=["If proposal_id is missing or belongs to another owner, explain that the proposal could not be loaded and do not fabricate a negotiation step."],
        approval_summary_template="Create proposal approval intents for {opportunity_id}.",
        preview_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "opportunity_id": {"type": "string"},
                "proposal_id": {"type": "string"},
                "proposal_count": {"type": "integer"},
                "first_status": {"type": "string"},
            },
            "required": ["summary", "opportunity_id", "proposal_id", "proposal_count", "first_status"],
            "additionalProperties": False,
        },
        idempotency_support=True,
        side_effect_summary="Creates owner approval intents for proposal negotiation; the proposal is not created, countered, or accepted until the owner approves.",
        jurisdiction="US",
    )


def build_mock_client() -> SiglumeClient:
    proposal_one = {
        "proposal_id": "prop_demo_1",
        "opportunity_id": "opp_demo_1",
        "listing_id": "lst_translation_suite",
        "need_id": "need_translation_ja",
        "seller_agent_id": "agt_seller_translation",
        "buyer_agent_id": DEMO_AGENT_ID,
        "proposal_kind": "proposal",
        "proposed_terms_jsonb": {"delivery_days": 7, "scope": "translation+review", "amount_minor": 25000},
        "status": "draft",
        "reason_codes": ["needs_owner_review"],
        "approval_policy_snapshot_jsonb": {"mode": "owner_review"},
        "delegated_budget_snapshot_jsonb": {"remaining_minor": 50000},
        "explanation": {"summary": "Initial seller proposal pending owner review."},
        "soft_budget_check": {"within_budget": True},
        "created_at": "2026-04-20T08:00:00Z",
        "updated_at": "2026-04-20T08:05:00Z",
    }
    proposal_two = {
        "proposal_id": "prop_demo_2",
        "opportunity_id": "opp_demo_1",
        "listing_id": "lst_translation_suite",
        "need_id": "need_translation_ja",
        "seller_agent_id": "agt_seller_translation",
        "buyer_agent_id": DEMO_AGENT_ID,
        "proposal_kind": "counter",
        "proposed_terms_jsonb": {"delivery_days": 5, "scope": "translation+qa", "amount_minor": 26000},
        "status": "pending_buyer",
        "reason_codes": ["counter_received"],
        "approval_policy_snapshot_jsonb": {"mode": "owner_review"},
        "delegated_budget_snapshot_jsonb": {"remaining_minor": 50000},
        "explanation": {"summary": "Counter proposal waiting for buyer review."},
        "soft_budget_check": {"within_budget": True},
        "created_at": "2026-04-20T09:00:00Z",
        "updated_at": "2026-04-20T09:10:00Z",
    }

    def approval_envelope(
        operation_key: str,
        *,
        intent_id: str,
        preview: dict[str, object],
        trace_id: str,
        request_id: str,
    ) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": {
                    "agent_id": DEMO_AGENT_ID,
                    "status": "approval_required",
                    "approval_required": True,
                    "intent_id": intent_id,
                    "approval_status": "pending_owner",
                    "approval_snapshot_hash": f"snap_{intent_id}",
                    "message": f"{operation_key} requires owner approval.",
                    "action": {
                        "type": "operation",
                        "operation": operation_key,
                        "status": "approval_required",
                        "summary": f"{operation_key} staged for owner review.",
                    },
                    "result": {
                        "preview": preview,
                        "approval_snapshot_hash": f"snap_{intent_id}",
                    },
                    "safety": {"approval_required": True, "actor_scope": "owner"},
                },
                "meta": {"trace_id": trace_id, "request_id": request_id},
                "error": None,
            },
        )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != f"/v1/owner/agents/{DEMO_AGENT_ID}/operations/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        payload = json.loads(request.content.decode("utf-8")) if request.content else {}
        operation = payload.get("operation")
        params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
        if operation == "market.proposals.list":
            assert params.get("status") == "draft"
            assert params.get("limit") == 2
            return httpx.Response(
                200,
                json={
                    "data": {
                        "agent_id": DEMO_AGENT_ID,
                        "message": "Market proposals loaded.",
                        "action": "market_proposals_list",
                        "result": {"items": [proposal_one, proposal_two], "next_cursor": None},
                    },
                    "meta": {"trace_id": "trc_market_proposals_list", "request_id": "req_market_proposals_list"},
                    "error": None,
                },
            )
        if operation == "market.proposals.get":
            assert params.get("proposal_id") == "prop_demo_1"
            return httpx.Response(
                200,
                json={
                    "data": {
                        "agent_id": DEMO_AGENT_ID,
                        "message": "Market proposal loaded.",
                        "action": "market_proposals_get",
                        "result": proposal_one,
                    },
                    "meta": {"trace_id": "trc_market_proposals_get", "request_id": "req_market_proposals_get"},
                    "error": None,
                },
            )
        if operation == "market.proposals.create":
            return approval_envelope(
                "market.proposals.create",
                intent_id="intent_prop_create_1",
                preview={
                    "opportunity_id": params.get("opportunity_id"),
                    "proposal_kind": params.get("proposal_kind"),
                    "amount_minor": params.get("amount_minor"),
                },
                trace_id="trc_market_proposals_create",
                request_id="req_market_proposals_create",
            )
        if operation == "market.proposals.counter":
            return approval_envelope(
                "market.proposals.counter",
                intent_id="intent_prop_counter_1",
                preview={
                    "proposal_id": params.get("proposal_id"),
                    "proposal_kind": params.get("proposal_kind"),
                },
                trace_id="trc_market_proposals_counter",
                request_id="req_market_proposals_counter",
            )
        if operation == "market.proposals.accept":
            return approval_envelope(
                "market.proposals.accept",
                intent_id="intent_prop_accept_1",
                preview={"proposal_id": params.get("proposal_id"), "comment": params.get("comment")},
                trace_id="trc_market_proposals_accept",
                request_id="req_market_proposals_accept",
            )
        raise AssertionError(f"Unexpected operation payload: {payload}")

    return SiglumeClient(
        api_key="sig_mock_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


async def run_market_proposals_example() -> list[str]:
    harness = AppTestHarness(MarketProposalsWrapperApp())
    manual = build_tool_manual()
    ok, issues = validate_tool_manual(manual)
    report = score_tool_manual_offline(manual)
    dry_run = await harness.dry_run(
        task_type="stage_market_proposal_negotiation",
        input_params={"opportunity_id": "opp_demo_1", "proposal_id": "prop_demo_1"},
    )
    action = await harness.execute_action(
        task_type="stage_market_proposal_negotiation",
        input_params={"opportunity_id": "opp_demo_1", "proposal_id": "prop_demo_1"},
    )
    return [
        f"tool_manual_valid: {ok} {len(issues)}",
        f"quality_grade: {report.grade} {report.overall_score}",
        f"proposals_loaded: {dry_run.output.get('proposal_count', 0)} first={dry_run.output.get('proposal_id', '')}",
        f"dry_run: {dry_run.success}",
        f"action: {action.success}",
        f"approval_intents: {'|'.join(action.output.get('approval_intent_ids', []))}",
        f"summary: {action.output.get('summary', '')}",
    ]


async def main() -> None:
    for line in await run_market_proposals_example():
        print(line)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
