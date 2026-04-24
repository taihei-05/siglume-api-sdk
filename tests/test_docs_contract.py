from pathlib import Path


SDK_ROOT = Path(__file__).resolve().parents[1]


def _read(relative_path: str) -> str:
    return (SDK_ROOT / relative_path).read_text(encoding="utf-8")


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


def test_cli_docs_match_current_sidecar_inputs() -> None:
    docs = "\n".join(
        [
            _read("README.md"),
            _read("GETTING_STARTED.md"),
            _read("docs/publish-flow.md"),
            _read("siglume-api-sdk-ts/README.md"),
        ]
    )

    assert "optional `input_form_spec.json`" not in docs
    assert "`source_context.json`" not in docs
    assert "GitHub provenance from your local git checkout" not in docs
    assert "SDK / HTTP automation can pass `source_url`, `source_context`, and `input_form_spec` directly" in docs
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
            _read("docs/jurisdiction-and-compliance.md"),
            _read("docs/web3-settlement.md"),
            _read("docs/demo-capture-guide.md"),
        ]
    )

    assert "SettlementMode.STRIPE_PAYMENT_INTENT" not in docs
    assert "Stripe Connect today" not in docs
    assert "other platform-supported Polygon assets" not in docs
    assert "REPLACE_WITH_YOUR_90S_VIDEO_URL" not in docs
