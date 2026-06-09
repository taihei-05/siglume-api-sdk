from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk.cli import project as project_module  # noqa: E402


_TOOL_MANUAL = {
    "input_schema": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    },
    "output_schema": {"required": ["summary"]},
}


def test_template_emits_runtime_auth_header_fields() -> None:
    runtime_validation = project_module._build_runtime_validation_template(_TOOL_MANUAL)
    # Canonical names are scaffolded; the legacy test_auth_header_* names are not.
    assert "runtime_auth_header_name" in runtime_validation
    assert "runtime_auth_header_value" in runtime_validation
    assert "test_auth_header_name" not in runtime_validation
    assert "test_auth_header_value" not in runtime_validation
    # The scaffolded secret is an obvious placeholder so preflight rejects it
    # until the developer swaps in a strong, dedicated value.
    assert runtime_validation["runtime_auth_header_value"].startswith("replace-with-")


def _base_runtime_validation() -> dict[str, object]:
    return {
        "public_base_url": "https://api.acme.dev",
        "healthcheck_url": "https://api.acme.dev/health",
        "invoke_url": "https://api.acme.dev/invoke",
        "request_payload": {"query": "hello"},
        "expected_response_fields": ["summary"],
    }


def test_preflight_accepts_runtime_auth_header_alias() -> None:
    runtime_validation = _base_runtime_validation()
    runtime_validation["runtime_auth_header_name"] = "X-Siglume-Auth"
    runtime_validation["runtime_auth_header_value"] = "strong-random-shared-secret"
    issues = project_module._runtime_placeholder_issues(runtime_validation)
    assert not any("auth_header" in issue for issue in issues)


def test_preflight_accepts_legacy_test_auth_header_alias() -> None:
    runtime_validation = _base_runtime_validation()
    runtime_validation["test_auth_header_name"] = "X-Legacy"
    runtime_validation["test_auth_header_value"] = "strong-random-shared-secret"
    issues = project_module._runtime_placeholder_issues(runtime_validation)
    assert not any("auth_header" in issue for issue in issues)


def test_preflight_flags_missing_runtime_auth_header_with_runtime_named_message() -> None:
    issues = project_module._runtime_placeholder_issues(_base_runtime_validation())
    assert any("runtime_auth_header_name is required" in issue for issue in issues)


def test_preflight_flags_placeholder_runtime_auth_secret() -> None:
    runtime_validation = _base_runtime_validation()
    runtime_validation["runtime_auth_header_name"] = "X-Siglume-Auth"
    runtime_validation["runtime_auth_header_value"] = "replace-with-strong-random-runtime-auth-secret"
    issues = project_module._runtime_placeholder_issues(runtime_validation)
    assert any("runtime_auth_header_value must be a strong" in issue for issue in issues)


def test_preflight_empty_new_key_falls_back_to_legacy_alias() -> None:
    # An explicit empty-string new key must fall back to a populated legacy
    # alias (the `or` resolution), not spuriously report "required".
    runtime_validation = _base_runtime_validation()
    runtime_validation["runtime_auth_header_name"] = ""
    runtime_validation["runtime_auth_header_value"] = ""
    runtime_validation["test_auth_header_name"] = "X-Legacy"
    runtime_validation["test_auth_header_value"] = "strong-random-shared-secret"
    issues = project_module._runtime_placeholder_issues(runtime_validation)
    assert not any("auth_header" in issue for issue in issues)
