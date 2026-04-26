# Payment Migration: Stripe Connect → Polygon On-Chain Smart Wallet

**Status:** Phases 1–47 shipped. **Phase 47 closes preflight / env alignment and marks the Codex implementation role as handed off.** `web3_preflight_rpc_max_age_seconds` default is now 60 s and `.env.prod.example` matches. Reconciliation cadence is now documented as seconds-based-daily, with external orchestration called out as the way to pin a fixed wall-clock time (e.g., 03:00). `payout_*` primary / `stripe_*` alias stance is further sharpened in OpenAPI + frontend types. **Codex declared its implementation role complete after Phase 47** — branch is handed off in "merge-ready pending operator + release cut" state. Residual code task is `stripe_*` alias tail cleanup (release-cadence decision, not implementation). `recovery-2026-04-18` is **code-complete for mainnet launch prerequisites**; main still untouched. Remaining work is operator-side + release-side: (1) create 2-of-3 operator Safe on Polygon mainnet, (2) populate `.env.prod` from the operator-ready `.env.prod.example`, (3) run `/v1/admin/market/web3/preflight --require-ready` and verify all green, (4) merge `recovery-2026-04-18` → `main` and deploy, (5) re-sync public SDK repo `openapi/developer-surface.yaml` + cut patch release (v0.2.1, additive-only) so SDK consumers see `payout_*` primary.
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
- **Owner GUI**: `/owner/credits` (OwnerWalletPage) shows the Polygon Smart Wallet, active mandates, receipts, and swap quotes. `/owner/credits/payout` is the Wallet payout-token settings view; `/owner/publish` is for listing review only.

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

**Significance: the broker can now submit real transactions to a live bundler.** What's still missing is the **generator** of `prebuilt_user_operation` — that requires Turnkey/Safe to actually sign, which is Phase 19. Once both sides are live, `AGENT_SNS_WEB3_BROKER_LIVE_SUBMIT_ENABLED=true` + real signer = real Polygon transactions. The placeholder tx_hash pattern means no schema migration is needed for the cutover; the DB shape absorbed the asynchronous resolve model cleanly.

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

**Caveat, called out explicitly by Codex:** *this phase shipped the wiring, not the successful end-to-end run.* The broker has the code path to call Turnkey for real, but the full Turnkey + Pimlico + Amoy chain has not been proven together yet. The Amoy verification run (which actually landed at Phase 31 on 2026-04-18) is the follow-up milestone this phase is a prerequisite for.

**SDK-side impact: none.** Turnkey configuration lives in platform env; `turnkey_http` is a provider name in broker responses. No AppManifest / ToolManual contract change.

### Phase 24 — signer-validate probe + auto-sign on execute (shipped, still not validated on Amoy)

- **Broker signer probe** `POST /turnkey/validate` (`web3_wallet_broker_api.py`) — lightweight readiness check against the configured Turnkey environment. Reports `live` vs `mock`, which `sign_with` identifier is in use, and a compact activity-status block.
- **App-level wrapper** `validate_web3_signer()` in `web3_payments.py` + `services.py` — same probe callable from the main API.
- **Public route** `POST /v1/market/web3/signer/validate` (`marketplace_api.py`). Schemas in `presentation/schemas.py`; TS types in `apps/web/src/lib/types.ts`; client in `apps/web/src/lib/api.ts`.
- **Owner GUI** (`OwnerWalletPage.tsx`) adds a **Validate signer** button that displays live/mock, signer mode, and activity status inline — so ops can confirm the platform is talking to Turnkey correctly before anyone attempts a real submit.
- **Auto-sign on single-call execute** (`web3_wallet_broker_api.py`): when `AGENT_SNS_WEB3_TURNKEY_LIVE_SIGN_ENABLED=true` and the execute payload arrives with an unsigned `user_operation_draft`, the broker now signs it internally before calling `eth_sendUserOperation`. The explicit three-call `prepare-signing` → `sign-prepared` → `execute-prepared` path from Phase 22 remains available; auto-sign just closes the gap for the simpler single-call path.
- **Tests**: `test_web3_wallet_broker_api.py` → 8 passed (was 7), `test_web3_payment_foundation.py` → 14 passed, `apps/web` build → pass, Python compile → pass.

**Caveat, still called out explicitly by Codex:** *the full Turnkey + Pimlico + Amoy chain has still not been run against real infrastructure.* `amoy.json` remains a placeholder; `AGENT_SNS_WEB3_TURNKEY_LIVE_SIGN_ENABLED` and `AGENT_SNS_WEB3_BROKER_LIVE_SUBMIT_ENABLED` have not yet been flipped on together against a real deploy. Phase 25 is that end-to-end run: real deploy manifest, real credentials, real Amoy userOpHash → tx_hash → projector finalization.

**SDK-side impact: none.** Signer validation is an operational surface for the platform; the probe response does not touch AppManifest / ToolManual. Auto-sign is a broker-internal convenience; no externally-visible shape change.

### Phase 25 — receipt finalize endpoint + Owner GUI "Finalize sync" (shipped, still not validated on Amoy)

- **`finalize_chain_receipt()`** in `web3_payments.py` — takes a `chain_receipt` that has already had its `userOpHash` resolved to a `tx_hash` (via Phase 17's refresh), looks up the block around that tx, runs one indexer pass over that block range, and flushes the resulting events through the projector so the receipt reaches its terminal projected state.
- **Public route** `POST /v1/market/web3/receipts/{receipt_id}/finalize` (`presentation/marketplace_api.py`); schemas in `presentation/schemas.py`; TS types in `apps/web/src/lib/types.ts`; client in `apps/web/src/lib/api.ts`.
- **Owner GUI** (`OwnerWalletPage.tsx`) — each receipt row in the receipts list now has a **Finalize sync** button alongside the Phase-17 Refresh button. Running them in sequence (Refresh → Finalize) walks a live-submitted userOp from `submitted (placeholder tx_hash)` → `submitted (real tx_hash, confirmations)` → `finalized + projector-reflected` purely from the GUI.
- **Tests**: `test_web3_payment_foundation.py` → 14 passed, `test_web3_wallet_broker_api.py` → 8 passed, `apps/web` build → pass, Python compile → pass.

**Significance: the live-submit landing loop is now closed and GUI-drivable.** Before Phase 25, the resolve side (Phase 17) upgraded a placeholder tx_hash into a real one, but the projector still depended on the admin-side indexer sweep (`POST /v1/admin/market/web3/sync`) to catch up. Phase 25 gives each receipt its own "sync the block around me into the projector" button, so a single real-submit can be driven all the way through in the GUI without admin access. Combined with Phase 24's signer probe, the ops story for a real Amoy run is: *validate signer → execute → refresh → finalize → done, all from Owner Wallet.*

**Caveat, still called out explicitly by Codex:** *the real Turnkey + Pimlico + Amoy chain has still not been run end-to-end against real infrastructure.* `amoy.json` remains a placeholder; the Amoy end-to-end run (eventually landed at Phase 31 on 2026-04-18) is the next planned checkpoint — turn on `AGENT_SNS_WEB3_TURNKEY_LIVE_SIGN_ENABLED` + `AGENT_SNS_WEB3_BROKER_LIVE_SUBMIT_ENABLED` against a real deploy, broadcast a real userOp, then walk Refresh → Finalize in the GUI and confirm the receipt lands projected.

**SDK-side impact: none.** `finalize` is a platform operational surface on `chain_receipt`; it does not cross into the SDK's AppManifest / ToolManual developer contract.

### Phase 26 — one-button await finality (shipped, still not validated on Amoy)

- **`await_chain_receipt_finality()`** in `web3_payments.py` — orchestrates the three-step landing in a single call: `refresh_chain_receipt_status()` (Phase 17) → poll for `confirmed` → `finalize_chain_receipt()` (Phase 25). One round trip from the caller's perspective.
- **Public route** `POST /v1/market/web3/receipts/{receipt_id}/await-finality` (`presentation/marketplace_api.py`); service binding in `services.py`; schemas in `presentation/schemas.py`; TS types in `apps/web/src/lib/types.ts`; client in `apps/web/src/lib/api.ts`.
- **Owner GUI** (`OwnerWalletPage.tsx`) — each receipt row now also has an **Await finality** button. One click walks the receipt from `submitted (placeholder tx_hash)` all the way to `finalized + projector-reflected` without the operator having to drive Refresh and Finalize sync separately.
- **Tests**: `test_web3_payment_foundation.py` → 15 passed (was 14, +1 for the new await-finality path), `test_web3_wallet_broker_api.py` → 8 passed, `apps/web` build → pass, Python compile → pass.

**Significance: the ops story for a real Amoy run shrinks to three GUI clicks.** Validate signer → Execute → Await finality. Phases 17 and 25 added the individual stages as separate buttons (Refresh, Finalize sync); Phase 26 keeps those available but fuses them for the common case where an operator just wants to land a userOp with minimum friction. The separation still matters for debugging — if finality stalls partway, the individual buttons let you inspect each stage — but the happy path is now a single click.

**Caveat, still called out explicitly by Codex:** *the real Turnkey + Pimlico + Amoy chain has still not been run end-to-end against real infrastructure.* `amoy.json` remains a placeholder; the Amoy run itself (which actually landed at Phase 31 on 2026-04-18) requires — real deploy manifest, `AGENT_SNS_WEB3_TURNKEY_LIVE_SIGN_ENABLED=true` + `AGENT_SNS_WEB3_BROKER_LIVE_SUBMIT_ENABLED=true`, and walking Validate signer → Execute → Await finality from Owner Wallet against a live bundler.

**SDK-side impact: none.** `await-finality` is a platform operational surface on `chain_receipt`; it does not cross into the SDK's AppManifest / ToolManual developer contract.

### Phase 27 — execute + await finality threaded into customer flows (shipped, still not validated on Amoy)

- **`execute_web3_transaction(... await_finality=True ...)`** in `web3_payments.py` — the execute path now accepts an `await_finality` flag that, when true, internally chains refresh → confirmed-wait → finalize sync onto the successful submit, returning the finalized receipt in a single response. Backend wiring was already in place from Phase 26; Phase 27 exposes it at the execute call site.
- **Owner Wallet** (`OwnerWalletPage.tsx`) gains **Execute + await** and **Execute cancel + await** buttons next to the existing Execute / Execute cancel — one click lands a receipt at terminal state.
- **Plan subscription flow** (`apps/web/src/app/App.tsx`) — Plus / Pro purchases now pass `await_finality: true`. The UI no longer returns control until the mandate's activation receipt is finalized and projected; the customer's subscription state is consistent by the time the spinner clears.
- **Partner subscription flow** (`apps/web/src/app/PartnerDashboard.tsx`) — same change for Partner Web3 subscription activation.
- **Tests**: `test_web3_payment_foundation.py` → 16 passed (was 15, +1 unit test for `execute_web3_transaction(... await_finality=True ...)`), `test_web3_wallet_broker_api.py` → 8 passed, `apps/web` build → pass, Python compile → pass.

**Significance: the five-surface Web3 path is no longer just "mock-landable via operator button"** — Plan and Partner are now the first two surfaces where a real customer purchase drives its receipt all the way to `finalized + projector-reflected` **as part of the purchase action itself**, with no separate Await finality click. Phases 17, 25, 26 built the individual landing stages; Phase 26 fused them into one button; Phase 27 pushes that fused action inside the customer purchase path, so the fact that userOp landing is asynchronous becomes invisible to the buyer UI. Ads / API Store / AI Works still lean on separate execute + owner-initiated finalize, and will pick up `await_finality: true` on their own customer-facing surfaces as those flows are revisited.

**Caveat, still called out explicitly by Codex:** *the real Turnkey + Pimlico + Amoy chain has still not been run end-to-end against real infrastructure.* `amoy.json` remains a placeholder; Phase 28 is the Amoy run itself — live env, real deploy manifest, and walking Validate signer → Execute + await from a real customer surface against a live bundler.

**SDK-side impact: none.** The `await_finality` flag lives inside `/v1/market/web3/transactions/execute` request options and `chain_receipt` state; it does not cross into the SDK's AppManifest / ToolManual developer contract.

### Phase 28 — observation layer for the forthcoming Amoy run (shipped, live env still not injected)

Codex's direct response to the SDK-side request for observation fields the Amoy run will emit. Every metric the SDK side asked for is now first-class on the data model:

- **`chain_receipt` telemetry** (`web3_payments.py`, `presentation/schemas.py`, `apps/web/src/lib/types.ts`):
  - `actual_gas_used` — gas units consumed by the userOp once bundled on-chain
  - `actual_gas_cost_wei` — raw wei cost (paymaster-sponsored)
  - `actual_gas_cost_pol` — same amount in POL, convenience view for cost tracking
  - `last_status_checked_at` — last time refresh probed the bundler / RPC
  - `execute_to_confirmed_ms` — wall-clock ms from `execute` return to `confirmed`
  - `await_finality_elapsed_ms` — wall-clock ms the await-finality orchestrator spent
- **Await-finality response** (`web3_payments.py`, `presentation/schemas.py`):
  - `started_at` / `completed_at` / `elapsed_ms` — per-invocation timing, so a stalled finalize is visible against a successful one
- **Manifest placeholder detection** (`packages/shared-python/agent_sns/application/web3_contracts.py`, `web3_payments.py`):
  - `manifest_generated_at` — when the Hardhat deploy script stamped the manifest
  - `manifest_last_modified_at` — file mtime
  - `manifest_placeholder_suspected` — heuristic flag: true when the loaded manifest still looks like the hand-written placeholder rather than a real deploy
- **Owner Wallet surfacing** (`OwnerWalletPage.tsx`):
  - Manifest placeholder state shown prominently
  - Gas POL actually spent displayed per receipt
  - Confirm / await elapsed seconds visible inline
- **Plan + Partner flows** confirmed routing through `execute + await_finality=True` (a continuation of Phase 27, re-verified alongside the telemetry change so the new fields populate on real customer purchases)

**Tests**: `test_web3_payment_foundation.py` → 16 passed, `test_web3_wallet_broker_api.py` → 8 passed, `apps/web` build → pass, Python compile → pass.

**Explicit current state (from Codex):** the local shell still has *no* live credentials — `AGENT_SNS_WEB3_TURNKEY_*` (API URL / organization id / public key / private key / sign_with / live-sign-enabled), `AGENT_SNS_WEB3_BROKER_LIVE_SUBMIT_ENABLED`, `AGENT_SNS_WEB3_PIMLICO_BUNDLER_RPC_URL`, `AGENT_SNS_WEB3_PIMLICO_PAYMASTER_RPC_URL`, `AGENT_SNS_WEB3_POLYGON_RPC_URL`, `AGENT_SNS_WEB3_AMOY_RPC_URL` are all unset in the dev shell. The real Amoy run has therefore still not happened. What Phase 28 *does* guarantee is that the moment live env is injected and a real userOp lands, the metrics the SDK side asked for are captured without further code changes.

**Confirmed priority order (Codex private opinion shared 2026-04-17):**

1. Real Amoy end-to-end run (Phase 27 completion)
2. Standing indexer daemon — 24h operational foundation
3. Axis 2 migration design kickoff (SDK v0.2.0 drafting can start here in parallel)
4. 0x real swap execution
5. Mainnet (Polygon 137) cutover

Rationale: land live once → harden 24h ops → then tackle Axis 2 as the first post-hardening workstream. SDK v0.2.0 drafting aligns with step 3.

**SDK-side impact: none.** All telemetry fields ride on platform-side surfaces (`chain_receipt`, `/v1/market/web3/receipts/{id}/await-finality`, contract manifest loader). No AppManifest / ToolManual contract change.

### Phase 29 — Admin Settlement Ops Web3 panel + standing indexer daemon foundation (shipped)

Codex moved on their own priority #2 (standing indexer daemon = 24h ops foundation). Phase 29 delivers the admin-facing half: visibility and manual control from the GUI, with the daemon scaffolding in place for the resident process.

- **Admin Settlement Ops page — Web3 runtime panel** (`apps/web/src/app/pages/AdminSettlementOpsPage.tsx`):
  - Manifest state (addresses loaded, placeholder suspected flag)
  - Indexer status (running / idle / error)
  - Indexer lag (blocks behind chain head)
  - Last run timestamp
  - **Manual Sync** button — one-shot indexer pass against the configured RPC
  - **Indexer Cycle** button — kick one daemon cycle from the GUI
- **Admin Web3 client + types** (`apps/web/src/lib/api.ts`, `apps/web/src/lib/types.ts`) — wraps four admin endpoints:
  - `GET /v1/admin/market/web3/contracts` — loaded deployment manifest (Phase 3 surface)
  - `GET /v1/admin/market/web3/indexer/status` — daemon status + lag (new)
  - `POST /v1/admin/market/web3/sync` — one-shot indexer pass (Phase 3 surface)
  - `POST /v1/admin/market/web3/indexer/run` — single daemon cycle (new)
- **Daemon scaffolding** (`packages/shared-python/agent_sns/application/web3_indexer_daemon.py`, new) — structured loop around the existing indexer with schedulable cycles; `services.py` binding; `marketplace_api.py` admin routes; `presentation/schemas.py` response shapes; `settings.py` + `.env.example` gain daemon knobs (cycle interval, concurrency lock, etc.).
- **Tests**: `test_web3_payment_foundation.py` → 18 passed (was 16, +2 for daemon scaffold + admin status paths), `apps/web` build → pass.

**Significance: operations can now see and steer Web3 infra without an SSH session.** Up through Phase 17, per-receipt refresh gave owners a self-service resolve path for their own receipts. Phase 29 gives admins the *fleet-wide* equivalent: a single screen that says "your indexer is N blocks behind, last ran M minutes ago, click to run again." This is the scaffolding under Codex's stated priority #2; the resident daemon itself runs next, now that the observability and manual controls are in place to watch it.

**Env injection status on the SDK-side operator's local:** the SDK-side operator (not Codex) has populated their own `.env` with:

- Turnkey: `AGENT_SNS_WEB3_TURNKEY_ORGANIZATION_ID`, full API key pair, `AGENT_SNS_WEB3_TURNKEY_SIGN_WITH`, and `AGENT_SNS_WEB3_TURNKEY_LIVE_SIGN_ENABLED=true` (values redacted — actual identifiers live in the operator's private runbook, not this public doc)
- Pimlico: bundler + paymaster RPC URLs for `polygon-amoy`
- Polygon: Amoy + mainnet RPCs (Infura)
- `WALLET_PROVIDER=turnkey_http`, `BROKER_LIVE_SUBMIT_ENABLED=true`

And has handed the go-ahead to Codex to:

1. Faucet test POL into the deployer wallet
2. `npx hardhat run scripts/deploy.js --network polygonAmoy` — replace `amoy.json` placeholder with real addresses
3. Small test POL transfer to the Turnkey wallet as a safety net against gas-sponsorship edge cases
4. Walk Validate signer → Execute + Await finality from a real customer surface
5. Report userOpHash / tx_hash / block / confirmations / elapsed / gas POL

That run is the next checkpoint, and the blocker that was "env not injected" has now shifted from the SDK-side operator to the Codex-side dev shell / deploy environment.

**SDK-side impact: none.** The admin panel and indexer daemon are platform operational surfaces; they do not cross into the SDK's AppManifest / ToolManual developer contract.

### Phase 30 — Amoy deploy self-sufficiency, official Turnkey stamper, transparent errors (shipped, live run blocked on credentials)

Codex's first real attempt to complete an Amoy run exposed a pile of latent gaps. Phase 30 closes the code-side gaps (`TurnKey stamp implementation correctness`, `Amoy deploy requiring pre-existing token addresses`, `broker failures hidden behind 502`, `provider-status network mis-reported`) and leaves a single remaining blocker for the operator.

- **Hardhat `deploy.js` auto-bootstraps tokens** (`packages/contracts/web3-payments/scripts/deploy.js:1`): if USDC / JPYC env addresses are unset, the script now deploys fresh Mock USDC / Mock JPYC as part of the same run and wires them into the manifest. `initialOwner` falls back to `AGENT_SNS_WEB3_TURNKEY_SIGN_WITH` so the standard Turnkey wallet ends up owning the mocks. Amoy deploy no longer requires pre-existing token contracts.
- **Official Turnkey stamper adopted** (`packages/contracts/web3-payments/scripts/turnkey-helper.js` + `web3_wallet_broker_api.py`): the hand-rolled P-256 X-Stamp generator is retired in favor of `@turnkey/api-key-stamper`, Turnkey's officially-maintained signing library. This removes an entire class of "did we format the stamp right" failure modes.
- **Transparent Turnkey error bubbles to GUI** (`packages/shared-python/agent_sns/application/web3_payments.py`): whatever Turnkey sends back as a detail reason now rides the API response out to Validate signer / Execute + await. Operator sees the actual error string instead of a generic 502.
- **Provider-status reports Amoy correctly** — `/v1/market/web3/provider-status` now returns `network=amoy, chain_id=80002` when live env is loaded against Amoy.
- **Tests**: `test_web3_wallet_broker_api.py` → 8 passed, `test_web3_payment_foundation.py` → 18 passed, Hardhat `Web3Payments.test.js` → 4 passing, `apps/web` build → pass.

**Hard blocker surfaced by this phase — credentials mismatch:**

With everything else wired, running `POST /v1/market/web3/signer/validate` against a live broker returns:

```
turnkey whoami failed: public key could not be found in organization or its parent organization
```

Codex verified this reproduces with the **official `@turnkey/api-key-stamper`** — same 401 / SIGNATURE_INVALID. The implementation is correct; what's wrong is the credentials triple in `.env`:

- `AGENT_SNS_WEB3_TURNKEY_ORGANIZATION_ID`
- `AGENT_SNS_WEB3_TURNKEY_API_PUBLIC_KEY`
- `AGENT_SNS_WEB3_TURNKEY_API_PRIVATE_KEY`

The org_id / api_public_key / api_private_key currently in `.env` do not map to a live API key registered in the Turnkey organization. Typical root causes: public key in env does not correspond to the private key (copy-paste error), API key was deleted in Dashboard, private key was regenerated but public key was not re-copied, or the key was created under a different organization.

**Soft blockers also noted:**

- `AGENT_SNS_WEB3_DEPLOYER_PRIVATE_KEY` is still empty — matters if running Hardhat deploy via EOA; not a blocker if deployment pivots to userOp-via-broker. Turnkey signer run has priority for now.
- `AGENT_SNS_WEB3_DELEGATED_WALLET_API_URL` unset for the SDK-side operator's local broker; Codex can run broker locally without this populated on the operator's side.
- Token env unset — now handled automatically by Phase 30's Mock deploy path, no longer a blocker.

**The one action remaining on the SDK-side operator:**

Re-pair the three Turnkey env variables to an actually-live API key in the organization. Concretely: open Turnkey Dashboard → Users → Root user → API Keys, verify which public key is registered for the `siglume` API key, confirm the private key in `.env` matches that public key (re-creating the API key if either half is wrong), and re-paste both halves into `.env` cleanly. Once `signer/validate` returns 200, Codex drives the remainder (deploy → Execute + await → return userOpHash / tx_hash / block / confirmations / elapsed / gas POL).

**Codex confirmed unchanged:**

- Phase 27 telemetry fields are wired but have not yet recorded a real value (no live run has completed)
- `_VALID_PRICE_MODELS` unchanged, `USAGE_BASED` / `PER_ACTION` still reserved
- `VALID_SETTLEMENT_MODES` unchanged — **SDK v0.2.0 breaking trigger has not fired**
- `amoy.json` remains a placeholder; Phase 30's self-sufficient deploy will replace it on first successful live run

**SDK-side impact: none.** The stamper swap and deploy self-sufficiency are platform-internal; the error-transparency change rides on existing response shapes. No AppManifest / ToolManual contract change.

### Phase 31 — first real Amoy live completion ✅ (shipped 2026-04-18)

**The milestone.** After the operator re-paired the three `AGENT_SNS_WEB3_TURNKEY_*` values to a valid API key, Codex ran Validate signer → create_mandate → Execute + await-finality → Refresh / Finalize end-to-end on **Polygon Amoy against real Turnkey signing, real Pimlico bundler + paymaster, and real Polygon chain**. The userOp landed, was bundled, confirmed, and the projector updated the receipt — all within a single GUI-driven flow.

**Real Amoy measurements (2026-04-18):**

| Metric | Value |
|---|---|
| `userOpHash` | `0xaa55cbae5f6184c715cd1b8fde5e8869e4b7ca6374ae5d081d5a17447dbf84bc` |
| resolved `tx_hash` | `0xa04699ff0e94fc783c6ee85e69e82daf40bf8f059b008d6204bfe516be55639d` |
| `block_number` | `36829663` |
| confirmations at completion | 17 (now 109) |
| `execute_to_confirmed_ms` | **2,397** (~2.4s from execute return to chain confirmation) |
| `await_finality_elapsed_ms` (first call) | 31,500 (~31.5s) |
| `await_finality_elapsed_ms` (re-check) | 10,592 (~10.6s) |
| HTTP elapsed for execute call | 46.33s (synchronous await_finality holding the connection) |
| `actual_gas_used` | 397,051 |
| `actual_gas_cost_wei` | 60,206,474,460,488,467 |
| `actual_gas_cost_pol` | **0.060** POL |
| paymaster | `0x6666666666667849c56f2850848cE1C4da65c68b` (Pimlico) |
| signer `activity_status` | `ACTIVITY_STATUS_COMPLETED` |
| `signer_mode` | `turnkey_http` |

**`amoy.json` is no longer a placeholder (deployed 2026-04-18 08:28:43 JST):**

| Contract | Amoy Address |
|---|---|
| FeeVault | `0xafA12862dc4Ad383B9C5244fFb5681a931962aD1` |
| SubscriptionHub | `0x74940be09a1E304696787E531236FCA87B875480` |
| AdsBillingHub | `0x7c2C9CAd5f9beCAB96219F2326B8449A0DEed9B9` |
| WorksEscrowHub | `0x518f2532C7fe097b07C01a2B357f3b4Ea202c84a` |
| Mock USDC | `0x665F51890bD2Dac382487f09C6d2331ca5b5bB40` |
| Mock JPYC | `0x24BA87f51443140815Fd27223AE71fBFA39C3F8d` |

**Bug fixes shipped alongside the live run:**

- `await-finality` response alias fix (`marketplace_api.py:3354`)
- Wallet overview now resolves `amoy` / `80002` correctly (`web3_payments.py:1092`)
- Indexer mandate lookup keyed to deployment network (`web3_indexer.py:173`)

**Tests**: `test_web3_payment_foundation.py` → 18 passed, `py_compile` → pass.

**Significance: Axis 1 is no longer a claim — it is proven on-chain.** Up through Phase 30 every "Web3 works" claim in this document was qualified with "mock-backed" or "wired but not validated." Phase 31 removes the qualifier. A buyer clicking Plus on a real surface now demonstrably flows: Turnkey signs → Pimlico bundles → Polygon includes → projector finalizes. The cost and latency numbers are also now concrete rather than speculative — ~$0.05 in gas per userOp at Amoy prices, sub-three-seconds to confirmation, ~30 seconds for the full await-finality cycle including the conservative confirmation buffer.

**What this unblocks for SDK consumers with paid subscription APIs:** the earlier "paid subscription publish is unpaused for sellers with a verified Polygon payout wallet" status from Phase 9 moves from "mock provider wires it together" to "a real customer purchase actually lands on Polygon." The SDK contract itself is still unchanged (Axis 1 does not cross into `SettlementMode`), but the confidence statement in the publishing flow can now cite a specific on-chain transaction.

**Codex's recommended next step:** standing indexer daemon (priority #2 from the 2026-04-17 shared order) → then Axis 2 migration design kickoff (priority #3, the SDK v0.2.0 trigger).

**Codex confirmed unchanged:**

- `_VALID_PRICE_MODELS` unchanged; `USAGE_BASED` / `PER_ACTION` still reserved
- `VALID_SETTLEMENT_MODES` unchanged — **SDK v0.2.0 breaking trigger has not fired**

**SDK-side impact: none (yet).** The live completion is an Axis 1 milestone; Axis 2 triggers the SDK release. That said, the SDK doc should now drop "paused" / "mock-only" language around paid subscription publish where sellers have a Polygon payout wallet — this is tracked for the next doc pass.

### Phase 32 — resident Web3 indexer daemon running ✅ (shipped 2026-04-18)

Codex's stated priority #2 from 2026-04-17 delivered: the standing indexer daemon is no longer scaffolding — it is an actual resident process with heartbeat / stale detection, a stable runner ID, and admin-visible state.

**Shipped:**

- **Daemon runtime with liveness signals** (`packages/shared-python/agent_sns/application/web3_indexer_daemon.py`): heartbeat tick, configurable stale threshold, cycle counter, runner ID assignment so multi-instance deploys can distinguish which daemon owns a sync range
- **Configuration surface** (`settings.py`, `.env.example`): new env values for daemon cycle interval, batch size, heartbeat frequency, stale-after threshold
- **Admin API status payload expanded** (`marketplace_api.py`, `presentation/schemas.py`): `GET /v1/admin/market/web3/indexer/status` now returns `daemon_state` / `runner_id` / `heartbeat_seconds` / `stale_after_seconds` alongside the Phase 29 manifest / indexer lag / last-run fields
- **Admin GUI daemon state** (`apps/web/src/app/pages/AdminSettlementOpsPage.tsx`, `apps/web/src/lib/types.ts`): Web3 runtime panel shows daemon state and heartbeat pulse — admins can see at a glance whether the daemon is alive, stale, or not yet bootstrapped
- **Phase 31 bug fixes (await-finality alias, wallet amoy/80002, indexer by deployment network) verified still green under resident mode**

**Tests**: `test_web3_payment_foundation.py` → 20 passed (was 18, +2 for daemon lifecycle), `apps/web` build → pass, `py_compile` → pass. Plus a one-shot smoke test: `py -3.11 -m apps.api.app.web3_indexer --once --max-blocks 50` → pass.

**Current local daemon state (live):**

- `daemon_state`: `idle`
- `runner_id`: `web3-indexer-afa01f3f1e7d`
- pid: 11056
- `cycle_count`: 3
- `synced_to_block`: 36833713
- `latest_block_number`: 36839286
- `finalized_block_number`: 36839274
- `lag_blocks`: 5561 (actively catching up at 2,000-block batches — converges in a few cycles)

**Significance: 24-hour operational foundation is in place.** Phase 17 gave owners self-service receipt refresh; Phase 29 gave admins manual sync / cycle-run buttons; Phase 32 is the continuous background process those tools were built to monitor. Combined with the Phase 28 observation fields and the Phase 31 live-completion proof, the Axis 1 stack is now production-shaped, not just feature-complete.

**Codex confirmed next workstream = Axis 2 migration design → SDK v0.2.0 trigger.** Priority #2 closed, priority #3 opens. SDK-side drafting (enum / schemas / example replacement for `SettlementMode.stripe_checkout` / `stripe_payment_intent` → Web3 values) can begin in parallel now — the server-side shape decisions from Codex's design work will then inform the final SDK values.

**Codex confirmed unchanged:**

- `_VALID_PRICE_MODELS` unchanged; `USAGE_BASED` / `PER_ACTION` still reserved
- `VALID_SETTLEMENT_MODES` unchanged — **SDK v0.2.0 breaking trigger has not fired yet**, but Axis 2 design now queued

**SDK-side impact: none yet.** Daemon runtime and admin surface are platform-internal; no AppManifest / ToolManual contract change. The *next* phase — Axis 2 design — is where SDK contract finally moves.

### Phase 33 — Axis 2 first vertical: `SettlementMode` expands, SDK v0.2.0 cut 🎯 (shipped 2026-04-18)

**The SDK v0.2.0 breaking trigger has fired.** Server `VALID_SETTLEMENT_MODES` is no longer frozen at `{stripe_checkout, stripe_payment_intent}` — it now accepts `polygon_mandate` and `embedded_wallet_charge`. The SDK mirror (`packages/contracts/sdk/`) and the public SDK repo (`siglume-api-sdk`) both carry the same expansion in this phase.

**Shipped (server side):**

- **`SettlementMode` enum expanded on the server**: `polygon_mandate`, `embedded_wallet_charge` added
- **Tool runtime threading** — `settlement_mode` / `settlement_currency` / `settlement_network` / `accepted_payment_tokens` flow from `tool_manual_validator.py` → `installed_tool_resolver.py` → `capability_gateway.py` → `tool_use_runtime.py` → `tool_use_api.py` through dry-run preview, approval snapshot, `intent.plan_jsonb`, and the installed-tools API response
- **Owner Installed Tools page** (`OwnerInstalledToolsPage.tsx`) displays settlement rail and accepted tokens per installed tool
- **Tests**: `test_tool_use_axis2.py` + `test_web3_payment_foundation.py` → 23 passed combined, `apps/web` build pass, `py_compile` pass

**Shipped (SDK side, v0.2.0 cut):**

- `siglume_api_sdk.py`: `SettlementMode` enum and `validate_tool_manual()` whitelist both expanded
- `siglume-api-types.ts`: TypeScript union extended
- `schemas/tool-manual.schema.json`: JSON Schema `settlement_mode.enum` extended
- `openapi/developer-surface.yaml`: OpenAPI `settlement_mode.enum` extended
- `pyproject.toml`: version bumped `0.1.0 → 0.2.0`
- `CHANGELOG.md`: v0.2.0 entry with migration guide
- `RELEASE_NOTES_v0.2.0.md`: full release notes

**Important scope note from Codex (explicit):**

> 今回入ったのは Axis 2 の metadata / validator / approval propagation です。payment permission の tool 実行そのものが、もう Web3 で本当に settle するところまではまだ入っていません。

Phase 33 makes the new modes **declarable and propagatable** — a tool manual with `settlement_mode="polygon_mandate"` validates on v0.2.0, flows through the approval surfaces, and appears in the installed-tools API. But the actual runtime path where `charge()` fires against a Polygon mandate or embedded-wallet drain is a subsequent phase. For today: declaring the new mode is a metadata commitment the platform honors (it will validate, resolve, preview, approve), not a runtime behavior change.

**Significance (SDK-facing):**

- v0.2.0 is the first SDK release where declining to upgrade is a real signal. Developers who want to opt into Polygon settlement must upgrade to v0.2.0; staying on v0.1.x means the validator will reject `polygon_mandate` / `embedded_wallet_charge` before the platform ever sees the manifest.
- Existing `stripe_checkout` / `stripe_payment_intent` tool manuals continue to validate and run unchanged — no forced migration; the two new values are additive opt-in paths.
- The Phase 9 note ("paid subscription publish is unpaused for sellers with a verified Polygon payout wallet") — which moved from "mock-backed" to "real-Polygon-backed" at Phase 31 — is now additionally backed by a matching SDK contract.

**Codex confirmed unchanged:**

- `_VALID_PRICE_MODELS` still frozen at `{free, subscription}`; `USAGE_BASED` / `PER_ACTION` remain reserved
- Payment-permission tool runtime still dispatches through Stripe for now when `stripe_*` is declared; Polygon-mode runtime dispatch is the next phase (Phase 34+)

**What the SDK v0.2.0 release does not include (deliberate):**

- `examples/metamask_connector.py` is still the old "bring your own MetaMask + direct-sign" stub. That rewrite is scheduled for when the runtime Web3 dispatch lands — otherwise the example would demo a value the platform doesn't yet actually execute.
- No new fields on `ToolManual` beyond the enum value expansion. `accepted_payment_tokens` / `settlement_currency` / `settlement_network` are *server-side* metadata the platform derives and surfaces — SDK still declares only `settlement_mode` on the tool manual.

### Phase 34 — payment tool runtime dispatches to Web3 rail ✅ (shipped 2026-04-18)

Phase 33 shipped metadata / validator / approval propagation but left the runtime charge path unmoved ("declaring `polygon_mandate` is a metadata commitment, not a runtime change"). Phase 34 lifts that qualifier for the actual tool-execution path.

**Shipped (server-side only — no SDK enum / schema change):**

- **`capability_gateway.py` live-settlement branching**: when `permission_class == "payment"` **and** `settlement_mode ∈ {polygon_mandate, embedded_wallet_charge}`, the gateway now routes through an actual Web3 settlement handoff instead of the Stripe path.
- **`polygon_mandate` runtime**: resolves the seller's verified Polygon payout wallet, builds and executes an on-chain `createMandate` against `SubscriptionHub` at tool-authorization time. The authorization itself lands on Polygon.
- **`embedded_wallet_charge` runtime**: a new helper `build_embedded_wallet_charge_transaction_request()` in `web3_tx_plans.py` builds an ERC-20 `transfer` prepared tx, and the gateway drives that through the embedded-wallet executor — a direct token transfer from the buyer's smart account to the seller's payout address, resolved on-chain in the same execute call.
- **Execution receipts carry settlement metadata** (`tool_use_runtime.py`): `settlement_mode`, `settlement_network`, `settlement_currency`, `accepted_payment_tokens`, mandate id / tx hash / chain receipt id flow into the receipt alongside the execution-side fields.
- **Projector hygiene** (`web3_payments.py`): tool-execution mandates are now explicitly *excluded* from the recurring-charge projector — the Phase 31 subscription mandate lifecycle and the Phase 34 tool-execution mandate lifecycle use the same on-chain primitive but do not share re-charge scheduling.

**Tests**: `test_tool_use_axis2.py` + `test_web3_payment_foundation.py` → **25 passed** (was 23, +2 for approve → live execute covering both modes and their receipt / settlement metadata), `py_compile` → pass.

**Explicit caveat from Codex:**

> 今回は SDK enum/schema の追加変更はなし
> ただし polygon_mandate は「その場で authorize する」段で、relayer による後続 charge orchestration はまだ別です

So `polygon_mandate` at Phase 34 means the mandate is *created on-chain* when the tool is authorized — the platform has the authorization in place to debit the buyer's wallet up to the mandate's cap. What is *not* yet wired is the relayer / scheduler that periodically fires the actual charge userOp against an already-authorized mandate. That is a subsequent phase.

For `embedded_wallet_charge` there is no equivalent gap — it is a one-shot transfer executed at tool-call time and completes on-chain synchronously with the tool execution.

**Significance — scope note now partially lifted:**

The v0.2.0 release notes' scope note ("declaring the new mode is a metadata commitment, not a runtime change") was accurate *at the time of cut*. After Phase 34:

- **`embedded_wallet_charge`**: fully runtime — one-shot Polygon settlement happens as part of the tool execution
- **`polygon_mandate`**: runtime authorization happens (on-chain mandate creation), but recurring-charge dispatch is still pending

For SDK developers, the v0.2.0 enum is now genuinely live — declaring `polygon_mandate` causes an on-chain side effect, not just metadata propagation.

**What SDK v0.2.0 release notes should eventually be updated to reflect (not urgent):**

- `embedded_wallet_charge` is fully runtime-backed now
- `polygon_mandate` authorizes on-chain at tool authorization time; recurring dispatch follow-up phase
- `examples/metamask_connector.py` can be rewritten once the `polygon_mandate` recurring side is live — defer to avoid churn

**Codex confirmed unchanged:**

- `_VALID_PRICE_MODELS` still frozen at `{free, subscription}`; `USAGE_BASED` / `PER_ACTION` remain reserved
- `VALID_SETTLEMENT_MODES` unchanged since Phase 33 (the 4-value set). No enum addition in Phase 34
- SDK v0.2.0 contract still correct — the only SDK-side follow-up is the release-notes wording update described above, which can wait for a v0.2.1 docs-only `.post` if desired

**SDK-side impact: none in Phase 34.** No enum value added, no new field added to `ToolManual`. Phase 34 is a server-side runtime upgrade that activates the enum values v0.2.0 already declared.

### Phase 35 — 0x real swap execution ✅ (shipped 2026-04-18)

One of the longest-standing `Still pending` items closes. 0x swap quote was a deterministic mock since Phase 3; Phase 35 makes it a real quote against 0x API + real approve + real swap calldata.

**Shipped:**

- **0x AllowanceHolder integration** (`web3_payments.py:1133`): calls the 0x AllowanceHolder quote endpoint, then returns three coupled fields:
  - `approve_transaction_request` — ERC-20 `approve` calldata targeting `issues.allowance.spender`
  - `swap_transaction_request` — the swap itself, `transaction.to / data / value` from the 0x response
  - `allowance_needed` — boolean flag so the caller knows whether to skip the approve step for already-allowed tokens
- **Prepared tx builder** (`web3_tx_plans.py:268`): generates the `approve` + swap router calldata from the 0x response.
- **Schema expansion** (`presentation/schemas.py:877`): `SwapQuoteResponse` now includes the three fields above.
- **Prepared execution extended to `await_finality`** (`marketplace_api.py:3440`): the swap can now block until projector-finalized, matching other execute paths.
- **Owner Wallet staged UI** (`OwnerWalletPage.tsx:1452`): quote → Approve allowance → Execute swap, with provider / expiry / allowance status visible at each step. Deliberately a 3-step flow rather than a single "Swap" button — for an owner-console audience, auditability beats ergonomics.
- **Test**: `test_web3_payment_foundation.py` → **21 passed** (+1 — a quote fixture drives generation of the approve/swap request pair and asserts on their shape).

**Implementation references** 0x primary docs (Codex noted):
- <https://docs.0x.org/docs/0x-swap-api/additional-topics/how-to-set-your-token-allowances>
- <https://docs.0x.org/docs/0x-swap-api/guides/swap-tokens-with-0x-swap-api>
- <https://docs.0x.org/api-reference/api-overview>

**SDK-side impact: none.** 0x integration is a platform swap-infrastructure feature; it does not cross the SDK's AppManifest / ToolManual contract.

**Codex's explicit scoping note for this phase:** the migration is not production-complete yet. Phase 35 closes "one of the repo's biggest unlanded items," but the remaining gaps are: mainnet cutover, production token address pinning, Stripe complete shutdown + existing-contract migration, and final 5-surface live GUI completion verification. Codex offered to break those into an ordered plan with explicit completion criteria if the operator wants to sequence them.

### Phase 36 — ideal two-tier settlement spec landed ✅ (shipped 2026-04-18)

The product-level settlement spec converges after the 5-agent review and operator's "理想の仕様" decision. Two tiers, not one:

| Tier | Surfaces | Settlement |
|---|---|---|
| **User-selectable dual-rail** | Plan, Advertising, Data Partner | Stripe (credit card) **or** Polygon Web3 (stablecoin). Rail chosen at checkout; stored on the campaign / subscription. |
| **Web3-only (backend enforced)** | Agent API Store, AI Works | Polygon Web3 only. Stripe fallback removed because cross-border seller payouts via Stripe Connect are a per-country KYC + destination-charges friction this product does not want to absorb. |

**Shipped (server + UI):**

- **API Store Web3-only enforcement** (`marketplace_capabilities.py:1893`): Stripe Connect fallback removed. Purchases require a seller with a verified Polygon payout wallet; otherwise `409 Conflict`.
- **AI Works Web3-only enforcement** (`works_service.py:1421`): Stripe escrow fallback removed. New orders flow through `WorksEscrowHub` only.
- **Plan rail selection** (`App.tsx:1712`, `App.tsx:5612`): `pricingCheckoutRail` state + UI selector; Stripe path (`startPricingCheckout` / `upgrade`) is now reachable again, Web3 path (`startPricingSubscription` / `upgradeViaWeb3`) stays wired.
- **Partner rail selection** (`PartnerDashboard.tsx:330`): Billing panel offers both Stripe and Polygon Web3 with `handleCheckout` routing by selection.
- **Ads rail selection** (`AdDashboard.tsx:28`, `ad-api.ts:156`, `ad_api.py:123`): campaign-level rail choice replaces the operator-side `economy_web3_adapter_enabled` env flag. Existing `billing_mode` union extended to `"stripe" | "polygon" | "mock"`.
- **Seller onboarding realigned** (`WorksRegisterPage.tsx:155`, `OwnerPublishPage.tsx:1044`): payout setup is Polygon-wallet-first; Stripe Connect onboarding is not triggered by new seller flows.
- **Owner UI cleanup** (`OwnerBudgetsPage.tsx:15`, `OwnerInstalledToolsPage.tsx:374`, `OwnerPublishPage.tsx:326`, `styles.css`): "Not connected" placeholder copy removed, settlement labels clarified, internal `stripe*` copy keys renamed to `payout*` series.
- **Legal pages updated to match** (`App.tsx:2433` area): ToS §6 JA/EN, Privacy Policy JA/EN, 特商法 JA/EN rewritten to describe dual-rail for Plan/Ads/Partner and Web3-only for API Store/AI Works. This replaces the interim transitional-provisions clauses from the earlier migration pass — the final wording reflects the implementation that actually exists.
- **Cloud rewrite brief** produced (`docs/legal-drafts/2026-04-18-dual-rail-rewrite/cloud-request.md`) for a more polished second pass by external legal-writing Claude if desired.

**Tests**: 37 passed combined:

- `test_ad_campaigns.py` → 5 passed
- `test_partner_dashboard.py` → 6 passed
- `test_web3_payment_foundation.py` → 21 passed
- `test_tool_use_axis2.py` → 5 passed
- `apps/web` build → pass, `py_compile` → pass

**Honest caveat from Codex (explicit, do not gloss):**

> 旧 Stripe 実装のコード片 は repo 内にまだ残っています

User-facing flows and backend hard-requirements match the ideal spec. But inside the repo, some legacy Stripe-era code paths still exist — dead code from the app's perspective but not yet removed. Examples: `integrations/stripe_api_store.py`, `integrations/stripe_works.py`, and older `stripe_*` model fields that the new API Store / AI Works flows never reach.

Removing them is a separate cleanup workstream (low-risk, boring refactor) and is deliberately deferred: the Plan / Ads / Partner tier still uses Stripe, so not all `stripe_*` identifiers are dead — only the API Store / AI Works Stripe path is. A rushed rename would risk touching code that's still live.

**Significance — the migration's product spec is now "done" in the user-visible sense:**

- Every checkout that a real customer can initiate today routes correctly per this tier table
- Every ToS / 特商法 claim matches what the running code actually does
- Seller onboarding never sends a new seller through Stripe Connect for API Store / AI Works

**Still pending (distinct from product spec, per Codex's stated next steps):**

- Cleanup of dead Stripe code paths (low-risk refactor)
- `polygon_mandate` recurring-charge dispatcher (the authorize step is done in Phase 34; the periodic-charge scheduler is the remaining piece)
- Mainnet (Polygon 137) cutover + production paymaster funding + production token address pinning
- 5-surface live GUI walk-through verification on real Polygon (Codex's own next step)
- External claude.ai legal-writing pass (brief is filed at `docs/legal-drafts/2026-04-18-dual-rail-rewrite/cloud-request.md`; can run in parallel)

**Codex confirmed unchanged:**

- `_VALID_PRICE_MODELS` unchanged; `USAGE_BASED` / `PER_ACTION` still reserved
- `VALID_SETTLEMENT_MODES` unchanged since Phase 33 (the 4-value set). No SDK enum change in Phase 36

**SDK-side impact: none.** The Plan / Ads / Partner dual-rail UI and the API Store / AI Works Web3-only enforcement are server + frontend concerns. SDK v0.2.0's `SettlementMode` enum (4 values) already covers both tiers. No contract change needed.

### Phase 37 — two-tier polish pass + Polygon-as-default (shipped 2026-04-18)

Incremental cleanup after Phase 36. No behavioral reversal; everything here tightens the two-tier spec that landed in Phase 36.

**Shipped:**

- **Legal / disclosure copy tightened** (`App.tsx:2433` area): the Phase 36 rewrite of ToS / Privacy / 特商法 is further clarified so the Plan/Ads/Partner-selectable vs API Store/AI Works-Web3-only split is unambiguous on every relevant row. Replaces the "current" phrasing with what the running code actually enforces.
- **Owner Budgets page** (`OwnerBudgetsPage.tsx:15`): "未接続" / "not connected" precondition removed — it was a Stripe-era placeholder that didn't match the current dual-rail Billing model.
- **Works Order Detail** (`WorksOrderDetailPage.tsx:351`): old `checkout*` state renamed to `settlement*` — aligns with the settlement metadata vocabulary used everywhere else since Phase 34.
- **Partner error messages** naturalized (stripe-specific error text replaced with rail-neutral language).
- **Admin rollout defaults aligned to Web3** (`AdminRolloutOpsPage.tsx:1656`, `settings.py:58`, `marketplace_payouts.py:69`, `schemas.py:1805`): **the default `settlement_backend` when none is specified is now `polygon_wallet`**, not `stripe_connect`. This is the single most substantive change in Phase 37 — previously, a seller / campaign / subscription with no explicit rail would be assumed Stripe; now it's Polygon. Existing records with `stripe_connect` backend keep that value; only unset/new records inherit the new default.
- **Cloud rewrite brief** filed (`cloud-request.md:1`) — ready for optional external claude.ai polish pass.

**Tests**: same 37 passing suite as Phase 36 (no new tests, no regressions).

**Codex's honest line on what remains:**

> 残っている Stripe 名残は、ほぼ backend の legacy alias や既存互換用だけです。ユーザーに見える層はかなり揃いました。

Translation: the remaining `stripe*` identifiers in the repo are almost all either (a) backend legacy aliases maintained for existing-record compat, or (b) Stripe-specific code paths that still legitimately run for Plan/Ads/Partner Stripe-selected subscribers. No user-visible contradiction remains.

**Significance — what "migration complete" now means:**

- Any **new** customer interaction routes correctly under the two-tier spec
- Any **new** seller onboards to Polygon payout wallet directly
- **Default rail** when unspecified is Polygon (was Stripe — silent reversal of the implicit default)
- **Legal pages** match running code, with per-tier specificity
- **Existing** Stripe-settled subscribers / campaigns continue on Stripe until they voluntarily migrate or the operator force-migrates (no policy decision yet on force-migration date)

**SDK-side impact: none.** `SettlementMode` enum unchanged. The default provider change is server-side; SDK consumers still see `SettlementMode.stripe_*` and `SettlementMode.polygon_mandate` / `embedded_wallet_charge` as valid declarable values, with server-side enforcement deciding which surfaces accept which values.

### Phase 38 — Web3 production preflight surface (shipped 2026-04-18, on `recovery-2026-04-18` branch)

The cutover-safety gate. Before any mainnet deploy, this phase lets the operator confirm every live-dependency is green.

**Shipped (on `recovery-2026-04-18` branch, not yet merged to main):**

- **Backend endpoint** `GET /v1/admin/market/web3/preflight` (`web3_payments.py`, `marketplace_api.py`, `schemas.py`): returns `pass` / `warn` / `fail` + a `next_action` string per check. Checks covered:
  - `manifest` — deployment manifest loaded, real (non-placeholder) addresses
  - `mainnet_tokens` — USDC / JPYC addresses configured + allowlisted
  - `polygon_rpc` — `AGENT_SNS_WEB3_POLYGON_RPC_URL` / `_AMOY_RPC_URL` reachable
  - `turnkey_signer` — live signer probe returns 200, `LIVE_SIGN_ENABLED=true`
  - `bundler` — Pimlico bundler reachable, entry point resolves
  - `paymaster` — Pimlico paymaster reachable + deposit balance query
  - `indexer` — resident daemon heartbeat fresh, lag < threshold
  - `0x_swap` — swap-quote endpoint returns a real quote
  - `operator_safe` — operator Safe address configured (for FeeVault + admin ops)
- **Admin GUI** — `AdminSettlementOpsPage.tsx` gains a preflight panel:
  - Blockers (red) + Warnings (yellow) summary at top
  - Per-check detail with next-action hint
  - Live refresh button
- **CLI** — `py -3.11 -m apps.api.app.web3_preflight --require-ready`:
  - Exits non-zero if any `fail` check present — slots into CI / cutover script for gating
  - Prints the same snapshot as the GUI
- **Runbook updated** — `docs/project_phase_4/16_stripe_to_polygon_cutover_runbook.md` now documents the preflight as the mandatory first step before any cutover action.

**Tests**: `test_web3_payment_foundation.py` + `test_tool_use_axis2.py` → **28 passed** (+2 for preflight paths), `apps/web` build → pass, `--help` smoke → pass.

**Why this matters operationally:**

- Without preflight: operator runs `hardhat deploy` → mainnet, discovers mid-cutover that (say) Pimlico paymaster has no deposit → customers get gas-sponsored-rejection errors
- With preflight: `--require-ready` gates cutover with a single command, admin GUI makes on-call visibility trivial, and each failing check ships with the next action ("deposit X POL to paymaster at 0x...") instead of a cryptic error

**Important: branch state disclosure**

Phase 36 (two-tier landing), Phase 37 (polish + Polygon default), and Phase 38 (preflight) **all live on `recovery-2026-04-18`, not yet on `main`**. The `main` branch's most recent commit is iter 48 (doc-only mirror). The recovery branch exists because an earlier sync-loop `git stash` cycle left the WIP temporarily stranded; a rescue commit `e6b1e1c` (98 files / +24,248 lines) restored it.

A reviewer audit on that recovery commit surfaced **4 CRITICAL implementation defects that must be fixed before merging to main**:

1. Decimal scale mismatch — `max_amount_minor` passed raw into uint256 calldata, but contracts expect token-native units (USDC=10^6, JPYC=10^18). A $5 subscription would actually transfer $0.0005. Mock-mode invisible, real-chain silent money bug. (`web3_tx_plans.py:387, 423, 569`)
2. `RowMapping` attribute access — `.mappings().first()` returns dict-like but code uses `.attribute` access; `AttributeError` on any default-policy paid purchase. (`marketplace_capabilities.py:1202-1213`)
3. Null-safety — `row.metadata_jsonb.get(...)` on nullable JSON column, blocks seller payout resolution when null. (`marketplace_capabilities.py:337`)
4. New Works orders persist `settlement_backend="stripe_connect"` at creation, only flip to `polygon_web3` in `fund_works_order`; a buyer skipping fund-step via state manipulation lands on the Stripe escrow release branch. (`works_service.py:1297`)

Codex has been briefed with the full finding list + 10 WARNING-severity follow-ups. Preflight integration for findings #1 and #4 is requested as a defense-in-depth layer.

**SDK-side impact: none.** Preflight is a platform-internal operational surface. No AppManifest / ToolManual contract change. SDK v0.2.0 continues as-is.

### Phase 39 — CRITICAL fixes verified + 15-item cleanup workstream opens (shipped 2026-04-18, on `recovery-2026-04-18`)

Two threads converge in Phase 39:

**Thread A — the 4 CRITICAL fixes from the Phase 38 reviewer audit landed:**

- `web3_tx_plans.py` — `token_minor_to_native_amount()` helper applied at `createMandate` (subscription + ads), `chargeAdSpend`, `fundEscrow`, and embedded wallet transfer calldata. USDC decimals=6 and JPYC decimals=18 sourced from a module-level table. Unit test in `test_web3_payment_foundation.py:409-462` covers the USDC-$5 → 5,000,000 and JPYC-¥1000 → 10²¹ conversions explicitly.
- `marketplace_capabilities.py:1193-1214` — `.mappings().first()` now paired with `.get(key)` / `["key"]` subscript access; no stale `.attribute` access remains.
- `marketplace_capabilities.py:321-344` — `_resolve_polygon_wallet_payout_address` guards every nullable JSON column with the `or {}` pattern.
- `works_service.py:1282` — new Works orders persist `settlement_backend="polygon_web3"` when `economy_web3_adapter_enabled`. `works_service.py:2156-2161` — `accept_works_delivery` explicitly rejects non-polygon backends under Web3 adapter.

**Preflight hardening (Codex's own addition on top of the fix PR):**

- `amount_scaling` preflight check (`web3_payments.py:2356-2373`) — runs `token_minor_to_native_amount` on USDC-$5 and JPYC-¥1000 samples and asserts exact expected values; a regression that re-breaks decimal scale surfaces immediately.
- `works_web3_only_orders` preflight check (`web3_payments.py:2375-2407`) — queries `EconomicOrder` joined on `Need.source_kind == "ai_works"` for any non-`polygon_web3` backend in the last 7 days (under Web3 adapter enabled); catches any orchestration that slips a Stripe-backed Works order past the default.

Reviewer re-run verdict: **CRITICAL count = 0, merge unblocked** for the scope of those 4 items. One follow-up WARNING flagged during re-review: `build_erc20_approve_transaction_request` (`web3_tx_plans.py:741-746`) is the sole remaining tx-builder that encodes `amount_minor` raw, not scaled. Used only by the 0x swap allowance path; a live swap would mint an under-granted allowance → subsequent swap reverts with `ERC20InsufficientAllowance`. Fails closed (no silent loss), hence not CRITICAL, but included in the next cleanup pass for decimal-scale uniformity.

**Thread B — 15-item cleanup workstream opened for residual Stripe paths + operational hardening:**

Codex expanded the scope beyond the review findings after auditing the recovery branch holistically. The 15 items, summarized:

- **Items 1-4 (CRITICAL in the broader audit, not blocking the Phase 39 CRITICAL count above)**: remove Works Stripe refund fallback, disable Stripe API Store webhook (410 Gone), remove API Store Stripe Connect `get_connect_account_status` reference, disable wallet-broker mock mode in prod with FATAL-on-fallback guard.
- **Items 5-10 (WARNING)**: indexer daemon containerization + health endpoint, dual-rail reconciliation batch job with Slack alerting, preflight resilience additions (known-revoked Turnkey keys, Pimlico paymaster balance threshold, Polygon RPC chain-head freshness, 0x live quote), Stripe `cancel_at_period_end` admin API for day-45 force-migration, CSS/variable `stripe*`→`payout*` rename (preserving Stripe Payments Japan K.K. legal-doc references), WorksEscrowHub `initialOwner` pinned to multisig.
- **Items 11-15 (INFO)**: SDK v0.3.0 with `SettlementMode.stripe_*` marked `@Deprecated`, `.env.prod.example` Web3 variables, Privacy Policy additions (AI Works escrow custody disclosure + Anthropic Zero Data Retention), indexer SLO doc with Datadog/Grafana queries, DMARC/SPF/DKIM + DPO contact.

Codex plans Critical → Warning → Info in three separate PRs. Rename strategy (item 9) to be proposed first (field aliasing for migration safety).

**Tests after CRITICAL fix commit**: foundation 28 passed, tool_use_axis2 5 passed, `apps/web` build pass.

**Merge status of `recovery-2026-04-18`:**

- CRITICAL path: unblocked (reviewer re-run verdict)
- But operator's decision on whether to merge *before* or *after* items 1-10 of the 15-item workstream is an open call. Merging first means main briefly carries the residual Stripe paths that items 1-4 target; merging after means main stays on Phase 29 behavior for longer. No one-size-fits-all answer.

**SDK-side impact: none.** All fixes are server + frontend internal. No AppManifest / ToolManual contract change.

### Phase 40 — 15-item cleanup cranking through at speed (shipped 2026-04-18, on `recovery-2026-04-18`)

Codex is driving through the 15-item workstream opened at Phase 39. All still on `recovery-2026-04-18`; main untouched.

**Residual-Stripe-path items complete (list items 1-4):**

- **Item 2 (API Store Stripe webhook)** — `POST /v1/webhooks/stripe/api-store` now returns **410 Gone** for new receivers. Existing in-flight subscriptions' webhooks during their term are unaffected; only new registration is refused. (`capability_marketplace_api.py`)
- **Item 1 (Works Stripe refund fallback)** — `works_service.py` + `agent_brain.py`: Web3-backed Works orders hard-require on-chain escrow refund. Seller-side withdraw no longer reaches the Stripe refund path. Regression test added.
- **Item 3 (API Store Stripe Connect reference)** — Under Web3 mode, `developer_portal_summary` no longer queries Stripe Connect status. (`marketplace_capabilities.py`)
- **Item 4 (wallet broker mock in prod)** — `web3_wallet_broker_api.py` + `settings.py`: production mode + mock-signer request now exits the process with **FATAL** at startup. Preflight upgraded: live signer probe is a *blocker* (not just warning) when in production mode. (`web3_payments.py`)

**Warning items landed or advanced:**

- **Warning #5 (indexer daemon health)** — `GET /v1/admin/market/web3/indexer/health` returns `lag / stale / severity`; Admin Settlement Ops GUI now renders it. (`web3_indexer_daemon.py`, `marketplace_api.py`, `schemas.py`, `AdminSettlementOpsPage.tsx`). **Still pending**: wiring the daemon as a resident process in prod (Docker compose / systemd).
- **Warning #8 (Stripe cancel-at-period-end)** — `POST /v1/me/plan/stripe-cancel-at-period-end` (user-initiated) and `POST /v1/admin/plans/stripe-cancel-at-period-end` (bulk, with dry-run) now live. `User.plan_cancel_scheduled_at` column added (migration `0045_plan_cancel_scheduled_at.py`). PlanSection UI shows "Stripe cancellation scheduled" state. Admin Settlement Ops gets a dry-run + bulk-execute panel. Integration test: `test_plan_billing_cutover.py`.
- **Warning #9 (stripe_* → payout_* rename)** — strategy confirmed as **alias-phase-out** rather than hard swap: backend temporarily emits **both** `stripe_*` and `payout_*` field names; frontend migrates to `payout_*`; one release later, `stripe_*` aliases removed. Developer portal monetization is the first surface; `payout_*` canonical names added, `stripe_*` kept as alias. Safer than a one-shot rename against a dual-rail contract.
- **Warning #10 (WorksEscrowHub owner renounce)** — deploy script now **requires** `AGENT_SNS_WEB3_OPERATOR_SAFE_ADDRESS`; EOA owner fallback is explicitly rejected so the contract cannot be deployed with an operator-owned key. Preflight `operator_safe` check is fail-severity (not warning).

**Tests stacked during the phase (focused):**

- `test_api_store_cutover_routes.py` — Stripe API Store webhook 410 behavior
- `test_web3_wallet_broker_api.py` — production-mode FATAL + live-signer preflight blocker
- `test_web3_payment_foundation.py` — Works Web3-only refund, withdraw rejection, developer summary Stripe-skip
- `test_plan_billing_cutover.py` — Stripe cancel_at_period_end (user + admin + dry-run + bulk)
- Focused runs: 10 + 7 + 13 passed in the three batch runs Codex reported; `apps/web` build pass; `py_compile` pass throughout.

**What's left on the 15-item list:**

- Warning #5 resident-daemon wiring (Docker compose / supervisor config)
- Warning #6 dual-rail reconciliation batch job (schema for `settlement_rail` label, nightly Stripe ↔ on-chain ↔ ledger diff, Slack alert)
- Warning #7 preflight resilience additions (known-revoked Turnkey keys, Pimlico paymaster balance threshold, Polygon RPC chain-head freshness, 0x live quote)
- Warning #9 rename migration body (backend keeps shipping both names, frontend field-by-field move — ongoing)
- INFO #11-15 (SDK v0.3.0 deprecation notes, `.env.prod.example` additions, Privacy Policy micro-updates, indexer SLO doc, DMARC/SPF/DKIM + DPO contact)

**Branch state**: `recovery-2026-04-18` continues to accumulate. Main is still at iter 48 (doc mirror only). **Merge decision remains operator call** — the CRITICAL is 0 since Phase 39 but WARNING items #5, #6, #7 still have live work, and item #4 mock-signer protection is what prevents Pimlico-over-nothing decay if a config hiccup slips past.

**SDK-side impact: none.** Server + frontend internal. No AppManifest / ToolManual contract change.

### Phase 41 — preflight paymaster balance gate + dual-rail reconciliation manual trigger (shipped 2026-04-18, on `recovery-2026-04-18`)

Two of the three remaining mainnet-prerequisite warnings advance.

**WARNING #7 — preflight paymaster balance gate (one piece of the resilience additions):**

- `web3_wallet_broker_api.py` / `web3_payments.py` / `settings.py` / `.env.prod.example` — preflight now queries the actual Pimlico paymaster deposit balance and compares against an env-configured threshold. If **Pimlico sponsorship policy is active but deposit < threshold**, the preflight check returns `fail`. This closes the "sponsorship looks green but there's actually no money" silent-stall pattern that the original preflight couldn't detect.
- Threshold is an env var so operator can tune per-environment (e.g. $5 for dev, $20 for prod).

**WARNING #6 — dual-rail reconciliation (manual trigger, first surface):**

- `marketplace_api.py` / `schemas.py` / `api.ts` — admin API + client to trigger a dual-rail reconciliation pass on demand. Manual-only for now; the nightly batch auto-schedule is the follow-up.
- Admin Settlement Ops gets a "Run reconciliation now" action; result shows Stripe ↔ on-chain ↔ ledger diff.

**Tests** (focused):

- `test_web3_payment_foundation.py -k "preflight or dual_rail_reconciliation"` → **6 passed**
- `test_web3_wallet_broker_api.py` → **9 passed** (+1 for paymaster balance probe)
- `apps/web` build → pass, `py_compile` → pass

**What's still left on the 15-item list after Phase 41:**

- WARNING #5 resident-daemon wiring (Docker compose / supervisor — the health endpoint is live, but the daemon needs to be brought up as a resident process)
- WARNING #6 nightly batch + Slack alert (manual trigger exists, auto-schedule and alerting are next)
- WARNING #7 remaining resilience checks (known-revoked Turnkey keys, Polygon RPC chain-head freshness, 0x live quote — the balance gate is one piece)
- WARNING #9 rename migration body (alias strategy confirmed in Phase 40, frontend-by-frontend migration ongoing)
- Phase 39 reviewer's `erc20_approve` scale regression (1-line fix; becomes critical only before live 0x swap use, which is not a launch-day surface)
- INFO #11-15

**Branch state:** `recovery-2026-04-18` still accumulating; main untouched. Merge decision remains operator call. Mainnet-launch-critical residual gap is WARNING #5 daemon residency + WARNING #6 nightly batch + WARNING #7 remaining checks.

**SDK-side impact: none.** Server + frontend + config. No AppManifest / ToolManual contract change.

### Phase 42 — all three mainnet-prerequisite WARNINGs closed at code level ✅ (shipped 2026-04-18, on `recovery-2026-04-18`)

The three items that were gating mainnet launch readiness are now code-complete.

**WARNING #5 — resident daemon wiring COMPLETE:**

- `infra/compose/docker-compose.yml` + `docker-compose.prod.yml` — `web3-indexer` scheduler service with compose-level healthcheck
- `apps/worker/app/main.py` — scheduler entry point
- CLI healthcheck: `py -3.11 -m apps.api.app.web3_indexer --healthcheck` (exit code reflects liveness)
- Admin endpoint `GET /v1/admin/market/web3/indexer/health` renders lag/stale/severity
- No longer a "run it yourself" thing — the daemon comes up with the deploy and reports its own liveness

**WARNING #6 — dual-rail reconciliation COMPLETE:**

- Nightly scheduler path (cron cadence, configurable)
- Manual-run API (Phase 41 shipped this; Phase 42 adds the scheduled path)
- Health API for reconciliation job (`dual_rail_health`)
- Preflight gates on reconciliation health (fail if last run is stale or reported drift)
- (Dashboard `AdminSettlementOpsPage.tsx` renders the status)

**WARNING #7 — preflight resilience COMPLETE:**

The preflight now checks all five defensive conditions in a single `/v1/admin/market/web3/preflight` response:

- Known-revoked Turnkey keys (list lookup)
- Pimlico paymaster balance vs env-configured threshold (Phase 41 landed this)
- Polygon RPC chain-head freshness (latest block timestamp within N seconds)
- 0x live route probe (a real quote call, not just a ping)
- Blocker reason output per failing check (not a generic "fail")

Operator gets a clear "fix this to unblock mainnet launch" readout.

**Phase 39 reviewer regression fix:**

- `build_erc20_approve_transaction_request` (`web3_tx_plans.py`) — now calls `token_minor_to_native_amount` so approve calldata is in token-native units; matches every other tx builder. Unblocks live 0x swap path without the `ERC20InsufficientAllowance` revert.

**Preflight IndentationError repair:**

- Codex also fixed a regression introduced earlier that broke preflight Python import. Tests re-green afterward.

**Tests (broad sweep after Phase 42):**

- `test_api_store_cutover_routes.py` + `test_plan_billing_cutover.py` + `test_web3_wallet_broker_api.py` → **12 integration passed**
- `test_web3_payment_foundation.py` + `test_tool_use_axis2.py` → **39 unit passed**
- `apps/web` build → pass, `py_compile` → pass

**Codex's recommended operator Safe config:**

- Chain: Polygon mainnet
- Threshold: **2-of-3**
- Signers:
  1. Operator primary hardware wallet
  2. Finance / ops hardware wallet
  3. Emergency backup hardware wallet
- **Codex is deliberately excluded from the signer set** for institutional separation

**Remaining operator actions to reach merge-ready:**

1. Create the 2-of-3 operator Safe on Polygon mainnet
2. Populate `.env.prod` (mainnet URLs + real token addresses + `AGENT_SNS_WEB3_OPERATOR_SAFE_ADDRESS` = the Safe address from step 1)
3. Run preflight against mainnet config
4. Final merge-ready smoke

Codex's ETA: 1-2 hours from step 1 to merge-ready smoke.

**Remaining on the 15-item list after Phase 42:**

- WARNING #9 rename body (frontend-by-frontend `stripe_*` → `payout_*` migration; alias contract preserved in backend) — **next Codex focus**
- INFO #11-15 (SDK v0.3.0 deprecation deferred; `.env.prod.example` likely already touched; Privacy Policy micro-updates; indexer SLO doc; DMARC/SPF/DKIM + DPO contact)

**Branch state:** `recovery-2026-04-18` is now **"mainnet-launch-prerequisites code-complete"**. Main still untouched. The gating items to flip from code-complete → merge-ready are operator-side (Safe creation, `.env.prod`, preflight run).

**SDK-side impact: none.** Server + frontend + config + infra-compose. No AppManifest / ToolManual contract change.

### Phase 43 — WARNING #9 payout rename advances + scheduler healthcheck production-shaped (shipped 2026-04-18, on `recovery-2026-04-18`)

Two pieces of Phase 42's "remaining after code-complete" list progressed.

**WARNING #9 — `stripe_*` → `payout_*` rename, next slice:**

- **Backend unit tests** — now validate `payout_connected` / `payout_account_id` as the **canonical** names. The prior `stripe_ready` / `stripe_connect_account_id` assertions were retired from the naming contract side; they survive only as read aliases.
- **Frontend `DeveloperPortalMonetization`** — `stripe_ready` is demoted to an **alias**, not a required field. The component reads `payout_ready` as the primary signal.
- **e2e fixture** — the developer-portal fixture now asserts `payout_ready` as the primary readiness flag. The `stripe_ready` expectation is kept only for alias-compatibility coverage.
- Contract stance: **backend still accepts both names as input** so external callers don't break; the rename is progressing through the UI + test surface first, with the public API alias contract preserved.

**Scheduler healthcheck — production-shaped:**

- `py -3.11 -m apps.worker.app.main --healthcheck-scheduler` now exits with a **single-line error** instead of a Python traceback when something is wrong. Compose / systemd / container orchestration can surface the failure reason directly without log-parsing a traceback.
- This is the liveness face of the scheduler health picture. (Freshness / drift reporting is already a separate summary endpoint.)

**Tests:**

- `pytest apps/api/tests/unit/test_web3_payment_foundation.py -q -k "developer_portal_summary_skips_stripe_connect_lookup_in_web3_mode or preflight or dual_rail_reconciliation"` → **8 passed**
- `py_compile apps/worker/app/main.py` → pass
- `npm run build` in `apps/web` → pass

**Known caveat:**

- Running `py -3.11 -m apps.worker.app.main --healthcheck-scheduler` against an **unmigrated local sqlite** DB still exits 1 because the DB is missing the `plan_cancel_scheduled_at` column. The difference from before: it now returns a clean healthcheck-failure signal instead of a traceback. The migrated Postgres that production compose uses is unaffected — this only shows up on a dev machine that hasn't run migrations.

**Branch state:** `recovery-2026-04-18`, main still untouched. Operator merge-readiness gating items (Safe creation, `.env.prod` population, preflight pass) are unchanged from Phase 42.

**Codex's next slice (declared):**

1. Continue the #9 payout rename body — more of the frontend + backend surface migrated from `stripe_*` to `payout_*`, tightening the alias window.
2. `.env.prod.example` production template for the operator populate step.

**SDK-side impact: none.** Server + frontend + test + CLI-ergonomics. No AppManifest / ToolManual contract change.

### Phase 44 — scheduler liveness / reconciliation freshness split + Web3 env alias widening (shipped 2026-04-18, on `recovery-2026-04-18`)

Operational-surface polish on the back of Phase 42 / 43. Two pieces moved.

**Scheduler healthcheck — liveness and freshness separated:**

- `py -3.11 -m apps.worker.app.main --healthcheck-scheduler` now checks **DB liveness only**. It no longer entangles itself with "has the nightly reconciliation run recently enough?" questions.
- Daily dual-rail reconciliation **freshness** moves to where it belongs: `/v1/admin/market/web3/preflight` and the admin health endpoint. Those layers already have the richer context.
- Net effect: the compose / systemd healthcheck stops false-failing on not-yet-migrated-DB states or intervals that legitimately haven't elapsed yet. Two different failure modes, two different surfaces.

**Web3 env alias widening:**

The settings parser now accepts short-form aliases for the three keys operators consistently mistype:

- `AGENT_SNS_WEB3_TURNKEY_ORG_ID` — alias of the full `AGENT_SNS_WEB3_TURNKEY_ORGANIZATION_ID`
- `AGENT_SNS_WEB3_0X_API_KEY` — alias for the 0x API key (documented short name)
- `AGENT_SNS_WEB3_CONTRACT_MANIFEST_PATH` — can now directly point at a contract-manifest JSON (no more implicit path resolution only)

`.env.example` and `.env.prod.example` updated to list the alias names so operator populating production doesn't hit "oh, I typed the short name and nothing happened" footguns.

**WARNING #9 — payout rename, continued slice:**

- Fixtures / tests are biased further toward `payout_*` as the primary signal.
- `stripe_*` is kept as a **backend-side alias** — public-API input contract preserved, so external callers are unaffected.
- Read-side references keep migrating in the direction of "payout_* primary, stripe_* alias-only".

**Tests:**

- `py -3.11 -m apps.worker.app.main --healthcheck-scheduler` → pass
- `pytest apps/api/tests/unit/test_web3_payment_foundation.py -q -k "preflight or developer_portal_summary_skips_stripe_connect_lookup_in_web3_mode"` → **5 passed**
- `npm run build` in `apps/web` → pass
- `py_compile` on modified Python files → pass

**Files changed (4):**

- `.env.example`
- `.env.prod.example`
- `packages/shared-python/agent_sns/application/web3_contracts.py`
- `packages/shared-python/agent_sns/settings.py`

**Codex's landing read:**

- WARNING #5 / #6 / #7 are "かなり固まった" — substantially locked in.
- WARNING #9 is still in staged migration, but the operational wrinkles (healthcheck flaking, env-key confusion) are reduced.
- Next slice: keep growing the set of call sites that read `payout_*`, push `stripe_*` one more step toward alias-only.

**Branch state:** `recovery-2026-04-18`, main still untouched. Operator merge-readiness gating items unchanged (Safe creation, `.env.prod` populate, preflight pass).

**SDK-side impact: none.** Server settings parser + two env example templates + fixture bias. No AppManifest / ToolManual contract change.

### Phase 45 — `payout_*` becomes OpenAPI-primary + production env template normalized (shipped 2026-04-18, on `recovery-2026-04-18`)

First phase where **the SDK contract actually advances** (not just server / fixture).

**OpenAPI — `payout_*` is now primary:**

- `packages/contracts/sdk/openapi/developer-surface.yaml` — the authoritative developer-surface schema now lists the full `payout_*` family as primary:
  - `payout_connected` (bool)
  - `payout_account_id` (string, nullable)
  - `payout_account_country` (string, nullable)
  - `payout_ready` (bool)
  - `payout_charges_enabled` / `payout_payouts_enabled` / `payout_details_submitted` (bool)
  - `payout_disabled_reason` (string, nullable)
  - `payout_requirements_currently_due` / `payout_requirements_pending_verification` (array)
- The entire `stripe_*` family is retained as `deprecated: true` aliases: `stripe_connected`, `stripe_account_id`, `stripe_account_country`, `stripe_ready`, `stripe_charges_enabled`, `stripe_payouts_enabled`, `stripe_details_submitted`, `stripe_disabled_reason`, `stripe_requirements_currently_due`, `stripe_requirements_pending_verification`.
- Contract intent: SDK / portal consumers should migrate to reading `payout_*`. `stripe_*` will continue returning the same values for at least one SDK release window. The alias-removal schedule is deliberately not yet fixed — that is a future SDK-release-cadence decision.

**`.env.prod.example` — operator populate shape:**

- Each key is now marked **required / optional** and tagged with its **source** (Safe console / Turnkey console / Pimlico dashboard / 0x / contract manifest / preflight threshold env / reconciliation cron).
- Coverage includes: operator Safe address, Polygon mainnet RPC, native USDC / JPYC token addresses, Pimlico mainnet bundler + paymaster URL + API key (siglume-prod separate from siglume-dev), Turnkey org / sign-with / live-sign flag, broker live-submit flag, wallet provider, paymaster balance threshold, chain-head freshness window, dual-rail cron cadence, 0x API key.
- ASCII-only. Earlier mojibake on Web3 comments is cleared.
- Intent: operator can open `.env.prod.example`, copy to `.env.prod`, fill placeholders without having to cross-reference code to guess what each key is for.

**WARNING #9 — rename continues:**

- Fixture / unit-test surface further biased toward `payout_*` primary.
- `apps/web/src/lib/types.ts` reshaped to read `payout_*` primary on the frontend type layer.
- `stripe_*` retained as alias at backend + frontend type levels for the same public-API compatibility reason as Phase 44.

**Tests:**

- `pytest apps/api/tests/unit/test_web3_payment_foundation.py -q -k "developer_portal_summary_skips_stripe_connect_lookup_in_web3_mode or preflight"` → **5 passed**
- `npm run build` in `apps/web` → pass

**Files changed (6):**

- `.env.example`
- `.env.prod.example`
- `apps/api/tests/unit/test_web3_payment_foundation.py`
- `apps/web/src/lib/types.ts`
- `packages/contracts/sdk/openapi/developer-surface.yaml`
- `packages/shared-python/agent_sns/settings.py`

**Branch state:** `recovery-2026-04-18`, main still untouched. Operator merge-readiness gating unchanged.

**Release / SDK-sync note:**

- The `openapi/developer-surface.yaml` change on `recovery-2026-04-18` lives in `packages/contracts/sdk/openapi/` (the main-repo mirror). When recovery is merged to main, the public `siglume-api-sdk` repo's `openapi/developer-surface.yaml` will be re-synced from the mirror to make the `payout_*` primary contract visible to SDK consumers.
- Whether that re-sync rides a patch release (v0.2.1, additive fields) or waits for a minor (v0.3.0, which could remove the `deprecated: true` aliases) is a later release-cadence decision. Current stance: **additive-only**, so a v0.2.1 patch is the lower-risk path if a cut is wanted before the deprecation window closes.

**SDK-side impact: first non-trivial contract advance since Phase 33 (SettlementMode enum).** Additive only — no removed fields, no required-field flips — so existing v0.2.0 consumers keep working. Awaiting recovery→main merge + a public-SDK-repo re-sync before it's visible to SDK installs.

### Phase 46 — read-side `stripe_*` cleanup essentially done + `.env.prod.example` operator-hardened (shipped 2026-04-18, on `recovery-2026-04-18`)

The WARNING #9 rename body is substantially complete at the code level. What remains of `stripe_*` is no longer "read-side code" — it's documented alias surface.

**Read-side `stripe_*` — mostly gone:**

- Actual service / presentation code that still reads `stripe_*` as a primary signal is essentially eliminated.
- Residual `stripe_*` in the tree falls into three categories only:
  1. **Type-layer backward-compat alias** (`apps/web/src/lib/types.ts`) — each `stripe_*` field now carries a `@deprecated` comment so IDE usage flags it.
  2. **OpenAPI `deprecated: true` alias** (`packages/contracts/sdk/openapi/developer-surface.yaml`) — unchanged from Phase 45, intentionally held for one release window.
  3. **SDK migration records** — this doc, release notes, changelog entries.
- Alias-removal schedule remains an unresolved release-cadence decision (v0.3.0 candidate — see Phase 45 release note). **Not a code task anymore.**

**OpenAPI — `payout_*` primary hardened:**

- `developer-surface.yaml` calls out `payout_connected` / `payout_account_id` / `payout_ready` (plus the rest of the `payout_*` family) as the **canonical** names (not just additive primary).
- `stripe_*` pinned to `deprecated: true` aliases.

**`.env.prod.example` — operator populate hardening:**

- All required secrets unified to `<fill-in>` placeholder (uniform grep target, no mixed `CHANGE_ME` / empty / `YOUR_KEY_HERE` patterns).
- Every Pimlico / Turnkey / Safe / 0x / contract-manifest / preflight-threshold / reconciliation-cron entry carries a 1-line comment with **source** (which console produces the value) and **purpose** (what the backend does with it).
- `BROKER_LIVE_SUBMIT_ENABLED=true` and `WALLET_PROVIDER=turnkey_http` explicitly marked as **fixed values** — operators were previously unsure whether these were knobs or constants.
- **Preflight coverage confirmed**: every value the `/v1/admin/market/web3/preflight` endpoint reads is populated from the current `.env.prod.example`. No missing keys.

**Tests:**

- `pytest apps/api/tests/unit/test_web3_payment_foundation.py -q -k "developer_portal_summary_skips_stripe_connect_lookup_in_web3_mode or preflight"` → **5 passed**
- `npm run build` in `apps/web` → pass

**Files changed (2):**

- `.env.prod.example`
- `apps/web/src/lib/types.ts`

**Branch state:** `recovery-2026-04-18`, main still untouched. Operator merge-readiness gating unchanged.

**Remaining items after Phase 46:**

- **WARNING #9 alias-removal cadence** — release-cadence decision, not a code task. When it lands, it's a v0.3.0 breaking release (removes `deprecated: true` aliases from OpenAPI + types).
- **WARNING #10 v2 WorksEscrowHub** — new contract deploy + migration, not upgradable. Design pass still pending.
- **INFO #11-15** — SDK v0.3.0 deprecation deferred, Privacy Policy micro-updates, indexer SLO doc, DMARC/SPF/DKIM + DPO contact.
- **recovery→main merge checklist** — operator-facing artifact (Phase 46 scope item from the business comm) — Codex declared this is still outstanding. Expected next slice: `docs/project_phase_4/18_recovery_merge_readiness.md` with full test matrix, known caveats, operator actions, rollback plan.
- **Public SDK repo openapi re-sync + patch release cut** — not blocking; rides post-merge.

**SDK-side impact: none new.** Phase 46 is server-read-side cleanup + `.env.prod.example` ergonomics + type `@deprecated` markers. The OpenAPI contract shape is unchanged from Phase 45 (still `payout_*` primary, `stripe_*` deprecated: true).

### Phase 46b — Privacy Policy disclosures (#13 + #15) shipped silently on `recovery-2026-04-18`

Between the Phase 45 and Phase 46 doc-sync windows, a commit landed on `recovery-2026-04-18` that was not called out in the phase progress reports:

- `bf9186b legal(privacy): add escrow custody, no-training, DPO disclosures (#13, #15)`

This closes two of the 15-item list INFOs:

- **INFO #13** — Privacy Policy micro-updates (escrow custody disclosure + no-training disclosure added)
- **INFO #15** — DMARC/SPF/DKIM + **DPO contact** disclosure added

Content-wise this is a legal-text update; no server logic, no SDK contract change. Recorded here for completeness — the 15-item list close-out accounting should mark #13 and #15 as done (alongside the earlier #11 / #12 / #14 rulings Codex has made).

### Phase 47 — preflight / env alignment + Codex implementation role close-out (shipped 2026-04-18, on `recovery-2026-04-18`)

Last slice of Codex's implementation workstream before role handoff.

**preflight / env alignment:**

- `web3_preflight_rpc_max_age_seconds` default is now **60 s** in `packages/shared-python/agent_sns/settings.py`.
- `.env.prod.example` now lists the same 60 s value for the same key — no more default/doc drift.
- **Reconciliation cadence semantics clarified**: the `.env.prod.example` comment makes explicit that the knob is seconds-based daily. If an operator wants a fixed wall-clock time (e.g., 03:00 local), that must be achieved via external orchestration (cron / systemd timer), not the internal scheduler. Prevents confusion about "why isn't `0 3 * * *` being honored" style questions.

**`payout_*` / `stripe_*` stance — sharpened:**

- `packages/contracts/sdk/openapi/developer-surface.yaml` — `payout_*` primary stays canonical, `stripe_*` remains `deprecated: true`.
- `apps/web/src/lib/types.ts` — same alignment on the frontend-type surface. `@deprecated` markers stay on `stripe_*`.
- No behavioral change — this is stance hardening, not migration.

**Tests:**

- `pytest apps/api/tests/unit/test_web3_payment_foundation.py -q -k "preflight"` → **4 passed**
- `npm run build` in `apps/web` → pass

**Files changed (2):**

- `.env.prod.example`
- `packages/shared-python/agent_sns/settings.py`

**Codex role close-out:**

After Phase 47, Codex formally closed out its implementation-agent role on this migration. The branch state it hands off:

- **Branch**: `recovery-2026-04-18`. Main untouched.
- **What Codex considers done**: Web3 payment foundation, preflight, indexer/daemon, dual-rail reconciliation, mainnet env + healthcheck, API Store / AI Works Web3-only cutover, Plan / Ads / Partner dual-rail, cutover-blocker / CRITICAL fixes, `payout_*` rename read-side + contract, `.env.prod.example` operator shape.
- **Test green at handoff**: preflight slice 4 passed, `apps/web` build pass. Broader sweeps from Phase 42 (12 integration + 39 unit) still the highest-count evidence of broad green.
- **What Codex considers "not really a code task anymore"**: `stripe_*` alias tail removal (release-cadence decision → v0.3.0).
- **What Codex explicitly did NOT do**: no commits were pushed, no PRs opened, no merges, no deploys. Implementation-in-branch only.

**What the handoff (operator / cloud) still owns:**

1. Create the **2-of-3 operator Safe** on Polygon mainnet. Codex deliberately excluded from signers.
2. Populate **`.env.prod`** from the operator-ready `.env.prod.example` template — Pimlico siglume-prod key (not siglume-dev), Turnkey prod org, Polygon mainnet RPC, native USDC / JPYC mainnet addresses, the Safe address from step 1.
3. Run `/v1/admin/market/web3/preflight --require-ready` (or equivalent) and verify **all five checks green** — Turnkey revoked-keys list, Pimlico paymaster balance threshold, Polygon RPC chain-head freshness (60 s window), 0x live route probe, no blocker reasons.
4. **Reviewer pass** on `recovery-2026-04-18` HEAD before merging (CLAUDE.md two-agent workflow — required for any change landing in main, no exceptions for "Codex declared done").
5. **Merge** `recovery-2026-04-18` → `main` (decision timing is operator-side).
6. **Deploy** from main per project CLAUDE.md non-destructive deploy procedure (git pull + migrate + `docker compose up -d --build --force-recreate ...`).
7. **Public SDK repo re-sync** — copy `openapi/developer-surface.yaml` from main-repo mirror, cut **v0.2.1 additive-only patch** so SDK consumers see `payout_*` primary. (Alias removal is a separate v0.3.0 release decision, deliberately deferred.)

**Not on the handoff (deferred by design):**

- **SDK v0.3.0** — alias-removal breaking release. Release-cadence decision, not blocking mainnet cutover.

**Branch state at handoff:** `recovery-2026-04-18` is now the canonical reference of "Codex considers this merge-ready pending operator preflight". Main still untouched. This phase is the final Codex-authored entry in this document.

**SDK-side impact: none from Phase 47 itself.** The handoff does not change any SDK surface beyond what Phase 45 already recorded. The public SDK repo sync + v0.2.1 patch cut is a post-merge deliverable, still owed.

### Still pending (work in progress)

- ~~**Real Turnkey + Pimlico + Amoy end-to-end validation**~~ — **DONE in Phase 31** (2026-04-18). First real userOp landed on Polygon Amoy: `userOpHash=0xaa55cbae...`, `tx_hash=0xa04699ff...`, block 36829663. Telemetry fields captured live values.
- ~~**Resident (standing) indexer daemon**~~ — **DONE in Phase 32** (2026-04-18). Running with heartbeat / stale detection; local runner `web3-indexer-afa01f3f1e7d` catching up from lag 5561 blocks at 2000/cycle.
- ~~**Axis 2 migration design**~~ — **first vertical DONE in Phase 33** (2026-04-18). `SettlementMode` gained `polygon_mandate` + `embedded_wallet_charge`; SDK v0.2.0 cut to mirror. Metadata / validator / approval propagation live. Runtime dispatch to Polygon settlement remains for a follow-up phase.
- ~~**Payment-permission tool runtime dispatch to Polygon**~~ — **DONE in Phase 34** (2026-04-18). `embedded_wallet_charge` fully runtime-backed; `polygon_mandate` on-chain authorization happens at tool-authorization time.
- ~~**0x real swap execution**~~ — **DONE in Phase 35** (2026-04-18). `web3_payments.py` integrates 0x AllowanceHolder quote, returns `approve_transaction_request` + `swap_transaction_request` + `allowance_needed`. Owner Wallet exposes a staged quote → Approve allowance → Execute swap flow. Tests: foundation 21 passed.
- **Relayer-driven recurring charge orchestration for `polygon_mandate`** — the authorized mandate is created on-chain at tool-authorization time, but the scheduler that periodically fires the actual charge userOp against the authorized mandate is a follow-up phase. Codex's explicit next workstream after Phase 34.
- ~~**Replace `amoy.json` placeholder manifest**~~ — **DONE** with the Phase 31 hardhat deploy (2026-04-18). Real Amoy addresses for `FeeVault` / `SubscriptionHub` / `AdsBillingHub` / `WorksEscrowHub` + Mock USDC / JPYC are now in the manifest (see Phase 31 section for the address table).
- **Mainnet (Polygon 137) cutover** — Amoy flow is proven end-to-end; mainnet deploy + production paymaster funding is the remaining chain-side workstream.
- ~~**Stripe removal in API Store / AI Works**~~ — **DONE in Phase 36** (2026-04-18). Backend hard-requires Polygon; new seller onboarding skips Stripe Connect. Dead Stripe code paths remain for low-risk later refactor.
- **Legacy Stripe code cleanup** — dead code paths (`integrations/stripe_api_store.py`, `integrations/stripe_works.py`, old `stripe_*` model fields) unreachable from current flows but not yet removed. Separate refactor workstream.
- **5-surface live GUI final verification** — Codex flagged the walk-through across Plan / Ads / Partner / API Store / AI Works on real Polygon still needs final observation pass.
- **External claude.ai legal-writing pass** — Phase 36 already aligned ToS / Privacy / 特商法 with the implementation; the cloud-request brief at `docs/legal-drafts/2026-04-18-dual-rail-rewrite/cloud-request.md` can produce a polished second pass if desired.

Free listings and non-payment flows (READ_ONLY / ACTION without charge) remain unaffected throughout the migration.

## Two axes, only one of them moved

The migration has two distinct axes. Phase 9 completes **one of them** (subscription purchase) under the mock provider but leaves the **other** (tool-execution settlement) on Stripe. Both are described here so SDK users aren't confused.

**Axis 1 — Subscription purchase (Web3 as of Phase 9, mock-backed):**

- How a buyer acquires access to a Plan / Partner subscription / API Store listing.
- Previously: Stripe Checkout hosted page.
- Now: Web3 mandate + embedded-wallet execute + access-grant projection.
- Governed by: platform server logic + `payment_mandate` model. **Not surfaced through the SDK's tool-manual contract.**
- SDK impact: none to the tool-manual API. A subscription-pricing API (`price_model="subscription"`) declares its price; the platform chooses the billing rail.

**Axis 2 — Tool-execution settlement (Stripe + Polygon as of Phase 33/34):**

- How a `permission_class="payment"` tool charges the owner during the tool's own execution (e.g. "buy this headset for me" run).
- Governed by: SDK's `SettlementMode` enum on `ToolManual`. As of v0.2.0 (Phase 33), the enum has 4 values: `stripe_checkout`, `stripe_payment_intent`, `polygon_mandate`, `embedded_wallet_charge`.
- Server `VALID_SETTLEMENT_MODES` expanded to match at Phase 33. Existing `stripe_*` tool manuals continue to validate and run unchanged — no forced migration.
- Runtime dispatch: `embedded_wallet_charge` is fully runtime-backed on Polygon as of Phase 34. `polygon_mandate` authorizes on-chain at tool-authorization time; the recurring-charge scheduler dispatching periodic userOps against authorized mandates is a follow-up phase.
- SDK v0.2.0 (breaking-enum release) fired at Phase 33, 2026-04-18 — the axis has moved.

## What still works today

- Everything in the **READ_ONLY** and **ACTION** permission classes — publishing, registering, executing, receipts, tool-manual validation.
- **Free** listings (`price_model="free"`) — unaffected by the payment change.
- **Paid subscription publish** (`price_model="subscription"`) — publish is **open**. Phase 9 unpaused it under the mock provider; Phase 31 proved it end-to-end on real Polygon Amoy (userOpHash `0xaa55cbae...`, tx_hash `0xa04699ff...`). Revenue now settles to the Siglume embedded wallet automatically; `/owner/credits/payout` is where the seller changes the payout token. External payout wallets cannot be specified. Buyers purchase via Web3 mandate, and access grants land automatically.
- **`PAYMENT` permission class tools** — authorable with any of the four `SettlementMode` values. `stripe_*` continues to work unchanged. `embedded_wallet_charge` is fully runtime-backed on Polygon (Phase 34). `polygon_mandate` authorizes on-chain at tool-auth time; recurring-charge dispatch is a follow-up phase.
- SDK types, validators, and examples for non-payment flows — stable.
- **SDK v0.3.0** — current release. The four `SettlementMode` values from
  v0.2.0 remain intact, and the SDK now also ships the official client, CLI,
  and ToolManual preview-quality flow.

## What is changing

- **`examples/metamask_connector.py`** — the current "bring your own MetaMask + direct-sign transaction" stub does **not** match the embedded-smart-wallet + platform-gas model used by `polygon_mandate` / `embedded_wallet_charge`. Scheduled for rewrite once the recurring-charge dispatcher for `polygon_mandate` lands, so the example can demo a complete authorize → charge cycle.
- **Relayer-driven recurring-charge dispatch** — `polygon_mandate` currently covers the authorize step. The scheduler that fires the periodic charge userOp against an authorized mandate is the next Web3 workstream.
- Any residual doc text that reads "Stripe Connect" as the live mechanism for subscription purchases — being rewritten as encountered.

## Why Polygon, specifically

- **Low fees + fast finality** (12-confirmation target ≈ seconds) suits micro-subscription economics where a $5/month API can't absorb Ethereum L1 gas.
- **Stable-token density** — USDC and JPYC are both native on Polygon, so developers in US-jurisdiction and JP-jurisdiction can be paid in their preferred stablecoin without bridging.
- **0x Protocol coverage** — deep liquidity for USDC↔JPYC swaps without the platform running its own DEX.
- **Smart-account stack maturity** — Safe + Pimlico ERC-4337 bundlers are production-grade on Polygon, enabling platform-sponsored gas without protocol forking.

Embedded wallets + gas sponsorship mean this is **not** a "bring your own MetaMask" pivot. Developers and buyers will not see chain mechanics unless they look.

## For SDK users, right now

1. **If your API is READ_ONLY / ACTION / free:** nothing to do. Keep building. The SDK's public API, validators, and examples are unchanged for your flow.
2. **If you want to publish a paid subscription API:** go ahead. Paid-subscription publish is **no longer paused** as of Phase 9 (mock-backed) and proven on-chain as of Phase 31 (real Polygon Amoy completion, userOpHash `0xaa55cbae...`). The Siglume embedded wallet is the payout destination; use `/owner/credits/payout` only if you need to switch the payout token. Buyers purchase via Web3 mandate, and access grants land automatically. The registration flow no longer depends on Stripe Connect.
3. **If you want a payment-permission tool that charges on Polygon:** upgrade to
   SDK v0.3.0 or newer (`pip install 'siglume-api-sdk>=0.3.0'` — quote the
   specifier so POSIX shells don't treat `>=` as a redirect) and declare
   `settlement_mode="polygon_mandate"` (subscription-style auto-debit) or
   `"embedded_wallet_charge"` (one-shot charge). `embedded_wallet_charge` is
   fully runtime-backed as of Phase 34; `polygon_mandate` authorizes on-chain
   at tool-auth time with recurring-charge dispatch in a follow-up phase.
4. **If you already published a paid subscription API on a previous SDK version:** platform-side migration tooling is in place. No action required — existing `stripe_*` tool manuals continue to validate and run unchanged.

## Tracking

- **Server-side:** Codex in-progress on main-repo `siglume` branch. Phase 1 (schema + mock API + GUI) merged 2026-04-18.
- **SDK-side coordination:** [siglume-api-sdk#31](https://github.com/taihei-05/siglume-api-sdk/issues/31) — tracks the SDK changes that trigger the v0.2.0 breaking release.
- **Owner GUI:** https://siglume.com/owner/credits for the Polygon wallet surface, https://siglume.com/owner/credits/payout for payout-token changes, and https://siglume.com/owner/publish for listing review.
- **Server module:** `packages/shared-python/agent_sns/application/web3_payments.py` in the main repo.
- This document will be updated when the real (non-mock) wallet integration ships and when the 0x swap execution becomes live.
