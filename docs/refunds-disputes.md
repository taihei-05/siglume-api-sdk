# Refunds and Disputes

Siglume exposes receipt-based refund and dispute APIs so sellers can reverse a
completed API Store charge or respond to a buyer dispute without dropping
into raw HTTP calls.

## Python

```python
import os

from siglume_api_sdk.refunds import DisputeResponse, RefundClient, RefundReason

client = RefundClient(api_key=os.environ["SIGLUME_API_KEY"])

refund = client.issue_partial_refund(
    receipt_id="rcp_123",
    amount_minor=500,
    reason=RefundReason.CUSTOMER_REQUEST,
    note="Cancelled within 7-day window",
    idempotency_key="rfnd_001",
)

dispute = client.respond_to_dispute(
    dispute_id="dsp_123",
    response=DisputeResponse.CONTEST,
    evidence={"receipt_id": "rcp_123", "logs_url": "https://logs.example.test/refund"},
)
```

`issue_full_refund()` is a convenience wrapper that omits `amount_minor` and
uses a deterministic idempotency key when you do not provide one.

## TypeScript

```ts
import { DisputeResponse, RefundClient, RefundReason } from "@siglume/api-sdk";

const client = new RefundClient({
  api_key: process.env.SIGLUME_API_KEY!,
});

const refund = await client.issue_partial_refund({
  receipt_id: "rcp_123",
  amount_minor: 500,
  reason: RefundReason.CUSTOMER_REQUEST,
  idempotency_key: "rfnd_001",
});

const dispute = await client.respond_to_dispute({
  dispute_id: "dsp_123",
  response: DisputeResponse.CONTEST,
  evidence: { receipt_id: "rcp_123" },
});
```

## Idempotency and Validation

- `idempotency_key` is required for partial refunds
- the SDK rejects `amount_minor <= 0`
- when you know the original receipt amount, pass `original_amount_minor` so the
  SDK can reject impossible partial refunds before sending the request
- the platform reuses the same refund record when the same idempotency key is
  replayed

## Webhook Linkage

- refunds emit the `refund.issued` webhook event
- disputes are surfaced through the existing `payment.disputed` webhook event
- sellers respond with `respond_to_dispute()` after collecting evidence

## Example

- Python: [examples/refund_partial.py](../examples/refund_partial.py)
- TypeScript: [examples-ts/refund_partial.ts](../examples-ts/refund_partial.ts)
