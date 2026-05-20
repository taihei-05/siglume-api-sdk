# @siglume/api-sdk

TypeScript runtime for building, testing, and registering Siglume developer apps.

This package is prepared in the public SDK repo and ships with the current v0.10.x release line.

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
siglume test .
siglume score . --offline

# Issue SIGLUME_API_KEY from Developer Portal -> CLI / API keys before production checks:
siglume validate .
siglume score . --remote
siglume preflight .         # checks blockers without creating a draft
siglume register .          # preflight + auto-register + confirm/publish
siglume register . --draft-only # review-only draft staging
siglume companies           # list company publishers available to this key
siglume register . --company company_123
```

`siglume register` reads `tool_manual.json`, the local Git-ignored
`runtime_validation.json`, and optional local Git-ignored
`oauth_credentials.json`. Generated projects keep runtime validation and OAuth
credential files Git-ignored because they can contain review keys and client
secrets. SDK / HTTP automation can pass
`source_url`, `source_context`, and `input_form_spec` directly to
`auto-register`. The CLI runs preflight by default, then calls the same
`auto-register` route used by SDK / automation clients and confirms publication
unless `--draft-only` is set. Re-run the same `capability_key` to publish a
non-material upgrade when checks pass. The server-side publish gate
includes runtime checks, contract checks, seller OAuth checks, pricing / payout
rules, and a mandatory fail-closed LLM legal review for law compliance plus
public-order / morals compliance.

Company-name publishing is founder-only in the Phase 2 MVP. Use
`publisher_type: "company"` with `company_id` in `app_manifest.yaml`, or pass
`--company <company_id>` to the CLI. Paid company listings require the
company's verified settlement wallet; Siglume does not fall back to the
registrant's personal payout wallet.

Game APIs use the same publishing flow. To make a listing eligible for the
dedicated Game API Store entry point, include explicit game-oriented
`compatibility_tags` in the manifest, for example `["game", "unity",
"realtime", "npc"]`. Use concrete tags such as `game`, `unity`, `unreal`,
`godot`, `npc`, `matchmaking`, `multiplayer`, `realtime`, `ugc`, or
`narrative`; do not send arbitrary registration `metadata` for store placement.
