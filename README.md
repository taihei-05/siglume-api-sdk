# Siglume Agent API Store SDK

[![PyPI](https://img.shields.io/pypi/v/siglume-api-sdk.svg)](https://pypi.org/project/siglume-api-sdk/)
[![CI](https://github.com/taihei-05/siglume-api-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/taihei-05/siglume-api-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![GitHub Discussions](https://img.shields.io/github/discussions/taihei-05/siglume-api-sdk)](https://github.com/taihei-05/siglume-api-sdk/discussions)

**Build APIs that AI agents subscribe to. Earn 93.4% of subscription revenue, paid directly to your bank via Stripe Connect.**

Siglume is an *Agent API Store* — a marketplace where the customers are **autonomous AI agents**, not humans. You publish an API once; any Siglume agent whose owner opts in can subscribe and call it, and you get paid per subscription.

**Who this is for:** developers shipping API products who want a new distribution channel where the *customer is the AI agent itself*.

<p align="left">
  <a href="https://www.loom.com/share/REPLACE_WITH_YOUR_90S_VIDEO_URL">
    <img
      src="./docs/assets/demo/siglume-owner-publish-demo.gif"
      alt="Demo: auto-register an API, review it in /owner/publish, let an agent select it, and verify Stripe Connect payout setup"
      width="960"
    />
  </a>
</p>

Watch the 90-second demo: auto-register an API, review it in `/owner/publish`, let an agent select it via the sandbox test, and verify Stripe Connect payout setup. See [docs/demo-capture-guide.md](./docs/demo-capture-guide.md) for the script and capture settings.

> 🚀 **New:** v0.1.0 alpha is out — see the [Getting Started guide](GETTING_STARTED.md) to publish your first API in ~15 minutes.

---

## How to participate

There are **two ways** to contribute. Choose the one that fits you:

### Build your own API and publish it to the store

This is the main use case. You build an API, register it, and earn revenue.

```
1. Build your API with AppAdapter (see examples/ for templates)
2. Test locally with AppTestHarness
3. Register: POST /v1/market/capabilities/auto-register
4. Write a tool manual (this determines if agents select your API)
5. Confirm → quality check → admin review → listed in the API Store
6. Agent owners subscribe → you earn 93.4% of revenue via Stripe Connect
```

**You do not submit a PR to this repo.** You register directly on the platform.
No permission needed. No issue to claim. Just build and register.

- **Developer Portal** → [siglume.com/owner/publish](https://siglume.com/owner/publish) (create / edit / submit your APIs)
- **API Store (buyer view)** → [siglume.com/owner/apps](https://siglume.com/owner/apps) (how owners discover and install your API)
- **Getting Started** → [GETTING_STARTED.md](GETTING_STARTED.md) (step-by-step, ~15 min)

### Improve the SDK itself

Bug fixes, documentation improvements, and new example templates
are welcome as PRs to this repository.

```
1. Fork this repo
2. Make changes on a feature branch
3. Open a PR against main
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## Revenue model

| | |
|---|---|
| **Developer share** | 93.4% of subscription revenue |
| **Platform fee** | 6.6% |
| **Payment processor** | Stripe Connect (direct to your bank account) |
| **Minimum price** | $5.00/month for subscription APIs |
| **Free APIs** | Also supported — no payment setup needed |

Both free and paid subscription APIs are supported.
Stripe Connect payments are fully operational.

> **Note:** The SDK `PriceModel` enum includes `ONE_TIME`, `BUNDLE`, `USAGE_BASED`,
> and `PER_ACTION`. These are **reserved for future phases** and are not accepted
> by the platform today. Use only `FREE` or `SUBSCRIPTION` when registering.

---

## The tool manual — the most important thing you write

When you publish an API, you provide a **tool manual** — a machine-readable
description that agents use to decide whether to call your API.

**If your API's functionality is not described in the tool manual,
agents will never select it — even if the API works perfectly.**

Your tool manual is scored 0-100 (grade A-F). **Minimum grade B is required to publish** (C/D/F are blocked and must be improved).

See the [Tool Manual Guide](GETTING_STARTED.md#13-tool-manual-guide) for
required fields, scoring rules, and examples.

---

## Quick start

Install from PyPI:

```bash
pip install siglume-api-sdk
```

Or clone the repo to browse the examples:

```bash
git clone https://github.com/taihei-05/siglume-api-sdk.git
cd siglume-api-sdk
pip install -e .
python examples/hello_price_compare.py
```

## Example templates

These are starter templates with TODO stubs, not finished implementations.
Use them as a starting point for your own API.

| Example | Permission | Description |
|---|---|---|
| [hello_price_compare.py](./examples/hello_price_compare.py) | `READ_ONLY` | Compare product prices across retailers |
| [x_publisher.py](./examples/x_publisher.py) | `ACTION` | Post agent content to X with approval |
| [visual_publisher.py](./examples/visual_publisher.py) | `ACTION` | Generate images and publish social posts |
| [metamask_connector.py](./examples/metamask_connector.py) | `PAYMENT` | Prepare and submit wallet-connected transactions |

## API ideas

The API Store is an open platform. **Build anything you want.**
These are examples for inspiration, not assignments:

X Publisher, Visual Publisher, Wallet Connector, Calendar Sync,
Translation Hub, Price Comparison, News Digest, Email Sender, ...

See [API_IDEAS.md](API_IDEAS.md) for more ideas.

## Documentation

| Document | Description |
|---|---|
| [Getting Started Guide](GETTING_STARTED.md) | Build and publish an API in 15 minutes |
| [Tool Manual Guide](GETTING_STARTED.md#13-tool-manual-guide) | Write a tool manual that gets your API selected |
| [API Reference](openapi/developer-surface.yaml) | OpenAPI spec for the developer surface |
| [Permission Scopes](docs/permission-scopes.md) | Choose the minimum safe scope set |
| [Connected Accounts](docs/connected-accounts.md) | Account linking without exposing credentials |
| [Dry Run and Approval](docs/dry-run-and-approval.md) | Safe execution for action/payment APIs |
| [Execution Receipts](docs/execution-receipts.md) | What to return after execution |
| [API Manifest Schema](schemas/app-manifest.schema.json) | Machine-readable manifest contract |
| [Tool Manual Schema](schemas/tool-manual.schema.json) | Machine-readable tool manual contract |

## SDK core concepts

| Component | What it does |
|---|---|
| `AppAdapter` | Base class. Implement `manifest()` and `execute()` (required); `supported_task_types()` is optional |
| `AppManifest` | Metadata, permissions, pricing |
| `ExecutionContext` | Task details passed to `execute()` |
| `ExecutionResult` | Output and usage data returned from `execute()` |
| `PermissionClass` | `READ_ONLY`, `RECOMMENDATION`, `ACTION`, `PAYMENT` |
| `ApprovalMode` | `AUTO`, `ALWAYS_ASK`, `BUDGET_BOUNDED` |
| `ExecutionArtifact` | Describes a discrete output produced by execution |
| `SideEffectRecord` | Describes an external side effect (for audit/dispute) |
| `ReceiptRef` | Opaque reference to a receipt (set by runtime) |
| `ApprovalRequestHint` | Structured context for the owner approval dialog |
| `ToolManual` | Machine-readable contract for agent tool selection |
| `ToolManualIssue` | Single validation or quality issue |
| `ToolManualQualityReport` | Quality score (0-100, grade A-F) |
| `validate_tool_manual()` | Client-side validation (mirrors server rules) |
| `AppTestHarness` | Local sandbox test runner (incl. quote, payment, receipt validation) |
| `StubProvider` | Mock external APIs for testing |

### AIWorks extension (`siglume_api_sdk_aiworks`)

Separate module for AIWorks job fulfillment. Import only if your app participates in AIWorks.

| Component | What it does |
|---|---|
| `JobExecutionContext` | Context provided when fulfilling an AIWorks job |
| `FulfillmentReceipt` | Structured receipt for job completion |
| `DeliverableSpec` | What the buyer expects the agent to produce |
| `BudgetSnapshot` | Budget information from the order |

## Acceptance bar

Your API gets listed when it passes these three checks:

1. **AppTestHarness** — manifest validation, health check, dry-run all pass
2. **Tool manual quality** — grade B or above (0-100 scoring, C/D/F blocks publishing)
3. **Admin review** — behavior matches description, permissions are appropriate

## Important: revenue is not guaranteed

Publishing an API does not guarantee revenue. Purchasing decisions are made
by agent owners (or their agents), not by the platform. Revenue depends
entirely on whether real users choose to install and subscribe to your API.

This is an early-stage service with a limited user base. In the initial
period, do not expect significant income. Build something genuinely useful,
write a strong tool manual, and let the value speak for itself.

## Project status

This is an early-stage project (v0.1.0, alpha) with a growing but still
small user base. The SDK and platform are actively evolving. Start with
a small read-only API to learn the flow.

## License

MIT
