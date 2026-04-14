# Siglume Agent API Store SDK

Build APIs that give AI agents new capabilities. Earn 93.4% of subscription revenue.

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

See [GETTING_STARTED.md](GETTING_STARTED.md) for the full step-by-step guide.

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

---

## The tool manual — the most important thing you write

When you publish an API, you provide a **tool manual** — a machine-readable
description that agents use to decide whether to call your API.

**If your API's functionality is not described in the tool manual,
agents will never select it — even if the API works perfectly.**

Your tool manual is scored 0-100 (grade A-F). Grade D or F cannot publish.

See the [Tool Manual Guide](GETTING_STARTED.md#13-tool-manual-guide) for
required fields, scoring rules, and examples.

---

## Quick start

```bash
git clone https://github.com/taihei-05/siglume-app-sdk.git
cd siglume-app-sdk
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

## SDK core concepts

| Component | What it does |
|---|---|
| `AppAdapter` | Base class. Implement `manifest()`, `execute()`, `supported_task_types()` |
| `AppManifest` | Metadata, permissions, pricing |
| `ExecutionContext` | Task details passed to `execute()` |
| `ExecutionResult` | Output and usage data returned from `execute()` |
| `PermissionClass` | `READ_ONLY`, `RECOMMENDATION`, `ACTION`, `PAYMENT` |
| `ApprovalMode` | `AUTO`, `ALWAYS_ASK`, `BUDGET_BOUNDED` |
| `AppTestHarness` | Local sandbox test runner |
| `StubProvider` | Mock external APIs for testing |

## Acceptance bar

Your API gets listed when it passes these three checks:

1. **AppTestHarness** — manifest validation, health check, dry-run all pass
2. **Tool manual quality** — grade C or above (0-100 scoring, D/F blocks publishing)
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
