# Artifact delivery: where your output bytes live, and how the buyer fetches them

**Siglume does not host your output files.** The platform brokers the *request* and relays
your *response*; it never stores, hosts, or re-serves the bytes a buyer downloads. So if your
API produces a file - a rendered video, a transcript, a converted document - **you host it and
return a reference**. There is no platform-side artifact store to depend on.

You have **two first-class delivery models**, and you choose freely between them by how long the
work takes. Both are publisher-self-hosted; neither is more "official" than the other.

| | **Model B - immediate link** | **Model A - async claim-ticket** |
|---|---|---|
| Use when | The result is ready within the invoke timeout (1-20s) | The work outlives the request (long transcode, batch render, multi-minute analysis) |
| What you return | `ExecutionArtifact.external_url` -> a link to bytes **you** host | An accepted-job envelope with a durable `job_id`; the buyer collects later via a free `get_result` |
| Retrieval | The buyer opens the URL returned for this execution | The buyer polls a free terminal op with the `job_id` |
| Retention / signing | Yours - keep the URL short-lived, and re-mint it only after an owner check if you expose a reissue path | Yours - define a retention window and re-issue links on each `get_result` |
| Full spec | This page + [Execution Receipts](./execution-receipts.md) | [Async / Long-Running Two-Phase APIs](./async-two-phase-apis.md) |

## Model B - immediate link (`external_url`)

When your result is ready inline, return a link to it in `ExecutionArtifact.external_url`
(see [Execution Receipts -> ExecutionArtifact](./execution-receipts.md#executionartifact)).
`external_url` is **not** limited to a public permalink on a third-party provider - it is equally
the place to return a **download link to bytes you host yourself**, e.g. an S3 (or any object
store) **presigned GET URL** with a short TTL.

Return the same URL in both places:

- `artifacts=[ExecutionArtifact(..., external_url=download_url)]` for the structured receipt.
- `output["download_url"] = download_url` for the agent/human-facing result body.

The agent normally presents the link to the buyer. It does not need to fetch or proxy the bytes.

### Complete `execute()` example

```python
import os
import uuid
import boto3

from siglume_api_sdk import ExecutionArtifact, ExecutionKind, ExecutionResult

s3 = boto3.client("s3")
BUCKET = os.environ["ARTIFACT_BUCKET"]


def render_report(params: dict) -> bytes:
    title = params.get("title") or "Siglume artifact"
    return f"# {title}\n\nRendered report body.\n".encode("utf-8")


async def execute(self, ctx):
    if ctx.execution_kind == ExecutionKind.DRY_RUN:
        return ExecutionResult(success=True, output={"summary": "Would render and return a signed download link."})

    artifact_id = f"art_{uuid.uuid4().hex}"
    key = f"artifacts/{artifact_id}.md"
    body = render_report(ctx.input_params)
    content_type = "text/markdown; charset=utf-8"

    s3.put_object(Bucket=BUCKET, Key=key, Body=body, ContentType=content_type)
    download_url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=3600,
    )

    artifact = ExecutionArtifact(
        artifact_type="document",
        external_id=artifact_id,
        external_url=download_url,
        title="Rendered report",
        metadata={"content_type": content_type, "expires_in_seconds": 3600},
    )
    return ExecutionResult(
        success=True,
        output={
            "summary": "Rendered report is ready.",
            "artifact_id": artifact_id,
            "download_url": download_url,
            "download_expires_in_seconds": 3600,
        },
        artifacts=[artifact],  # artifacts is a list; return one item per output file
        receipt_summary={"action": "artifact_rendered", "artifact_id": artifact_id},
    )
```

Use instance role, workload identity, or environment-provided credentials. Do **not** hard-code
object-store access keys in your adapter, Tool Manual, runtime validation, or git repo. S3 is only
an example; Cloudflare R2, Google Cloud Storage, Azure Blob, or any object store is fine. The
Siglume contract is only that `external_url` is an HTTPS GET link to bytes you host.

Treat every presigned URL as a short-lived bearer URL: anyone who has it can use it until it
expires. The default example TTL is `ExpiresIn=3600` (one hour). If you need a longer retrieval
window, store the artifact under `(owner_user_id, artifact_id)` and expose a free `0`-priced
reissue/status operation that verifies the owner before minting a fresh `external_url`.

### Reissue states for Model B

For a durable `artifact_id`, make `get_artifact` / `reissue_artifact_url` a free operation.
It should always look up by `(owner_user_id, artifact_id)`, never by `artifact_id` alone.

| State | Response |
|---|---|
| found + fresh | Return `status: "found"`, a new `download_url`, and an `ExecutionArtifact.external_url`. |
| not ready | Return `status: "not_ready"` and no URL. |
| expired | Return `success: false`, `status: "expired"` and no URL. |
| unknown or wrong owner | Return the same empty/expired shape; do not reveal whether the id exists for another owner. |

## Model A - async claim-ticket (durable `job_id` + free `get_result`)

When the work cannot finish inside the invoke window, do not block - **accept the job, settle the
charge, and deliver later**. Return a durable `job_id`; the buyer keeps it and later calls a
**free** terminal operation (`get_result`) to collect the artifacts. This is the *claim-ticket*
model: the `job_id` is the ticket, redeemable at any time within a retention window **you**
define, **from any session** - the buyer can leave the chat and come back for the result.
Storage, retention, and URL signing all stay with you; the platform retains nothing.

The full contract - the three legs, the wire shape, retention, and the failed-job obligation -
lives in **[Async / Long-Running Two-Phase APIs](./async-two-phase-apis.md)**; that pattern *is*
Model A. Inside `get_result`, you typically deliver large/binary artifacts exactly as in Model B:
an `external_url` to bytes you host, re-issued fresh on every poll. Small text artifacts can be
returned inline when that is the product contract; [`examples/async_transcription.py`](../examples/async_transcription.py)
does that for brevity, while [`examples/artifact_delivery_presigned.py`](../examples/artifact_delivery_presigned.py)
shows the signed-URL pattern.

Minimal skeleton:

```python
if "job_id" not in params:
    job_id = enqueue_job(owner_user_id=ctx.owner_user_id, params=params)
    return ExecutionResult(success=True, output={"accepted": True, "job_id": job_id, "status": "queued"})
record = jobs.get((ctx.owner_user_id, params["job_id"]))
if record is None:
    return ExecutionResult(success=False, output={"status": "expired", "job_id": params["job_id"]})
url = sign_get_url(record.object_key)
return ExecutionResult(success=True, output={"status": "succeeded", "download_url": url}, artifacts=[ExecutionArtifact(artifact_type="document", external_id=params["job_id"], external_url=url)])
```

Settlement is final on acceptance. If your worker fails after accepting and charging, report
`status: "failed"` through the free `get_result` operation and honor your own refund/repair
policy. The platform does not auto-refund accepted async jobs.

## Ownership & identity - all you need for secure, session-independent retrieval

Artifact retrieval often happens *later* and *from another session*. The rule that keeps a
buyer's artifacts private is: **scope every durable lookup or URL reissue on the owner plus
your own durable id.**

- The platform stamps **`owner_user_id`** (and `agent_id`) onto every `ExecutionContext`
  (see the [type reference](../siglume-api-types.ts)). You do **not** authenticate the buyer
  yourself - the platform already has, and hands you their identity on each call.
- In a live HTTP deployment, the buyer identity arrives as the runtime header
  **`X-Siglume-Platform-User-Id`**. The SDK runtime / `AppTestHarness` surfaces that value as
  `ExecutionContext.owner_user_id`. After validating your runtime auth header, map
  `X-Siglume-Platform-User-Id` to the same storage key you use in SDK code:
  `(owner_user_id, artifact_id)` or `(owner_user_id, job_id)`. See
  [Connected Accounts -> Runtime identity headers](./connected-accounts.md#runtime-identity-headers)
  and [Getting Started -> Runtime invocation identity headers](../GETTING_STARTED.md#runtime-invocation-identity-headers).
- **You** issue the durable id - `job_id` for Model A or `artifact_id` for Model B. If your API
  uses another name such as `media_id`, document it as your publisher-defined durable id and
  still scope it with `owner_user_id`.
- Store every durable artifact record keyed by **`(owner_user_id, your_id)`**, and on every
  `get_result`, status, or signed-URL reissue path look it up by **both**. A request carrying
  someone else's `job_id` or `artifact_id` then returns nothing, because it does not match the
  caller's `owner_user_id`.

That pairing - **`owner_user_id` (from the platform) + a durable id (from you)** - is the whole
identity contract for publisher-hosted retrieval. It gives you secure collection that survives
the buyer leaving the chat, **with no platform-hosted artifact store**. Reject the empty /
sentinel owner (`owner_user_id` missing, or the literal `"siglume"`) before serving or
reissuing anything.

```python
def valid_owner(owner_user_id: str | None) -> bool:
    return bool(owner_user_id and owner_user_id.strip() and owner_user_id != "siglume")


def lookup_for_reissue(ctx, artifact_id: str):
    if not valid_owner(ctx.owner_user_id):
        return {"success": False, "status": "unauthorized"}
    record = artifact_store.get((ctx.owner_user_id, artifact_id))
    if record is None:
        return {"success": False, "status": "expired"}  # unknown or wrong owner
    return {"success": True, "status": "found", "record": record}
```

## Security checklist

- Use a short TTL for signed URLs; `ExpiresIn=3600` is a reasonable default.
- Validate `owner_user_id` and your durable id together before every `get_result` or URL reissue.
- Reject missing, empty, or sentinel owners such as `"siglume"` before serving anything.
- Do not log signed URLs, object-store credentials, or raw file bytes.
- Return only HTTPS GET links in `external_url`.
- Set `ContentType` when writing the object so browsers and agents display it correctly.
- Make reissue/get-result operations free (`0`-priced) and read-only.

## Worked example

See [`examples/artifact_delivery_presigned.py`](../examples/artifact_delivery_presigned.py) for
a runnable `AppAdapter` that implements Model B with a signed URL plus a free `get_artifact`
reissue operation. The example stores artifact records by `(owner_user_id, artifact_id)`, rejects
empty / `"siglume"` owners, returns `expired` for unknown or wrong-owner ids, and includes both
`ExecutionArtifact.external_url` and `output.download_url`.

## Inputs use a different mechanism - do not confuse them

A buyer *sending* a file *into* your API uses the MCP file-input handle
(`{"format": "siglume-handle"}`; see [Core Concepts -> MCP file inputs](./sdk-core-concepts.md#mcp-file-inputs)).
Siglume brokers that **input** for the current call only and does not persist it. There is **no**
matching platform-hosted mechanism for **outputs** - outputs are always Model A or Model B above.

## Related

- [Execution Receipts](./execution-receipts.md) - the `ExecutionArtifact` / `external_url` shape (Model B).
- [Async / Long-Running Two-Phase APIs](./async-two-phase-apis.md) - the full claim-ticket contract (Model A).
- [Connected Accounts](./connected-accounts.md) - runtime identity headers and tenant/token mapping.
- [Platform / API Responsibility Boundary](./platform-api-boundary.md) - what Siglume owns vs what you own.
