import {
  build_webhook_signature_header,
  InMemoryWebhookDedupe,
  type PaymentSucceededEvent,
  WebhookHandler,
} from "../siglume-api-sdk-ts/src/index";

const EXAMPLE_SECRET = process.env.SIGLUME_WEBHOOK_SECRET ?? "whsec_example_secret";

export function buildExampleEvent() {
  return {
    id: "evt_payment_succeeded_demo",
    type: "payment.succeeded" as const,
    api_version: "2026-04-20",
    occurred_at: "2026-04-20T12:00:00Z",
    idempotency_key: "evt_payment_succeeded_demo",
    trace_id: "trc_webhook_demo",
    data: {
      subscription_id: "sub_demo_123",
      access_grant_id: "grant_demo_123",
      listing_id: "lst_demo_123",
      capability_key: "currency-converter-v2",
      buyer_user_id: "usr_buyer_demo",
      seller_user_id: "usr_seller_demo",
      billing_model: "subscription",
      currency: "USD",
      amount_minor: 1200,
      payment_status: "succeeded",
    },
  };
}

export function buildHandler(signing_secret = EXAMPLE_SECRET): WebhookHandler {
  const handler = new WebhookHandler({
    signing_secret,
    deduper: new InMemoryWebhookDedupe({ ttl_seconds: 600 }),
  });

  handler.on("payment.succeeded", async (event) => {
    if (event.type !== "payment.succeeded") {
      return;
    }
    const narrowed: PaymentSucceededEvent = event;
    console.log(`handled payment.succeeded for ${String(narrowed.data.subscription_id ?? "")}`);
  });

  return handler;
}

export async function runMockWebhookExpressExample(): Promise<string[]> {
  const event = buildExampleEvent();
  const rawBody = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureHeader = await build_webhook_signature_header(EXAMPLE_SECRET, rawBody, {
    timestamp,
  });

  const lines: string[] = [];
  const handler = new WebhookHandler({
    signing_secret: EXAMPLE_SECRET,
    deduper: new InMemoryWebhookDedupe({ ttl_seconds: 600 }),
  });

  handler.on("payment.succeeded", async (event) => {
    switch (event.type) {
      case "payment.succeeded":
        lines.push(`handled_type: ${event.type}`);
        lines.push(`amount_minor: ${String(event.data.amount_minor ?? "")}`);
        lines.push(`currency: ${String(event.data.currency ?? "")}`);
        break;
      default:
        break;
    }
  });

  const responses: Array<{ status: number; payload: unknown }> = [];
  const expressHandler = handler.asExpressHandler();

  const response = {
    code: 200,
    status(code: number) {
      this.code = code;
      return this;
    },
    json(payload: unknown) {
      responses.push({ status: this.code, payload });
      return payload;
    },
  };

  await expressHandler(
    {
      headers: {
        "content-type": "application/json",
        "siglume-signature": signatureHeader,
        "siglume-event-id": event.id,
        "siglume-event-type": event.type,
      },
      rawBody,
    },
    response,
  );
  await expressHandler(
    {
      headers: {
        "content-type": "application/json",
        "siglume-signature": signatureHeader,
        "siglume-event-id": event.id,
        "siglume-event-type": event.type,
      },
      rawBody,
    },
    response,
  );

  lines.unshift(`status: ${responses[0]?.status ?? 0}`);
  lines.push(`duplicate_on_replay: ${String((responses[1]?.payload as { duplicate?: boolean } | undefined)?.duplicate ?? false)}`);
  return lines;
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("webhook_handler_express.ts")) {
  const lines = await runMockWebhookExpressExample();
  for (const line of lines) {
    console.log(line);
  }
}
