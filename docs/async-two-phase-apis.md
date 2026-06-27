# Build an async / long-running two-phase API (deferred settlement)

Most paid APIs answer within the invoke timeout (`runtime_validation.timeout_seconds`
clamps to 1–20s, default 10 — see [Getting Started](../GETTING_STARTED.md)). If your
work cannot finish in that window — long audio/video transcription, batch rendering,
a multi-minute analysis — you cannot return the result inline. Instead you **accept
the job, settle the charge, and deliver the result later** through a separate **free
terminal operation**.

This is the *async two-phase* pattern. It reuses the normal prepay machinery; the only
differences are (a) the action leg returns a **job-acceptance envelope** instead of the
finished result, and (b) a later **free** op returns the artifacts. Read
[Pricing and Billing](./pricing-and-billing.md) for the synchronous prepay contract
first — everything there still applies.

> If your action finishes inline (posting to X, sending an email), you do **not** need
> this doc. Return committed evidence directly per
> [Platform / API boundary](./platform-api-boundary.md). Async is only for work that
> outlives the request.

## The three legs at a glance

| Leg | `execution_kind` | `output` carries | `receipt_summary.operation` | `amount_minor` | Charged? |
|---|---|---|---|---|---|
| 1. Quote / dry-run | `quote` / `dry_run` | `billingPreview` (the chargeable band) + `draftToken` | `"quote"` / `"dry_run"` — the leg's **own** op, **not** the band | `0` | No (free) |
| 2. Action (accept) | `action` | `{ "accepted": true, "job_id": "...", "status": "queued" }` — **not** the finished result | the executed band (e.g. `"transcribe_0_15"`) | the plan price | **Yes** — settled on acceptance |
| 3. Terminal result | `action` (a 0-priced op) | the real artifacts | the terminal op's **own** name (e.g. `"get_result"`) | `0` | No (free) |

Two rules cause almost every async integration bug, so state them to yourself before you write code:

1. **The chargeable band lives in `output.billingPreview.operation` on the QUOTE leg.**
   It is **not** in `receipt_summary.operation` — on the quote leg that field is the
   literal `"quote"`/`"dry_run"`. (See the wire shape below; this is the exact mismatch
   that silently broke nested-output publishers.)
2. **`accepted: true` + `job_id` + `status: "queued"` is an *accepted, deferred* result —
   not a failure and not a non-delivery.** The platform settles the charge and records
   the job as accepted; it does not wait for your job to finish.

## The ExecutionResult wire shape (output is nested, receipt_summary is hoisted)

The platform keeps everything your handler returns in `output={...}` **nested** under
`output`, while `receipt_summary` is hoisted to a **sibling top-level key**. So:

- `billingPreview` is read at **`result.output.billingPreview`** — never `result.billingPreview`.
- `receipt_summary` is read at **`result.receipt_summary`** (top level), never inside `output`.

(Normative source: `normalizeExecutionResult` in `siglume-api-sdk-ts/src/runtime.ts` and
`buildExecutionResult` in `src/buyer.ts`. A flat/legacy publisher that hoists
`billingPreview` to the top level also works — the platform reads both — but **return
the nested shape**; it is the documented contract.)

```jsonc
// LEG 1 — QUOTE (free). The band to charge is in output.billingPreview.operation.
{
  "success": true,
  "execution_kind": "quote",
  "output": {
    "billingPreview": { "operation": "transcribe_0_15", "priceMinorIfActionSucceeds": 80, "currency": "JPY" },
    "draftToken": "bx4xUKyq…"
  },
  "amount_minor": 0,
  "currency": "JPY",
  "receipt_summary": { "operation": "quote", "amount_minor": 0, "currency": "JPY" }
  //                                  ^^^^^^^ the quote leg's OWN op — NOT the band. Do not put the band here.
}
```

```jsonc
// LEG 2 — ACTION (accept the job; this is where the buyer is charged).
{
  "success": true,
  "execution_kind": "action",
  "output": { "accepted": true, "job_id": "job_2872b04495de33bbd78cfa77", "status": "queued" },
  //          ^^^^^^^^^^^^^^^^ accepted + job_id + queued = ACCEPTED, DEFERRED. Not the finished result.
  "amount_minor": 80,
  "currency": "JPY",
  "receipt_summary": { "operation": "transcribe_0_15", "amount_minor": 80, "currency": "JPY" }
  //                                  ^^^^^^^^^^^^^^^^ the executed band — MUST equal the quoted billingPreview.operation
}
```

```jsonc
// LEG 3 — get_result (free terminal op). No billingPreview, amount_minor 0, returns artifacts.
{
  "success": true,
  "execution_kind": "action",
  "output": { "artifacts": [ { "type": "transcript", "text": "本日の定例会議を始めます…" },
                             { "type": "srt", "text": "1\n00:00:00,000 --> …" } ] },
  "amount_minor": 0,
  "currency": "JPY",
  "receipt_summary": { "operation": "get_result", "amount_minor": 0, "currency": "JPY" }
  //                                  ^^^^^^^^^^^^ a 0-priced pricing_plan key — NO billingPreview, so the platform charges nothing.
}
```

## The job-acceptance envelope contract (leg 2)

When the action leg accepts long-running work, return the **affirmative** shape so the
platform reads it as *accepted, deferred* — not as a failure or a non-delivery:

| Key | Required | Meaning |
|---|---|---|
| `accepted` | yes — `true` | the job was admitted and will be worked |
| `job_id` | yes | stable handle; the buyer's agent passes it back to your terminal op |
| `status` | yes — `"queued"` (or `processing`/`running`/`pending`) | the job is not yet done |

Set `receipt_summary.operation` to the **chargeable band** and `amount_minor` to the plan
price — settlement happens on acceptance, because you have committed to doing the work.

This is distinct from the non-delivery shapes in
[Ambiguous results](./platform-api-boundary.md#ambiguous-results): `accepted: false`,
`success: false`, a draft-only/`status: "ready"` body, or a band/amount that disagrees
with the quote are **not** accepted. The async carve-out is narrow and explicit:
`accepted: true` **with** a `job_id` **and** a non-terminal `status` ⇒ accepted-deferred.

## There is no "terminal" or "job" ExecutionKind

The execution kinds are fixed: `dry_run | quote | action | payment`. A free terminal op
(`get_result`, `status`, `health`) is **not** a new kind. It is an ordinary
`pricing_plan` item **priced `0`**, invoked as `execution_kind=action` (or `read_only`),
whose `receipt_summary.operation` is the op's own name with `amount_minor=0`. Because it
declares **no `billingPreview`**, the platform requires no prepayment and runs it
directly for free — so the buyer's already-paid, already-finished job can be collected
without a second charge.

> Declare every terminal op as a `0`-priced key in `pricing_plan.items` (e.g.
> `{"key": "get_result", "price_minor": 0}`). A free op that is missing from the plan
> still runs free, but listing it keeps your plan self-documenting and your receipts valid.

## Worked example

See [`examples/async_transcription.py`](../examples/async_transcription.py) for a runnable
`AppAdapter` that implements all three legs with a matching `pricing_plan` (a `quote`
item, a chargeable `transcribe_0_15` band, and a `0`-priced `get_result`). Its
`ToolManual` shows how to advertise the `job_id` round-trip to agents.

## Lifecycle, end to end

1. Agent calls your API → platform runs **leg 1 (quote)** → reads `output.billingPreview`
   → prices the band from your `pricing_plan` (your `priceMinorIfActionSucceeds` is
   advisory; the **registered plan amount is authoritative**) → shows the buyer an
   approval for that amount.
2. Buyer approves → platform calls **leg 2 (action)** with the same `draftToken` →
   you start the job and return `{accepted, job_id, status:"queued"}` → platform
   **settles** the charge and records the job as accepted.
3. Your worker finishes the job out of band.
4. Agent calls your **free terminal op** (`get_result` with the `job_id`) → **leg 3**
   returns the artifacts → no charge.

## Checklist

Before publishing an async two-phase API, in addition to the
[prepay checklist](./pricing-and-billing.md#checklist):

- [ ] The quote leg returns `output.billingPreview.operation` (the band) **and** `draftToken`.
- [ ] `billingPreview.operation` **equals** the action-leg `receipt_summary.operation`
      **equals** a `pricing_plan.items[].key`. (One value, three places.)
- [ ] The quote-leg `receipt_summary.operation` is `"quote"`/`"dry_run"` with `amount_minor=0` —
      it does **not** carry the chargeable band.
- [ ] The action leg returns `{accepted: true, job_id, status: "queued"}` (not the finished
      result) with the chargeable band + price in `receipt_summary`.
- [ ] `job_id` is stable and is what the terminal op accepts.
- [ ] The terminal op (`get_result`/`status`) is a `0`-priced `pricing_plan` key, returns
      `amount_minor=0`, carries **no** `billingPreview`, and returns the real artifacts.
- [ ] A genuine failure on any leg returns `success=false` / `accepted=false` — never a
      silent `status:"queued"` for work you did not accept.

## Related

- [Pricing and Billing](./pricing-and-billing.md) — the synchronous prepay contract this builds on
- [Dry Run and Approval](./dry-run-and-approval.md) — execution kinds and approval expectations
- [Execution Receipts](./execution-receipts.md) — the result wire shape and per-leg `receipt_summary`
- [Platform / API Responsibility Boundary](./platform-api-boundary.md) — what the platform owns vs your API
