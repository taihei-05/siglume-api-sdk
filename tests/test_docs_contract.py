import json
import tomllib
from pathlib import Path


SDK_ROOT = Path(__file__).resolve().parents[1]


def _read(relative_path: str) -> str:
    return (SDK_ROOT / relative_path).read_text(encoding="utf-8")


def _read_optional(relative_path: str) -> str:
    path = SDK_ROOT / relative_path
    return path.read_text(encoding="utf-8") if path.exists() else ""


def test_readme_keeps_coding_agent_prompt() -> None:
    readme = _read("README.md")

    assert "## Using Codex or Claude Code" in readme
    assert "Recommended prompt:" in readme
    assert "Read this repository, especially `README.md`, `GETTING_STARTED.md`, and `docs/publish-flow.md`" in readme
    assert "`siglume register . --confirm`" in readme


def test_docs_do_not_advertise_removed_register_flags() -> None:
    docs = "\n".join(
        [
            _read("README.md"),
            _read("GETTING_STARTED.md"),
            _read("docs/publish-flow.md"),
        ]
    )

    for removed_flag in ("--no-preflight", "--force-draft", "--allow-generated-manual"):
        assert removed_flag not in docs


def test_package_runtime_versions_match_release_metadata() -> None:
    pyproject = tomllib.loads(_read("pyproject.toml"))
    package_json = json.loads(_read("siglume-api-sdk-ts/package.json"))
    python_version = str(pyproject["project"]["version"])
    ts_version = str(package_json["version"])

    assert python_version == "0.7.6"
    assert ts_version == python_version
    assert f'SDK_VERSION = "{python_version}"' in _read("siglume_api_sdk/_version.py")
    assert f'export const SDK_VERSION = "{ts_version}";' in _read("siglume-api-sdk-ts/src/version.ts")


def test_onboarding_docs_match_generated_scaffold_and_no_key_first_loop() -> None:
    readme = _read("README.md")
    getting_started = _read("GETTING_STARTED.md")
    ts_readme = _read("siglume-api-sdk-ts/README.md")
    security = _read("SECURITY.md")
    normalized_security = " ".join(security.split())

    assert "v0.5.0 is out" not in readme
    assert "current v0.5 release line" not in ts_readme
    assert "This is an early-stage project (v0.7.6, alpha)" in readme
    assert "Production releases are published by GitHub Actions with PyPI Trusted" in security
    assert "Do not create a PyPI API token or local `.pypirc` for the normal release path." in normalized_security
    assert "Rotate after every release" not in security

    assert "siglume score . --offline" in readme
    assert readme.index("siglume score . --offline") < readme.index("siglume validate .")
    assert "siglume score . --offline" in getting_started
    assert getting_started.index("siglume score . --offline") < getting_started.index("siglume validate .")
    assert "siglume score . --offline" in ts_readme
    assert ts_readme.index("siglume score . --offline") < ts_readme.index("siglume validate .")

    for stale_file in ("my_app.py", "tests/test_app.py", "requirements.txt"):
        assert stale_file not in getting_started
    assert "adapter.py" in getting_started
    assert "manifest.json" in getting_started
    assert "tool_manual.json" in getting_started
    assert "runtime_validation.json" in getting_started
    assert ".gitignore" in getting_started


def test_cli_docs_match_current_sidecar_inputs() -> None:
    docs = "\n".join(
        [
            _read("README.md"),
            _read("GETTING_STARTED.md"),
            _read("docs/publish-flow.md"),
            _read("siglume-api-sdk-ts/README.md"),
            _read("openapi/developer-surface.yaml"),
        ]
    )

    assert "optional `input_form_spec.json`" not in docs
    assert "`source_context.json`" not in docs
    assert "GitHub provenance from your local git checkout" not in docs
    assert "`source_url` plus optional `source_context` lets a coding engine" not in docs
    assert "used by the CLI / coding engine" not in docs
    assert "SDK / HTTP automation can pass `source_url`, `source_context`, and `input_form_spec` directly" in docs
    assert "SDK / HTTP automation can include `source_url` plus optional" in docs
    assert "used by SDK / HTTP automation" in docs
    assert "The CLI does not infer these fields from git." in docs
    assert "`tool_manual.json`" in docs
    assert "`runtime_validation.json`" in docs
    assert "`oauth_credentials.json`" in docs


def test_docs_do_not_advertise_unsupported_connected_account_families() -> None:
    connected_accounts = _read("docs/connected-accounts.md")

    assert "OpenAI" not in connected_accounts
    assert "MetaMask" not in connected_accounts
    assert '["slack", "openai"]' not in connected_accounts
    assert 'provider_key="x-twitter"' not in connected_accounts
    assert 'provider_key="twitter"' in connected_accounts


def test_payment_docs_match_current_polygon_settlement_language() -> None:
    docs = "\n".join(
        [
            _read("README.md"),
            _read("GETTING_STARTED.md"),
            _read("API_IDEAS.md"),
            _read_optional("ANNOUNCEMENT_DRAFT.md"),
            _read("PAYMENT_MIGRATION.md"),
            _read_optional("announcements/POST_ZENN.md"),
            _read("docs/jurisdiction-and-compliance.md"),
            _read("docs/web3-settlement.md"),
            _read("docs/demo-capture-guide.md"),
            _read("docs/publish-flow.md"),
            _read("siglume_api_sdk/cli/project.py"),
            _read("siglume-api-sdk-ts/src/cli/project.ts"),
        ]
    )

    assert "SettlementMode.STRIPE_PAYMENT_INTENT" not in docs
    assert "Stripe Connect today" not in docs
    assert "other platform-supported Polygon assets" not in docs
    assert "REPLACE_WITH_YOUR_90S_VIDEO_URL" not in docs
    assert "Register with a Polygon payout address at `/owner/publish`" not in docs
    assert "Open https://siglume.com/owner/publish and finish payout setup" not in docs
    assert "Payouts` sub-menu" not in docs
    assert "Payouts sub-menu" not in docs
    assert "bank account or wallet address" not in docs
    assert "Wallet at `/owner/credits/payout`" in docs
    assert "external payout wallets are not supported" in docs
