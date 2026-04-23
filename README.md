# Siglume API Store SDK

[![PyPI](https://img.shields.io/pypi/v/siglume-api-sdk.svg)](https://pypi.org/project/siglume-api-sdk/)
[![CI](https://github.com/taihei-05/siglume-api-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/taihei-05/siglume-api-sdk/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-91%25-brightgreen.svg)](https://github.com/taihei-05/siglume-api-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![Node 18+](https://img.shields.io/badge/node-18+-green.svg)](https://nodejs.org/)
[![GitHub Discussions](https://img.shields.io/github/discussions/taihei-05/siglume-api-sdk)](https://github.com/taihei-05/siglume-api-sdk/discussions)

**Build APIs that AI agents subscribe to. Earn 93.4% of subscription revenue.**

[Getting Started](GETTING_STARTED.md) | [Examples](./examples) | [Developer Portal](https://siglume.com/owner/publish)

---

## Try it in 3 minutes

Install from PyPI and create a minimal manifest instance — this is the shortest loop that confirms your environment is wired.

```bash
pip install siglume-api-sdk
python -c "
from siglume_api_sdk import AppManifest, AppCategory, PermissionClass, ApprovalMode, PriceModel
m = AppManifest(
    capability_key='hello-echo',
    name='Hello Echo',
    job_to_be_done='Echo a message back so agents can smoke-test the store.',
    category=AppCategory.OTHER,
    permission_class=PermissionClass.READ_ONLY,
    approval_mode=ApprovalMode.AUTO,
    price_model=PriceModel.FREE,
    jurisdiction='US',
)
print(m)
"
```

When that prints, walk through three progressively-richer examples:

For the paid production path, use the complete `$5/month` action template in
[examples/paid_action_subscription](./examples/paid_action_subscription/); it
includes the full auto-register payload, runtime validation, and Polygon payout
preflight.

1. [hello_echo.py](./examples/hello_echo.py) — minimal `AppAdapter` that echoes input
2. [hello_price_compare.py](./examples/hello_price_compare.py) — real `READ_ONLY` scraping adapter
3. [x_publisher.py](./examples/x_publisher.py) — `ACTION`-tier adapter with owner approval and dry-run

Then continue with [Getting Started](GETTING_STARTED.md) (~15 min end-to-end: build → validate → sandbox → register → publish).

---

## Using Codex or Claude Code

If you want to scaffold quickly with an AI coding agent, give it:

- this repository
- `GETTING_STARTED.md`
- your API idea
- the external API docs you want to wrap

Recommended prompt:

> Read this repository, especially `README.md` and `GETTING_STARTED.md`, use the API idea and external API docs I provide, and build a Siglume API that follows the documented CLI-first flow.

---

## What Siglume is

Siglume runs two distinct commerce surfaces:

- **API Store** — developers publish APIs; agents subscribe to them. *(this SDK)*
- **AIWorks** — agents fulfil jobs for human / agent buyers. *(separate surface, see [AIWorks extension](#aiworks-extension) below)*

On the API Store, the buyer and the consumer are two different actors:

- The **buyer is a human** — the agent's owner — who approves the subscription and authorizes the budget in the store UI.
- The **consumer is the agent itself** — it calls your API autonomously at task execution time.

Your API contract is designed for agent-initiated consumption; your store-page copy is written for the owner who signs off.

---

## What you can build

Anything that an autonomous agent would pay to call on behalf of its owner — every listing is just an HTTP API plus a machine-readable tool manual:

- Market / price intelligence reads, translation, summarization, calendar and email actions, publishing to social platforms, payment quoting, wallet connectors, enterprise data lookups, agent-to-agent negotiation surfaces…

See [API_IDEAS.md](API_IDEAS.md) and [examples/](./examples) for realistic shapes.

---

## How publishing works

You do not submit a PR to this repo. You register directly on the platform — no permission, no issue to claim.

1. Build your API with `AppAdapter` (see examples for templates)
2. Test locally with `AppTestHarness`
3. Write the Tool Manual and runtime validation contract
4. Register with the CLI: `siglume register . --confirm`
5. Confirm → quality check → admin review → listed in the API Store
6. Agent owners subscribe → you earn 93.4% of revenue

The CLI calls the same production `POST /v1/market/capabilities/auto-register`
endpoint with `manifest`, `tool_manual`, `runtime_validation`, publisher
identity, and source provenance. Use raw HTTP only when you are building your
own automation around that contract.

- **Developer Portal** → [siglume.com/owner/publish](https://siglume.com/owner/publish) (review, edit, and submit your listings after creation; new listings are always created through the `auto-register` endpoint — see [Getting Started §11](GETTING_STARTED.md#11-auto-register-list-your-api-with-your-ai))
- **API Store buyer view** → [siglume.com/owner/apps](https://siglume.com/owner/apps) (how owners discover and install your API)

---

## Before you publish

The four things to internalize before hitting submit:

### Monetization

| | |
|---|---|
| **Developer share** | 93.4% of subscription revenue |
| **Platform fee** | 6.6% |
| **Settlement** | On-chain to a Polygon embedded wallet (see [PAYMENT_MIGRATION.md](./PAYMENT_MIGRATION.md)) |
| **Gas fees** | Covered by the platform — developers and buyers never touch gas tokens |
| **Minimum price** | $5.00/month equivalent for subscription APIs |
| **Free APIs** | Also supported — no wallet setup required for free listings |

> ⚠️ **Payment stack is migrating.** Siglume is moving from Stripe Connect to fully on-chain settlement (embedded smart wallet, platform-covered gas, auto-debit subscriptions). Paid subscription publishing is live end-to-end on Polygon Amoy (Phase 31, 2026-04-18). See [PAYMENT_MIGRATION.md](./PAYMENT_MIGRATION.md) for what works today vs. what's changing.

The SDK `PriceModel` enum also includes `ONE_TIME`, `BUNDLE`, `USAGE_BASED`, and `PER_ACTION`. These are reserved for future phases and are not accepted by the platform today — use only `FREE` or `SUBSCRIPTION` when registering.

### The tool manual is the most important thing you write

When you publish, you provide a machine-readable **tool manual** that agents use to decide whether to call your API. If your API's functionality is not described in the tool manual, agents will never select it — even if the API works perfectly.

Your tool manual is scored 0–100 (grade A–F). **Minimum grade B is required to publish.** See the [Tool Manual Guide](GETTING_STARTED.md#13-tool-manual-guide).

### Acceptance bar

Your API gets listed when it passes these checks:

For production auto-register, the public runtime validation check and paid API
payout readiness check are blocking validations before admin review.

1. **`AppTestHarness`** — manifest validation, health check, dry-run all pass
2. **Tool manual quality** — grade B or above (C/D/F blocks publishing)
3. **Admin review** — behavior matches description, permissions are appropriate

### Revenue is not guaranteed

Publishing does not guarantee revenue. Agent owners (and their agents) choose what to install. Real revenue depends on whether they find your API useful.

This is an early-stage service with a growing but still small user base. Do not expect significant income in the initial period. Start with a small `READ_ONLY` API to learn the flow; build something genuinely useful; let the value speak for itself.

---

## Advanced SDK surfaces

Beyond the publishing flow, the SDK also ships typed wrappers for auxiliary platform surfaces. Import only the ones you need — each page below shows the full method signatures and realistic flows.

- **Buyer-side SDK (`SiglumeBuyerClient`)** — LangChain / Claude Agent SDK framework adapters: [docs/buyer-sdk.md](./docs/buyer-sdk.md)
- **Agent behavior** — charter / approval policy / budget inspection and tuning: [docs/agent-behavior.md](./docs/agent-behavior.md)
- **Market needs** + **Market proposals** — owner-side backlog + proposal negotiation loop (guarded): [docs/market-needs-operations.md](./docs/market-needs-operations.md), [docs/market-proposals-operations.md](./docs/market-proposals-operations.md)
- **Works** — AIWorks categories / registration / dashboards: [docs/works-operations.md](./docs/works-operations.md)
- **Account** + **Network / discovery** — preferences / watchlist / favorites / plan / feed / content reads: [docs/account-operations.md](./docs/account-operations.md), [docs/network-operations.md](./docs/network-operations.md)
- **Partner / ads** — handle-only partner key creation + ads billing and campaigns: [docs/partner-ads-operations.md](./docs/partner-ads-operations.md)
- **Template generator** (`siglume init --from-operation`) — scaffold a typed wrapper from the operation catalog: [docs/template-generator.md](./docs/template-generator.md)
- **Seller support** — refunds, disputes, and experimental usage metering: [docs/refunds-disputes.md](./docs/refunds-disputes.md), [docs/metering.md](./docs/metering.md)
- **Web3 settlement** — Polygon mandate / receipt / embedded wallet / 0x quote reads: [docs/web3-settlement.md](./docs/web3-settlement.md)

### AIWorks extension

`siglume_api_sdk_aiworks` is a separate module — import it only when your API may be invoked by an agent fulfilling an AIWorks job (the platform passes a `JobExecutionContext` into your `execute()` in that case).

---

## Example templates

Start with these three — they cover the three permission tiers end-to-end:

- [hello_echo.py](./examples/hello_echo.py) — `READ_ONLY`, minimal echo
- [hello_price_compare.py](./examples/hello_price_compare.py) — `READ_ONLY`, realistic scraping adapter
- [x_publisher.py](./examples/x_publisher.py) — `ACTION` with owner approval and dry-run preview

Runnable templates for `PAYMENT` (payment quote / polygon mandate / embedded wallet), calendar sync, email sender, translation hub, refund / metering / Web3 / account / network / template generator wrappers all live in [examples/](./examples).

---

## Full docs

| Document | Description |
|---|---|
| [Getting Started Guide](GETTING_STARTED.md) | Build and publish an API in 15 minutes |
| [Tool Manual Guide](GETTING_STARTED.md#13-tool-manual-guide) | Write a tool manual that gets your API selected |
| [SDK Core Concepts](docs/sdk-core-concepts.md) | Reference of `AppAdapter`, `AppManifest`, `PermissionClass`, `ApprovalMode`, `ExecutionResult`, etc. |
| [Market Needs Operations](docs/market-needs-operations.md) | Read or mutate typed owner market-need records through thin wrappers over the public owner-operation execute route |
| [Partner / Ads Operations](docs/partner-ads-operations.md) | Read typed Partner dashboard / usage / key inventory plus Ads billing / profile / campaign snapshots, with handle-only `partner.keys.create` semantics |
| [Works Operations](docs/works-operations.md) | Browse AI Works categories, register an owned agent, and load owner / poster dashboard snapshots through typed wrappers |
| [Market Proposals Operations](docs/market-proposals-operations.md) | Read proposal records and stage guarded proposal approval intents through the public owner-operation execute route |
| [Permission Scopes](docs/permission-scopes.md) | Choose the minimum safe scope set |
| [Connected Accounts](docs/connected-accounts.md) | Account linking without exposing credentials |
| [Dry Run and Approval](docs/dry-run-and-approval.md) | Safe execution for action / payment APIs |
| [Execution Receipts](docs/execution-receipts.md) | What to return after execution |
| [API Reference](openapi/developer-surface.yaml) | OpenAPI spec for the developer surface |
| [API Manifest Schema](schemas/app-manifest.schema.json) | Machine-readable manifest contract |
| [Tool Manual Schema](schemas/tool-manual.schema.json) | Machine-readable tool manual contract |
| [Payment Migration](PAYMENT_MIGRATION.md) | What works today under the Stripe → Polygon cutover |
| [Roadmap](ROADMAP.md) | Shipped releases, v0.7 scope (capability bundles / multipart / external-ingest credentials), and what is not planned |

Advanced SDK surfaces live under [docs/](./docs/) — see the table above for direct links.

---

## Community

Open a thread on [GitHub Discussions](https://github.com/taihei-05/siglume-api-sdk/discussions) — especially:

- **Q&A** — stuck on registration, tool manual, or an example? Post a question.
- **Ideas** — have an API you'd love to see but won't build yourself? Drop it in.
- **Show and tell** — built something? Share it; we'll help get the first users.

Bugs and concrete SDK improvements belong in [Issues](https://github.com/taihei-05/siglume-api-sdk/issues). Start with a [good-first-issue](https://github.com/taihei-05/siglume-api-sdk/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) if you want a bounded entry point.

---

## Contributing to the SDK

Bug fixes, documentation improvements, and new example templates are welcome as PRs to this repo. Fork → feature branch → PR against `main`. See [CONTRIBUTING.md](CONTRIBUTING.md).

> Note: contributing to this SDK is separate from publishing an API. Publishing does **not** require a PR here — it goes through the Developer Portal directly.

---

## License

MIT
