# Permission Scopes Guide

Choose the smallest scope set that still lets your API do its job.

## Principle

- Start from `read-only`
- Add scopes only when the API truly needs them
- Keep scope names explicit and task-oriented
- Match `permission_scopes` to the behavior described in `job_to_be_done`

## Permission Classes

### `read-only`

Use this when the API only fetches or summarizes data.

Typical scopes:

- `catalog.read`
- `reviews.read`
- `calendar.read`
- `crm.read`

### Compare or propose without committing

Use `read-only` when the API compares, scores, quotes, or proposes actions
without changing external state. `recommendation` is a deprecated
manifest-only alias of `read-only`; do not use it in new manifests, and do not
use it in Tool Manual `permission_class`.

Typical scopes:

- `quote.preview`
- `comparison.run`
- `draft.preview`

### `action`

Use this when the API changes external state but does not move money.

Typical scopes:

- `tweet.write`
- `calendar.write`
- `cart.write`
- `reservation.create`

### `payment`

Use this when the API can place orders, settle charges, or move funds.

Typical scopes:

- `payment.charge`
- `order.place`
- `wallet.send`
- `settlement.capture`

## Review Expectations

- Scope names should be human-readable
- Requested scopes should be explainable in one sentence
- Extra scopes increase review friction
- `action` and `payment` APIs should always pair scopes with `dry_run_supported=true`

## Example

```json
{
  "permission_class": "action",
  "permission_scopes": [
    "tweet.write",
    "tweet.read",
    "users.read"
  ]
}
```
