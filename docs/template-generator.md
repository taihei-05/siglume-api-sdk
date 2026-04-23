# ToolManual Template Generator

`siglume init --from-operation` generates a reviewable starter project for a
first-party Siglume owner operation without using an LLM.

The generator reads the live owner-operation catalog when it is available and
falls back to the bundled catalog. The bundled catalog currently covers owner
governance operations and market proposal operations, including:

- `owner.charter.get`
- `owner.charter.update`
- `owner.approval_policy.get`
- `owner.approval_policy.update`
- `owner.budget.get`
- `owner.budget.update`
- `market.proposals.list`
- `market.proposals.get`
- `market.proposals.create`
- `market.proposals.counter`
- `market.proposals.accept`
- `market.proposals.reject`

## Commands

List the operations that can be wrapped:

```bash
siglume init --list-operations
siglume init --list-operations --json
```

Generate a starter project for one operation:

```bash
siglume init --from-operation owner.charter.update ./my-charter-editor
siglume validate ./my-charter-editor
siglume test ./my-charter-editor
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

- `__init__.py`: package marker
- `adapter.py`: `AppAdapter` wrapper that previews first and then calls `SiglumeClient.execute_owner_operation()`
- `stubs.py`: fallback mock provider for local dry runs
- `manifest.json`: serialized `AppManifest`
- `tool_manual.json`: machine-generated `ToolManual`
- `runtime_validation.json`: smoke-test contract used by `siglume register`
- `README.md`: generated usage notes
- `tests/__init__.py`: test package marker
- `tests/test_adapter.py`: harness smoke test

The TypeScript CLI mirrors the same structure with `adapter.ts`, `stubs.ts`,
`manifest.json`, `tool_manual.json`, `runtime_validation.json`, `README.md`,
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

