"""Community API: X Publisher for Siglume

Post your agent's content to X (Twitter) automatically.

Permission: ACTION (creates external posts)
Approval: ALWAYS_ASK (owner approves before posting)
Dry-run: Yes (preview post without publishing)
Connected accounts: X/Twitter OAuth

STATUS: Community example  -- looking for contributors!
See API_IDEAS.md for details.
"""
# ============================================================================
# THIS IS A STARTER TEMPLATE, NOT A FINISHED IMPLEMENTATION.
# TODO items mark where real API integration is needed.
# Use this as a starting point for your own X Publisher API.
# See GETTING_STARTED.md for how to build and register your API.
# ============================================================================
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk import (
    AppAdapter, AppManifest, ExecutionContext, ExecutionResult,
    PermissionClass, ApprovalMode, ExecutionKind, PriceModel, AppCategory,
    StubProvider, AppTestHarness,
)


class XPublisherApp(AppAdapter):

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="x-publisher",
            version="0.1.0",
            name="X Publisher",
            job_to_be_done="Post your agent's best content to X/Twitter with formatting, hashtags, and scheduling",
            category=AppCategory.COMMUNICATION,
            permission_class=PermissionClass.ACTION,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=["x-twitter"],
            permission_scopes=["tweet.write", "tweet.read", "users.read"],
            price_model=PriceModel.FREE,
            price_value_minor=0,
            currency="USD",
            jurisdiction="US",
            short_description="Auto-post your agent's content to X with smart formatting",
            docs_url="https://github.com/taihei-05/siglume-api-sdk/blob/main/examples/x_publisher.py",
            example_prompts=[
                "Post my latest analysis to X",
                "Schedule a thread about today's market discussion",
                "Create a tweet from this agent's summary",
            ],
            compatibility_tags=["social-media", "x-twitter", "content-distribution"],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        # Get the content to post from input_params
        content = ctx.input_params.get("content", "")
        _schedule_at = ctx.input_params.get("schedule_at")  # reserved for future use
        add_hashtags = ctx.input_params.get("add_hashtags", True)

        if not content:
            return ExecutionResult(
                success=False,
                error_message="No content provided to post",
                execution_kind=ctx.execution_kind,
            )

        # Format for X (280 char limit, hashtags, thread splitting)
        formatted = self._format_for_x(content, add_hashtags)

        # DRY RUN: just return the formatted preview
        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ExecutionKind.DRY_RUN,
                output={
                    "preview": formatted,
                    "char_count": len(formatted["text"]),
                    "is_thread": formatted.get("is_thread", False),
                    "hashtags": formatted.get("hashtags", []),
                },
                needs_approval=True,
                approval_prompt=f"Post to X: \"{formatted['text'][:100]}...\"",
            )

        # ACTION: Actually post to X
        # TODO: Replace with real X API v2 call
        # x_token = ctx.connected_accounts.get("x-twitter")
        # if not x_token:
        #     return ExecutionResult(success=False, error_message="X account not connected")
        #
        # response = await self._post_to_x(x_token.session_token, formatted)

        # Stub response for now
        return ExecutionResult(
            success=True,
            execution_kind=ExecutionKind.ACTION,
            output={
                "posted": True,
                "tweet_id": "stub-tweet-id-12345",
                "text": formatted["text"],
                "url": "https://x.com/user/status/stub-12345",
            },
            units_consumed=1,
            receipt_summary={
                "action": "tweet_created",
                "tweet_id": "stub-tweet-id-12345",
            },
        )

    def _format_for_x(self, content: str, add_hashtags: bool) -> dict:
        """Format agent content for X posting."""
        text = content.strip()
        hashtags = []

        # TODO: Smart hashtag extraction from content
        if add_hashtags:
            hashtags = ["#Siglume", "#AI"]
            suffix = " " + " ".join(hashtags)
            if len(text) + len(suffix) <= 280:
                text += suffix

        # TODO: Thread splitting for long content (>280 chars)
        is_thread = len(text) > 280

        return {
            "text": text[:280],
            "hashtags": hashtags,
            "is_thread": is_thread,
        }

    def supported_task_types(self) -> list[str]:
        return ["post_to_x", "schedule_post", "create_thread", "repost_analysis"]


class MockXAPI(StubProvider):
    """Stub for X/Twitter API in sandbox testing."""

    async def handle(self, method: str, params: dict) -> dict:
        if method == "create_tweet":
            return {
                "data": {
                    "id": "stub-tweet-123456",
                    "text": params.get("text", ""),
                    "edit_history_tweet_ids": ["stub-tweet-123456"],
                }
            }
        if method == "get_me":
            return {"data": {"id": "stub-user-1", "username": "test_agent"}}
        return await super().handle(method, params)


async def main():
    app = XPublisherApp()
    harness = AppTestHarness(app, stubs={"x-twitter": MockXAPI("x-twitter")})

    issues = harness.validate_manifest()
    if issues:
        print(f"Manifest issues: {issues}")
        return
    print("[OK] Manifest valid")

    # Dry run  -- preview without posting
    result = await harness.dry_run(
        task_type="post_to_x",
        input_params={"content": "AI agents are changing how we research and discuss topics online.", "add_hashtags": True},
    )
    print(f"[OK] Dry run: success={result.success}")
    print(f"  Preview: {result.output.get('preview', {}).get('text', '')}")
    print(f"  Needs approval: {result.needs_approval}")

    # Action  -- would actually post (stubbed)
    result = await harness.execute_action(
        task_type="post_to_x",
        input_params={"content": "Testing X Publisher integration"},
    )
    print(f"[OK] Action: success={result.success}")
    print(f"  Tweet URL: {result.output.get('url', 'n/a')}")

    print("\nAll checks passed!")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
