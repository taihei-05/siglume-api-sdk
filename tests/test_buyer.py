from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk import (  # noqa: E402
    SiglumeBuyerClient,
    SiglumeClientError,
    SiglumeExperimentalError,
    SiglumeExperimentalWarning,
)


def load_fixture_listings() -> list[dict[str, object]]:
    fixture_path = ROOT / "tests" / "fixtures" / "buyer_search_cases.json"
    return json.loads(fixture_path.read_text(encoding="utf-8"))["listings"]


def envelope(data, *, trace_id: str = "trc_buyer", request_id: str = "req_buyer") -> dict[str, object]:
    return {
        "data": data,
        "meta": {"request_id": request_id, "trace_id": trace_id},
        "error": None,
    }


def build_client(handler, **kwargs) -> SiglumeBuyerClient:
    return SiglumeBuyerClient(
        api_key="sig_test_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
        **kwargs,
    )


def test_buyer_client_reads_api_key_from_environment(monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_API_KEY", " sig_env_key ")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer sig_env_key"
        return httpx.Response(200, json=envelope({"items": [], "next_cursor": None, "limit": 20, "offset": 0}))

    client = SiglumeBuyerClient(
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )
    with pytest.warns(SiglumeExperimentalWarning, match="substring matching"):
        assert client.search_capabilities(query="anything") == []
    client.close()


def test_buyer_client_explicit_api_key_overrides_environment(monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_API_KEY", "sig_env_key")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer sig_explicit_key"
        return httpx.Response(200, json=envelope({"items": [], "next_cursor": None, "limit": 20, "offset": 0}))

    client = SiglumeBuyerClient(
        api_key=" sig_explicit_key ",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )
    with pytest.warns(SiglumeExperimentalWarning, match="substring matching"):
        assert client.search_capabilities(query="anything") == []
    client.close()


def test_buyer_client_rejects_explicit_empty_api_key_even_with_environment(monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_API_KEY", "sig_env_key")

    with pytest.raises(SiglumeClientError, match="SIGLUME_API_KEY is required"):
        SiglumeBuyerClient(api_key="", base_url="https://api.example.test/v1")


def test_search_capabilities_uses_local_scoring_and_returns_best_match_first() -> None:
    listings = load_fixture_listings()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/v1/market/capabilities":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        return httpx.Response(200, json=envelope({"items": listings, "next_cursor": None, "limit": 20, "offset": 0}))

    client = build_client(handler)
    with pytest.warns(SiglumeExperimentalWarning, match="substring matching"):
        results = client.search_capabilities(query="convert currency", limit=3)

    assert results[0].capability_key == "currency-converter-v2"
    assert results[0].score > 0
    assert "description" in results[0].match_fields
    assert results[0].tool_manual["tool_name"] == "currency_converter_v2"


def test_search_capabilities_filters_permission_class_and_limit() -> None:
    listings = load_fixture_listings()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=envelope({"items": listings, "next_cursor": None, "limit": 20, "offset": 0}))

    client = build_client(handler)
    results = client.search_capabilities(query="email", permission_class="action", limit=1)

    assert len(results) == 1
    assert results[0].capability_key == "invoice-emailer"
    assert results[0].permission_class == "action"


def test_get_listing_resolves_capability_key_and_synthesizes_tool_manual() -> None:
    listings = load_fixture_listings()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=envelope({"items": listings, "next_cursor": None, "limit": 20, "offset": 0}))

    client = build_client(handler)
    listing = client.get_listing("currency-converter-v2")

    assert listing.listing_id == "lst_currency"
    assert listing.description and "live exchange rates" in listing.description
    assert listing.tool_manual["input_schema"]["required"] == ["amount_usd", "to"]
    assert listing.experimental is True


def test_get_listing_falls_back_to_active_capability_key_lookup() -> None:
    active_listing = dict(load_fixture_listings()[0])
    active_listing["status"] = "active"
    requested_statuses: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_statuses.append(str(request.url.params.get("status") or ""))
        if request.url.params.get("status") == "active":
            return httpx.Response(200, json=envelope({"items": [active_listing], "next_cursor": None, "limit": 20, "offset": 0}))
        return httpx.Response(200, json=envelope({"items": [], "next_cursor": None, "limit": 20, "offset": 0}))

    client = build_client(handler)
    listing = client.get_listing("currency-converter-v2")

    assert requested_statuses[:2] == ["published", "active"]
    assert listing.listing_id == "lst_currency"
    assert listing.status == "active"


def test_subscribe_returns_access_grant_without_binding_when_bind_is_disabled() -> None:
    listings = load_fixture_listings()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/capabilities":
            return httpx.Response(200, json=envelope({"items": listings, "next_cursor": None, "limit": 20, "offset": 0}))
        if request.url.path == "/v1/market/capabilities/lst_currency/purchase":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "purchase_status": "created",
                        "access_grant": {
                            "id": "grant_123",
                            "capability_listing_id": "lst_currency",
                            "grant_status": "active",
                        },
                    },
                    trace_id="trc_purchase",
                ),
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = build_client(handler)
    subscription = client.subscribe(capability_key="currency-converter-v2", bind_agent=False)

    assert subscription.access_grant_id == "grant_123"
    assert subscription.binding_id is None
    assert subscription.trace_id == "trc_purchase"


def test_start_trial_returns_access_grant_without_binding_when_bind_is_disabled() -> None:
    listings = load_fixture_listings()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/capabilities":
            return httpx.Response(200, json=envelope({"items": listings, "next_cursor": None, "limit": 20, "offset": 0}))
        if request.url.path == "/v1/market/capabilities/lst_currency/start-trial":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "purchase_status": "trial_started",
                        "access_grant": {
                            "id": "grant_trial",
                            "capability_listing_id": "lst_currency",
                            "grant_status": "active",
                        },
                    },
                    trace_id="trc_trial",
                ),
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = build_client(handler)
    subscription = client.start_trial(capability_key="currency-converter-v2", bind_agent=False)

    assert subscription.access_grant_id == "grant_trial"
    assert subscription.purchase_status == "trial_started"
    assert subscription.binding_id is None
    assert subscription.trace_id == "trc_trial"


def test_get_trial_quota_returns_raw_quota_payload() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/me/trial-quota":
            return httpx.Response(
                200,
                json=envelope({"plan": "plus", "monthly_limit": 3, "used_this_month": 1, "remaining": 2}),
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = build_client(handler)
    quota = client.get_trial_quota()

    assert quota["remaining"] == 2


def test_subscribe_binds_agent_when_default_agent_id_is_present() -> None:
    listings = load_fixture_listings()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/capabilities":
            return httpx.Response(200, json=envelope({"items": listings, "next_cursor": None, "limit": 20, "offset": 0}))
        if request.url.path == "/v1/market/capabilities/lst_currency/purchase":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "purchase_status": "created",
                        "access_grant": {
                            "id": "grant_123",
                            "capability_listing_id": "lst_currency",
                            "grant_status": "active",
                        },
                    }
                ),
            )
        if request.url.path == "/v1/market/access-grants/grant_123/bind-agent":
            body = json.loads(request.content.decode("utf-8"))
            assert body["agent_id"] == "agent_demo"
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "binding": {
                            "id": "bind_123",
                            "access_grant_id": "grant_123",
                            "agent_id": "agent_demo",
                            "binding_status": "active",
                        },
                        "access_grant": {
                            "id": "grant_123",
                            "capability_listing_id": "lst_currency",
                            "grant_status": "active",
                        },
                    },
                    trace_id="trc_bind",
                ),
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = build_client(handler, default_agent_id="agent_demo")
    subscription = client.subscribe(capability_key="currency-converter-v2")

    assert subscription.binding_id == "bind_123"
    assert subscription.agent_id == "agent_demo"
    assert subscription.trace_id == "trc_bind"


def test_invoke_maps_accepted_execution_to_execution_result() -> None:
    listings = load_fixture_listings()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/internal/market/capability/execute":
            body = json.loads(request.content.decode("utf-8"))
            assert body["arguments"]["amount_usd"] == 100
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "accepted": True,
                        "allowed": True,
                        "reason": "accepted",
                        "reason_code": None,
                        "usage_event": {"units_consumed": 1, "execution_kind": "action"},
                        "result": {
                            "summary": "Converted USD 100.00 to JPY 15000.00.",
                            "amount": 15000.0,
                            "currency": "JPY",
                        },
                        "receipt": {"execution_kind": "action", "currency": "JPY", "amount_minor": 0},
                    },
                    trace_id="trc_exec",
                ),
            )
        if request.url.path == "/v1/market/capabilities":
            return httpx.Response(200, json=envelope({"items": listings, "next_cursor": None, "limit": 20, "offset": 0}))
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = build_client(handler, default_agent_id="agent_demo", allow_internal_execute=True)
    result = client.invoke(capability_key="currency-converter-v2", input={"amount_usd": 100, "to": "JPY"})

    assert result.success is True
    assert result.output["currency"] == "JPY"
    assert result.execution_kind.value == "action"


def test_invoke_maps_owner_approval_to_needs_approval_result() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/v1/internal/market/capability/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        return httpx.Response(
            200,
            json=envelope(
                {
                    "accepted": False,
                    "allowed": False,
                    "reason": "owner approval is required before execution",
                    "reason_code": "APPROVAL_REQUIRED",
                    "approval_request": {"id": "apr_123"},
                    "approval_explanation": {
                        "title": "Approve invoice email",
                        "preview": {"summary": "Send invoice INV-1001 to finance@example.com"},
                        "side_effects": ["email delivery to finance@example.com"],
                    },
                    "usage_event": {"units_consumed": 1, "execution_kind": "action"},
                    "receipt": {"execution_kind": "action", "currency": "USD", "amount_minor": 0},
                }
            ),
        )

    client = build_client(handler, default_agent_id="agent_demo", allow_internal_execute=True)
    result = client.invoke(capability_key="invoice-emailer", input={"invoice_id": "INV-1001"})

    assert result.success is False
    assert result.needs_approval is True
    assert result.approval_hint and result.approval_hint.action_summary == "Approve invoice email"


def test_invoke_does_not_invent_approval_currency_when_receipt_omits_it() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/v1/internal/market/capability/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        return httpx.Response(
            200,
            json=envelope(
                {
                    "accepted": False,
                    "allowed": False,
                    "reason": "owner approval is required before execution",
                    "reason_code": "APPROVAL_REQUIRED",
                    "approval_request": {"id": "apr_124"},
                    "approval_explanation": {"title": "Approve invoice email"},
                    "usage_event": {"units_consumed": 1, "execution_kind": "payment"},
                    "receipt": {"execution_kind": "payment", "amount_minor": 9900},
                }
            ),
        )

    client = build_client(handler, default_agent_id="agent_demo", allow_internal_execute=True)
    result = client.invoke(capability_key="invoice-emailer", input={"invoice_id": "INV-1002"})

    assert result.needs_approval is True
    assert result.approval_hint
    assert result.approval_hint.currency is None


def test_invoke_requires_explicit_opt_in_for_internal_execute() -> None:
    client = build_client(lambda request: httpx.Response(200, json=envelope({})), default_agent_id="agent_demo")

    with pytest.raises(SiglumeExperimentalError, match="allow_internal_execute=True"):
        client.invoke(capability_key="currency-converter-v2", input={"amount_usd": 100})


def test_invoke_preserves_legitimate_zero_amount_and_units() -> None:
    # Codex bot P1 on PR #106: `or` chains were clobbering legitimate
    # zeros — units_consumed=0 became 1, receipt.amount_minor=0 fell
    # through to usage_event.amount_minor (or the default). Use explicit
    # None checks instead so free / denied / zero-billed executions
    # surface honest metrics.
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/v1/internal/market/capability/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        return httpx.Response(
            200,
            json=envelope(
                {
                    "accepted": True,
                    "allowed": True,
                    "reason": "accepted",
                    "reason_code": None,
                    # usage_event would previously rewrite these zeros via the `or` chain.
                    "usage_event": {"units_consumed": 0, "amount_minor": 500, "execution_kind": "read_only"},
                    "result": {"summary": "Free tier cached lookup."},
                    "receipt": {"execution_kind": "read_only", "currency": "USD", "amount_minor": 0},
                }
            ),
        )

    client = build_client(handler, default_agent_id="agent_demo", allow_internal_execute=True)
    result = client.invoke(capability_key="cached-lookup", input={"query": "x"})

    assert result.success is True
    # Zero from the receipt must win over usage_event's 500; the old `or`
    # chain would have returned 500 here.
    assert result.amount_minor == 0
    # Zero units_consumed must be preserved; the old code replaced it with 1.
    assert result.units_consumed == 0


def test_invoke_with_direct_payment_uses_sdrp_route_and_separates_control_fields() -> None:
    listing = dict(load_fixture_listings()[0])
    listing.update(
        {
            "id": "lst_direct",
            "capability_key": "paid-lookup",
            "price_model": "per_request",
            "price_value_minor": 10,
            "currency": "JPY",
        }
    )
    seen_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        if request.url.path == "/v1/market/capabilities":
            return httpx.Response(200, json=envelope({"items": [listing], "next_cursor": None, "limit": 20, "offset": 0}))
        if request.url.path == "/v1/market/capabilities/lst_direct/purchase":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "purchase_status": "created",
                        "access_grant": {
                            "id": "grant_direct",
                            "capability_listing_id": "lst_direct",
                            "grant_status": "active",
                        },
                    }
                ),
            )
        if request.url.path == "/v1/market/access-grants/grant_direct/bind-agent":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "access_grant": {
                            "id": "grant_direct",
                            "capability_listing_id": "lst_direct",
                            "grant_status": "active",
                        },
                        "binding": {
                            "id": "binding_direct",
                            "access_grant_id": "grant_direct",
                            "agent_id": "agent_123",
                            "binding_status": "active",
                        },
                    }
                ),
            )
        if request.url.path == "/v1/sdrp/direct-payments/requirements" and request.method == "POST":
            assert body["input"] == {"query": "x"}
            assert "direct_payment_requirement_id" not in body["input"]
            return httpx.Response(
                201,
                json=envelope(
                    {
                        "requirement_id": "dpr_test",
                        "status": "transaction_prepared",
                        "transaction_request": {
                            "to": "0xDirectPaymentHub",
                            "metadata_jsonb": {"direct_payment_requirement_id": "dpr_test"},
                        },
                    }
                ),
            )
        if request.url.path == "/v1/market/web3/transactions/execute-prepared":
            assert body["receipt_kind"] == "sdrp_direct_payment"
            return httpx.Response(200, json=envelope({"receipt": {"receipt_id": "rcpt_test", "tx_status": "finalized"}}))
        if request.url.path == "/v1/sdrp/direct-payments/requirements/dpr_test/verify":
            assert body["receipt_id"] == "rcpt_test"
            return httpx.Response(
                200,
                json=envelope({"requirement_id": "dpr_test", "status": "confirmed", "transaction_request": {}}),
            )
        if request.url.path == "/v1/sdrp/direct-payments/requirements/dpr_test/execute":
            assert body["input"] == {"query": "x"}
            assert "direct_payment_requirement_id" not in body["input"]
            assert body["metadata"]["direct_payment_requirement_id"] == "dpr_test"
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "requirement": {"requirement_id": "dpr_test", "status": "spent", "transaction_request": {}},
                        "execution": {"execution_status": "executed"},
                        "capability_result": {
                            "accepted": True,
                            "result": {"accepted": True},
                            "usage_event": {"units_consumed": 1, "amount_minor": 10, "currency": "JPY"},
                            "receipt": {"amount_minor": 10, "currency": "JPY", "execution_kind": "action"},
                        },
                    }
                ),
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = build_client(handler, default_agent_id="agent_123")
    result = client.invoke_with_direct_payment(
        capability_key="paid-lookup",
        input={"query": "x"},
        currency="JPY",
        token_symbol="JPYC",
    )

    assert result.requirement.status == "spent"
    assert result.capability_result == {
        "accepted": True,
        "result": {"accepted": True},
        "usage_event": {"units_consumed": 1, "amount_minor": 10, "currency": "JPY"},
        "receipt": {"amount_minor": 10, "currency": "JPY", "execution_kind": "action"},
    }
    assert "/v1/sdrp/direct-payments/requirements" in seen_paths
    assert "/v1/sdrp/direct-payments/requirements/dpr_test/execute" in seen_paths
    assert "/v1/internal/market/capability/execute" not in seen_paths
