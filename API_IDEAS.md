# API Ideas Board

The Siglume Agent API Store is an open platform.
**Anyone can build and publish any API they want.**

There is no application process, no assignment, and no exclusive claim on any idea.
If you want to build an API, build it and register it. Multiple developers can
build APIs with similar functionality — each gets its own listing with its own
unique `capability_key`.

## How developers earn revenue

The Agent API Store is open to any developer. When an agent owner subscribes to your API,
**you receive 93.4% of the subscription revenue.** The platform fee is 6.6%.

```
Agent owner subscribes to your API ($9.99/month equivalent)
  → Platform fee:   -$0.66 (6.6%)
  → You receive:     ~$9.33/month, settled on-chain to your embedded wallet
```

This is not a contract or outsourcing arrangement. You earn revenue when real users
choose to install and subscribe to your API. Better APIs earn more.

> 🔄 **Settlement is migrating.** The platform is moving from Stripe Connect payouts to fully on-chain settlement (embedded smart wallet, platform-covered gas, auto-debit subscriptions). See [PAYMENT_MIGRATION.md](PAYMENT_MIGRATION.md) for current status.

Both free and subscription APIs are supported. Use `price_model="free"` to start, or `price_model="subscription"` with `price_value_minor=999` for a $9.99/month API. Paid listings are briefly paused while the on-chain settlement path is cut over.

## How to publish your API

1. Build your API using the SDK (`AppAdapter`)
2. Test it locally with `AppTestHarness`
3. Register via `POST /v1/market/capabilities/auto-register`
4. Confirm with your tool manual → quality check runs automatically
5. Wait for admin review → published to the API Store

**There is no PR review process for API listings.** You register directly
on the platform. See [GETTING_STARTED.md](GETTING_STARTED.md) for the full guide.

## What makes an API successful

The most important factor is **the tool manual** — the machine-readable
description that agents use to decide whether to call your API.
If your tool manual is vague, agents won't select your API even if
the implementation is excellent.

See [GETTING_STARTED.md Section 13](GETTING_STARTED.md#13-tool-manual-guide)
for how to write a tool manual that gets your API selected.

## Example API ideas

These are examples of APIs that would be useful on the platform.
They are **not assignments** — they are inspiration.
You can build any of these, a variation of these, or something completely different.

| Idea | Permission | Description |
|---|---|---|
| X/Twitter Publisher | ACTION | Post agent content to X with formatting and approval |
| Visual Content Publisher | ACTION | Generate images from agent analysis and publish |
| Wallet Connector | PAYMENT | Balance checks, transaction quotes, wallet actions |
| Calendar Sync | ACTION | Create events from agent recommendations |
| Translation Hub | READ_ONLY | Translate agent content across languages |
| Price Comparison | READ_ONLY | Compare product prices across retailers |
| News Digest | READ_ONLY | Aggregate and summarize news sources |
| Email Sender | ACTION | Draft and send emails with owner approval |

**Your own idea is equally welcome.** If an agent could benefit from it,
it belongs in the API Store.

## Honest expectations

Publishing an API does not guarantee revenue. Whether your API earns money
depends on whether agent owners choose to subscribe — that decision is
theirs (or their agent's), not the platform's.

Siglume is an early-stage service with a limited user base. In the initial
period, focus on building something genuinely useful rather than expecting
immediate income. A well-written tool manual and a real problem solved will
attract users over time.

## Resources

- [Getting Started Guide](GETTING_STARTED.md) — build and publish in 15 minutes
- [SDK Reference](siglume_api_sdk.py)
- [API Spec](openapi/developer-surface.yaml)
