# Webhooks

Siglume API Store webhooks let sellers receive signed lifecycle events for subscriptions, payments, capability listing changes, and executions.

## Supported Events

- `subscription.created`
- `subscription.renewed`
- `subscription.cancelled`
- `subscription.paused`
- `subscription.reinstated`
- `refund.issued`
- `payment.succeeded`
- `payment.failed`
- `payment.disputed`
- `capability.published`
- `capability.delisted`
- `execution.completed`
- `execution.failed`

## Python

```python
import os

from siglume_api_sdk import InMemoryWebhookDedupe, WebhookHandler


handler = WebhookHandler(
    signing_secret=os.environ["SIGLUME_WEBHOOK_SECRET"],
    deduper=InMemoryWebhookDedupe(ttl_seconds=600),
)


@handler.on("subscription.created")
def on_subscription_created(event) -> None:
    print(event.data.get("subscription_id"))
```

`WebhookHandler.as_flask_view()` returns a Flask-compatible view that:

- verifies `Siglume-Signature` with HMAC-SHA256
- enforces a 5 minute timestamp tolerance
- validates optional `Siglume-Event-Id` and `Siglume-Event-Type` headers
- returns `duplicate=True` when the same `idempotency_key` is replayed through the dedupe helper

Lifecycle management is available on `SiglumeClient`:

`event_types` is required when creating a subscription. The SDK enforces a
non-empty list; the public OpenAPI enum and server define which event type
strings are supported.

```python
client.create_webhook_subscription(
    "https://hooks.example.com/siglume",
    event_types=["payment.succeeded", "execution.failed"],
    description="Ops alerts",
)
client.list_webhook_subscriptions()
client.get_webhook_subscription("whsub_123")
client.rotate_webhook_subscription_secret("whsub_123")
client.pause_webhook_subscription("whsub_123")
client.resume_webhook_subscription("whsub_123")
client.list_webhook_deliveries(limit=20)
client.redeliver_webhook_delivery("whdel_123")
client.send_test_webhook_delivery("payment.succeeded", data={"sequence": 1})
```

## TypeScript

```ts
import {
  InMemoryWebhookDedupe,
  WebhookHandler,
  type SiglumeWebhookEvent,
} from "@siglume/api-sdk";

const handler = new WebhookHandler({
  signing_secret: process.env.SIGLUME_WEBHOOK_SECRET!,
  deduper: new InMemoryWebhookDedupe({ ttl_seconds: 600 }),
});

handler.on("*", async (event: SiglumeWebhookEvent) => {
  switch (event.type) {
    case "payment.succeeded":
      console.log(event.data.amount_minor);
      break;
    case "execution.failed":
      console.log(event.data.reason_code);
      break;
    default:
      break;
  }
});
```

`WebhookHandler.asExpressHandler()` returns an Express-style handler that expects the raw request body so the signature is checked against the original bytes.

## Signing Details

- Header name: `Siglume-Signature`
- Format: `t=<unix_timestamp>,v1=<hex_hmac_sha256>`
- Signed payload: `"{timestamp}.{raw_request_body}"`
- Replay tolerance: 300 seconds by default

## Examples

- Python: [examples/webhook_handler_flask.py](../examples/webhook_handler_flask.py)
- TypeScript: [examples-ts/webhook_handler_express.ts](../examples-ts/webhook_handler_express.ts)
