"""X Publisher -- post your agent's content to X (Twitter) with owner approval.

A runnable reference implementation built on the Siglume SDK. Ships with a
`MockXAPI` stub so you can exercise the full manifest -> dry-run -> action
lifecycle locally without a real X developer account. To go live, replace
the stubbed POST in `_post_to_x` with an authenticated call against X API v2
using the token from `ctx.connected_accounts["x-twitter"]`.

Permission: ACTION (creates external posts)
Approval:   ALWAYS_ASK (owner approves before each post)
Dry-run:    Yes (preview formatted text + hashtags without publishing)
Accounts:   x-twitter (OAuth 2.0)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk import (
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
    StubProvider,
)


TWEET_MAX = 280
_HASHTAG_WORD_RE = re.compile(r"(?:^|\s)#([A-Za-z0-9_]+)")


class XPublisherApp(AppAdapter):
    """Publish short-form content to X with owner approval and dry-run preview."""

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="x-publisher",
            version="0.1.0",
            name="X Publisher",
            job_to_be_done=(
                "Post your agent's best content to X/Twitter with formatting, "
                "hashtag suggestions, and thread splitting"
            ),
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
            support_contact="https://github.com/taihei-05/siglume-api-sdk/issues",
            example_prompts=[
                "Post my latest analysis to X",
                "Share this agent summary as a thread",
                "Publish today's market note",
            ],
            compatibility_tags=["social-media", "x-twitter", "content-distribution"],
        )

    def __init__(self, x_api: "StubProvider | None" = None) -> None:
        """Accept an injectable X-API stub for sandbox tests; default uses MockXAPI."""
        self._x_api = x_api or MockXAPI("x-twitter")

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        content: str = (ctx.input_params.get("content") or "").strip()
        add_hashtags: bool = bool(ctx.input_params.get("add_hashtags", True))

        if not content:
            return ExecutionResult(
                success=False,
                error_message="No content provided to post",
                execution_kind=ctx.execution_kind,
            )

        formatted = self._format_for_x(content, add_hashtags)

        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ExecutionKind.DRY_RUN,
                output={
                    "preview": formatted,
                    "char_count": len(formatted["text"]),
                    "is_thread": formatted["is_thread"],
                    "hashtags": formatted["hashtags"],
                },
                needs_approval=True,
                approval_prompt=f'Post to X: "{formatted["text"][:100]}..."',
            )

        # Live post. In production, swap `self._x_api` for a real X API v2 client
        # that reads the user's OAuth token from
        #     ctx.connected_accounts["x-twitter"].session_token
        # The MockXAPI stub registered in __init__ stands in during sandbox tests.
        response = await self._x_api.handle("create_tweet", {"text": formatted["text"]})
        tweet_id = response["data"]["id"]
        username = response.get("user", {}).get("username", "agent")
        url = f"https://x.com/{username}/status/{tweet_id}"

        return ExecutionResult(
            success=True,
            execution_kind=ExecutionKind.ACTION,
            output={
                "posted": True,
                "tweet_id": tweet_id,
                "text": formatted["text"],
                "url": url,
                "is_thread": formatted["is_thread"],
            },
            units_consumed=1,
            receipt_summary={
                "action": "tweet_created",
                "tweet_id": tweet_id,
                "url": url,
            },
        )

    def _format_for_x(self, content: str, add_hashtags: bool) -> dict:
        text = content.strip()
        extracted = {f"#{m}" for m in _HASHTAG_WORD_RE.findall(text)}
        hashtags = sorted(extracted)

        if add_hashtags and not hashtags:
            hashtags = ["#Siglume", "#AI"]
            suffix = " " + " ".join(hashtags)
            if len(text) + len(suffix) <= TWEET_MAX:
                text = text + suffix

        is_thread = len(text) > TWEET_MAX
        if is_thread:
            text = text[: TWEET_MAX - 1].rstrip() + "…"

        return {"text": text, "hashtags": hashtags, "is_thread": is_thread}

    def supported_task_types(self) -> list[str]:
        return ["post_to_x", "schedule_post", "create_thread", "repost_analysis"]


class MockXAPI(StubProvider):
    """Mock X API v2 responses so sandbox tests exercise the full action path."""

    async def handle(self, method: str, params: dict) -> dict:
        if method == "create_tweet":
            return {
                "data": {
                    "id": "1800000000000000001",
                    "text": params.get("text", ""),
                    "edit_history_tweet_ids": ["1800000000000000001"],
                },
                "user": {"id": "987654321", "username": "agent"},
            }
        if method == "get_me":
            return {"data": {"id": "987654321", "username": "agent"}}
        return await super().handle(method, params)


async def main() -> None:
    app = XPublisherApp()
    harness = AppTestHarness(app, stubs={"x-twitter": MockXAPI("x-twitter")})

    issues = harness.validate_manifest()
    if issues:
        print(f"Manifest issues: {issues}")
        return
    print("[OK] Manifest valid")

    health = await harness.health()
    print(f"[OK] Health: {health.healthy}")

    dry = await harness.dry_run(
        task_type="post_to_x",
        input_params={
            "content": "AI agents are rewriting how we publish to social. #agents",
            "add_hashtags": True,
        },
    )
    print(f"[OK] Dry run: success={dry.success}, needs_approval={dry.needs_approval}")
    print(f"  Preview: {dry.output['preview']['text']}")
    print(f"  Hashtags: {dry.output['preview']['hashtags']}")

    live = await harness.execute_action(
        task_type="post_to_x",
        input_params={"content": "Testing X Publisher integration via the stub."},
    )
    print(f"[OK] Action: success={live.success}")
    print(f"  Tweet URL: {live.output['url']}")

    print("\n[OK] All checks passed -- this manifest is ready to register.")
    print("")
    print("Next steps to go live on the API Store:")
    print("  1. Register an X developer app, enable OAuth 2.0, and store the")
    print("     client credentials where your runtime fetches them")
    print("  2. Replace `_post_to_x` stub with a real X API v2 call that uses")
    print("     ctx.connected_accounts['x-twitter'].session_token")
    print("  3. Write tool_manual.json -- see GETTING_STARTED.md #13")
    print("  4. Keep oauth_credentials.json and runtime_validation.json local and Git-ignored")
    print("  5. Run: siglume test . && siglume score . --offline")
    print("  6. Deploy, fill runtime_validation.json, then run:")
    print("     siglume validate .")
    print("     siglume score . --remote")
    print("     siglume register . --confirm")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
