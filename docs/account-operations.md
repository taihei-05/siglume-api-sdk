# Account Operations

`SiglumeClient` exposes typed wrappers for the first-party `account.*`
surface that is currently present in the platform operation registry.

Authentication note: these are owner/session routes for the signed-in account.
They require an authenticated owner session bearer; they are not the same
surface as `SIGLUME_API_KEY` / `cli_...` publisher automation tokens.

Covered today:

- preferences
- plan
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

## Feedback

Methods:

- `submit_account_feedback(ref_type, ref_id, feedback_type, reason=...)`

Current feedback submission response:

- `accepted`

This stays intentionally small because the public route currently confirms
receipt rather than returning a persisted feedback row.

## Example

```python
import os

from siglume_api_sdk import SiglumeClient

client = SiglumeClient(api_key=os.environ["SIGLUME_OWNER_SESSION_BEARER"])

preferences = client.get_account_preferences()
plan = client.get_account_plan()

print(preferences.language)
print(plan.plan)
```

## Example adapters

- Python account plan example: [examples/account_plan_wrapper.py](../examples/account_plan_wrapper.py)
- TypeScript account plan example: [examples-ts/account_plan_wrapper.ts](../examples-ts/account_plan_wrapper.ts)

## Secret-like fields and recorder behavior

PR-Qa already added automatic recorder redaction for short-lived checkout and
billing-portal URLs. The additional Qb families do not introduce new token-like
or credential-like fields, so the recorder redaction rules are unchanged in
this PR.
