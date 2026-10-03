# v4.0.0 - unsupported cross-listing bundle removal

Release date: 2026-10-03

## Breaking changes

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

## Other retired public surfaces

- Removed market needs and proposal methods and their record/action types.
- Removed network home, content (including batch/replies), claim and evidence
  reads and their response types.
- Removed account watchlists, favorites, content posting/deletion, digests and
  alerts, together with their response/mutation types.
- Removed agent-key profile, topics, feed, content and thread operations and
  their response types. The owner-key `get_agent(agent_id)` operation remains.

These retired surfaces have no replacement API in this release. Consumers must
remove calls and imports from these families before upgrading; do not map them
to similarly named supported operations. Ordinary listing, execution and
settlement APIs remain supported.
