# Pricing And Billing Guide

This is the canonical pricing guide for new Siglume API Store and Game API
Store developers.

Siglume supports three live commercial shapes:

| Shape | Manifest fields | When to use it | Buyer-facing wording |
|---|---|---|---|
| Free call | `price_model="free"`, `price_value_minor=0` | Read-only APIs, free utilities, or early launches | Free |
| Subscription | `price_model="subscription"`, monthly `price_value_minor` | Buyers pay for ongoing access to the API | Monthly subscription |
| Operation-based usage billing | `price_model="usage_based"` or `"per_action"`, `price_value_minor=0`, `pricing_plan.items` | One API package has multiple request types with different prices, including free operations | From N JPY/call, operation-based billing |

`one_time` and `bundle` are reserved values. Do not use them in new manifests.

## Free APIs

Use free pricing when the API call itself should never create a Siglume payment:

```python
manifest = AppManifest(
    # required identity, permission, docs, support, jurisdiction fields...
    price_model=PriceModel.FREE,
    price_value_minor=0,
    currency="JPY",
    allow_free_trial=False,
)
```

Free does not mean the outside world is free. A shopping finder API can be free
while the product price, shipping, tax, and merchant checkout remain outside
Siglume.

## Subscription APIs

Use subscription pricing when buyers pay for ongoing access, independent of the
exact operation executed:

```python
manifest = AppManifest(
    # required identity, permission, docs, support, jurisdiction fields...
    price_model=PriceModel.SUBSCRIPTION,
    price_value_minor=500,
    currency="USD",
    allow_free_trial=False,
)
```

Subscription prices are monthly minor units: USD cents for `USD`, JPY yen for
`JPY`. Paid subscription listings require payout readiness before production
publish. Revenue settles to the seller's Siglume embedded wallet.

Do not use `permission_class="payment"` just because the listing is paid.
`permission_class` describes what the API does during execution. A paid API that
posts to X is still `ACTION`; a paid API that only reads data can still be
`READ_ONLY`.

## Operation-Based Billing

Use `usage_based` or `per_action` when one API package contains request types
with different prices.

Examples:

- connection check: 0 JPY
- dry-run preview: 0 JPY
- text-only X post: 15 JPY
- X post with URL: 28 JPY
- X post with image: 35 JPY
- X reply: 30 JPY

The listing call can start without a flat upfront charge. The operation price is
selected from `pricing_plan.items`.

```python
manifest = AppManifest(
    # required identity, permission, docs, support, jurisdiction fields...
    permission_class=PermissionClass.ACTION,
    approval_mode=ApprovalMode.ALWAYS_ASK,
    dry_run_supported=True,
    price_model=PriceModel.PER_ACTION,
    price_value_minor=0,
    currency="JPY",
    allow_free_trial=False,
    pricing_plan={
        "display_name": "X post operation prices",
        "currency": "JPY",
        "free_upfront_invocation": True,
        "items": [
            {"key": "connection_check", "label": "Connection check", "price_minor": 0},
            {"key": "dry_run", "label": "Dry-run preview", "price_minor": 0},
            {"key": "text_only", "label": "Text only post", "price_minor": 15},
            {"key": "text_with_url", "label": "Text post with URL", "price_minor": 28},
            {"key": "reply", "label": "Reply", "price_minor": 30},
        ],
    },
)
```

Rules:

- `pricing_plan.items` is required for `usage_based` and `per_action`.
- Each item needs a stable key. The runtime receipt must return the same key.
- `price_value_minor=0` is the normal setting when the amount varies by
  operation.
- A `0`-priced operation is free and creates no on-chain payment.
- For JPY/JPYC operation billing, paid operations must be `0` or at least `15`
  minor units. Amounts from `1` to `14` are rejected by the SDK and platform.
- The `pricing_plan` is authoritative. The platform will not charge an arbitrary
  positive amount just because the API returned it.

The runtime result identifies the operation that actually ran:

```python
return ExecutionResult(
    success=True,
    output={"posted": True, "post_url": "https://x.com/..."},
    units_consumed=1,
    amount_minor=28,
    currency="JPY",
    receipt_summary={
        "operation": "text_with_url",
        "amount_minor": 28,
        "currency": "JPY",
    },
)
```

Accepted operation-key fields are `operation`, `operation_key`, `request_type`,
`pricing_key`, `price_key`, `receipt_code`, and `action`. Prefer
`receipt_summary["operation"]` for new APIs.

`units_consumed` is recorded for receipts and analytics. In the current
request-type pricing plan, it does not multiply the item price.

## Billing Timing: post vs prepay

`billing_timing` controls whether payment happens after execution or before an
irreversible live action.

| Timing | Manifest value | Flow | Use for |
|---|---|---|---|
| Post execution | omit or `billing_timing="post"` | API executes, returns a receipt, then the platform settles the matching positive plan item | Read-only, reversible, or low-risk operations |
| Prepay on quote | `billing_timing="prepay"` | Platform requests a quote/dry-run, prices the quoted operation, collects payment, then calls the live action with the quoted token | Irreversible side effects such as posting to X |

For `prepay`, your API must support a quote/dry-run path that returns enough
data for the platform to bind the later action to the paid quote:

```python
if ctx.execution_kind in {ExecutionKind.DRY_RUN, ExecutionKind.QUOTE}:
    return ExecutionResult(
        success=True,
        execution_kind=ctx.execution_kind,
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
        receipt_summary={
            "operation": "dry_run",
            "amount_minor": 0,
            "currency": "JPY",
        },
    )
```

When payment is confirmed, the platform calls the live action and injects the
same token as `commit_token` using the runtime validation token mapping. If
payment fails, the live ACTION call is not made.

Two things trip up new prepay integrations:

- **`billingPreview.operation` is the chargeable band, and it lives in `output`.** The
  platform reads it at `output.billingPreview.operation` on the **quote** leg — *not* from
  `receipt_summary.operation`, which on the quote leg is the literal `"dry_run"`/`"quote"`.
  See [Execution Receipts → Wire shape](./execution-receipts.md#wire-shape-output-is-nested-receipt_summary-is-a-sibling).
- **One band value, three places.** `billingPreview.operation` (quote) **must equal** the
  action-leg `receipt_summary.operation` **must equal** a `pricing_plan.items[].key`.
  `priceMinorIfActionSucceeds` is **advisory** — the platform charges the *registered plan
  amount* for that key, never the number your preview reports.

Important boundary: prepay prevents "action executed before payment". It does
not automatically refund a confirmed payment if the seller API or external
provider fails after the paid live action starts. Your API should make the
quote/dry-run validate connection, policy, idempotency, and provider readiness,
and should return a failed or zero-priced receipt for known no-op outcomes.

This applies with full force to **async** APIs, where settlement happens on
**acceptance**: if you return `{accepted: true, job_id}` and the job later fails in your
worker, the buyer is already charged and the platform does **not** auto-refund — you own
the refund/repair. Accept conservatively (validate in the free quote leg) and declare your
policy in `ToolManual.refund_or_cancellation_note`. See
[Async / long-running two-phase APIs](./async-two-phase-apis.md).

Siglume owns payment, authorization, pricing-plan lookup, idempotency keys,
slot/retry state, and reconciliation state. Your API owns the external
side effect and the provider-specific proof that it committed. The platform
does not inspect or infer product-specific delivery such as whether an X post,
email, CRM write, booking, or other provider action actually happened. A paid
live action is treated as delivered only when the API returns a successful
contract result with committed evidence such as `posted=true`, `post_url`,
`provider_post_id`, `message_id`, `reservation_id`, or an equivalent stable
provider-side id for that API.

For prepay actions, `status="ready"`, draft-only output, preview output,
`accepted=false`, timeouts without a committed provider id, and mismatched
operation/amount/currency are not delivered results. The platform records the
platform-owned failure/retry/reconciliation state; the API owner must inspect
and repair provider-specific delivery. See
[Platform / API Responsibility Boundary](./platform-api-boundary.md).

**Long-running work (async two-phase).** If your action cannot finish within the invoke
timeout, the action leg may instead *accept* the job and deliver later. It returns
`{accepted: true, job_id, status: "queued"}` (settlement happens on acceptance), and a
separate **free** terminal op (`get_result`/`status`, a `0`-priced plan key with no
`billingPreview`) returns the artifacts. This `accepted: true` + `job_id` + `queued`
envelope is an *accepted, deferred* result — it is **not** one of the non-delivery shapes
above. See [Async / long-running two-phase APIs](./async-two-phase-apis.md).

## Choosing Between usage_based And per_action

Use `per_action` when the price is tied to a named operation/request type:
`text_only`, `text_with_url`, `reply`, `image_generation`, and similar.

Use `usage_based` when the operation still maps to a plan item but the product
is conceptually metered usage. The current live plan still charges the matched
plan item. Do not rely on `units_consumed * price_value_minor` for API Store
runtime billing unless a future explicit metered-quantity plan is introduced.

## Store Display

API Store and Game API Store use `pricing_plan` for buyer-facing display.

Examples:

- all free operations: `FREE`
- subscription: monthly price
- operation-based paid plan: `from 15 JPY/call` plus an operation-based billing
  badge
- prepay operation billing: "free before payment" or equivalent copy, with the
  plan table showing operation prices

Do not describe a `usage_based` or `per_action` listing as free just because
`price_value_minor=0`. The free value only means there is no flat per-request
price; the operation plan may still contain paid items.

## Inspecting Logs And Billing Evidence

After registration or a live run, use the developer observability surface:

```bash
# Owner/session surface.
siglume dev tail

# Publisher/API-key surface.
siglume dev tail --listing-id listing_123
```

The owner-scoped command shows receipts for your own account. The listing-scoped
command is for publishers and is privacy-redacted: it confirms status, timing,
step counts, operation evidence, and support identifiers without exposing buyer
prompts or private agent details.

Python SDK equivalents:

```python
# Owner/session bearer: owner account execution receipts.
client.list_execution_receipts(status="failed", limit=20)

# SIGLUME_API_KEY / cli_...: publisher listing receipts.
client.list_listing_recent_receipts("listing_123", limit=20)
```

See [Developer Observability](./developer-observability.md) for the full CLI,
SDK, installed-tool receipt, and support checklist.

## Checklist

Before publishing operation-based billing:

- [ ] `price_model` is `usage_based` or `per_action`.
- [ ] `price_value_minor=0` when operation prices vary.
- [ ] `pricing_plan.items` includes every billable and free operation key.
- [ ] Positive JPY/JPYC operation prices are at least `15`.
- [ ] Runtime receipts return the executed operation key.
- [ ] Free/no-op operations return `amount_minor=0`.
- [ ] Irreversible side effects use `billing_timing="prepay"`.
- [ ] The quote/dry-run path returns `billingPreview.operation` and `draftToken`.
- [ ] The action path is idempotent and verifies the quoted token before acting.
- [ ] The action path returns committed provider evidence only after the side
      effect committed.
- [ ] Draft-only, preview, ambiguous, or `status="ready"` live-action results
      are treated as not delivered by your API.
- [ ] `billingPreview.operation` (quote) = action `receipt_summary.operation` =
      a `pricing_plan.items[].key`; `priceMinorIfActionSucceeds` is advisory.
- [ ] If the action is long-running, it returns `{accepted: true, job_id,
      status: "queued"}` and a free `0`-priced terminal op returns the result —
      see [Async / long-running two-phase APIs](./async-two-phase-apis.md).
- [ ] You know how to inspect receipts with `siglume dev tail --listing-id`.
