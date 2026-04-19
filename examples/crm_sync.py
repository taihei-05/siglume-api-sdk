"""Example: sync a CRM lead record with preview + approval.

API: CRM lead upsert for revenue and sales operations workflows.
Intended user: operators or agent builders who need to create or refresh leads.
Connected account: hubspot.
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
    ExecutionArtifact,
    ExecutionContext,
    ExecutionKind,
    ExecutionResult,
    PermissionClass,
    PriceModel,
    SideEffectRecord,
    StubProvider,
    ToolManual,
    ToolManualPermissionClass,
    score_tool_manual_offline,
    validate_tool_manual,
)


class CrmSyncApp(AppAdapter):
    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="crm-sync",
            name="CRM Sync",
            job_to_be_done="Create or update CRM lead records after the owner approves the write.",
            category=AppCategory.CRM,
            permission_class=PermissionClass.ACTION,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=["hubspot"],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Preview and upsert HubSpot lead records with explicit approval.",
            example_prompts=["Sync this inbound contact into HubSpot as a lead."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        external_id = str(ctx.input_params.get("external_id") or "lead-ext-1001")
        full_name = str(ctx.input_params.get("full_name") or "Avery Stone")
        email = str(ctx.input_params.get("email") or "avery.stone@example.com")
        company = str(ctx.input_params.get("company") or "Northwind Labs")
        notes = str(ctx.input_params.get("notes") or "Qualified inbound lead from pricing page.")
        lead_id = f"hubspot_{external_id.replace('-', '_')}"
        preview = {
            "summary": f"Would sync lead {full_name} ({email}) to HubSpot.",
            "external_id": external_id,
            "full_name": full_name,
            "email": email,
            "company": company,
        }
        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output=preview,
                needs_approval=True,
                approval_prompt=f"Sync CRM lead {external_id} for {email} into HubSpot.",
            )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": f"Synced HubSpot lead {full_name}.",
                "lead_id": lead_id,
                "external_id": external_id,
                "provider": "hubspot",
                "notes": notes,
            },
            receipt_summary={
                "action": "crm_lead_upserted",
                "lead_id": lead_id,
                "external_id": external_id,
                "provider": "hubspot",
            },
            artifacts=[
                ExecutionArtifact(
                    artifact_type="crm_lead",
                    external_id=lead_id,
                    title=full_name,
                    summary=f"CRM lead record for {email}",
                )
            ],
            side_effects=[
                SideEffectRecord(
                    action="crm_lead_upserted",
                    provider="hubspot",
                    external_id=lead_id,
                    reversible=True,
                    reversal_hint="Archive the lead record in HubSpot if it was created in error.",
                    metadata={"external_id": external_id, "company": company},
                )
            ],
        )

    def supported_task_types(self) -> list[str]:
        return ["sync_crm_lead", "create_crm_lead"]


def build_stubs() -> dict[str, StubProvider]:
    return {"hubspot": StubProvider("hubspot")}


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="crm_sync",
        job_to_be_done="Create or update a CRM lead record in HubSpot after the owner reviews the lead preview.",
        summary_for_model="Previews a HubSpot lead upsert and then writes the lead only after explicit owner approval.",
        trigger_conditions=[
            "owner asks to create or update a CRM lead after collecting contact information",
            "agent needs to push a qualified inbound lead into HubSpot with an external_id for dedupe",
            "request is to sync contact details into CRM rather than only summarize the lead",
        ],
        do_not_use_when=[
            "the owner only wants a draft message or notes without writing any CRM record",
            "the contact has not consented to being stored in the CRM system",
        ],
        permission_class=ToolManualPermissionClass.ACTION,
        dry_run_supported=True,
        requires_connected_accounts=["hubspot"],
        input_schema={
            "type": "object",
            "properties": {
                "external_id": {"type": "string", "description": "Stable dedupe key for the lead."},
                "full_name": {"type": "string", "description": "Lead full name."},
                "email": {"type": "string", "description": "Lead email address."},
                "company": {"type": "string", "description": "Company name.", "default": ""},
                "notes": {"type": "string", "description": "Qualification notes.", "default": ""},
            },
            "required": ["external_id", "full_name", "email"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line outcome summary."},
                "lead_id": {"type": "string", "description": "HubSpot lead identifier."},
                "external_id": {"type": "string", "description": "Caller-provided dedupe key."},
                "provider": {"type": "string", "description": "CRM provider that received the write."},
            },
            "required": ["summary", "lead_id", "external_id", "provider"],
            "additionalProperties": False,
        },
        usage_hints=["Use dry_run first so the owner can verify the contact details before the CRM write happens."],
        result_hints=["Show both the HubSpot lead_id and external_id so follow-up automations can reuse the same record."],
        error_hints=["If contact details are incomplete, ask for the missing email or full_name before retrying."],
        approval_summary_template="Sync CRM lead {external_id} for {email}.",
        preview_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Preview of the CRM write."},
                "external_id": {"type": "string", "description": "Lead dedupe key."},
                "full_name": {"type": "string", "description": "Lead full name."},
                "email": {"type": "string", "description": "Lead email address."},
            },
            "required": ["summary", "external_id", "full_name", "email"],
            "additionalProperties": False,
        },
        idempotency_support=True,
        side_effect_summary="Creates or updates a lead record in HubSpot using the provided external_id as the dedupe key.",
        jurisdiction="US",
        legal_notes="Only sync personal data that the approving owner is authorized to store in HubSpot.",
    )


async def main() -> None:
    harness = AppTestHarness(CrmSyncApp(), stubs=build_stubs())
    ok, issues = validate_tool_manual(build_tool_manual())
    report = score_tool_manual_offline(build_tool_manual())
    dry_run = await harness.dry_run(task_type="sync_crm_lead")
    action = await harness.execute_action(task_type="sync_crm_lead")
    print("tool_manual_valid:", ok, len(issues))
    print("quality_grade:", report.grade, report.overall_score)
    print("manifest_issues:", harness.validate_manifest())
    print("dry_run:", dry_run.success)
    print("action:", action.success)
    print("receipt_issues:", len(harness.validate_receipt(action)))


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
