# Web3 Settlement Helpers

## What the settlement rail actually is

Siglume subscription payments settle on Polygon via **non-custodial
embedded smart wallets** — this is the only supported settlement rail.
Stripe Connect was retired in v0.2.0.

**Non-custodial** means:

- Siglume never holds buyer or seller funds.
- Siglume never holds private keys. New wallets are **local
  self-custody** smart accounts: the EVM key is generated in the
  buyer's browser, encrypted at rest under a key derived from their
  passkey (WebAuthn PRF) or passphrase, and Siglume stores at most an
  opaque ciphertext it cannot decrypt. Signing authority stays entirely
  with the end user. (Older wallets were provisioned via a third-party
  key-management vendor; that dependency is being retired.)
- Siglume's `SubscriptionHub` contract can pull funds from a buyer's
  wallet **only** within the limits of an on-chain mandate the buyer
  has signed (monthly cap, token, payee), and the buyer can revoke
  that mandate on-chain at any time.
- Settlements are real on-chain ERC-20 transfers (USDC / JPYC on
  Polygon), not internal ledger entries in a Siglume database.

Gas is sponsored by the platform (Pimlico paymaster) so buyers and
sellers do not need to hold native MATIC to transact.

## What the SDK does

The SDK keeps this surface intentionally small: it mirrors the public
read models, adds a few typed client helpers, and provides local
simulation helpers for tests and examples.

- reads Polygon mandate, settlement receipt, and 0x quote data from the
  authenticated platform API
- normalizes the public response shapes into `PolygonMandate`, `SettlementReceipt`,
  `EmbeddedWalletCharge`, and `CrossCurrencyQuote`
- simulates mandates and embedded-wallet charges locally for `AppTestHarness`

## What the SDK does **not** do

- sign or submit on-chain transactions directly (the buyer's wallet
  signs; the platform contract submits)
- duplicate platform-side settlement logic
- manage gas sponsorship or payout contracts
- take custody of buyer or seller tokens at any point

The actual settlement flow is owned by the Siglume platform contracts
(`SubscriptionHub` and related web3 services). Manifest pricing must declare
one listing currency explicitly: `USD` listings settle in USDC, and `JPY`
listings settle in JPYC. Current Polygon settlement and swap token support is
limited to `USDC` and `JPYC`.

For `usage_based` and `per_action` API Store / Game API Store listings, the
publisher declares a buyer-facing `pricing_plan`. With the default
`billing_timing="post"`, the publisher API executes first and reports the
executed operation/request type in its `ExecutionResult`; the matching
`pricing_plan` item is authoritative for the charge. With
`billing_timing="prepay"`, the platform first collects payment for a quoted
operation and only then calls the live action. A `0`-priced operation produces
no on-chain payment. JPY/JPYC paid operation amounts must be either `0` or at
least `15` minor units. The SDK and platform reject positive JPY/JPYC operation
prices below that floor.

## Generic reward payouts

MCP Gateway exposes reward payouts as a generic developer-funded settlement
tool. This is for APIs that have already computed a reward and need the
platform to move funds from the connected developer's Siglume embedded wallet
to a recipient Siglume user's embedded wallet.

Reward payouts are called through MCP Gateway, not through the SDK's normal
`SIGLUME_API_KEY` registration surface. Use a bearer token issued for MCP:

| Surface | Credential | What it can do |
|---|---|---|
| SDK / CLI / Developer Surface | `SIGLUME_API_KEY` or `cli_...` | registration, validation, listing automation |
| MCP Gateway | `Authorization: Bearer mcpsk_...` | `initialize`, `tools/list`, `tools/call` for account-level `market_*` tools |
| OAuth MCP clients | `Authorization: Bearer mcpoa_...` | OAuth-connected MCP clients |

`X-API-Key`, `X-Siglume-API-Key`, and `cli_...` credentials are rejected by
MCP Gateway. Issue the `mcpsk_...` token for the target agent in the Developer
Portal, store it in the publisher API's secret manager, and use that token for
server-side reward payout calls.

Reward payout is a Siglume platform contract. Publisher APIs must adapt to the
official MCP Gateway tool contract below. Siglume does not define
API-specific payout connectors, API-specific `PF_BASE_URL` / `PF_API_KEY`
environment variable contracts, or API-specific wallet/state resolver behavior.
If a publisher API uses those names internally, they are local adapter
configuration and must map back to this documented platform surface.

Available MCP tools:

- `market_create_reward_payout`
- `market_list_reward_payouts`
- `market_get_reward_payout`

The create request contains only:

- `app_id`
- `recipient_subject`
- `amount_minor` or `amount_jpy`
- `display_currency`
- `token_symbol`
- `reward_event_id`
- `idempotency_key`
- optional `metadata`

Do not send `source_wallet_id`, `destination_wallet_id`, wallet addresses, or
private chain instructions. The platform resolves both wallets from the
authenticated developer/app context and the recipient Siglume subject. The
platform rejects wallet override fields, enforces developer scope, checks
wallet/KYC/transfer constraints, executes the transfer, tracks status, and
emits signed webhook events.

The `agent_id` is used when issuing or rotating the MCP token. Do not pass
`agent_id` to `market_create_reward_payout`; Gateway resolves the connected
developer and bound agent from the `mcpsk_...` session.

Minimal call sequence:

1. `POST https://mcp.siglume.com/` with `Authorization: Bearer mcpsk_...`.
2. Send MCP `initialize`.
3. Send `tools/list` and confirm `market_create_reward_payout` is present.
4. Send `tools/call` with name `market_create_reward_payout` and the arguments
   above.

The API remains responsible for reward math, ranking, usage observation,
eligibility, fraud scoring, and local durable payout-request records. The
platform remains responsible for payment execution, wallet resolution,
idempotency, transfer state, and reconciliation.

Use the signed `reward_paid` webhook as the completion source of truth. A
synchronous create response only means the platform accepted or resolved the
request state; it is not a substitute for webhook-confirmed completion.

Do not ask Siglume to change wallet resolution, authentication, or payout
state semantics for one API. A new server-to-server payout authentication
surface must be requested and reviewed as a platform feature, with its own
security, rate-limit, audit, key-rotation, and responsibility-boundary rules.

## Client helpers

The live `/market/web3/*` helper endpoints are signed-in owner/session
routes. They read the current user's wallet mandates, receipts, and swap
quotes; they do not accept `SIGLUME_API_KEY` / `cli_...` registration tokens
or MCP `mcpsk_...` tokens.

```python
import os

from siglume_api_sdk import SiglumeClient

client = SiglumeClient(api_key=os.environ["SIGLUME_OWNER_SESSION_BEARER"])

mandate = client.get_polygon_mandate("pmd_123")
receipt = client.get_settlement_receipt("chr_123")
charge = client.get_embedded_wallet_charge(tx_hash="0x" + "a" * 64)
quote = client.get_cross_currency_quote(
    from_currency="JPYC",
    to_currency="USDC",
    source_amount_minor=10_000,
)
```

```ts
import { SiglumeClient } from "@siglume/api-sdk";

const client = new SiglumeClient({ api_key: process.env.SIGLUME_OWNER_SESSION_BEARER! });

const mandate = await client.get_polygon_mandate("pmd_123");
const receipt = await client.get_settlement_receipt("chr_123");
const charge = await client.get_embedded_wallet_charge({ tx_hash: `0x${"a".repeat(64)}` });
const quote = await client.get_cross_currency_quote({
  from_currency: "JPYC",
  to_currency: "USDC",
  source_amount_minor: 10_000,
});
```

`get_cross_currency_quote()` calls the authenticated `/market/web3/swap/quote`
endpoint. When the platform is configured with a 0x API key it returns a live
quote; when the environment has no 0x credentials the platform falls back to a
deterministic mock quote for local / beta environments.

## Local simulation

```python
from siglume_api_sdk import AppTestHarness
from siglume_api_sdk.web3 import simulate_embedded_wallet_charge, simulate_polygon_mandate

mandate = simulate_polygon_mandate(
    mandate_id="pmd_test_001",
    payer_wallet="0x" + "1" * 40,
    payee_wallet="0x" + "2" * 40,
    monthly_cap_minor=148000,
    currency="JPYC",
)

charge = simulate_embedded_wallet_charge(
    mandate=mandate,
    amount_minor=148000,
    tx_hash="0x" + "a" * 64,
)
```

`AppTestHarness` exposes the same helpers as methods:

```python
harness = AppTestHarness(app)
mandate = harness.simulate_polygon_mandate(...)
charge = harness.simulate_embedded_wallet_charge(mandate=mandate, amount_minor=148000, tx_hash="0x...")
```

These helpers are for deterministic test receipts only. They do not touch a
wallet provider or broadcast a transaction.
