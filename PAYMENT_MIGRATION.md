# Payment Migration: Stripe Connect → Polygon On-Chain Settlement

The Siglume API Store is moving from Stripe Connect to Polygon-based
on-chain settlement. This page summarizes what that means for SDK
users — seller developers publishing APIs, and buyer-side callers
invoking them.

## The new model

| Aspect | Behavior |
|---|---|
| Chain | Polygon (mainnet chain id 137) |
| Developer wallet | **Embedded smart wallet** — created for you. No external wallet required. |
| Gas | **Covered by the platform.** Developers and buyers never hold MATIC/POL. |
| Settlement tokens | **USDC** and **JPYC** (ERC-20 on Polygon) |
| Revenue split | **93.4% to developer, 6.6% platform fee** (unchanged from the Stripe-era model) |
| Minimum paid price | $5/month equivalent for subscription APIs |
| Free APIs | Supported; no wallet setup required for free listings |
| Buyer UX | Subscribe once from the store UI. Subsequent invocations auto-debit from the buyer's embedded wallet — no re-authorization per call. |

## What works today

- **Free listings**: fully live. Register without any payout setup.
- **Paid subscriptions**: live on Polygon. Set up a verified Polygon
  payout address on the `/owner/publish` → `Settings` tab when you
  register.
- **Buyer-side invocation**: `SiglumeBuyerClient.invoke()` works
  against both free and paid listings (experimental — see
  [docs/buyer-sdk.md](./docs/buyer-sdk.md)).
- **Refunds / disputes**: `RefundClient` works against receipt-backed
  charges regardless of which rail settled them. See
  [docs/refunds-disputes.md](./docs/refunds-disputes.md).
- **Webhooks**: same `subscription.*`, `payment.*`, `refund.issued`
  event types across both rails. No seller-side code change needed.
  See [docs/webhooks.md](./docs/webhooks.md).

## What is different from the Stripe era

- You no longer complete a Stripe Connect onboarding flow. You do not
  hand Siglume a Stripe account id. Payouts settle into your
  embedded smart wallet, which is created and managed for you when
  you register your Polygon payout address.
- You do not pay gas fees. The platform sponsors gas for both the
  buyer's auto-debit and your payout settlement.
- The public SDK's typed settlement helpers in
  [docs/web3-settlement.md](./docs/web3-settlement.md) give you
  read-only views of Polygon mandate / receipt / embedded-wallet
  charge / cross-currency quote data. Local simulation helpers
  (`AppTestHarness.simulate_*`) let you dry-run settlement flows
  without touching mainnet.
- Currency conversion (USDC ↔ JPYC) is handled through the
  platform's 0x integration. You declare a single `jurisdiction`
  and `currency` on the manifest; cross-currency quoting is
  platform-owned.

## What does not change

- The `AppAdapter` / `AppManifest` / `ToolManual` contract.
- The 93.4% developer share and 6.6% platform fee.
- The grade-B tool-manual quality bar.
- The admin-review step before listings go live.
- Stripe-era subscriptions that predate the cutover remain active
  under Stripe Connect until they renew or cancel. No action needed
  from existing sellers; new activity settles on Polygon.

## Suggested next reads

- [GETTING_STARTED.md](./GETTING_STARTED.md) — end-to-end publishing flow
- [docs/web3-settlement.md](./docs/web3-settlement.md) — typed Polygon read/simulate helpers
- [docs/jurisdiction-and-compliance.md](./docs/jurisdiction-and-compliance.md) — how currency and jurisdiction are declared on the manifest
- [docs/refunds-disputes.md](./docs/refunds-disputes.md) — seller-side refund / dispute flow
