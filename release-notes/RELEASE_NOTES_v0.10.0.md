# siglume-api-sdk v0.10.0

Released: 2026-04-25

## Summary

Fixes a long-standing "my listing field is empty on the Store detail page even though I filled it in" class of bug, and locks down release versioning to platform control.

## Breaking

- **`AppManifest.version` is no longer forwarded to the server** on `auto_register` / `confirm_auto_register`. The Siglume platform rejects submissions that declare a `version` field (top-level or inside `manifest`) with `422 MANIFEST_VERSION_NOT_ALLOWED`. Use `confirm_registration(..., version_bump=...)` (added in v0.9.0) to control the published `release_semver`.
- `AppManifest.version` stays in the dataclass as **local-only** for your own adapter tracking (tests, git tags, etc.); the SDK explicitly strips it from the outbound payload. Typical Python / TS callers are unaffected.

## Added

- **`AppManifest.description`** — long-form buyer-facing sales copy shown on the API detail page. Complements `short_description` (one-liner) with the full pitch: who this is for, what it can / cannot do, limits, quotas. Added in Python + TypeScript.
- **`auto_register` now forwards `description`, `permission_scopes`, and `compatibility_tags`** to the top-level submission. Previously these three fields travelled only inside the embedded `manifest` sub-dict and the server dropped them silently on listing creation, so listings rendered `description: null` / `permission_scopes: []` / `compatibility_tags: []` on the public detail page. Paired backend fix lands in the main repo alongside this release.

## Docs

- New subsection under "Version numbering" in `GETTING_STARTED.md` clarifying `AppManifest.version` is local-only.
- New "Buyer-facing fields vs. agent-facing Tool Manual" table so sellers know which fields drive the Store detail page vs. which live in the Tool Manual.
- OpenAPI (`openapi/developer-surface.yaml`) documents the `MANIFEST_VERSION_NOT_ALLOWED` reject rule and enriches the `description` field description with explicit buyer-facing semantics.

## Migration

Python / TypeScript SDK users:

```python
# No change needed — the SDK strips version for you
client.auto_register(manifest, tool_manual)

# Populate long-form buyer copy; previously ignored on the server
manifest = AppManifest(
    capability_key="my-api",
    name="My API",
    job_to_be_done="...",
    jurisdiction="US",
    short_description="One-liner for the card.",
    description="Full paragraph for the detail page — who this is for, "
                "what it can / cannot do, limits, required connected "
                "accounts. Shows under 'Details'.",
    permission_scopes=["tweet.write", "users.read"],
    compatibility_tags=["sns", "twitter", "scheduling"],
    # ...
)
```

If you call the HTTP API directly: remove `version` from your request body; send `description`, `permission_scopes`, `compatibility_tags` at the top level of your auto-register payload.

## Install

```bash
pip install --upgrade siglume-api-sdk==0.10.0
```
