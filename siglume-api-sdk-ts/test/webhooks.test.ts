import { describe, expect, it } from "vitest";

import {
  build_webhook_signature_header,
  InMemoryWebhookDedupe,
  SiglumeClient,
  SiglumeClientError,
  SiglumeWebhookError,
  SiglumeWebhookPayloadError,
  SiglumeWebhookReplayError,
  SiglumeWebhookSignatureError,
  type ExpressLikeRequest,
  type ExpressLikeResponse,
  parse_webhook_delivery,
  parse_webhook_event,
  parse_webhook_subscription,
  verify_webhook_signature,
  WebhookHandler,
} from "../src/index";

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(String(input));
}

function envelope(data: unknown, meta: Record<string, unknown> = { request_id: "req_webhook", trace_id: "trc_webhook" }) {
  return { data, meta, error: null };
}

function buildEvent(type = "subscription.created") {
  return {
    id: "evt_demo_123",
    type,
    api_version: "2026-04-20",
    occurred_at: "2026-04-20T12:00:00Z",
    idempotency_key: "evt_demo_123",
    trace_id: "trc_demo_123",
    data: {
      subscription_id: "sub_demo_123",
      access_grant_id: "grant_demo_123",
      listing_id: "lst_demo_123",
      capability_key: "currency-converter-v2",
      currency: "USD",
      amount_minor: 1200,
      payment_status: "succeeded",
    },
  };
}

describe("webhooks", () => {
  it("verifies signed payloads and parses typed events", async () => {
    const event = buildEvent();
    const rawBody = JSON.stringify(event);
    const signatureHeader = await build_webhook_signature_header("whsec_test_secret", rawBody, {
      timestamp: 1713571200,
    });

    const verification = await verify_webhook_signature("whsec_test_secret", rawBody, signatureHeader, {
      now: 1713571200,
    });
    const parsed = parse_webhook_event(event);

    expect(verification.timestamp).toBe(1713571200);
    expect(parsed.type).toBe("subscription.created");
    expect(parsed.data.subscription_id).toBe("sub_demo_123");
  });

  it("dispatches once and marks replayed idempotency keys as duplicate", async () => {
    const event = buildEvent();
    const rawBody = JSON.stringify(event);
    const signatureHeader = await build_webhook_signature_header("whsec_test_secret", rawBody, {
      timestamp: 1713571200,
    });
    const seen: string[] = [];
    const handler = new WebhookHandler({
      signing_secret: "whsec_test_secret",
      deduper: new InMemoryWebhookDedupe({ ttl_seconds: 600 }),
    });
    handler.on("subscription.created", async (typedEvent) => {
      if (typedEvent.type === "subscription.created") {
        seen.push(String(typedEvent.data.subscription_id ?? ""));
      }
    });

    const first = await handler.handle(rawBody, {
      "siglume-signature": signatureHeader,
      "siglume-event-id": event.id,
      "siglume-event-type": event.type,
    }, { now: 1713571200 });
    const second = await handler.handle(rawBody, {
      "siglume-signature": signatureHeader,
      "siglume-event-id": event.id,
      "siglume-event-type": event.type,
    }, { now: 1713571200 });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(seen).toEqual(["sub_demo_123"]);
  });

  it("rejects stale timestamps and mismatched headers", async () => {
    const event = buildEvent();
    const rawBody = JSON.stringify(event);
    const signatureHeader = await build_webhook_signature_header("whsec_test_secret", rawBody, {
      timestamp: 1713571200,
    });
    const handler = new WebhookHandler({ signing_secret: "whsec_test_secret" });

    await expect(
      handler.handle(rawBody, { "siglume-signature": signatureHeader }, { now: 1713571801 }),
    ).rejects.toBeInstanceOf(SiglumeWebhookSignatureError);
    await expect(
      handler.handle(rawBody, {
        "siglume-signature": signatureHeader,
        "siglume-event-id": event.id,
        "siglume-event-type": "payment.failed",
      }, { now: 1713571200 }),
    ).rejects.toBeInstanceOf(SiglumeWebhookPayloadError);
    await expect(
      handler.handle(rawBody, {
        "siglume-signature": signatureHeader,
        "siglume-event-id": "evt_other",
        "siglume-event-type": event.type,
      }, { now: 1713571200 }),
    ).rejects.toBeInstanceOf(SiglumeWebhookPayloadError);
  });

  it("rejects missing signature headers and unsupported handler registrations", async () => {
    const handler = new WebhookHandler({ signing_secret: "whsec_test_secret" });
    const event = buildEvent();

    await expect(
      handler.verify(JSON.stringify(event), { "content-type": "application/json" }, { now: 1713571200 }),
    ).rejects.toBeInstanceOf(SiglumeWebhookSignatureError);

    expect(
      () => (handler as unknown as { on: (event_type: string, cb: () => Promise<void>) => unknown })
        .on("unknown.event", async () => undefined),
    ).toThrow(SiglumeWebhookError);
    expect(() => new WebhookHandler({ signing_secret: "" })).toThrow(SiglumeWebhookSignatureError);
  });

  it("maps express verification failures to 401 and payload failures to 400", async () => {
    const event = buildEvent();
    const rawBody = JSON.stringify(event);
    const handler = new WebhookHandler({ signing_secret: "whsec_test_secret" });
    const expressHandler = handler.asExpressHandler();
    const responses: Array<{ status: number; payload: unknown }> = [];
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
          "siglume-signature": "t=1713571200,v1=deadbeef",
        },
        rawBody,
      },
      response,
    );
    await expressHandler(
      {
        headers: {
          "content-type": "application/json",
        },
        body: event,
      },
      response,
    );
    await expressHandler(
      {
        headers: {
          "content-type": "application/json",
        },
      },
      response,
    );

    expect(responses[0]).toMatchObject({ status: 401 });
    expect(responses[1]).toMatchObject({ status: 400 });
    expect(responses[2]).toMatchObject({ status: 400 });
  });

  it("maps replay failures to 409 in express adapters", async () => {
    const handler = new WebhookHandler({ signing_secret: "whsec_test_secret" });
    const expressHandler = handler.asExpressHandler();
    const responses: Array<{ status: number; payload: unknown }> = [];
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
    const replayHandler = handler as WebhookHandler & {
      handle: (body: unknown, headers: unknown) => Promise<never>;
    };
    replayHandler.handle = async () => {
      throw new SiglumeWebhookReplayError("duplicate");
    };

    await expressHandler(
      {
        headers: {},
        rawBody: "{}",
      },
      response,
    );

    expect(responses[0]).toMatchObject({ status: 409 });
  });

  it("rethrows unexpected express adapter errors", async () => {
    const handler = new WebhookHandler({ signing_secret: "whsec_test_secret" });
    const expressHandler = handler.asExpressHandler();
    const unexpectedHandler = handler as WebhookHandler & {
      handle: (body: unknown, headers: unknown) => Promise<never>;
    };
    unexpectedHandler.handle = async () => {
      throw new Error("boom");
    };

    await expect(expressHandler({ headers: {}, rawBody: "{}" }, {
      status() {
        return this;
      },
      json(payload: unknown) {
        return payload;
      },
    })).rejects.toThrow("boom");
  });

  it("accepts equivalent express raw-body representations", async () => {
    const event = buildEvent("payment.succeeded");
    const rawBody = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signatureHeader = await build_webhook_signature_header("whsec_test_secret", rawBody, {
      timestamp,
    });
    const handler = new WebhookHandler({ signing_secret: "whsec_test_secret" });
    const expressHandler = handler.asExpressHandler();

    const variants: ExpressLikeRequest[] = [
      {
        headers: { "siglume-signature": signatureHeader, "siglume-event-id": event.id, "siglume-event-type": event.type },
        rawBody: new TextEncoder().encode(rawBody).buffer,
      },
      {
        headers: { "siglume-signature": signatureHeader, "siglume-event-id": event.id, "siglume-event-type": event.type },
        rawBody: Buffer.from(rawBody, "utf-8"),
      },
      {
        headers: { "siglume-signature": signatureHeader, "siglume-event-id": event.id, "siglume-event-type": event.type },
        body: rawBody,
      },
    ];

    for (const request of variants) {
      const responses: Array<{ status: number; payload: unknown }> = [];
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
      } as ExpressLikeResponse & { code: number };
      await expressHandler(request, response);
      expect(responses[0]).toMatchObject({ status: 200 });
    }
  });

  it("parses lifecycle records and client wrappers", async () => {
    const event = buildEvent("payment.succeeded");
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url.pathname === "/v1/market/webhooks/subscriptions" && method === "GET" && url.search === "") {
          return new Response(JSON.stringify(envelope([
            {
              id: "whsub_123",
              owner_user_id: "usr_123",
              callback_url: "https://hooks.example.test/siglume",
              status: "active",
              event_types: ["payment.succeeded"],
              metadata: { env: "test" },
            },
          ])), { status: 200 });
        }
        if (url.pathname === "/v1/market/webhooks/subscriptions" && method === "POST") {
          return new Response(JSON.stringify(envelope({
            id: "whsub_123",
            owner_user_id: "usr_123",
            callback_url: "https://hooks.example.test/siglume",
            status: "active",
            event_types: ["payment.succeeded"],
            signing_secret: "whsec_live_123",
            metadata: { env: "test" },
          })), { status: 201 });
        }
        if (url.pathname === "/v1/market/webhooks/subscriptions/whsub_123") {
          return new Response(JSON.stringify(envelope({
            id: "whsub_123",
            owner_user_id: "usr_123",
            callback_url: "https://hooks.example.test/siglume",
            status: "active",
            event_types: ["payment.succeeded"],
            metadata: { env: "test" },
          })), { status: 200 });
        }
        if (url.pathname.endsWith("/rotate-secret")) {
          return new Response(JSON.stringify(envelope({
            id: "whsub_123",
            owner_user_id: "usr_123",
            callback_url: "https://hooks.example.test/siglume",
            status: "active",
            event_types: ["payment.succeeded"],
            signing_secret: "whsec_rotated_123",
            signing_secret_hint: "rotated12",
            metadata: { env: "test" },
          })), { status: 200 });
        }
        if (url.pathname.endsWith("/pause") || url.pathname.endsWith("/resume")) {
          return new Response(JSON.stringify(envelope({
            id: "whsub_123",
            owner_user_id: "usr_123",
            callback_url: "https://hooks.example.test/siglume",
            status: url.pathname.endsWith("/pause") ? "paused" : "active",
            event_types: ["payment.succeeded"],
            metadata: { env: "test" },
          })), { status: 200 });
        }
        if (url.pathname === "/v1/market/webhooks/deliveries") {
          return new Response(JSON.stringify(envelope([
            {
              id: "whdel_123",
              subscription_id: "whsub_123",
              event_id: "evt_demo_123",
              event_type: "payment.succeeded",
              idempotency_key: "evt_demo_123",
              callback_url: "https://hooks.example.test/siglume",
              delivery_status: "delivered",
              attempt_count: 1,
              request_headers: { "siglume-signature": "t=1,v1=abc" },
              request_body: event,
              response_headers: { "x-mock": "ok" },
            },
          ])), { status: 200 });
        }
        if (url.pathname === "/v1/market/webhooks/deliveries/whdel_123/redeliver") {
          return new Response(JSON.stringify(envelope({
            id: "whdel_123",
            subscription_id: "whsub_123",
            event_id: "evt_demo_123",
            event_type: "payment.succeeded",
            idempotency_key: "evt_demo_123",
            callback_url: "https://hooks.example.test/siglume",
            delivery_status: "delivered",
            attempt_count: 2,
            request_headers: { "siglume-signature": "t=1,v1=abc" },
            request_body: event,
            response_headers: { "x-mock": "ok" },
          })), { status: 200 });
        }
        if (url.pathname === "/v1/market/webhooks/test-deliveries") {
          return new Response(JSON.stringify(envelope({ queued: true, event })), { status: 202 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const created = await client.create_webhook_subscription({
      callback_url: "https://hooks.example.test/siglume",
      event_types: ["payment.succeeded"],
      metadata: { env: "test" },
    });
    const listed = await client.list_webhook_subscriptions();
    const fetched = await client.get_webhook_subscription("whsub_123");
    const rotated = await client.rotate_webhook_subscription_secret("whsub_123");
    const paused = await client.pause_webhook_subscription("whsub_123");
    const resumed = await client.resume_webhook_subscription("whsub_123");
    const deliveries = await client.list_webhook_deliveries({ limit: 5 });
    const redelivered = await client.redeliver_webhook_delivery("whdel_123");
    const queued = await client.send_test_webhook_delivery({ event_type: "payment.succeeded" });

    expect(created.signing_secret).toBe("whsec_live_123");
    expect(listed).toHaveLength(1);
    expect(fetched.subscription_id).toBe("whsub_123");
    expect(rotated.signing_secret).toBe("whsec_rotated_123");
    expect(paused.status).toBe("paused");
    expect(resumed.status).toBe("active");
    expect(deliveries[0]?.event_type).toBe("payment.succeeded");
    expect(redelivered.attempt_count).toBe(2);
    expect(queued.event.type).toBe("payment.succeeded");
  });

  it("requires a non-empty event_types array when creating subscriptions", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.create_webhook_subscription({
      callback_url: "https://hooks.example.test/siglume",
      event_types: [],
    })).rejects.toBeInstanceOf(SiglumeClientError);
  });

  it("exports parse helpers for standalone records", () => {
    const subscription = parse_webhook_subscription({
      id: "whsub_123",
      owner_user_id: "usr_123",
      callback_url: "https://hooks.example.test/siglume",
      status: "active",
      event_types: ["subscription.created"],
      metadata: { env: "test" },
    });
    const delivery = parse_webhook_delivery({
      id: "whdel_123",
      subscription_id: "whsub_123",
      event_id: "evt_demo_123",
      event_type: "subscription.created",
      idempotency_key: "evt_demo_123",
      callback_url: "https://hooks.example.test/siglume",
      delivery_status: "delivered",
      attempt_count: 1,
      request_headers: { "siglume-signature": "t=1,v1=abc" },
      request_body: { id: "evt_demo_123" },
      response_headers: { "x-mock": "ok" },
    });

    expect(subscription.subscription_id).toBe("whsub_123");
    expect(delivery.delivery_id).toBe("whdel_123");
  });

  it("rejects unknown webhook event types", () => {
    expect(() => parse_webhook_event({
      id: "evt_demo_123",
      type: "unknown.event",
      api_version: "2026-04-20",
      occurred_at: "2026-04-20T12:00:00Z",
      idempotency_key: "evt_demo_123",
      data: {},
    })).toThrow(SiglumeWebhookPayloadError);
  });
});
