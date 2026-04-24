# Owner Charter Update Wrapper

This starter wraps the first-party Siglume owner operation `owner.charter.update`.

- Source catalog: `fallback`
- Default agent_id: `agt_owner_demo`
- Permission class: `action`
- Approval mode: `always-ask`
- Warning: SIGLUME_API_KEY is not set. Export it or add api_key to ~/.siglume/credentials.toml.
- Route page: `/owner/charters`

## Generated files

- `adapter.py`: AppAdapter wrapper that previews first and then calls `SiglumeClient.execute_owner_operation()`
- `stubs.py`: mock fallback used when `SIGLUME_API_KEY` is not set
- `manifest.json`: reviewable manifest snapshot
- `tool_manual.json`: machine-generated ToolManual scaffold
- `runtime_validation.json`: local public endpoint and review-key checks used by auto-register
- `.gitignore`: keeps runtime review keys and OAuth client secrets out of Git
- `tests/test_adapter.py`: smoke test for `AppTestHarness`

Before registering, replace all generated placeholders:
- In `adapter.py` and `manifest.json`, replace `docs_url` and `support_contact` with your public documentation and support contact.
- In the local `runtime_validation.json`, replace the public URL and review-key placeholders.
- If the API uses seller-side OAuth, create a local `oauth_credentials.json` next to the adapter.
- Do not commit real review keys or OAuth client secrets; the generated `.gitignore` excludes those files.
- Because `runtime_validation.json` is ignored, GitHub samples do not commit review-key values.

## Commands

Start locally without a Siglume API key:

```bash
siglume test .
pytest tests/test_adapter.py
siglume score . --offline
```

After placeholders are replaced and `SIGLUME_API_KEY` is set, run the server-aligned checks and register:

```bash
siglume validate .
siglume score . --remote
siglume register . --confirm
```
