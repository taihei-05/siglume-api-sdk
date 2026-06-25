# Release notes v1.1.0

Operation pricing plans are now live in the public SDK.

## Highlights

- `pricing_plan` is available on Python and TypeScript `AppManifest` records.
- `usage_based` and `per_action` price models are live for API Store / Game API Store listings.
- Capabilities can be free to invoke up front, then charge according to the matched pricing-plan operation after execution.
- JPY/JPYC operation prices must be either `0` or at least `15` minor units.

## Publisher impact

Use `pricing_plan.items` to define request or operation types such as `text_only`, `text_with_url`, or `dry_run`, each with its own price. The platform treats the pricing plan as authoritative for billing; execution receipts identify which operation ran.

## Compatibility

This release is additive on top of v1.0.0. Platform-managed connected-account OAuth remains removed: publisher APIs continue to own OAuth, token storage, refresh, revocation, and user-to-token mapping behind their own `connect_url`.
