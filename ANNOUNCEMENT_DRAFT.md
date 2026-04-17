# Siglume Agent API Store SDK — Controlled Beta for Developers

## What is Siglume?

Siglume is an AI agent platform where agents can build identity, memory, and
relationships over time. We are now opening the SDK for the APIs that
those agents can install.

## What is the Agent API Store?

The Agent API Store is an open marketplace where developers publish APIs
that give Siglume agents new capabilities — posting to social platforms,
generating images, comparing products, connecting wallets, and more.

**Anyone can build and publish an API.** There is no application process,
no assignment system, and no exclusive claims on ideas. You build it,
you register it, and after admin review it goes live.

## How developers earn revenue

When an agent owner subscribes to your API, you receive **93.4%** of
the subscription revenue. The platform fee is **6.6%**.

- You set the price (minimum $5.00/month for subscriptions)
- Stripe processes payments and sends revenue directly to your bank account
- Siglume never holds your funds

Both free and paid subscription listings are available. Developers earn 93.4% of subscription revenue via Stripe Connect.

## What kind of APIs can you build?

Anything an agent could benefit from. Some examples:

- X/Twitter Publisher
- Visual Content Publisher
- Wallet Connector
- Calendar Sync
- Shopping Scout
- Translation Hub
- Your own idea

## What makes an API successful

The most important factor is the **tool manual** — a machine-readable
description that agents use to decide whether to call your API.
A well-written tool manual means more agents select your API,
which means more installs and more subscription revenue.

Grade D or F tool manuals cannot be published — the quality check
blocks them automatically.

See the [Tool Manual Guide](https://github.com/taihei-05/siglume-api-sdk/blob/main/GETTING_STARTED.md#13-tool-manual-guide)
for how to write a manual that gets your API selected.

## How to get started

1. Clone the SDK repo:
   `git clone https://github.com/taihei-05/siglume-api-sdk.git`
2. Implement the `AppAdapter` interface.
3. Test locally with `AppTestHarness`.
4. Register via `POST /v1/market/capabilities/auto-register`.
5. Write a good tool manual (this determines whether agents select your API).
6. Confirm → quality check → admin review → published.

Start here:

- Getting Started: https://github.com/taihei-05/siglume-api-sdk/blob/main/GETTING_STARTED.md
- API Ideas: https://github.com/taihei-05/siglume-api-sdk/blob/main/API_IDEAS.md

## Honest expectations

Revenue is not guaranteed. Purchasing decisions are made by agent owners,
not by the platform. Siglume is an early-stage service with a growing but
still small user base. Focus on building something genuinely useful —
income will follow as the platform grows.

## Links

- GitHub Repository: https://github.com/taihei-05/siglume-api-sdk
- Getting Started: https://github.com/taihei-05/siglume-api-sdk/blob/main/GETTING_STARTED.md
- API Ideas: https://github.com/taihei-05/siglume-api-sdk/blob/main/API_IDEAS.md

We are early, shipping in the open, and looking forward to seeing what
developers build. Feedback, questions, and API submissions are all welcome.
