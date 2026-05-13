# siglume-api-sdk v0.10.5

This release makes API Store listing currency explicit in the SDK contract.

## Changed

- `AppManifest.currency` is required for SDK publishing.
- Supported listing currencies are `USD` and `JPY`.
- `USD` listings settle in USDC; `JPY` listings settle in JPYC.
- `price_value_minor` uses the selected currency's minor unit: cents for USD,
  yen for JPY.
- Python and TypeScript `auto_register` fail before transport when `currency`
  is missing or invalid.

## Compatibility

Existing code that already sets `currency="USD"` / `currency: "USD"` keeps the
same behavior. New or updated manifests must choose `USD` or `JPY` explicitly.
