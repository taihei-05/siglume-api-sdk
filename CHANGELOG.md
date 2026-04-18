# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-04-18

The on-chain migration's first SDK-visible phase. `SettlementMode` gains two Polygon-aware values.

### Changed (breaking for producers)

- **`SettlementMode` enum expanded** from `{stripe_checkout, stripe_payment_intent}` to `{stripe_checkout, stripe_payment_intent, polygon_mandate, embedded_wallet_charge}`. Consumers reading `SettlementMode` are unaffected; code that exhaustively matches on the enum or passes producer-side values will need updating. The expansion is a breaking change in semver terms (new value means `isinstance(sm, SettlementMode)` behaves differently downstream), hence the major-in-zerover bump to 0.2.0.
- `validate_tool_manual()` now accepts the two new values on `settlement_mode`. Tool manuals declaring `polygon_mandate` or `embedded_wallet_charge` will validate; the same tool manual on v0.1.x would fail `INVALID_SETTLEMENT_MODE`.
- TypeScript `SettlementMode` union, JSON Schema `settlement_mode.enum`, and OpenAPI `settlement_mode.enum` all mirror the expansion.

### What is and isn't live yet

- **Live now (server-side)**: metadata / validator / approval propagation. Tool manuals declaring the new modes validate, flow through the resolver, appear in dry-run preview, approval snapshot, `intent.plan_jsonb`, and the installed-tools API. The Owner Installed Tools page surfaces `settlement_mode` / `settlement_currency` / `settlement_network` / `accepted_payment_tokens`.
- **Not yet live**: the payment-permission tool execution itself actually settling on Web3. The execution path that would `charge()` via a Polygon mandate or embedded-wallet drain is a subsequent phase; today declaring the new mode is a *metadata* commitment, not a runtime change.

### Migration

- **If your tool manual declares `payment` class**: no action required unless you want to opt into the new modes. Existing `stripe_checkout` / `stripe_payment_intent` declarations continue to validate.
- **If you want to opt in**: set `settlement_mode="polygon_mandate"` for subscription-style auto-debit against an on-chain mandate, or `"embedded_wallet_charge"` for a one-shot charge against the user's embedded smart wallet. Currency remains USD; `accepted_payment_tokens` (USDC / JPYC on Polygon) and `settlement_network` ("polygon" / "polygon-amoy") are the adjacent fields the platform consumes.
- **TypeScript consumers**: exhaustive switch / match on `SettlementMode` will now surface a type error on the two new values. Extend your cases or narrow the type at the boundary.

### Context

- Builds on the Phase 31 live completion on Polygon Amoy (2026-04-18). See [PAYMENT_MIGRATION.md](PAYMENT_MIGRATION.md) for the full migration log, including the real `userOpHash` / `tx_hash` from the first on-chain completion.
- `ONE_TIME` / `BUNDLE` / `USAGE_BASED` / `PER_ACTION` remain reserved on `PriceModel`; no price-model change in v0.2.0.
- Payouts are now Polygon on-chain settlement (Turnkey-backed embedded smart wallets + Pimlico-sponsored gas) as of the Amoy live completion. Stripe Connect is retired for subscription purchases on platforms where the seller has a verified Polygon payout wallet.

## [0.1.0] — 2026-04-17

First public alpha of the Siglume Agent API Store SDK.

### Added

- `AppAdapter` base class and `AppManifest` / `ExecutionContext` / `ExecutionResult` types for building agent-callable APIs.
- `PermissionClass` scopes (`READ_ONLY`, `RECOMMENDATION`, `ACTION`, `PAYMENT`) and `ApprovalMode` (`AUTO`, `ALWAYS_ASK`, `BUDGET_BOUNDED`).
- `AppTestHarness` for local sandbox testing — manifest validation, health check, dry run, quote/payment/receipt validation, `simulate_connected_account_missing`.
- `StubProvider` for mocking external APIs in tests.
- **Tool Manual** as a first-class SDK type: `ToolManual`, `ToolManualIssue`, `ToolManualQualityReport`, `validate_tool_manual()` (mirrors server validation so you can check grade locally).
- **Structured execution contract**: `ExecutionArtifact`, `SideEffectRecord`, `ReceiptRef`, `ApprovalRequestHint` (legacy `receipt_summary` retained for backward compatibility).
- **AIWorks extension** (`siglume_api_sdk_aiworks`) for agents that fulfill AIWorks jobs: `JobExecutionContext`, `FulfillmentReceipt`, `DeliverableSpec`, `BudgetSnapshot`.
- **Jurisdiction declaration** on `AppManifest` and `ToolManual` — origin-declaration only; buyers judge fitness for their market. Optional `served_markets` / `excluded_markets` list fields on `AppManifest` provide additional market hints.
- TypeScript type mirrors (`siglume-api-types.ts`, `siglume-api-types-aiworks.ts`) and JSON Schemas for manifest and tool manual.
- OpenAPI spec (`openapi/developer-surface.yaml`) for the developer surface.
- Example templates: `hello_price_compare.py` (READ_ONLY), `x_publisher.py` (ACTION), `visual_publisher.py` (ACTION), `metamask_connector.py` (PAYMENT).
- CI workflow: ruff lint + examples smoke test on Python 3.11 and 3.12.
- Community infrastructure: issue forms, PR template, CODEOWNERS, CODE_OF_CONDUCT, SECURITY, devcontainer, discussion seeds, starter labels.

### Revenue model

- Developer share **93.4%** of subscription revenue (platform fee 6.6%).
- Subscription pricing only; minimum **$5.00/month** for paid. Free listings supported.
- Payouts via **Stripe Connect** at v0.1.0 time of cut; being migrated to on-chain embedded-wallet settlement — see [PAYMENT_MIGRATION.md](PAYMENT_MIGRATION.md). The `SettlementMode` enum values (`stripe_checkout`, `stripe_payment_intent`) will change in a later release when the on-chain contract lands.
- Enum reserves `ONE_TIME`, `BUNDLE`, `USAGE_BASED`, `PER_ACTION` for future phases; platform currently accepts only `FREE` and `SUBSCRIPTION`.

### Notes

- Currency is enforced as USD on `AppManifest`.
- This is an early-stage alpha — SDK shape may change before v1.0. Pin to exact versions in production builds.

[0.2.0]: https://github.com/taihei-05/siglume-api-sdk/releases/tag/v0.2.0
[0.1.0]: https://github.com/taihei-05/siglume-api-sdk/releases/tag/v0.1.0
