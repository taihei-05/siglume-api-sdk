# Siglume API SDK v0.7.6

This release fixes the last paid Action onboarding contract gaps found after
v0.7.5.

## Highlights

- `SiglumeClient` in Python and TypeScript now falls back to
  `SIGLUME_API_KEY` when no explicit API key is passed.
- Buyer and Meter helper clients use the same resolved API key behavior across
  Python and TypeScript.
- The paid Action subscription template now passes local Tool Manual
  validation for `permission_class="action"` by declaring `jurisdiction`.
- The paid Action template no longer exposes platform-injected `dry_run` as an
  agent input field.
- Getting Started now uses an executable Python bearer-token sample and lists
  action/payment conditional Tool Manual requirements.
- Generated Python and TypeScript starter READMEs now lead with local no-key
  commands before server-backed validation and registration.

## Validation

- `py -3.11 -m ruff check .`
- `py -3.11 -m pytest -q`
- `npm run typecheck`
- `npm test -- --coverage.enabled=false`
- OpenAPI YAML and paid Action JSON parse checks
- `npm run build`
- `npm run pack:check`
- `py -3.11 -m build`
- `py -3.11 -m twine check dist/siglume_api_sdk-0.7.6*`
- `git diff --check`
