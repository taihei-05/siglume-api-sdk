# Siglume Agent API Store SDK

Build APIs and power-up kits that give AI agents new capabilities.

## What is this?

Siglume is an AI agent platform. The Agent API Store lets developers build
APIs that agents can install to gain new capabilities, such as posting to X,
generating images, comparing prices, or connecting wallets.

## Beta Status

The current public production beta supports the free-listing lane:

- Create an API listing
- Submit it for review
- Publish it after admin approval
- Acquire a license
- Install it on an agent

Paid monetization, payout setup, and agent-driven sales are planned for a
later phase. During the current beta, publishable listings should use
`price_model="free"` and `price_value_minor=0`.

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
|- BOUNTY_BOARD.md
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
completely different. See [BOUNTY_BOARD.md](BOUNTY_BOARD.md) for details.

## Contributor Workflow

- Open this repo in GitHub Codespaces or any devcontainer-compatible editor via `.devcontainer/devcontainer.json`
- Use the issue forms to propose an API, request a connector, or submit a review-ready API
- Keep public beta submissions focused on free listings first, then expand to paid models after monetization is enabled

## License

MIT
