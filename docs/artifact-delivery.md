# Artifact delivery: where your output bytes live, and how the buyer fetches them

**Siglume does not host your output files.** The platform brokers the *request* and relays
your *response*; it never stores, hosts, or re-serves the bytes a buyer downloads. So if your
API produces a file — a rendered video, a transcript, a converted document — **you host it and
return a reference**. There is no platform-side artifact store to depend on.

You have **two first-class delivery models**, and you choose freely between them by how long the
work takes. Both are publisher-self-hosted; neither is more "official" than the other.

| | **Model B — immediate link** | **Model A — async claim-ticket** |
|---|---|---|
| Use when | The result is ready within the invoke timeout (1–20s) | The work outlives the request (long transcode, batch render, multi-minute analysis) |
| What you return | `ExecutionArtifact.external_url` → a link to bytes **you** host | An accepted-job envelope with a durable `job_id`; the buyer collects later via a free `get_result` |
| Retrieval | The buyer opens the URL returned for this execution | The buyer polls a free terminal op with the `job_id` |
| Retention / signing | Yours — keep the URL short-lived, and re-mint it only after an owner check if you expose a reissue path | Yours — define a retention window and re-issue links on each `get_result` |
| Full spec | This page + [Execution Receipts](./execution-receipts.md) | [Async / Long-Running Two-Phase APIs](./async-two-phase-apis.md) |

## Model B — immediate link (`external_url`)

When your result is ready inline, return a link to it in `ExecutionArtifact.external_url`
(see [Execution Receipts → ExecutionArtifact](./execution-receipts.md#executionartifact)).
`external_url` is **not** limited to a public permalink on a third-party provider — it is equally
the place to return a **download link to bytes you host yourself**, e.g. an S3 (or any object
store) **presigned GET URL** with a short TTL:

```python
ExecutionArtifact(
    artifact_type="video",
    external_url=presigned_get_url,   # https://<your-bucket>.s3.<region>.amazonaws.com/key?...&X-Amz-Expires=3600
    title="Edited clip (30s)",
)
```

Host the object in your own bucket, mint the presigned URL at response time so it is always
fresh, and return it. The platform relays the URL to the agent and never fetches the bytes
itself. Treat a presigned URL as a short-lived bearer URL: anyone who has it can use it until
it expires. If you need a longer retrieval window, store the artifact under
`(owner_user_id, artifact_id)` and expose a free reissue/status path that verifies the owner
before minting a fresh `external_url`.

## Model A — async claim-ticket (durable `job_id` + free `get_result`)

When the work cannot finish inside the invoke window, do not block — **accept the job, settle the
charge, and deliver later**. Return a durable `job_id`; the buyer keeps it and later calls a
**free** terminal operation (`get_result`) to collect the artifacts. This is the *claim-ticket*
model: the `job_id` is the ticket, redeemable at any time within a retention window **you**
define, **from any session** — the buyer can leave the chat and come back for the result.
Storage, retention, and URL signing all stay with you; the platform retains nothing.

The full contract — the three legs, the wire shape, retention, and the failed-job obligation —
lives in **[Async / Long-Running Two-Phase APIs](./async-two-phase-apis.md)**; that pattern *is*
Model A. Inside `get_result`, deliver each artifact exactly as in Model B — an `external_url` to
bytes you host — re-issued fresh on every poll.

## Ownership & identity — all you need for secure, session-independent retrieval

Artifact retrieval often happens *later* and *from another session*. The rule that keeps a
buyer's artifacts private is: **scope every durable lookup or URL reissue on the owner plus
your own durable id.**

- The platform stamps **`owner_user_id`** (and `agent_id`) onto every `ExecutionContext`
  (see the [type reference](../siglume-api-types.ts)). You do **not** authenticate the buyer
  yourself — the platform already has, and hands you their identity on each call.
- **You** issue the durable id — `job_id`, `media_id`, or `artifact_id`.
- Store every durable artifact record keyed by **`(owner_user_id, your_id)`**, and on every
  `get_result`, status, or signed-URL reissue path look it up by **both**. A request carrying
  someone else's `job_id` then returns nothing, because it does not match the caller's
  `owner_user_id`.

That pairing — **`owner_user_id` (from the platform) + a durable id (from you)** — *is* the whole
identity contract for publisher-hosted retrieval. It gives you secure collection that survives
the buyer leaving the chat, **with no platform-hosted artifact store**. Reject the empty /
sentinel owner (`owner_user_id` missing, or the literal `"siglume"`) before serving or
reissuing anything.

> **Inputs use a different mechanism — do not confuse them.** A buyer *sending* a file *into*
> your API uses the MCP file-input handle (`{"format": "siglume-handle"}`; see
> [Core Concepts → MCP file inputs](./sdk-core-concepts.md#mcp-file-inputs)). Siglume brokers
> that **input** for the current call only and does not persist it. There is **no** matching
> platform-hosted mechanism for **outputs** — outputs are always Model A or Model B above.

## Related

- [Execution Receipts](./execution-receipts.md) — the `ExecutionArtifact` / `external_url` shape (Model B).
- [Async / Long-Running Two-Phase APIs](./async-two-phase-apis.md) — the full claim-ticket contract (Model A).
- [Platform / API Responsibility Boundary](./platform-api-boundary.md) — what Siglume owns vs what you own.
