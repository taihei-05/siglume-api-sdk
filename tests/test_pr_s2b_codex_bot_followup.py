"""Regression tests for chatgpt-codex-connector[bot] findings on
PR-S2b (siglume-api-sdk#140).

Pin Q2: OperationExecution dataclass positional signature through
`raw` is part of the public Python surface. Legacy callers like
`OperationExecution(agent_id, operation_key, message, action,
result, trace_id, request_id, raw_dict)` must keep working — any
new v0.6 fields must be keyword-only.

(Q1 / Q3 are TypeScript-only; covered in
siglume-api-sdk-ts/test/pr_s2b_codex_bot_followup.test.ts.)
"""
from __future__ import annotations

import dataclasses

from siglume_api_sdk.client import OperationExecution


def test_legacy_positional_constructor_still_works() -> None:
    """The pre-v0.6 call shape must still produce the expected object.

    Before the fix, inserting `status` / `approval_required` etc. before
    `trace_id` / `request_id` / `raw` caused a positional call to
    silently remap — trace_id becoming `status`, request_id becoming
    `approval_required` (type mismatch!), raw becoming `intent_id`.
    """
    legacy = OperationExecution(
        "agt_x",           # agent_id
        "owner.charter.get",  # operation_key
        "Loaded charter.",  # message
        "operation",        # action
        {"role": "hybrid"},  # result
        "trc_123",          # trace_id
        "req_abc",          # request_id
        {"ok": True},       # raw
    )
    assert legacy.agent_id == "agt_x"
    assert legacy.operation_key == "owner.charter.get"
    assert legacy.trace_id == "trc_123"
    assert legacy.request_id == "req_abc"
    assert legacy.raw == {"ok": True}
    # Defaults for new v0.6 fields.
    assert legacy.status == "completed"
    assert legacy.approval_required is False
    assert legacy.intent_id is None


def test_new_v06_fields_are_keyword_only() -> None:
    """The new v0.6 fields must not be positionally accessible — that
    is the contract that preserves legacy positional call sites."""
    fields = {f.name: f for f in dataclasses.fields(OperationExecution)}
    # Legacy positional fields keep kw_only=False.
    for legacy_field in (
        "agent_id", "operation_key", "message", "action",
        "result", "trace_id", "request_id", "raw",
    ):
        assert fields[legacy_field].kw_only is False, legacy_field
    # New fields must be keyword-only.
    for new_field in (
        "status", "approval_required", "intent_id",
        "approval_status", "approval_snapshot_hash",
        "action_payload", "safety",
    ):
        assert fields[new_field].kw_only is True, new_field


def test_new_v06_fields_accessible_via_kwargs() -> None:
    """Kw-only fields are still fully constructable by name."""
    instance = OperationExecution(
        "agt_x",
        "owner.budget.get",
        "Loaded budget.",
        "operation",
        {"daily_cap_usd": 10.0},
        status="approval_required",
        approval_required=True,
        intent_id="cpi_abc",
        approval_snapshot_hash="abc123",
    )
    assert instance.status == "approval_required"
    assert instance.approval_required is True
    assert instance.intent_id == "cpi_abc"
    assert instance.approval_snapshot_hash == "abc123"
