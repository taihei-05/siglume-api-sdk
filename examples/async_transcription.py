"""Example: an ASYNC / long-running two-phase paid API (deferred settlement).

The work (transcribing long audio) cannot finish within the invoke timeout, so the
action leg ACCEPTS the job and settles the charge, then a separate FREE terminal op
(`get_result`) returns the artifacts later. See docs/async-two-phase-apis.md.

The three legs this adapter implements:

  1. quote/dry_run  -> output.billingPreview.operation = the chargeable band (transcribe_0_15),
                       draftToken; receipt_summary.operation = "quote" (free, amount 0).
  2. action         -> output = {accepted: true, job_id, status: "queued"} (NOT the result);
                       receipt_summary.operation = the band (charged on acceptance).
  3. get_result     -> a 0-priced pricing_plan key (NO billingPreview); returns the artifacts free.

The chargeable band lives in output.billingPreview.operation on the QUOTE leg, and the SAME
value must reappear as the ACTION-leg receipt_summary.operation and as a pricing_plan key.

For a real large transcript file, host the output yourself and return an external_url as shown
in examples/artifact_delivery_presigned.py. This runnable example returns small transcript text
inline to keep the async billing/state machine focused.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk import (  # noqa: E402
    AppAdapter,
    AppCategory,
    AppManifest,
    AppTestHarness,
    ApprovalMode,
    ExecutionContext,
    ExecutionKind,
    ExecutionResult,
    PermissionClass,
    PriceModel,
    ToolManual,
    ToolManualPermissionClass,
    validate_tool_manual,
)

# One band value lives in three places: billingPreview.operation (quote) ==
# action receipt_summary.operation == a pricing_plan.items[].key.
PRICING_PLAN = {
    "currency": "JPY",
    "items": [
        {"key": "quote", "price_minor": 0},           # the free quote leg's own op
        {"key": "transcribe_0_15", "price_minor": 80},  # chargeable band: audio <= 15 min
        {"key": "transcribe_15_60", "price_minor": 200},  # chargeable band: 15-60 min
        {"key": "get_result", "price_minor": 0},       # free terminal op (deliver artifacts)
    ],
}


def _band_for(duration_minutes: float) -> str:
    return "transcribe_0_15" if duration_minutes <= 15 else "transcribe_15_60"


def _price_minor(band: str) -> int:
    return next(item["price_minor"] for item in PRICING_PLAN["items"] if item["key"] == band)


class AsyncTranscriptionApp(AppAdapter):
    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="async-transcription",
            name="Async Transcription",
            job_to_be_done="Transcribe long audio asynchronously and deliver the transcript when the job finishes.",
            category=AppCategory.DOCUMENT,
            store_vertical="api",
            permission_class=PermissionClass.ACTION,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.PER_ACTION,
            pricing_plan=PRICING_PLAN,
            billing_timing="prepay",
            currency="JPY",
            allow_free_trial=False,
            jurisdiction="JP",
            short_description="Async long-audio transcription, priced per length.",
            example_prompts=[
                "Transcribe this 12-minute meeting recording.",
                "Get the transcript for job job_2872b04495de33bbd78cfa77.",
            ],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        params = ctx.input_params or {}
        job_id = params.get("job_id")

        # LEG 3 — free terminal op (get_result): a job_id means "deliver the result".
        # Always free (amount_minor=0, no billingPreview); safe to poll any time. It must
        # report EVERY state — running / succeeded / failed / unknown — not just success.
        if job_id:
            free_receipt = {"operation": "get_result", "amount_minor": 0, "currency": "JPY"}
            state = self._job_state.get(str(job_id))
            if state is None:
                # Unknown / expired job_id. Re-submission would be a NEW paid job.
                return ExecutionResult(
                    success=False, execution_kind=ctx.execution_kind,
                    output={"job_id": job_id, "status": "expired"},
                    units_consumed=0, amount_minor=0, currency="JPY", receipt_summary=free_receipt,
                )
            if state["status"] == "running":
                # Tell the agent to poll again; no artifacts yet.
                return ExecutionResult(
                    success=True, execution_kind=ctx.execution_kind,
                    output={"job_id": job_id, "status": "running", "progress": state.get("progress", 0.0)},
                    units_consumed=0, amount_minor=0, currency="JPY", receipt_summary=free_receipt,
                )
            if state["status"] == "failed":
                # Settlement was final on acceptance — report the failure here (still free; do
                # NOT re-charge) and honor your refund_or_cancellation_note out of band.
                return ExecutionResult(
                    success=True, execution_kind=ctx.execution_kind,
                    output={"job_id": job_id, "status": "failed", "error": state.get("error", {})},
                    units_consumed=0, amount_minor=0, currency="JPY", receipt_summary=free_receipt,
                )
            return ExecutionResult(
                success=True, execution_kind=ctx.execution_kind,
                output={"job_id": job_id, "status": "succeeded", "artifacts": state.get("artifacts", [])},
                units_consumed=0, amount_minor=0, currency="JPY", receipt_summary=free_receipt,
            )

        duration_minutes = float(params.get("duration_minutes") or 12)
        band = _band_for(duration_minutes)
        price = _price_minor(band)

        # LEG 1 — quote/dry-run (FREE): declare the chargeable band in output.billingPreview.
        # receipt_summary.operation is the leg's OWN op ("quote"/"dry_run"), NOT the band.
        if ctx.execution_kind in {ExecutionKind.DRY_RUN, ExecutionKind.QUOTE}:
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output={
                    "status": "ready",
                    "draftToken": self._mint_draft_token(params),
                    "billingPreview": {
                        "operation": band,
                        "priceMinorIfActionSucceeds": price,  # advisory; platform charges the plan amount
                        "currency": "JPY",
                    },
                },
                units_consumed=0,
                amount_minor=0,
                currency="JPY",
                receipt_summary={"operation": "quote", "amount_minor": 0, "currency": "JPY"},
                needs_approval=True,
                approval_prompt=f"Transcribe ~{duration_minutes:.0f} min of audio for {price} JPY?",
            )

        # LEG 2 — action: ACCEPT the long job and return a job-acceptance envelope.
        # This is where the buyer is charged (settlement on acceptance). The body is the
        # accepted/queued envelope, NOT the finished transcript.
        new_job_id = self._enqueue_job(params, band)
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={"accepted": True, "job_id": new_job_id, "status": "queued"},
            units_consumed=1,
            amount_minor=price,
            currency="JPY",
            receipt_summary={"operation": band, "amount_minor": price, "currency": "JPY"},
        )

    def supported_task_types(self) -> list[str]:
        return ["transcribe_audio", "get_transcription_result"]

    # --- stubs an external dev replaces with real infrastructure ---------------------------
    def __init__(self) -> None:
        super().__init__()
        # Real impl: a durable queue + job store. In-memory here so the example runs.
        self._jobs_by_token: dict[str, str] = {}   # commit token -> job_id (idempotency)
        self._job_state: dict[str, dict] = {}       # job_id -> {status, artifacts/error/progress}

    def _commit_token(self, params: dict) -> str:
        # The platform injects the quoted draftToken as the commit token on the action leg.
        # Key the enqueue on it so a retry is idempotent. Fall back to a deterministic key.
        return str(
            params.get("commit_token")
            or params.get("draftToken")
            or self._mint_draft_token(params)
        )

    def _mint_draft_token(self, params: dict) -> str:
        keyed = {k: v for k, v in params.items() if k not in ("commit_token", "draftToken", "dry_run", "execution_kind")}
        return "draft_" + str(abs(hash(str(sorted(keyed.items())))) % (10**12))

    def _enqueue_job(self, params: dict, band: str) -> str:
        # IDEMPOTENT: one commit token => at most one job => at most one charge. A retried
        # action with the same token returns the SAME job_id and does NOT enqueue again.
        token = self._commit_token(params)
        existing = self._jobs_by_token.get(token)
        if existing is not None:
            return existing
        job_id = "job_" + token[-24:]
        self._jobs_by_token[token] = job_id
        self._job_state[job_id] = {"status": "running", "progress": 0.0, "band": band}
        # Real impl: push (job_id, params) to your worker queue here.
        return job_id

    # --- worker callbacks (your out-of-band worker calls these as the job progresses) ------
    def _mark_succeeded(self, job_id: str, artifacts: list[dict]) -> None:
        self._job_state[job_id] = {"status": "succeeded", "artifacts": artifacts}

    def _mark_failed(self, job_id: str, error: dict) -> None:
        # The buyer was already charged on acceptance; honor refund_or_cancellation_note.
        self._job_state[job_id] = {"status": "failed", "error": error}


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="async_transcription",
        job_to_be_done="Transcribe long audio asynchronously and deliver the transcript when the job completes.",
        summary_for_model=(
            "Transcribes long audio asynchronously. First call accepts the job and returns a job_id "
            "(charged per length on acceptance). Call again with that job_id for FREE to poll: status=running "
            "until done, then succeeded with the transcript. Always pass job_id back; result fetch never re-charges."
        ),
        trigger_conditions=[
            "owner wants a transcript of an audio/video file that is too long to transcribe inline",
            "agent holds a job_id from a prior transcription request and needs the finished result",
            "owner asks to start a transcription job now and collect the transcript later",
        ],
        do_not_use_when=[
            "the audio is short enough for a synchronous transcription tool",
            "the request is unrelated to speech-to-text",
        ],
        permission_class=ToolManualPermissionClass.ACTION,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "audio_url": {"type": "string", "description": "Signed URL of the audio to transcribe (omit when fetching a result)."},
                "duration_minutes": {"type": "number", "description": "Audio length in minutes; selects the price band.", "default": 12},
                "job_id": {"type": "string", "description": "Return a finished job's transcript instead of starting a new one (free)."},
            },
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line summary of the job state or transcript."},
                "status": {"type": "string", "description": "ready (quote) | queued (accepted) | running | succeeded | failed | expired."},
                "error": {"type": "object", "description": "Present when status=failed; the buyer was charged on acceptance, so a refund follows the refund policy."},
                "progress": {"type": "number", "description": "0..1 progress while status=running."},
                "accepted": {"type": "boolean", "description": "True when a long job was accepted and queued."},
                "job_id": {"type": "string", "description": "Stable job handle; pass it back to fetch the transcript."},
                "artifacts": {"type": "array", "description": "Transcript artifacts, returned by the free get_result call."},
                "billingPreview": {"type": "object", "description": "Quote-leg only: the chargeable band and advisory price."},
                "draftToken": {"type": "string", "description": "Quote-leg commit token bound to the later action."},
            },
            "required": ["status"],
            "additionalProperties": True,
        },
        usage_hints=[
            "First call starts the job and returns job_id; it is charged per audio length, on acceptance.",
            "Then call again with the same job_id (no audio_url) to poll for free until status=succeeded.",
            "Retrying the start with the same audio is safe — it returns the same job_id and does not re-charge.",
        ],
        result_hints=[
            "When status is queued/running, tell the owner the job was accepted and keep polling get_result with the job_id (free).",
            "When status is succeeded and artifacts are present, show the transcript.",
            "When status is failed, tell the owner the job failed; they were charged on acceptance and a refund follows the refund policy.",
        ],
        error_hints=[
            "status=expired means the job_id is unknown/aged out; re-submitting the audio is a NEW paid job, so confirm with the owner first.",
        ],
        approval_summary_template="Transcribe the audio (~{duration_minutes} min) and charge the per-length price.",
        idempotency_support=True,
        side_effect_summary="Starts an asynchronous transcription job and charges the per-length band on acceptance; the result fetch is free.",
        refund_or_cancellation_note=(
            "Charged on acceptance. If a job fails after acceptance, the platform does not auto-refund; "
            "we issue a credit/refund for the failed run per our support policy. Re-submission is a new paid job."
        ),
        currency="JPY",
        jurisdiction="JP",
    )


async def main() -> None:
    app = AsyncTranscriptionApp()
    harness = AppTestHarness(app)
    ok, issues = validate_tool_manual(build_tool_manual())
    print("tool_manual_valid:", ok, len(issues))
    print("manifest_issues:", harness.validate_manifest())

    args = {"audio_url": "https://x/clip.mp3", "duration_minutes": 12}

    # Leg 1: quote — the chargeable band must be in output.billingPreview.operation.
    quote = await harness.execute_quote(task_type="transcribe_audio", input_params=args)
    band = quote.output["billingPreview"]["operation"]
    print("quote band:", band, "| quote receipt op:", quote.receipt_summary["operation"])
    assert band == "transcribe_0_15" and quote.receipt_summary["operation"] == "quote"

    # Leg 2: action — accept the job; receipt op equals the quoted band; charged on acceptance.
    action = await harness.execute_action(task_type="transcribe_audio", input_params=args)
    job_id = action.output["job_id"]
    print("action accepted:", action.output["accepted"], "| job_id:", job_id, "| action receipt op:", action.receipt_summary["operation"])
    assert action.output["status"] == "queued" and action.receipt_summary["operation"] == band

    # Idempotency: a retried action with the same quoted token returns the SAME job_id and
    # does NOT enqueue a second job or settle a second charge.
    retry = await harness.execute_action(task_type="transcribe_audio", input_params=args)
    print("retry job_id == original:", retry.output["job_id"] == job_id, "| jobs enqueued:", len(app._jobs_by_token))
    assert retry.output["job_id"] == job_id and len(app._jobs_by_token) == 1

    # Leg 3 while STILL RUNNING — free poll, no artifacts yet.
    running = await harness.execute_action(task_type="get_transcription_result", input_params={"job_id": job_id})
    print("poll status:", running.output["status"], "| amount_minor:", running.amount_minor)
    assert running.output["status"] == "running" and running.amount_minor == 0

    # The out-of-band worker finishes the job.
    app._mark_succeeded(job_id, [{"type": "transcript", "text": "本日の定例会議を始めます…"}])

    # Leg 3 DONE — free, returns artifacts.
    result = await harness.execute_action(task_type="get_transcription_result", input_params={"job_id": job_id})
    print("result status:", result.output["status"], "| amount_minor:", result.amount_minor, "| artifacts:", len(result.output["artifacts"]))
    assert result.output["status"] == "succeeded" and result.receipt_summary["operation"] == "get_result" and result.amount_minor == 0

    # FAILED-after-acceptance path — reported free via get_result (the buyer keeps the charge).
    app._mark_failed(job_id, {"code": "TRANSCODE_FAILED", "message": "unsupported codec"})
    failed = await harness.execute_action(task_type="get_transcription_result", input_params={"job_id": job_id})
    print("failed status:", failed.output["status"], "| amount_minor:", failed.amount_minor)
    assert failed.output["status"] == "failed" and failed.amount_minor == 0

    # UNKNOWN / expired job_id — free, success=false.
    expired = await harness.execute_action(task_type="get_transcription_result", input_params={"job_id": "job_unknown"})
    print("unknown status:", expired.output["status"], "| success:", expired.success, "| amount_minor:", expired.amount_minor)
    assert expired.output["status"] == "expired" and expired.success is False and expired.amount_minor == 0


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
