"""Example: publisher-hosted artifact delivery with signed download URLs.

This demonstrates Model B from docs/artifact-delivery.md:

  1. render an artifact inside the action call;
  2. store bytes in publisher-owned object storage;
  3. return both output.download_url and ExecutionArtifact.external_url;
  4. allow a later free get_artifact call to reissue a fresh URL, scoped by
     (owner_user_id, artifact_id).

The object store below is an in-memory stand-in with boto3-compatible method
names so this example runs offline. In production, replace DemoObjectStore with
`boto3.client("s3")`, Cloudflare R2, GCS, Azure Blob, or another HTTPS object
store.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path
from urllib.parse import quote

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
    ToolManual,
    ToolManualPermissionClass,
    validate_tool_manual,
)


BUCKET = "demo-artifacts"
SIGNED_URL_TTL_SECONDS = 3600


class DemoObjectStore:
    """Tiny offline object store with the boto3 methods used in the docs."""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], dict[str, object]] = {}

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, ContentType: str) -> None:
        self.objects[(Bucket, Key)] = {"body": Body, "content_type": ContentType}

    def generate_presigned_url(self, ClientMethod: str, *, Params: dict[str, str], ExpiresIn: int) -> str:
        if ClientMethod != "get_object":
            raise ValueError("Only get_object is supported in this example")
        bucket = Params["Bucket"]
        key = Params["Key"]
        if (bucket, key) not in self.objects:
            raise KeyError(f"missing object: {bucket}/{key}")
        signature = hashlib.sha256(f"{bucket}:{key}:{ExpiresIn}".encode("utf-8")).hexdigest()[:16]
        return (
            f"https://object-store.example/{quote(bucket)}/{quote(key)}"
            f"?X-Amz-Expires={ExpiresIn}&X-Amz-Signature={signature}"
        )


class ArtifactDeliveryPresignedApp(AppAdapter):
    def __init__(self, store: DemoObjectStore | None = None) -> None:
        super().__init__()
        self.store = store or DemoObjectStore()
        self._artifacts: dict[tuple[str, str], dict[str, object]] = {}

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="artifact-delivery-presigned",
            name="Artifact Delivery Presigned",
            job_to_be_done="Render a small report, store it in publisher object storage, and return a signed download link.",
            category=AppCategory.DOCUMENT,
            store_vertical="api",
            permission_class=PermissionClass.ACTION,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            currency="USD",
            allow_free_trial=False,
            jurisdiction="US",
            short_description="Return publisher-hosted artifacts with signed URLs.",
            example_prompts=[
                "Render a report and give me the download link.",
                "Refresh the download link for artifact art_demo_123.",
            ],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        params = ctx.input_params or {}
        operation = str(params.get("operation") or ("get_artifact" if params.get("artifact_id") else "render"))
        if operation == "get_artifact" or ctx.task_type == "get_artifact":
            return self._get_artifact(ctx, str(params.get("artifact_id") or ""))
        return self._render_artifact(ctx)

    def supported_task_types(self) -> list[str]:
        return ["render_artifact", "get_artifact"]

    def _render_artifact(self, ctx: ExecutionContext) -> ExecutionResult:
        if not self._valid_owner(ctx.owner_user_id):
            return self._identity_error(ctx)

        title = str(ctx.input_params.get("title") or "Weekly artifact report")
        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output={"summary": f"Would render '{title}' and return a signed download link.", "status": "ready"},
                needs_approval=True,
                approval_prompt=f"Render '{title}' and create a one-hour signed download link.",
            )

        body = self._render_report(title=title, owner_user_id=ctx.owner_user_id)
        artifact_id = self._artifact_id(ctx.owner_user_id, title, body)
        owner_hash = hashlib.sha256(ctx.owner_user_id.encode("utf-8")).hexdigest()[:16]
        key = f"artifacts/{owner_hash}/{artifact_id}.md"
        content_type = "text/markdown; charset=utf-8"

        self.store.put_object(Bucket=BUCKET, Key=key, Body=body, ContentType=content_type)
        self._artifacts[(ctx.owner_user_id, artifact_id)] = {
            "bucket": BUCKET,
            "key": key,
            "title": title,
            "content_type": content_type,
            "status": "ready",
        }
        download_url = self._signed_url(BUCKET, key)
        artifact = ExecutionArtifact(
            artifact_type="document",
            external_id=artifact_id,
            external_url=download_url,
            title=title,
            metadata={"content_type": content_type, "expires_in_seconds": SIGNED_URL_TTL_SECONDS},
        )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": f"Rendered '{title}'.",
                "status": "found",
                "artifact_id": artifact_id,
                "download_url": download_url,
                "download_expires_in_seconds": SIGNED_URL_TTL_SECONDS,
            },
            artifacts=[artifact],
            receipt_summary={"action": "artifact_rendered", "artifact_id": artifact_id},
        )

    def _get_artifact(self, ctx: ExecutionContext, artifact_id: str) -> ExecutionResult:
        if not self._valid_owner(ctx.owner_user_id):
            return self._identity_error(ctx)

        free_receipt = {"operation": "get_artifact", "amount_minor": 0, "currency": "USD"}
        record = self._artifacts.get((ctx.owner_user_id, artifact_id))
        if record is None:
            # Unknown and wrong-owner ids return the same empty shape.
            return ExecutionResult(
                success=False,
                execution_kind=ctx.execution_kind,
                output={"summary": "Artifact is unavailable or expired.", "status": "expired", "artifact_id": artifact_id},
                units_consumed=0,
                amount_minor=0,
                currency="USD",
                receipt_summary=free_receipt,
            )
        if record.get("status") == "not_ready":
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output={"summary": "Artifact is not ready yet.", "status": "not_ready", "artifact_id": artifact_id},
                units_consumed=0,
                amount_minor=0,
                currency="USD",
                receipt_summary=free_receipt,
            )
        if record.get("status") == "expired":
            return ExecutionResult(
                success=False,
                execution_kind=ctx.execution_kind,
                output={"summary": "Artifact retention expired.", "status": "expired", "artifact_id": artifact_id},
                units_consumed=0,
                amount_minor=0,
                currency="USD",
                receipt_summary=free_receipt,
            )

        download_url = self._signed_url(str(record["bucket"]), str(record["key"]))
        artifact = ExecutionArtifact(
            artifact_type="document",
            external_id=artifact_id,
            external_url=download_url,
            title=str(record["title"]),
            metadata={
                "content_type": str(record["content_type"]),
                "expires_in_seconds": SIGNED_URL_TTL_SECONDS,
            },
        )
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "summary": "Fresh download link issued.",
                "status": "found",
                "artifact_id": artifact_id,
                "download_url": download_url,
                "download_expires_in_seconds": SIGNED_URL_TTL_SECONDS,
            },
            units_consumed=0,
            amount_minor=0,
            currency="USD",
            artifacts=[artifact],
            receipt_summary=free_receipt,
        )

    def _signed_url(self, bucket: str, key: str) -> str:
        return self.store.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=SIGNED_URL_TTL_SECONDS,
        )

    @staticmethod
    def _render_report(*, title: str, owner_user_id: str) -> bytes:
        return f"# {title}\n\nOwner-scoped artifact for {owner_user_id}.\n".encode("utf-8")

    @staticmethod
    def _artifact_id(owner_user_id: str, title: str, body: bytes) -> str:
        digest = hashlib.sha256(owner_user_id.encode("utf-8") + title.encode("utf-8") + body).hexdigest()[:16]
        return f"art_{digest}"

    @staticmethod
    def _valid_owner(owner_user_id: str | None) -> bool:
        return bool(owner_user_id and owner_user_id.strip() and owner_user_id != "siglume")

    @staticmethod
    def _identity_error(ctx: ExecutionContext) -> ExecutionResult:
        return ExecutionResult(
            success=False,
            execution_kind=ctx.execution_kind,
            output={"summary": "Missing platform user identity.", "status": "unauthorized"},
            units_consumed=0,
            amount_minor=0,
            currency="USD",
            receipt_summary={"operation": "identity_check", "amount_minor": 0, "currency": "USD"},
        )


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="artifact_delivery_presigned",
        job_to_be_done="Render a report artifact, return a signed HTTPS download link, and refresh that link later for the same owner.",
        summary_for_model=(
            "Renders a publisher-hosted report and returns both output.download_url and "
            "ExecutionArtifact.external_url. Use get_artifact with artifact_id to refresh the "
            "signed URL for free. The API scopes retrieval by owner_user_id plus artifact_id."
        ),
        trigger_conditions=[
            "owner asks to generate, render, export, or download a file-like report",
            "agent has an artifact_id from this API and needs a fresh download link",
            "owner needs a publisher-hosted output file rather than inline text",
        ],
        do_not_use_when=[
            "the requested result is short plain text that should be returned inline",
            "the owner is asking to upload a file into the API rather than download an output artifact",
        ],
        permission_class=ToolManualPermissionClass.ACTION,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["render", "get_artifact"],
                    "description": "render creates a new artifact; get_artifact reissues a signed URL for an existing artifact_id.",
                    "default": "render",
                },
                "title": {"type": "string", "description": "Report title when operation=render."},
                "artifact_id": {"type": "string", "description": "Publisher-issued artifact id when operation=get_artifact."},
            },
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Human-readable result summary."},
                "status": {"type": "string", "description": "ready | found | not_ready | expired | unauthorized."},
                "artifact_id": {"type": "string", "description": "Durable publisher artifact id."},
                "download_url": {"type": "string", "description": "Short-lived HTTPS GET URL to bytes hosted by the publisher."},
                "download_expires_in_seconds": {"type": "integer", "description": "Signed URL TTL, default 3600 seconds."},
            },
            "required": ["summary", "status"],
            "additionalProperties": False,
        },
        usage_hints=[
            "Use operation=render to create a new artifact and return a signed URL.",
            "Use operation=get_artifact with artifact_id to refresh a signed URL for free.",
            "Never ask the user for owner_user_id; Siglume supplies it as runtime identity.",
        ],
        result_hints=[
            "Show download_url to the owner as the link to fetch the artifact.",
            "If status=expired, explain that the artifact id is unavailable or outside retention.",
            "If status=unauthorized, fail closed; do not expose any artifact details.",
        ],
        error_hints=[
            "Unknown and wrong-owner artifact ids both return expired, so do not infer ownership.",
            "If a signed URL expires, call get_artifact again instead of reusing the stale URL.",
        ],
        approval_summary_template="Render report artifact '{title}' and return a signed download link.",
        preview_schema={
            "type": "object",
            "properties": {"summary": {"type": "string", "description": "Preview of the artifact render."}},
            "required": ["summary"],
            "additionalProperties": False,
        },
        idempotency_support=True,
        side_effect_summary="Writes a rendered report into publisher-owned object storage and returns a short-lived HTTPS download link.",
        jurisdiction="US",
    )


async def run_artifact_delivery_example() -> list[str]:
    app = ArtifactDeliveryPresignedApp()
    harness = AppTestHarness(app)
    ok, issues = validate_tool_manual(build_tool_manual())
    output = [f"tool_manual_valid: {ok} {len(issues)}", f"manifest_issues: {len(harness.validate_manifest())}"]

    dry_run = await harness.dry_run(task_type="render_artifact", input_params={"title": "Demo report"})
    output.append(f"dry_run: {dry_run.success} {dry_run.output['status']}")

    action = await harness.execute_action(task_type="render_artifact", input_params={"title": "Demo report"})
    artifact_id = action.output["artifact_id"]
    output.append(f"action: {action.success} {action.output['status']} artifacts={len(action.artifacts)}")
    output.append(f"download_url_present: {str(action.output['download_url']).startswith('https://')}")

    reissue = await harness.execute_action(task_type="get_artifact", input_params={"operation": "get_artifact", "artifact_id": artifact_id})
    output.append(f"reissue: {reissue.success} {reissue.output['status']} amount={reissue.amount_minor}")

    from siglume_api_sdk import ExecutionContext  # noqa: WPS433

    wrong_owner = await app.execute(
        ExecutionContext(
            agent_id="test-agent-001",
            owner_user_id="other-owner-001",
            task_type="get_artifact",
            input_params={"artifact_id": artifact_id},
            execution_kind=ExecutionKind.ACTION,
        )
    )
    output.append(f"wrong_owner: {wrong_owner.success} {wrong_owner.output['status']}")

    sentinel_owner = await app.execute(
        ExecutionContext(
            agent_id="test-agent-001",
            owner_user_id="siglume",
            task_type="get_artifact",
            input_params={"artifact_id": artifact_id},
            execution_kind=ExecutionKind.ACTION,
        )
    )
    output.append(f"sentinel_owner: {sentinel_owner.success} {sentinel_owner.output['status']}")
    return output


async def main() -> None:
    for line in await run_artifact_delivery_example():
        print(line)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
