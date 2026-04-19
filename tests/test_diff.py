from __future__ import annotations

import json
import sys
from pathlib import Path

from click.testing import CliRunner
import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk.cli import main  # noqa: E402
from siglume_api_sdk.diff import ChangeLevel, diff_manifest, diff_tool_manual  # noqa: E402


FIXTURE_PATH = ROOT / "tests" / "fixtures" / "diff_cases.json"
CASES = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_diff_rules_match_golden_cases(case: dict[str, object]) -> None:
    diff_fn = diff_manifest if case["kind"] == "manifest" else diff_tool_manual
    changes = diff_fn(old=case["old"], new=case["new"])

    assert [
        {"level": change.level.value, "path": change.path}
        for change in changes
    ] == case["expected"]


@pytest.mark.parametrize("case", CASES, ids=[f"cli-{case['name']}" for case in CASES])
def test_diff_cli_json_exit_codes(case: dict[str, object]) -> None:
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("old.json").write_text(json.dumps(case["old"], indent=2), encoding="utf-8")
        Path("new.json").write_text(json.dumps(case["new"], indent=2), encoding="utf-8")

        result = runner.invoke(main, ["diff", "old.json", "new.json", "--json"])

        assert result.exit_code == case["exit_code"], result.output
        payload = json.loads(result.output)
        assert payload["exit_code"] == case["exit_code"]
        assert [
            {"level": item["level"], "path": item["path"]}
            for item in payload["changes"]
        ] == case["expected"]


def test_diff_cli_text_groups_levels() -> None:
    runner = CliRunner()
    warning_case = next(case for case in CASES if case["name"] == "tool_manual_warning_output_template_and_list_drift")
    with runner.isolated_filesystem():
        Path("old.json").write_text(json.dumps(warning_case["old"], indent=2), encoding="utf-8")
        Path("new.json").write_text(json.dumps(warning_case["new"], indent=2), encoding="utf-8")

        result = runner.invoke(main, ["diff", "old.json", "new.json"])

        assert result.exit_code == 2, result.output
        assert "WARNING" in result.output
        assert "output_schema.properties" in result.output
        assert "approval_summary_template" in result.output


def test_diff_cli_reports_no_changes() -> None:
    runner = CliRunner()
    unchanged_case = CASES[0]
    with runner.isolated_filesystem():
        Path("old.json").write_text(json.dumps(unchanged_case["old"], indent=2), encoding="utf-8")
        Path("new.json").write_text(json.dumps(unchanged_case["old"], indent=2), encoding="utf-8")

        result = runner.invoke(main, ["diff", "old.json", "new.json"])

        assert result.exit_code == 0, result.output
        assert "No differences detected." in result.output


def test_diff_manifest_returns_breaking_change_members() -> None:
    case = CASES[0]
    changes = diff_manifest(old=case["old"], new=case["new"])

    assert any(change.level == ChangeLevel.BREAKING for change in changes)
    assert all(change.is_breaking == (change.level == ChangeLevel.BREAKING) for change in changes)


def test_diff_tool_manual_ignores_key_order_only_changes() -> None:
    old_manual = {
        "tool_name": "schema_echo",
        "job_to_be_done": "Echo structured data.",
        "summary_for_model": "Returns structured data without mutating state.",
        "trigger_conditions": ["owner asks for schema echo"],
        "do_not_use_when": ["the request needs side effects"],
        "permission_class": "read_only",
        "dry_run_supported": True,
        "requires_connected_accounts": [],
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Echo payload.",
                }
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        "output_schema": {
            "type": "object",
            "properties": {
                "summary": {
                    "description": "Summary text.",
                    "type": "string",
                }
            },
            "required": ["summary"],
            "additionalProperties": False,
        },
        "usage_hints": ["Use for schema smoke tests."],
        "result_hints": ["Return the summary first."],
        "error_hints": ["Explain missing input clearly."],
    }
    new_manual = {
        **old_manual,
        "output_schema": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Summary text.",
                }
            },
            "required": ["summary"],
            "additionalProperties": False,
        },
    }

    assert diff_tool_manual(old=old_manual, new=new_manual) == []


def test_diff_tool_manual_reports_required_add_and_remove_together() -> None:
    old_manual = {
        "tool_name": "echo_helper",
        "job_to_be_done": "Echo the provided query in a structured response.",
        "summary_for_model": "Returns the provided query inside a stable echo result.",
        "trigger_conditions": [
            "owner asks the agent to echo a request payload",
            "agent needs a trivial read-only smoke-test helper",
            "request is to mirror a provided string in a structured result",
        ],
        "do_not_use_when": ["the request needs fresh external data rather than a local echo response"],
        "permission_class": "read_only",
        "dry_run_supported": True,
        "requires_connected_accounts": [],
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "locale": {"type": "string"},
            },
            "required": ["query", "locale"],
            "additionalProperties": False,
        },
        "output_schema": {
            "type": "object",
            "properties": {"summary": {"type": "string"}},
            "required": ["summary"],
            "additionalProperties": False,
        },
        "usage_hints": ["Use for simple echo smoke tests."],
        "result_hints": ["Return the echoed string clearly."],
        "error_hints": ["If query is missing, ask for the text to echo."],
    }
    new_manual = {
        **old_manual,
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "timezone": {"type": "string"},
            },
            "required": ["query", "timezone"],
            "additionalProperties": False,
        },
    }

    changes = diff_tool_manual(old=old_manual, new=new_manual)

    assert any(change.level == ChangeLevel.BREAKING and change.path == "input_schema.required" for change in changes)
    assert any(change.level == ChangeLevel.INFO and change.path == "input_schema.required" for change in changes)


def test_diff_cli_accepts_minimal_manifest_with_only_identity_fields() -> None:
    # Codex bot P1 on PR #100: legacy/minimal manifests with only identity
    # fields must not be rejected. Optional fields have defaults and are
    # handled by the diff engine's default normalization.
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("old.json").write_text(
            json.dumps({"capability_key": "partial", "permission_class": "read-only"}),
            encoding="utf-8",
        )
        Path("new.json").write_text(
            json.dumps({"capability_key": "partial", "permission_class": "read-only"}),
            encoding="utf-8",
        )

        result = runner.invoke(main, ["diff", "old.json", "new.json"])

        # Identical minimal manifests → no diff, exit 0.
        assert result.exit_code == 0, result.output
        assert "No differences detected." in result.output


def test_diff_cli_rejects_truly_unknown_document_kind() -> None:
    runner = CliRunner()
    with runner.isolated_filesystem():
        # Neither capability_key nor tool_name → can't discriminate.
        Path("old.json").write_text(json.dumps({"unrelated": "data"}), encoding="utf-8")
        Path("new.json").write_text(json.dumps({"unrelated": "data"}), encoding="utf-8")

        result = runner.invoke(main, ["diff", "old.json", "new.json"])

        assert result.exit_code == 1
        assert "Could not detect document type" in result.output


def test_diff_cli_prefers_tool_manual_when_ambiguous_keys_present() -> None:
    # Codex bot P2 on PR #101: a ToolManual JSON may carry capability_key
    # as metadata. The detector must prefer ToolManual (tool_name wins),
    # otherwise ToolManual-specific breaking changes (e.g. input_schema.required
    # additions) would be silently suppressed.
    runner = CliRunner()
    with runner.isolated_filesystem():
        old_payload = {
            "capability_key": "ambiguous-capability",
            "tool_name": "ambiguous_tool",
            "input_schema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
                "additionalProperties": False,
            },
        }
        new_payload = {
            "capability_key": "ambiguous-capability",
            "tool_name": "ambiguous_tool",
            "input_schema": {
                "type": "object",
                "properties": {"query": {"type": "string"}, "region": {"type": "string"}},
                "required": ["query", "region"],  # breaking in tool_manual diff, noise in manifest diff
                "additionalProperties": False,
            },
        }
        Path("old.json").write_text(json.dumps(old_payload), encoding="utf-8")
        Path("new.json").write_text(json.dumps(new_payload), encoding="utf-8")

        result = runner.invoke(main, ["diff", "old.json", "new.json", "--json"])

        assert result.exit_code == 1, result.output  # BREAKING detected via tool_manual path
        payload = json.loads(result.output)
        assert payload["kind"] == "tool_manual"
        assert any(
            change["level"] == "breaking" and change["path"] == "input_schema.required"
            for change in payload["changes"]
        )


def test_diff_manifest_defaults_permission_class_for_missing_old_value() -> None:
    # Codex bot P1 on PR #60: when an old/legacy manifest omits
    # permission_class and the new one escalates to action, the permission
    # escalation must be BREAKING. Previously the normaliser did not default
    # permission_class, so oldRank was undefined and the change was
    # downgraded to INFO — making `siglume diff` exit 0 on a real
    # permission escalation.
    changes = diff_manifest(
        old={"capability_key": "legacy-app", "jurisdiction": "US"},
        new={
            "capability_key": "legacy-app",
            "jurisdiction": "US",
            "permission_class": "action",
        },
    )

    breaking_permission = [
        change
        for change in changes
        if change.path == "permission_class" and change.level == ChangeLevel.BREAKING
    ]
    assert breaking_permission, [
        {"path": change.path, "level": change.level.value, "old": change.old, "new": change.new}
        for change in changes
    ]
