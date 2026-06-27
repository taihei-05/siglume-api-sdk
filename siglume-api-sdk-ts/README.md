# @siglume/api-sdk

TypeScript runtime for building, testing, and registering Siglume developer apps.

This package is prepared in the public SDK repo and ships with the current v1.2.x release line.

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
  api_key: process.env.SIGLUME_OWNER_SESSION_BEARER!,
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
`runtime_validation.json`. Generated projects keep runtime validation files
Git-ignored because they hold the runtime auth header shared secret. SDK / HTTP automation can pass
`source_url`, `source_context`, and `input_form_spec` directly to
`auto-register`. The CLI runs preflight by default, then calls the same
`auto-register` route used by SDK / automation clients and confirms publication
unless `--draft-only` is set. Re-run the same `capability_key` to publish a
non-material upgrade when checks pass. The server-side publish gate
includes runtime checks, contract checks, external OAuth declaration checks, pricing / payout
rules, and a mandatory fail-closed LLM legal review for law compliance plus
public-order / morals compliance.

## Usage-Based And Per-Action Billing

For the canonical pricing reference, see
[`../docs/pricing-and-billing.md`](../docs/pricing-and-billing.md).

Developer-funded reward or incentive payouts are not normal SDK/API-key calls.
Do not call MCP Gateway with `SIGLUME_API_KEY`, `cli_...`, `X-API-Key`, or
`X-Siglume-API-Key`. Reward payout execution uses
`https://mcp.siglume.com/` with `Authorization: Bearer mcpsk_...` and
`tools/call market_create_reward_payout`; SDK/API keys remain for
registration, validation, and listing automation. See
[`../docs/web3-settlement.md#generic-reward-payouts`](../docs/web3-settlement.md#generic-reward-payouts).

Use `price_model: PriceModel.USAGE_BASED` or `PriceModel.PER_ACTION` when the
API must execute before the final operation is known. These listings are free to
invoke up front. Your adapter returns the executed operation in
`ExecutionResult.receipt_summary`; the matching `pricing_plan` item sets the
charge:

```ts
return {
  success: true,
  output: { posted: true, post_url: "https://x.com/..." },
  units_consumed: 1,
  amount_minor: 20,
  currency: "JPY",
  receipt_summary: {
    operation: "url_post",
    amount_minor: 20,
    currency: "JPY",
  },
};
```

Set `price_value_minor: 0` when prices vary by operation, and publish a
buyer-facing `pricing_plan` so API Store and Game API Store can show the plan.
`pricing_plan.items` is required for `usage_based` and `per_action` listings:

```ts
pricing_plan: {
  display_name: "Operation prices",
  currency: "JPY",
  free_upfront_invocation: true,
  items: [
    { key: "connection_check", label: "Connection check", price_minor: 0 },
    { key: "dry_run", label: "Dry-run preview", price_minor: 0 },
    { key: "text_post", label: "Text post", price_minor: 15 },
    { key: "url_post", label: "URL post", price_minor: 20 },
    { key: "reply", label: "Reply", price_minor: 30 },
  ],
}
```

The `pricing_plan` is authoritative. If the adapter returns a conflicting
positive amount, the platform rejects the call instead of charging an arbitrary
API-declared amount. `0` is valid for free operations. For JPY/JPYC billing,
positive operation prices must be at least `15` minor units; `1` through `14`
are rejected by the SDK and platform because platform-sponsored gas can exceed
the fee.
`units_consumed` is kept for receipts and analytics; it does not multiply a
request-type plan price.

For irreversible side effects such as posting to X, set
`billing_timing: "prepay"`. The platform first calls your API as a quote
(`execution_kind="quote"` / `dry_run=true`), reads `billingPreview.operation`
and `draftToken`, collects the direct payment for that pricing-plan operation,
then calls the ACTION endpoint with the same token as `commit_token`. If payment
fails, the ACTION call is never made. Use the default `"post"` timing only for
read-only or reversible usage.

Responsibility boundary: Siglume owns payment, authorization, platform
idempotency, retry state, usage rows, and reconciliation state. Your API owns
the provider-specific action and the proof that it committed. The platform does
not infer whether an X post, email, CRM write, booking, or other external action
happened. Return committed evidence only after the side effect committed;
draft-only, preview, ambiguous, or `status="ready"` live-action results are not
delivered results. See
[`../docs/platform-api-boundary.md`](../docs/platform-api-boundary.md).

After live or sandbox execution, inspect receipts with `siglume dev tail`,
`siglume dev tail --listing-id <listing_id>`, or the SDK receipt helpers. The
publisher listing view is privacy-redacted. See
[`../docs/developer-observability.md`](../docs/developer-observability.md).

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
