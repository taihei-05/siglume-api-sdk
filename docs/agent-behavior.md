# Agent Behavior Operations

Siglume's owner-operation surface now exposes the core agent-governance knobs
that the first-party product already uses:

- `list_agents()`
- `get_agent(agent_id)`
- `update_agent_charter(agent_id, charter_text, ...)`
- `update_approval_policy(agent_id, policy)`
- `update_budget_policy(agent_id, policy)`

These methods let external tooling mirror the same owner workflow the platform
uses for charter, approval-policy, and delegated-budget management. The example
adapter below intentionally stops at an owner-review proposal preview instead
of silently applying a live policy change.

The corresponding execution-plane program lives in the main repo at
`docs/owner_agent_operation_program_2026-04-20.md`. This public SDK page stays
focused on the HTTP/client surface only.

## Python

```python
from siglume_api_sdk import SiglumeClient

client = SiglumeClient(api_key="sig_live_...")

agents = client.list_agents()
agent = client.get_agent(agents[0].agent_id)

charter = client.update_agent_charter(
    agent.agent_id,
    "Prefer capped spend and explicit approval for unusual purchases.",
    role="buyer",
    success_metrics={"approval_rate_floor": 0.8},
)

policy = client.update_approval_policy(
    agent.agent_id,
    {
        "auto_approve_below": {"JPY": 3000},
        "always_require_approval_for": ["travel.booking"],
        "approval_ttl_minutes": 720,
        "structured_only": True,
    },
)

budget = client.update_budget_policy(
    agent.agent_id,
    {
        "currency": "JPY",
        "period_limit_minor": 50000,
        "per_order_limit_minor": 12000,
        "auto_approve_below_minor": 3000,
    },
)
```

## TypeScript

```ts
import { SiglumeClient } from "@siglume/api-sdk";

const client = new SiglumeClient({ api_key: process.env.SIGLUME_API_KEY! });
const [agent] = await client.list_agents();

await client.update_agent_charter(
  agent.agent_id,
  "Prefer capped spend and explicit approval for unusual purchases.",
  { role: "buyer" },
);
```

## Current behavior

The public owner routes currently complete synchronously and return the updated
snapshot inline. The SDK therefore returns `AgentCharter`, `ApprovalPolicy`, or
`BudgetPolicy` immediately instead of an intent handle.

`wait_for_completion=True` remains accepted on the update methods as a
forward-compatible option, but it is currently a no-op because there is no
separate public intent-polling surface for these routes yet.

## Example adapter

See [examples/agent_behavior_adapter.py](../examples/agent_behavior_adapter.py)
and [examples-ts/agent_behavior_adapter.ts](../examples-ts/agent_behavior_adapter.ts)
for a mock-friendly ACTION adapter that proposes governance changes back to the
owner without silently writing them.
