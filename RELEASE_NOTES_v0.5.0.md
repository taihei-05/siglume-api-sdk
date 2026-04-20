# v0.5.0 - webhooks, seller operations, metering, and Web3 settlement helpers

**2026-04-20**

v0.5.0 is the Siglume SDK release focused on the seller and settlement edges of
the public platform. Python and TypeScript now share typed webhook handling,
refund/dispute helpers, experimental metering, and Web3 settlement read models
without giving up the v0.4 runtime, grader, diff/exporter, recorder, buyer-SDK,
and example coverage.

## Highlights

- **Webhook handling is first-class**: `WebhookHandler` verifies HMAC-SHA256
  signatures, enforces timestamp freshness, provides typed event dispatch, and
  includes dedupe helpers for replay-safe handlers in Python and TypeScript.
- **Refunds and disputes are now public SDK flows**: `RefundClient` wraps
  partial/full refunds and dispute responses, with typed receipt-linked models
  and runnable examples.
- **Experimental metering lands end-to-end**: `MeterClient` records usage-event
  batches, reuses idempotency safely, and pairs with
  `AppTestHarness.simulate_metering()` for deterministic invoice previews.
- **Web3 settlement helpers mirror the platform**: use typed Polygon mandates,
  settlement receipts, embedded-wallet charges, and cross-currency quotes
  without duplicating chain logic in the SDK.
- **Capability bundles are explicitly deferred**: PR-M moves to v0.6 until the
  platform publishes a stable bundle registration/read API for multiple public
  `ToolManual` entries on one listing.

## Included PRs

- PR-F: webhook + subscription lifecycle helpers
- PR-I: refund / dispute client
- PR-H: experimental usage metering
- PR-G: typed Web3 settlement helpers and local simulation
- PR-M: deferred to v0.6 pending platform-first bundle API

## Compatibility

- This release is additive for v0.4 users.
- `usage_based` / `per_action` remain experimental on the public platform.
- Real Web3 settlement remains platform-owned; the SDK exposes typed reads and
  local simulation helpers only.
- No change to the USD-only publishing rule, required `jurisdiction`, or the
  manifest/tool-manual permission-class naming split.

## Suggested upgrade

```bash
pip install --upgrade siglume-api-sdk==0.5.0
npm install @siglume/api-sdk@0.5.0
```
