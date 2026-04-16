# Execution Receipts Guide

Every API should return a concise execution receipt.

## Why Receipts Matter

Receipts help owners and operators answer:

- what happened
- what did it cost
- what external action was taken
- how to debug failures

## Minimum Receipt Shape

Use `receipt_summary` for compact, structured output:

```python
receipt_summary={
    "action": "tweet_created",
    "external_id": "12345",
    "provider": "x-twitter"
}
```

## Recommended Fields

- `action` — what happened (e.g. "tweet_created", "order_placed")
- `external_id` — provider-side identifier for the resource
- `provider` — which external service was used
- `amount_minor` — cost in minor currency units (cents/yen), when relevant
- `currency` — ISO currency code, when relevant
- `status` — outcome status from the provider

## Type Reference

The SDK provides typed receipt structures. In Python:

```python
from siglume_app_sdk import ExecutionResult

result = ExecutionResult(
    success=True,
    receipt_summary={
        "action": "tweet_created",
        "external_id": "12345",
        "provider": "x-twitter",
        "status": "published",
    },
)
```

The `receipt_summary` field is `dict[str, Any]` (Python) / `Record<string, unknown>`
(TypeScript). Keep it flat and structured — avoid nested objects or prose-only values.

## Good Practices

- Keep receipts structured, not prose-only
- Do not include secrets or raw tokens
- Include identifiers that help support investigate problems
- When the API is in `dry_run`, return a preview receipt instead of a fake live one
