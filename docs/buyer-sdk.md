# Buyer-side SDK

`SiglumeBuyerClient` is the consumer-side companion to `SiglumeClient`. It is
meant for agent frameworks that want to discover, subscribe to, and invoke
Siglume Agent API Store capabilities.

## Current platform shape

As of 2026-04-19, the public platform exposes:

- `GET /v1/market/capabilities`
- `GET /v1/market/capabilities/{listing_id}`
- `POST /v1/market/capabilities/{listing_id}/purchase`
- `POST /v1/market/access-grants/{grant_id}/bind-agent`

The public platform does **not** currently expose:

- a public semantic search endpoint
- a public buyer execution endpoint
- the full `tool_manual` payload on listing reads

Because of those gaps, PR-N ships with explicit experimental fallbacks:

- `search_capabilities()` uses SDK-side substring scoring over `list_capabilities()`
- `get_listing()` synthesizes a minimal `tool_manual` from listing metadata
- `invoke()` is gated behind `allow_internal_execute=True` and is intended for mocked or privileged environments until a public buyer execute route exists

## Python

```python
from siglume_api_sdk.buyer import SiglumeBuyerClient

buyer = SiglumeBuyerClient(
    api_key="sig_...",
    default_agent_id="agent_123",
    allow_internal_execute=True,
)

results = buyer.search_capabilities(query="convert currency", permission_class="read_only", limit=5)
listing = buyer.get_listing("currency-converter-v2")
subscription = buyer.subscribe(capability_key="currency-converter-v2")
result = buyer.invoke(
    capability_key="currency-converter-v2",
    input={"amount_usd": 100, "to": "JPY"},
)
```

If the owner must approve the action, `invoke()` returns an `ExecutionResult`
with `needs_approval=True` and an `approval_hint` payload you can show in your
framework's approval UX.

## TypeScript

```ts
import { SiglumeBuyerClient, to_anthropic_tool } from "@siglume/api-sdk";

const buyer = new SiglumeBuyerClient({
  api_key: process.env.SIGLUME_API_KEY!,
  default_agent_id: process.env.SIGLUME_AGENT_ID,
  allow_internal_execute: true,
});

const listing = await buyer.get_listing("currency-converter-v2");
const anthropicTool = to_anthropic_tool(listing.tool_manual).schema;
```

The generated `tool_manual` is intentionally conservative and best suited for
tool export / framework wiring. It is not a replacement for the seller-authored
ToolManual used during publishing.

## Examples

- [buyer_langchain.py](../examples/buyer_langchain.py)
- [buyer_claude_agent_sdk.ts](../examples/buyer_claude_agent_sdk.ts)

Both examples run entirely against mocked transports. They do not call LangChain
or Claude APIs during tests.
