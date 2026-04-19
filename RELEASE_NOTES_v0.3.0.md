# v0.3.0 — official client, CLI, and preview-quality flow

**2026-04-19**

v0.3.0 is the first SDK release where a new developer can go from
`pip install` to a reviewed draft with only the public SDK repo and public
OpenAPI surface. The release adds the official HTTP client, the `siglume` CLI,
remote ToolManual preview scoring, and a tighter docs/contracts sync loop.

## Highlights

- **Official Python client**: `SiglumeClient` wraps the public developer
  endpoints used for auto-register, confirm, review submission, developer
  portal summary, usage, support, grants, and sandbox sessions.
- **Official CLI**: `siglume init`, `siglume validate`, `siglume test`,
  `siglume score --remote`, `siglume register`, `siglume support create`, and
  `siglume usage`.
- **Preview-quality API**: the public developer surface now exposes
  `POST /v1/market/tool-manuals/preview-quality`, surfaced in Python as
  `SiglumeClient.preview_quality_score()` and
  `score_tool_manual_remote()`.
- **Starter examples**: four new examples land for common permission classes
  and flows: calendar sync, email send, translation, and payment quote.
- **Docs drift guardrail**: `contract-sync.yml` validates doc endpoint
  references against `openapi/developer-surface.yaml` and validates embedded
  ToolManual JSON examples against the SDK schema.

## The new fast path

```bash
pip install siglume-api-sdk
siglume init --template price-compare
siglume validate .
siglume test .
siglume register . --confirm
```

If you want to inspect only ToolManual quality before registration:

```bash
siglume score . --remote
```

The same preview path is available in Python:

```python
from siglume_api_sdk import SiglumeClient

with SiglumeClient(api_key="sk_live_or_test") as client:
    report = client.preview_quality_score(tool_manual)
    print(report.grade, report.overall_score)
```

## Compatibility

This release is additive. Existing 0.2.x public API consumers keep working.

- No enum additions or removals.
- No required-field flips.
- No change to the USD-only rule.
- `AppManifest.jurisdiction` remains required.
- `ToolManual.permission_class` stays underscore-form.
- `AppManifest.permission_class` stays hyphen-form where applicable.
- Legacy flat-module imports continue to resolve.

## Files to read first

- [GETTING_STARTED.md](./GETTING_STARTED.md)
- [README.md](./README.md)
- [CHANGELOG.md](./CHANGELOG.md)

## Notes

- `siglume score --offline` is intentionally not part of v0.3.0. Offline parity
  grading is planned for v0.4 (`PR-C2`).
- Buyer-side SDK helpers, TypeScript runtime transport, and LLM generator flows
  are intentionally deferred to later releases in the revised roadmap.
