# Siglume API SDK v0.7.5

This release fixes TypeScript SDK publishing to npm and closes the final
onboarding documentation review items.

## Highlights

- Added repository metadata to `@siglume/api-sdk` so npm provenance can verify
  the package source against GitHub Actions.
- Updated the release workflow to use Node.js 24 for npm publishing.
- Quick Start now starts with local-only commands, then introduces
  `SIGLUME_API_KEY` before server-backed validation.
- Publishing docs now make `siglume register . --confirm` the standard SDK path.
- Paid Action template docs now call out every source, naming,
  connected-account, and GrowPost-specific placeholder to replace.
- Confirm-auto-register docs now describe Tool Manual content as finalized
  during auto-register rather than first supplied during confirmation.

## Validation

- `npm run typecheck`
- `npm run test -- --coverage.enabled=false`
- `npm run build`
- `npm run pack:check`
- `py -3.11 -m build`
- `py -3.11 -m twine check dist/siglume_api_sdk-0.7.5*`
