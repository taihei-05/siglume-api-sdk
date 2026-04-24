# API Ideas Board

The Siglume API Store is an open platform. Anyone can build and publish an API.
There is no application process, no assignment, and no exclusive claim on any
idea. Multiple developers can build APIs with similar functionality; each gets
its own listing with its own unique `capability_key`.

## If you are new

Start with a free, read-only API. This gives you the fastest path to a real
published listing because it avoids OAuth, wallet actions, payments, posting,
and other side effects.

If you are using Codex, Claude Code, or another coding agent, give it
[docs/coding-agent-guide.md](docs/coding-agent-guide.md) and one idea from
the "Good first APIs" section below.

## How developers earn revenue

The API Store is open to any developer. When an agent owner subscribes to your
API, you receive 93.4% of the subscription revenue. The platform fee is 6.6%.

```text
Agent owner subscribes to your API ($9.99/month equivalent)
  Platform fee:   -$0.66 (6.6%)
  You receive:     ~$9.33/month, settled on-chain to your embedded wallet
```

This is not a contract or outsourcing arrangement. You earn revenue when real
users choose to install and subscribe to your API. Better APIs earn more.

Both free and subscription APIs are supported. Use `price_model="free"` for your
first API. Move to `price_model="subscription"` only after the first version is
working and the API is useful enough for owners to pay for monthly access.

## How to publish your API

1. Build your API using the SDK (`AppAdapter`).
2. Run `siglume test .` and `siglume score . --offline`.
3. Deploy the real API to a public URL.
4. Fill the local, Git-ignored `runtime_validation.json`.
5. Run `siglume validate .`, `siglume score . --remote`, and `siglume register . --confirm`.
6. Publish immediately when the self-serve checks pass.

There is no PR review process for API listings. You register directly on the
platform. See [GETTING_STARTED.md](GETTING_STARTED.md) for the full guide.

## What makes an API successful

The most important factor is the Tool Manual: the machine-readable description
that agents use to decide whether to call your API. If your Tool Manual is
vague, agents will not select your API even if the implementation works.

See [GETTING_STARTED.md Section 13](GETTING_STARTED.md#13-tool-manual-guide)
for how to write a Tool Manual that gets your API selected.

## Good first APIs

These ideas are intentionally free, read-only, and low-risk. They are good
choices for a first project or for a coding agent scaffold.

| Idea | Permission | Why it is beginner-friendly |
|---|---|---|
| FAQ Search | READ_ONLY | Search a small FAQ or markdown folder and return cited answers |
| Public Dataset Lookup | READ_ONLY | Query a CSV or JSON file, such as events, venues, or product specs |
| Recipe Finder | READ_ONLY | Recommend recipes from a static dataset based on ingredients |
| Glossary Helper | READ_ONLY | Explain terms from a niche glossary without external side effects |
| Mock Price Comparison | READ_ONLY | Start with sample data, then replace it with real retailer calls later |
| Public API Summary | READ_ONLY | Call a simple public API and summarize the response |

After one of these is published, upgrade to OAuth, posting, wallet actions, or
subscription pricing only when the API really needs it.

## Broader inspiration

These ideas are useful, but some are harder because they involve side effects,
OAuth, payments, or owner approval.

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

Your own idea is equally welcome. If an agent could benefit from it, it belongs
in the API Store.

## Honest expectations

Publishing an API does not guarantee revenue. Whether your API earns money
depends on whether agent owners choose to subscribe. In the initial period,
focus on building something genuinely useful rather than expecting immediate
income. A well-written Tool Manual and a real problem solved will attract users
over time.

## Resources

- [Getting Started Guide](GETTING_STARTED.md): build and publish in 15 minutes
- [Coding Agent Guide](docs/coding-agent-guide.md): instructions to give Codex or Claude Code
- [SDK Reference](siglume_api_sdk.py)
- [API Spec](openapi/developer-surface.yaml)
