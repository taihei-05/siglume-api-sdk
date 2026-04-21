# siglume-api-sdk v0.7.0 — Capability Bundles & Connected Accounts

Released: 2026-04-21

## At a glance

v0.7.0 wraps the two new v0.7 platform tracks in the public
Python + TypeScript SDK. A capability seller can now group
several APIs into a single bundle listing, and an owner can
connect third-party services like Slack or Google once and have
every capability they buy reuse that connection through the
platform's broker.

## What's new

### Capability bundles

A bundle is one listing that exposes multiple capability
listings as a single subscription. The SDK ships both the
seller authoring surface and the buyer read surface:

```python
from siglume_api_sdk import SiglumeClient

c = SiglumeClient(api_key="sig_...", base_url="https://api.siglume.com/v1")

# Seller: create + populate + submit
bundle = c.create_bundle(
    bundle_key="shop-helper",
    display_name="Shop helper suite",
    description="Compare prices + track shipping + auto-order.",
)
c.add_bundle_capability(bundle.bundle_id, capability_listing_id="cap_abc")
c.add_bundle_capability(bundle.bundle_id, capability_listing_id="cap_def")
c.submit_bundle_for_review(bundle.bundle_id)

# Buyer: list + inspect
for b in c.list_bundles().items:
    print(b.display_name, "— members:", len(b.members))
```

```ts
import { SiglumeClient } from "siglume-api-sdk";

const c = new SiglumeClient({ api_key: "sig_..." });
const bundle = await c.create_bundle({
  bundle_key: "shop-helper",
  display_name: "Shop helper suite",
});
await c.add_bundle_capability(bundle.bundle_id, {
  capability_listing_id: "cap_abc",
});
```

Platform-side invariants enforced at author / submit time:
same-seller members only; 10-member hard cap; each member must
have at least a grade-B tool manual.

### Connected accounts

Owner connects Slack / Google / GitHub / X / Linear / Notion
**once**, and any capability they buy can use that connection
through short-lived platform-issued tokens. The SDK wraps the
full lifecycle except `resolve`, which is intentionally
runtime-only:

```python
# 1) Browser-side: start the OAuth dance
start = c.start_connected_account_oauth(
    provider_key="slack",
    redirect_uri="https://siglume.example/owner/connected-accounts/callback",
    scopes=["chat:write"],
)
# → redirect the user to start.authorize_url

# 2) On callback, exchange code for token (platform keeps the token)
c.complete_connected_account_oauth(state=start.state, code=code_from_provider)

# 3) Later, refresh or revoke from UI
c.refresh_connected_account(account_id)
c.revoke_connected_account(account_id)
```

## Security hardening

- **No `resolve()` on the wire.** Capability runtimes resolve
  short-lived access tokens in-process via the platform's
  `CapabilityGateway`, never over HTTP. Pinned by
  `test_no_resolve_method_is_exposed` in both language suites.
- **No `client_secret` in request bodies.** The SDK's types
  reject `client_secret` as an SDK-side input; platform reads
  per-provider credentials from server-side env vars only.
- **Handle-only `refresh`.** The `refresh` operation returns
  only `expires_at` / `scopes` / `refreshed_at` — never the
  rotated tokens themselves.

## Platform requirement

The v0.7 launch-readiness PR series must be deployed for the new
surfaces to respond. Against older builds the new methods 404.
Required platform PRs:

- taihei-05/siglume #138 — capability bundles Phase 1
- taihei-05/siglume #139 — provider-family registry + bus ops
- taihei-05/siglume #140 — OAuth broker
- taihei-05/siglume #141 — runtime + subscribe gate
- taihei-05/siglume #142 — bundle purchase + credential loader + UI

## Compatibility

Fully additive on top of v0.6.0 — no signature changes to
existing methods. Legacy code that pinned v0.6 continues to
build against v0.7 unchanged.

## Upgrade

```bash
pip install --upgrade siglume-api-sdk==0.7.0
# or
npm install siglume-api-sdk@0.7.0
```
