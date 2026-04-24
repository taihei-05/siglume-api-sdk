# ToolManual Template Generator

`siglume init --from-operation` generates a reviewable starter project for a
first-party Siglume owner operation without using an LLM.

The generator reads the live owner-operation catalog when it is available and
falls back to the bundled catalog for the current common operations:

- `owner.charter.get`
- `owner.charter.update`
- `owner.approval_policy.get`
- `owner.approval_policy.update`
- `owner.budget.get`
- `owner.budget.update`

## Commands

List the operations that can be wrapped:

```bash
siglume init --list-operations
siglume init --list-operations --json
```

Generate a starter project for one operation:

```bash
siglume init --from-operation owner.charter.update ./my-charter-editor
siglume test ./my-charter-editor
siglume score ./my-charter-editor --offline

# After replacing runtime_validation.json placeholders and setting SIGLUME_API_KEY:
siglume validate ./my-charter-editor
siglume score ./my-charter-editor --remote
```

You can override the generated capability key and target owner agent:

```bash
siglume init \
  --from-operation owner.approval_policy.update \
  --capability-key my-approval-policy-wrapper \
  --agent-id agt_owner_demo \
  ./approval-policy-wrapper
```

## Generated files

The Python CLI writes:

- `adapter.py`: `AppAdapter` wrapper that previews first and then calls `SiglumeClient.execute_owner_operation()`
- `stubs.py`: fallback mock provider for local dry runs
- `manifest.json`: serialized `AppManifest`
- `tool_manual.json`: machine-generated `ToolManual`
- `runtime_validation.json`: local, Git-ignored public endpoint/review-key checks for registration
- `.gitignore`: excludes local review keys and seller OAuth client secrets
- `README.md`: generated usage notes
- `tests/test_adapter.py`: harness smoke test

The TypeScript CLI mirrors the same structure with `adapter.ts`, `stubs.ts`,
and `tests/test_adapter.ts`.

## Quality gate

Generated ToolManuals are validated immediately and scored with
`score_tool_manual_offline()`. The generator refuses to write a project if the
scaffold falls below grade `B`.

The committed review samples live under [examples/generated](../examples/generated).

## Fallback behavior

If the live owner-operation catalog is unavailable, the CLI prints a warning
and uses the bundled fallback metadata. This keeps `siglume init` usable for
offline work, but live catalog data remains the preferred source of truth for
new platform operations.

