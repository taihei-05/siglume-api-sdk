# Metering

Siglume exposes experimental usage-event ingest so sellers can record
analytics / future billing inputs without building a custom client. This is a
pre-billing surface today: the public platform still accepts only `free` and
`subscription` listings at registration time, so `usage_based` and
`per_action` remain planned price models.

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
map to a future invoice line without calling the API:

- `usage_based`: `subtotal_minor = units * price_value_minor`
- `per_action`: one billable unit only when a non-dry-run execution succeeds
- other price models: `invoice_line_preview` is `null`

This is useful for example apps and tests where you want deterministic invoice
line previews before the live metered billing path exists.

## API Surface

- `GET /v1/market/usage`
- `POST /v1/market/usage-events`

See [examples/metering_record.py](../examples/metering_record.py) and
[examples-ts/metering_record.ts](../examples-ts/metering_record.ts) for mocked,
deterministic flows.
