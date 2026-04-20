# v0.4.0 - offline grader, TypeScript runtime, and workflow-complete examples

**2026-04-19**

v0.4.0 is the first Siglume SDK release where both Python and TypeScript users
can build, test, diff, score, export, and mock replay a capability end-to-end
without leaving the public SDK surface.

## Highlights

- **Offline ToolManual grading**: `score_tool_manual_offline()` mirrors the
  publish-time quality bar locally, and `siglume score --offline` works without
  a network round-trip.
- **TypeScript runtime is now first-class**: `@siglume/api-sdk` ships
  AppAdapter, AppTestHarness, SiglumeClient, buyer helpers, diff/exporters,
  recorder support, and the `siglume` CLI in ESM + CJS form.
- **LLM-assisted ToolManual drafting**: use `draft_tool_manual()` or
  `fill_tool_manual_gaps()` with `AnthropicProvider` or `OpenAIProvider`,
  backed by offline scoring + retry.
- **Safe review tooling**: `siglume diff` classifies breaking vs. warning vs.
  info changes for manifests and tool manuals.
- **Schema exporters**: turn one ToolManual into Anthropic, OpenAI, or MCP tool
  descriptors with explicit lossy-field reporting.
- **Deterministic recording harness**: shared Python/TypeScript cassettes let
  tests replay HTTP flows without live network access.
- **Buyer-side SDK**: experimental `SiglumeBuyerClient` makes it easier to plug
  Siglume Agent API Store capabilities into LangChain-style and Claude-style
  agent runtimes.
- **Example set completed for v0.4**: `crm_sync`, `news_digest`, and
  `wallet_balance` join the earlier examples, with TypeScript counterparts in
  `examples-ts/`.

## Included PRs

- PR-C2: offline ToolManual grader parity
- PR-D: LLM assist for ToolManual draft + gap fill
- PR-E: full TypeScript runtime package
- PR-J: manifest / ToolManual diff tool
- PR-K: Anthropic / OpenAI / MCP schema exporters
- PR-L: deterministic recording harness
- PR-N: experimental buyer-side SDK
- PR-O: final example set + release prep

## Patch fixes folded into this release

- Preview-quality malformed JSON now maps to a 4xx `INVALID_PAYLOAD` envelope
  instead of a 500.
- TypeScript `SiglumeClientShape` includes `preview_quality_score(tool_manual)`.
- Offline grader now penalizes non-string items in hint arrays.

## Compatibility

This release is additive for Python users on the v0.3 line.

- No change to the USD-only publishing rule.
- `AppManifest.jurisdiction` remains required.
- `ToolManual.permission_class` still uses underscore values.
- `AppManifest.permission_class` still uses hyphen values.

## Suggested upgrade

```bash
pip install --upgrade siglume-api-sdk==0.4.0
npm install @siglume/api-sdk@0.4.0
```
