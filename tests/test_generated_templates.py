from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk import score_tool_manual_offline, validate_tool_manual  # noqa: E402
from siglume_api_sdk.cli import project as project_module  # noqa: E402


GENERATED_TEMPLATES = (
    "owner_charter_update",
    "owner_approval_policy_update",
    "owner_budget_get",
)


@pytest.mark.parametrize("template_name", GENERATED_TEMPLATES)
def test_generated_templates_validate_and_run(template_name: str) -> None:
    project_dir = ROOT / "examples" / "generated" / template_name
    assert project_dir.exists(), f"missing generated example: {project_dir}"

    manual = json.loads((project_dir / "tool_manual.json").read_text(encoding="utf-8"))
    ok, issues = validate_tool_manual(manual)
    assert ok, issues
    report = score_tool_manual_offline(manual)
    assert report.grade in {"A", "B"}

    harness_report = project_module.run_harness(project_dir)
    assert harness_report["ok"] is True

