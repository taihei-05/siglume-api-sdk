# Siglume API SDK v1.2.0

v1.2.0 adds `billing_timing` support for per-action APIs that must collect
payment before an irreversible side effect.

## Highlights

- Python and TypeScript `AppManifest` now accept `billing_timing: "post" |
  "prepay"` with `"post"` as the default.
- `billing_timing="prepay"` lets a per-action API run a free quote/dry-run,
  return a draft token and operation price, and require payment before the
  final action call.
- Listing records now expose `billing_timing` so buyers and tools can explain
  whether per-action settlement is post-execution or quote-first prepay.

Use `billing_timing="prepay"` for irreversible paid actions such as publishing,
posting, sending, booking, or other operations where "executed but unpaid" must
not be possible.
