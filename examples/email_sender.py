"""Example: send an email with preview, approval, and idempotency hints."""
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


class EmailSenderApp(AppAdapter):
    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="email-sender",
            name="Email Sender",
            job_to_be_done="Draft and send an email after the owner approves the final content.",
            category=AppCategory.COMMUNICATION,
            permission_class=PermissionClass.ACTION,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=["gmail"],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Preview and send email messages with explicit owner approval.",
            example_prompts=["Send a follow-up email to the customer with the meeting recap."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        recipient = str(ctx.input_params.get("recipient") or "user@example.com")
        subject = str(ctx.input_params.get("subject") or "Follow-up")
        body = str(ctx.input_params.get("body") or "Thanks for your time.")
        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output={"summary": f"Would send '{subject}' to {recipient}.", "recipient": recipient},
                needs_approval=True,
                approval_prompt=f"Send email '{subject}' to {recipient}.",
            )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={"summary": f"Sent '{subject}' to {recipient}.", "recipient": recipient, "message_id": "msg_123"},
            units_consumed=1,
            receipt_summary={"action": "email_sent", "recipient": recipient, "message_id": "msg_123", "body": body},
        )

    def supported_task_types(self) -> list[str]:
        return ["send_email", "draft_and_send_email"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="email_sender",
        job_to_be_done="Send an email message to a specified recipient after preview and explicit owner approval.",
        summary_for_model="Previews an email draft and sends it after owner approval using the owner's connected email account.",
        trigger_conditions=[
            "owner asks to send an email to a specific recipient with a subject or message body",
            "agent has already prepared email content and now needs approval before sending it",
            "request is to deliver a written message through email rather than chat or calendar",
        ],
        do_not_use_when=[
            "the owner only wants a draft and does not want the email to be sent yet",
            "the request is to send a chat message or calendar invite instead of email",
        ],
        permission_class=ToolManualPermissionClass.ACTION,
        dry_run_supported=True,
        requires_connected_accounts=["gmail"],
        input_schema={
            "type": "object",
            "properties": {
                "recipient": {"type": "string", "description": "Email address of the recipient."},
                "subject": {"type": "string", "description": "Email subject line."},
                "body": {"type": "string", "description": "Email body text to send."},
            },
            "required": ["recipient", "subject", "body"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line summary of the email send result."},
                "recipient": {"type": "string", "description": "Recipient that received the email."},
                "message_id": {"type": "string", "description": "Provider-side message identifier."},
            },
            "required": ["summary", "recipient", "message_id"],
            "additionalProperties": False,
        },
        usage_hints=["Always use a dry run first so the owner can review the recipient, subject, and body before sending."],
        result_hints=["Show the recipient and message_id after sending so the owner can audit the outgoing email."],
        error_hints=["If the email address is invalid, ask for a corrected recipient before retrying."],
        approval_summary_template="Send email '{subject}' to {recipient}.",
        preview_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Preview of the email that will be sent."},
            },
            "required": ["summary"],
            "additionalProperties": False,
        },
        idempotency_support=True,
        side_effect_summary="Sends an email from the owner's connected mailbox to the specified recipient.",
        jurisdiction="US",
    )


async def main() -> None:
    harness = AppTestHarness(EmailSenderApp())
    ok, issues = validate_tool_manual(build_tool_manual())
    print("tool_manual_valid:", ok, len(issues))
    print("manifest_issues:", harness.validate_manifest())
    print("dry_run:", (await harness.dry_run(task_type="send_email", input_params={"recipient": "user@example.com"})).success)
    print("action:", (await harness.execute_action(task_type="send_email", input_params={"recipient": "user@example.com"})).success)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
