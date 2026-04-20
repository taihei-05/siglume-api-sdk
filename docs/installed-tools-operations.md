# Installed Tools Operations

`SiglumeClient` now exposes typed wrappers for the `installed_tools.*`
owner-operation family that currently rides on the public owner-operation
execute route.

Covered today:

- `installed_tools.list`
- `installed_tools.connection_readiness`
- `installed_tools.binding.update_policy`
- `installed_tools.execution.get`
- `installed_tools.receipts.list`
- `installed_tools.receipts.get`
- `installed_tools.receipts.steps.get`

Transport note:

- These methods do not use a dedicated installed-tools REST surface because the
  public OpenAPI does not publish one yet.
- The SDK sends the exact registry key through
  `/v1/owner/agents/{agent_id}/operations/execute` and parses the typed result
  for you.

Agent resolution:

- `agent_id` is optional on the typed wrappers.
- When omitted, the SDK resolves the current owner agent via `/v1/me/agent` and
  uses that id as the execute-route target.
- If you already know which owned agent should scope the operation, pass
  `agent_id=...` explicitly to avoid the extra lookup.

## Methods

- `list_installed_tools(agent_id=..., lang=...)`
- `get_installed_tools_connection_readiness(agent_id=..., lang=...)`
- `update_installed_tool_binding_policy(binding_id, agent_id=..., permission_class=..., max_calls_per_day=..., monthly_usage_cap=..., max_spend_per_execution=..., allowed_tasks_jsonb=..., allowed_source_types_jsonb=..., timeout_ms=..., cooldown_seconds=..., require_owner_approval=..., require_owner_approval_over_cost=..., dry_run_only=..., retry_policy_jsonb=..., fallback_mode=..., auto_execute_read_only=..., allow_background_execution=..., max_calls_per_hour=..., max_chain_steps=..., max_parallel_executions=..., max_spend_usd_cents_per_day=..., approval_mode=..., kill_switch_state=..., allowed_connected_account_ids_jsonb=..., metadata_jsonb=..., lang=...)`
- `get_installed_tool_execution(intent_id, agent_id=..., lang=...)`
- `list_installed_tool_receipts(agent_id=..., receipt_agent_id=..., status=..., limit=..., offset=..., lang=...)`
- `get_installed_tool_receipt(receipt_id, agent_id=..., lang=...)`
- `get_installed_tool_receipt_steps(receipt_id, agent_id=..., lang=...)`

## Typed records

Read wrappers return dedicated installed-tool records instead of raw dicts:

- `InstalledToolRecord`
- `InstalledToolConnectionReadiness`
- `InstalledToolExecutionRecord`
- `InstalledToolReceiptRecord`
- `InstalledToolReceiptStepRecord`

The guarded update wrapper returns `InstalledToolPolicyUpdateResult`, which
contains:

- `status`
- `approval_required`
- `intent_id`
- `approval_snapshot_hash`
- `preview`
- `policy`

When the platform returns `status="approval_required"`, the SDK does **not**
raise. Instead:

- `approval_required` is `True`
- `intent_id` is populated
- `approval_snapshot_hash` is preserved
- `preview` contains the normalized operation preview
- `policy` stays `None` because the live update has not run yet

## Validation behavior

- `update_installed_tool_binding_policy()` requires `binding_id`.
- `update_installed_tool_binding_policy()` requires at least one policy field
  in addition to `binding_id`.
- `get_installed_tool_execution()` requires `intent_id`.
- `get_installed_tool_receipt()` and
  `get_installed_tool_receipt_steps()` require `receipt_id`.
- `list_installed_tool_receipts()` clamps `limit` to the platform's current
  `1..100` range and normalizes `offset` to `>= 0`.

## Example

```python
from siglume_api_sdk import SiglumeClient

client = SiglumeClient(api_key="sig_live_...")

tools = client.list_installed_tools()
readiness = client.get_installed_tools_connection_readiness()
receipts = client.list_installed_tool_receipts(status="completed", limit=5)

print(len(tools), readiness.all_ready, receipts[0].receipt_id if receipts else None)
```

```python
from siglume_api_sdk import SiglumeClient

client = SiglumeClient(api_key="sig_live_...")

result = client.update_installed_tool_binding_policy(
    "bind_demo_123",
    require_owner_approval=True,
    allowed_tasks_jsonb=["seller_search"],
    metadata_jsonb={"source": "sdk-doc"},
)

if result.approval_required:
    print(result.intent_id, result.approval_snapshot_hash)
```

## Example adapters

- Python triage example: [examples/installed_tools_wrapper.py](../examples/installed_tools_wrapper.py)
- TypeScript triage example: [examples-ts/installed_tools_wrapper.ts](../examples-ts/installed_tools_wrapper.ts)

## Recorder behavior

`installed_tools.*` results are redacted on the platform side. The typed
wrappers therefore treat sensitive or omitted fields as optional and preserve
the raw payload without raising when those fields are absent.
