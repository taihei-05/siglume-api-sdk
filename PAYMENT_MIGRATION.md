# Payment Migration: Stripe Connect → Polygon On-Chain Smart Wallet

**Status:** Phase 1 (server contract shape) + Phase 2 (Solidity contracts + projector) + Phase 3 (deploy script + on-chain indexer) shipped. Real tx submission + Turnkey/Safe/Pimlico/0x integration pending.
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

### Still pending (work in progress)

- `web3_wallet_provider = "mock_embedded"` — real **Turnkey / Safe / Pimlico** integration pending.
- Swap quote endpoint returns deterministic mocks — real **0x** execution pending.
- **Real tx submission** — mandate create / cancel still writes mock "tx hashes". The indexer can read real chain state when deployed, but no production code path is producing real signed transactions yet.
- **Resident chain indexer daemon** — admin trigger (`POST /v1/admin/market/web3/sync`) exists; a long-running process that advances `chain_cursor` continuously is not yet wired.
- **Stripe flow replacement** — existing Stripe paths still live; on-chain cutover of the customer-facing paid flows has not happened yet.

The server can now deploy the 4 hubs to Polygon (or Amoy for staging) and read the resulting event stream on demand. The remaining gap is **writing** to those contracts from a real relayer backed by real key material (Turnkey / Safe / Pimlico). Free listings and non-payment flows (READ_ONLY / ACTION without charge) are still not affected.

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
