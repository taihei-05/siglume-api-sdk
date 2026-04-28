from __future__ import annotations

import json
import sys
from types import SimpleNamespace
from pathlib import Path

from click.testing import CliRunner


ROOT = Path(__file__).resolve().parents[1]
EXAMPLES_ROOT = ROOT / "examples"
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


def _write_register_project(
    project_dir: Path,
    *,
    include_tool_manual: bool = True,
    runtime_validation: dict | None = None,
    required_connected_accounts: list | None = None,
    oauth_credentials: dict | list | None = None,
    docs_url: str = "https://docs.siglume.test/register-project",
    support_contact: str = "https://support.siglume.test/register-project",
) -> None:
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "adapter.py").write_text(
        "\n".join(
            [
                "from siglume_api_sdk import AppAdapter, AppManifest",
                "",
                "class RegisterProject(AppAdapter):",
                "    def manifest(self):",
                "        return AppManifest(",
                "            capability_key='register-project',",
                "            name='Register Project',",
                "            job_to_be_done='Echo a registration test request.',",
                "            jurisdiction='US',",
                "            dry_run_supported=True,",
                f"            required_connected_accounts={required_connected_accounts or []!r},",
                f"            docs_url='{docs_url}',",
                f"            support_contact='{support_contact}',",
                "            example_prompts=['Echo this registration test query.', 'Echo the test payload back.'],",
                "        )",
                "    async def execute(self, ctx):",
                "        return {'success': True, 'output': {'summary': 'ok'}}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    if include_tool_manual:
        (project_dir / "tool_manual.json").write_text(
            json.dumps(
                {
                    "tool_name": "register_project",
                    "job_to_be_done": "Echo a registration test request.",
                    "summary_for_model": "Echoes a test request for SDK registration coverage.",
                    "trigger_conditions": [
                        "owner asks for a registration test echo",
                        "agent needs to verify a CLI registration fixture",
                        "request is to smoke-test registration output",
                    ],
                    "do_not_use_when": [
                        "the request is unrelated to echo testing",
                        "the owner expects the adapter to call an external service",
                    ],
                    "permission_class": "read_only",
                    "dry_run_supported": True,
                    "requires_connected_accounts": [],
                    "input_schema": {
                        "type": "object",
                        "properties": {"query": {"type": "string"}},
                        "required": ["query"],
                        "additionalProperties": False,
                    },
                    "output_schema": {
                        "type": "object",
                        "properties": {"summary": {"type": "string"}},
                        "required": ["summary"],
                        "additionalProperties": False,
                    },
                    "usage_hints": ["Use for registration smoke tests."],
                    "result_hints": ["Return the summary."],
                    "error_hints": ["Ask for a query if missing."],
                    "jurisdiction": "US",
                }
            ),
            encoding="utf-8",
        )
    (project_dir / "runtime_validation.json").write_text(
        json.dumps(
            runtime_validation
            or {
                "public_base_url": "https://runtime.example.test",
                "healthcheck_url": "https://runtime.example.test/health",
                "invoke_url": "https://runtime.example.test/invoke",
                "test_auth_header_name": "X-Siglume-Review-Key",
                "test_auth_header_value": "review-secret",
                "request_payload": {"query": "hello"},
                "expected_response_fields": ["summary"],
            }
        ),
        encoding="utf-8",
    )
    if oauth_credentials is not None:
        (project_dir / "oauth_credentials.json").write_text(
            json.dumps(oauth_credentials),
            encoding="utf-8",
        )


def test_init_command_writes_template_files() -> None:
    runner = CliRunner()
    with runner.isolated_filesystem():
        result = runner.invoke(main, ["init", "--template", "echo"])
        assert result.exit_code == 0, result.output
        assert Path("adapter.py").exists()
        assert Path("manifest.json").exists()
        assert Path("tool_manual.json").exists()
        assert Path("runtime_validation.json").exists()
        assert Path("docs/api-usage.md").exists()
        assert Path(".gitignore").exists()
        assert Path("README.md").exists()
        gitignore_text = Path(".gitignore").read_text(encoding="utf-8")
        assert "runtime_validation.json" in gitignore_text
        assert "oauth_credentials.json" in gitignore_text
        readme_text = Path("README.md").read_text(encoding="utf-8")
        docs_text = Path("docs/api-usage.md").read_text(encoding="utf-8")
        assert "dedicated public usage guide" in docs_text
        assert "Start locally without a Siglume API key" in readme_text
        assert "Do not commit real review keys or OAuth client secrets" in readme_text
        assert readme_text.index("siglume score . --offline") < readme_text.index("siglume validate .")


def test_init_command_merges_existing_gitignore() -> None:
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path(".gitignore").write_text("custom-local.log\nnode_modules/\n", encoding="utf-8")
        result = runner.invoke(main, ["init", "--template", "echo"])
        assert result.exit_code == 0, result.output
        gitignore_text = Path(".gitignore").read_text(encoding="utf-8")
        assert "custom-local.log" in gitignore_text
        assert "node_modules/" in gitignore_text
        assert "runtime_validation.json" in gitignore_text
        assert "oauth_credentials.json" in gitignore_text
        assert Path("adapter.py").exists()


def test_init_payment_template_writes_valid_tool_manual() -> None:
    runner = CliRunner()
    with runner.isolated_filesystem():
        result = runner.invoke(main, ["init", "--template", "payment"])
        assert result.exit_code == 0, result.output
        tool_manual = json.loads(Path("tool_manual.json").read_text(encoding="utf-8"))
        valid, issues = validate_tool_manual(tool_manual)
        assert valid, issues


def test_register_blocks_generated_runtime_placeholder() -> None:
    runner = CliRunner()
    with runner.isolated_filesystem():
        init_result = runner.invoke(main, ["init", "--template", "echo"])
        assert init_result.exit_code == 0, init_result.output

        register_result = runner.invoke(main, ["register", ".", "--json"])

        assert register_result.exit_code == 1
        assert "runtime_validation.json is not ready for production registration" in register_result.output
        assert "runtime_validation.public_base_url" in register_result.output


def test_register_blocks_publisher_identity_placeholders(tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "publisher-placeholder"
    _write_register_project(
        project_dir,
        docs_url="https://example.com/docs",
        support_contact="support@example.com",
    )

    register_result = runner.invoke(main, ["register", str(project_dir), "--json"])

    assert register_result.exit_code == 1
    assert "Production auto-register requires real publisher identity" in register_result.output
    assert "manifest.docs_url" in register_result.output
    assert "manifest.support_contact" in register_result.output


def test_register_requires_explicit_tool_manual(tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "missing-manual"
    _write_register_project(project_dir, include_tool_manual=False)

    result = runner.invoke(main, ["register", str(project_dir), "--json"])

    assert result.exit_code == 1
    assert "tool_manual.json is required for `siglume register`" in result.output


def test_register_blocks_runtime_placeholders_after_publisher_identity_is_real(tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "runtime-placeholder"
    _write_register_project(
        project_dir,
        runtime_validation={
            "public_base_url": "https://api.example.com",
            "healthcheck_url": "https://api.example.com/health",
            "invoke_url": "https://api.example.com/invoke",
            "test_auth_header_name": "X-Siglume-Review-Key",
            "test_auth_header_value": "review-secret",
            "request_payload": {"query": "hello"},
            "expected_response_fields": ["summary"],
        },
    )

    result = runner.invoke(main, ["register", str(project_dir), "--json"])

    assert result.exit_code == 1
    assert "runtime_validation.json is not ready for production registration" in result.output
    assert "runtime_validation.public_base_url" in result.output


def test_register_blocks_non_publishable_remote_quality(monkeypatch, tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "quality-blocked"
    _write_register_project(project_dir)

    class FakeClient:
        auto_register_called = False

        def __init__(self, api_key: str) -> None:
            self.api_key = api_key

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def preview_quality_score(self, manual):
            from siglume_api_sdk import ToolManualIssue, ToolManualQualityReport

            return ToolManualQualityReport(
                overall_score=62,
                grade="C",
                issues=[ToolManualIssue(code="LOW_QUALITY", message="Too vague", field="summary_for_model")],
                keyword_coverage_estimate=10,
                improvement_suggestions=["Add clearer trigger conditions."],
                publishable=False,
                validation_ok=True,
            )

        def auto_register(self, *args, **kwargs):
            self.auto_register_called = True
            raise AssertionError("auto_register should not run after failed preflight")

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")
    monkeypatch.setattr(project_module, "SiglumeClient", FakeClient)

    result = runner.invoke(main, ["register", str(project_dir), "--json"])

    assert result.exit_code == 1
    assert "Registration preflight failed" in result.output
    assert "remote Tool Manual quality is not publishable: C (62/100)" in result.output
    assert FakeClient.auto_register_called is False


def test_register_allows_api_managed_connected_account_without_oauth_seed(monkeypatch, tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "api-managed-oauth"
    _write_register_project(
        project_dir,
        required_connected_accounts=["twitter"],
    )

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
                overall_score=90,
                grade="A",
                issues=[],
                keyword_coverage_estimate=70,
                improvement_suggestions=[],
                publishable=True,
                validation_ok=True,
            )

        def auto_register(self, manifest, tool_manual, **kwargs):
            assert kwargs.get("oauth_credentials") is None
            return SimpleNamespace(listing_id="lst_api_managed", status="draft")

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")
    monkeypatch.setattr(project_module, "SiglumeClient", FakeClient)

    result = runner.invoke(main, ["register", str(project_dir), "--json"])

    assert result.exit_code == 0, result.output
    assert '"listing_id": "lst_api_managed"' in result.output


def test_register_requires_oauth_seed_for_platform_managed_oauth_api(monkeypatch, tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "oauth-required"
    _write_register_project(
        project_dir,
        required_connected_accounts=[{"provider_key": "twitter", "platform_managed": True}],
    )

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")

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
                overall_score=90,
                grade="A",
                issues=[],
                keyword_coverage_estimate=70,
                improvement_suggestions=[],
                publishable=True,
                validation_ok=True,
            )

    monkeypatch.setattr(project_module, "SiglumeClient", FakeClient)

    result = runner.invoke(main, ["register", str(project_dir), "--json"])

    assert result.exit_code == 1
    assert "oauth_credentials.json" in result.output
    assert "twitter" in result.output


def test_register_rejects_platform_managed_oauth_without_provider_key(monkeypatch, tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "oauth-missing-provider"
    _write_register_project(
        project_dir,
        required_connected_accounts=[{"platform_managed": True, "required_scopes": ["chat:write"]}],
    )

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")

    result = runner.invoke(main, ["register", str(project_dir), "--json"])

    assert result.exit_code == 1
    assert "platform-managed entries must include a supported provider_key" in result.output


def test_register_canonicalizes_oauth_seed_payload(monkeypatch, tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "oauth-canonical"
    _write_register_project(
        project_dir,
        required_connected_accounts=[{"provider_key": "google-drive", "platform_managed": True}],
        oauth_credentials=[
            {
                "provider": "gmail",
                "client_id": "google-client",
                "client_secret": "google-secret",
                "scopes": ["gmail.readonly"],
            }
        ],
    )

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
                overall_score=90,
                grade="A",
                issues=[],
                keyword_coverage_estimate=70,
                improvement_suggestions=[],
                publishable=True,
                validation_ok=True,
            )

        def auto_register(self, manifest, tool_manual, **kwargs):
            assert kwargs["oauth_credentials"] == {
                "items": [
                    {
                        "provider_key": "google",
                        "client_id": "google-client",
                        "client_secret": "google-secret",
                        "required_scopes": ["gmail.readonly"],
                    }
                ]
            }
            return SimpleNamespace(listing_id="lst_oauth", status="draft")

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")
    monkeypatch.setattr(project_module, "SiglumeClient", FakeClient)

    result = runner.invoke(main, ["register", str(project_dir), "--json"])

    assert result.exit_code == 0, result.output
    assert '"listing_id": "lst_oauth"' in result.output


def test_register_rejects_string_oauth_scopes(tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "oauth-bad-scopes"
    _write_register_project(
        project_dir,
        required_connected_accounts=["google"],
        oauth_credentials=[
            {
                "provider": "gmail",
                "client_id": "google-client",
                "client_secret": "google-secret",
                "scopes": "gmail.readonly",
            }
        ],
    )

    result = runner.invoke(main, ["register", str(project_dir), "--json"])

    assert result.exit_code == 1
    assert "required_scopes must be a JSON array" in result.output


def test_register_rejects_root_docs_url_before_remote_registration(tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "root-docs-url"
    _write_register_project(project_dir, docs_url="https://docs.siglume.test")

    result = runner.invoke(main, ["register", str(project_dir), "--json"])

    assert result.exit_code == 1
    assert "manifest.docs_url must be a dedicated API usage page" in result.output


def test_register_preflight_allows_tool_manual_warnings(monkeypatch, tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "warning-allowed"
    _write_register_project(project_dir)
    manual = json.loads((project_dir / "tool_manual.json").read_text(encoding="utf-8"))
    manual["input_schema"]["properties"]["trace_id"] = {
        "type": "string",
        "description": "Platform-injected trace identifier.",
    }
    (project_dir / "tool_manual.json").write_text(json.dumps(manual), encoding="utf-8")

    class FakeClient:
        auto_register_called = False

        def __init__(self, api_key: str) -> None:
            self.api_key = api_key

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def preview_quality_score(self, manual):
            from siglume_api_sdk import ToolManualQualityReport

            return ToolManualQualityReport(
                overall_score=90,
                grade="A",
                issues=[],
                keyword_coverage_estimate=70,
                improvement_suggestions=[],
                publishable=True,
                validation_ok=True,
            )

        def auto_register(self, manifest, tool_manual, **kwargs):
            FakeClient.auto_register_called = True
            return SimpleNamespace(listing_id="lst_warning", status="draft")

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")
    monkeypatch.setattr(project_module, "SiglumeClient", FakeClient)

    result = runner.invoke(main, ["register", str(project_dir), "--json"])

    assert result.exit_code == 0, result.output
    assert '"listing_id": "lst_warning"' in result.output
    assert '"registration_preflight"' in result.output
    assert FakeClient.auto_register_called is True


def test_preflight_runs_registration_checks_without_creating_draft(monkeypatch, tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "preflight-only"
    _write_register_project(project_dir)

    class FakeClient:
        auto_register_called = False

        def __init__(self, api_key: str) -> None:
            self.api_key = api_key

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def preview_quality_score(self, manual):
            from siglume_api_sdk import ToolManualQualityReport

            return ToolManualQualityReport(
                overall_score=93,
                grade="A",
                issues=[],
                keyword_coverage_estimate=74,
                improvement_suggestions=[],
                publishable=True,
                validation_ok=True,
            )

        def auto_register(self, *args, **kwargs):
            FakeClient.auto_register_called = True
            raise AssertionError("preflight must not create a draft")

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")
    monkeypatch.setattr(project_module, "SiglumeClient", FakeClient)

    result = runner.invoke(main, ["preflight", str(project_dir), "--json"])

    assert result.exit_code == 0, result.output
    assert '"ok": true' in result.output
    assert '"registration_preflight"' in result.output
    assert '"overall_score": 93' in result.output
    assert FakeClient.auto_register_called is False


def test_register_human_output_includes_review_and_trace_metadata(monkeypatch, tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "human-output"
    _write_register_project(project_dir)

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
                overall_score=91,
                grade="A",
                issues=[],
                keyword_coverage_estimate=72,
                improvement_suggestions=[],
                publishable=True,
                validation_ok=True,
            )

        def auto_register(self, manifest, tool_manual, **kwargs):
            return SimpleNamespace(
                listing_id="lst_123",
                status="draft",
                registration_mode="upgrade",
                listing_status="active",
                oauth_status={"configured": True},
                review_url="https://siglume.com/owner/publish?listing=lst_123",
                trace_id="trc_reg",
                request_id="req_reg",
            )

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")
    monkeypatch.setattr(project_module, "SiglumeClient", FakeClient)

    result = runner.invoke(main, ["register", str(project_dir)])

    assert result.exit_code == 0, result.output
    assert "Upgrade staged." in result.output
    assert "receipt_status: draft" in result.output
    assert "listing_status: active" in result.output
    assert "oauth_configured: True" in result.output
    assert "review_url: https://siglume.com/owner/publish?listing=lst_123" in result.output
    assert "trace_id: trc_reg" in result.output
    assert "request_id: req_reg" in result.output
    assert "preflight_quality: A (91/100)" in result.output


def test_register_submit_review_human_output_uses_publish_wording(monkeypatch, tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "legacy-submit-review"
    _write_register_project(project_dir)

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
                overall_score=89,
                grade="B",
                issues=[],
                keyword_coverage_estimate=68,
                improvement_suggestions=[],
                publishable=True,
                validation_ok=True,
            )

        def auto_register(self, manifest, tool_manual, **kwargs):
            return SimpleNamespace(
                listing_id="lst_legacy",
                status="draft",
            )

        def submit_review(self, listing_id: str):
            assert listing_id == "lst_legacy"
            return SimpleNamespace(status="active")

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")
    monkeypatch.setattr(project_module, "SiglumeClient", FakeClient)

    result = runner.invoke(main, ["register", str(project_dir), "--submit-review"])

    assert result.exit_code == 0, result.output
    assert "receipt_status: draft" in result.output
    assert "Listing published via legacy submit-review alias." in result.output
    assert "Submitted for review." not in result.output
    assert "publish_status: active" in result.output


def test_register_confirm_human_output_includes_release_status(monkeypatch, tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "confirm-human-output"
    _write_register_project(project_dir)

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
                overall_score=90,
                grade="A",
                issues=[],
                keyword_coverage_estimate=70,
                improvement_suggestions=[],
                publishable=True,
                validation_ok=True,
            )

        def auto_register(self, manifest, tool_manual, **kwargs):
            return SimpleNamespace(
                listing_id="lst_confirm",
                status="draft",
                review_url="https://siglume.com/owner/publish?listing=lst_confirm",
                trace_id="trc_confirm_reg",
                request_id="req_confirm_reg",
            )

        def confirm_registration(self, listing_id: str):
            assert listing_id == "lst_confirm"
            return {
                "listing_id": listing_id,
                "status": "active",
                "release": {"release_status": "published"},
                "quality": {"overall_score": 84, "grade": "B"},
            }

    monkeypatch.setattr(project_module, "resolve_api_key", lambda: "sig_test_key")
    monkeypatch.setattr(project_module, "SiglumeClient", FakeClient)

    result = runner.invoke(main, ["register", str(project_dir), "--confirm"])

    assert result.exit_code == 0, result.output
    assert "Listing published." in result.output
    assert "receipt_status: draft" in result.output
    assert "confirmation_status: active" in result.output
    assert "release_status: published" in result.output


def test_init_command_lists_owner_operations(monkeypatch) -> None:
    runner = CliRunner()

    def fake_catalog(*, agent_id=None, lang="en"):
        operations = [
            project_module.to_jsonable(item)
            for item in project_module.fallback_operation_catalog(agent_id="agt_owner_demo")
        ]
        return {
            "agent_id": "agt_owner_demo",
            "source": "fallback",
            "warning": "using fallback catalog",
            "operations": operations,
        }

    monkeypatch.setattr(project_module, "list_operation_catalog", fake_catalog)

    result = runner.invoke(main, ["init", "--list-operations", "--json"])

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["source"] == "fallback"
    assert any(
        str(item.get("operation_key") or "").startswith("owner.")
        for item in payload["operations"]
    )


def test_init_command_generates_operation_wrapper_with_grade_b_or_better(monkeypatch) -> None:
    runner = CliRunner()

    def fake_catalog(*, agent_id=None, lang="en"):
        operations = [
            project_module.to_jsonable(item)
            for item in project_module.fallback_operation_catalog(agent_id="agt_owner_demo")
        ]
        return {
            "agent_id": "agt_owner_demo",
            "source": "fallback",
            "warning": "using fallback catalog",
            "operations": operations,
        }

    monkeypatch.setattr(project_module, "list_operation_catalog", fake_catalog)

    with runner.isolated_filesystem():
        result = runner.invoke(
            main,
            [
                "init",
                "--from-operation",
                "owner.charter.update",
                "--capability-key",
                "my-charter-wrapper",
                "--json",
            ],
        )
        assert result.exit_code == 0, result.output
        payload = json.loads(result.output)
        assert payload["operation"]["operation_key"] == "owner.charter.update"
        assert Path("adapter.py").exists()
        assert Path("stubs.py").exists()
        assert Path("runtime_validation.json").exists()
        assert Path("docs/api-usage.md").exists()
        assert Path(".gitignore").exists()
        assert Path("tests/test_adapter.py").exists()
        gitignore_text = Path(".gitignore").read_text(encoding="utf-8")
        assert "runtime_validation.json" in gitignore_text
        assert "oauth_credentials.json" in gitignore_text
        manifest = json.loads(Path("manifest.json").read_text(encoding="utf-8"))
        assert manifest["docs_url"] == "https://example.com/docs"
        assert manifest["support_contact"] == "support@example.com"
        manual = json.loads(Path("tool_manual.json").read_text(encoding="utf-8"))
        valid, issues = validate_tool_manual(manual)
        assert valid, issues
        assert payload["report"]["quality"]["grade"] in {"A", "B"}
        adapter_text = Path("adapter.py").read_text(encoding="utf-8")
        readme_text = Path("README.md").read_text(encoding="utf-8")
        assert "execute_owner_operation" in adapter_text
        assert 'support_contact="support@example.com"' in adapter_text
        assert 'docs_url="https://example.com/docs"' in adapter_text
        assert "replace `docs_url` with a dedicated public API usage guide" in readme_text
        assert "Replace `support_contact` with a real support email address" in readme_text
        assert "Start locally without a Siglume API key" in readme_text
        assert "Do not commit real review keys or OAuth client secrets" in readme_text
        assert readme_text.index("siglume score . --offline") < readme_text.index("siglume validate .")
        assert readme_text.index("pytest tests/test_adapter.py") < readme_text.index("siglume register . --confirm")


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


def test_tool_manual_validator_allows_json_schema_composition_keywords() -> None:
    manifest = AppManifest(
        capability_key="price-compare-helper",
        name="Price Compare Helper",
        job_to_be_done="Compare retailer prices for a product and return the best current offer.",
        category=AppCategory.COMMERCE,
        permission_class=PermissionClass.READ_ONLY,
        approval_mode=ApprovalMode.AUTO,
        dry_run_supported=True,
        required_connected_accounts=[],
        price_model=PriceModel.FREE,
        jurisdiction="US",
    )
    manual = project_module.build_tool_manual_template(manifest)
    manual["input_schema"] = {
        "type": "object",
        "properties": {
            "query": {
                "anyOf": [
                    {"type": "string", "description": "Product query."},
                    {"type": "null"},
                ]
            }
        },
        "required": ["query"],
        "additionalProperties": False,
    }

    valid, issues = validate_tool_manual(manual)

    assert valid, issues


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

    example_path = str(EXAMPLES_ROOT / "hello_echo.py")
    validate_result = runner.invoke(main, ["validate", example_path, "--json"])
    score_result = runner.invoke(main, ["score", example_path, "--remote", "--json"])

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

    example_path = str(EXAMPLES_ROOT / "hello_echo.py")
    validate_result = runner.invoke(main, ["validate", example_path, "--json"])
    score_result = runner.invoke(main, ["score", example_path, "--remote", "--json"])

    assert validate_result.exit_code == 1, validate_result.output
    assert '"ok": false' in validate_result.output
    assert score_result.exit_code == 1, score_result.output
    assert '"ok": false' in score_result.output


def test_score_command_supports_offline_mode_without_api_key(monkeypatch) -> None:
    runner = CliRunner()

    def fail_resolve_api_key() -> str:
        raise AssertionError("resolve_api_key should not run for offline scoring")

    monkeypatch.setattr(project_module, "resolve_api_key", fail_resolve_api_key)

    example_path = str(EXAMPLES_ROOT / "payment_quote.py")
    result = runner.invoke(main, ["score", example_path, "--offline", "--json"])

    assert result.exit_code == 0, result.output
    assert '"mode": "offline"' in result.output
    assert '"overall_score":' in result.output


def test_test_command_runs_harness() -> None:
    runner = CliRunner()
    example_path = str(EXAMPLES_ROOT / "hello_price_compare.py")
    result = runner.invoke(main, ["test", example_path, "--json"])
    assert result.exit_code == 0, result.output
    assert '"ok": true' in result.output
    assert '"dry_run"' in result.output


def test_register_support_and_usage_commands(monkeypatch, tmp_path) -> None:
    runner = CliRunner()
    project_dir = tmp_path / "register-project"
    project_dir.mkdir()
    (project_dir / "adapter.py").write_text(
        "\n".join(
            [
                "from siglume_api_sdk import AppAdapter, AppManifest",
                "",
                "class RegisterProject(AppAdapter):",
                "    def manifest(self):",
                "        return AppManifest(",
                "            capability_key='register-project',",
                "            name='Register Project',",
                "            job_to_be_done='Echo a registration test request.',",
                "            jurisdiction='US',",
                "            dry_run_supported=True,",
                "            docs_url='https://docs.siglume.test/register-project',",
                "            support_contact='https://support.siglume.test/register-project',",
                "            example_prompts=['Echo this registration test query.', 'Echo the test payload back.'],",
                "        )",
                "    async def execute(self, ctx):",
                "        return {'success': True, 'output': {'summary': 'ok'}}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (project_dir / "tool_manual.json").write_text(
        json.dumps(
            {
                "tool_name": "register_project",
                "job_to_be_done": "Echo a registration test request.",
                "summary_for_model": "Echoes a test request for SDK registration coverage.",
                "trigger_conditions": [
                    "owner asks for a registration test echo",
                    "agent needs to verify a CLI registration fixture",
                    "request is to smoke-test registration output",
                ],
                "do_not_use_when": [
                    "the request is unrelated to echo testing",
                    "the owner expects the adapter to call an external service",
                ],
                "permission_class": "read_only",
                "dry_run_supported": True,
                "requires_connected_accounts": [],
                "input_schema": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                    "additionalProperties": False,
                },
                "output_schema": {
                    "type": "object",
                    "properties": {"summary": {"type": "string"}},
                    "required": ["summary"],
                    "additionalProperties": False,
                },
                "usage_hints": ["Use for registration smoke tests."],
                "result_hints": ["Return the summary."],
                "error_hints": ["Ask for a query if missing."],
            }
        ),
        encoding="utf-8",
    )
    (project_dir / "runtime_validation.json").write_text(
        json.dumps(
            {
                "public_base_url": "https://runtime.example.test",
                "healthcheck_url": "https://runtime.example.test/health",
                "invoke_url": "https://runtime.example.test/invoke",
                "test_auth_header_name": "X-Siglume-Review-Key",
                "test_auth_header_value": "review-secret",
                "request_payload": {"query": "hello"},
                "expected_response_fields": ["summary"],
            }
        ),
        encoding="utf-8",
    )

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

        def auto_register(self, manifest, tool_manual, **kwargs):
            assert kwargs["runtime_validation"]["invoke_url"] == "https://runtime.example.test/invoke"
            return SimpleNamespace(
                listing_id="lst_123",
                status="draft",
                review_url="https://siglume.com/owner/publish?listing=lst_123",
                trace_id="trc_reg",
                request_id="req_reg",
            )

        def preview_quality_score(self, manual):
            from siglume_api_sdk import ToolManualQualityReport

            return ToolManualQualityReport(
                overall_score=88,
                grade="B",
                issues=[],
                keyword_coverage_estimate=64,
                improvement_suggestions=[],
                publishable=True,
                validation_ok=True,
            )

        def confirm_registration(self, listing_id: str):
            return SimpleNamespace(
                listing_id=listing_id,
                status="active",
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

    register_result = runner.invoke(main, ["register", str(project_dir), "--confirm", "--json"])
    support_result = runner.invoke(
        main,
        ["support", "create", "--subject", "Need help", "--body", "Please inspect.", "--trace-id", "trc_cli", "--json"],
    )
    usage_result = runner.invoke(main, ["usage", "--capability", "price-compare-helper", "--json"])

    assert register_result.exit_code == 0, register_result.output
    assert '"listing_id": "lst_123"' in register_result.output
    assert '"review_url": "https://siglume.com/owner/publish?listing=lst_123"' in register_result.output
    assert '"registration_preflight"' in register_result.output
    assert support_result.exit_code == 0, support_result.output
    assert '"support_case_id": "sup_123"' in support_result.output
    assert usage_result.exit_code == 0, usage_result.output
    assert '"count": 1' in usage_result.output
