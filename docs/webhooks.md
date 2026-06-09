# Webhooks

Siglume API Store webhooks let sellers receive signed lifecycle events for subscriptions, payments, capability listing changes, executions, and generic reward payouts.

## Supported Events

- `subscription.created`
- `subscription.renewed`
- `subscription.cancelled`
- `subscription.paused`
- `subscription.reinstated`
- `payment.succeeded`
- `payment.failed`
- `capability.published`
- `capability.delisted`
- `execution.completed`
- `execution.failed`
- `reward_payout.created`
- `reward_payout.provider_pending`
- `reward_paid`
- `reward_payout.failed`
- `reward_payout.cancelled`

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


@handler.on("reward_paid")
def on_reward_paid(event) -> None:
    # Treat this signed webhook as the source of truth for payout completion.
    print(event.data.get("reward_payout_request_id"))
```

`WebhookHandler.as_flask_view()` returns a Flask-compatible view that:

- verifies `Siglume-Signature` with HMAC-SHA256
- enforces a 5 minute timestamp tolerance
- validates optional `Siglume-Event-Id` and `Siglume-Event-Type` headers
- returns `duplicate=True` when the same `idempotency_key` is replayed through the dedupe helper

Lifecycle helpers are available on `SiglumeClient`, but the current production
webhook subscription routes are signed-in Developer Portal routes. They use
the normal `Authorization: Bearer ...` header, but they do not accept
`SIGLUME_API_KEY` / `cli_...` automation tokens today. Register or rotate
webhook subscriptions from an authenticated portal/session context, and do not
send MCP `mcpsk_...` tokens to these routes.

`event_types` is required when creating a subscription and must contain at least one supported webhook event type.

```python
import os

from siglume_api_sdk import SiglumeClient


client = SiglumeClient(
    # Session-auth only for the current production webhook routes.
    # Do not put a cli_... API key or mcpsk_... MCP token here.
    api_key=os.environ["SIGLUME_PORTAL_SESSION_BEARER"],
)

client.create_webhook_subscription(
    "https://hooks.example.com/siglume",
    event_types=[
        "reward_payout.created",
        "reward_payout.provider_pending",
        "reward_paid",
        "reward_payout.failed",
        "reward_payout.cancelled",
    ],
    description="Reward payout lifecycle",
)
client.list_webhook_subscriptions()
client.list_webhook_deliveries(limit=20)
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
    case "reward_paid":
      console.log(event.data.reward_payout_request_id);
      break;
    default:
      break;
  }
});
```

For reward payouts, your API should mark its local payout row as paid only
after verifying a signed `reward_paid` event. Earlier states such as
`reward_payout.created` or `reward_payout.provider_pending` are useful for
audit and reconciliation, but they are not completion.

`WebhookHandler.asExpressHandler()` returns an Express-style handler that expects the raw request body so the signature is checked against the original bytes.

## Signing Details

- Header name: `Siglume-Signature`
- Format: `t=<unix_timestamp>,v1=<hex_hmac_sha256>`
- Signed payload: `"{timestamp}.{raw_request_body}"`
- Replay tolerance: 300 seconds by default

## Examples

- Python: [examples/webhook_handler_flask.py](../examples/webhook_handler_flask.py)
- TypeScript: [examples-ts/webhook_handler_express.ts](../examples-ts/webhook_handler_express.ts)
