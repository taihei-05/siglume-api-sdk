# Platform / API Responsibility Boundary

Siglume separates platform responsibilities from publisher API responsibilities.
This boundary is part of the runtime contract. Do not design an API that depends
on the platform guessing what your external provider did.

## What Siglume owns

The platform owns:

- buyer authorization and installed-tool access grants
- scheduled authorization tokens and scheduled execution scope
- payment quotes, direct payment requirements, wallet settlement, and charge state
- operation price lookup from `pricing_plan`
- platform idempotency, slot state, retry state, and reconciliation state
- usage rows, execution receipts, trace ids, and privacy-redacted observability

For paid prepay actions, Siglume verifies the payment scope and calls your live
action only after the quoted payment requirement is confirmed. If the API result
is missing, failed, draft-only, or ambiguous, Siglume does not mark the platform
slot as delivered. The platform records failed, retry, or reconciliation state
inside its own tables and surfaces the trace for support.

## What your API owns

Your publisher API owns all product-specific behavior and all external-provider
side effects, including:

- deciding whether an external action actually happened
- posting to X, sending email, writing to a CRM, reserving inventory, or any
  other provider-specific action
- OAuth, token refresh, provider leases, rate limits, and provider errors
- making the action endpoint idempotent for retries
- returning a clear result when the action committed
- returning a clear failure or no-op result when the action did not commit

Siglume does not inspect X, email providers, CRMs, merchant systems, or other
external products to decide whether your API succeeded. The API response is the
contract.

## Prepay action contract

Use `billing_timing="prepay"` when a paid operation has an irreversible side
effect.

The quote/dry-run phase must return a stable commit token and the priced
operation:

```python
return ExecutionResult(
    success=True,
    execution_kind=ExecutionKind.QUOTE,
    output={
        "status": "ready",
        "draftToken": draft_token,
        "billingPreview": {
            "operation": "text_with_url",
            "priceMinorIfActionSucceeds": 28,
            "currency": "JPY",
        },
    },
    units_consumed=0,
    amount_minor=0,
    currency="JPY",
    receipt_summary={"operation": "dry_run", "amount_minor": 0, "currency": "JPY"},
)
```

The live action must accept the same token and must return committed evidence
only after the external side effect happened:

```python
return ExecutionResult(
    success=True,
    execution_kind=ExecutionKind.ACTION,
    output={
        "posted": True,
        "post_url": "https://x.com/example/status/123",
        "provider_post_id": "123",
    },
    units_consumed=1,
    amount_minor=28,
    currency="JPY",
    receipt_summary={"operation": "text_with_url", "amount_minor": 28, "currency": "JPY"},
)
```

For non-posting APIs, use equivalent domain evidence such as `message_id`,
`reservation_id`, `order_id`, `ticket_id`, or another stable provider-side id.
The field names are API-specific, but the rule is not: do not return committed
evidence until the side effect committed.

## Ambiguous results

These are not delivered results:

- `status="ready"` without committed evidence
- dry-run, preview, draft, quote, or no-op output from the live action endpoint
- timeout without an idempotent way to return the committed provider id
- `accepted=false`, `success=false`, or an error/no-op status
- a paid operation receipt that conflicts with the quoted operation, amount, or
  currency

When the platform sees an ambiguous prepay action result, it may record a failed
or reconciliation state, but it must not invent provider-specific success. The
API owner must inspect the provider and return or repair the provider-side
evidence.

**Exception — accepted long-running jobs.** An action that cannot finish inline may
*accept* the work and deliver later. Returning `{accepted: true, job_id, status: "queued"}`
(with the chargeable band in `receipt_summary`) is an **accepted, deferred** result, not a
non-delivery: the platform settles on acceptance and the buyer collects the artifacts via a
separate **free** terminal op (`get_result`/`status`). This is the *only* affirmative
"not-yet-delivered" shape — `accepted: false`, `status: "ready"`, and draft/preview bodies
remain non-deliveries. See [Async / long-running two-phase APIs](./async-two-phase-apis.md).

## Idempotency expectations

Every action/payment API must support idempotency.

On retry with the same commit token or idempotency key:

- if the side effect already committed, return the same committed provider id or
  URL without creating a second side effect
- if the side effect did not commit, either retry safely or return a clear
  failure/no-op result
- never return a draft-only response as if it were a committed live action

This is especially important for scheduled or unattended runs. Scheduled
execution uses the same API contract as interactive execution; the only
difference is that the buyer authorization and platform retry state are
platform-managed.

## Support and reconciliation

When support investigates a paid action:

- platform support can verify authorization, quote scope, charge state, slot
  state, usage rows, and trace ids
- publisher support must verify provider-specific delivery and provide the
  committed provider id/URL or a clear failure reason

Do not ask the platform to infer provider delivery from provider-specific logs
or business rules. Provide the API result or support evidence needed to close
the API-owned side effect.
