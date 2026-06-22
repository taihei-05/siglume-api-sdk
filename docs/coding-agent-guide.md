# Coding Agent Guide

Use this file when a human asks a coding agent to build a Siglume API Store
project. The goal is a small, publishable first API, not a complex platform
integration.

## Default beginner path

Start with a free, read-only API unless the human explicitly asks for something
else.

Good first API constraints:

- `price_model`: `free`
- `permission_class`: `read_only`
- no OAuth
- no wallet actions
- no posting, sending, deleting, purchasing, or other external side effects
- no production secrets in source code, prompts, examples, or committed docs

Avoid `ACTION`, `PAYMENT`, OAuth, and subscription pricing until the first API
passes the local loop and the human understands the publish flow.

## Existing product diagnosis mode

Use this mode when the human has an existing product repository and asks whether
it can be published as a Siglume Agent API Store listing.

The coding agent must read both:

- this SDK repository
- the existing product repository currently open in the workspace

The SDK repository alone is not enough to judge publishability.

First inspect the product:

- core features and the smallest useful API surface
- inputs, outputs, and error cases
- external services, quotas, and terms-of-service or resale constraints
- authentication and secret handling
- side effects such as posting, sending, deleting, purchasing, or changing data
- whether a first version can be free, read-only, and no-OAuth

Classify the result as exactly one of:

- publishable as-is
- publishable with small changes
- needs major changes
- not a good fit

Then explain the reason in plain language. If the product is a fit, design the
smallest Siglume version before implementing anything complex. Prefer a
read-only query, analysis, conversion, summary, lookup, validation, or preview
operation over write actions.

Do not run plain `siglume register .`, create production credentials, change
pricing, modify external production systems, or publish the listing unless the
human explicitly approves.

If the human explicitly asks for paid pricing, read
`docs/pricing-and-billing.md` and `docs/platform-api-boundary.md` first. Treat
the live choices as:

- free call: `price_model="free"`
- subscription: `price_model="subscription"`
- operation-based usage billing: `price_model="usage_based"` or
  `"per_action"` plus `pricing_plan.items`

For operation-based JPY/JPYC billing, free operations use `0` and paid
operations must be at least `15` minor units. Use `billing_timing="prepay"` for
irreversible side effects such as posting, sending, or other actions that must
not run before payment succeeds.

If the human asks for developer-funded reward or incentive payouts, read
`docs/web3-settlement.md` and `docs/webhooks.md` before implementing anything.
Do not assume `SIGLUME_API_KEY`, `cli_...`, `X-API-Key`, or
`X-Siglume-API-Key` can call MCP Gateway. Reward payout execution uses
`https://mcp.siglume.com/` with `Authorization: Bearer mcpsk_...` and
`tools/call market_create_reward_payout`. `SIGLUME_API_KEY` is still used for
Developer Surface work such as registration, validation, and listing
automation. Webhook subscription routes currently require an authenticated
Developer Portal/session context, not a CLI token. The `agent_id` is needed to
issue the MCP token for the target agent; it is not a reward-payout argument.

Keep the platform/API boundary strict. Siglume owns payment, authorization,
operation price lookup, platform idempotency, retry state, and reconciliation
state. The API owns external-provider behavior and the committed evidence that
the side effect happened. Do not implement provider-specific success logic in
platform-facing assumptions. A live action must not return draft-only,
preview-only, ambiguous, or `status="ready"` output as a delivered result; it
must return a stable provider id/URL or an explicit failure/no-op result.

## Files to create or update

Create or update these files in the generated project:

- `adapter.py`: the API implementation using `AppAdapter`
- `tool_manual.json`: the complete Tool Manual contract agents will read
- `README.md`: simple local instructions for the human
- `.gitignore`: must ignore local secrets and generated credentials
- local tests or harness examples when useful

Prepare, but do not commit real secrets in:

- `runtime_validation.json`
- `.env`

`runtime_validation.json` can contain placeholders during scaffolding. After
deployment, ask the human for the real public URLs and the runtime auth header
shared secret (`runtime_auth_header_name` / `runtime_auth_header_value`) — a
strong, dedicated value Siglume sends on every call to `invoke_url`, at both
registration validation and production runtime.

## Required local loop

Run this loop before asking the human for API keys or deployment details:

```bash
siglume test .
siglume score . --offline
```

If either command fails, fix the adapter or Tool Manual before continuing.

## Deployment handoff

After the local loop passes, tell the human exactly what is still needed:

- public base URL
- healthcheck URL
- invoke URL
- invoke method
- sample request payload
- expected response fields
- runtime auth header name (`runtime_auth_header_name`)
- runtime auth header value (`runtime_auth_header_value`) — a strong, dedicated shared secret, not your master API key

Then ask the human to fill the local, Git-ignored `runtime_validation.json`.
If production credentials are needed, ask the human to run the command locally
or provide a short-lived, project-scoped CLI token through their normal secret
manager. Do not ask the human to paste browser session tokens or production API
keys into the coding-agent chat.

## Production registration loop

After deployment and `runtime_validation.json` are ready, the coding agent may
run the non-publishing checks and create an immutable review draft:

```bash
siglume validate .
siglume score . --remote
siglume preflight .
siglume register . --draft-only
```

`siglume register . --draft-only` creates or refreshes the draft only. Stop
there and tell the human to inspect the CLI output or developer portal. Run
plain `siglume register .` only after the human explicitly approves immediate
publish. Use `--json` when another tool needs machine-readable output.

## Secrets and safety

Never commit:

- the real runtime auth header secret
- OAuth client secrets
- browser session tokens
- `.env` files
- production API keys

Do not paste browser session tokens or production API keys into a coding-agent
prompt. If a command needs credentials, the human should run it locally or use a
short-lived, limited-scope CLI token.

Before finishing, run:

```bash
git status --short
git status --ignored --short
```

Confirm that any files containing real secrets are ignored and untracked.

## Prompt template

The human can paste this into the coding agent:

```text
You are helping me build a Siglume Agent API Store project.

Read README.md, GETTING_STARTED.md, docs/coding-agent-guide.md,
docs/platform-api-boundary.md, docs/publish-flow.md, and examples/hello_echo.py.

My API idea is:
[describe the API in plain language]

Start as a FREE and READ_ONLY API unless I explicitly say otherwise.
Do not add OAuth, payment, wallet, posting, or write actions for the first
version.

Create adapter.py, tool_manual.json, README.md, and any useful local tests.
Keep runtime_validation.json, .env, and all real secrets
Git-ignored. Do not put real secrets in source code or committed docs.

Make the project pass:
siglume test .
siglume score . --offline

Then tell me exactly what I need to deploy and what values I must put into
runtime_validation.json before I run:
siglume validate .
siglume score . --remote
siglume preflight .
siglume register . --draft-only

Do not run plain siglume register . unless I explicitly approve immediate
publish.
```

## Existing product diagnosis prompt

The human can paste this into a coding agent with their product repository open:

```text
Diagnose whether the currently open product can be published as a Siglume Agent
API Store listing.

Siglume SDK:
https://github.com/taihei-05/siglume-api-sdk

Read the SDK README.md, GETTING_STARTED.md, docs/coding-agent-guide.md,
docs/platform-api-boundary.md, and docs/publish-flow.md.

Inspect this product's features, inputs, outputs, external dependencies,
authentication, side effects, and resale or terms-of-service risks.

Classify the product as one of:
- publishable as-is
- publishable with small changes
- needs major changes
- not a good fit

If it is a fit, design the smallest Siglume version. Start as FREE, READ_ONLY,
no OAuth, no payment, and no external side effects unless I explicitly approve
otherwise. Create or propose adapter.py or adapter.ts, tool_manual.json, a local
README, and useful local tests.

Aim to make this pass before asking for API keys or production credentials:
siglume test .
siglume score . --offline

Do not run plain siglume register ., change production systems, issue API keys,
set pricing, or publish anything unless I explicitly approve. End with the
human decisions still needed.
```
