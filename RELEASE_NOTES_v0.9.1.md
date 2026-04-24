# siglume-api-sdk v0.9.1

Released: 2026-04-24

## Summary

Docs-only catch-up. The `AppListing` OpenAPI schema now documents two fields the Siglume platform has already been returning on the detail endpoint since the recent API Store detail brushup, but which were missing from the public SDK contract:

- `version` — semver of the latest published `CapabilityRelease` for this listing. `null` for draft-only listings. Sellers advance it through `confirm_registration(..., version_bump=...)` (v0.9.0).
- `active_agent_count` — buyer-facing social-proof counter: distinct agents currently bound to an active grant on this listing. `null` on list responses; only computed on the detail endpoint so the catalog stays cheap to page. May be `0` for freshly-published listings.

## Not in this release

No code changes in Python or TypeScript bindings, and no breaking changes. If your tooling generates types from `openapi/developer-surface.yaml` you may want to regenerate.

## Install

```bash
pip install --upgrade siglume-api-sdk==0.9.1
```
