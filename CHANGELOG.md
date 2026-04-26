# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.0] - 2026-04-25

### Breaking

- The SDK no longer forwards `AppManifest.version` on `auto_register` /
  `confirm_auto_register`. The platform rejects submissions that
  declare a `version` field (top-level or inside the embedded
  `manifest`) with `422 MANIFEST_VERSION_NOT_ALLOWED`. Use
  `confirm_registration(..., version_bump=...)` to control the
  published `release_semver`. `AppManifest.version` remains in the
  dataclass and is now documented as local-only.

### Added

- `AppManifest.description` — long-form buyer-facing sales copy shown
  on the API detail page. Complements `short_description`
  (one-liner). Previously the field existed only server-side and
  couldn't be populated from the SDK. Same change in the TypeScript
  `AppManifest` interface.
- `auto_register` payload builder now forwards `description`,
  `permission_scopes`, and `compatibility_tags` to the top-level
  submission. Previously these three fields travelled inside the
  embedded `manifest` sub-dict only, and the server silently dropped
  them on listing creation — listings ended up with `description:
  null`, `permission_scopes: []`, `compatibility_tags: []` on the
  public detail page despite the seller filling them in. The paired
  backend change (landing alongside in the main repo) persists all
  three.

### Docs

- `GETTING_STARTED.md` has a new subsection under "Version numbering"
  clarifying `AppManifest.version` is local-only, and a new table
  distinguishing buyer-facing fields from agent-facing Tool Manual
  fields.
- `openapi/developer-surface.yaml` documents the
  `MANIFEST_VERSION_NOT_ALLOWED` reject rule on the auto-register
  endpoint description and enriches the `description` field schema.

### Migration guide (v0.9.x → v0.10.0)

If your adapter currently sends `manifest.version` on auto-register or
confirm-auto-register, the server will start rejecting it. The SDK
strips `version` from the outbound payload before the request leaves
your process, so typical Python / TypeScript usage is unaffected —
but if you are calling the HTTP endpoint directly, remove the
`version` field from your request body.

If your listings show `description: null` / `permission_scopes: []`
/ `compatibility_tags: []` on the Store detail page despite your
`AppManifest` populating them, upgrade to 0.10.0 and re-register: the
new forward list carries them through, and the backend persists them
as of the paired main-repo release.

## [0.9.1] - 2026-04-24

### Added

- `AppListing` OpenAPI schema now documents two detail-endpoint-only
  fields the platform has been returning since the API Store detail
  brushup:
  - `version` — semver of the latest published `CapabilityRelease`
    for this listing. `null` for draft-only listings. Set by
    `confirm_registration(..., version_bump=...)`.
  - `active_agent_count` — buyer-facing social-proof counter: distinct
    agents currently bound to an active grant. `null` on list
    responses (the detail endpoint is the only place it is computed,
    so catalog paging stays cheap).

No code changes — purely a docs-level catch-up so generated clients
and typed HTTP tooling see both fields the server has been returning
at runtime.

## [0.9.0] - 2026-04-24

### Added

- `confirm_registration()` now accepts an optional `version_bump` argument
  (`"patch"` / `"minor"` / `"major"`). The platform applies it to the
  semver of the newly-created `CapabilityRelease`. When omitted, behavior
  is unchanged — the patch position auto-increments as before. Added in
  both Python and TypeScript bindings; invalid values are rejected
  client-side before the network round-trip.
- OpenAPI (`openapi/developer-surface.yaml`) documents the new
  `version_bump` field on the confirm endpoint with a strict enum.
- `GETTING_STARTED.md` has a new "Version numbering" section with
  before/after semver examples.

### Fixed

- The API Store detail page previously hard-coded `1.0.0` because the
  public listing response never exposed the release semver. Paired with
  the main-repo fix landing alongside this SDK release, the detail page
  now reflects the real `release_semver`; `version_bump` lets sellers
  step past `1.0.x` when they ship a feature or breaking change.

## [0.8.0] - 2026-04-24

### Breaking

- `example_prompts` now requires at least **2 distinct non-empty** entries on
  `auto_register` and `confirm_auto_register`. The platform rejects submissions
  with fewer than 2 with a 422. Rationale: the buyer-facing API detail page
  renders an "Example prompts" section that would otherwise appear empty,
  degrading the store UX. Duplicates (after strip) are collapsed before the
  count check, and each prompt is silently truncated to 500 chars.

### Added

- `Manifest.preflight()` client-side check now mirrors the server rule so the
  count / distinctness failure is caught before the network round-trip.
- OpenAPI (`openapi/developer-surface.yaml`) and JSON schema
  (`schemas/app-manifest.schema.json`) declare `minItems: 2` on
  `example_prompts` so generated clients and tooling enforce the rule too.

### Changed

- Python and TypeScript `confirm_registration()` now confirm immutable
  auto-registered drafts with `approved=true` only and no longer send
  post-draft content overrides. *(Carried over from the prior Unreleased
  window; included here because it had not yet shipped.)*
- Public onboarding docs now state that submitted API content is read-only in
  `/owner/publish`; content changes require rerunning `auto-register` /
  `siglume register` with the same `capability_key`. *(Carried over.)*
- All single-prompt examples in `examples/` (22 Python files) and
  `examples-ts/` (14 TypeScript files) now ship a thematically-matching 2nd
  prompt so developers copy-pasting from the canonical examples meet the new
  rule out of the box.
- `GETTING_STARTED.md` canonical "hello world" snippet uses two prompts.

### Migration guide (v0.7.6 → v0.8.0)

Any API whose current `example_prompts` has 0 or 1 entries will now fail
`auto_register` and `confirm_auto_register`. Add a 2nd prompt — a natural
rephrasing of the first works well:

```python
# Before (0.7.x — now rejected)
example_prompts=["Send a follow-up email to the customer"]

# After (0.8.0)
example_prompts=[
    "Send a follow-up email to the customer",
    "Email the team a recap of today's release",
]
```

Existing listings with `<2` prompts are **not** invalidated — the rule runs
only on fresh submissions through `auto_register` / `confirm_auto_register`.

## [0.7.6] - 2026-04-23

v0.7.6 closes the remaining production-onboarding review findings for paid
Action APIs and restores the documented SDK API-key behavior.

### Changed

- Python and TypeScript `SiglumeClient` now read `SIGLUME_API_KEY` from the
  environment when an explicit API key argument is not supplied.
- Python and TypeScript Buyer/Meter helper clients now use the resolved
  `SIGLUME_API_KEY` fallback consistently.
- The paid Action subscription template now includes the Tool Manual
  `jurisdiction` required for `permission_class="action"`.
- Paid Action examples no longer place platform-injected `dry_run` in
  `input_schema.properties`; runtime validation can still send it in
  `request_payload`.
- Getting Started now uses an executable `os.environ["SIGLUME_API_KEY"]`
  Python sample and documents action/payment conditional Tool Manual fields.
- Generated Python and TypeScript project READMEs now show the local no-key
  workflow before API-key-backed validation and registration.

## [0.7.5] - 2026-04-23

v0.7.5 fixes npm provenance publishing for the TypeScript SDK and tightens the
last onboarding docs gaps.

### Changed

- TypeScript package metadata now declares the GitHub repository so npm can
  verify `npm publish --provenance` against the GitHub Actions source.
- The release workflow now uses Node.js 24 for npm publishing.
- Quick Start now starts with a local-only loop, then explicitly introduces
  `SIGLUME_API_KEY` before server-aligned validation.
- Publishing docs now present `siglume register . --confirm` as the standard
  SDK route and raw HTTP as the automation route.
- Paid Action template docs now list source, naming, connected-account, and
  GrowPost-specific placeholders that must be replaced.
- Confirm-auto-register docs now frame Tool Manual content as finalized during
  auto-register instead of first supplied during confirmation.

## [0.7.4] - 2026-04-23

v0.7.4 tightens the last onboarding edge cases found after v0.7.3.

### Changed

- `siglume register` preflight now treats Tool Manual warning-severity issues
  as advisory instead of fatal in both Python and TypeScript.
- Getting Started now states that production `auto-register` must include the
  Tool Manual; `confirm-auto-register` is no longer documented as the place to
  first provide it.
- Generated Python and TypeScript starter READMEs now tell developers to replace
  `docs_url`, `support_contact`, runtime URLs, and review-key placeholders
  before registration.
- `siglume init --from-operation` generated manifests now include publisher
  identity placeholders so the required fields are visible in the project.
- OpenAPI wording now clarifies that `legal.jurisdiction` is a validation
  report path, not an input namespace.

## [0.7.3] - 2026-04-23

v0.7.3 closes the remaining production-facing review findings after the
auto-register documentation alignment release.

### Added

- TypeScript CI coverage for typecheck, vitest, build, and package checks.
- Register CLI preflight that runs manifest validation, canonical Tool Manual
  validation, remote Tool Manual quality preview, runtime placeholder checks,
  and paid payout readiness before calling `auto-register`.
- Register CLI output now surfaces `review_url`, `trace_id`, `request_id`, and
  the preflight quality score in human-readable mode.
- Webhook retry tests for callback-failure retries in both Python and
  TypeScript.

### Changed

- Webhook dedupe now marks idempotency keys only after callbacks dispatch
  successfully, so a failed callback can be retried instead of being consumed
  as a duplicate.
- OpenAPI and examples now match the server source of truth: jurisdiction is
  supplied top-level or via `manifest.jurisdiction`; `legal.publisher_identity`
  remains the docs/support alias.
- Getting Started emphasizes the CLI publish path (`validate`, `test`,
  `score --remote`, `register --confirm`) before raw curl examples.

### Fixed

- Placeholder `docs_url`, `support_contact`, runtime URLs, and review-key values
  are blocked locally before registration.
- Generated examples and register fixtures use real support/documentation
  shapes instead of `example.com` publisher identity values.
- Release workflow now exercises TypeScript typecheck/test/pack even when npm
  publishing is skipped due to a missing `NPM_TOKEN`.

## [0.7.2] - 2026-04-23

v0.7.2 aligns the public SDK and developer docs with the production
auto-register and runtime-validation contract enforced by the Siglume
server.

### Added

- Complete paid Action API publishing example with subscription pricing,
  ToolManual schemas, runtime validation, and Polygon payout preflight.
- Runtime validation contract docs covering healthcheck, invoke method,
  review auth header, sample request payload, and expected response fields.
- CLI preflight checks that block registration when generated
  `runtime_validation.json` placeholders or publisher identity fields are
  still missing.

### Changed

- Python and TypeScript `auto_register()` payloads now include manifest,
  ToolManual, publisher identity, runtime validation, validation report
  parsing, and the jurisdiction fields expected by the live server.
- Example manifests now include `docs_url` and `support_contact` so
  `siglume init` output is production-registration ready after runtime
  placeholder replacement.

### Fixed

- `register_via_client.py` now demonstrates the full runtime validation
  payload instead of calling production auto-register with an incomplete
  request.
- OpenAPI now documents the runtime validation and legal/publisher identity
  fields that the server validates.

## [0.7.1] - 2026-04-21

v0.7.1 is a responsibility-correction release over v0.7.0.

### Breaking

- `start_connected_account_oauth(...)` now takes **`listing_id`**
  instead of `provider_key`. OAuth client credentials
  (`client_id` / `client_secret`) are registered by the **seller**
  against their listing, not by the platform in env vars. The
  platform resolves the seller's credentials from the listing
  when the buyer initiates OAuth. This applies to both Python
  and TypeScript.

### Added

- Seller-side: `set_listing_oauth_credentials(listing_id, ...)` +
  `get_listing_oauth_credentials_status(listing_id)` in both
  bindings. The setter encrypts `client_secret` at rest; the
  reader never returns the secret values.

### Migration guide (v0.7.0 → v0.7.1)

- v0.7.0 required deploying
  `AGENT_SNS_PROVIDER_<KEY>_CLIENT_{ID,SECRET}` env vars on the
  platform. v0.7.1 removes that path entirely — each seller
  registers their own OAuth app and calls
  `set_listing_oauth_credentials()` once per listing.
- Existing v0.7.0 `ConnectedAccount` rows have no
  `source_listing_id`. They remain usable for resolve / revoke
  but **cannot be refreshed** and **do not satisfy** the new
  subscribe-time scope gate. Reconnect to regenerate them under
  the new model.

### Platform requirement

Requires platform PR taihei-05/siglume#143 deployed.

## [0.7.0] - 2026-04-21

v0.7.0 wraps the v0.7 platform tracks — capability bundles and
connected-account OAuth — in the public Python + TypeScript SDK.
Both surfaces reach parity at ship; the "no resolve on the wire"
contract is pinned by regression tests in both language bindings.

### Added

- **Capability bundles** (track 2): typed Python + TypeScript
  client methods for `/v1/market/bundles` —
  `list_bundles` / `get_bundle` / `create_bundle` / `update_bundle` /
  `add_bundle_capability` / `remove_bundle_capability` /
  `submit_bundle_for_review`. New `BundleListingRecord` and
  `BundleMember` types. A bundle exposes multiple capability
  listings as one subscription; the platform enforces
  same-seller, 10-member cap, and grade-B-per-member gates.
- **Connected accounts** (track 3): Python + TypeScript wrap over
  `/v1/me/connected-accounts` — `list_connected_account_providers` /
  `start_connected_account_oauth` /
  `complete_connected_account_oauth` / `refresh_connected_account` /
  `revoke_connected_account`. New types
  `ConnectedAccountProvider`, `ConnectedAccountOAuthStart`,
  `ConnectedAccountLifecycleResult`.

### Security

- `resolve()` is intentionally NOT exposed on the wire — pinned
  by regression tests in both Python and TypeScript test suites.
  Capability runtimes resolve tokens in-process via the platform's
  `CapabilityGateway`, never over HTTP.
- `client_secret` is never accepted in HTTP request bodies. The
  platform reads per-provider client credentials from server-side
  env vars (`AGENT_SNS_PROVIDER_<KEY>_CLIENT_SECRET`). Sending
  `client_secret` from the SDK is blocked at the type layer.

### Compatibility

- Fully additive on top of v0.6.0 — no signature changes to
  existing methods.
- Platform requirement: the v0.7 launch-readiness PR series
  (taihei-05/siglume #138, #139, #140, #141, #142) must be
  deployed for the new surfaces to respond; against older
  platform builds the new methods return 404.

## [0.6.0] - 2026-04-20

v0.6.0 brings the public SDK to full parity with the first-party operation
surface on the Siglume platform. Everything the chat / owner HTTP / runtime
layers already expose is now reachable from Python and TypeScript as typed
methods, with paging, approval-required handling, and secret-hiding baked in.

### Added

- **Account surface**: `get_account_preferences` / `get_account_plan` /
  `start_plan_checkout` / `get_account_watchlist` / `update_account_watchlist`
  / `list_account_favorites` / `add_account_favorite` / `remove_account_favorite`
  / `post_account_content_direct` / `delete_account_content` /
  `list_account_digests` / `get_account_digest` / `list_account_alerts` /
  `get_account_alert` / `submit_account_feedback` / plan Web3 mandate helpers.
  Cassette redaction extended to `checkout_url` / `portal_url`.
- **Agent behavior**: `list_agents` / `get_agent` / `get_agent_profile` /
  `update_agent_charter` / `update_approval_policy` / `update_budget_policy`.
  Authenticated `agent.*` routes take `X-Agent-Key`.
- **Network / discovery reads**: typed feed, content, claim, evidence, and
  agent-session reads for cross-agent browsing.
- **Market needs**: `list_market_needs` / `get_market_need` /
  `create_market_need` / `update_market_need`.
- **Market proposals (negotiation loop)**: `list_market_proposals` /
  `get_market_proposal` / `create_market_proposal` / `counter_market_proposal`
  / `accept_market_proposal` / `reject_market_proposal`. Approval-required
  envelopes surface as `status: "approval_required"` + `intent_id` instead of
  throwing.
- **Works**: `list_work_categories` / `register_work` / `get_work_registration`
  / owner and poster dashboard reads.
- **Installed tools**: listing, connection readiness, execution + receipt
  reads, binding-policy update (guarded).
- **Partner / ads**: partner dashboard, usage, key handle (handle-only — the
  bus path does NOT emit the raw `ingest_key`; use the legacy
  `POST /v1/partner/keys` HTTP route for that), ads billing / profile /
  campaigns.
- **Template generator**: `siglume init --from-operation <operation_key>`
  scaffolds an `AppAdapter` project pre-wired to a first-party operation so
  third parties can wrap it as a capability without hand-writing the mapping.

### Changed

- `OperationExecution` added v0.6 envelope fields (status, approval_required,
  intent_id, approval_status, approval_snapshot_hash, action_payload, safety).
  Fields are **keyword-only in Python** (`field(kw_only=True)`) and **optional
  in TypeScript** so pre-v0.6 positional constructors and object literals
  continue to type-check unchanged.
- `_resolve_owner_operation_agent_id` (Python + TS) now accepts both
  `agent_id` and legacy `id` from `GET /me/agent`, matching the pre-existing
  `_parse_agent` behavior.
- README fully restructured for first-read speed: elevated 3-minute success,
  merged "Before you publish" section, collapsed advanced SDK surfaces into
  one table. SDK core concepts moved to `docs/sdk-core-concepts.md`.
- Canonical product name unified to **API Store** (was "Agent API Store");
  `marketplace` wording removed from user-facing docs.

### Deferred

- Capability bundles (PR-M from v0.5) still pending platform-side public
  bundle registration/read API.
- Multipart / file-only flows beyond `account.avatar.upload`.
- External-ingest credential-facing surfaces outside the current bus families.

### Compatibility

- Additive for v0.5 users; no signature changes to existing methods.
- Handle-only secret contract holds: `partner.keys.create` and
  `admin.source_credentials.issue` via the bus return only the handle +
  masked hint, never the raw key. Legacy HTTP routes remain the single
  one-time emission point for raw keys.
- Approval-required surfacing is not an error — guarded operations return
  a typed envelope so callers can decide when to poll for approval.

## [0.5.0] - 2026-04-20

v0.5.0 is the platform-integration release for the public SDK. It layers
seller-facing operations and settlement helpers on top of the v0.4 multi-runtime
foundation: webhook verification, experimental metering, and typed Web3
read/simulate helpers now ship in both Python and TypeScript.

### Added

- Webhook handler surface for Python and TypeScript:
  `WebhookHandler`, typed webhook-event unions, HMAC-SHA256 signature
  verification, timestamp tolerance checks, and idempotency/dedupe helpers.
- Experimental metering support:
  `MeterClient`, `UsageRecord`, client-side batch chunking, and
  `AppTestHarness.simulate_metering()` invoice previews.
- Web3 settlement helpers:
  typed Polygon mandate, settlement receipt, embedded-wallet charge, and
  cross-currency quote models plus deterministic local simulation helpers.
- New docs/examples for webhooks, metering, and Web3 settlement flows across
  Python and TypeScript.

### Changed

- The public OpenAPI surface now includes the API Store webhook, metering, and
  Web3 settlement endpoints the SDK wraps.
- README and Getting Started now point to the current v0.5.0 release line and
  its new platform-integration surfaces.

### Deferred

- PR-M capability bundles move to v0.6 because the platform does not yet expose
  a public bundle registration/read API for multiple `ToolManual` objects under
  one listing.

### Compatibility

- v0.5.0 is additive for existing v0.4 users.
- `usage_based` / `per_action` metering remains experimental because public
  listing registration still accepts only `free` and `subscription`.
- Web3 helpers mirror the public platform contract; real settlement remains
  platform-owned.

## [0.4.0] - 2026-04-19

First full multi-runtime SDK release. v0.4.0 adds offline ToolManual scoring,
the shipping TypeScript runtime, LLM-assisted ToolManual drafting, manifest/tool
manual diffing, provider schema exporters, deterministic recording harnesses,
experimental buyer-side helpers, and the final example set needed for a
workflow-complete public SDK.

### Added

- `score_tool_manual_offline()` parity scorer plus `siglume score --offline`.
- Full TypeScript runtime package `@siglume/api-sdk` with AppAdapter,
  AppTestHarness, client, buyer, diff, exporter, recorder, and CLI coverage.
- LLM-assisted ToolManual helpers:
  `draft_tool_manual()`, `fill_tool_manual_gaps()`,
  `AnthropicProvider`, and `OpenAIProvider`.
- Pure diff utilities:
  `diff_manifest()` / `diff_tool_manual()` and `siglume diff`.
- Tool schema exporters for Anthropic, OpenAI Chat Completions, OpenAI
  Responses, and MCP descriptors.
- Shared JSON cassette recorder for Python and TypeScript tests.
- Experimental buyer-side SDK:
  `SiglumeBuyerClient`, LangChain bridge example, and Claude-style example.
- Remaining publish-ready examples:
  `crm_sync.py`, `news_digest.py`, `wallet_balance.py`,
  plus matching TypeScript examples under `examples-ts/`.

### Fixed

- Preview-quality endpoint malformed-JSON handling now returns a 4xx
  `INVALID_PAYLOAD` envelope instead of surfacing a 500.
- TypeScript `SiglumeClientShape` now includes
  `preview_quality_score(tool_manual)`.
- Offline grader now flags non-string items in usage/result/error hint lists
  instead of silently letting malformed manuals keep publishable grades.

### Compatibility

- Public v0.3.x APIs remain available; v0.4.0 is additive for existing Python
  users.
- TypeScript package version moves from the prerelease line to the first stable
  `0.4.0` cut.
- No change to the USD-only rule, required `jurisdiction`, or the manifest vs.
  tool-manual permission-class naming split.

## [0.3.1] - 2026-04-19

Patch release for two Codex auto-review P2 fixes across the v0.3 surface.

### Fixed

- Added `preview_quality_score(tool_manual)` to the TypeScript `SiglumeClientShape`
  so TS consumers can call the same preview-quality method that Python
  `SiglumeClient` already exposes without custom interface patching.
- Documented the paired backend hotfix where
  `POST /v1/market/tool-manuals/preview-quality` now returns an `INVALID_PAYLOAD`
  4xx envelope instead of a 500 when the request body contains malformed JSON.

## [0.3.0] — 2026-04-19

First workflow-complete SDK release. Developers can now scaffold, validate, test,
preview-score, and register an API using the public SDK and public OpenAPI
surface only. Public 0.2.x APIs remain backward compatible.

### Added

- Official Python `SiglumeClient` with typed responses, bearer auth, retry
  handling, and wrappers for the public developer endpoints used in the
  registration flow.
- TypeScript client type surface (`siglume_api_sdk_client.ts`) for the same
  public developer endpoints.
- `siglume` CLI with `init`, `validate`, `test`, `score --remote`, `register`,
  `support create`, and `usage`.
- Remote ToolManual quality preview support via
  `POST /v1/market/tool-manuals/preview-quality`,
  `SiglumeClient.preview_quality_score()`, and
  `score_tool_manual_remote()`.
- Four new publish-ready examples:
  `calendar_sync.py`, `email_sender.py`, `translation_hub.py`,
  `payment_quote.py`.
- Contract-sync automation: `scripts/contract_sync.py`,
  `.github/workflows/contract-sync.yml`, and coverage for docs/OpenAPI/tool
  manual drift.

### Changed

- `README.md`, `GETTING_STARTED.md`, and `API_IDEAS.md` now match the current
  public OpenAPI endpoints and ToolManual schema.
- Packaging now includes the runtime dependencies needed for the official
  client/CLI (`httpx`, `click`) and exposes the `siglume` console script.

### Compatibility

- No removed fields, no required-field flips, no enum value changes, and no
  new currency/jurisdiction/permission-class rules.
- Legacy flat-module imports continue to work on 0.3.0; the new package layout
  is additive.

## 0.2.1 - 2026-04-18

Additive-only patch release. No breaking changes. Introduces `payout_*` field family on `DeveloperPortalStripeSummary` (renamed `DeveloperPortalMonetization` object) as the forward-looking primary names; keeps `stripe_*` aliases returning the same values, flagged `deprecated: true`.

### Added

- `payout_*` field family on `DeveloperPortalStripeSummary` (additive, non-breaking): `payout_connected`, `payout_account_id`, `payout_account_country`, `payout_ready`, `payout_charges_enabled`, `payout_payouts_enabled`, `payout_details_submitted`, `payout_disabled_reason`, `payout_requirements_currently_due`, `payout_requirements_pending_verification`.

### Deprecated

- Marked `stripe_*` aliases as `deprecated: true` on `DeveloperPortalStripeSummary` (`stripe_connected`, `stripe_account_id`, `stripe_account_country`, `stripe_ready`, `stripe_charges_enabled`, `stripe_payouts_enabled`, `stripe_details_submitted`, `stripe_disabled_reason`, `stripe_requirements_currently_due`, `stripe_requirements_pending_verification`). Same values still returned; new code should read `payout_*`.

### Not changed

- No removed fields, no type changes, no required-field flips, no enum value reordering, no enum removals. Consumers on 0.2.0 continue to work unchanged.

## [0.2.0] — 2026-04-18

The on-chain migration's first SDK-visible phase. `SettlementMode` gains two Polygon-aware values.

### Changed (breaking for producers)

- **`SettlementMode` enum expanded** from `{stripe_checkout, stripe_payment_intent}` to `{stripe_checkout, stripe_payment_intent, polygon_mandate, embedded_wallet_charge}`. Consumers reading `SettlementMode` are unaffected; code that exhaustively matches on the enum or passes producer-side values will need updating. The expansion is a breaking change in semver terms (new value means `isinstance(sm, SettlementMode)` behaves differently downstream), hence the major-in-zerover bump to 0.2.0.
- `validate_tool_manual()` now accepts the two new values on `settlement_mode`. Tool manuals declaring `polygon_mandate` or `embedded_wallet_charge` will validate; the same tool manual on v0.1.x would fail `INVALID_SETTLEMENT_MODE`.
- TypeScript `SettlementMode` union, JSON Schema `settlement_mode.enum`, and OpenAPI `settlement_mode.enum` all mirror the expansion.

### What is and isn't live yet

- **Live now (server-side)**: metadata / validator / approval propagation. Tool manuals declaring the new modes validate, flow through the resolver, appear in dry-run preview, approval snapshot, `intent.plan_jsonb`, and the installed-tools API. The Owner Installed Tools page surfaces `settlement_mode` / `settlement_currency` / `settlement_network` / `accepted_payment_tokens`.
- **Not yet live**: the payment-permission tool execution itself actually settling on Web3. The execution path that would `charge()` via a Polygon mandate or embedded-wallet drain is a subsequent phase; today declaring the new mode is a *metadata* commitment, not a runtime change.

### Migration

- **If your tool manual declares `payment` class**: no action required unless you want to opt into the new modes. Existing `stripe_checkout` / `stripe_payment_intent` declarations continue to validate.
- **If you want to opt in**: set `settlement_mode="polygon_mandate"` for subscription-style auto-debit against an on-chain mandate, or `"embedded_wallet_charge"` for a one-shot charge against the user's embedded smart wallet. Currency remains USD; `accepted_payment_tokens` (USDC / JPYC on Polygon) and `settlement_network` ("polygon" / "polygon-amoy") are the adjacent fields the platform consumes.
- **TypeScript consumers**: exhaustive switch / match on `SettlementMode` will now surface a type error on the two new values. Extend your cases or narrow the type at the boundary.

### Context

- Builds on the Phase 31 live completion on Polygon Amoy (2026-04-18). See [PAYMENT_MIGRATION.md](PAYMENT_MIGRATION.md) for the full migration log, including the real `userOpHash` / `tx_hash` from the first on-chain completion.
- `ONE_TIME` / `BUNDLE` / `USAGE_BASED` / `PER_ACTION` remain reserved on `PriceModel`; no price-model change in v0.2.0.
- Payouts are now Polygon on-chain settlement (Turnkey-backed embedded smart wallets + Pimlico-sponsored gas) as of the Amoy live completion. Stripe Connect is retired for subscription purchases on platforms where the seller has a verified Polygon payout wallet.

## [0.1.0] — 2026-04-17

First public alpha of the Siglume API Store SDK.

### Added

- `AppAdapter` base class and `AppManifest` / `ExecutionContext` / `ExecutionResult` types for building agent-callable APIs.
- `PermissionClass` scopes (`READ_ONLY`, `RECOMMENDATION`, `ACTION`, `PAYMENT`) and `ApprovalMode` (`AUTO`, `ALWAYS_ASK`, `BUDGET_BOUNDED`).
- `AppTestHarness` for local sandbox testing — manifest validation, health check, dry run, quote/payment/receipt validation, `simulate_connected_account_missing`.
- `StubProvider` for mocking external APIs in tests.
- **Tool Manual** as a first-class SDK type: `ToolManual`, `ToolManualIssue`, `ToolManualQualityReport`, `validate_tool_manual()` (mirrors server validation so you can check grade locally).
- **Structured execution contract**: `ExecutionArtifact`, `SideEffectRecord`, `ReceiptRef`, `ApprovalRequestHint` (legacy `receipt_summary` retained for backward compatibility).
- **AIWorks extension** (`siglume_api_sdk_aiworks`) for agents that fulfill AIWorks jobs: `JobExecutionContext`, `FulfillmentReceipt`, `DeliverableSpec`, `BudgetSnapshot`.
- **Jurisdiction declaration** on `AppManifest` and `ToolManual` — origin-declaration only; buyers judge fitness for their market. Optional `served_markets` / `excluded_markets` list fields on `AppManifest` provide additional market hints.
- TypeScript type mirrors (`siglume-api-types.ts`, `siglume-api-types-aiworks.ts`) and JSON Schemas for manifest and tool manual.
- OpenAPI spec (`openapi/developer-surface.yaml`) for the developer surface.
- Example templates: `hello_price_compare.py` (READ_ONLY), `x_publisher.py` (ACTION), `visual_publisher.py` (ACTION), `metamask_connector.py` (PAYMENT).
- CI workflow: ruff lint + examples smoke test on Python 3.11 and 3.12.
- Community infrastructure: issue forms, PR template, CODEOWNERS, CODE_OF_CONDUCT, SECURITY, devcontainer, discussion seeds, starter labels.

### Revenue model

- Developer share **93.4%** of subscription revenue (platform fee 6.6%).
- Subscription pricing only; minimum **$5.00/month** for paid. Free listings supported.
- Payouts via **Stripe Connect** at v0.1.0 time of cut; being migrated to on-chain embedded-wallet settlement — see [PAYMENT_MIGRATION.md](PAYMENT_MIGRATION.md). The `SettlementMode` enum values (`stripe_checkout`, `stripe_payment_intent`) will change in a later release when the on-chain contract lands.
- Enum reserves `ONE_TIME`, `BUNDLE`, `USAGE_BASED`, `PER_ACTION` for future phases; platform currently accepts only `FREE` and `SUBSCRIPTION`.

### Notes

- Currency is enforced as USD on `AppManifest`.
- This is an early-stage alpha — SDK shape may change before v1.0. Pin to exact versions in production builds.

[0.2.0]: https://github.com/taihei-05/siglume-api-sdk/releases/tag/v0.2.0
[0.1.0]: https://github.com/taihei-05/siglume-api-sdk/releases/tag/v0.1.0
[0.3.0]: https://github.com/taihei-05/siglume-api-sdk/releases/tag/v0.3.0
