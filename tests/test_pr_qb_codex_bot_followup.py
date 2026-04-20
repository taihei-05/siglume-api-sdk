"""Regression tests for the two chatgpt-codex-connector[bot] findings on
PR-Qb (siglume-api-sdk#128):

  Q1 — list_account_digests() and list_account_alerts() returned a
       CursorPage with next_cursor but never accepted a `cursor`
       argument or wired `_fetch_next`, so page 2+ was silently
       truncated.
  Q2 — remove_account_favorite() forced default_status="removed" on
       every response, so a failed removal ({"ok": false}) was parsed
       as status="removed".

Both fixes are code-level; these tests pin the contract so a future
refactor cannot silently regress.
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


# ----- Q1: pagination wiring ------------------------------------------------


def test_list_account_digests_forwards_cursor_and_wires_fetch_next() -> None:
    """list_account_digests must accept cursor= and wire _fetch_next so
    CursorPage.pages() / all_items() can walk beyond page 1."""
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(dict(request.url.params))
        cursor = request.url.params.get("cursor")
        if cursor is None:
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [{"digest_id": "dig_p1_a"}, {"digest_id": "dig_p1_b"}],
                        "next_cursor": "cursor-page-2",
                    }
                ),
            )
        if cursor == "cursor-page-2":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [{"digest_id": "dig_p2_a"}],
                        "next_cursor": None,
                    }
                ),
            )
        raise AssertionError(f"unexpected cursor: {cursor!r}")

    with build_client(handler) as client:
        page1 = client.list_account_digests(limit=2)
        assert page1.next_cursor == "cursor-page-2"
        assert len(page1.items) == 2

        all_pages = list(page1.pages())
        # First page is included in pages() iterator.
        assert [p.next_cursor for p in all_pages] == ["cursor-page-2", None]
        assert sum(len(p.items) for p in all_pages) == 3

    # limit forwarded on both requests; cursor only on the second.
    assert calls[0].get("limit") == "2"
    assert "cursor" not in calls[0]
    assert calls[1].get("cursor") == "cursor-page-2"
    assert calls[1].get("limit") == "2"


def test_list_account_alerts_forwards_cursor_and_wires_fetch_next() -> None:
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(dict(request.url.params))
        cursor = request.url.params.get("cursor")
        if cursor is None:
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [{"alert_id": "alt_p1"}],
                        "next_cursor": "cursor-alert-2",
                    }
                ),
            )
        if cursor == "cursor-alert-2":
            return httpx.Response(
                200,
                json=envelope({"items": [{"alert_id": "alt_p2"}], "next_cursor": None}),
            )
        raise AssertionError(f"unexpected cursor: {cursor!r}")

    with build_client(handler) as client:
        page1 = client.list_account_alerts(limit=1)
        items = page1.all_items()

    assert [item.alert_id for item in items] == ["alt_p1", "alt_p2"]
    assert calls[0].get("limit") == "1"
    assert calls[1].get("cursor") == "cursor-alert-2"


def test_list_account_digests_passes_cursor_without_limit() -> None:
    """limit is optional — passing only cursor is valid."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params.get("cursor") == "explicit-cursor"
        assert "limit" not in dict(request.url.params)
        return httpx.Response(200, json=envelope({"items": [], "next_cursor": None}))

    with build_client(handler) as client:
        page = client.list_account_digests(cursor="explicit-cursor")
    assert page.next_cursor is None


def test_list_account_alerts_passes_cursor_without_limit() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params.get("cursor") == "explicit-alert-cursor"
        assert "limit" not in dict(request.url.params)
        return httpx.Response(200, json=envelope({"items": [], "next_cursor": None}))

    with build_client(handler) as client:
        page = client.list_account_alerts(cursor="explicit-alert-cursor")
    assert page.next_cursor is None


# ----- Q2: favorite removal status -----------------------------------------


def test_remove_account_favorite_does_not_force_status_on_failure() -> None:
    """A failed removal ({"ok": false}) without an explicit status must
    NOT be parsed as status="removed" — the caller must be able to tell
    the failure apart from the success path."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=envelope({"ok": False}))

    with build_client(handler) as client:
        result = client.remove_account_favorite("agt_missing")

    assert result.ok is False
    assert result.status is None, (
        "failed removal must not synthesize status='removed'; caller relies on "
        "ok=False + status=None to distinguish failure from explicit revert."
    )
    assert result.agent_id == "agt_missing"


def test_remove_account_favorite_infers_status_on_success() -> None:
    """The default status is still applied when the server confirms ok=True
    but omits the explicit status field — otherwise the happy path would
    regress."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=envelope({"ok": True}))

    with build_client(handler) as client:
        result = client.remove_account_favorite("agt_success")

    assert result.ok is True
    assert result.status == "removed"
    assert result.agent_id == "agt_success"


def test_remove_account_favorite_passes_through_explicit_status() -> None:
    """If the server returns an explicit status, don't override it."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=envelope({"ok": True, "status": "already_removed"}),
        )

    with build_client(handler) as client:
        result = client.remove_account_favorite("agt_explicit")

    assert result.ok is True
    assert result.status == "already_removed"
