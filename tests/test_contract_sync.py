from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import contract_sync  # noqa: E402


def _check_public_sdk_sync():
    try:
        result = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "--is-inside-work-tree"],
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        pytest.skip("public SDK sync byte tests require the git executable")
    if result.returncode != 0:
        pytest.skip("public SDK sync byte tests require a Git checkout")
    import check_public_sdk_sync  # noqa: PLC0415

    return check_public_sdk_sync


def test_docs_and_contracts_are_in_sync() -> None:
    issues = contract_sync.run_contract_sync(ROOT)
    assert not issues, "\n".join(str(issue) for issue in issues)


def test_openapi_keeps_connected_account_oauth_routes_public() -> None:
    text = (ROOT / "openapi" / "developer-surface.yaml").read_text(encoding="utf-8")
    required_fragments = [
        "/me/connected-accounts/providers:",
        "/me/connected-accounts/oauth/authorize:",
        "/me/connected-accounts/oauth/callback:",
        "/me/connected-accounts/{accountId}/refresh:",
        "/me/connected-accounts/{accountId}/revoke:",
        "/market/capabilities/{listingId}/oauth-credentials:",
        "ConnectedAccountProviderListEnvelope:",
        "ConnectedAccountOAuthAuthorizeRequest:",
        "ConnectedAccountOAuthStartEnvelope:",
        "ConnectedAccountOAuthCallbackRequest:",
        "ConnectedAccountLifecycleEnvelope:",
        "ListingOAuthCredentialsStatusEnvelope:",
    ]
    for fragment in required_fragments:
        assert fragment in text, fragment


def test_public_sync_compare_normalizes_text_line_endings(tmp_path: Path) -> None:
    check_public_sdk_sync = _check_public_sdk_sync()
    text = tmp_path / "sample.md"
    text.write_bytes(b"alpha\r\nbeta\r\n")
    assert check_public_sdk_sync._comparable_bytes(text) == b"alpha\nbeta\n"


def test_public_sync_compare_preserves_known_binary_bytes(tmp_path: Path) -> None:
    check_public_sdk_sync = _check_public_sdk_sync()
    image = tmp_path / "sample.gif"
    data = b"GIF89a\r\nbinary\r\npayload"
    image.write_bytes(data)
    assert check_public_sdk_sync._comparable_bytes(image) == data
