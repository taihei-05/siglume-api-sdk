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

        # LEG 3 — free terminal op: a job_id means "deliver the finished artifacts".
        # No billingPreview, amount_minor=0, receipt_summary.operation is this op's own name.
        if job_id:
            artifacts = self._load_artifacts(str(job_id))
            return ExecutionResult(
                success=True,
                execution_kind=ctx.execution_kind,
                output={"job_id": job_id, "status": "succeeded", "artifacts": artifacts},
                units_consumed=0,
                amount_minor=0,
                currency="JPY",
                receipt_summary={"operation": "get_result", "amount_minor": 0, "currency": "JPY"},
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
    def _mint_draft_token(self, params: dict) -> str:
        return "draft_" + str(abs(hash(str(sorted(params.items())))) % (10**12))

    def _enqueue_job(self, params: dict, band: str) -> str:
        # Real impl: push to a queue/worker and return a stable id. Stubbed here.
        return "job_2872b04495de33bbd78cfa77"

    def _load_artifacts(self, job_id: str) -> list[dict]:
        # Real impl: fetch the finished job's outputs by id. Stubbed here.
        return [
            {"type": "transcript", "text": "本日の定例会議を始めます…"},
            {"type": "srt", "text": "1\n00:00:00,000 --> 00:00:04,000\n本日の定例会議を始めます…\n"},
        ]


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="async_transcription",
        job_to_be_done="Transcribe long audio asynchronously and deliver the transcript when the job completes.",
        summary_for_model=(
            "Transcribes long audio. The first call accepts the job and returns a job_id (charged per length); "
            "call again with that job_id to fetch the finished transcript for free."
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
                "status": {"type": "string", "description": "ready (quote) | queued (accepted) | succeeded (result)."},
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
            "First call starts the job and returns job_id; it is charged per audio length.",
            "Then call again with job_id (no audio_url) to fetch the transcript for free.",
        ],
        result_hints=[
            "When status is queued, tell the owner the job was accepted and you will fetch the result with the job_id.",
            "When artifacts are present, show the transcript; the get_result call is free.",
        ],
        error_hints=["If a job_id is unknown or expired, ask the owner to re-submit the audio."],
        approval_summary_template="Transcribe the audio (~{duration_minutes} min) and charge the per-length price.",
        idempotency_support=True,
        side_effect_summary="Starts an asynchronous transcription job and charges the per-length band on acceptance.",
        currency="JPY",
        jurisdiction="JP",
    )


async def main() -> None:
    harness = AppTestHarness(AsyncTranscriptionApp())
    ok, issues = validate_tool_manual(build_tool_manual())
    print("tool_manual_valid:", ok, len(issues))
    print("manifest_issues:", harness.validate_manifest())

    # Leg 1: quote — the chargeable band must be in output.billingPreview.operation.
    quote = await harness.execute_quote(task_type="transcribe_audio", input_params={"audio_url": "https://x/clip.mp3", "duration_minutes": 12})
    band = quote.output["billingPreview"]["operation"]
    print("quote band:", band, "| quote receipt op:", quote.receipt_summary["operation"])
    assert band == "transcribe_0_15" and quote.receipt_summary["operation"] == "quote"

    # Leg 2: action — accept the job; receipt op equals the quoted band; charged on acceptance.
    action = await harness.execute_action(task_type="transcribe_audio", input_params={"audio_url": "https://x/clip.mp3", "duration_minutes": 12})
    print("action accepted:", action.output["accepted"], "| job_id:", action.output["job_id"], "| action receipt op:", action.receipt_summary["operation"])
    assert action.output["status"] == "queued" and action.receipt_summary["operation"] == band

    # Leg 3: get_result — free terminal op, no billingPreview, returns artifacts.
    result = await harness.execute_action(task_type="get_transcription_result", input_params={"job_id": action.output["job_id"]})
    print("result op:", result.receipt_summary["operation"], "| amount_minor:", result.amount_minor, "| artifacts:", len(result.output["artifacts"]))
    assert result.receipt_summary["operation"] == "get_result" and result.amount_minor == 0


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
