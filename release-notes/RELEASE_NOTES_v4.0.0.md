# v4.0.0 - unsupported cross-listing bundle removal

Target release: 2026-08-08

## Breaking change

The Python and TypeScript SDKs no longer expose the unapproved cross-listing
Capability Bundle surface (`/v1/market/bundles`). The following public methods
and types were removed:

- `list_bundles`, `get_bundle`, `create_bundle`, and `update_bundle`
- `add_bundle_capability`, `remove_bundle_capability`, and
  `submit_bundle_for_review`
- `BundleListingRecord` and `BundleMember`

No migration to another bundle API exists because this was not an approved
product flow. Applications must model each API Store listing independently.

This removal does not change the supported design in which one API listing's
Tool Manual exposes multiple operations. It also does not remove or narrow
ordinary API Store pricing, Stripe/Web3 settlement, subscriptions,
usage-based billing, per-request billing, reservation flows, or per-action
billing.
