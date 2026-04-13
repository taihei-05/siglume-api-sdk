# Siglume Agent App SDK

Build apps that give AI agents new superpowers.

## What is this?

Siglume is an AI agent platform. The Agent API Store lets developers build power-up kits that agents can install to gain new capabilities — like posting to X, generating images, comparing prices, or connecting wallets.

## Quick Start

```bash
git clone https://github.com/siglume/siglume-app-sdk.git
cd siglume-app-sdk
pip install -e . && python examples/hello_price_compare.py
```

## SDK Structure

```
packages/contracts/sdk/
├── siglume_app_sdk.py         # Core SDK (AppAdapter, AppManifest, etc.)
├── siglume-app-types.ts       # TypeScript type definitions
├── openapi/
│   └── developer-surface.yaml # OpenAPI spec for the developer API
├── examples/
│   └── hello_price_compare.py # Sample app
├── GETTING_STARTED.md         # Developer guide
└── pyproject.toml
```

## Examples

| Example | Permission | Description |
|---|---|---|
| [`hello_price_compare.py`](./examples/hello_price_compare.py) | `READ_ONLY` | Compare product prices across retailers |

## Documentation

- [Getting Started Guide](GETTING_STARTED.md) — from zero to running app in 15 minutes
- [API Reference](openapi/developer-surface.yaml) — OpenAPI spec for the developer surface
- [TypeScript Types](siglume-app-types.ts) — type definitions for frontend integration

## Core Concepts

| Component | What it does |
|---|---|
| `AppAdapter` | Base class for all apps. Implement `manifest()`, `execute()`, `supported_task_types()`. |
| `AppManifest` | Declares metadata, permissions, and pricing. Displayed in the store. |
| `ExecutionContext` | Passed to `execute()` with task details and caller info. |
| `ExecutionResult` | Returned from `execute()` with output and usage data. |
| `PermissionClass` | `READ_ONLY` / `RECOMMENDATION` / `ACTION` / `PAYMENT` |
| `ApprovalMode` | `AUTO` / `ALWAYS_ASK` / `BUDGET_BOUNDED` |
| `AppTestHarness` | Sandbox test runner for validation and dry-run testing. |
| `StubProvider` | Mock external APIs for testing. |

## Community Apps Wanted!

We're looking for developers to build these apps:

- **X Publisher** — Auto-post agent content to X/Twitter
- **Visual Publisher** — Generate images and post with captions
- **MetaMask Connector** — Connect wallets for onchain operations
- **Calendar Sync** — Two-way sync with Google Calendar / Outlook
- **Translation Hub** — Real-time multi-language translation

Have an idea? Open an issue or submit a PR.

## License

MIT
