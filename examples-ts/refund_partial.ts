/*
API: issue and inspect marketplace refunds for executed receipts.
Intended user: seller support or finance automation.
Connected account: none (refund settlement is handled by Siglume on the stored receipt).
*/
import { DisputeResponse, RefundClient, RefundReason } from "../siglume-api-sdk-ts/src/index";

const REFUND_POLICY_NOTE = "Refunds are issued against the original receipt. The seller can offer a partial refund within the cancellation window and the buyer is notified with the refund.issued webhook.";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({
    data,
    meta: { trace_id: "trc_refund", request_id: "req_refund" },
    error: null,
  }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function buildMockRefundClient(): RefundClient {
  const refundPayload = {
    id: "rfnd_demo_123",
    receipt_id: "rcp_demo_123",
    owner_user_id: "usr_demo_123",
    payment_mandate_id: "mand_demo_123",
    usage_event_id: "use_demo_123",
    chain_receipt_id: "chr_demo_123",
    amount_minor: 500,
    currency: "USD",
    status: "issued",
    reason_code: "customer-request",
    note: "Cancelled within 7-day window",
    idempotency_key: "rfnd_demo_001",
    on_chain_tx_hash: `0x${"ab".repeat(32)}`,
    metadata: { original_amount_minor: 1200, remaining_after_refund_minor: 700 },
    idempotent_replay: false,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
  };
  const disputePayload = {
    id: "dsp_demo_123",
    receipt_id: "rcp_demo_123",
    owner_user_id: "usr_demo_123",
    status: "contested",
    reason_code: "service-failure",
    description: "Buyer disputed the conversion result.",
    evidence: { receipt_id: "rcp_demo_123", logs_url: "https://logs.example.test/refund-demo" },
    response_decision: "contest",
    response_note: "Server-side audit logs confirm the conversion completed successfully.",
    responded_at: "2026-04-20T00:01:00Z",
    metadata: { trace_id: "trc_demo_refund" },
    idempotent_replay: false,
    created_at: "2026-04-20T00:00:30Z",
    updated_at: "2026-04-20T00:01:00Z",
  };

  return new RefundClient({
    api_key: process.env.SIGLUME_API_KEY ?? "sig_mock_key",
    base_url: "https://api.example.test/v1",
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/v1/market/refunds" && (init?.method ?? "GET") === "POST") {
        const payload = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        if (payload.receipt_id !== "rcp_demo_123" || payload.reason_code !== RefundReason.CUSTOMER_REQUEST) {
          throw new Error("unexpected refund payload");
        }
        return jsonResponse(refundPayload, 201);
      }
      if (url.pathname === "/v1/market/refunds" && (init?.method ?? "GET") === "GET") {
        return jsonResponse([refundPayload]);
      }
      if (url.pathname === "/v1/market/disputes/dsp_demo_123/respond" && (init?.method ?? "GET") === "POST") {
        const payload = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        if (payload.response !== DisputeResponse.CONTEST) {
          throw new Error("unexpected dispute payload");
        }
        return jsonResponse(disputePayload);
      }
      throw new Error(`Unexpected request: ${String(init?.method ?? "GET")} ${url.pathname}`);
    },
  });
}

export async function runRefundPartialExample(): Promise<string[]> {
  const client = buildMockRefundClient();
  const refund = await client.issue_partial_refund({
    receipt_id: "rcp_demo_123",
    amount_minor: 500,
    reason: RefundReason.CUSTOMER_REQUEST,
    note: "Cancelled within 7-day window",
    idempotency_key: "rfnd_demo_001",
    original_amount_minor: 1200,
  });
  const refundsForReceipt = await client.get_refunds_for_receipt("rcp_demo_123");
  const dispute = await client.respond_to_dispute({
    dispute_id: "dsp_demo_123",
    response: DisputeResponse.CONTEST,
    evidence: { receipt_id: "rcp_demo_123", logs_url: "https://logs.example.test/refund-demo" },
    note: "Server-side audit logs confirm the conversion completed successfully.",
  });
  return [
    `refund_note: ${REFUND_POLICY_NOTE}`,
    `refund_status: ${refund.status} replay=${String(refund.idempotent_replay)}`,
    `refund_tx: ${refund.on_chain_tx_hash}`,
    `refunds_for_receipt: ${refundsForReceipt.length}`,
    `dispute_status: ${dispute.status} response=${dispute.response_decision}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("refund_partial.ts")) {
  const lines = await runRefundPartialExample();
  for (const line of lines) {
    console.log(line);
  }
}
