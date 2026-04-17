# Payment Migration: Stripe Connect → Polygon On-Chain Smart Wallet

**Status:** Phases 1–9 shipped. Phase 9 extends the Stripe-less cutover from Plan (Phase 8) to **Partner subscriptions** and **API Store paid purchases**, so all three of Siglume's platform-billing surfaces now route through Web3 mandate + embedded-wallet execute. Provider is still `mock_embedded` (real funds do not move), but the subscription-purchase axis is end-to-end Web3. Tool-execution settlement (the `SettlementMode` axis SDK v0.2.0 gates on) is **not yet moved** — still Stripe server-side.
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

### Phase 6 — one-click execute via `mock_embedded` (shipped)

- **Wallet provider abstraction** in `web3_payments.py` extended so a configured provider can execute a `transaction_request` in-process. Under `mock_embedded`, this generates a deterministic `tx_hash` from the prepared request and auto-registers the `submitted` receipt — collapsing steps 2, 3, and 4 of the manual-paste flow into a single call.
- **`execute_web3_transaction()`** application method + `services.py` binding + **`POST /v1/market/web3/transactions/execute`** API (`presentation/schemas.py`).
- **`web3_projector.py`** tightened so the auto-submitted receipts are still correctly overwritten by the subsequent finalized event (same lifecycle as manually-pasted submits).
- **Owner GUI** (`OwnerWalletPage.tsx`) now shows an **"Execute in embedded wallet"** button next to each `transaction_request` — one click runs create/cancel against the mock provider and lands a receipt. The manual `tx_hash` paste path remains as a fallback.
- **Tests**: backend `test_web3_payment_foundation.py` → 8 passed (was 7), Hardhat → 4 passing, `apps/web` build → pass.

The significance: the developer-facing one-click flow is now complete in shape. The same API surface (`POST /transactions/execute`) will broadcast real Polygon transactions once the mock provider is swapped for a Turnkey/Safe-backed adapter — consumers (Owner GUI, SDK if we ever expose it) do not change.

### Phase 7 — login-wired wallet bootstrap + broker health + first Stripe-cutover backend (shipped)

- **Auto-bootstrap on login** (`apps/web/src/app/App.tsx`, `lib/api.ts`) — after Siglume login and on existing-session resume, the frontend automatically provisions the user's embedded Polygon wallet. The wallet is no longer "create-on-first-visit" of `/owner/credits`; it's tied to the normal Siglume auth lifecycle.
- **Delegated-broker health admin API** (`web3_payments.py`, `services.py`, `schemas.py`, `marketplace_api.py`) — reports which provider is live (`mock_embedded` / `delegated_http` / `turnkey_safe_http`) and whether the broker's `/health` endpoint is reachable. This is the operational surface for the Phase-8 provider swap.
- **`POST /v1/me/plan/web3-mandate`** (`presentation/api.py`, frontend client in `lib/api.ts`) — the first Stripe-replacement endpoint: create a Plan (subscription-tier) `payment_mandate` via Web3 instead of Stripe Checkout. Backend is live; the pricing UI button is still on Stripe Checkout for now, but the switchover is the next phase.
- **Tests**: backend `test_web3_payment_foundation.py` → 10 passed (was 8), Hardhat → 4 passing, `apps/web` build → pass.

The significance: Phase 7 is the **first phase that actually starts dismantling Stripe** instead of just building around it. Wallets exist for every logged-in user by default, ops can see broker health, and the Plan-pricing backend can route to Web3 the moment the UI button flips.

### Phase 8 — Plan pricing UI cuts over to Web3 mandate + embedded-wallet execute (shipped)

- **`PlanSection` (pricing + settings surfaces)** in `apps/web/src/app/App.tsx` now routes Plus / Pro subscription purchases through `POST /v1/me/plan/web3-mandate` → embedded-wallet `execute` in a single flow. Stripe Checkout is no longer opened for Plan subscriptions.
- **`POST /v1/me/plan/web3-cancel`** (`presentation/api.py`) — matching cancel entrypoint for Plan Web3 mandates.
- Frontend API clients added: `createPlanWeb3Mandate` and `cancelPlanWeb3Mandate` (`apps/web/src/lib/api.ts`).
- Admin broker-health API from Phase 7 stays, so monitoring is in place when `mock_embedded` is swapped for `turnkey_safe_http`.
- **Tests**: backend `test_web3_payment_foundation.py` → 10 passed, `apps/web` build → pass, Python compile → pass.

**Why this is the biggest milestone so far:** this is the first point on the platform where a **real customer purchase flow does not touch Stripe at all**. A logged-in user clicking Plus or Pro now goes purchase → mandate → execute → tx_hash → submitted receipt → (eventually finalized), fully inside the Web3 pipeline. The fact that `mock_embedded` is still the provider underneath means no real funds move yet, but the *shape of the cutover* is proven end-to-end for the first real customer-facing surface.

### Phase 9 — Partner + API Store purchase flows join the Plan cutover (shipped)

- **`mock_embedded` auto-reflection into projector** (`web3_payments.py`, `web3_projector.py`) — under the mock provider, mandate execute now flows directly through the projector, so local runs land plan / partner updates and API Store access grants end-to-end.
- **Partner Dashboard Billing** (`partner_api.py`, `PartnerDashboard.tsx`, `lib/partner-api.ts`) routes through Web3 mandate create + embedded-wallet execute instead of Stripe Checkout. `has_subscription` now reads Web3 mandate state.
- **API Store paid purchase** (`marketplace_capabilities.py`, `OwnerCapabilitiesPage.tsx`, `ApiDetailPage.tsx`, `lib/types.ts`) — if the seller has a verified Polygon payout wallet, the buy path goes through Web3 mandate; mock execute auto-creates the access grant and the UI handles a new `web3_submitted` state.
- **Indexer payload enriched** (`web3_indexer.py`) — emitted events now carry `listing_id` / `capability_key` so real-chain sync can project API Store state identically to the mock path.
- **Dev deploy manifest** (`packages/contracts/web3-payments/deployments/amoy.json`) — **placeholder** so local mock tx-planning works. To be replaced with a real deploy manifest before any mainnet exposure.
- **Tests**: backend `test_web3_payment_foundation.py` → 12 passed (was 10), `apps/web` build → pass, Python compile → pass.

**Why this is a large milestone for publishers:** Plan (Phase 8), Partner (Phase 9), and **paid API Store purchase** (Phase 9) — the three platform-billing surfaces — are all on Web3 mandate flows now. For the SDK specifically, this means the earlier "paid-subscription publish is paused" caveat is no longer true for sellers with a verified Polygon payout wallet; they can register, have buyers purchase via Web3 mandate, and land an access grant via the mock projector. What's still missing is real tx submission and the corresponding tool-execution-axis changes (see below).

### Still pending (work in progress)

- **AI Works escrow cutover** — per Codex's plan, AI Works escrow execution is the next surface to join the Web3 wallet flow, following the same pattern Phase 9 applied to Partner and API Store paid purchase.
- **Tool-execution Axis 2 migration** — this is the actual SDK v0.2.0 trigger. Whenever `VALID_SETTLEMENT_MODES` on the server gains a Web3 value, SDK must follow synchronously. Not a Codex target yet, but a separate coordination that will reach us when it does.
- **Real Turnkey / Safe adapter** — provider abstraction names `delegated_http` and `turnkey_safe_http`; the live one is still `mock_embedded`. Swapping to a real signer produces real Polygon broadcasts without changing the API surface.
- **Replace `amoy.json` placeholder manifest** — Codex added a dev-only deployment manifest so local mock tx-plans work. Must be replaced with a real testnet deploy manifest before any chain exposure.
- Swap quote endpoint returns deterministic mocks — real **0x** execution pending.
- **Resident chain indexer daemon** — admin trigger (`POST /v1/admin/market/web3/sync`) exists; a long-running process that advances `chain_cursor` continuously is not yet wired.

Free listings and non-payment flows (READ_ONLY / ACTION without charge) remain unaffected throughout the migration.

## Two axes, only one of them moved

The migration has two distinct axes. Phase 9 completes **one of them** (subscription purchase) under the mock provider but leaves the **other** (tool-execution settlement) on Stripe. Both are described here so SDK users aren't confused.

**Axis 1 — Subscription purchase (Web3 as of Phase 9, mock-backed):**

- How a buyer acquires access to a Plan / Partner subscription / API Store listing.
- Previously: Stripe Checkout hosted page.
- Now: Web3 mandate + embedded-wallet execute + access-grant projection.
- Governed by: platform server logic + `payment_mandate` model. **Not surfaced through the SDK's tool-manual contract.**
- SDK impact: none to the tool-manual API. A subscription-pricing API (`price_model="subscription"`) declares its price; the platform chooses the billing rail.

**Axis 2 — Tool-execution settlement (still Stripe):**

- How a `permission_class="payment"` tool charges the owner during the tool's own execution (e.g. "buy this headset for me" run).
- Governed by: SDK's `SettlementMode` enum on `ToolManual` — `stripe_checkout` or `stripe_payment_intent`.
- Still Stripe server-side (`VALID_SETTLEMENT_MODES = {"stripe_checkout", "stripe_payment_intent"}`).
- SDK v0.2.0 (breaking-enum release) fires when **this** axis moves, not the one above.

## What still works today

- Everything in the **READ_ONLY** and **ACTION** permission classes — publishing, registering, executing, receipts, tool-manual validation.
- **Free** listings (`price_model="free"`) — unaffected by the payment change.
- **Paid subscription publish** (`price_model="subscription"`) — **no longer paused** for sellers with a verified Polygon payout wallet (as of Phase 9). Buyers purchase via Web3 mandate under the mock provider; access grants land automatically.
- **`PAYMENT` permission class tools** — authorable today using `settlement_mode="stripe_checkout"` or `"stripe_payment_intent"`. Axis 2 has not moved.
- SDK types, validators, and examples for non-payment flows — stable.
- The existing SDK v0.1.x — no breaking change required yet.

## What is paused / changing

- **`SettlementMode` enum values** (`stripe_checkout`, `stripe_payment_intent`) — still frozen in SDK v0.1.x. Codex has **not** added a Web3 value to `VALID_SETTLEMENT_MODES`. A coordinated server+SDK update will add on-chain values when Axis 2 migrates — that is the SDK v0.2.0 trigger.
- **`examples/metamask_connector.py`** — the current "bring your own MetaMask + direct-sign transaction" stub does **not** match the new embedded-smart-wallet + platform-gas model. It will be rewritten once the real wallet integration is available and the Axis 2 migration is specified.
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
