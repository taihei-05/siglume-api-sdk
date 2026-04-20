"""Example: propose agent charter / approval / budget updates for owner review.

API: first-party owner operation wrapper for agent behavior governance.
Intended user: owners or automation builders who want to tune an agent safely.
Connected account: none.
"""
from __future__ import annotations

import sys
from pathlib import Path

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
    ToolManual,
    ToolManualPermissionClass,
    score_tool_manual_offline,
    validate_tool_manual,
)


class AgentBehaviorApp(AppAdapter):
    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="agent-behavior",
            name="Agent Behavior Governance",
            job_to_be_done="Prepare owner-reviewed charter, approval-policy, and budget updates for an agent.",
            category=AppCategory.OTHER,
            permission_class=PermissionClass.ACTION,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Preview owner-governed behavior changes before creating an approval proposal.",
            example_prompts=["Propose a stricter approval policy for my travel-buying agent."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        agent_id = str(ctx.input_params.get("agent_id") or "agt_owner_demo")
        charter_text = str(
            ctx.input_params.get("charter_text")
            or "Prioritize approval-safe bookings, explain trade-offs clearly, and stay within the delegated budget."
        )
        auto_approve_below_jpy = int(ctx.input_params.get("auto_approve_below_jpy") or 3000)
        period_limit_minor = int(ctx.input_params.get("period_limit_minor") or 50000)
        preview = {
            "summary": f"Would ask the owner to update charter / approval / budget for {agent_id}.",
            "agent_id": agent_id,
            "charter_text": charter_text,
            "auto_approve_below_jpy": auto_approve_below_jpy,
            "period_limit_minor": period_limit_minor,
        }

        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output=preview,
                needs_approval=True,
                approval_prompt=f"Create an owner-review proposal for agent {agent_id}.",
                approval_hint=ApprovalRequestHint(
                    action_summary=f"Propose governance changes for {agent_id}",
                    permission_class="action",
                    side_effects=["Creates an owner-review proposal; does not update the live agent until approved."],
                    preview=preview,
                    reversible=True,
                ),
            )

        proposal_id = f"proposal_{agent_id}"
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": f"Created an owner-review proposal for {agent_id}.",
                "proposal_id": proposal_id,
                "agent_id": agent_id,
                "charter_text": charter_text,
                "auto_approve_below_jpy": auto_approve_below_jpy,
                "period_limit_minor": period_limit_minor,
            },
            receipt_summary={
                "action": "owner_governance_proposal_created",
                "proposal_id": proposal_id,
                "agent_id": agent_id,
            },
            artifacts=[
                ExecutionArtifact(
                    artifact_type="owner_operation_proposal",
                    external_id=proposal_id,
                    title=f"Governance proposal for {agent_id}",
                    summary="Owner-reviewed proposal covering charter, approval policy, and delegated budget.",
                )
            ],
            side_effects=[
                SideEffectRecord(
                    action="owner_governance_proposal_created",
                    provider="siglume-owner-operations",
                    external_id=proposal_id,
                    reversible=True,
                    reversal_hint="Discard the pending proposal before the owner approves it.",
                    metadata={
                        "agent_id": agent_id,
                        "auto_approve_below_jpy": auto_approve_below_jpy,
                        "period_limit_minor": period_limit_minor,
                    },
                )
            ],
        )

    def supported_task_types(self) -> list[str]:
        return ["propose_agent_behavior"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="agent_behavior_governance",
        job_to_be_done="Prepare an owner-reviewed proposal that updates an agent's charter, approval policy, and delegated budget.",
        summary_for_model="Previews governance changes for an owned agent and creates a proposal only after the owner reviews the preview.",
        trigger_conditions=[
            "owner asks to tighten or loosen how their agent makes purchasing or action decisions",
            "agent needs a formal proposal to change charter text, approval thresholds, or delegated budget limits",
            "request is about governed behavior updates rather than immediately executing an external purchase or write",
        ],
        do_not_use_when=[
            "the owner wants to execute a marketplace action directly instead of changing agent governance",
            "the agent_id does not belong to the approving owner",
        ],
        permission_class=ToolManualPermissionClass.ACTION,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "agent_id": {"type": "string", "description": "Owned agent identifier."},
                "charter_text": {"type": "string", "description": "Short prose charter update to store in the proposal."},
                "auto_approve_below_jpy": {
                    "type": "integer",
                    "description": "Auto-approval threshold in JPY minor units for the proposal preview.",
                    "default": 3000,
                },
                "period_limit_minor": {
                    "type": "integer",
                    "description": "Delegated monthly budget limit in minor units.",
                    "default": 50000,
                },
            },
            "required": ["agent_id", "charter_text"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line proposal outcome summary."},
                "proposal_id": {"type": "string", "description": "Proposal identifier for owner review."},
                "agent_id": {"type": "string", "description": "Owned agent targeted by the proposal."},
            },
            "required": ["summary", "proposal_id", "agent_id"],
            "additionalProperties": False,
        },
        usage_hints=["Use dry_run first so the owner can review the charter text and policy thresholds before the proposal is created."],
        result_hints=["Report the proposal_id and the targeted agent_id so the owner can review or discard the proposal later."],
        error_hints=["If the owner has not chosen an agent yet, ask for the specific agent_id before retrying."],
        approval_summary_template="Create an owner governance proposal for {agent_id}.",
        preview_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Preview of the governance proposal."},
                "agent_id": {"type": "string", "description": "Owned agent identifier."},
                "charter_text": {"type": "string", "description": "Charter prose preview."},
                "auto_approve_below_jpy": {"type": "integer", "description": "Approval threshold preview."},
                "period_limit_minor": {"type": "integer", "description": "Budget limit preview."},
            },
            "required": ["summary", "agent_id", "charter_text", "auto_approve_below_jpy", "period_limit_minor"],
            "additionalProperties": False,
        },
        idempotency_support=True,
        side_effect_summary="Creates a reviewable governance proposal; live charter and policy updates still require owner approval.",
        jurisdiction="US",
        legal_notes="Only the approving owner may apply charter, approval-policy, or budget changes to the targeted agent.",
    )


async def run_agent_behavior_example() -> list[str]:
    harness = AppTestHarness(AgentBehaviorApp())
    manual = build_tool_manual()
    ok, issues = validate_tool_manual(manual)
    report = score_tool_manual_offline(manual)
    dry_run = await harness.dry_run(
        task_type="propose_agent_behavior",
        input_params={"agent_id": "agt_owner_demo", "charter_text": "Prefer capped travel spend and explicit approval for non-routine purchases."},
    )
    action = await harness.execute_action(
        task_type="propose_agent_behavior",
        input_params={"agent_id": "agt_owner_demo", "charter_text": "Prefer capped travel spend and explicit approval for non-routine purchases."},
    )
    return [
        f"tool_manual_valid: {ok} {len(issues)}",
        f"quality_grade: {report.grade} {report.overall_score}",
        f"dry_run: {dry_run.success}",
        f"action: {action.success}",
        f"proposal_preview: {dry_run.output.get('summary', '')}",
        f"receipt_issues: {len(harness.validate_receipt(action))}",
    ]


async def main() -> None:
    for line in await run_agent_behavior_example():
        print(line)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
