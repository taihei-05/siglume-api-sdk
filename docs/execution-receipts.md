# Execution Receipts Guide

Every API should return a concise execution receipt.

## Why Receipts Matter

Receipts help owners and operators answer:

- what happened
- what did it cost
- what external action was taken
- how to debug failures

To view receipts after a run, use the matching surface:

- owner account runs: `siglume dev tail` or SDK `list_execution_receipts()`;
  the SDK helper reads owner-scoped receipts and currently requires an
  owner/session bearer, not a publisher CLI token.
- publisher listing runs: `siglume dev tail --listing-id <listing_id>` or SDK
  `list_listing_recent_receipts()`; this seller-scoped surface accepts the
  publisher automation credential and returns privacy-redacted receipts.

See [Developer Observability](./developer-observability.md).

## Two approaches: legacy and structured

### Legacy: `receipt_summary` (free-form dict)

The original approach. Still supported, but prefer structured types for new APIs.

```python
receipt_summary={
    "action": "tweet_created",
    "external_id": "12345",
    "provider": "x-twitter"
}
```

### Structured: `artifacts` + `side_effects` (recommended)

Use the typed execution contract for machine-readable, auditable receipts:

```python
from siglume_api_sdk import (
    ExecutionResult, ExecutionKind,
    ExecutionArtifact, SideEffectRecord,
)

result = ExecutionResult(
    success=True,
    execution_kind=ExecutionKind.ACTION,
    output={"message": "Tweet posted successfully"},
    artifacts=[
        ExecutionArtifact(
            artifact_type="social_post",
            external_id="1234567890",
            external_url="https://x.com/agent/status/1234567890",
            title="Daily market summary",
        ),
    ],
    side_effects=[
        SideEffectRecord(
            action="tweet_created",
            provider="x-twitter",
            external_id="1234567890",
            reversible=True,
            reversal_hint="DELETE /tweets/1234567890",
        ),
    ],
)
```

## When to use each

| Situation | Use |
|-----------|-----|
| Simple read-only API | `receipt_summary` is fine |
| Action/payment API | Use `artifacts` + `side_effects` |
| Need to correlate a runtime execution receipt | Use `receipt_ref` (set by runtime) |
| Owner approval required | Use `approval_hint` |

## Structured types reference

### ExecutionArtifact

Describes what was produced.

| Field | Required | Description |
|-------|----------|-------------|
| `artifact_type` | yes | e.g. "image", "social_post", "calendar_event" |
| `external_id` | no | Provider-side ID (tweet ID, event ID, etc.) |
| `external_url` | no | Link to the artifact on the provider |
| `title` | no | Human-readable label |
| `summary` | no | Brief description |
| `metadata` | no | Extra provider-specific data |

### SideEffectRecord

Describes what external state changed.

| Field | Required | Description |
|-------|----------|-------------|
| `action` | yes | e.g. "tweet_created", "email_sent", "payment_charged" |
| `provider` | yes | e.g. "x-twitter", "stripe" |
| `external_id` | no | Provider-side reference |
| `reversible` | yes | Can this be undone? |
| `reversal_hint` | no | How to undo (e.g. "DELETE /tweets/{id}") |
| `timestamp_iso` | no | When the side effect occurred |
| `metadata` | no | Extra data |

### ReceiptRef

Opaque reference to a `CapabilityExecutionReceipt`. **Set by the runtime, not by the app developer.** Use this to correlate logs, receipts, and support traces for one API execution.

| Field | Required | Description |
|-------|----------|-------------|
| `receipt_id` | yes | UUID of the receipt |
| `trace_id` | no | Distributed trace ID for debugging |
| `intent_id` | no | Originating execution intent |

### ApprovalRequestHint

Structured context for the owner approval dialog. Return this when `needs_approval=True`.

```python
from siglume_api_sdk import (
    ExecutionResult, ExecutionKind, ApprovalRequestHint,
)

result = ExecutionResult(
    success=True,
    execution_kind=ExecutionKind.ACTION,
    needs_approval=True,
    approval_hint=ApprovalRequestHint(
        action_summary="Post tweet to @company_account",
        permission_class="action",
        side_effects=["Creates a public tweet visible to all followers"],
        reversible=True,
        preview={"text": "Q1 results are in! Revenue up 15% YoY."},
    ),
)
```

| Field | Required | Description |
|-------|----------|-------------|
| `action_summary` | yes | What will happen |
| `permission_class` | yes | "action" or "payment" |
| `estimated_amount_minor` | no | Estimated cost in minor units |
| `currency` | no | ISO currency code |
| `side_effects` | no | Plain-text list of what will change |
| `preview` | no | Structured preview payload |
| `reversible` | yes | Can the action be undone? |

## Good Practices

- Keep receipts structured, not prose-only
- Do not include secrets or raw tokens
- Include identifiers that help support investigate problems
- When the API is in `dry_run`, return a preview receipt instead of a fake live one
- Use `SideEffectRecord.reversible` honestly; it affects rollback review
- Always include `external_id` when the provider returns one

## Operation billing receipts

For `price_model="usage_based"` or `price_model="per_action"`, the receipt is
also the billing selector. Return the operation/request type that actually ran:

```python
return ExecutionResult(
    success=True,
    output={"posted": True},
    units_consumed=1,
    amount_minor=15,
    currency="JPY",
    receipt_summary={
        "operation": "text_only",
        "amount_minor": 15,
        "currency": "JPY",
    },
)
```

On the **chargeable** leg, the operation must match a `pricing_plan.items[].key`.
The plan item is authoritative for the charge. If the receipt reports a conflicting
positive amount, the platform rejects the call instead of charging the arbitrary
amount. For free/no-op operations, return `amount_minor=0`; the platform creates no
payment for a `0`-priced plan item.

`receipt_summary.operation` means different things on different legs — do not put the
chargeable band on a free leg:

| Leg | `receipt_summary.operation` | `amount_minor` |
|---|---|---|
| `quote` / `dry_run` | the leg's **own** op (`"quote"` / `"dry_run"`) — **not** the band | `0` |
| `action` (the chargeable leg) | the **executed band** (a `pricing_plan` key) | the plan price |
| a free op (`get_result`, `health`, a status poll) | that op's **own** name (a `0`-priced key) | `0` |

### Wire shape: `output` is nested, `receipt_summary` is a sibling

The platform keeps everything your handler returns under `output={...}` **nested**, and
hoists `receipt_summary` to a **sibling top-level key**. So the chargeable-band hint on a
prepay quote is read at **`result.output.billingPreview.operation`**, while
`receipt_summary` is read at **`result.receipt_summary`** (top level). Putting
`billingPreview` at the top level still works (the platform reads both), but the nested
shape is the contract. (Source: `normalizeExecutionResult` /`buildExecutionResult` in the
TS SDK.)

See [Pricing And Billing](./pricing-and-billing.md) for the full contract, and
[Async / long-running two-phase APIs](./async-two-phase-apis.md) for deferred-settlement
jobs (`quote → accepted+job_id → free get_result`).
