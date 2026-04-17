# Payment Migration: Stripe Connect → On-Chain Smart Wallet

**Status:** in progress — server-side implementation underway
**Last updated:** 2026-04-18

The Siglume Agent API Store is retiring its Stripe Connect payout stack and moving to **fully on-chain settlement**. This document tracks the migration so SDK users know what works today vs. what is changing.

## The new model

| Aspect | New behavior |
|---|---|
| Settlement | On-chain (wallet-to-wallet) |
| Developer wallet | **Embedded smart wallet** created for you — no external wallet needed |
| Gas | **Covered by the platform** — developers and buyers never touch gas tokens |
| Subscription mechanism | **Auto-debit** via session-key-bound transfers; no manual renewals |
| Login | Unchanged — Siglume login/OAuth keeps working; wallet is attached to the existing account |
| Stripe dependency | **None.** The new stack is independent of Stripe (including Stripe Crypto) |

The headline numbers are unchanged: **developer share remains 93.4%**, platform fee is **6.6%**, minimum subscription price is **$5/month equivalent** (the exact on-chain currency will be announced when the server cutover lands).

## What still works today

- Everything in the **READ_ONLY** and **ACTION** permission classes — publishing, registering, executing, receipts, tool-manual validation.
- **Free** listings (`price_model="free"`) — unaffected by the payment change.
- SDK types, validators, and examples for non-payment flows — stable.

## What is paused / changing

- **`price_model="subscription"` publish flow** — the onboarding step that required a Stripe Connect account is being replaced. Until the on-chain equivalent lands, new paid subscription publishes are paused server-side. Existing free listings can still be registered.
- **`SettlementMode` enum values** (`stripe_checkout`, `stripe_payment_intent`) — will be superseded by on-chain values in an upcoming SDK release. The enum is frozen on current values until the server contract stabilises; a follow-up SDK release will change them.
- **`PAYMENT` permission class examples** — `examples/metamask_connector.py` will be rewritten to demonstrate the new embedded-wallet + gas-sponsored flow once the server contract is finalised.
- Any doc text that reads "Stripe Connect" as the live mechanism — being rewritten to describe the on-chain flow.

## Why the pivot

The current beta of the SDK talks about Stripe Connect as the only settlement path. Moving to on-chain:

- Removes the per-country Stripe Connect onboarding friction (developers anywhere with a Siglume account can receive revenue without bank-account paperwork).
- Removes the dependency on Stripe's policy surface for AI-agent transactions.
- Matches the automatability story — agents subscribe to APIs, so settlement that doesn't need human intervention (auto-debit from session-key-bound transfers) fits better than Stripe checkout flows that assume a human at a browser.

Embedded wallets + gas sponsorship mean this is **not** a "bring your own MetaMask" pivot. Developers and buyers will not see chain mechanics unless they look.

## For SDK users, right now

1. **If your API is READ_ONLY / ACTION / free:** nothing to do. Keep building. The SDK's public API, validators, and examples are unchanged for your flow.
2. **If you were about to publish a paid subscription API:** wait for the next SDK release. The `SettlementMode` enum will change and you will want to re-register with the new values. The alternative — registering now with Stripe values that are about to be retired — will force re-registration later.
3. **If you already published a paid subscription API on a previous SDK version:** platform-side migration tooling is part of Codex's current work. No action required from you.

## Tracking

- Server-side implementation: tracked by Codex internally (main-repo `siglume` branch).
- SDK-side type / enum changes: tracked as a follow-up issue in this repo (linked from the release notes of the SDK version that lands the changes).
- This doc will be updated when the server cutover is live.
