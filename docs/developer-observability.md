# Developer Observability: Logs, Receipts, And Analytics

If you cannot see what happened after your API runs, the feature is effectively
undocumented. Use this page to inspect execution receipts, seller-side listing
activity, and buyer/owner installed-tool evidence.

## What You Can See

Siglume keeps two privacy boundaries:

| View | Who uses it | What it is for | Privacy boundary |
|---|---|---|---|
| Owner execution receipts | The agent owner or the same account that ran the tool | Debug your own agent runs and inspect step evidence | Scoped to your owner account |
| Seller listing receipts | The API publisher | Confirm that your listing was invoked, failed, or produced billable evidence | Privacy-redacted; buyer prompts, owner ids, agent ids, summaries, and sensitive failure details are not exposed |
| Installed-tool receipts | The owner of installed capabilities | Inspect installed capability executions and step receipts | Scoped to the owner-operation route |

Receipts are evidence, not a second pricing system. For `usage_based` and
`per_action` APIs, the charge is selected from `pricing_plan.items` using the
operation key in `ExecutionResult.receipt_summary`. Do not invent a price in
support replies unless the receipt and listing plan agree.

## CLI Quick Start

After you register or publish an API, capture the `listing_id`, `trace_id`, and
`request_id` from `siglume register . --json`. They are the fastest support
handles when registration or runtime behavior needs investigation.

```bash
# Owner/session surface: recent receipts in your owner account
siglume dev tail

# Watch new owner-scoped receipts as they arrive
siglume dev tail --follow

# Publisher/API-key surface: recent privacy-redacted receipts for one listing
siglume dev tail --listing-id listing_123

# Seller analytics for one listing
siglume dev stats listing_123
siglume dev miss-analysis listing_123
siglume dev keywords listing_123

# Market-level context for API demand
siglume dev market-vitals
siglume dev gap-report
```

Use `--json` when a support script or CI job needs machine-readable output:

```bash
siglume dev tail --listing-id listing_123 --limit 20 --json
```

For publisher automation with `SIGLUME_API_KEY` / `cli_...`, prefer the
listing-scoped commands. Owner-scoped receipt commands read the signed-in
owner account and may require an owner/session credential in the target
environment.

## Python SDK

```python
import os

from siglume_api_sdk import SiglumeClient

with SiglumeClient(api_key=os.environ["SIGLUME_API_KEY"]) as client:
    # Seller-scoped, privacy-redacted receipts for a listing you publish.
    listing_receipts = client.list_listing_recent_receipts("listing_123", limit=20)

    stats = client.get_seller_listing_stats("listing_123")
    vitals = client.get_market_vitals()
```

`list_listing_recent_receipts()` is intentionally redacted. It is enough to see
that your listing ran, its status, timing, step counts, and support identifiers,
but it must not expose the buyer's private prompt or account details.

`list_execution_receipts()` is different: it reads the owner account's own
tool executions and currently requires an owner session bearer, not a
publisher CLI token.

## Installed Tool Evidence

If you are building owner tooling around installed capabilities, use the
installed-tool wrappers. These owner-scoped receipt routes require an
authenticated owner session bearer; they are not the same surface as
`SIGLUME_API_KEY` / `cli_...` publisher automation tokens. For publisher-side
listing receipts, use `siglume dev tail --listing-id <listing_id>` or
`list_listing_recent_receipts()`, which is the seller-scoped CLI/API-key path.

```python
import os

from siglume_api_sdk import SiglumeClient

client = SiglumeClient(api_key=os.environ["SIGLUME_OWNER_SESSION_BEARER"])

receipts = client.list_installed_tool_receipts(agent_id="agent_123", status="completed", limit=10)
receipt = client.get_installed_tool_receipt(receipts[0].receipt_id, agent_id="agent_123")
steps = client.get_installed_tool_receipt_steps(receipts[0].receipt_id, agent_id="agent_123")
```

See [Installed Tools Operations](./installed-tools-operations.md) for the full
wrapper list and parameter reference.

## Billing Checks

For operation-priced APIs:

1. Confirm the listing has `price_model="usage_based"` or
   `price_model="per_action"`.
2. Confirm `pricing_plan.items` contains the operation key.
3. Confirm the runtime returned that key in
   `ExecutionResult.receipt_summary["operation"]`.
4. Confirm free operations returned `amount_minor=0`.
5. For `billing_timing="prepay"`, confirm the quote/dry-run returned
   `billingPreview.operation` and `draftToken` before payment.
6. For action/payment APIs, confirm the live action response included
   committed provider evidence from the publisher API. The platform can verify
   payment and platform state, but it does not infer provider-specific delivery.

The platform charges from the plan item, not from arbitrary prose in the output.
If the receipt amount conflicts with the plan, the call is rejected instead of
charging an unplanned amount.

## Support Checklist

When debugging a buyer report, ask for or collect:

- `listing_id`
- `capability_key`
- `trace_id`
- `request_id`
- receipt id, if available
- operation key from `receipt_summary`
- whether the run was `dry_run`, `quote`, or live `action`
- provider-side committed evidence returned by your API, such as a post URL,
  message id, reservation id, order id, or equivalent stable id

Do not ask buyers for OAuth tokens, browser cookies, private prompts, card
details, or wallet keys.

For the responsibility split during support, see
[Platform / API Responsibility Boundary](./platform-api-boundary.md).
