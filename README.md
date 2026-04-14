# Siglume Agent API Store SDK

Build APIs and power-up kits that give AI agents new capabilities.

## What is this?

Siglume is an AI agent platform. The Agent API Store lets developers build
APIs that agents can install to gain new capabilities, such as posting to X,
generating images, comparing prices, or connecting wallets.

## How It Works

Developers publish APIs. Agent owners subscribe. **You earn 93.4% of revenue.**

1. Build an API with the SDK
2. Register via auto-register
3. Pass admin review → listed in the API Store
4. Agent owners install your API → their agents gain new capabilities
5. You earn 93.4% revenue from every subscriber via Stripe Connect

**Both free and paid listings are supported.** Free APIs can be installed immediately. Subscription APIs ($5.00/month minimum) earn you 93.4% of revenue via Stripe Connect.

## Quick Start

```bash
git clone https://github.com/taihei-05/siglume-app-sdk.git
cd siglume-app-sdk
pip install -e .
python examples/hello_price_compare.py
```

## SDK Structure

```text
siglume-app-sdk/
|- siglume_app_sdk.py
|- siglume-app-types.ts
|- openapi/
|  |- developer-surface.yaml
|- examples/
|  |- hello_price_compare.py
|  |- x_publisher.py
|  |- visual_publisher.py
|  `- metamask_connector.py
|- docs/
|- schemas/
|- GETTING_STARTED.md
|- API_IDEAS.md
`- pyproject.toml
```

## Examples

| Example | Permission | Description |
|---|---|---|
| [`hello_price_compare.py`](./examples/hello_price_compare.py) | `READ_ONLY` | Compare product prices across retailers |
| [`x_publisher.py`](./examples/x_publisher.py) | `ACTION` | Post agent content to X with approval |
| [`visual_publisher.py`](./examples/visual_publisher.py) | `ACTION` | Generate images and publish social posts |
| [`metamask_connector.py`](./examples/metamask_connector.py) | `PAYMENT` | Prepare and submit wallet-connected transactions |

## Documentation

- [Getting Started Guide](GETTING_STARTED.md) - from zero to running an app in 15 minutes
- [API Reference](openapi/developer-surface.yaml) - OpenAPI spec for the developer surface
- [TypeScript Types](siglume-app-types.ts) - frontend integration types
- [Permission Scopes Guide](docs/permission-scopes.md) - choose the minimum safe scope set
- [Connected Accounts Guide](docs/connected-accounts.md) - account linking without exposing raw credentials
- [Dry Run and Approval Guide](docs/dry-run-and-approval.md) - safe execution expectations for action and payment APIs
- [Execution Receipts Guide](docs/execution-receipts.md) - what to return after execution
- [App Manifest Schema](schemas/app-manifest.schema.json) - machine-readable manifest contract
- [Community Launch Guide](COMMUNITY_LAUNCH.md) - enable Discussions and seed the first issues

## Tool Manual — The Most Important Thing You Write

When you publish an API, you provide a **tool manual** — a machine-readable
description that agents use to decide whether to call your API.

**If your API's functionality is not described in the tool manual,
agents will never select it — even if the API works perfectly.**

The tool manual includes trigger conditions (when to use), input/output
schemas, and usage hints. A quality check scores your manual 0-100
(grade A-F) and blocks publishing if the grade is D or F.

See the [Tool Manual Guide](GETTING_STARTED.md#13-tool-manual-guide) for the full guide.

## Core Concepts

| Component | What it does |
|---|---|
| `AppAdapter` | Base class for all apps. Implement `manifest()`, `execute()`, and `supported_task_types()`. |
| `AppManifest` | Declares metadata, permissions, and pricing. |
| `ExecutionContext` | Passed to `execute()` with task details and caller info. |
| `ExecutionResult` | Returned from `execute()` with output and usage data. |
| `PermissionClass` | `READ_ONLY`, `RECOMMENDATION`, `ACTION`, or `PAYMENT` |
| `ApprovalMode` | `AUTO`, `ALWAYS_ASK`, or `BUDGET_BOUNDED` |
| `AppTestHarness` | Sandbox test runner for validation and dry-run testing |
| `StubProvider` | Mock external APIs for testing |

## Build any API you want

The Agent API Store is an open platform. Anyone can build and publish
any API they want. Here are some ideas to get you started:

- X/Twitter Publisher
- Visual Content Publisher
- Wallet Connector
- Calendar Sync
- Translation Hub

These are examples, not assignments. Build any of these, or something
completely different. See [API_IDEAS.md](API_IDEAS.md) for inspiration.

## Contributor Workflow

- Open this repo in GitHub Codespaces or any devcontainer-compatible editor via `.devcontainer/devcontainer.json`
- Use the issue forms to propose an API, request a connector, or submit a review-ready API
- Both free and subscription listings are supported. Start with a free listing to test the flow, then add pricing when ready.

## Developer FAQ

### Do I need to claim an issue or ask permission before building an API?

No. The API Store is an open platform. Build any API you want and register
it via auto-register. The example issues ([Example] X Publisher, etc.) are
inspiration, not assignments. You do not need to comment, claim, or get
approval before starting.

### Is the contribution model "PR to this repo" or "auto-register on the platform"?

**Auto-register on the platform.** This SDK repo is for the SDK itself
(documentation, examples, tooling). To publish your API to the store,
use `POST /v1/market/capabilities/auto-register` — see
[GETTING_STARTED.md](GETTING_STARTED.md) for the full flow.
PRs to this repo are only for SDK improvements (bug fixes, new examples, docs).

### Can I earn money from this?

Yes. When an agent owner subscribes to your API, you receive 93.4% of the subscription revenue. Stripe processes payments directly to your bank account.

### Is the subscription/Stripe path actually usable right now?

Yes. `price_model="subscription"` and Stripe Connect are fully operational. Set up your Stripe Connect account, publish a subscription API, and revenue flows to you when owners subscribe.

### What is the acceptance bar for getting my API listed?

Your API must:
1. Pass `AppTestHarness` validation (manifest, health check, dry-run)
2. Have a tool manual with quality grade C or above
3. Pass admin review (behavior matches description, permissions appropriate)

There is no requirement to have a complete production implementation —
starter templates with TODO stubs are the starting point, not the finish line.

### Is this project stable enough to invest time in?

This is an early-stage project (v0.1.0, alpha). The SDK, API surface, and
platform are actively evolving. We recommend starting with a small API
(read-only permission class) to understand the flow before building
something complex. The core registration and review pipeline is functional.

## License

MIT
