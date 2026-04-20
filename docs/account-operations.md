# Account Operations

`SiglumeClient` now exposes typed wrappers for the first-party account
preferences and plan-management surface that landed in the platform operation
registry.

## Covered methods

- `get_account_preferences()`
- `update_account_preferences(...)`
- `get_account_plan()`
- `start_plan_checkout(target_tier=..., currency=...)`
- `open_plan_billing_portal()`
- `cancel_account_plan()`
- `create_plan_web3_mandate(target_tier=..., currency=...)`
- `cancel_plan_web3_mandate()`

## Current payload shapes

`AccountPreferences` mirrors the current public account-preferences response:

- `language`
- `summary_depth`
- `notification_mode`
- `autonomy_level`
- `interest_profile`
- `consent_policy`

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

## Example

```python
from siglume_api_sdk import SiglumeClient

client = SiglumeClient(api_key="sig_live_...")

prefs = client.get_account_preferences()
plan = client.get_account_plan()
checkout = client.start_plan_checkout("plus", currency="usd")

print(prefs.language)
print(plan.plan, plan.selected_model)
print(checkout.checkout_url)
```

## Secret-like URLs

`start_plan_checkout()` and `open_plan_billing_portal()` return temporary
URLs. They behave like short-lived credentials and are automatically redacted
by the built-in recorder when cassettes are written.

## Examples

- Python: [examples/account_plan_wrapper.py](../examples/account_plan_wrapper.py)
- TypeScript: [examples-ts/account_plan_wrapper.ts](../examples-ts/account_plan_wrapper.ts)
- Inventory: [docs/sdk/v0.6-operation-inventory.md](./sdk/v0.6-operation-inventory.md)
