"""Example: aggregate recent news into a topic digest.

API: read-only topic digest over public news feeds.
Intended user: researchers, assistants, or monitoring agents.
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
    ExecutionContext,
    ExecutionResult,
    PermissionClass,
    PriceModel,
    ToolManual,
    ToolManualPermissionClass,
    score_tool_manual_offline,
    validate_tool_manual,
)


class NewsDigestApp(AppAdapter):
    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="news-digest",
            name="News Digest",
            job_to_be_done="Summarize recent public news articles for a topic without any external side effects.",
            category=AppCategory.MONITORING,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Collect and summarize public news articles for a requested topic.",
            example_prompts=["Give me a 3-day digest of news about AI agents."],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        topic = str(ctx.input_params.get("topic") or "AI agents")
        lookback_days = int(ctx.input_params.get("lookback_days") or 3)
        articles = [
            {
                "title": f"{topic}: enterprise adoption accelerates",
                "source": "Example Wire",
                "published_at": "2026-04-18",
                "url": "https://news.example.test/enterprise-adoption",
            },
            {
                "title": f"{topic}: new tooling reduces agent evaluation time",
                "source": "Signal Post",
                "published_at": "2026-04-17",
                "url": "https://news.example.test/eval-speedup",
            },
            {
                "title": f"{topic}: builders focus on safer approval flows",
                "source": "Daily Runtime",
                "published_at": "2026-04-16",
                "url": "https://news.example.test/approval-flows",
            },
        ]
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": f"Found {len(articles)} notable {topic} stories from the last {lookback_days} days.",
                "articles": articles,
                "topic": topic,
            },
        )

    def supported_task_types(self) -> list[str]:
        return ["news_digest", "monitor_topic"]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="news_digest",
        job_to_be_done="Collect recent public news coverage for a topic and return a concise digest with article links.",
        summary_for_model="Searches recent public news coverage for a topic and returns a structured digest with article metadata and a concise summary.",
        trigger_conditions=[
            "owner asks for a recent digest of public news on a specific topic",
            "agent needs fresh article coverage before summarizing market or product movement",
            "request is to monitor or brief recent headlines without contacting any private account",
        ],
        do_not_use_when=[
            "the request is to publish, email, or otherwise write back to an external system",
            "the owner needs private or paywalled sources that are not part of the configured public feed",
        ],
        permission_class=ToolManualPermissionClass.READ_ONLY,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "Topic to monitor in public news coverage."},
                "lookback_days": {
                    "type": "integer",
                    "description": "How many days of recent news to scan.",
                    "default": 3,
                },
            },
            "required": ["topic"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line digest summary."},
                "articles": {
                    "type": "array",
                    "description": "Recent articles returned for the requested topic.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "source": {"type": "string"},
                            "published_at": {"type": "string"},
                            "url": {"type": "string"},
                        },
                        "required": ["title", "source", "published_at", "url"],
                        "additionalProperties": False,
                    },
                },
                "topic": {"type": "string", "description": "Topic that was queried."},
            },
            "required": ["summary", "articles", "topic"],
            "additionalProperties": False,
        },
        usage_hints=["Use this tool when the owner wants a recent public-news briefing before making a decision."],
        result_hints=["Lead with the digest summary, then cite the most relevant article titles and sources."],
        error_hints=["If the topic is too broad, ask for a narrower company, product, or sector focus."],
    )


async def main() -> None:
    harness = AppTestHarness(NewsDigestApp())
    ok, issues = validate_tool_manual(build_tool_manual())
    report = score_tool_manual_offline(build_tool_manual())
    dry_run = await harness.dry_run(task_type="news_digest")
    print("tool_manual_valid:", ok, len(issues))
    print("quality_grade:", report.grade, report.overall_score)
    print("manifest_issues:", harness.validate_manifest())
    print("dry_run:", dry_run.success)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
