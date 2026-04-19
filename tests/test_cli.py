from __future__ import annotations

import json
import sys
from types import SimpleNamespace
from pathlib import Path

from click.testing import CliRunner


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk.cli import main  # noqa: E402
from siglume_api_sdk.cli import project as project_module  # noqa: E402
from siglume_api_sdk import (  # noqa: E402
    AppCategory,
    AppManifest,
    ApprovalMode,
    PermissionClass,
    PriceModel,
    validate_tool_manual,
)


def test_init_command_writes_template_files() -> None:
    runner = CliRunner()
    with runner.isolated_filesystem():
        result = runner.invoke(main, ["init", "--template", "echo"])
        assert result.exit_code == 0, result.output
        assert Path("adapter.py").exists()
        assert Path("manifest.json").exists()
        assert Path("tool_manual.json").exists()
        assert Path("README.md").exists()


def test_init_payment_template_writes_valid_tool_manual() -> None:
    runner = CliRunner()
    with runner.isolated_filesystem():
        result = runner.invoke(main, ["init", "--template", "payment"])
        assert result.exit_code == 0, result.output
        tool_manual = json.loads(Path("tool_manual.json").read_text(encoding="utf-8"))
        valid, issues = validate_tool_manual(tool_manual)
        assert valid, issues


def test_build_tool_manual_template_tolerates_missing_job_to_be_done() -> None:
    manifest = AppManifest(
        capability_key="price-compare-helper",
        name="Price Compare Helper",
        job_to_be_done="Compare prices",
        category=AppCategory.COMMERCE,
        permission_class=PermissionClass.READ_ONLY,
        approval_mode=ApprovalMode.AUTO,
        dry_run_supported=True,
        required_connected_accounts=[],
        price_model=PriceModel.FREE,
        jurisdiction="US",
    )
    manifest.job_to_be_done = None  # type: ignore[assignment]
    manifest.short_description = None  # type: ignore[assignment]

    manual = project_module.build_tool_manual_template(manifest)

    assert manual["job_to_be_done"] == "Price Compare Helper"
    assert manual["trigger_conditions"][0].startswith("The owner asks for help with")


def test_validate_and_score_commands_use_remote_preview(monkeypatch) -> None:
    runner = CliRunner()

    class FakeClient:
        def __init__(self, api_key: str) -> None:
            self.api_key = api_key

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def preview_quality_score(self, manual):
            from siglume_api_sdk import ToolManualQualityReport

            return ToolManualQualityReport(
                overall_score=81,
                grade="B",
                issues=[],
                keyword_coverage_estimate=55,
                improvement_suggestions=["Add one more trigger example."],
                publishable=True,
                validation_ok=True,
            )

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")
    monkeypatch.setattr(project_module, "SiglumeClient", FakeClient)

    validate_result = runner.invoke(main, ["validate", "examples/hello_echo.py", "--json"])
    score_result = runner.invoke(main, ["score", "examples/hello_echo.py", "--remote", "--json"])

    assert validate_result.exit_code == 0, validate_result.output
    assert '"grade": "B"' in validate_result.output
    assert score_result.exit_code == 0, score_result.output
    assert '"overall_score": 81' in score_result.output


def test_validate_and_score_fail_when_remote_preview_is_not_publishable(monkeypatch) -> None:
    runner = CliRunner()

    class FakeClient:
        def __init__(self, api_key: str) -> None:
            self.api_key = api_key

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def preview_quality_score(self, manual):
            from siglume_api_sdk import ToolManualIssue, ToolManualQualityReport

            return ToolManualQualityReport(
                overall_score=81,
                grade="B",
                issues=[ToolManualIssue(code="MISSING_FIELD", message="usage_hints is missing", field="usage_hints")],
                keyword_coverage_estimate=55,
                improvement_suggestions=["Add usage hints."],
                publishable=False,
                validation_ok=False,
            )

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")
    monkeypatch.setattr(project_module, "SiglumeClient", FakeClient)

    validate_result = runner.invoke(main, ["validate", "examples/hello_echo.py", "--json"])
    score_result = runner.invoke(main, ["score", "examples/hello_echo.py", "--remote", "--json"])

    assert validate_result.exit_code == 1, validate_result.output
    assert '"ok": false' in validate_result.output
    assert score_result.exit_code == 1, score_result.output
    assert '"ok": false' in score_result.output


def test_score_command_supports_offline_mode_without_api_key(monkeypatch) -> None:
    runner = CliRunner()

    def fail_resolve_api_key() -> str:
        raise AssertionError("resolve_api_key should not run for offline scoring")

    monkeypatch.setattr(project_module, "resolve_api_key", fail_resolve_api_key)

    result = runner.invoke(main, ["score", "examples/payment_quote.py", "--offline", "--json"])

    assert result.exit_code == 0, result.output
    assert '"mode": "offline"' in result.output
    assert '"overall_score":' in result.output


def test_test_command_runs_harness() -> None:
    runner = CliRunner()
    result = runner.invoke(main, ["test", "examples/hello_price_compare.py", "--json"])
    assert result.exit_code == 0, result.output
    assert '"ok": true' in result.output
    assert '"dry_run"' in result.output


def test_register_support_and_usage_commands(monkeypatch) -> None:
    runner = CliRunner()

    class FakePage:
        def __init__(self, items):
            self._items = items

        def all_items(self):
            return self._items

    class FakeClient:
        def __init__(self, api_key: str) -> None:
            self.api_key = api_key

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def auto_register(self, manifest, tool_manual):
            return SimpleNamespace(listing_id="lst_123", status="draft")

        def confirm_registration(self, listing_id: str):
            return SimpleNamespace(
                listing_id=listing_id,
                status="pending_review",
                quality=SimpleNamespace(overall_score=85, grade="B"),
            )

        def create_support_case(self, subject: str, body: str, trace_id: str | None = None):
            return SimpleNamespace(support_case_id="sup_123", status="open", trace_id=trace_id)

        def get_usage(self, capability_key=None, period_key=None):
            item = SimpleNamespace(
                created_at="2026-04-19T00:00:00Z",
                capability_key=capability_key,
                outcome="success",
                units_consumed=2,
            )
            return FakePage([item])

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")
    monkeypatch.setattr(project_module, "SiglumeClient", FakeClient)

    register_result = runner.invoke(main, ["register", "examples/hello_echo.py", "--confirm", "--json"])
    support_result = runner.invoke(
        main,
        ["support", "create", "--subject", "Need help", "--body", "Please inspect.", "--trace-id", "trc_cli", "--json"],
    )
    usage_result = runner.invoke(main, ["usage", "--capability", "price-compare-helper", "--json"])

    assert register_result.exit_code == 0, register_result.output
    assert '"listing_id": "lst_123"' in register_result.output
    assert support_result.exit_code == 0, support_result.output
    assert '"support_case_id": "sup_123"' in support_result.output
    assert usage_result.exit_code == 0, usage_result.output
    assert '"count": 1' in usage_result.output
