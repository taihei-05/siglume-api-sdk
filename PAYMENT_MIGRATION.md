# Payment Migration: Stripe Connect → Polygon On-Chain Smart Wallet

**Status:** Phases 1–5 shipped (contract shape → Solidity → deploy+indexer → calldata planning → submit endpoint with manual tx_hash paste). Automated Turnkey/Safe signing + broadcasting + real 0x swap still pending.
**Last updated:** 2026-04-18

The Siglume Agent API Store is retiring its Stripe Connect payout stack and moving to **Polygon-based on-chain settlement**. This document tracks the migration so SDK users know what works today vs. what is changing.

## The new model

| Aspect | New behavior |
|---|---|
| Chain | **Polygon** (mainnet chain id 137; testnet Amoy chain id 80002) |
| Developer wallet | **Embedded smart wallet** (Safe-style smart account) created for you — no external wallet needed |
| Gas | **Covered by the platform** — developers and buyers never hold POL/MATIC |
| Settlement tokens | **USDC** and **JPYC** (ERC-20 on Polygon) |
| Subscription mechanism | **Payment mandate** (session-key-scoped auto-debit); no manual renewals |
| Swap provider | **0x Protocol** (polygon.api.0x.org) for USDC↔JPYC and other stable conversions |
| Finality | 12 confirmations before a receipt is projected as settled |
| Login | Unchanged — Siglume login/OAuth keeps working; wallet is attached to the existing account |
| Stripe dependency | **None.** The new stack does not use Stripe and does not use Stripe Crypto |

The headline numbers are unchanged: **developer share remains 93.4%**, platform fee is **6.6%**, minimum subscription price is **$5/month equivalent** (settled in USDC or JPYC).

## Server-side state (2026-04-18)

### Phase 1 — API / DB / GUI shape (shipped, mock-backed)

Behind the default-on `economy_web3_adapter_enabled` flag:

- **DB**: `user_wallet`, `payment_mandate`, `chain_receipt`, `chain_cursor` tables (migration `0044_web3_payment_foundation`).
- **Provider**: `polygon_wallet` canonical settlement-provider key (aliases: `polygon`, `web3`, `web3_wallet`, `onchain`, `on_chain`). Payout destinations store a Polygon address with checksum validation.
- **API**: `/v1/market/web3/*` endpoints for wallet lookup, token list, swap quote, mandate CRUD, and receipt listing.
- **Admin API**: `/v1/admin/market/web3/project` triggers the projector (see Phase 2).
- **Owner GUI**: `/owner/credits` (OwnerWalletPage) shows the Polygon Smart Wallet, active mandates, receipts, and swap quotes. `/owner/publish` Settings tab accepts a Polygon address for payout.

### Phase 2 — Solidity contracts + backend projector (shipped)

- **Smart contracts** in `packages/contracts/web3-payments/` (Solidity 0.8.24, OpenZeppelin):
  - `SubscriptionHub` — mandate-based recurring charges; `Cadence` enum (Daily/Monthly), per-charge `maxAmountMinor`, `feeBps` split to `FeeVault`, `purposeHash` for intent binding, `nextChargeAt` gating.
  - `AdsBillingHub` — metered ad-style billing (supports the `USAGE_BASED` / `PER_ACTION` price axis that was previously reserved in the SDK enum).
  - `WorksEscrowHub` — AIWorks escrow with release / refund paths.
  - `FeeVault` — protocol fee custody (the 6.6% platform fee lives here on-chain).
  - `base/AllowedTokens` — token allowlist; only native Polygon USDC and official Polygon JPYC are expected to be allowlisted.
  - `base/RelayerAuthorizable` — relayer auth base enabling platform-sponsored gas.
- **Hardhat tests** (`test/Web3Payments.test.js`): 4 passing — fee split, monthly cap, escrow release/refund, unsupported-token reject.
- **Backend projector** (`packages/shared-python/agent_sns/application/web3_projector.py`): updates `chain_cursor`, reflects `chain_receipt`, projects `payment_mandate` success/failure retries, and projects minimal plan / partner state from on-chain events. Invoked admin-side via `/v1/admin/market/web3/project`.

### Phase 3 — deploy flow + on-chain indexer (shipped)

- **Hardhat deploy script** (`packages/contracts/web3-payments/scripts/deploy.js`) writes a per-network manifest to `packages/contracts/web3-payments/deployments/<network>.json`. Networks: `polygon` (mainnet), `polygonAmoy` (testnet), plus local Hardhat.
- **Backend manifest loader** (`packages/shared-python/agent_sns/application/web3_contracts.py`) reads that JSON so the backend knows the deployed addresses + ABIs without hardcoding.
- **On-chain indexer** (`packages/shared-python/agent_sns/application/web3_indexer.py`) — JSON-RPC-based poller that pulls `eth_getLogs` for events emitted by `SubscriptionHub` / `AdsBillingHub` / `WorksEscrowHub` / `FeeVault`, advances `chain_cursor`, writes `chain_receipt`, and feeds mandate-state projection. Still admin-triggered rather than a resident daemon.
- **Admin API additions**:
  - `GET /v1/admin/market/web3/contracts` — returns the loaded deployment manifest (addresses + network + deploy tx).
  - `POST /v1/admin/market/web3/sync` — runs one indexer pass against the configured RPC.
- **Settings + `.env.example`** extended with the RPC URLs, token addresses, and indexer knobs that the new code expects.

### Phase 4 — real contract calldata planning (shipped)

- **Transaction planner** (`packages/shared-python/agent_sns/application/web3_tx_plans.py`) builds real EVM calldata for `SubscriptionHub` and `AdsBillingHub` using the Phase 3 deployment manifest. Output per mandate includes `to`, `selector`, `data`, and `expected_event`.
- **`create_payment_mandate` / `cancel_payment_mandate`** in `web3_payments.py` now return a `transaction_request` (create) and `cancel_transaction_request` (cancel) alongside the usual mandate payload. These are contract-ready: signing them and broadcasting to Polygon would move real funds.
- **Owner GUI** (`OwnerWalletPage.tsx`) renders the `transaction_request` + `cancel_transaction_request` so a developer can inspect the exact calldata before the signer layer lands.
- **Schema** (`presentation/schemas.py`) — the new plan shape is now part of the API response contract.
- **Tests**: backend `test_web3_payment_foundation.py` → 6 passed (was 4), Hardhat → 4 passing, `apps/web` build → pass.

### Phase 5 — submit endpoint + submitted→finalized receipt flow (shipped)

- **`submit_web3_transaction()`** in `web3_payments.py` accepts `{ mandate_id, action, tx_hash }` and registers a `submitted` `chain_receipt`. This is the hand-off: once a signer broadcasts a Phase 4 `transaction_request`, the resulting tx hash is registered here.
- **Projector enhancement** in `web3_projector.py`: when a final event (from the indexer) arrives with the same `tx_hash`, it overwrites `receipt_kind` / `reference` / `principal_user_id` and advances the receipt from `submitted` to `finalized`. This gives a clean two-stage lifecycle: *user broadcasts → submitted → chain confirms → finalized*.
- **API**: `POST /v1/market/web3/transactions/submit` (shape in `presentation/schemas.py` — `Web3TransactionSubmitRequest` / `Web3TransactionSubmitResponse`).
- **Owner GUI** (`OwnerWalletPage.tsx`) now shows a `tx_hash` input + Submit button directly under each `transaction_request`, so a developer can paste a hash returned by an external Smart Wallet and register it.
- **Tests**: backend `test_web3_payment_foundation.py` → 7 passed (was 6), Hardhat → 4 passing, `apps/web` build → pass.

**Shape of the current end-to-end (manual-paste) flow:**

1. Developer requests mandate create/cancel → backend returns `transaction_request` with `to / selector / data / expected_event`.
2. External wallet signs & broadcasts (today: browser extension / manual; next phase: Turnkey/Safe auto).
3. Developer pastes returned `tx_hash` into the Owner GUI.
4. Backend registers `submitted` receipt.
5. Indexer later sees the finalized event on-chain → projector upgrades receipt to `finalized`.

The backend pipeline is now full end-to-end once a signer exists. The missing layer is automating step 2–3.

### Still pending (work in progress)

- **Automated signer + broadcaster** — the submit endpoint exists, but the bridge from `transaction_request` to a signed, broadcast tx is **manual** today (paste the hash in the Owner GUI). **Turnkey / Safe / Pimlico** integration replaces this manual step with a browser-initiated signing flow that auto-reports the hash back to `POST /v1/market/web3/transactions/submit`.
- `web3_wallet_provider = "mock_embedded"` — real wallet provisioning is gated on the same Turnkey / Safe / Pimlico work.
- Swap quote endpoint returns deterministic mocks — real **0x** execution pending.
- **Resident chain indexer daemon** — admin trigger (`POST /v1/admin/market/web3/sync`) exists; a long-running process that advances `chain_cursor` continuously is not yet wired.
- **Stripe flow replacement** — existing Stripe paths still live; on-chain cutover of the customer-facing paid flows has not happened yet.

The server now supports the full *plan → submit → finalize* receipt lifecycle. The remaining gap is the **browser-side signer** that consumes a `transaction_request` and submits automatically. Free listings and non-payment flows (READ_ONLY / ACTION without charge) are still not affected.

## What still works today

- Everything in the **READ_ONLY** and **ACTION** permission classes — publishing, registering, executing, receipts, tool-manual validation.
- **Free** listings (`price_model="free"`) — unaffected by the payment change.
- SDK types, validators, and examples for non-payment flows — stable.
- The existing SDK v0.1.x — no breaking change is needed for non-payment APIs.

## What is paused / changing

- **`price_model="subscription"` publish flow** — the onboarding step that required a Stripe Connect account is being replaced by Polygon address registration at `/owner/publish`. Until the real wallet integration ships, new paid subscription publish is paused server-side.
- **`SettlementMode` enum values** (`stripe_checkout`, `stripe_payment_intent`) — the **tool-execution** settlement mode (how a PAYMENT-class tool charges the owner at execution time) is a separate axis from the developer-payout change. Codex has **not** changed this enum yet; it remains frozen in SDK v0.1.x. A coordinated server+SDK update will add on-chain values when the buyer-side is also migrated.
- **`examples/metamask_connector.py`** — the current "bring your own MetaMask + direct-sign transaction" stub does **not** match the new embedded-smart-wallet + platform-gas model. It will be rewritten once the real wallet integration is available.
- Any doc text that reads "Stripe Connect" as the live mechanism — being rewritten as this migration progresses.

## Why Polygon, specifically

- **Low fees + fast finality** (12-confirmation target ≈ seconds) suits micro-subscription economics where a $5/month API can't absorb Ethereum L1 gas.
- **Stable-token density** — USDC and JPYC are both native on Polygon, so developers in US-jurisdiction and JP-jurisdiction can be paid in their preferred stablecoin without bridging.
- **0x Protocol coverage** — deep liquidity for USDC↔JPYC swaps without the platform running its own DEX.
- **Smart-account stack maturity** — Safe + Pimlico ERC-4337 bundlers are production-grade on Polygon, enabling platform-sponsored gas without protocol forking.

Embedded wallets + gas sponsorship mean this is **not** a "bring your own MetaMask" pivot. Developers and buyers will not see chain mechanics unless they look.

## For SDK users, right now

1. **If your API is READ_ONLY / ACTION / free:** nothing to do. Keep building. The SDK's public API, validators, and examples are unchanged for your flow.
2. **If you were about to publish a paid subscription API:** wait until the real wallet integration lands. The registration flow is already available at `/owner/publish` but accepts only Polygon addresses (not bank accounts), so Stripe-Connect-expecting onboarding scripts will fail. A coordinated SDK release will add the final types once Turnkey/Safe/Pimlico integrations are live.
3. **If you already published a paid subscription API on a previous SDK version:** platform-side migration tooling is part of Codex's current work. No action required from you.

## Tracking

- **Server-side:** Codex in-progress on main-repo `siglume` branch. Phase 1 (schema + mock API + GUI) merged 2026-04-18.
- **SDK-side coordination:** [siglume-api-sdk#31](https://github.com/taihei-05/siglume-api-sdk/issues/31) — tracks the SDK changes that trigger the v0.2.0 breaking release.
- **Owner GUI:** https://siglume.com/owner/credits for the Polygon wallet surface; https://siglume.com/owner/publish Settings tab for payout-address registration.
- **Server module:** `packages/shared-python/agent_sns/application/web3_payments.py` in the main repo.
- This document will be updated when the real (non-mock) wallet integration ships and when the 0x swap execution becomes live.
