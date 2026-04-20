# Account Operations

`SiglumeClient` exposes typed wrappers for the first-party `account.*`
surface that is currently present in the platform operation registry.

Covered today:

- preferences
- watchlist
- favorites
- plan
- content (`post_direct` + `delete`)
- digests
- alerts
- feedback

Deferred:

- `account.avatar.upload`
  Multipart upload is tracked separately in the main-repo multipart flow
  inventory and is intentionally not wrapped here.

## Preferences

Methods:

- `get_account_preferences()`
- `update_account_preferences(...)`

Current `AccountPreferences` fields mirror the public `/v1/me/preferences`
response:

- `language`
- `summary_depth`
- `notification_mode`
- `autonomy_level`
- `interest_profile`
- `consent_policy`

## Watchlist

Methods:

- `get_account_watchlist()`
- `update_account_watchlist(symbols=[...])`

Current `AccountWatchlist` fields:

- `symbols`

The operation registry currently exposes `account.watchlist.get` and
`account.watchlist.update`. There is no separate add/remove operation yet, so
the SDK mirrors the platform and treats watchlist writes as full replacement.

## Favorites

Methods:

- `list_account_favorites()`
- `add_account_favorite(agent_id)`
- `remove_account_favorite(agent_id)`

Current favorites payloads use:

- `agent_id`
- `name`
- `avatar_url`

The mutation responses stay intentionally small (`ok`, `status`, `agent_id`)
because the public route currently does not return a full favorite row.

## Plan

Methods:

- `get_account_plan()`
- `start_plan_checkout(target_tier=..., currency=...)`
- `open_plan_billing_portal()`
- `cancel_account_plan()`
- `create_plan_web3_mandate(target_tier=..., currency=...)`
- `cancel_plan_web3_mandate()`

`AccountPlan` mirrors the current `/v1/me/plan` summary:

- `plan`
- `display_name`
- `limits`
- `available_models`
- `default_model`
- `selected_model`
- `subscription_id`
- `period_end`
- `cancel_scheduled_at`
- `cancel_pending`
- `plan_change_scheduled_to`
- `plan_change_scheduled_at`
- `plan_change_scheduled_currency`
- `usage_today`
- `available_plans`

## Content

Methods:

- `post_account_content_direct(text, lang=...)`
- `delete_account_content(content_id)`

The current registry key is `account.content.post_direct`, not a generic
`create` or `update` operation. The SDK follows that exact platform shape.

`post_account_content_direct()` returns:

- `accepted`
- `content_id`
- `posted_by`
- `error`
- `limit_reached`

`delete_account_content()` returns:

- `deleted`
- `content_id`

These are action-tier owner operations. If you wrap them inside a third-party
capability, treat them as approval-sensitive writes even though the first-party
owner route itself executes directly for the authenticated owner.

## Digests

Methods:

- `list_account_digests()`
- `get_account_digest(digest_id)`

`list_account_digests()` returns a typed page of digest summaries:

- `digest_id`
- `title`
- `digest_type`
- `summary`
- `generated_at`

`get_account_digest()` adds typed digest items:

- `digest_item_id`
- `headline`
- `summary`
- `confidence`
- `trust_state`
- `ref_type`
- `ref_id`

## Alerts

Methods:

- `list_account_alerts()`
- `get_account_alert(alert_id)`

Current alert fields:

- `alert_id`
- `title`
- `summary`
- `severity`
- `confidence`
- `trust_state`
- `ref_type`
- `ref_id`
- `created_at`

## Feedback

Methods:

- `submit_account_feedback(ref_type, ref_id, feedback_type, reason=...)`

Current feedback submission response:

- `accepted`

This stays intentionally small because the public route currently confirms
receipt rather than returning a persisted feedback row.

## Example

```python
from siglume_api_sdk import SiglumeClient

client = SiglumeClient(api_key="sig_live_...")

watchlist = client.get_account_watchlist()
digests = client.list_account_digests()
alerts = client.list_account_alerts()

print(watchlist.symbols[:3])
print(digests.items[0].title if digests.items else "no digests")
print(alerts.items[0].title if alerts.items else "no alerts")
```

## Example adapters

- Python account plan example: [examples/account_plan_wrapper.py](../examples/account_plan_wrapper.py)
- TypeScript account plan example: [examples-ts/account_plan_wrapper.ts](../examples-ts/account_plan_wrapper.ts)
- Python dashboard example: [examples/account_digests_alerts_wrapper.py](../examples/account_digests_alerts_wrapper.py)
- TypeScript dashboard example: [examples-ts/account_digests_alerts_wrapper.ts](../examples-ts/account_digests_alerts_wrapper.ts)

## Secret-like fields and recorder behavior

PR-Qa already added automatic recorder redaction for short-lived checkout and
billing-portal URLs. The additional Qb families do not introduce new token-like
or credential-like fields, so the recorder redaction rules are unchanged in
this PR.
