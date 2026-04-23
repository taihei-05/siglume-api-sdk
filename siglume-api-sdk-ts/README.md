# @siglume/api-sdk

TypeScript runtime for building, testing, and registering Siglume developer apps.

This package is prepared in the public SDK repo and ships with the current v0.5 release line.

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

Buyer-side discovery and export helpers are also included:

```ts
import { SiglumeBuyerClient, to_anthropic_tool } from "@siglume/api-sdk";

const buyer = new SiglumeBuyerClient({
  api_key: process.env.SIGLUME_API_KEY ?? "sig_mock_key",
  default_agent_id: process.env.SIGLUME_AGENT_ID,
});

const listing = await buyer.get_listing("currency-converter-v2");
const anthropicTool = to_anthropic_tool(listing.tool_manual).schema;
```

`SiglumeBuyerClient.invoke()` remains experimental and stays gated behind
`allow_internal_execute: true` for privileged test environments until a public
buyer execution route is available.

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

For API Store publishing, the recommended CLI flow is:

```bash
siglume init --template price-compare
siglume validate .
siglume score . --remote
siglume test .
siglume register .            # preflight + draft only
siglume register . --confirm # confirm + publish
```

`siglume register` reads `tool_manual.json`, `runtime_validation.json`, and
optional `input_form_spec.json`. If the API uses seller-side OAuth, it also
reads `oauth_credentials.json`. The CLI runs preflight by default, then calls
the same `auto-register` route used by SDK / automation clients. Re-run the
same `capability_key` to stage an upgrade. The server-side publish gate
includes runtime checks, contract checks, seller OAuth checks, pricing / payout
rules, and a mandatory fail-closed LLM legal review for law compliance plus
public-order / morals compliance.
