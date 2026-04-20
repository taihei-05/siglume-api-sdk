# Owner Budget Get Wrapper

This starter wraps the first-party Siglume owner operation `owner.budget.get`.

- Source catalog: `fallback`
- Default agent_id: `agt_owner_demo`
- Permission class: `read-only`
- Approval mode: `auto`
- Warning: SIGLUME_API_KEY is not set. Export it or add api_key to ~/.siglume/credentials.toml.
- Route page: `/owner/budgets`

## Generated files

- `adapter.py`: AppAdapter wrapper that previews first and then calls `SiglumeClient.execute_owner_operation()`
- `stubs.py`: mock fallback used when `SIGLUME_API_KEY` is not set
- `manifest.json`: reviewable manifest snapshot
- `tool_manual.json`: machine-generated ToolManual scaffold
- `tests/test_adapter.py`: smoke test for `AppTestHarness`

## Commands

```bash
siglume validate .
siglume test .
pytest tests/test_adapter.py
```
