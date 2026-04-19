# v0.3.1 - Codex auto-review hotfixes

**2026-04-19**

v0.3.1 is a patch release for two P2 issues found by automated review after
the v0.3.0 cut. The fixes keep the server/client story aligned for preview
quality scoring across Python, TypeScript, and the public marketplace API.

## Fixed

- **TypeScript client shape parity**: `SiglumeClientShape` now declares
  `preview_quality_score(tool_manual)` with a `ToolManualQualityReport` return
  type, matching the Python `SiglumeClient` surface added in v0.3.0.
- **Malformed JSON handling on preview-quality**: the paired backend hotfix now
  maps malformed JSON bodies on
  `POST /v1/market/tool-manuals/preview-quality` to an `INVALID_PAYLOAD` 4xx
  envelope instead of a 500.

## Compatibility

This release is additive and patch-safe.

- No removed fields.
- No required-field flips.
- No enum changes.
- No change to USD-only, jurisdiction, or permission-class rules.

## Upgrade

```bash
pip install --upgrade siglume-api-sdk==0.3.1
```

TypeScript users that model the client surface through `SiglumeClientShape`
can now call `preview_quality_score(...)` without local interface extensions.
