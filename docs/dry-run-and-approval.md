# Dry Run and Approval Guide

Action and payment APIs must be safe by default.

## Execution Kinds

### `dry_run`

Preview what would happen without side effects.

Use this to return:

- candidate actions
- quotes
- estimated cost
- approval text

### `quote`

Return a priced or time-bounded estimate without committing.

### `action`

Perform a non-financial state change.

Examples:

- create a draft post
- create a reservation
- add an item to a cart

### `payment`

Perform a financial action only after explicit safeguards.

Examples:

- place a purchase
- charge a payment method
- submit a wallet transaction

## Approval Expectations

- `read-only` APIs can often use `auto`
- `action` and `payment` APIs should generally use `always-ask` or `budget-bounded`
- approval prompts should be short, specific, and human-readable

## Billing timing

Free, subscription, `usage_based`, and `per_action` listings are live. Billing
model and permission class are separate choices: a paid API can still be
`READ_ONLY`, and a free API can still be `ACTION` if it changes external state.

For operation-based billing, choose the timing explicitly:

- `billing_timing="post"`: execute first, then the platform settles the matching
  positive `pricing_plan` item from the execution receipt. This is the default.
- `billing_timing="prepay"`: quote first, collect payment for the quoted
  operation, then call the live action. Use this for irreversible side effects
  such as posting to X.

For `prepay`, the quote/dry-run response must include a stable `draftToken` and
`billingPreview.operation` matching a `pricing_plan.items[].key`. The action
handler must accept the same token as the configured commit token and must not
recompute a different operation after payment.

The platform does not own your product-specific side effect. It owns payment,
authorization, idempotency, and platform state; your API owns the live provider
action and the proof that it committed. A live action response must clearly
distinguish committed output from preview output. Do not return `status="ready"`
or a draft-only response from the action endpoint as if the live action
succeeded. Return committed evidence only after the external action happened,
and make retries with the same token/idempotency key return the same committed
provider id instead of creating a duplicate side effect.

See [Platform / API Responsibility Boundary](./platform-api-boundary.md) for
the complete contract.

## Example

```python
if ctx.execution_kind == ExecutionKind.DRY_RUN:
    return ExecutionResult(
        success=True,
        execution_kind=ExecutionKind.DRY_RUN,
        output={"preview": "Will post 1 tweet"},
        receipt_summary={"operation": "dry_run", "amount_minor": 0, "currency": "JPY"},
        needs_approval=True,
        approval_prompt="Post this summary to X?",
    )
```

See [Pricing And Billing](./pricing-and-billing.md) for a complete prepay quote
example.
