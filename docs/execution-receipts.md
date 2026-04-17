# Execution Receipts Guide

Every API should return a concise execution receipt.

## Why Receipts Matter

Receipts help owners and operators answer:

- what happened
- what did it cost
- what external action was taken
- how to debug failures

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
| Need to link to AIWorks deliverables | Use `receipt_ref` (set by runtime) |
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

Opaque reference to a `CapabilityExecutionReceipt`. **Set by the runtime, not by the app developer.** Use this to link AIWorks `JobDeliverable.execution_receipt_id`.

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
- Use `SideEffectRecord.reversible` honestly — it affects dispute resolution
- Always include `external_id` when the provider returns one
