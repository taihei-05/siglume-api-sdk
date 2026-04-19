"""Example: translate text across languages without side effects."""
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
    ExecutionResult,
    PermissionClass,
    PriceModel,
    ToolManual,
    ToolManualPermissionClass,
    validate_tool_manual,
)


class TranslationHubApp(AppAdapter):
    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="translation-hub",
            name="Translation Hub",
            job_to_be_done="Translate owner-provided text into a requested target language.",
            category=AppCategory.DOCUMENT,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Translate text across languages and return a concise summary of the result.",
            example_prompts=["Translate this release note into Japanese."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        text = str(ctx.input_params.get("text") or "Hello world")
        target_language = str(ctx.input_params.get("target_language") or "ja")
        translated = f"[{target_language}] {text}"
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={"summary": f"Translated text into {target_language}.", "translated_text": translated, "target_language": target_language},
            units_consumed=1,
        )

    def supported_task_types(self) -> list[str]:
        return ["translate_text", "localize_copy"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="translation_hub",
        job_to_be_done="Translate input text into a requested target language and return the translated text with a concise summary.",
        summary_for_model="Translates owner-provided text into a requested language and returns the translated output without side effects.",
        trigger_conditions=[
            "owner asks to translate text into a specific language",
            "agent needs localized copy before presenting or publishing content",
            "request is to rewrite content across languages without sending it anywhere",
        ],
        do_not_use_when=[
            "the request is to send the translated text through email or another action tool",
            "the owner needs legal advice instead of a language translation",
        ],
        permission_class=ToolManualPermissionClass.READ_ONLY,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Source text to translate."},
                "target_language": {"type": "string", "description": "Target language code or name, such as ja or Japanese."},
            },
            "required": ["text", "target_language"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line summary of the translation result."},
                "translated_text": {"type": "string", "description": "Translated output text."},
                "target_language": {"type": "string", "description": "Language the text was translated into."},
            },
            "required": ["summary", "translated_text", "target_language"],
            "additionalProperties": False,
        },
        usage_hints=["Use this tool when the owner wants translated text returned in chat with no external write."],
        result_hints=["Show the translated_text first, then mention the target_language in the summary."],
        error_hints=["If the target language is ambiguous, ask the owner to clarify the language before retrying."],
    )


async def main() -> None:
    harness = AppTestHarness(TranslationHubApp())
    ok, issues = validate_tool_manual(build_tool_manual())
    print("tool_manual_valid:", ok, len(issues))
    print("manifest_issues:", harness.validate_manifest())
    print("dry_run:", (await harness.dry_run(task_type="translate_text", input_params={"text": "Hello", "target_language": "ja"})).success)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
