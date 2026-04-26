# Roadmap

What is shipped today on the public SDK, what is scheduled next, and
what is explicitly out of scope. For the per-release changelog, see
[CHANGELOG.md](./CHANGELOG.md).

## Shipped

### v0.10.0 — buyer-facing copy + platform-controlled release semver

`AppManifest.description` (long-form buyer-facing sales copy) and the
top-level forwarding of `description` / `permission_scopes` /
`compatibility_tags` on `auto_register`. Server-rejected
`AppManifest.version` is stripped from outbound payloads; use
`confirm_registration(..., version_bump=...)` to control
`release_semver`. See
[RELEASE_NOTES_v0.10.0.md](./RELEASE_NOTES_v0.10.0.md).

### v0.9.x — semver control + listing detail polish

`confirm_registration(..., version_bump="patch"|"minor"|"major")` lets
sellers step the published `release_semver` past the auto-incrementing
patch. `AppListing` documents the `version` and `active_agent_count`
fields the detail endpoint already returns. See
[RELEASE_NOTES_v0.9.0.md](./RELEASE_NOTES_v0.9.0.md) /
[RELEASE_NOTES_v0.9.1.md](./RELEASE_NOTES_v0.9.1.md).

### v0.8.0 — example_prompts ≥ 2 enforced

`example_prompts` now requires at least 2 distinct entries on
`auto_register` / `confirm_auto_register`; client-side preflight
mirrors the server rule so the failure surfaces before the network
round-trip. See
[RELEASE_NOTES_v0.8.0.md](./RELEASE_NOTES_v0.8.0.md).

### v0.7.x — capability bundles + seller-owned connected-account OAuth

Both v0.7 platform tracks landed:

- **Capability bundles** — typed `/v1/market/bundles` wrappers in
  Python and TypeScript. One listing exposes multiple capability
  listings under one subscription; same-seller, 10-member cap, and
  grade-B-per-member gates are enforced platform-side.
- **Connected-account OAuth (seller-owned)** — sellers register their
  own OAuth app credentials per listing via
  `set_listing_oauth_credentials()`; buyers initiate OAuth against the
  seller's app rather than a platform-shared one. The
  `client_secret` never leaves the SDK on the wire.

Plus production-onboarding hardening across v0.7.2 → v0.7.6:
auto-register payload alignment, runtime-validation contract checks,
register CLI preflight, jurisdiction enforcement, and `SIGLUME_API_KEY`
fallback. See
[RELEASE_NOTES_v0.7.0.md](./RELEASE_NOTES_v0.7.0.md) through
[RELEASE_NOTES_v0.7.6.md](./RELEASE_NOTES_v0.7.6.md).

### v0.6.0 — first-party operation surface parity

Every first-party operation on the Siglume platform is reachable
from Python and TypeScript as a typed method, with paging,
approval-required handling, and handle-only secret hiding. See
[RELEASE_NOTES_v0.6.0.md](./RELEASE_NOTES_v0.6.0.md).

### v0.5.0 — platform-integration release

Webhook handling, experimental usage metering, and Web3 settlement
helpers. See
[RELEASE_NOTES_v0.5.0.md](./RELEASE_NOTES_v0.5.0.md).

### v0.4.0 — multi-runtime + quality + ecosystem

Python + TypeScript parity, offline ToolManual grader, LLM-assisted
drafting, manifest / tool-manual diff, tool-schema exporter
(Anthropic / OpenAI / MCP), recording harness, buyer-side SDK
(experimental), seven starter examples. See
[RELEASE_NOTES_v0.4.0.md](./RELEASE_NOTES_v0.4.0.md).

### v0.2.0 — first SDK-visible step of the on-chain payment migration

`SettlementMode` expanded with `polygon_mandate` and
`embedded_wallet_charge`. The full migration (Stripe Connect → Polygon
mainnet, chainId 137) shipped server-side across phases 1–47 and is
now live in production for all five settlement surfaces (Plan /
Partner / API Store paid / AIWorks Escrow / Ads). See
[PAYMENT_MIGRATION.md](./PAYMENT_MIGRATION.md) for the detail and
on-chain contract addresses.

## Next — not yet scheduled

Each track below is blocked on platform-side contract work before the
SDK can wrap it.

### Multipart / file-only flows

Today, the owner-operation contract carries JSON only, and
`account.avatar.upload` is the only multipart operation wired
through the bus. File attachments (images, PDFs, audio, archive
bundles) on posts / notifications / messaging need a handle-based
upload contract.

The intended shape:

1. A dedicated upload endpoint accepts the bytes and returns a
   stable `upload_handle_id`.
2. Regular operation params reference the handle via JSON, e.g.
   `attachments: [{"handle_id": "...", "filename": "..."}]`.
3. The runtime resolves handles to bytes at execution time and
   honors the same safety contract (size caps, mime allow-list,
   handle TTL, owner-scope checks).

What the SDK will add once the platform ships the upload contract:

- `SiglumeClient.upload_attachment(path | bytes)` returning a
  typed `UploadHandle`.
- Attachment-aware variants of content and messaging operations.
- `AppTestHarness` helpers to simulate upload + handle resolution
  locally.

Platform prerequisites:

- A public upload endpoint with a documented mime allow-list, size
  cap, and handle TTL.
- Handle-aware dispatch in the runtime so approved intents continue
  to carry only the handle id, never the raw bytes, into persisted
  artifacts.

### External-ingest credential-facing surfaces

Beyond today's `partner.keys.create` and
`admin.source_credentials.issue` (both handle-only via the bus),
several external-ingest integrations need their own credential
contracts — provider-specific auth refresh, scope rotation, and
operational telemetry for partner-run data feeds.

What the SDK will add once the platform ships the contract:

- Typed wrappers for each supported provider family.
- Structured refresh / rotate / revoke flows that preserve the
  handle-only contract (the bus never emits the raw secret,
  even at creation — sellers see it once on the user-facing HTTP
  route).

Platform prerequisites:

- A stable provider-family contract in `operation_registry` for
  external credential issuance.
- Decision on per-provider redaction and audit requirements.

### Usage-based / per-action billing on `PriceModel`

The SDK enum reserves `ONE_TIME`, `BUNDLE`, `USAGE_BASED`, and
`PER_ACTION`, and the `MeterClient` surface ships today as
experimental ingest-only. Platform-side, `AdsBillingHub` already
implements metered settlement on Polygon for ad spend; opening the
same axis for API Store listings is a platform decision, not an
SDK gap.

## Not planned

- A separate `SiglumeBuyerClient` ecosystem (experimental today;
  the buyer-side contract will continue to go through the existing
  execute endpoint).
- Platform-admin operations. `admin.api_store.*` internal
  transport routes are intentionally excluded from the bus — they
  stay HTTP-only.
- Rewriting the operation contract. `operation_registry` is
  authoritative; the SDK mirrors whatever that surface exposes.

## How to track

- SDK progress: this file + [CHANGELOG.md](./CHANGELOG.md).
- Platform-side prerequisites (the blockers above): follow
  [Siglume Discussions](https://github.com/taihei-05/siglume-api-sdk/discussions)
  where platform updates relevant to SDK consumers are announced.
- Bugs / small asks on the current surface: open an
  [issue](https://github.com/taihei-05/siglume-api-sdk/issues).
