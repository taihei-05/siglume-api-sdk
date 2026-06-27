# siglume-api-sdk v0.9.0

Released: 2026-04-24

## Summary

Sellers can now bump minor / major semver on a re-registration. `confirm_registration()` accepts an optional `version_bump` argument.

## Background

Until v0.9.0 the platform auto-incremented only the patch position of `CapabilityRelease.release_semver`:

```
first publish            → 1.0.0
next re-registration     → 1.0.1
next                     → 1.0.2
...forever
```

There was no way for a seller to step past `1.0.x` even when the change was a real feature release or a breaking change. This release fixes that.

## New

```python
# Python
client.confirm_registration(listing_id)                         # default → patch bump (1.0.2 → 1.0.3)
client.confirm_registration(listing_id, version_bump="minor")   # 1.0.5 → 1.1.0
client.confirm_registration(listing_id, version_bump="major")   # 1.5.3 → 2.0.0
```

```ts
// TypeScript
await client.confirm_registration(listing_id);                                // default → patch
await client.confirm_registration(listing_id, { version_bump: "minor" });     // 1.0.5 → 1.1.0
await client.confirm_registration(listing_id, { version_bump: "major" });     // 1.5.3 → 2.0.0
```

Any value other than `"patch"`, `"minor"`, or `"major"` is rejected client-side and also server-side. You cannot pick an arbitrary version string — always one bump above the latest published release. First-ever publish of a listing is always `1.0.0` and ignores the argument.

## Backward compatible

Callers that do not pass `version_bump` see exactly the same behavior as before (auto patch bump). Existing deployed code needs no change.

## Install

```bash
pip install --upgrade siglume-api-sdk==0.9.0
```
