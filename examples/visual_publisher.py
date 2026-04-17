"""Community API: Visual Publisher for Siglume

Generate images from your agent's content and post them to X/Twitter.

Permission: ACTION (generates images and creates external posts)
Approval: ALWAYS_ASK (owner approves before posting)
Dry-run: Yes (generates image preview without posting)
Connected accounts: X/Twitter OAuth + OpenAI (DALL-E)

STATUS: Community example  -- looking for contributors!
See API_IDEAS.md for details.
"""
# ============================================================================
# THIS IS A STARTER TEMPLATE, NOT A FINISHED IMPLEMENTATION.
# TODO items mark where real image generation and X API calls are needed.
# Use this as a starting point for your own Visual Publisher API.
# See GETTING_STARTED.md for how to build and register your API.
# ============================================================================
from __future__ import annotations

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk import (
    AppAdapter, AppManifest, ExecutionContext, ExecutionResult,
    PermissionClass, ApprovalMode, ExecutionKind, PriceModel, AppCategory,
    StubProvider, AppTestHarness,
)


class VisualPublisherApp(AppAdapter):

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="visual-publisher",
            version="0.1.0",
            name="Visual Publisher",
            job_to_be_done="Generate images from agent content and post them to X/Twitter with alt text",
            category=AppCategory.COMMUNICATION,
            permission_class=PermissionClass.ACTION,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=["x-twitter", "openai"],
            permission_scopes=[
                "tweet.write", "tweet.read", "users.read",  # X scopes
                "images.generate",                           # OpenAI scope
            ],
            price_model=PriceModel.FREE,
            price_value_minor=0,
            currency="USD",
            jurisdiction="US",
            short_description="Turn your agent's ideas into images and post them to X",
            docs_url="https://github.com/taihei-05/siglume-api-sdk/blob/main/examples/visual_publisher.py",
            example_prompts=[
                "Create an illustration of today's discussion and post it",
                "Generate a visual summary of this thread for X",
                "Make a chart image from this data and tweet it",
            ],
            compatibility_tags=["social-media", "x-twitter", "image-generation", "dall-e"],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        prompt = ctx.input_params.get("prompt", "")
        alt_text = ctx.input_params.get("alt_text", "")
        caption = ctx.input_params.get("caption", "")
        style = ctx.input_params.get("style", "natural")  # natural, vivid, etc.
        size = ctx.input_params.get("size", "1024x1024")

        if not prompt:
            return ExecutionResult(
                success=False,
                error_message="No image prompt provided",
                execution_kind=ctx.execution_kind,
            )

        # Step 1: Generate image
        image_result = await self._generate_image(ctx, prompt, style, size)
        if not image_result["success"]:
            return ExecutionResult(
                success=False,
                error_message=image_result.get("error", "Image generation failed"),
                execution_kind=ctx.execution_kind,
            )

        # Step 2: Generate alt text if not provided
        if not alt_text:
            alt_text = self._generate_alt_text(prompt)

        # DRY RUN: return preview without posting
        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ExecutionKind.DRY_RUN,
                output={
                    "image_url": image_result["url"],
                    "image_size": size,
                    "alt_text": alt_text,
                    "caption_preview": caption[:280] if caption else "(no caption)",
                    "estimated_cost_minor": 50,
                },
                needs_approval=True,
                approval_prompt=(
                    f"Generate image and post to X.\n"
                    f"  Prompt: \"{prompt[:80]}...\"\n"
                    f"  Caption: \"{caption[:80]}...\"\n"
                    f"  No charge (free API)"
                ),
            )

        # ACTION: Generate and post
        # TODO: Upload image to X media endpoint before creating tweet
        # x_token = ctx.connected_accounts.get("x-twitter")
        # if not x_token:
        #     return ExecutionResult(success=False, error_message="X account not connected")
        #
        # media_id = await self._upload_media(x_token.session_token, image_result["data"])
        # tweet = await self._create_tweet_with_media(
        #     x_token.session_token, caption, media_id, alt_text
        # )

        return ExecutionResult(
            success=True,
            execution_kind=ExecutionKind.ACTION,
            output={
                "posted": True,
                "tweet_id": "stub-tweet-img-789",
                "image_url": image_result["url"],
                "alt_text": alt_text,
                "caption": caption[:280],
                "url": "https://x.com/user/status/stub-img-789",
            },
            units_consumed=1,
            amount_minor=50,
            receipt_summary={
                "action": "visual_tweet_created",
                "tweet_id": "stub-tweet-img-789",
                "image_generated": True,
            },
        )

    async def _generate_image(
        self, ctx: ExecutionContext, prompt: str, style: str, size: str
    ) -> dict:
        """Generate an image using the connected image generation API.

        TODO: Replace with real DALL-E 3 / Stable Diffusion API call.
        Real implementation should:
          1. Get the openai ConnectedAccountRef from ctx.connected_accounts
          2. Call POST https://api.openai.com/v1/images/generations
          3. Handle rate limits and content policy rejections
          4. Return the image URL or base64 data

        TODO: Add support for multiple providers (DALL-E, Stable Diffusion,
              Midjourney) via a provider_preference input param.
        """
        # Stub: return a placeholder image result
        return {
            "success": True,
            "url": f"https://stub-images.siglume.dev/generated/{hash(prompt) % 10000}.png",
            "revised_prompt": prompt,
            "model": "dall-e-3-stub",
        }

    def _generate_alt_text(self, prompt: str) -> str:
        """Generate accessible alt text from the image prompt.

        TODO: Use a vision model to describe the actual generated image
              instead of deriving alt text from the prompt alone.
        """
        return f"AI-generated image: {prompt[:150]}"

    def supported_task_types(self) -> list[str]:
        return [
            "generate_and_post",
            "generate_preview",
            "post_existing_image",
            "create_visual_thread",
        ]


# ── Stub Providers ──

class MockImageGenAPI(StubProvider):
    """Stub for image generation API (DALL-E / Stable Diffusion) in sandbox."""

    async def handle(self, method: str, params: dict) -> dict:
        if method == "generate":
            prompt = params.get("prompt", "test image")
            return {
                "created": 1700000000,
                "data": [
                    {
                        "url": f"https://stub-images.siglume.dev/{hash(prompt) % 10000}.png",
                        "revised_prompt": prompt,
                    }
                ],
            }
        if method == "edit":
            return {
                "created": 1700000000,
                "data": [{"url": "https://stub-images.siglume.dev/edited.png"}],
            }
        return await super().handle(method, params)


class MockXMediaAPI(StubProvider):
    """Stub for X/Twitter media upload + tweet creation in sandbox."""

    async def handle(self, method: str, params: dict) -> dict:
        if method == "upload_media":
            return {"media_id": "stub-media-001", "media_key": "stub-key-001"}
        if method == "create_tweet":
            return {
                "data": {
                    "id": "stub-tweet-img-789",
                    "text": params.get("text", ""),
                }
            }
        if method == "get_me":
            return {"data": {"id": "stub-user-1", "username": "test_visual_agent"}}
        return await super().handle(method, params)


# ── Self-test ──

async def main():
    app = VisualPublisherApp()
    harness = AppTestHarness(
        app,
        stubs={
            "x-twitter": MockXMediaAPI("x-twitter"),
            "openai": MockImageGenAPI("openai"),
        },
    )

    # Validate manifest
    issues = harness.validate_manifest()
    if issues:
        print(f"Manifest issues: {issues}")
        return
    print("[OK] Manifest valid")

    # Dry run  -- preview image generation without posting
    result = await harness.dry_run(
        task_type="generate_and_post",
        input_params={
            "prompt": "A futuristic cityscape where AI agents collaborate in a digital marketplace",
            "caption": "The future of agent collaboration is here.",
            "style": "vivid",
        },
    )
    print(f"[OK] Dry run: success={result.success}")
    print(f"  Image URL: {result.output.get('image_url', 'n/a')}")
    print(f"  Alt text: {result.output.get('alt_text', 'n/a')}")
    print(f"  Needs approval: {result.needs_approval}")

    # Action  -- generate and post (stubbed)
    result = await harness.execute_action(
        task_type="generate_and_post",
        input_params={
            "prompt": "Abstract visualization of agent-to-agent communication",
            "caption": "How agents talk to each other #Siglume #AI",
            "alt_text": "Abstract network diagram showing AI agents exchanging messages",
        },
    )
    print(f"[OK] Action: success={result.success}")
    print(f"  Tweet URL: {result.output.get('url', 'n/a')}")
    print("  Cost: free")

    # Edge case: empty prompt
    result = await harness.dry_run(
        task_type="generate_and_post",
        input_params={"prompt": ""},
    )
    print(f"[OK] Empty prompt handled: success={result.success}, error={result.error_message}")

    print("\nAll checks passed!")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
