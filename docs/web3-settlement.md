# Web3 Settlement Helpers

## What the settlement rail actually is

Siglume subscription payments settle on Polygon via **non-custodial
embedded smart wallets** — this is the only supported settlement rail.
Stripe Connect was retired in v0.2.0.

**Non-custodial** means:

- Siglume never holds buyer or seller funds.
- Siglume never holds private keys. Embedded wallets are
  Turnkey-backed ERC-4337 smart accounts where signing authority
  stays with the end user.
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

- reads Polygon mandate, settlement receipt, and 0x quote data from the public API
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
capability invocation itself is free up front. The publisher API executes first
and reports the executed operation/request type in its `ExecutionResult`. The
matching `pricing_plan` item is authoritative for the charge. The platform then
creates a post-execution payment requirement only when the matched plan price is
positive; a `0`-priced operation produces no on-chain payment. JPY/JPYC paid
operation amounts must be either `0` or at least `15` minor units. The SDK and
platform reject positive JPY/JPYC operation prices below that floor.

## Client helpers

```python
from siglume_api_sdk import SiglumeClient

client = SiglumeClient(api_key="sig_live_...")

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

const client = new SiglumeClient({ api_key: "sig_live_..." });

const mandate = await client.get_polygon_mandate("pmd_123");
const receipt = await client.get_settlement_receipt("chr_123");
const charge = await client.get_embedded_wallet_charge({ tx_hash: `0x${"a".repeat(64)}` });
const quote = await client.get_cross_currency_quote({
  from_currency: "JPYC",
  to_currency: "USDC",
  source_amount_minor: 10_000,
});
```

`get_cross_currency_quote()` calls the public `/market/web3/swap/quote` endpoint. When
the platform is configured with a 0x API key it returns a live quote; when the
environment has no 0x credentials the platform falls back to a deterministic
mock quote for local / beta environments.

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
