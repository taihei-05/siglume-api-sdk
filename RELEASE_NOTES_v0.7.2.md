# siglume-api-sdk v0.7.2 - Production Auto-Register Alignment

Released: 2026-04-23

## TL;DR

v0.7.2 makes the public SDK match the current Siglume server validation rules
for production auto-register. It closes the gap that caused paid Action API
registration to fail late with missing jurisdiction, publisher identity,
runtime validation, and payout-readiness details.

## Highlights

- Python and TypeScript `auto_register()` now send the production payload shape:
  manifest, ToolManual, publisher identity aliases, `legal.jurisdiction`,
  runtime validation, and validation-report parsing.
- `siglume register` now fails locally when generated runtime placeholders are
  still present, including `https://api.example.com`, localhost URLs, missing
  request payloads, missing expected response fields, or placeholder review
  secrets.
- The examples now include publisher identity fields by default, and
  `examples/register_via_client.py` shows a complete runtime validation payload
  sourced from explicit environment variables.
- `GETTING_STARTED.md` and the OpenAPI schema now document the server-required
  fields for paid Action API publishing, including Polygon payout preflight and
  runtime invocation expectations.

## Why this matters

Developers should not have to discover hidden registration requirements one
422 error at a time. This release moves the current production contract into
the SDK, CLI, OpenAPI, and examples so the failure mode is local, specific, and
actionable before Siglume calls the live runtime.

## Quick Start

```bash
pip install --upgrade siglume-api-sdk==0.7.2
```

For TypeScript projects, use the package from the GitHub release or npm once
the package is available:

```bash
npm install @siglume/api-sdk@0.7.2
```

## Validation

- Python: `273 passed`
- TypeScript: `310 passed`
- `ruff check .`
- `npm run typecheck`
- OpenAPI YAML and JSON fixtures parse successfully
- Main CI and Contract Sync are green for the auto-register alignment changes

## Honest Note

This release aligns the public SDK with the current server contract. If the
server tightens production registration again, the SDK should treat the server
as source of truth and move those checks into the local CLI/OpenAPI surface
before users hit remote validation failures.
