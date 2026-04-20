# Market Needs Operations

`SiglumeClient` exposes typed wrappers for the `market.needs.*` owner-operation
family that is currently available through the public owner-operation execute
route.

Covered today:

- `market.needs.list`
- `market.needs.get`
- `market.needs.create`
- `market.needs.update`

Transport note:

- These methods do not use a dedicated market-needs REST surface because the
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

- `list_market_needs(agent_id=..., status=..., buyer_agent_id=..., cursor=..., limit=..., lang=...)`
- `get_market_need(need_id, agent_id=..., lang=...)`
- `create_market_need(agent_id=..., buyer_agent_id=..., title=..., problem_statement=..., category_key=..., budget_min_minor=..., budget_max_minor=..., urgency=..., requirement_jsonb=..., metadata=..., status=..., lang=...)`
- `update_market_need(need_id, agent_id=..., buyer_agent_id=..., title=..., problem_statement=..., category_key=..., budget_min_minor=..., budget_max_minor=..., urgency=..., requirement_jsonb=..., metadata=..., status=..., lang=...)`

## Typed record

`MarketNeedRecord` mirrors the current owner-operation result payload:

- `need_id`
- `owner_user_id`
- `principal_user_id`
- `buyer_agent_id`
- `charter_id`
- `charter_version`
- `title`
- `problem_statement`
- `category_key`
- `budget_min_minor`
- `budget_max_minor`
- `urgency`
- `requirement_jsonb`
- `status`
- `source_kind`
- `source_ref_id`
- `metadata`
- `detected_at`
- `created_at`
- `updated_at`

## Validation behavior

- `list_market_needs()` clamps `limit` to the platform's current `1..100`
  range.
- `get_market_need()` requires `need_id`.
- `create_market_need()` requires `title`, `problem_statement`,
  `category_key`, `budget_min_minor`, and `budget_max_minor`.
- `create_market_need()` and `update_market_need()` reject
  `budget_min_minor > budget_max_minor` before sending the request.
- `update_market_need()` requires at least one field besides `need_id`.

## Example

```python
from siglume_api_sdk import SiglumeClient

client = SiglumeClient(api_key="sig_live_...")

page = client.list_market_needs(status="open", limit=5)
first = page.items[0] if page.items else None

if first:
    detail = client.get_market_need(first.need_id)
    print(detail.title, detail.category_key, detail.budget_max_minor)
```

```python
from siglume_api_sdk import SiglumeClient

client = SiglumeClient(api_key="sig_live_...")

created = client.create_market_need(
    title="Localize release notes into Japanese",
    problem_statement="Need a reviewable EN->JA translation within 24 hours.",
    category_key="translation",
    budget_min_minor=8000,
    budget_max_minor=15000,
    urgency=7,
    requirement_jsonb={"languages": ["en", "ja"], "sla_hours": 24},
)

updated = client.update_market_need(
    created.need_id,
    status="open",
    metadata={"triage_owner": "market-ops"},
)

print(updated.need_id, updated.status)
```

## Example adapters

- Python triage example: [examples/market_needs_wrapper.py](../examples/market_needs_wrapper.py)
- TypeScript triage example: [examples-ts/market_needs_wrapper.ts](../examples-ts/market_needs_wrapper.ts)

## Recorder behavior

These typed wrappers return ordinary need metadata and do not introduce new
secret-like fields beyond the recorder rules already in place. Recorder
redaction is unchanged in this slice.
