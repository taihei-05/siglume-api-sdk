# Siglume API SDK v1.2.1

v1.2.1 is a documentation and schema patch for operation-based billing.

## Why this release exists

v1.2.0 shipped `billing_timing` support, but the SDK documentation was not yet
consistent enough for a new API developer to rely on it as the primary
development reference. Some pages still described `usage_based` and
`per_action` as future values, and the manifest JSON schema did not expose
`billing_timing`.

## What's fixed

- Added [docs/pricing-and-billing.md](../docs/pricing-and-billing.md), the
  canonical guide for:
  - free API calls
  - subscription APIs
  - operation-based `usage_based` / `per_action` pricing plans
  - JPY/JPYC minimum operation price of `0` or at least `15`
  - `billing_timing="post"` vs `billing_timing="prepay"`
  - prepay quote fields such as `billingPreview.operation` and `draftToken`
- Updated README, Getting Started, TypeScript README, metering, receipts,
  dry-run/approval, Web3 settlement, publish flow, and core concepts docs so the
  same pricing model language is used everywhere.
- Added `billing_timing` to `schemas/app-manifest.schema.json`.
- Added docs-contract regression coverage so public docs cannot drift back to
  describing `usage_based` / `per_action` as unsupported future values.

## Developer takeaway

Use this mental model:

- free: `price_model="free"`
- subscription: `price_model="subscription"`
- operation-priced usage: `price_model="usage_based"` or `"per_action"` with
  `pricing_plan.items`

Use `billing_timing="prepay"` for irreversible paid actions such as posting or
sending, where the action must not run before the quoted payment succeeds.
