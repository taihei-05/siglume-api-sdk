# Siglume API SDK v0.7.3

This release closes the remaining production-facing review findings from the
developer onboarding flow.

## Highlights

- Webhook idempotency keys are now marked only after callbacks complete
  successfully, so failed callback attempts can be retried.
- `siglume register` now performs production preflight locally before calling
  `auto-register`: explicit Tool Manual, manifest validation, remote quality
  preview, runtime placeholder checks, publisher identity, jurisdiction, and
  paid payout readiness.
- Register CLI output now includes `review_url`, `trace_id`, `request_id`, and
  preflight quality in human-readable mode.
- TypeScript CI now runs typecheck, tests, build, and pack checks.
- OpenAPI and examples now match the server source of truth for jurisdiction
  and publisher identity fields.

## Validation

- `py -3.11 -m pytest -q`
- `py -3.11 -m ruff check .`
- `npm run typecheck`
- `npm run test -- --coverage.enabled=false`
- `npm run build`
- `npm run pack:check`
- OpenAPI and JSON examples parsed successfully.
