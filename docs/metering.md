# Metering And Operation-Based Billing

Siglume now has two related but separate surfaces:

- `usage_based` / `per_action` listing billing is live for API Store and Game
  API Store capabilities. These listings are free to invoke up front. The
  execution result identifies which operation ran, and the matching
  `pricing_plan` item sets the charge.
- `MeterClient` remains an analytics / external usage-event ingest helper. It
  records usage rows and supports deterministic invoice previews, but it is not
  the normal runtime charge path for a `cap_*` tool call.

Use post-execution billing when one capability has free operations and paid
operations, or when the amount depends on what the API actually did. Example:
connection check = 0 JPY, dry-run preview = 0 JPY, text post = 15 JPY, URL post
= 20 JPY, reply = 30 JPY.

For irreversible side effects, use `billing_timing="prepay"` so the platform
quotes the operation, collects payment, and only then calls the live action. See
[Pricing And Billing](./pricing-and-billing.md) for the end-to-end contract.

For JPY/JPYC listings, a paid operation must be either `0` or at least `15`
minor units. `0` is valid for free operations. Positive amounts below `15` are
rejected by the SDK and by the platform.

## Runtime Billing Contract

Declare the listing as `PriceModel.USAGE_BASED` or `PriceModel.PER_ACTION`.
Set `price_value_minor=0` when prices vary per operation, then publish a
buyer-facing `pricing_plan`. `pricing_plan.items` is required for
`usage_based` and `per_action` listings:

```python
manifest = AppManifest(
    # ...required fields...
    price_model=PriceModel.PER_ACTION,
    price_value_minor=0,
    currency="JPY",
    pricing_plan={
        "display_name": "X post operation prices",
        "currency": "JPY",
        "free_upfront_invocation": True,
        "items": [
            {"key": "connection_check", "label": "Connection check", "price_minor": 0},
            {"key": "dry_run", "label": "Dry-run preview", "price_minor": 0},
            {"key": "text_post", "label": "Text post", "price_minor": 15},
            {"key": "url_post", "label": "URL post", "price_minor": 20},
            {"key": "reply", "label": "Reply", "price_minor": 30},
        ],
    },
)
```

After execution, return the operation that actually ran in `ExecutionResult`.
The platform uses that operation to select the matching `pricing_plan` item:

```python
return ExecutionResult(
    success=True,
    output={"posted": True, "post_url": "https://x.com/..."},
    units_consumed=1,
    amount_minor=20,
    currency="JPY",
    receipt_summary={
        "operation": "url_post",
        "amount_minor": 20,
        "currency": "JPY",
    },
)
```

The `pricing_plan` is authoritative. If the receipt identifies `url_post`, the
platform charges the `url_post` plan price. If the API returns a conflicting
positive amount, the call is rejected instead of using the arbitrary amount.
If the matched plan item is `0`, no on-chain payment is created. A positive
receipt without a matching plan item is not billable.
`units_consumed` is recorded for receipts/analytics and does not multiply a
request-type price unless a future explicit metered-quantity plan is introduced.

Use stable idempotency keys in your API and receipt metadata so repeated calls
can be reconciled without double-charging.

## Python

```python
from siglume_api_sdk.metering import MeterClient, UsageRecord

meter = MeterClient(api_key="sig_live_...")

result = meter.record(
    UsageRecord(
        capability_key="translation-hub",
        dimension="tokens_in",
        units=1523,
        external_id="evt_usage_001",
        occurred_at_iso="2026-04-19T10:00:00Z",
        agent_id="agent_123",
    )
)

page = meter.list_usage_events(capability_key="translation-hub", period_key="202604")
```

`record()` returns an acceptance receipt, not a charge confirmation:

- `accepted`: the platform received the usage event
- `external_id`: your idempotency key alias
- `server_id`: Siglume-side usage row id when available
- `replayed`: `True` when the same `external_id` reused an existing event

`record_batch()` chunks client-side at `1000` events per request.

## TypeScript

```ts
import { MeterClient } from "@siglume/api-sdk";

const meter = new MeterClient({ api_key: process.env.SIGLUME_API_KEY! });

await meter.record({
  capability_key: "translation-hub",
  dimension: "tokens_in",
  units: 1523,
  external_id: "evt_usage_001",
  occurred_at_iso: "2026-04-19T10:00:00Z",
  agent_id: "agent_123",
});
```

## Harness Preview

Use `AppTestHarness.simulate_metering(...)` to preview how a usage record would
map to an invoice line without calling the API:

- `usage_based`: `subtotal_minor = units * price_value_minor`
- `per_action`: one billable unit only when a non-dry-run execution succeeds
- other price models: `invoice_line_preview` is `null`

This is useful for example apps and tests where you want deterministic invoice
line previews.

## API Surface

- `GET /v1/market/usage`
- `POST /v1/market/usage-events`

See [examples/metering_record.py](../examples/metering_record.py) and
[examples-ts/metering_record.ts](../examples-ts/metering_record.ts) for mocked,
deterministic flows.
