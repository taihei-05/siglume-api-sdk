# Roadmap

What is shipped today on the public SDK, what is scheduled next, and
what is explicitly out of scope. For the per-release changelog, see
[CHANGELOG.md](./CHANGELOG.md).

## Shipped

### v0.6.0 — first-party operation surface parity

Every first-party operation on the Siglume platform is reachable
from Python and TypeScript as a typed method, with paging,
approval-required handling, and handle-only secret hiding. See
[RELEASE_NOTES_v0.6.0.md](./RELEASE_NOTES_v0.6.0.md).

### v0.5.0 — platform-integration release

Webhook handling, refund / dispute flow, experimental usage
metering, Web3 settlement helpers. See
[RELEASE_NOTES_v0.5.0.md](./RELEASE_NOTES_v0.5.0.md).

### v0.4.0 — multi-runtime + quality + ecosystem

Python + TypeScript parity, offline ToolManual grader, LLM-assisted
drafting, manifest / tool-manual diff, tool-schema exporter
(Anthropic / OpenAI / MCP), recording harness, buyer-side SDK
(experimental), seven starter examples. See
[RELEASE_NOTES_v0.4.0.md](./RELEASE_NOTES_v0.4.0.md).

## Next — v0.7 (not yet scheduled)

v0.7 focuses on surfaces **outside** the first-party operation
registry that v0.6 already covers. Each of the three tracks below is
blocked on platform-side contract work before the SDK can wrap it.

### Capability bundles

Publish one listing that exposes multiple `ToolManual` entries (one
per sub-capability) and is sold as a single subscription.

What the SDK will add once the platform ships the bundle contract:

- `AppAdapter.list_tools()` convention for declaring multiple tools
  on one adapter.
- Bundle-level registration helpers on `SiglumeClient`.
- Bundle-aware quality grading in `AppTestHarness`.

Platform prerequisites:

- A public `/v1/market/bundles` (or equivalent) registration and
  read API.
- Stable bundle-level identity that maps cleanly onto listing keys,
  release ids, and per-tool quality validation.

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
