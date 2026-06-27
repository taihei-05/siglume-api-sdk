# v0.2.1 — `payout_*` becomes primary (additive, non-breaking)

**2026-04-18**

Patch release on the `DeveloperPortalStripeSummary` (developer portal monetization) surface. The `payout_*` field family is introduced as the forward-looking primary name; the existing `stripe_*` fields continue to be returned with the same values, now marked `deprecated: true`.

This is the SDK-visible half of the broader rename accompanying the Stripe Connect → Polygon on-chain migration. On-chain payouts and Stripe-based payouts are both "payouts"; pinning the field name to the provider stops making sense once both destinations are supported. Renaming in additive mode now means 0.3.x can drop the `stripe_*` aliases without surprising integrators.

## What changed in the contract

### Added (new primary fields)

`DeveloperPortalStripeSummary` (the `/owner/publish` dashboard summary object) gains:

```
payout_connected:                           boolean
payout_account_id:                          string | null
payout_account_country:                     string | null
payout_ready:                               boolean
payout_charges_enabled:                     boolean
payout_payouts_enabled:                     boolean
payout_details_submitted:                   boolean
payout_disabled_reason:                     string | null
payout_requirements_currently_due:          string[]
payout_requirements_pending_verification:   string[]
```

Each returns the same underlying value as the corresponding `stripe_*` field when the connected destination is a Stripe Connect account. When (future) on-chain destinations are active, `payout_*` is the field that will generalize; `stripe_*` will remain null / stripe-specific.

### Deprecated (same values still returned)

The following fields on `DeveloperPortalStripeSummary` are now annotated `deprecated: true` in the OpenAPI:

```
stripe_connected
stripe_account_id
stripe_account_country
stripe_ready
stripe_charges_enabled
stripe_payouts_enabled
stripe_details_submitted
stripe_disabled_reason
stripe_requirements_currently_due
stripe_requirements_pending_verification
```

They are still present in the response payload and still carry the same values as before. Your 0.2.0 integration code continues to work. The `deprecated: true` flag is a forward-looking marker, not a runtime change.

> `stripe_secret_configured` and `stripe_publishable_configured` are **not** deprecated. Those describe server-side key presence, not connected-account state, and are staying.

## Not changed

- No removed fields.
- No type changes on any existing field.
- No required / optional flips.
- No enum value reordering or removal.
- `SettlementMode` enum unchanged from 0.2.0.

Consumers on 0.2.0 run unchanged on 0.2.1. Nothing to do unless you want to opt into the new names.

## Migration guide

### Python — read `payout_ready` instead of `stripe_ready`

Before (0.2.0, still works on 0.2.1):

```python
summary = client.developer_portal_summary()
if summary["stripe_ready"]:
    enable_listing_ui()
```

After (recommended on 0.2.1+):

```python
summary = client.developer_portal_summary()
# payout_ready returns the same value today; will generalize to on-chain
# destinations once those land.
if summary["payout_ready"]:
    enable_listing_ui()
```

Same pattern for every `stripe_*` → `payout_*` pair listed above. The values are currently identical, so you can swap names without guarding on both.

### TypeScript — type-level migration

Your existing `summary.stripe_ready` access continues to compile. To move forward, read `summary.payout_ready` instead. Both names are present in the 0.2.1 type; the `stripe_*` names are flagged deprecated, which most editors surface as a strikethrough / hint.

## Timeline for the `stripe_*` removal

- **0.2.1 (now)** — both families present, `stripe_*` flagged `deprecated: true`.
- **0.2.x patch releases** — no planned field changes.
- **0.3.0 (future, breaking)** — `stripe_*` aliases removed from the response. The minor-in-zerover bump signals the break. A deprecation window of at least one minor cycle is guaranteed before removal.

## Context

This release is strictly a contract-surface rename. It does not change which destinations are supported (Stripe Connect remains the only live payout destination at the time of this release). The Polygon settlement modes added in 0.2.0 — `polygon_mandate`, `embedded_wallet_charge` — remain metadata-only commitments; the on-chain charge execution path is still a subsequent phase.
