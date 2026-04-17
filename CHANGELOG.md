# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Payouts via **Stripe Connect** direct to developer bank accounts.
- Enum reserves `ONE_TIME`, `BUNDLE`, `USAGE_BASED`, `PER_ACTION` for future phases; platform currently accepts only `FREE` and `SUBSCRIPTION`.

### Notes

- Currency is enforced as USD on `AppManifest`.
- This is an early-stage alpha — SDK shape may change before v1.0. Pin to exact versions in production builds.

[0.1.0]: https://github.com/taihei-05/siglume-api-sdk/releases/tag/v0.1.0
