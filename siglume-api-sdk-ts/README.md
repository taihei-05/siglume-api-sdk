# @siglume/api-sdk

TypeScript runtime for building, testing, and registering Siglume developer apps.

This package is prepared in the public SDK repo and ships with the v0.4 release line.

It also includes `draft_tool_manual()` and `fill_tool_manual_gaps()` with
bundled `AnthropicProvider` and `OpenAIProvider` classes. Provide
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, then:

```ts
import { AnthropicProvider, draft_tool_manual } from "@siglume/api-sdk";

const result = await draft_tool_manual({
  capability_key: "currency-converter-jp",
  job_to_be_done: "Convert USD amounts to JPY with live rates",
  permission_class: "read_only",
  llm: new AnthropicProvider(),
});

console.log(result.quality_report.grade);
```

Buyer-side runtime helpers are also included:

```ts
import { SiglumeBuyerClient, to_anthropic_tool } from "@siglume/api-sdk";

const buyer = new SiglumeBuyerClient({
  api_key: process.env.SIGLUME_API_KEY ?? "sig_mock_key",
  default_agent_id: process.env.SIGLUME_AGENT_ID,
  allow_internal_execute: true,
});

const listing = await buyer.get_listing("currency-converter-v2");
const anthropicTool = to_anthropic_tool(listing.tool_manual).schema;
```

See [`../docs/buyer-sdk.md`](../docs/buyer-sdk.md) and
[`../examples/buyer_claude_agent_sdk.ts`](../examples/buyer_claude_agent_sdk.ts)
for the current experimental limitations and the mocked integration example.

You can also generate deterministic first-party owner-operation wrappers from
the CLI without using an LLM:

```bash
siglume init --list-operations
siglume init --from-operation owner.charter.update ./my-charter-editor
```

See [`../docs/template-generator.md`](../docs/template-generator.md) for the
generated file layout, fallback behavior, and review samples.
