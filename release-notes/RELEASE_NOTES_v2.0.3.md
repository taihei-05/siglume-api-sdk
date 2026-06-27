# v2.0.3 — async / long-running two-phase API docs

This is a documentation release. No SDK runtime code changed; it makes building
asynchronous (deferred-settlement) paid APIs unambiguous from the docs alone.

## Highlights

- **New guide: [Async / long-running two-phase APIs](../docs/async-two-phase-apis.md).**
  For work that cannot finish within the invoke timeout (long transcription,
  batch rendering, multi-minute analysis), your action leg *accepts* the job and
  settles the charge, and a separate **free** terminal op delivers the result.
  The guide documents the three legs end to end:
  1. `quote` → `output.billingPreview` (the chargeable band) + `draftToken`
  2. `action` → `{ accepted: true, job_id, status: "queued" }` (charged on acceptance)
  3. free terminal op (`get_result`/`health`) → the artifacts, `amount_minor=0`
- **New example: [`examples/async_transcription.py`](../examples/async_transcription.py)** —
  a runnable `AppAdapter` implementing all three legs with a matching `pricing_plan`.
- **`ExecutionResult` wire shape, documented at last.** The publisher `output` is kept
  **nested** (`result.output.billingPreview`), while `receipt_summary` is hoisted to a
  sibling top-level key (`result.receipt_summary`). The chargeable band is declared in
  `billingPreview.operation`, not in the quote-leg `receipt_summary.operation` (which is
  the leg's own `"quote"`/`"dry_run"` op).
- **Per-leg `receipt_summary.operation` semantics** and the
  `billingPreview.operation` = action `receipt_summary.operation` = `pricing_plan` key
  invariant are now stated explicitly. `priceMinorIfActionSucceeds` is advisory — the
  platform charges the registered plan amount.
- **Reconciled the "not delivered" rules** across the boundary docs with a narrow
  carve-out: `accepted: true` + `job_id` + `queued` is an *accepted, deferred* result,
  not a non-delivery. Genuine non-deliveries (`accepted=false`, `status="ready"`,
  draft/preview bodies) are unchanged.

## Upgrade Notes

No code changes are required. Existing synchronous prepay APIs are unaffected. If you
publish a long-running API, follow the new async guide so the platform reads your
`accepted`/`queued` action response as deferred-but-accepted and your free `get_result`
op delivers without a second charge.
