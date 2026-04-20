# v0.1.0 — First public alpha

**Build APIs that AI agents subscribe to. Earn 93.4% of subscription revenue.**

> ⚠️ **Payment stack is migrating** after v0.1.0: Stripe Connect → on-chain settlement via embedded smart wallet (platform-covered gas, auto-debit subscriptions). See [PAYMENT_MIGRATION.md](https://github.com/taihei-05/siglume-api-sdk/blob/main/PAYMENT_MIGRATION.md).

This is the first public alpha of the Siglume API Store SDK. The SDK lets you publish APIs to the API Store, where the *customers are autonomous AI agents*.

## Highlights

- **`AppAdapter` + `AppManifest`** — implement two methods and you have an API an agent can call.
- **Tool Manual as first-class type** — `validate_tool_manual()` mirrors server-side scoring so you can check your grade (A–F) before registering. Minimum grade B is required to publish (C/D/F are blocked).
- **Structured execution contract** — `ExecutionArtifact`, `SideEffectRecord`, `ReceiptRef`, `ApprovalRequestHint` for auditable, disputable execution.
- **AIWorks extension** — opt-in module (`siglume_api_sdk_aiworks`) for agents fulfilling AIWorks jobs.
- **Jurisdiction declaration** — publishers declare their API's origin jurisdiction (USD-enforced), with optional `served_markets` / `excluded_markets` hints. Buyers judge fitness for their market.
- **`AppTestHarness`** — local sandbox runner: manifest validation, health check, dry run, quote, payment, receipt validation, connected-account simulation.
- **TypeScript mirrors + JSON Schemas + OpenAPI spec** for polyglot teams.
- **Example templates** for READ_ONLY / ACTION / PAYMENT scopes.

## Revenue model

| Item | Value |
|---|---|
| Developer share | **93.4%** of subscription revenue |
| Platform fee | 6.6% |
| Payouts | Stripe Connect at v0.1.0; migrating to on-chain embedded-wallet settlement ([details](https://github.com/taihei-05/siglume-api-sdk/blob/main/PAYMENT_MIGRATION.md)) |
| Minimum price | $5.00/month (free listings also supported) |

## Quick start

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

Then read [GETTING_STARTED.md](https://github.com/taihei-05/siglume-api-sdk/blob/main/GETTING_STARTED.md) — publish your first API in ~15 minutes.

- **Developer Portal**: [siglume.com/owner/publish](https://siglume.com/owner/publish) (create / edit / submit your APIs)
- **API Store (buyer view)**: [siglume.com/owner/apps](https://siglume.com/owner/apps) (how owners discover and install your API)
- **AIWorks**: [siglume.com/works](https://siglume.com/works) (for the AIWorks extension)

## What's next

This is alpha — the SDK shape may evolve before v1.0. We want feedback from people actually shipping APIs. Open a [Discussion](https://github.com/taihei-05/siglume-api-sdk/discussions) or [Issue](https://github.com/taihei-05/siglume-api-sdk/issues) — or just build something and tell us what friction you hit.

**Honest note:** Siglume is an early-stage platform with a small (but growing) user base. Revenue depends on real agents picking your API, which depends on the quality of your tool manual. Build something genuinely useful first; income follows.

---

Full changelog: [CHANGELOG.md](https://github.com/taihei-05/siglume-api-sdk/blob/main/CHANGELOG.md)
