"""Tests for the v0.7 track 3 connected-accounts client wrappers."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk import (  # noqa: E402
    ConnectedAccountLifecycleResult,
    ConnectedAccountOAuthStart,
    ConnectedAccountProvider,
    SiglumeClient,
)


def envelope(data, *, trace_id: str = "trc", request_id: str = "req") -> dict[str, object]:
    return {"data": data, "meta": {"request_id": request_id, "trace_id": trace_id}, "error": None}


def _build(handler) -> SiglumeClient:
    return SiglumeClient(
        api_key="sig_test",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


def test_list_providers_parses_registry() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/v1/me/connected-accounts/providers"
        return httpx.Response(200, json=envelope({
            "items": [
                {
                    "provider_key": "slack", "display_name": "Slack",
                    "auth_type": "oauth2", "refresh_supported": True,
                    "pkce_required": False,
                    "default_scopes": ["chat:write"],
                    "available_scopes": ["chat:write", "channels:read"],
                    "scope_separator": ",",
                },
                {
                    "provider_key": "google", "display_name": "Google",
                    "auth_type": "oauth2", "refresh_supported": True,
                    "pkce_required": True,
                    "default_scopes": ["openid"], "available_scopes": ["openid"],
                    "scope_separator": " ",
                },
            ],
        }))

    providers = _build(handler).list_connected_account_providers()
    assert len(providers) == 2
    assert isinstance(providers[0], ConnectedAccountProvider)
    assert providers[0].provider_key == "slack"
    assert providers[1].pkce_required is True


def test_start_oauth_posts_listing_id_and_returns_authorize_url() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(201, json=envelope({
            "authorize_url": "https://slack.com/oauth/v2/authorize?state=s&client_id=sato-cid",
            "state": "s-abc",
            "provider_key": "slack",
            "scopes": ["chat:write"],
            "pkce_method": None,
        }))

    start = _build(handler).start_connected_account_oauth(
        listing_id="lst_abc",
        redirect_uri="https://siglume.example/cb",
        scopes=["chat:write"],
        account_role="bot",
    )
    assert captured["method"] == "POST"
    assert captured["path"] == "/v1/me/connected-accounts/oauth/authorize"
    body = captured["body"]
    # Responsibility-correction: callers pass listing_id, not provider_key.
    # Platform derives provider_key from the listing's seller-registered creds.
    assert body["listing_id"] == "lst_abc"
    assert "provider_key" not in body
    assert body["scopes"] == ["chat:write"]
    assert isinstance(start, ConnectedAccountOAuthStart)
    assert start.state == "s-abc"


def test_start_oauth_never_sends_client_secret() -> None:
    """Regression: client_secret is a server-side credential and
    must never appear in SDK request bodies."""
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        assert "client_secret" not in body
        assert "client_id" not in body
        return httpx.Response(201, json=envelope({
            "authorize_url": "https://slack.com/oauth/v2/authorize",
            "state": "s", "provider_key": "slack",
            "scopes": ["chat:write"], "pkce_method": None,
        }))

    _build(handler).start_connected_account_oauth(
        listing_id="lst_abc",
        redirect_uri="https://siglume.example/cb",
    )


def test_start_oauth_tolerates_missing_provider_key_in_response() -> None:
    """Regression: v0.7.1 switched the input to listing_id, so the
    response parser must not reference the removed provider_key arg."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/me/connected-accounts/oauth/authorize"
        return httpx.Response(201, json=envelope({
            "authorize_url": "https://slack.com/oauth/v2/authorize",
            "state": "s-abc",
            "scopes": ["chat:write"],
            "pkce_method": None,
        }))

    start = _build(handler).start_connected_account_oauth(
        listing_id="lst_abc",
        redirect_uri="https://siglume.example/cb",
    )
    assert start.state == "s-abc"
    assert start.provider_key == ""


def test_seller_can_set_and_read_listing_oauth_credentials() -> None:
    """Seller registers their Slack app credentials against their
    listing. The read path never returns the secret."""
    calls: list[tuple[str, str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        calls.append((request.method, request.url.path, body))
        if request.method == "PUT":
            return httpx.Response(200, json=envelope({
                "listing_id": "lst_abc",
                "provider_key": "slack",
                "required_scopes": ["chat:write"],
                "configured": True,
            }))
        return httpx.Response(200, json=envelope({
            "listing_id": "lst_abc",
            "provider_key": "slack",
            "configured": True,
            "required_scopes": ["chat:write"],
        }))

    client = _build(handler)
    result = client.set_listing_oauth_credentials(
        "lst_abc",
        provider_key="slack",
        client_id="sato-cid",
        client_secret="sato-secret",
        required_scopes=["chat:write"],
    )
    assert result["configured"] is True
    assert calls[0][0] == "PUT"
    assert calls[0][1] == "/v1/market/capabilities/lst_abc/oauth-credentials"
    assert calls[0][2]["client_secret"] == "sato-secret"

    status = client.get_listing_oauth_credentials_status("lst_abc")
    assert status["configured"] is True
    assert "client_secret" not in status
    assert "client_id" not in status


def test_complete_oauth_returns_account_summary() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/me/connected-accounts/oauth/callback"
        body = json.loads(request.content.decode("utf-8"))
        assert body == {"state": "s-abc", "code": "auth-code-xyz"}
        return httpx.Response(200, json=envelope({
            "connected_account_id": "ca-001",
            "provider_key": "slack",
            "connection_status": "connected",
            "scopes": ["chat:write"],
            "display_name": "Acme workspace",
        }))

    data = _build(handler).complete_connected_account_oauth(
        state="s-abc", code="auth-code-xyz",
    )
    assert data["connected_account_id"] == "ca-001"
    assert data["connection_status"] == "connected"


def test_refresh_returns_typed_lifecycle() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v1/me/connected-accounts/ca-001/refresh"
        return httpx.Response(200, json=envelope({
            "connected_account_id": "ca-001",
            "provider_key": "slack",
            "expires_at": "2026-04-21T01:00:00Z",
            "scopes": ["chat:write"],
            "refreshed_at": "2026-04-21T00:00:00Z",
        }))

    result = _build(handler).refresh_connected_account("ca-001")
    assert isinstance(result, ConnectedAccountLifecycleResult)
    assert result.connected_account_id == "ca-001"
    assert result.expires_at == "2026-04-21T01:00:00Z"


def test_revoke_returns_typed_lifecycle() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/me/connected-accounts/ca-001/revoke"
        return httpx.Response(200, json=envelope({
            "connected_account_id": "ca-001",
            "provider_key": "slack",
            "connection_status": "revoked",
            "provider_revoked": True,
            "revoked_at": "2026-04-21T00:00:00Z",
        }))

    result = _build(handler).revoke_connected_account("ca-001")
    assert result.connection_status == "revoked"
    assert result.provider_revoked is True


def test_no_resolve_method_is_exposed() -> None:
    """Regression: resolve() is runtime-only and must not leak into
    the SDK surface. Capabilities get a handle in-process from the
    gateway; the wire API never returns raw tokens."""
    client = SiglumeClient(api_key="x", base_url="https://x/v1")
    assert not hasattr(client, "resolve_connected_account")
