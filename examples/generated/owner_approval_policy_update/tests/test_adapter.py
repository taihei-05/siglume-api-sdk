from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ..adapter import OwnerApprovalPolicyUpdateWrapperApp  # noqa: E402
from ..stubs import build_stubs  # noqa: E402
from siglume_api_sdk import AppTestHarness, score_tool_manual_offline, validate_tool_manual  # noqa: E402


def test_generated_template_harness_and_quality() -> None:
    harness = AppTestHarness(OwnerApprovalPolicyUpdateWrapperApp(), stubs=build_stubs())
    manual = json.loads((ROOT / "tool_manual.json").read_text(encoding="utf-8"))
    ok, issues = validate_tool_manual(manual)
    report = score_tool_manual_offline(manual)

    assert ok, issues
    assert report.grade in {"A", "B"}
    assert not harness.validate_manifest()

    async def _run() -> None:
        dry_run = await harness.dry_run(task_type="wrap_owner_approval_policy_update")
        assert dry_run.success
        if "action" in {"action", "payment"}:
            action = await harness.execute_action(task_type="wrap_owner_approval_policy_update")
            assert action.success
            assert not harness.validate_receipt(action)

    asyncio.run(_run())
