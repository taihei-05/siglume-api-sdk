# Payment Migration: Stripe Connect → Polygon On-Chain Smart Wallet

**Status:** Phases 1–23 shipped. Phase 23 **wires real Turnkey HTTP signing** into the broker — P-256 X-Stamp generation, `sign_raw_payload` call, a new `turnkey_http` provider that activates when `AGENT_SNS_WEB3_TURNKEY_LIVE_SIGN_ENABLED=true`. `execute` can also auto-sign an unsigned draft internally, so the existing single-call execute path keeps working when live signing is on. **Important caveat:** the wiring is in, but has not yet been validated against real Turnkey + Pimlico + Amoy end-to-end. SDK v0.2.0 breaking release is still on hold because Axis 2 has not moved.
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

### Phase 10 — AI Works escrow on the Web3 wallet flow (shipped)

- **`WorksEscrowHub` tx plan** in `web3_tx_plans.py` — prepared calldata for `fundEscrow` and `releaseEscrow` on the deployed hub.
- **`fund_works_order()`** (`works_service.py`) is now Web3-first: if the seller has a verified Polygon payout wallet, a `works_escrow` mandate is created; under `mock_embedded` it auto-executes and the order lands at `funds_locked`.
- **`accept_works_delivery()`** (`works_service.py`) switches from Stripe release to on-chain release — uses the stored `web3_escrow_id` to issue the `releaseEscrow` tx. `mock_embedded` progresses through `settled` / `completed`.
- **Generic prepared-tx executor** in `web3_payments.py` + `services.py` — the backend can now send, register a receipt for, and mock-project *any* prepared `transaction_request`, not just mandate-derived ones. This is the abstraction that made escrow fund/release drop in cleanly.
- **Projector + indexer** (`web3_projector.py`, `web3_indexer.py`) project three new Works events: `works_escrow_funded`, `works_escrow_released`, `works_escrow_refunded`.
- **Works Order Detail UI** (`WorksOrderDetailPage.tsx`) is no longer redirect-based — it receives the returned tx hash and refreshes with a notice in place.
- **Dev manifest** (`amoy.json`) extended with the `works_escrow_hub` entry.
- **Tests**: a new Works unit test walks the full `fund → submit deliverable → accept` cycle under `mock_embedded`; `test_web3_payment_foundation.py` → 13 passed (was 12). `apps/web` build → pass. Python compile → pass.

**Significance for the AIWorks SDK extension:** the SDK's AIWorks module (`siglume_api_sdk_aiworks.py`) exposes `JobExecutionContext`, `FulfillmentReceipt`, `DeliverableSpec`, `BudgetSnapshot`. **None of these change** — the escrow mechanics are entirely server-side (seller's payout wallet decides whether Web3 path kicks in). An agent that fulfils AIWorks jobs today continues to use the same fulfillment contract; the platform routes the funds through Web3 escrow rather than Stripe escrow behind the scenes.

### Phase 11 — Ads billing joins the Web3 wallet flow (shipped)

- **Ads billing Web3 mode** across `ad_api.py` — `profile`, `billing`, `setup`, `activate`, `settle`, campaign create/update, and impression ingest are all Web3-aware; partners with a verified Polygon payout wallet settle through `AdsBillingHub`.
- **`chargeAdSpend(...)`** tx plan added to `web3_tx_plans.py` for the `AdsBillingHub` hub.
- **`mock_embedded`** path extended in `web3_payments.py` / `web3_projector.py` / `web3_indexer.py` so a local Ads settlement walks fund → charge → receipt end-to-end.
- **Ads GUI** (`apps/web/src/lib/ad-api.ts`, `apps/web/src/app/AdDashboard.tsx`) now exposes wallet setup, mandate activate, and an on-chain "Settle current spend" button.
- **Dev manifest** (`amoy.json`) extended with `AdsBillingHub` — still a placeholder, still to be replaced with real deploy addresses before chain exposure.
- **Tests**: `test_ad_campaigns.py` integration → 5 passed, `test_web3_payment_foundation.py` → 13 passed, `apps/web` build → pass, Python compile → pass.

**Completion of Axis 1:** with Ads in place, every platform-level settlement path on Siglume (Plan, Partner, API Store paid, AI Works escrow, Ads) runs the same Web3 pipeline under the mock provider. The variety of surfaces (subscription, one-off purchase, escrow, metered/daily) are all served by the same primitives — payment mandate + transaction_request + projector. Nothing customer-facing is expected to break when the mock provider is swapped for a real Turnkey / Safe adapter; only the underlying `tx_hash` changes from deterministic mock to real chain.

**Confirmed unchanged (SDK-side):**

- Server `VALID_SETTLEMENT_MODES` = `{"stripe_checkout", "stripe_payment_intent"}` — Axis 2 has **not** moved.
- Server `_VALID_PRICE_MODELS` = `{"free", "subscription"}` — Ads billing uses `AdsBillingHub` as a partner-spend settlement path; it does **not** unlock the SDK's `PriceModel.USAGE_BASED` / `PER_ACTION` reserved values for API Store listings.
- SDK AIWorks module (`siglume_api_sdk_aiworks.py`) types remain stable.

### Phase 12 — local `delegated_http` wallet broker app (shipped)

- **New FastAPI app** `web3_wallet_broker_api.py` exposes:
  - `GET /health` (API-key protected if configured)
  - `POST /wallets/provision`
  - `POST /transactions/execute`
- Locally, the endpoints return **deterministic** smart-wallet addresses and tx hashes — same shape as `mock_embedded`, but out-of-process and over HTTP. This lets the platform exercise the `delegated_http` provider end-to-end without needing real signing yet.
- **Boot entry points**: `bootstrap.py` exposes the broker app factory; `apps/api/app/wallet_broker.py` is the uvicorn target (`uvicorn apps.api.app.wallet_broker:app`).
- **Tests**: `test_web3_wallet_broker_api.py` → 2 passed (health API-key protection + deterministic provision/execute); `test_web3_payment_foundation.py` → 13 passed; Python compile → pass.
- `.env.example` documents the new configuration knobs for broker selection.

**Significance: the Turnkey / Safe / Pimlico drop-in point is now concrete.** Before Phase 12, swapping `mock_embedded` for a real adapter was an abstract "provider swap" with no defined HTTP contract. Now there is a specific HTTP API that the future adapter will implement — same request / response shapes, real key material behind the scenes. The platform never sees the difference beyond tx_hash content changing from deterministic mock to real chain data.

**SDK-side impact: still none.** The broker is an internal platform component. SDK consumers interact with `/v1/market/web3/*` endpoints exposed by the main API, not with the broker directly.

### Phase 13 — `delegated_http` broker becomes RPC-aware (shipped)

- **`/health`** now reports live RPC status and a `simulation_enabled` flag (`web3_wallet_broker_api.py`).
- **`/transactions/execute`** performs real-RPC validation before returning a (still deterministic-mock) tx hash:
  - `eth_getCode` to confirm the target contract exists at the configured address
  - `eth_estimateGas` on the prepared calldata
  - fee quote for the resulting gas
- **Backend** (`web3_payments.py`) threads the broker's simulation block through into the execute-response, so the SDK / GUI see whether a prepared call would fail under live chain state even though no tx is being broadcast.
- **Schemas** (`presentation/schemas.py`, `apps/web/src/lib/types.ts`) carry the new simulation shape.
- **Owner GUI** (`OwnerWalletPage.tsx`) surfaces the gas estimate next to each `transaction_request`, so a developer can see the real-chain-validated cost before the hypothetical broadcast.
- **Tests**: `test_web3_wallet_broker_api.py` → 3 passed (was 2), `test_web3_payment_foundation.py` → 13 passed, `apps/web` build → pass, Python compile → pass.

**Significance: the mock-vs-real gap narrows by one concrete layer.** Prior phases let us *plan* a real tx; Phase 13 lets us *validate* one against a live chain. What the broker still will not do is sign and broadcast — that is the Turnkey / Safe / Pimlico substitution that Codex has explicitly named as the next phase.

**SDK-side impact: none.** The new simulation block flows through `POST /v1/market/web3/transactions/execute` which the SDK does not currently wrap; consumers see it only in the Owner GUI for now.

### Phase 14 — user-visible provider-status + AA-stack readiness (shipped)

- **New user endpoint** `GET /v1/market/web3/provider-status` (`marketplace_api.py`, `web3_payments.py`, `schemas.py`) returns the platform's live Web3 wiring: active provider, `supported_tokens`, `manifest_loaded`, `manifest_path`, `deployment_network`, and the deployed `contracts` map.
- **Broker `/health`** (`web3_wallet_broker_api.py`) now also reports an `aa_stack` block — readiness of Turnkey config, Pimlico bundler, paymaster, entry point, and safe module.
- **Env slots** for Turnkey / Pimlico / entry point / safe module (`settings.py`, `.env.example`). The scaffolding is fully in place; Phase 15 just fills these with real credentials and swaps the mock internals for live HTTP calls.
- **Owner GUI** (`OwnerWalletPage.tsx`, `lib/api.ts`, `lib/types.ts`) surfaces provider runtime: broker health, manifest path, contract addresses, aa-stack details. Developers can now see at a glance which provider is active and whether the AA stack is wired.
- **Tests**: `test_web3_wallet_broker_api.py` → 3 passed, `test_web3_payment_foundation.py` → 14 passed (was 13), `apps/web` build → pass, Python compile → pass.

**Significance: operational readiness is now visible.** Up through Phase 13, the stack was "ready for Turnkey/Safe/Pimlico to drop in" but opaque to non-admin users. Phase 14 exposes that readiness — which token list is allowlisted, which network manifest is loaded, which contract addresses are registered — to the owner surface. This is the last step before the real-signer phase; afterwards the same surfaces will show green checks against real production values.

**SDK-side impact: none.** `provider-status` is a platform-level readiness endpoint, not part of the SDK's AppManifest / ToolManual developer contract. SDK consumers continue to be unaffected by this migration.

### Phase 15 — ERC-4337 `submission_outline` pass-through (shipped)

- **Broker** (`web3_wallet_broker_api.py`) — `simulate` / `execute` responses now include a `submission_outline` block describing exactly how the prepared call *would* be submitted to Polygon via ERC-4337: entry point address, safe module, bundler, paymaster, a list of `missing_requirements`, and a boolean `ready_for_real_submission`.
- **Backend** (`web3_payments.py`, `presentation/schemas.py`) passes the outline straight through to the API consumer. TypeScript types (`apps/web/src/lib/types.ts`) carry the new shape.
- **Env receivers** in `settings.py` and `.env.example` for Turnkey / Pimlico bundler / paymaster / entry point / safe module (complements the Phase 14 env slots; final piece of the configuration surface).
- **Tests**: `test_web3_wallet_broker_api.py` → 3 passed, `test_web3_payment_foundation.py` → 14 passed, `apps/web` build → pass, Python compile → pass.

**Significance: the stack now describes its own real-send in complete detail.** Every component that a real ERC-4337 submission will touch is named in the response; `ready_for_real_submission` collapses the whole readiness story into a single boolean. When it flips to `true` in production, the only remaining step is flipping the broker internals from "return outline" to "sign + broadcast." Phase 16 is that flip.

**SDK-side impact: none.** The outline flows through the existing `/v1/market/web3/transactions/execute` response and is consumed by the Owner GUI only; no SDK contract change.

### Phase 16 — `user_operation_hash` as a first-class field (shipped)

- **Broker `/transactions/execute`** (`web3_wallet_broker_api.py`) now returns `user_operation_hash` in addition to the prior `tx_hash`.
- **Backend execute result + `chain_receipt`** (`web3_payments.py`) thread through three new fields:
  - `submission_kind` — distinguishes regular EOA-style tx submission from ERC-4337 userOp submission
  - `submitted_hash` — the hash that was actually broadcast (could be a userOpHash or tx_hash depending on `submission_kind`)
  - `user_operation_hash` — the AA-specific hash returned from the bundler
- **API schema** (`presentation/schemas.py`) and **frontend types** (`apps/web/src/lib/types.ts`) updated to carry the new shape.
- **Tests**: `test_web3_wallet_broker_api.py` → 3 passed, `test_web3_payment_foundation.py` → 14 passed, `apps/web` build → pass, Python compile → pass.

**Significance: the receipt model now speaks ERC-4337's two-stage lifecycle natively.** Under the real Pimlico flow, a `POST eth_sendUserOperation` returns a userOpHash immediately; the bundler later includes the userOp in an on-chain bundle, and `eth_getUserOperationReceipt` resolves that userOpHash to a tx_hash once mined. With Phase 16 the platform can represent both stages without collapsing them into a single ambiguous "hash" field. The mock broker still fills both with deterministic values, but the shape no longer blocks the real implementation.

**SDK-side impact: none.** These fields surface inside `/v1/market/web3/transactions/execute` and `chain_receipt`, neither of which is part of the SDK's AppManifest / ToolManual developer contract.

### Phase 17 — userOpHash → tx_hash resolve path (shipped)

- **Broker `POST /transactions/status`** (`web3_wallet_broker_api.py`) — queries `eth_getUserOperationReceipt` first, falls back to `eth_getTransactionReceipt`, and returns `status` / `tx_hash` / `user_operation_hash` / `confirmations`.
- **Backend `refresh_chain_receipt_status()`** (`web3_payments.py`, `services.py`) — looks up a previously submitted `chain_receipt`, asks the broker for the latest status, and if the userOp has been bundled it updates the receipt's `tx_hash` / confirmation state in place.
- **User-facing route** `POST /v1/market/web3/receipts/{receipt_id}/refresh` (`marketplace_api.py`, `presentation/schemas.py`) — owner-initiated re-resolve for a single receipt.
- **Owner GUI** (`OwnerWalletPage.tsx`, `lib/api.ts`, `lib/types.ts`) — each pending receipt row gets a "Refresh status" button; once the broker returns `confirmed`, the card updates without a reload.
- **Receipt / execution tracking** carries `submission_kind`, `submitted_hash`, and `user_operation_hash` throughout the lifecycle.
- **Tests**: `test_web3_wallet_broker_api.py` → 3 passed, `test_web3_payment_foundation.py` → 14 passed, `apps/web` build → pass, Python compile → pass.

**Significance: the complete ERC-4337 lifecycle is now represented end-to-end.** The data flow that Phase 16 set up (execute → userOpHash) now has its closing arc (refresh → tx_hash + confirmations). When the broker swaps to the real Pimlico bundler in Phase 18, everything from the user-visible "Refresh status" button down to the `chain_receipt` row will carry real chain data without any additional shape changes.

**SDK-side impact: none.** The refresh surface lives on `/v1/market/web3/receipts/{id}/refresh` and `chain_receipt`; neither is part of the SDK's AppManifest / ToolManual developer contract.

### Phase 18 — live-submit receiving path (shipped)

- **Broker live submit branch** (`web3_wallet_broker_api.py`): when `transaction_request.metadata_jsonb.prebuilt_user_operation` is present AND `AGENT_SNS_WEB3_BROKER_LIVE_SUBMIT_ENABLED=true`, the broker actually invokes `eth_sendUserOperation` on the configured bundler and holds the returned userOpHash.
- **Placeholder tx_hash handling**: the DB's existing `tx_hash NOT NULL` constraint is preserved by issuing a placeholder `tx_hash` and flagging `tx_hash_is_placeholder=true` on the receipt; Phase 17's refresh flow later swaps the placeholder for the real tx_hash once `eth_getUserOperationReceipt` resolves.
- **Backend** (`web3_payments.py`) threads `tx_hash_is_placeholder` through receipts and execution results.
- **Owner GUI** (`OwnerWalletPage.tsx`) displays the placeholder state clearly so users see the receipt is pending resolution.
- **Settings** (`settings.py`, `.env.example`) — new `AGENT_SNS_WEB3_BROKER_LIVE_SUBMIT_ENABLED` flag (default off). Turning this on without the bundler env correctly populated would fail the `missing_requirements` check from Phase 15's `submission_outline`, so live submit cannot accidentally fire in an under-configured environment.
- **Broker health + `submission_outline`** gain four new fields: `live_submission_enabled`, `prebuilt_user_operation_present`, `live_submission_attempted`, `used_placeholder_tx_hash` — observability for operators to know exactly what path a given execute took.
- **Tests**: `test_web3_wallet_broker_api.py` → 4 passed (was 3), `test_web3_payment_foundation.py` → 14 passed, `apps/web` build → pass, Python compile → pass.

**Significance: the broker can now submit real transactions to a live bundler.** What's still missing is the **generator** of `prebuilt_user_operation` — that requires Turnkey/Safe to actually sign, which is Phase 19. Once both sides are live, `LIVE_SUBMIT_ENABLED=true` + real signer = real Polygon transactions. The placeholder tx_hash pattern means no schema migration is needed for the cutover; the DB shape absorbed the asynchronous resolve model cleanly.

**SDK-side impact: none.** `metadata_jsonb.prebuilt_user_operation` is a server-side execution-metadata field, not part of the SDK's AppManifest / ToolManual contract. `tx_hash_is_placeholder` is on `chain_receipt`, also internal.

### Phase 19 — `user_operation_draft` + external-signer route (shipped)

- **Auto-populated `user_operation_draft`** (`web3_tx_plans.py`) on every prepared `transaction_request`. Fields: `sender`, `target`, `callData`, `entryPoint`, `safeModule`, `bundler`, `paymaster`, `missing_requirements`. A signer only needs to add `signature` and the draft is ready for live submit.
- **Broker accepts either form** (`web3_wallet_broker_api.py`): existing `prebuilt_user_operation` path stays, and now a signed `user_operation_draft` (draft + signature) is also a valid live-submit input.
- **New public route** `POST /v1/market/web3/transactions/execute-prepared` (`marketplace_api.py`) — takes a saved prepared request back with a signature and runs it through the same execute → receipt pipeline. Schemas in `presentation/schemas.py`, TS types in `apps/web/src/lib/types.ts`.
- **Tests**: `test_web3_payment_foundation.py` → 14 passed, `test_web3_wallet_broker_api.py` → 4 passed, `apps/web` build → pass, Python compile → pass.

**Significance: signing becomes a pluggable layer.** The platform builds the draft; anyone with access to the required key material (Turnkey, a user's own wallet app, a server-side signing service, a test harness) can produce the signature and POST it back. Turnkey is no longer a hard dependency — it's just the first planned implementation of a "draft signer". Phase 20 wires Turnkey in specifically.

**SDK-side impact: none.** `user_operation_draft` rides on `transaction_request` which the SDK does not expose through its AppManifest / ToolManual contract; the `execute-prepared` route is a platform-level signer-integration surface.

### Phase 20 — hydrated draft + Turnkey signing outline (shipped)

- **`web3_tx_plans.py`** finalises `user_operation_draft` as a standard attachment on every prepared `transaction_request`.
- **Broker `simulate`** (`web3_wallet_broker_api.py`) hydrates the draft with values derived from the Phase-13 RPC probe: `gas_limit`, `maxFeePerGas`, `maxPriorityFeePerGas`, and the resolved `entryPoint` address. The hydrated draft is carried in `submission_outline.hydrated_user_operation_draft`, and a companion `turnkey_signing_outline` names exactly which Turnkey primitives / key material are expected to produce the signature.
- **Public route** `POST /v1/market/web3/transactions/execute-prepared` (`presentation/marketplace_api.py`, schemas in `presentation/schemas.py`, TS types in `apps/web/src/lib/types.ts`) is live for signer integrations — broker already accepts the signed draft for live submit.
- **Tests**: `test_web3_wallet_broker_api.py` → 4 passed, `test_web3_payment_foundation.py` → 14 passed, `apps/web` build → pass, Python compile → pass.

**Significance: the signer's job is reduced to "produce a signature over a fully-specified payload".** Before Phase 20, an integrator had to compute gas themselves or rely on the bundler to fill it during `eth_sendUserOperation` (risky — estimation can change between simulate and submit). After Phase 20, the exact bytes to sign are pinned at simulate time; `turnkey_signing_outline` doubles as an implementation checklist for the forthcoming Turnkey adapter.

**SDK-side impact: none.** The hydrated draft and signing outline live inside `transaction_request` / `simulate` / `execute-prepared` — none of which cross into the SDK's AppManifest / ToolManual developer contract.

### Phase 21 — dedicated `prepare-signing` endpoint (shipped)

- **`prepare_prepared_web3_transaction_signing()`** in `web3_payments.py` takes any prepared `transaction_request` and returns three things together: `simulation`, `hydrated_user_operation_draft`, and `turnkey_signing_outline`.
- **Public route** `POST /v1/market/web3/transactions/prepare-signing` (`marketplace_api.py`) exposes it. Schemas in `presentation/schemas.py`; TS type in `apps/web/src/lib/types.ts`; client in `apps/web/src/lib/api.ts`.
- **Broker `simulate`** tidied so `hydrated_user_operation_draft` + `turnkey_signing_outline` are the canonical return shape whether the caller hits `simulate` directly or the new endpoint.
- **Tests**: `test_web3_payment_foundation.py` → 14 passed, `test_web3_wallet_broker_api.py` → 4 passed, `apps/web` build → pass, Python compile → pass.

**Significance: the external-signer workflow is now three explicit calls** rather than one overloaded simulate:

1. `POST /v1/market/web3/transactions/prepare-signing` — get exactly what to sign
2. Produce signature externally (Turnkey, user wallet, etc.)
3. `POST /v1/market/web3/transactions/execute-prepared` — submit with signature

This is the shape the Phase 22 Turnkey HTTP adapter will consume: it will call `prepare-signing`, fill in the signature using `turnkey_signing_outline`, then call `execute-prepared`.

**SDK-side impact: none.** The new endpoint is a platform-level signer integration surface; it does not touch the SDK's AppManifest / ToolManual developer contract.

### Phase 22 — signing call itself is now an API (shipped)

- **Broker `POST /transactions/sign`** (`web3_wallet_broker_api.py`) — consumes a `hydrated_user_operation_draft`, produces a signature via the configured signer (today: `mock_turnkey_http`, deterministic), and returns a `signed_transaction_request`.
- **`sign_prepared_web3_transaction()`** in `web3_payments.py` + public route **`POST /v1/market/web3/transactions/sign-prepared`** (`marketplace_api.py`) — platform-side wrapper so callers can sign without talking to the broker directly.
- **Schemas** (`presentation/schemas.py`), **TS types** (`apps/web/src/lib/types.ts`), **client** (`apps/web/src/lib/api.ts`) updated.
- **Tests**: `test_web3_wallet_broker_api.py` → 4 passed, `test_web3_payment_foundation.py` → 14 passed, `apps/web` build → pass, Python compile → pass.

**Significance: the platform-managed happy path is now a clean three-call sequence** — one HTTP round-trip per step, no overloaded endpoints, and a named provider (`mock_turnkey_http`) that will be swapped for the real Turnkey HTTP implementation:

1. `prepare-signing` — "what do I sign?"
2. `sign-prepared` — "sign it for me" (platform-held key path)
3. `execute-prepared` — "submit the signed result"

The external-signer path (Phase 19) remains available for cases where the key isn't platform-held — callers can skip step 2 and produce the signature themselves. Now there are two coherent signer integration models: **platform-managed** (new with Phase 22) and **bring-your-own** (already available). Both run through the same `execute-prepared` submission path.

**SDK-side impact: none.** `sign-prepared` is another platform signer-integration surface; it does not cross into the SDK's AppManifest / ToolManual developer contract.

### Phase 23 — real Turnkey HTTP signing wired (shipped, not yet validated end-to-end)

- **Broker can now actually call Turnkey's `sign_raw_payload`** (`web3_wallet_broker_api.py`). Includes P-256 API-key-backed `X-Stamp` generation — the Turnkey request authentication scheme.
- **New env knobs** (`settings.py`, `.env.example`):
  - `AGENT_SNS_WEB3_TURNKEY_SIGN_WITH` — identifier (wallet / private-key tag) Turnkey should sign with.
  - `AGENT_SNS_WEB3_TURNKEY_LIVE_SIGN_ENABLED` — flips between mock and live signing.
- **New provider name `turnkey_http`** appears in broker responses when live signing is enabled; falls back to `mock_turnkey_http` when off, so every previous phase's behavior is preserved by default.
- **`/transactions/execute` can auto-sign** when given an unsigned draft + live signing is on. Lets the existing single-call execute path keep working end-to-end without forcing callers to orchestrate the 3-call `prepare-signing` → `sign-prepared` → `execute-prepared` sequence (which remains available).
- **Tests**: `test_web3_wallet_broker_api.py` → 7 passed (was 4, +3 new tests exercising the Turnkey wiring), `test_web3_payment_foundation.py` → 14 passed, Python compile → pass.

**Caveat, called out explicitly by Codex:** *this phase shipped the wiring, not the successful end-to-end run.* The broker has the code path to call Turnkey for real, but the full Turnkey + Pimlico + Amoy chain has not been proven together yet. Phase 24 is exactly that — run through Amoy and verify on-chain success.

**SDK-side impact: none.** Turnkey configuration lives in platform env; `turnkey_http` is a provider name in broker responses. No AppManifest / ToolManual contract change.

### Still pending (work in progress)

- **Real Turnkey + Pimlico + Amoy end-to-end validation** — Phase 23 wired the Turnkey HTTP signer; the next run is turning `LIVE_SIGN_ENABLED=true` + `LIVE_SUBMIT_ENABLED=true` against Polygon Amoy with real `amoy.json` addresses, and confirming a real tx lands on-chain. Until that run passes, "real signing is possible" is a code claim, not a proven claim.
- **Tool-execution Axis 2 migration** — still the actual SDK v0.2.0 trigger. Whenever `VALID_SETTLEMENT_MODES` on the server gains a Web3 value, SDK must follow synchronously. Not yet in Codex's roadmap.
- **Replace `amoy.json` placeholder manifest** — dev-only, covers `subscription_hub` + `ads_billing_hub` + `works_escrow_hub` + `fee_vault`. Must be replaced with real addresses before any chain exposure (prerequisite for the Amoy end-to-end run above).
- **0x real swap execution** — swap quote endpoint still returns deterministic mocks.
- **Resident chain indexer daemon** — admin trigger (`POST /v1/admin/market/web3/sync`) exists; a long-running process that advances `chain_cursor` continuously is not yet wired. (Phase 17's per-receipt refresh button is an owner-pull alternative for the same resolve step.)

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
