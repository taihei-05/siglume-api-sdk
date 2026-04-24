# Publish Flow

This document explains the current Siglume Agent API Store publish flow as of
2026-04-23.

## The short answer

There is **one supported public registration execution method**:

- `POST /v1/market/capabilities/auto-register`

That execution method is used by:

- `siglume register`
- `SiglumeClient.auto_register(...)`
- CI / scripted automation
- coding engines that read your GitHub repository and assemble the publish payload

The browser portal does **not** run registration directly. The portal is for:

- reviewing the immutable draft result
- inspecting blockers and live status
- confirming embedded-wallet payout-token readiness
- confirming the draft for immediate publish
- rotating or repairing seller OAuth app credentials after registration

Submitted listing content is read-only in the portal. To change a submitted
API, edit the source-side registration inputs and rerun `siglume register` /
`auto-register` with the same `capability_key`.

There is no normal human review step in the self-serve publish flow anymore.

## Recommended developer flow

1. Build and test your API locally.
2. Deploy the real API to a public internet URL.
3. Give your GitHub repository and deployment details to your CLI / coding
   engine.
4. The engine reads your source, docs, manifest hints, Tool Manual files, and
   runtime validation inputs.
5. If the API uses seller-side OAuth, the engine also includes the local,
   Git-ignored `oauth_credentials.json`.
6. Run the no-key local loop first:
   - `siglume test .`
   - `siglume score . --offline`
7. After deployment and `SIGLUME_API_KEY` setup, run CLI production preflight:
   - `siglume validate .`
   - `siglume score . --remote`
   - `siglume preflight .`
8. The engine calls `siglume register .` or `auto-register` to create or
   refresh the immutable draft.
9. Siglume runs runtime, contract, pricing, payout, seller OAuth, and
   mandatory LLM legal checks.
10. If the checks pass, Siglume creates a private draft listing or stages an
   upgrade for the existing live listing.
11. The developer opens the portal confirmation page to inspect the immutable
    result.
12. The developer confirms the draft with `siglume register . --confirm` or
    `confirm-auto-register` only after explicit human review.
13. Siglume publishes the listing immediately when the final checks still pass.

## What auto-register does

1. Accepts registration provenance:
   - `source_code`
   - or `source_url`
   - and optional `source_context` such as GitHub repo, ref, and file paths
2. Accepts explicit registration contract inputs:
   - manifest fields
   - optional bilingual `i18n`
   - Tool Manual
   - optional seller OAuth app credentials in `oauth_credentials`
   - optional `input_form_spec`
3. Runs contract, pricing, payout, seller OAuth, and runtime validation preflight checks.
4. Runs a mandatory fail-closed LLM legal review on the submitted package.
5. Verifies the public API is reachable from the internet.
6. Sends a functional test request using your dedicated review/test key.
7. Verifies the runtime sample request / response against the declared
   `input_schema` and `output_schema`.
8. Checks connected-account requirements and paid pricing rules.
9. Persists a private draft only if those checks pass.
10. On confirmation, reruns the LLM legal review against the final package
    after any confirm-time overrides. If the final package fails or the LLM
    does not return a valid decision, publish is blocked.

## The mandatory LLM legal review

The legal check is not a simple keyword blocklist. During `auto-register`,
Siglume asks the LLM to decide whether the API is publishable in the declared
jurisdiction. During `confirm-auto-register`, Siglume repeats that LLM legal
review against the final package that will actually be published, including
confirm-time overrides.

The review must explicitly pass:

- applicable-law compliance in the declared country
- public-order / morals compliance

This review is **fail-closed**:

- if the LLM rejects, publish is blocked
- if the LLM is unavailable, publish is blocked
- if the LLM returns an invalid or incomplete answer, publish is blocked

## What `siglume register` reads from your repo

By default, the CLI expects:

- `adapter.py` or another single `AppAdapter` file
- `tool_manual.json`
- local, Git-ignored `runtime_validation.json`

It also uses these when present:

- local, Git-ignored `oauth_credentials.json` for seller-side OAuth app credentials

SDK / HTTP automation can pass `source_url`, `source_context`, and
`input_form_spec` directly to `auto-register`, but the current CLI project
loader does not read those values from sidecar files.

Before draft creation, `siglume register` runs:

- local manifest validation
- remote Tool Manual quality preview

`siglume preflight` runs the same checks without creating a draft. Use it when
you want to catch `docs_url`, runtime validation, seller OAuth, payout, and
Tool Manual blockers before `auto-register`.

The CLI intentionally does not expose a bypass flag for these checks. Fix
preflight errors before calling `auto-register`.

## What is required today

- A Siglume account
- A unique `capability_key`
- A real public API that is already deployed
- Runtime validation inputs:
  - `public_base_url`
  - `healthcheck_url` (Siglume calls this with `GET`)
  - `invoke_url` (Siglume calls this with `invoke_method`, default `POST`)
  - dedicated review/test auth header name + value
  - sample request payload in `request_payload`
  - expected response fields
- For OAuth-backed APIs that use seller-owned OAuth apps:
  - declare the provider in `required_connected_accounts`
  - include the seller OAuth app credentials in the local Git-ignored `oauth_credentials.json`
  - upgrades that add a new provider are blocked until the new seed is included
- Listing metadata such as:
  - `name`
  - `job_to_be_done`
  - `short_description`
  - `category`
  - `docs_url` — a public API usage guide for this listing. It must explain
    what the API does, required inputs, connected-account requirements, limits,
    and expected results. It is not a seller homepage and is not inferred from
    `source_url`.
  - `support_contact` — a real support email address or public support URL.
    Placeholder contacts such as `support@example.com` are rejected.
  - `jurisdiction`
  - optional `seller_homepage_url` / `seller_social_url` for the seller's
    official website or SNS profile. These are separate from `docs_url`.
- A Tool Manual / agent contract that scores **A** or **B**
  - canonical schema: `schemas/tool-manual.schema.json`
  - required core fields include `input_schema`, `output_schema`,
    `trigger_conditions`, `do_not_use_when`, `usage_hints`,
    `result_hints`, and `error_hints`
  - callers must send the final `tool_manual` object during `auto-register`
- Contract consistency checks:
  - the runtime sample request must satisfy `input_schema`
  - the live response must satisfy `output_schema`
  - runtime-checked response fields must be declared in `output_schema`
  - `requires_connected_accounts` must match between listing data and the Tool Manual
- Optional UI contract layer:
  - `input_form_spec` can be seeded during `auto-register`
  - confirmation does not edit the submitted UI contract
- For paid APIs: minimum price and an active embedded Polygon wallet before publish

`request_payload` is the canonical runtime sample field. The server accepts
`test_request_body`, `runtime_sample`, `sample_request_payload`, and
`runtime_sample_request` as compatibility aliases, but new SDK examples should
use `request_payload`.

Before registering a paid subscription API, call:

```bash
curl https://siglume.com/v1/market/developer/portal \
  -H "Authorization: Bearer $SIGLUME_API_KEY"
```

`data.payout_readiness.verified_destination` must be true, or auto-register
blocks with `store.payout_destination`. If it is false, open
`/owner/credits/payout` and confirm the embedded-wallet payout token. External
payout wallets cannot be specified.

## GitHub / engine-first mode

The intended advanced flow is:

1. Codex or another engine reads your GitHub repo.
2. It gathers:
   - source files
   - docs
   - manifest hints
   - Tool Manual files
   - deployment endpoints and review/test key settings
   - seller OAuth app credentials when the API requires them
3. It generates the registration payload.
4. If only one language is present in the listing text, Siglume fills the
   missing Japanese or English fields with LLM translation during
   auto-register.
5. It calls `auto-register` with:
   - `source_url`
   - optional `source_context`
   - `manifest`
   - `tool_manual`
   - `runtime_validation`
   - optional `oauth_credentials`
   - optional `input_form_spec`
6. You review the immutable draft in the portal.
7. You confirm the draft and publish immediately if the final checks pass.

This is the recommended path for AI-assisted registration because it avoids
manual browser form entry and keeps the registration contract close to the
source repository.

Recommended prompt for a coding engine:

```text
Read this repository, especially README.md, GETTING_STARTED.md,
docs/coding-agent-guide.md, and docs/publish-flow.md.

Use the API idea and external API docs I provide. Build a Siglume API that
follows the documented CLI-first flow.

For the first version, start as FREE and READ_ONLY unless I explicitly say
otherwise. Do not add OAuth, payment, wallet, posting, or write actions unless I
explicitly request them.

Create adapter.py, tool_manual.json, a local README, and useful local tests.
Keep runtime_validation.json and oauth_credentials.json local and Git-ignored.

First make this pass:
siglume test .
siglume score . --offline

After deployment, tell me exactly what values to put in runtime_validation.json,
then show the API-key production loop:
siglume validate .
siglume score . --remote
siglume preflight .
siglume register .

Do not run siglume register . --confirm unless I explicitly approve the draft
for immediate publish.
```

## Where the schema lives

The schema is already defined in GitHub and on the server:

- `schemas/tool-manual.schema.json` is the canonical Tool Manual schema
- `openapi/developer-surface.yaml` exposes:
  - `POST /v1/market/capabilities/auto-register`
  - `POST /v1/market/capabilities/{listing_id}/confirm-auto-register`
  - `POST /v1/market/tool-manuals/preview-quality`
- the server validator enforces `input_schema`, `output_schema`, and optional
  `input_form_spec`

## source_url support

`source_url` is now valid as the provenance input for GitHub-driven
registrations.

- If you also send `manifest`, `tool_manual`, and `runtime_validation`, the
  platform can create the draft without uploaded source code.
- If you provide `source_code`, the platform can still perform heuristic source
  analysis on top of your explicit inputs.

## Why `SIGLUME_API_KEY` exists

`SIGLUME_API_KEY` and `~/.siglume/credentials.toml` exist for the
CLI / SDK / automation route.

Use them when you want to:

- run `siglume register` from your terminal
- call the SDK from your own scripts
- automate registration from CI or another service
- let an AI agent run the same registration flow without a browser
- issue a dedicated CLI token from `/owner/publish/advanced`
- delete or rotate a leaked CLI token from the same page

In the SDK and CLI today, this value is sent as a bearer token in the
`Authorization` header.

## What `SIGLUME_API_KEY` is not

`SIGLUME_API_KEY` is **not** the same as `X-Ingest-Key`.

- `SIGLUME_API_KEY` authenticates the API Store registration flow
- `X-Ingest-Key` authenticates `/v1/ingest/*` source-ingest endpoints
- do not use `X-Ingest-Key` for `auto-register`

## What the portal is for now

Use the portal to:

- review draft results and validation outcomes
- inspect publish blockers
- confirm the draft and verify live status
- confirm embedded-wallet payout-token readiness
- rotate or repair seller OAuth app credentials after registration
- issue, delete, or rotate CLI tokens when needed
