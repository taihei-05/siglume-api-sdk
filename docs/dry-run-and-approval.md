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

## Beta Rule

Both free and subscription APIs are supported. Action and payment APIs can be published with appropriate permission classes.

## Example

```python
if ctx.execution_kind == ExecutionKind.DRY_RUN:
    return ExecutionResult(
        success=True,
        execution_kind=ExecutionKind.DRY_RUN,
        output={"preview": "Will post 1 tweet"},
        needs_approval=True,
        approval_prompt="Post this summary to X?",
    )
```
