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

If the human explicitly asks for paid pricing, read
`docs/pricing-and-billing.md` first. Treat the live choices as:

- free call: `price_model="free"`
- subscription: `price_model="subscription"`
- operation-based usage billing: `price_model="usage_based"` or
  `"per_action"` plus `pricing_plan.items`

For operation-based JPY/JPYC billing, free operations use `0` and paid
operations must be at least `15` minor units. Use `billing_timing="prepay"` for
irreversible side effects such as posting, sending, or other actions that must
not run before payment succeeds.

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
deployment, ask the human for the real public URLs and dedicated review/test
key.

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
- dedicated review/test auth header name
- dedicated review/test auth header value

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

- real review/test keys
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
docs/publish-flow.md, and examples/hello_echo.py.

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
