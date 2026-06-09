# Publish Flow

This document explains the current Siglume Agent API Store publish flow as of
2026-04-29.

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
- reviewing external OAuth `connect_url` metadata when required

Submitted listing content is read-only in the portal. To change a submitted
API, edit the source-side registration inputs and rerun `siglume register` /
`auto-register`. Use the same `capability_key` only for non-material updates.
Material contract changes require a new API with a new `capability_key`.

There is no normal human review step in the self-serve publish flow anymore.

## Recommended developer flow

1. Build and test your API locally.
2. Deploy the real API to a public internet URL.
3. Give your GitHub repository and deployment details to your CLI / coding
   engine.
4. The engine reads your source, docs, manifest hints, Tool Manual files, and
   runtime validation inputs.
5. Run the no-key local loop first:
   - `siglume test .`
   - `siglume score . --offline`
6. After deployment and `SIGLUME_API_KEY` setup, run CLI production preflight:
   - `siglume validate .`
   - `siglume score . --remote`
   - `siglume preflight .`
7. The engine calls `siglume register .` or `auto-register` to create or
   refresh the immutable submitted record.
8. Siglume runs runtime, contract, pricing, payout, external OAuth declaration, and
   mandatory LLM legal checks.
9. If the checks pass, `siglume register .` confirms and publishes the listing
    or non-material update immediately. Material contract changes to a live
    listing are blocked and must be submitted as a new API.
10. Use `siglume register . --draft-only` when a coding agent or developer
    intentionally needs an immutable draft for explicit human review.
11. The draft can then be published by rerunning plain `siglume register .` or
    calling `confirm-auto-register`.
12. After live or sandbox execution, use `siglume dev tail` or
    `siglume dev tail --listing-id <listing_id>` to inspect execution receipts
    and support identifiers. See [Developer Observability](developer-observability.md).

## What auto-register does

1. Accepts registration provenance:
   - `source_code`
   - or `source_url`
   - and optional `source_context` such as GitHub repo, ref, and file paths
2. Accepts explicit registration contract inputs:
   - manifest fields
   - Tool Manual
   - external OAuth declaration with `managed_by: "api"` and `connect_url` when required
   - optional `input_form_spec` ([authoring guide](input-form-spec.md))
3. Runs contract, pricing, payout, external OAuth declaration, and runtime validation preflight checks.

   The **Tool Manual quality scorer** (grade A–F, minimum B to publish) used at this step is also published as open source — see [`siglume-agent-core.tool_manual_validator`](https://github.com/taihei-05/siglume-agent-core#1-tool_manual_validator-v01). The same scoring code runs in this preflight check and locally; you can predict your grade before `auto-register` ever runs.
4. Runs a mandatory fail-closed LLM legal review on the submitted package.
5. Verifies the public API is reachable from the internet.
6. Sends a functional test request using your runtime auth header shared secret.
7. Verifies the runtime sample request / response against the declared
   `input_schema` and `output_schema`.
 8. Checks connected-account requirements, paid pricing rules, operation
    pricing plans, and billing timing.
9. Persists a private draft only if those checks pass. The CLI then confirms it
   by default unless `--draft-only` was requested.
10. On confirmation, reruns the LLM legal review against the immutable stored
    draft package. If the final stored package fails or the LLM does not return
    a valid decision, publish is blocked.

## Same-key updates and material changes

After an API is live, the same `capability_key` can only be used for
non-material updates such as buyer-facing copy, docs/support links, example
prompts, compatibility tags, translation refreshes, or runtime endpoint repair
that does not change the contract.

The following live-listing changes are material and are rejected with
`MATERIAL_CONTRACT_CHANGE_REQUIRES_NEW_API`:

- `price_model`
- `price_value_minor`
- `pricing_plan`
- `currency`
- `price_value_minor_jpy`
- `dual_currency`
- `permission_class`
- `approval_mode`
- `dry_run_supported`
- `required_connected_accounts`
- `permission_scopes`
- `jurisdiction`

When a material term changes, create a new API listing with a new
`capability_key`. Siglume does not silently migrate existing buyers or grants to
new commercial or authorization terms.

One exception is allowed: an existing operation-priced listing may move from
the default `billing_timing="post"` to `billing_timing="prepay"` in place. That
change makes irreversible actions safer because payment is confirmed before the
live side effect. Other billing timing changes may still be treated as material.

## The mandatory LLM legal review

The legal check is not a simple keyword blocklist. During `auto-register`,
Siglume asks the LLM to decide whether the API is publishable in the declared
jurisdiction. During `confirm-auto-register`, Siglume repeats that LLM legal
review against the stored package that will actually be published. Confirmation
does not accept content overrides; to change buyer-facing copy, Tool Manual,
or tags, rerun `auto-register` and confirm the new reviewed draft. To change
pricing, permission class, permission scopes, jurisdiction, connected-account
requirements, or another material contract term on a live listing, register a
new API with a new `capability_key`.

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

SDK / HTTP automation can pass `source_url`, `source_context`, and
`input_form_spec` directly to `auto-register`, but the current CLI project
loader does not read those values from sidecar files.

Before draft creation, `siglume register` runs:

- local manifest validation
- remote Tool Manual quality preview

`siglume preflight` runs the same checks without creating a draft. Use it when
you want to catch `docs_url`, runtime validation, external OAuth declaration, payout, and
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
  - runtime auth header shared secret (`runtime_auth_header_name` / `runtime_auth_header_value`)
  - sample request payload in `request_payload`
  - expected response fields
- For OAuth-backed APIs:
  - declare the provider in `required_connected_accounts` with `managed_by: "api", connect_url: "https://api.example.com/oauth/start"`
  - implement authorization, token storage, refresh, revocation, and user-to-token mapping in the publisher API
  - a live API cannot add provider requirements through a same-key update; use
    a new `capability_key` for that material contract change
- Plain provider strings such as `"slack"` mean the API manages that auth path itself.
- Listing metadata such as:
  - `name`
  - `short_description` — buyer-facing catalog tagline, max 60 characters.
  - `job_to_be_done` — what the buyer can accomplish with this API, max 240
    characters.
  - optional `description` — detail-page copy for limits, approval behavior,
    pricing notes, and expected results, max 1000 characters. Put longer usage
    guidance in `docs_url`.
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
  - optional `compatibility_tags`. For game APIs, include explicit game
    placement tags such as `game`, `unity`, `unreal`, `godot`, `npc`,
    `matchmaking`, `multiplayer`, `realtime`, `ugc`, or `narrative`. These
    tags are the public SDK path for eligibility in the dedicated Game API
    Store entry point; do not send arbitrary `metadata` for placement.
  - optional `persistence`. For game APIs that save progress,
    `persistence.save_data_schema` is required when `persistence.mode` is
    `local`, `platform`, or `developer_server`. Normal API listings and games
    with `persistence.mode="none"` do not need a save schema.
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
  - if your API accepts files from external MCP agents, declare each file input
    as a Siglume handle in `input_schema` (`"$ref": "#/$defs/handle"` or
    `"format": "siglume-handle"`). The MCP Gateway brokers caller-supplied
    `filename`, `mime_type`, and `content_base64` to your API as an inline
    handle for that call only. Siglume does not store, host, scan, or classify
    the file; MIME trust and content safety remain the publisher API's
    responsibility.
- Optional UI contract layer:
  - `input_form_spec` can be seeded during `auto-register`
  - confirmation does not edit the submitted UI contract
- For paid APIs: minimum price and an active embedded Polygon wallet before publish
- For `usage_based` / `per_action` APIs:
  - the capability is free to invoke up front and must declare the actual charge
    in `ExecutionResult.units_consumed`, `amount_minor`, `currency`, and
    `receipt_summary`
  - use `pricing_plan` to expose buyer-facing operation prices in API Store and
    Game API Store
  - `0` is valid for free operations; positive JPY/JPYC operation prices must
    be at least `15` minor units
  - use `billing_timing="prepay"` for irreversible actions that must not run
    before payment succeeds
  - keep the platform/API responsibility boundary strict: Siglume owns payment,
    platform idempotency, retry, and reconciliation state; your API owns the
    provider-specific side effect and committed evidence. See
    [`platform-api-boundary.md`](./platform-api-boundary.md).
- For paid APIs, `AppManifest.allow_free_trial` must be explicitly set to
  `true` or `false`. When true, Plus/Pro buyers can start one lifetime trial
  per listing, subject to their monthly trial quota; `free_trial_duration_days`
  defaults to 30 and must be between 1 and 90.

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
   - deployment endpoints and runtime auth header secret settings
   - external OAuth `connect_url` metadata when the API requires it
3. It generates the registration payload.
4. If only one language is present in the buyer-facing listing text
   (`job_to_be_done`, `short_description`, or long-form `description`), Siglume
   fills the missing Japanese or English text with LLM translation during
   auto-register. Applicants do not need to provide both languages for every
   field. Registration payloads must not include `i18n` or arbitrary
   `metadata`; the stored `metadata.i18n` block is generated by the platform.
5. It calls `auto-register` with:
   - `source_url`
   - optional `source_context`
   - `manifest`
   - `tool_manual`
   - `runtime_validation`
   - external OAuth `connect_url` metadata when required
   - optional `input_form_spec`
6. `siglume register .` confirms and publishes by default when immediate
   publish is approved.
7. Use `siglume register . --draft-only` when you need an immutable draft for
   portal review before publishing.

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
Keep runtime_validation.json local and Git-ignored; store external-provider secrets in the publisher API secret store.

First make this pass:
siglume test .
siglume score . --offline

After deployment, tell me exactly what values to put in runtime_validation.json,
then show the API-key production loop:
siglume validate .
siglume score . --remote
siglume preflight .
siglume register . --draft-only

Do not run plain siglume register . unless I explicitly approve immediate
publish.
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

`SIGLUME_API_KEY` is also **not** an MCP Gateway token.

- `SIGLUME_API_KEY` / `cli_...` is for SDK, CLI, and Developer Surface
  automation such as registration, validation, and webhook subscription
  management.
- MCP Gateway calls such as `initialize`, `tools/list`, and
  `tools/call market_create_reward_payout` require
  `Authorization: Bearer mcpsk_...` or an OAuth-issued `mcpoa_...` token.
- `X-API-Key`, `X-Siglume-API-Key`, and `cli_...` bearer tokens are rejected by
  `https://mcp.siglume.com/`.
- An `mcpsk_...` token is issued for a specific agent from the Developer
  Portal MCP key flow. The `agent_id` is needed at token issuance time, not as
  a `market_create_reward_payout` argument.

## What the portal is for now

Use the portal to:

- review draft results and validation outcomes
- inspect publish blockers
- confirm the draft and verify live status
- confirm embedded-wallet payout-token readiness
- inspect external OAuth `connect_url` metadata when required
- issue, delete, or rotate CLI tokens when needed
