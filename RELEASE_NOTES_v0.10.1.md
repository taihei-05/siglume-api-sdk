# siglume-api-sdk v0.10.1

Released: 2026-04-26

## Summary

Documentation / metadata release. **No code changes** — Python and
TypeScript runtimes are byte-equivalent to v0.10.0. The README, ROADMAP,
and PAYMENT_MIGRATION pages on PyPI and npm were lagging behind the
actual state of the platform; this release ships the corrected copy.

## What changed

### README

- Removes the "⚠️ Payment stack is migrating" banner. The migration is
  complete; settlement is on Polygon mainnet (chainId 137) for all five
  settlement surfaces (Plan / Partner / API Store paid / AIWorks Escrow
  / Ads).
- Updates "Current release" from v0.7.6 to v0.10.0 and refreshes the
  feature inventory to include capability bundles, seller-owned
  connected-account OAuth, long-form `description`, and `version_bump`.
- Updates the Revenue model table to call out the Polygon mainnet rail
  explicitly (chainId 137, native USDC + JPYC, gas-sponsored).
- Project status moves from "early-stage / alpha (v0.7.6)" to
  "v0.10.0 / beta — platform is launched."

### ROADMAP

- Moves v0.7.0–v0.10.0 from "Next" to "Shipped." In particular,
  capability bundles and seller-owned connected-account OAuth — which
  the prior ROADMAP listed as v0.7 platform prerequisites — both shipped
  in v0.7.x.
- Keeps Multipart / file-only flows and external-ingest credential
  surfaces in the not-yet-scheduled section.
- Adds a note that `USAGE_BASED` / `PER_ACTION` opening for API Store
  listings is a platform-side decision; metered settlement is already
  live for Ads via `AdsBillingHub` on-chain.

### PAYMENT_MIGRATION

- Status header replaced with "✅ COMPLETE — live on Polygon mainnet
  (chainId 137)." Lists the deployed mainnet contract addresses
  (SubscriptionHub, AdsBillingHub, WorksEscrowHub, FeeVault, platform
  relayer) and settlement-token addresses (native USDC, JPYC).
- Phase-by-phase log is preserved unchanged as historical record.

### pyproject.toml

- Classifier moves from `Development Status :: 3 - Alpha` to
  `Development Status :: 4 - Beta`.

## Upgrade

```bash
pip install --upgrade siglume-api-sdk==0.10.1
```

```bash
npm install @siglume/api-sdk@0.10.1
```

If you are already on v0.10.0, upgrading is purely cosmetic — you get
the corrected README on PyPI / npm. The Python and TypeScript runtime
behavior is unchanged.
