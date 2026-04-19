"""Example: create a calendar event with preview + approval."""
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
    ExecutionContext,
    ExecutionKind,
    ExecutionResult,
    PermissionClass,
    PriceModel,
    ToolManual,
    ToolManualPermissionClass,
    validate_tool_manual,
)


class CalendarSyncApp(AppAdapter):
    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="calendar-sync",
            name="Calendar Sync",
            job_to_be_done="Create calendar events from an owner-approved schedule request.",
            category=AppCategory.BOOKING,
            permission_class=PermissionClass.ACTION,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=["google-calendar"],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Preview and create Google Calendar events after owner approval.",
            example_prompts=["Create a calendar event for tomorrow's planning meeting."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        title = str(ctx.input_params.get("title") or "Planning meeting")
        start_iso = str(ctx.input_params.get("start_iso") or "2026-04-20T09:00:00Z")
        calendar = str(ctx.input_params.get("calendar") or "primary")
        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output={"summary": f"Would create '{title}' on {start_iso}.", "calendar": calendar},
                needs_approval=True,
                approval_prompt=f"Create calendar event '{title}' on {start_iso} in {calendar}.",
            )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={"summary": f"Created calendar event '{title}'.", "event_id": "evt_123", "calendar": calendar},
            units_consumed=1,
            receipt_summary={"action": "calendar_event_created", "event_id": "evt_123", "calendar": calendar},
        )

    def supported_task_types(self) -> list[str]:
        return ["create_calendar_event", "schedule_meeting"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="calendar_sync",
        job_to_be_done="Create a calendar event in the owner's connected calendar after preview and approval.",
        summary_for_model="Previews a calendar event and then creates it in the owner's connected calendar after approval.",
        trigger_conditions=[
            "owner asks to create a calendar event with a title and date or time",
            "agent needs to schedule a meeting on the owner's calendar after getting approval",
            "request is to turn a proposed time into an actual calendar entry",
        ],
        do_not_use_when=[
            "the owner only wants a suggested schedule and does not want any calendar write",
            "the request is to send email or update a non-calendar system",
        ],
        permission_class=ToolManualPermissionClass.ACTION,
        dry_run_supported=True,
        requires_connected_accounts=["google-calendar"],
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Calendar event title."},
                "start_iso": {"type": "string", "description": "Start time in ISO 8601 format."},
                "calendar": {"type": "string", "description": "Calendar identifier to create the event in.", "default": "primary"},
            },
            "required": ["title", "start_iso"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line summary of the created event."},
                "event_id": {"type": "string", "description": "Calendar-provider event ID."},
                "calendar": {"type": "string", "description": "Calendar that received the event."},
            },
            "required": ["summary", "event_id", "calendar"],
            "additionalProperties": False,
        },
        usage_hints=["Use a dry run first so the owner can verify the title and time before the event is created."],
        result_hints=["Show the event_id and calendar after creation so the owner can cross-check the target calendar."],
        error_hints=["If the requested time is unclear, ask for a concrete date or ISO timestamp before retrying."],
        approval_summary_template="Create calendar event '{title}' on {start_iso}.",
        preview_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Preview of the calendar event that will be created."},
            },
            "required": ["summary"],
            "additionalProperties": False,
        },
        idempotency_support=True,
        side_effect_summary="Creates a calendar event in the owner's connected calendar.",
        jurisdiction="US",
    )


async def main() -> None:
    harness = AppTestHarness(CalendarSyncApp())
    ok, issues = validate_tool_manual(build_tool_manual())
    print("tool_manual_valid:", ok, len(issues))
    print("manifest_issues:", harness.validate_manifest())
    print("dry_run:", (await harness.dry_run(task_type="create_calendar_event", input_params={"title": "Planning meeting"})).success)
    print("action:", (await harness.execute_action(task_type="create_calendar_event", input_params={"title": "Planning meeting"})).success)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
