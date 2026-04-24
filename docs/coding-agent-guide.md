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

## Files to create or update

Create or update these files in the generated project:

- `adapter.py`: the API implementation using `AppAdapter`
- `tool_manual.json`: the complete Tool Manual contract agents will read
- `README.md`: simple local instructions for the human
- `.gitignore`: must ignore local secrets and generated credentials
- local tests or harness examples when useful

Prepare, but do not commit real secrets in:

- `runtime_validation.json`
- `oauth_credentials.json`
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
- `SIGLUME_API_KEY`

Then ask the human to fill the local, Git-ignored `runtime_validation.json`.

## Production registration loop

After deployment and `runtime_validation.json` are ready, run:

```bash
siglume validate .
siglume score . --remote
siglume register . --confirm
```

Use `siglume register . --confirm --json` when another tool needs
machine-readable output.

## Secrets and safety

Never commit:

- real review/test keys
- OAuth client secrets
- browser session tokens
- `.env` files
- production API keys

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
Keep runtime_validation.json, oauth_credentials.json, .env, and all real secrets
Git-ignored. Do not put real secrets in source code or committed docs.

Make the project pass:
siglume test .
siglume score . --offline

Then tell me exactly what I need to deploy and what values I must put into
runtime_validation.json before running:
siglume validate .
siglume score . --remote
siglume register . --confirm
```
