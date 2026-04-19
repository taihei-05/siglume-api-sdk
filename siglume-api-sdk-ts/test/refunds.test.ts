import { describe, expect, it } from "vitest";

import {
  DisputeResponse,
  RefundClient,
  RefundReason,
  SiglumeClient,
  SiglumeClientError,
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

function envelope(data: unknown, meta: Record<string, unknown> = { request_id: "req_refund", trace_id: "trc_refund" }) {
  return { data, meta, error: null };
}

describe("refunds", () => {
  it("issues a partial refund and resolves receipt helpers", async () => {
    const refundPayload = {
      id: "rfnd_123",
      receipt_id: "rcp_123",
      owner_user_id: "usr_123",
      amount_minor: 500,
      currency: "USD",
      status: "issued",
      reason_code: "customer-request",
      idempotency_key: "rfnd_001",
      on_chain_tx_hash: `0x${"ab".repeat(32)}`,
      metadata: { original_amount_minor: 1200 },
      idempotent_replay: false,
    };
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/refunds" && (init?.method ?? "GET") === "POST") {
          const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
          expect(body.amount_minor).toBe(500);
          return new Response(JSON.stringify(envelope(refundPayload)), { status: 201 });
        }
        if (url.pathname === "/v1/market/refunds" && (init?.method ?? "GET") === "GET") {
          expect(url.searchParams.get("receipt_id")).toBe("rcp_123");
          return new Response(JSON.stringify(envelope([refundPayload])), { status: 200 });
        }
        if (url.pathname === "/v1/market/refunds/rfnd_123") {
          return new Response(JSON.stringify(envelope(refundPayload)), { status: 200 });
        }
        throw new Error(`Unexpected request: ${String(init?.method ?? "GET")} ${url.pathname}`);
      },
    });

    const refund = await client.issue_partial_refund({
      receipt_id: "rcp_123",
      amount_minor: 500,
      reason: RefundReason.CUSTOMER_REQUEST,
      note: "Cancelled within 7-day window",
      idempotency_key: "rfnd_001",
      original_amount_minor: 1200,
    });
    const listed = await client.get_refunds_for_receipt("rcp_123");
    const fetched = await client.get_refund("rfnd_123");

    expect(refund.refund_id).toBe("rfnd_123");
    expect(listed[0]?.refund_id).toBe("rfnd_123");
    expect(fetched.on_chain_tx_hash).toBe(refund.on_chain_tx_hash);
  });

  it("uses a deterministic idempotency key for full refunds", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (_input, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        expect(body.idempotency_key).toBe("full-refund:rcp_full");
        expect(body.amount_minor).toBeUndefined();
        return new Response(JSON.stringify(envelope({
          id: "rfnd_full",
          receipt_id: "rcp_full",
          amount_minor: 1200,
          currency: "USD",
          status: "issued",
          reason_code: "service-failure",
          idempotency_key: body.idempotency_key,
          metadata: {},
          idempotent_replay: false,
        })), { status: 201 });
      },
    });

    const refund = await client.issue_full_refund({
      receipt_id: "rcp_full",
      reason: RefundReason.SERVICE_FAILURE,
    });

    expect(refund.refund_id).toBe("rfnd_full");
    expect(refund.reason_code).toBe("service-failure");
  });

  it("guards partial refund amounts against the original receipt amount", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.issue_partial_refund({
      receipt_id: "rcp_guard",
      amount_minor: 1500,
      idempotency_key: "rfnd_guard",
      original_amount_minor: 1200,
    })).rejects.toBeInstanceOf(SiglumeClientError);
  });

  it("lists disputes and responds with typed records", async () => {
    const disputePayload = {
      id: "dsp_123",
      receipt_id: "rcp_123",
      owner_user_id: "usr_123",
      status: "contested",
      reason_code: "service-failure",
      description: "Buyer disputed the conversion result.",
      evidence: { receipt_id: "rcp_123" },
      response_decision: "contest",
      response_note: "Audit logs confirm the execution succeeded.",
      metadata: { trace_id: "trc_dispute" },
      idempotent_replay: false,
    };
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/disputes" && (init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify(envelope([disputePayload])), { status: 200 });
        }
        if (url.pathname === "/v1/market/disputes/dsp_123" && (init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify(envelope(disputePayload)), { status: 200 });
        }
        if (url.pathname === "/v1/market/disputes/dsp_123/respond" && (init?.method ?? "GET") === "POST") {
          const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
          expect(body.response).toBe(DisputeResponse.CONTEST);
          return new Response(JSON.stringify(envelope(disputePayload)), { status: 200 });
        }
        throw new Error(`Unexpected request: ${String(init?.method ?? "GET")} ${url.pathname}`);
      },
    });

    const disputes = await client.list_disputes({ receipt_id: "rcp_123" });
    const fetched = await client.get_dispute("dsp_123");
    const responded = await client.respond_to_dispute({
      dispute_id: "dsp_123",
      response: DisputeResponse.CONTEST,
      evidence: { receipt_id: "rcp_123", logs_url: "https://logs.example.test/refund" },
    });

    expect(disputes[0]?.dispute_id).toBe("dsp_123");
    expect(fetched.status).toBe("contested");
    expect(responded.response_decision).toBe("contest");
  });

  it("requires evidence to be an object when responding to disputes", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.respond_to_dispute({
      dispute_id: "dsp_invalid",
      response: DisputeResponse.ACCEPT,
      evidence: [] as unknown as Record<string, unknown>,
    })).rejects.toBeInstanceOf(SiglumeClientError);
  });

  it("reuses the typed surface through RefundClient", async () => {
    const client = new RefundClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response(JSON.stringify(envelope({
        id: "rfnd_wrap",
        receipt_id: "rcp_wrap",
        amount_minor: 250,
        currency: "USD",
        status: "issued",
        reason_code: "duplicate",
        idempotency_key: "rfnd_wrap_001",
        metadata: {},
        idempotent_replay: false,
      })), { status: 201 }),
    });

    const refund = await client.issue_partial_refund({
      receipt_id: "rcp_wrap",
      amount_minor: 250,
      reason: RefundReason.DUPLICATE,
      idempotency_key: "rfnd_wrap_001",
    });

    expect(refund.refund_id).toBe("rfnd_wrap");
    expect(refund.reason_code).toBe("duplicate");
  });

  it("covers the remaining RefundClient helpers", async () => {
    const refundPayload = {
      id: "rfnd_wrap_2",
      receipt_id: "rcp_wrap_2",
      amount_minor: 1200,
      currency: "USD",
      status: "issued",
      reason_code: "service-failure",
      idempotency_key: "full-refund:rcp_wrap_2",
      metadata: {},
      idempotent_replay: false,
    };
    const disputePayload = {
      id: "dsp_wrap_2",
      receipt_id: "rcp_wrap_2",
      status: "accepted",
      reason_code: "service-failure",
      evidence: { receipt_id: "rcp_wrap_2" },
      response_decision: "accept",
      metadata: {},
      idempotent_replay: false,
    };
    const client = new RefundClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/refunds" && (init?.method ?? "GET") === "POST") {
          return new Response(JSON.stringify(envelope(refundPayload)), { status: 201 });
        }
        if (url.pathname === "/v1/market/refunds" && (init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify(envelope([refundPayload])), { status: 200 });
        }
        if (url.pathname === "/v1/market/refunds/rfnd_wrap_2") {
          return new Response(JSON.stringify(envelope(refundPayload)), { status: 200 });
        }
        if (url.pathname === "/v1/market/disputes" && (init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify(envelope([disputePayload])), { status: 200 });
        }
        if (url.pathname === "/v1/market/disputes/dsp_wrap_2" && (init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify(envelope(disputePayload)), { status: 200 });
        }
        throw new Error(`Unexpected request: ${String(init?.method ?? "GET")} ${url.pathname}`);
      },
    });

    const full = await client.issue_full_refund({ receipt_id: "rcp_wrap_2" });
    const listed = await client.list_refunds();
    const fetched = await client.get_refund("rfnd_wrap_2");
    const disputes = await client.list_disputes();
    const dispute = await client.get_dispute("dsp_wrap_2");
    client.close();

    expect(full.refund_id).toBe("rfnd_wrap_2");
    expect(listed).toHaveLength(1);
    expect(fetched.receipt_id).toBe("rcp_wrap_2");
    expect(disputes[0]?.dispute_id).toBe("dsp_wrap_2");
    expect(dispute.status).toBe("accepted");
  });
});
