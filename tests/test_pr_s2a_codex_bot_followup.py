"""Regression tests for chatgpt-codex-connector[bot] findings on
PR-S2a (siglume-api-sdk#136).

Pin: `SiglumeClient._resolve_owner_operation_agent_id` must accept
both the current `agent_id` field and the legacy `id` field from
`GET /me/agent`. `_parse_agent` already supports both; the resolver
added in PR-S2a silently dropped the `id` fallback, which broke
`list_market_needs` / `get_market_need` / `create_market_need` /
`update_market_need` against servers still emitting the legacy shape
whenever the caller omitted `agent_id`.
"""
from __future__ import annotations

import httpx

from siglume_api_sdk.client import SiglumeClient


def envelope(data):
    return {"data": data, "meta": {"request_id": "req_test", "trace_id": "trc_test"}}


def build_client(handler) -> SiglumeClient:
    return SiglumeClient(
        api_key="sig_test_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


def _mock_handler_for_market_needs(
    *, me_agent_payload: dict, expected_agent_id: str
):
    """Return an httpx handler that serves `/me/agent` with the given
    payload and a minimal `list_market_needs` response on
    `/owner/agents/{expected}/operations/execute`."""
    seen_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        if request.url.path == "/v1/me/agent" and request.method == "GET":
            return httpx.Response(200, json=envelope(me_agent_payload))
        if (
            request.url.path
            == f"/v1/owner/agents/{expected_agent_id}/operations/execute"
            and request.method == "POST"
        ):
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "status": "completed",
                        "result": {
                            "items": [],
                            "next_cursor": None,
                            "limit": 20,
                            "offset": 0,
                        },
                    }
                ),
            )
        raise AssertionError(
            f"unexpected request: {request.method} {request.url.path}"
        )

    return handler, seen_paths


def test_resolver_accepts_agent_id_field() -> None:
    """Current shape: /me/agent returns {"agent_id": "..."}."""
    handler, paths = _mock_handler_for_market_needs(
        me_agent_payload={"agent_id": "agt_current"},
        expected_agent_id="agt_current",
    )
    with build_client(handler) as client:
        page = client.list_market_needs()  # no agent_id → resolve via /me/agent

    assert page.items == []
    assert "/v1/me/agent" in paths
    assert "/v1/owner/agents/agt_current/operations/execute" in paths


def test_resolver_accepts_legacy_id_field() -> None:
    """Legacy shape: /me/agent returns {"id": "..."} without agent_id.
    This is the codex-bot P1 case — before the fix, the resolver raised
    "agent_id is required." even though the server returned a valid id.
    """
    handler, paths = _mock_handler_for_market_needs(
        me_agent_payload={"id": "agt_legacy"},
        expected_agent_id="agt_legacy",
    )
    with build_client(handler) as client:
        page = client.list_market_needs()

    assert page.items == []
    assert "/v1/owner/agents/agt_legacy/operations/execute" in paths


def test_resolver_prefers_agent_id_over_legacy_id_when_both_present() -> None:
    """If /me/agent returns both keys, the current-contract one wins."""
    handler, paths = _mock_handler_for_market_needs(
        me_agent_payload={"agent_id": "agt_new", "id": "agt_old"},
        expected_agent_id="agt_new",
    )
    with build_client(handler) as client:
        client.list_market_needs()

    assert "/v1/owner/agents/agt_new/operations/execute" in paths
    assert "/v1/owner/agents/agt_old/operations/execute" not in paths


def test_resolver_honors_explicit_agent_id_arg() -> None:
    """If the caller passes agent_id, /me/agent must NOT be called."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/me/agent":
            raise AssertionError("/me/agent must not be called when agent_id is explicit")
        if request.url.path == "/v1/owner/agents/agt_explicit/operations/execute":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "status": "completed",
                        "result": {"items": [], "next_cursor": None, "limit": 20, "offset": 0},
                    }
                ),
            )
        raise AssertionError(f"unexpected request: {request.url.path}")

    with build_client(handler) as client:
        client.list_market_needs(agent_id="agt_explicit")


def test_resolver_raises_when_me_agent_has_neither_field() -> None:
    import pytest

    from siglume_api_sdk.client import SiglumeClientError

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/me/agent":
            return httpx.Response(200, json=envelope({"something_else": "x"}))
        raise AssertionError(f"unexpected request: {request.url.path}")

    with build_client(handler) as client:
        with pytest.raises(SiglumeClientError, match="agent_id"):
            client.list_market_needs()
