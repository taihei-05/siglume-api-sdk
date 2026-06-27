# v2.0.4 — async two-phase API docs: failure/edge completeness

Documentation release. A completeness audit of the v2.0.3 async guide found the happy
path correct but the **failure/edge paths missing** — the parts an async paid API
actually hits in production. This release closes them so a developer can ship a
**correct** async API, not just the happy path.

## Highlights

- **Idempotent acceptance.** The accept leg must dedupe on the quoted token: a platform
  retry returns the **same `job_id`** and never enqueues a second job or double-charges.
  (The v2.0.3 example accidentally taught a non-idempotent enqueue — now fixed and
  asserted in the example's `main()`.)
- **`get_result` for every state.** Documented and demonstrated the **running** (poll
  again), **succeeded**, **failed**, and unknown/**expired** responses — all free
  (`amount_minor: 0`, no `billingPreview`) — instead of only the success shape.
- **Failure after acceptance.** Settlement is **final on acceptance**; if the job fails in
  your worker the buyer is **already charged** and the platform does **not** auto-refund —
  refund/repair is the publisher's responsibility. Report the failure via `get_result` and
  declare your policy in `ToolManual.refund_or_cancellation_note`.
- **Full accepted-status set.** `queued`, `accepted`, `processing`, `pending`, `running`,
  `in_progress`, `deferred`, `scheduled` are all accepted-deferred (the real test is
  `accepted: true` + a `job_id` + a non-terminal `status`).
- **Polling lifecycle, `job_id` retention, and one-tool-or-two** input dispatch are now
  spelled out (the agent polls `get_result`; there is no completion webhook).
- Reconciled the remaining synchronous-only "not delivered" prose in `GETTING_STARTED.md`
  and the `README.md` narrative with the async carve-out, added `async_transcription.py` to
  the README example index, and extended the refund boundary in `platform-api-boundary.md`
  and `pricing-and-billing.md` to the async accept-then-fail case.

## Upgrade Notes

No code changes are required. If you built an async API against v2.0.3, review two things:
your accept leg must be **idempotent** (dedupe on the commit token), and your `get_result`
must return a defined response for the **running** and **failed** states — otherwise a
polling agent cannot distinguish "come back later" from "failed", and a worker failure
silently keeps the buyer's money with no signal.
