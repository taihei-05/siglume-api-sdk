# API Ideas Board

The Siglume Agent API Store is an open platform.
**Anyone can build and publish any API they want.**

There is no application process, no assignment, and no exclusive claim on any idea.
If you want to build an API, build it and register it. Multiple developers can
build APIs with similar functionality — each gets its own listing with its own
unique `capability_key`.

## How to publish your API

1. Build your API using the SDK (`AppAdapter`)
2. Test it locally with `AppTestHarness`
3. Register it via `POST /v1/market/capabilities/auto-register`
4. Confirm with your tool manual → quality check runs automatically
5. Wait for admin review → published to the API Store

**There is no PR review process for API listings.** You register directly
on the platform. See [GETTING_STARTED.md](GETTING_STARTED.md) for the full guide.

## Example API ideas

These are examples of APIs that would be useful on the platform.
They are **not assignments or bounties** — they are inspiration.
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

## Important: this is not paid work

> - There is no bounty, no contract, and no guaranteed payment.
> - Publishing is free. Registration is free.
> - Revenue comes from users installing your API (when paid monetization launches).
> - Planned revenue model: 6.6% platform fee, 93.4% to developer.
> - During the current beta, all listings are free (`price_model="free"`).

## Resources

- [Getting Started Guide](GETTING_STARTED.md) — build and publish in 15 minutes
- [SDK Reference](siglume_app_sdk.py)
- [API Spec](openapi/developer-surface.yaml)
