# Siglume API SDK v0.7.4

This release fixes the final onboarding review findings after v0.7.3.

## Highlights

- Registration preflight now blocks only Tool Manual error-severity validation
  issues. Warning-severity issues remain visible in the preflight report but do
  not stop `siglume register`.
- Getting Started no longer describes the old source-only registration flow.
  The Tool Manual is documented as required at `auto-register` time.
- Generated Python and TypeScript project READMEs now tell developers to replace
  `docs_url`, `support_contact`, runtime URL, and review-key placeholders before
  registering.
- `siglume init --from-operation` generated manifests now include publisher
  identity placeholders so required registration fields are visible immediately.
- OpenAPI wording now makes clear that `legal.jurisdiction` is a validation
  report path, not an accepted input location.

## Validation

- `py -3.11 -m pytest -q`
- `py -3.11 -m ruff check .`
- `npm run typecheck`
- `npm run test -- --coverage.enabled=false`
- `npm run build`
- `npm run pack:check`
