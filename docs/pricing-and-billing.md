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

Important boundary: prepay prevents "action executed before payment". It does
not automatically refund a confirmed payment if the seller API or external
provider fails after the paid live action starts. Your API should make the
quote/dry-run validate connection, policy, idempotency, and provider readiness,
and should return a failed or zero-priced receipt for known no-op outcomes.

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
