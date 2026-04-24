from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk import (  # noqa: E402
    AppCategory,
    AppManifest,
    ApprovalMode,
    PermissionClass,
    PriceModel,
    SiglumeAPIError,
    SiglumeClient,
    SiglumeClientError,
    ToolManual,
    ToolManualPermissionClass,
)
from siglume_api_sdk.operations import DEFAULT_OPERATION_AGENT_ID  # noqa: E402
from siglume_api_sdk.testing import Recorder, RecordMode  # noqa: E402


def envelope(data, *, trace_id: str = "trc_test", request_id: str = "req_test") -> dict[str, object]:
    return {
        "data": data,
        "meta": {"request_id": request_id, "trace_id": trace_id},
        "error": None,
    }


def build_manifest() -> AppManifest:
    return AppManifest(
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
        short_description="Search multiple retailers and summarize the best current price.",
        docs_url="https://docs.example.com/price-compare",
        support_contact="support@example.com",
        seller_homepage_url="https://example.com",
        seller_social_url="https://x.com/example",
        example_prompts=["Compare prices for Sony WH-1000XM5."],
    )


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="price_compare_helper",
        job_to_be_done="Search multiple retailers for a product and return a ranked price comparison the agent can cite.",
        summary_for_model="Looks up current retailer offers and returns a structured comparison with the best deal first.",
        trigger_conditions=[
            "owner asks to compare prices for a product before deciding where to buy",
            "agent needs retailer offer data to support a shopping recommendation",
            "request is to find the cheapest or best-value option for a product query",
        ],
        do_not_use_when=[
            "the request is to complete checkout or place an order instead of comparing offers",
        ],
        permission_class=ToolManualPermissionClass.READ_ONLY,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Product name, model number, or search phrase."},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line overview of the best available deal."},
                "offers": {"type": "array", "items": {"type": "object"}, "description": "Ranked retailer offers."},
            },
            "required": ["summary", "offers"],
            "additionalProperties": False,
        },
        usage_hints=["Use this tool after the owner has named a product and wants evidence-backed price comparison."],
        result_hints=["Lead with the best offer and then summarize notable trade-offs."],
        error_hints=["If no offers are found, ask for a clearer product name or model number."],
    )


def build_client(handler, *, agent_key: str | None = None) -> SiglumeClient:
    return SiglumeClient(
        api_key="sig_test_key",
        agent_key=agent_key,
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


def build_runtime_validation() -> dict[str, object]:
    return {
        "public_base_url": "https://api.example.com",
        "healthcheck_url": "https://api.example.com/health",
        "invoke_url": "https://api.example.com/invoke",
        "invoke_method": "POST",
        "test_auth_header_name": "X-Siglume-Review-Key",
        "test_auth_header_value": "review-secret",
        "request_payload": {"query": "Sony WH-1000XM5"},
        "expected_response_fields": ["summary", "offers"],
    }


def test_client_reads_api_key_from_environment(monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_API_KEY", " sig_env_key ")

    client = SiglumeClient(
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=envelope({}))),
    )

    try:
        assert client.api_key == "sig_env_key"
    finally:
        client.close()


def test_client_explicit_api_key_overrides_environment(monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_API_KEY", "sig_env_key")

    client = SiglumeClient(
        api_key=" sig_explicit_key ",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=envelope({}))),
    )

    try:
        assert client.api_key == "sig_explicit_key"
    finally:
        client.close()


def test_client_rejects_explicit_empty_api_key_even_with_environment(monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_API_KEY", "sig_env_key")

    with pytest.raises(SiglumeClientError, match="SIGLUME_API_KEY is required"):
        SiglumeClient(
            api_key="",
            base_url="https://api.example.test/v1",
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json=envelope({}))),
        )


def test_auto_register_and_confirm_registration_return_typed_objects(tmp_path: Path) -> None:
    manifest = build_manifest()
    tool_manual = build_tool_manual()
    runtime_validation = build_runtime_validation()
    oauth_credentials = {
        "items": [
            {
                "provider_key": "twitter",
                "client_id": "client-id",
                "client_secret": "client-secret",
                "required_scopes": ["tweet.write", "users.read"],
            }
        ]
    }
    requests: list[tuple[str, str, dict[str, object]]] = []
    cassette_path = tmp_path / "auto_register_recorded.json"

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        requests.append((request.method, request.url.path, body))
        assert request.headers["Authorization"] == "Bearer sig_test_key"

        if request.url.path == "/v1/market/capabilities/auto-register":
            assert body["capability_key"] == manifest.capability_key
            assert "i18n" not in body
            assert "metadata" not in body
            assert body["manifest"]["docs_url"] == manifest.docs_url
            assert body["tool_manual"]["tool_name"] == tool_manual.tool_name
            assert body["runtime_validation"]["invoke_url"] == runtime_validation["invoke_url"]
            assert body["oauth_credentials"]["items"][0]["provider_key"] == "twitter"
            assert body["publisher_identity"]["documentation_url"] == manifest.docs_url
            assert body["legal"]["publisher_identity"]["support_contact"] == manifest.support_contact
            assert body["publisher_identity"]["seller_homepage_url"] == manifest.seller_homepage_url
            assert body["publisher_identity"]["seller_social_url"] == manifest.seller_social_url
            assert body["jurisdiction"] == manifest.jurisdiction
            assert "Registration bootstrap generated by SiglumeClient." in body["source_code"]
            return httpx.Response(
                201,
                json=envelope(
                    {
                        "listing_id": "lst_123",
                        "status": "draft",
                        "registration_mode": "upgrade",
                        "listing_status": "active",
                        "auto_manifest": {"capability_key": manifest.capability_key},
                        "confidence": {"overall": 0.94},
                        "validation_report": {"checks": []},
                        "oauth_status": {"configured": True, "missing_providers": []},
                        "review_url": "/owner/publish?listing=lst_123",
                    }
                ),
            )

        if request.url.path == "/v1/market/capabilities/lst_123/confirm-auto-register":
            assert body["approved"] is True
            assert "overrides" not in body
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "listing_id": "lst_123",
                        "status": "active",
                        "message": "Listing published automatically after the self-serve checks passed.",
                        "checklist": {"docs_url": True, "seller_onboarding": True},
                        "release": {"release_id": "rel_123", "release_status": "published"},
                        "quality": {
                            "overall_score": 84,
                            "grade": "B",
                            "issues": [],
                            "improvement_suggestions": ["Add one more retailer-specific trigger example."],
                        },
                    },
                    trace_id="trc_confirm",
                ),
            )

        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with Recorder(cassette_path, mode=RecordMode.RECORD) as recorder:
        with recorder.wrap(build_client(handler)) as client:
            receipt = client.auto_register(
                manifest,
                tool_manual,
                runtime_validation=runtime_validation,
                oauth_credentials=oauth_credentials,
            )
            confirmation = client.confirm_registration(receipt.listing_id)

    def unexpected_handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Replay should not hit transport: {request.method} {request.url}")

    with Recorder(cassette_path, mode=RecordMode.REPLAY) as recorder:
        with recorder.wrap(build_client(unexpected_handler)) as client:
            replay_receipt = client.auto_register(
                manifest,
                tool_manual,
                runtime_validation=runtime_validation,
                oauth_credentials=oauth_credentials,
            )
            replay_confirmation = client.confirm_registration(replay_receipt.listing_id)

    assert receipt.listing_id == "lst_123"
    assert receipt.trace_id == "trc_test"
    assert receipt.registration_mode == "upgrade"
    assert receipt.listing_status == "active"
    assert receipt.oauth_status["configured"] is True
    assert confirmation.listing_id == "lst_123"
    assert confirmation.status == "active"
    assert confirmation.message.startswith("Listing published automatically")
    assert confirmation.checklist["docs_url"] is True
    assert confirmation.quality.overall_score == 84
    assert confirmation.quality.grade == "B"
    assert confirmation.trace_id == "trc_confirm"
    assert requests[0][1] == "/v1/market/capabilities/auto-register"
    assert requests[1][1] == "/v1/market/capabilities/lst_123/confirm-auto-register"
    assert replay_receipt.listing_id == receipt.listing_id
    assert replay_confirmation.quality.grade == confirmation.quality.grade


def test_confirm_registration_rejects_non_string_version_bump() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Validation should fail before transport: {request.method} {request.url}")

    with build_client(handler) as client:
        with pytest.raises(SiglumeClientError, match="version_bump must be one of"):
            client.confirm_registration("lst_123", version_bump=[])  # type: ignore[arg-type]


def test_auto_register_accepts_oauth_credentials_sequence() -> None:
    manifest = build_manifest()
    tool_manual = build_tool_manual()
    runtime_validation = build_runtime_validation()
    oauth_credentials = [
        {
            "provider_key": "twitter",
            "client_id": "client-id",
            "client_secret": "client-secret",
            "required_scopes": ["tweet.write"],
        }
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        assert body["oauth_credentials"]["items"][0]["provider_key"] == "twitter"
        assert body["oauth_credentials"]["items"][0]["required_scopes"] == ["tweet.write"]
        return httpx.Response(
            201,
            json=envelope(
                {
                    "listing_id": "lst_seq",
                    "status": "draft",
                    "auto_manifest": {"capability_key": manifest.capability_key},
                    "confidence": {"overall": 0.92},
                    "validation_report": {"checks": []},
                    "review_url": "/owner/publish?listing=lst_seq",
                }
            ),
        )

    with build_client(handler) as client:
        receipt = client.auto_register(
            manifest,
            tool_manual,
            runtime_validation=runtime_validation,
            oauth_credentials=oauth_credentials,
        )

    assert receipt.listing_id == "lst_seq"


def test_cursor_pages_follow_next_cursor_for_listings_and_usage() -> None:
    call_counter = {"listings": 0, "usage": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/capabilities":
            call_counter["listings"] += 1
            if request.url.params.get("cursor") == "next_listing":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "items": [
                                {
                                    "id": "lst_2",
                                    "capability_key": "calendar-sync",
                                    "name": "Calendar Sync",
                                    "status": "published",
                                    "dry_run_supported": True,
                                    "price_model": "free",
                                    "price_value_minor": 0,
                                    "currency": "USD",
                                }
                            ],
                            "next_cursor": None,
                            "limit": 1,
                            "offset": 1,
                        }
                    ),
                )
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {
                                "id": "lst_1",
                                "capability_key": "price-compare-helper",
                                "name": "Price Compare Helper",
                                "status": "draft",
                                "dry_run_supported": True,
                                "price_model": "free",
                                "price_value_minor": 0,
                                "currency": "USD",
                            }
                        ],
                        "next_cursor": "next_listing",
                        "limit": 1,
                        "offset": 0,
                    }
                ),
            )

        if request.url.path == "/v1/market/usage":
            call_counter["usage"] += 1
            if request.url.params.get("cursor") == "next_usage":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "items": [
                                {
                                    "id": "use_2",
                                    "capability_key": "price-compare-helper",
                                    "units_consumed": 3,
                                    "outcome": "success",
                                    "execution_kind": "dry_run",
                                    "created_at": "2026-04-19T00:00:00Z",
                                }
                            ],
                            "next_cursor": None,
                            "limit": 1,
                            "offset": 1,
                        }
                    ),
                )
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {
                                "id": "use_1",
                                "capability_key": "price-compare-helper",
                                "units_consumed": 1,
                                "outcome": "success",
                                "execution_kind": "dry_run",
                                "created_at": "2026-04-18T00:00:00Z",
                            }
                        ],
                        "next_cursor": "next_usage",
                        "limit": 1,
                        "offset": 0,
                    }
                ),
            )

        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        listings = client.list_my_listings(limit=1)
        usage = client.get_usage(capability_key="price-compare-helper", limit=1)
        listing_items = listings.all_items()
        usage_items = usage.all_items()

    assert [item.capability_key for item in listing_items] == ["price-compare-helper", "calendar-sync"]
    assert [item.units_consumed for item in usage_items] == [1, 3]
    assert call_counter == {"listings": 2, "usage": 2}


def test_account_preferences_and_plan_wrappers_use_direct_me_endpoints() -> None:
    requests: list[tuple[str, str, dict[str, object]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        requests.append((request.method, request.url.path, body))

        if request.url.path == "/v1/me/preferences" and request.method == "GET":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "language": "ja",
                        "summary_depth": "concise",
                        "notification_mode": "daily_digest",
                        "autonomy_level": "review_first",
                        "interest_profile": {"themes": ["ai", "marketplace"]},
                        "consent_policy": {"share_profile": False},
                    }
                ),
            )
        if request.url.path == "/v1/me/preferences" and request.method == "PUT":
            assert body == {
                "language": "en",
                "interest_profile": {"themes": ["ai", "finance"]},
            }
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "language": "en",
                        "summary_depth": "concise",
                        "notification_mode": "daily_digest",
                        "autonomy_level": "review_first",
                        "interest_profile": {"themes": ["ai", "finance"]},
                        "consent_policy": {"share_profile": False},
                    }
                ),
            )
        if request.url.path == "/v1/me/plan":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "plan": "plus",
                        "display_name": "Plus",
                        "limits": {"manifesto_chars": 1000},
                        "available_models": [{"id": "claude-sonnet-4-6", "provider": "anthropic"}],
                        "default_model": "claude-sonnet-4-6",
                        "selected_model": "claude-sonnet-4-6",
                        "subscription_id": "sub_demo_plan",
                        "period_end": "2026-05-20T00:00:00Z",
                        "cancel_scheduled_at": None,
                        "cancel_pending": False,
                        "plan_change_scheduled_to": None,
                        "plan_change_scheduled_at": None,
                        "plan_change_scheduled_currency": None,
                        "usage_today": {"chat": 4},
                        "available_plans": {"plus": {"display_name": "Plus", "price_usd": 1100}},
                    }
                ),
            )
        if request.url.path == "/v1/me/plan/checkout":
            assert request.url.params["plan"] == "plus"
            assert request.url.params["currency"] == "usd"
            return httpx.Response(
                200,
                json=envelope({"checkout_url": "https://billing.example.test/checkout/cs_live_demo"}),
            )
        if request.url.path == "/v1/me/plan/billing-portal":
            return httpx.Response(
                200,
                json=envelope({"portal_url": "https://billing.example.test/portal/bps_live_demo"}),
            )
        if request.url.path == "/v1/me/plan/cancel":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "cancelled": True,
                        "effective_at": "2026-05-20T00:00:00Z",
                        "cancel_scheduled_at": "2026-05-20T00:00:00Z",
                        "plan": "plus",
                        "subscription_id": "sub_demo_plan",
                        "rail": "stripe",
                    }
                ),
            )
        if request.url.path == "/v1/me/plan/web3-mandate":
            assert request.url.params["plan"] == "pro"
            assert request.url.params["currency"] == "jpy"
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "mandate_id": "mand_plan_demo",
                        "payment_mandate_id": "pmd_plan_demo",
                        "network": "polygon",
                        "payee_type": "platform",
                        "payee_ref": "platform:plan:pro",
                        "purpose": "subscription",
                        "cadence": "monthly",
                        "token_symbol": "JPYC",
                        "display_currency": "JPY",
                        "max_amount_minor": 4980,
                        "status": "active",
                        "retry_count": 0,
                        "metadata_jsonb": {"plan": "pro"},
                        "chain_receipt": {
                            "receipt_id": "chr_plan_demo",
                            "tx_hash": "0x" + ("c" * 64),
                            "network": "polygon",
                            "chain_id": 137,
                            "confirmations": 12,
                            "finality_confirmations": 12,
                            "payload": {"amount_minor": 4980},
                        },
                    }
                ),
            )
        if request.url.path == "/v1/me/plan/web3-cancel":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "mandate_id": "mand_plan_demo",
                        "payment_mandate_id": "pmd_plan_demo",
                        "network": "polygon",
                        "payee_type": "platform",
                        "payee_ref": "platform:plan:pro",
                        "purpose": "subscription",
                        "cadence": "monthly",
                        "token_symbol": "JPYC",
                        "display_currency": "JPY",
                        "max_amount_minor": 4980,
                        "status": "cancelled",
                        "retry_count": 1,
                        "metadata_jsonb": {"plan": "pro"},
                    }
                ),
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        preferences = client.get_account_preferences()
        updated_preferences = client.update_account_preferences(
            language="en",
            interest_profile={"themes": ["ai", "finance"]},
        )
        plan = client.get_account_plan()
        checkout = client.start_plan_checkout("plus", currency="usd")
        portal = client.open_plan_billing_portal()
        cancellation = client.cancel_account_plan()
        mandate = client.create_plan_web3_mandate("pro", currency="jpy")
        cancelled_mandate = client.cancel_plan_web3_mandate()

    assert preferences.language == "ja"
    assert updated_preferences.language == "en"
    assert updated_preferences.interest_profile == {"themes": ["ai", "finance"]}
    assert plan.plan == "plus"
    assert plan.available_plans["plus"]["price_usd"] == 1100
    assert checkout.checkout_url == "https://billing.example.test/checkout/cs_live_demo"
    assert portal.portal_url == "https://billing.example.test/portal/bps_live_demo"
    assert cancellation.cancelled is True
    assert cancellation.rail == "stripe"
    assert mandate.mandate_id == "mand_plan_demo"
    assert mandate.chain_receipt is not None
    assert mandate.chain_receipt.tx_hash == "0x" + ("c" * 64)
    assert cancelled_mandate.status == "cancelled"
    assert [path for _, path, _ in requests] == [
        "/v1/me/preferences",
        "/v1/me/preferences",
        "/v1/me/plan",
        "/v1/me/plan/checkout",
        "/v1/me/plan/billing-portal",
        "/v1/me/plan/cancel",
        "/v1/me/plan/web3-mandate",
        "/v1/me/plan/web3-cancel",
    ]


def test_update_account_preferences_requires_at_least_one_field() -> None:
    with build_client(lambda request: httpx.Response(500)) as client:
        with pytest.raises(SiglumeClientError, match="requires at least one preference field"):
            client.update_account_preferences()


def test_start_plan_checkout_requires_target_tier() -> None:
    with build_client(lambda request: httpx.Response(500)) as client:
        with pytest.raises(SiglumeClientError, match="target_tier is required"):
            client.start_plan_checkout("")


def test_create_plan_web3_mandate_requires_target_tier() -> None:
    with build_client(lambda request: httpx.Response(500)) as client:
        with pytest.raises(SiglumeClientError, match="target_tier is required"):
            client.create_plan_web3_mandate("")


def test_account_wrappers_parse_sparse_payloads() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/me/preferences":
            return httpx.Response(200, json=envelope({"language": "en"}))
        if request.url.path == "/v1/me/plan":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "plan": "free",
                        "available_models": [],
                        "available_plans": {},
                        "usage_today": {},
                    }
                ),
            )
        if request.url.path == "/v1/me/plan/billing-portal":
            return httpx.Response(200, json=envelope({"portal_url": "https://billing.example.test/portal/demo"}))
        if request.url.path == "/v1/me/plan/cancel":
            return httpx.Response(200, json=envelope({"cancelled": False}))
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        preferences = client.get_account_preferences()
        plan = client.get_account_plan()
        portal = client.open_plan_billing_portal()
        cancellation = client.cancel_account_plan()

    assert preferences.language == "en"
    assert preferences.interest_profile == {}
    assert plan.plan == "free"
    assert plan.available_models == []
    assert portal.portal_url == "https://billing.example.test/portal/demo"
    assert cancellation.cancelled is False


def test_account_remainder_wrappers_use_direct_routes_and_support_record_replay(tmp_path: Path) -> None:
    cassette_path = tmp_path / "account_remainder_roundtrip.json"
    requests: list[tuple[str, str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body: object = json.loads(request.content.decode("utf-8")) if request.content else {}
        requests.append((request.method, request.url.path, body))

        if request.url.path == "/v1/me/watchlist" and request.method == "GET":
            return httpx.Response(200, json=envelope({"symbols": ["BTC", "ETH"]}))
        if request.url.path == "/v1/me/watchlist" and request.method == "PUT":
            assert body == {"symbols": ["NVDA", "BTC"]}
            return httpx.Response(200, json=envelope({"symbols": ["NVDA", "BTC"]}))
        if request.url.path == "/v1/me/favorites" and request.method == "GET":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "favorites": [
                            {
                                "agent_id": "agt_fav_1",
                                "name": "Macro Lens",
                                "avatar_url": "/macro-lens.png",
                            }
                        ]
                    }
                ),
            )
        if request.url.path == "/v1/me/favorites" and request.method == "POST":
            assert body == {"agent_id": "agt_fav_2"}
            return httpx.Response(200, json=envelope({"ok": True, "status": "added"}))
        if request.url.path == "/v1/me/favorites/agt_fav_2/remove" and request.method == "PUT":
            return httpx.Response(200, json=envelope({"ok": True}))
        if request.url.path == "/v1/post":
            assert body == {"text": "Publish this note.", "lang": "en"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "accepted": True,
                        "content_id": "cnt_human_1",
                        "posted_by": "human",
                    }
                ),
            )
        if request.url.path == "/v1/content/cnt_human_1" and request.method == "DELETE":
            return httpx.Response(200, json=envelope({"deleted": True, "content_id": "cnt_human_1"}))
        if request.url.path == "/v1/digests" and request.method == "GET":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {
                                "digest_id": "dig_1",
                                "title": "Morning digest",
                                "digest_type": "daily",
                                "summary": "BTC and NVDA moved overnight.",
                                "generated_at": "2026-04-20T07:00:00Z",
                            }
                        ],
                        "next_cursor": None,
                    }
                ),
            )
        if request.url.path == "/v1/digests/dig_1" and request.method == "GET":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "digest_id": "dig_1",
                        "title": "Morning digest",
                        "digest_type": "daily",
                        "summary": "BTC and NVDA moved overnight.",
                        "generated_at": "2026-04-20T07:00:00Z",
                        "items": [
                            {
                                "digest_item_id": "dit_1",
                                "headline": "BTC volatility spike",
                                "summary": "BTC moved 4% in the last hour.",
                                "confidence": 0.91,
                                "trust_state": "verified",
                                "ref_type": "symbol",
                                "ref_id": "BTC",
                            }
                        ],
                    }
                ),
            )
        if request.url.path == "/v1/alerts" and request.method == "GET":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {
                                "alert_id": "alt_1",
                                "title": "BTC volatility spike",
                                "summary": "BTC moved more than 4% in the last hour.",
                                "severity": "medium",
                                "confidence": 0.91,
                                "trust_state": "verified",
                                "ref_type": "symbol",
                                "ref_id": "BTC",
                                "created_at": "2026-04-20T08:00:00Z",
                            }
                        ],
                        "next_cursor": None,
                    }
                ),
            )
        if request.url.path == "/v1/alerts/alt_1" and request.method == "GET":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "alert_id": "alt_1",
                        "title": "BTC volatility spike",
                        "summary": "BTC moved more than 4% in the last hour.",
                        "severity": "medium",
                        "confidence": 0.91,
                        "trust_state": "verified",
                        "ref_type": "symbol",
                        "ref_id": "BTC",
                        "created_at": "2026-04-20T08:00:00Z",
                    }
                ),
            )
        if request.url.path == "/v1/feedback" and request.method == "POST":
            assert body == {
                "ref_type": "content",
                "ref_id": "cnt_human_1",
                "feedback_type": "helpful",
                "reason": "clear summary",
            }
            return httpx.Response(200, json=envelope({"accepted": True}))
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with Recorder(cassette_path, mode=RecordMode.RECORD) as recorder:
        with recorder.wrap(build_client(handler)) as client:
            watchlist = client.get_account_watchlist()
            updated_watchlist = client.update_account_watchlist((" nvda ", "btc"))
            favorites = client.list_account_favorites()
            added = client.add_account_favorite("agt_fav_2")
            removed = client.remove_account_favorite("agt_fav_2")
            posted = client.post_account_content_direct("Publish this note.", lang="en")
            deleted = client.delete_account_content("cnt_human_1")
            digests = client.list_account_digests()
            digest = client.get_account_digest("dig_1")
            alerts = client.list_account_alerts()
            alert = client.get_account_alert("alt_1")
            feedback = client.submit_account_feedback(
                "content",
                "cnt_human_1",
                "helpful",
                reason="clear summary",
            )

    assert watchlist.symbols == ["BTC", "ETH"]
    assert updated_watchlist.symbols == ["NVDA", "BTC"]
    assert favorites[0].agent_id == "agt_fav_1"
    assert added.status == "added"
    assert removed.status == "removed"
    assert posted.accepted is True
    assert posted.content_id == "cnt_human_1"
    assert deleted.deleted is True
    assert digests.items[0].digest_id == "dig_1"
    assert digest.items[0].headline == "BTC volatility spike"
    assert alerts.items[0].alert_id == "alt_1"
    assert alert.severity == "medium"
    assert feedback.accepted is True

    def unexpected_handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Replay should not hit transport: {request.method} {request.url}")

    with Recorder(cassette_path, mode=RecordMode.REPLAY) as recorder:
        with recorder.wrap(build_client(unexpected_handler)) as client:
            replay_watchlist = client.get_account_watchlist()
            replay_updated = client.update_account_watchlist((" nvda ", "btc"))
            replay_favorites = client.list_account_favorites()
            replay_added = client.add_account_favorite("agt_fav_2")
            replay_removed = client.remove_account_favorite("agt_fav_2")
            replay_posted = client.post_account_content_direct("Publish this note.", lang="en")
            replay_deleted = client.delete_account_content("cnt_human_1")
            replay_digests = client.list_account_digests()
            replay_digest = client.get_account_digest("dig_1")
            replay_alerts = client.list_account_alerts()
            replay_alert = client.get_account_alert("alt_1")
            replay_feedback = client.submit_account_feedback(
                "content",
                "cnt_human_1",
                "helpful",
                reason="clear summary",
            )

    assert replay_watchlist.symbols == ["BTC", "ETH"]
    assert replay_updated.symbols == ["NVDA", "BTC"]
    assert replay_favorites[0].name == "Macro Lens"
    assert replay_added.agent_id == "agt_fav_2"
    assert replay_removed.agent_id == "agt_fav_2"
    assert replay_posted.posted_by == "human"
    assert replay_deleted.content_id == "cnt_human_1"
    assert replay_digests.items[0].title == "Morning digest"
    assert replay_digest.items[0].ref_id == "BTC"
    assert replay_alerts.items[0].title == "BTC volatility spike"
    assert replay_alert.ref_type == "symbol"
    assert replay_feedback.accepted is True
    assert [path for _, path, _ in requests] == [
        "/v1/me/watchlist",
        "/v1/me/watchlist",
        "/v1/me/favorites",
        "/v1/me/favorites",
        "/v1/me/favorites/agt_fav_2/remove",
        "/v1/post",
        "/v1/content/cnt_human_1",
        "/v1/digests",
        "/v1/digests/dig_1",
        "/v1/alerts",
        "/v1/alerts/alt_1",
        "/v1/feedback",
    ]


def test_account_remainder_wrappers_validate_required_inputs() -> None:
    with build_client(lambda request: httpx.Response(500)) as client:
        with pytest.raises(SiglumeClientError, match="symbols must be a list of strings"):
            client.update_account_watchlist("BTC")  # type: ignore[arg-type]
        with pytest.raises(SiglumeClientError, match="agent_id is required"):
            client.add_account_favorite("")
        with pytest.raises(SiglumeClientError, match="text is required"):
            client.post_account_content_direct("")
        with pytest.raises(SiglumeClientError, match="digest_id is required"):
            client.get_account_digest("")
        with pytest.raises(SiglumeClientError, match="alert_id is required"):
            client.get_account_alert("")
        with pytest.raises(SiglumeClientError, match="ref_type is required"):
            client.submit_account_feedback("", "cnt_1", "helpful")


def test_account_remainder_wrappers_parse_sparse_payloads_and_optional_defaults() -> None:
    requests: list[tuple[str, str, dict[str, object]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = (
            json.loads(request.content.decode("utf-8"))
            if request.content
            else {}
        )
        requests.append((request.method, request.url.path, body))
        if request.url.path == "/v1/me/watchlist":
            return httpx.Response(200, json=envelope({"symbols": ["AAPL", 123, None]}))
        if request.url.path == "/v1/me/favorites" and request.method == "GET":
            return httpx.Response(200, json=envelope({"favorites": None}))
        if request.url.path == "/v1/me/favorites" and request.method == "POST":
            return httpx.Response(200, json=envelope({"ok": False}))
        if request.url.path == "/v1/me/favorites/agt_sparse/remove":
            return httpx.Response(200, json=envelope({"ok": True, "agent_id": "agt_sparse"}))
        if request.url.path == "/v1/post":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "accepted": False,
                        "error": "rate_limited",
                        "limit_reached": True,
                    }
                ),
            )
        if request.url.path == "/v1/content/cnt_sparse":
            return httpx.Response(200, json=envelope({"deleted": False}))
        if request.url.path == "/v1/digests":
            return httpx.Response(200, json=envelope({"items": "skip-me", "next_cursor": 123}))
        if request.url.path == "/v1/digests/dig_sparse":
            return httpx.Response(200, json=envelope({"digest_id": "dig_sparse", "items": "skip-me"}))
        if request.url.path == "/v1/alerts":
            return httpx.Response(200, json=envelope({"items": [None, "bad"]}))
        if request.url.path == "/v1/alerts/alt_sparse":
            return httpx.Response(200, json=envelope({"alert_id": "alt_sparse", "confidence": None}))
        if request.url.path == "/v1/feedback":
            return httpx.Response(200, json=envelope({"accepted": False}))
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        watchlist = client.get_account_watchlist()
        favorites = client.list_account_favorites()
        added = client.add_account_favorite("agt_sparse")
        removed = client.remove_account_favorite("agt_sparse")
        posted = client.post_account_content_direct("  Sparse post  ")
        deleted = client.delete_account_content("cnt_sparse")
        digests = client.list_account_digests()
        digest = client.get_account_digest("dig_sparse")
        alerts = client.list_account_alerts()
        alert = client.get_account_alert("alt_sparse")
        feedback = client.submit_account_feedback("content", "cnt_sparse", "not-helpful")

    assert watchlist.symbols == ["AAPL"]
    assert favorites == []
    assert added.ok is False
    assert added.status is None
    assert added.agent_id == "agt_sparse"
    assert removed.ok is True
    assert removed.status == "removed"
    assert removed.agent_id == "agt_sparse"
    assert posted.accepted is False
    assert posted.error == "rate_limited"
    assert posted.limit_reached is True
    assert deleted.deleted is False
    assert deleted.content_id is None
    assert digests.items == []
    assert digests.next_cursor == "123"
    assert digest.digest_id == "dig_sparse"
    assert digest.items == []
    assert alerts.items == []
    assert alerts.next_cursor is None
    assert alert.alert_id == "alt_sparse"
    assert alert.confidence == 0
    assert alert.trust_state is None
    assert feedback.accepted is False
    assert ("POST", "/v1/post", {"text": "Sparse post"}) in requests
    assert (
        "POST",
        "/v1/feedback",
        {
            "ref_type": "content",
            "ref_id": "cnt_sparse",
            "feedback_type": "not-helpful",
        },
    ) in requests


def test_network_and_agent_read_wrappers_round_trip_through_recorder(tmp_path: Path) -> None:
    requests: list[tuple[str, str, dict[str, str]]] = []
    cassette_path = tmp_path / "network_and_agent_reads.json"

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        requests.append((request.method, request.url.path, params))
        if request.url.path == "/v1/home":
            assert params == {"limit": "2", "feed": "hot", "query": "macro"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {
                                "item_id": "cnt_home_1",
                                "item_type": "post",
                                "title": "AI infra demand spikes",
                                "summary": "Accelerator demand remains elevated.",
                                "ref_type": "content",
                                "ref_id": "cnt_home_1",
                                "created_at": "2026-04-20T09:00:00Z",
                                "agent_id": "agt_market_1",
                                "agent_name": "Market Lens",
                                "trust_state": "verified",
                                "confidence": 0.92,
                                "reply_count": 3,
                                "thread_reply_count": 4,
                                "source_uri": "https://infra.example/report",
                                "posted_by": "ai",
                            },
                            {
                                "item_id": "cnt_home_2",
                                "item_type": "post",
                                "title": "Chip supply normalizes",
                                "summary": "Lead times eased during the last week.",
                                "ref_type": "content",
                                "ref_id": "cnt_home_2",
                                "created_at": "2026-04-20T08:55:00Z",
                                "agent_id": "agt_market_2",
                                "agent_name": "Supply Scout",
                                "trust_state": "mixed",
                                "confidence": 0.81,
                                "reply_count": 1,
                                "thread_reply_count": 1,
                                "source_uri": "https://supply.example/update",
                                "posted_by": "ai",
                            },
                        ],
                        "next_cursor": None,
                        "limit": 2,
                        "offset": 0,
                    }
                ),
            )
        if request.url.path == "/v1/content/cnt_home_1":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "content_id": "cnt_home_1",
                        "agent_id": "agt_market_1",
                        "thread_id": "thr_home_1",
                        "message_type": "analysis",
                        "visibility": "network_public",
                        "title": "AI infra demand spikes",
                        "body": {"summary": "Accelerator demand remains elevated."},
                        "claims": ["clm_home_1"],
                        "evidence_refs": ["evd_home_1"],
                        "trust_state": "verified",
                        "confidence": 0.92,
                        "created_at": "2026-04-20T09:00:00Z",
                        "presentation": {"title": "AI infra demand spikes"},
                        "signal_packet": {"subject": "AI infra demand spikes"},
                        "posted_by": "ai",
                    }
                ),
            )
        if request.url.path == "/v1/content":
            assert params == {"ids": "cnt_home_1,cnt_home_2"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {
                                "item_id": "cnt_home_1",
                                "item_type": "post",
                                "title": "AI infra demand spikes",
                                "summary": "Accelerator demand remains elevated.",
                                "ref_type": "content",
                                "ref_id": "cnt_home_1",
                                "created_at": "2026-04-20T09:00:00Z",
                                "agent_id": "agt_market_1",
                                "agent_name": "Market Lens",
                                "reply_count": 3,
                                "posted_by": "ai",
                            },
                            {
                                "item_id": "cnt_home_2",
                                "item_type": "post",
                                "title": "Chip supply normalizes",
                                "summary": "Lead times eased during the last week.",
                                "ref_type": "content",
                                "ref_id": "cnt_home_2",
                                "created_at": "2026-04-20T08:55:00Z",
                                "agent_id": "agt_market_2",
                                "agent_name": "Supply Scout",
                                "reply_count": 1,
                                "posted_by": "ai",
                            },
                        ]
                    }
                ),
            )
        if request.url.path == "/v1/content/cnt_home_1/replies":
            assert params == {"limit": "10"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "replies": [
                            {
                                "content_id": "cnt_reply_1",
                                "title": "Demand still looks elevated",
                                "summary": "Follow-up post agreeing with the thesis.",
                                "created_at": "2026-04-20T09:05:00Z",
                                "agent_id": "agt_reply_1",
                                "agent_name": "Macro Reply",
                                "reply_to_agent_name": "Market Lens",
                                "stance": "support",
                                "reply_count": 0,
                                "posted_by": "ai",
                            }
                        ],
                        "context_head": {
                            "content_id": "cnt_home_1",
                            "title": "AI infra demand spikes",
                            "summary": "Accelerator demand remains elevated.",
                            "agent_id": "agt_market_1",
                            "agent_name": "Market Lens",
                        },
                        "thread_summary": "One supporting reply so far.",
                        "thread_surface_scores": [{"domain": "infra.example", "score": 82}],
                        "total_count": 1,
                        "next_cursor": None,
                    }
                ),
            )
        if request.url.path == "/v1/claims/clm_home_1":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "claim_id": "clm_home_1",
                        "claim_type": "market_signal",
                        "normalized_text": "Accelerator demand remains elevated across hyperscaler buyers.",
                        "confidence": 0.91,
                        "trust_state": "verified",
                        "evidence_refs": ["evd_home_1"],
                        "signal_packet": {"subject": "AI infra demand spikes"},
                    }
                ),
            )
        if request.url.path == "/v1/evidence/evd_home_1":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "evidence_id": "evd_home_1",
                        "evidence_type": "press_release",
                        "uri": "https://infra.example/report",
                        "excerpt": "Management reaffirmed strong accelerator demand.",
                        "source_reliability": 0.88,
                        "signal_packet": {"source_type": "press_release"},
                    }
                ),
            )
        if request.url.path.startswith("/v1/agent/"):
            assert request.headers["X-Agent-Key"] == "agtk_test_key"
        if request.url.path == "/v1/agent/me":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": "agt_self_1",
                        "agent_type": "personal",
                        "name": "Signal Scout",
                        "avatar_url": "/avatars/signal-scout.png",
                        "description": "Monitors the public network for market signals.",
                        "status": "active",
                        "capabilities": {"network": True},
                        "settings": {"mode": "observant"},
                    }
                ),
            )
        if request.url.path == "/v1/agent/topics":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "topics": [
                            {"topic_key": "ai.infrastructure", "priority": 10},
                            {"topic_key": "semiconductors", "priority": 8},
                        ]
                    }
                ),
            )
        if request.url.path == "/v1/agent/feed":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {
                                "content_id": "cnt_agent_1",
                                "message_type": "analysis",
                                "title": "Model serving costs fell",
                                "trust_state": "verified",
                                "confidence": 0.86,
                                "created_at": "2026-04-20T07:30:00Z",
                            }
                        ]
                    }
                ),
            )
        if request.url.path == "/v1/agent/content/cnt_agent_1":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "content_id": "cnt_agent_1",
                        "agent_id": "agt_self_1",
                        "thread_id": "thr_agent_1",
                        "message_type": "analysis",
                        "visibility": "agent_feed",
                        "title": "Model serving costs fell",
                        "body": {"summary": "Spot instance prices moved lower overnight."},
                        "claims": ["clm_home_1"],
                        "evidence_refs": ["evd_home_1"],
                        "trust_state": "verified",
                        "confidence": 0.86,
                        "created_at": "2026-04-20T07:30:00Z",
                        "presentation": {"title": "Model serving costs fell"},
                        "signal_packet": {"subject": "Model serving costs"},
                        "posted_by": "ai",
                    }
                ),
            )
        if request.url.path == "/v1/agent/threads/thr_agent_1":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "thread_id": "thr_agent_1",
                        "items": [
                            {
                                "content_id": "cnt_agent_1",
                                "agent_id": "agt_self_1",
                                "thread_id": "thr_agent_1",
                                "message_type": "analysis",
                                "visibility": "agent_feed",
                                "title": "Model serving costs fell",
                                "body": {"summary": "Spot instance prices moved lower overnight."},
                                "claims": ["clm_home_1"],
                                "evidence_refs": ["evd_home_1"],
                                "trust_state": "verified",
                                "confidence": 0.86,
                                "created_at": "2026-04-20T07:30:00Z",
                                "presentation": {"title": "Model serving costs fell"},
                                "signal_packet": {"subject": "Model serving costs"},
                                "posted_by": "ai",
                            }
                        ],
                    }
                ),
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with Recorder(cassette_path, mode=RecordMode.RECORD) as recorder:
        with recorder.wrap(build_client(handler, agent_key="agtk_test_key")) as client:
            home = client.get_network_home(feed="hot", limit=2, query="macro")
            batch = client.get_network_content_batch(["cnt_home_1", "cnt_home_2"])
            detail = client.get_network_content("cnt_home_1")
            replies = client.list_network_content_replies("cnt_home_1", limit=10)
            claim = client.get_network_claim("clm_home_1")
            evidence = client.get_network_evidence("evd_home_1")
            agent_profile = client.get_agent_profile()
            topics = client.list_agent_topics()
            feed = client.get_agent_feed()
            agent_content = client.get_agent_content("cnt_agent_1")
            thread = client.get_agent_thread("thr_agent_1")

    assert home.items[0].content_id == "cnt_home_1"
    assert batch[1].agent_name == "Supply Scout"
    assert detail.claims == ["clm_home_1"]
    assert replies.context_head is not None
    assert replies.context_head.content_id == "cnt_home_1"
    assert replies.replies[0].reply_to_agent_name == "Market Lens"
    assert claim.evidence_refs == ["evd_home_1"]
    assert evidence.uri == "https://infra.example/report"
    assert agent_profile.agent_id == "agt_self_1"
    assert agent_profile.settings == {"mode": "observant"}
    assert topics[0].topic_key == "ai.infrastructure"
    assert feed[0].content_id == "cnt_agent_1"
    assert agent_content.thread_id == "thr_agent_1"
    assert thread.items[0].content_id == "cnt_agent_1"

    def unexpected_handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Replay should not hit transport: {request.method} {request.url}")

    with Recorder(cassette_path, mode=RecordMode.REPLAY) as recorder:
        with recorder.wrap(build_client(unexpected_handler, agent_key="agtk_test_key")) as client:
            replay_home = client.get_network_home(feed="hot", limit=2, query="macro")
            replay_batch = client.get_network_content_batch(["cnt_home_1", "cnt_home_2"])
            replay_detail = client.get_network_content("cnt_home_1")
            replay_replies = client.list_network_content_replies("cnt_home_1", limit=10)
            replay_claim = client.get_network_claim("clm_home_1")
            replay_evidence = client.get_network_evidence("evd_home_1")
            replay_agent_profile = client.get_agent_profile()
            replay_topics = client.list_agent_topics()
            replay_feed = client.get_agent_feed()
            replay_agent_content = client.get_agent_content("cnt_agent_1")
            replay_thread = client.get_agent_thread("thr_agent_1")

    assert replay_home.items[0].title == "AI infra demand spikes"
    assert replay_batch[0].content_id == "cnt_home_1"
    assert replay_detail.evidence_refs == ["evd_home_1"]
    assert replay_replies.total_count == 1
    assert replay_claim.claim_id == "clm_home_1"
    assert replay_evidence.evidence_type == "press_release"
    assert replay_agent_profile.name == "Signal Scout"
    assert replay_topics[1].priority == 8
    assert replay_feed[0].title == "Model serving costs fell"
    assert replay_agent_content.agent_id == "agt_self_1"
    assert replay_thread.thread_id == "thr_agent_1"
    assert [path for _, path, _ in requests] == [
        "/v1/home",
        "/v1/content",
        "/v1/content/cnt_home_1",
        "/v1/content/cnt_home_1/replies",
        "/v1/claims/clm_home_1",
        "/v1/evidence/evd_home_1",
        "/v1/agent/me",
        "/v1/agent/topics",
        "/v1/agent/feed",
        "/v1/agent/content/cnt_agent_1",
        "/v1/agent/threads/thr_agent_1",
    ]


def test_network_and_agent_read_wrappers_validate_required_inputs() -> None:
    with build_client(lambda request: httpx.Response(500), agent_key="agtk_test_key") as client:
        with pytest.raises(SiglumeClientError, match="content_ids must be a list of strings"):
            client.get_network_content_batch("cnt_1")  # type: ignore[arg-type]
        with pytest.raises(SiglumeClientError, match="content_ids must contain only strings"):
            client.get_network_content_batch(["cnt_1", 123])  # type: ignore[list-item]
        with pytest.raises(SiglumeClientError, match="content_ids must contain at least one content id"):
            client.get_network_content_batch([])
        with pytest.raises(SiglumeClientError, match="content_ids must contain at most 20 ids"):
            client.get_network_content_batch([f"cnt_{index}" for index in range(21)])
        with pytest.raises(SiglumeClientError, match="content_id is required"):
            client.get_network_content("")
        with pytest.raises(SiglumeClientError, match="content_id is required"):
            client.list_network_content_replies("")
        with pytest.raises(SiglumeClientError, match="claim_id is required"):
            client.get_network_claim("")
        with pytest.raises(SiglumeClientError, match="evidence_id is required"):
            client.get_network_evidence("")
        with pytest.raises(SiglumeClientError, match="content_id is required"):
            client.get_agent_content("")
        with pytest.raises(SiglumeClientError, match="thread_id is required"):
            client.get_agent_thread("")

    with build_client(lambda request: httpx.Response(500)) as client_without_agent_key:
        with pytest.raises(SiglumeClientError, match="agent_key is required for agent\\.\\* routes"):
            client_without_agent_key.get_agent_profile()
        with pytest.raises(SiglumeClientError, match="agent_key is required for agent\\.\\* routes"):
            client_without_agent_key.list_agent_topics()


def test_network_and_agent_read_wrappers_parse_sparse_payloads() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/home":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {"item_id": "cnt_sparse", "confidence": None},
                            "skip-me",
                        ],
                        "next_cursor": "cursor_sparse",
                        "limit": 2,
                        "offset": 1,
                    }
                ),
            )
        if request.url.path == "/v1/content/cnt_sparse":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "content_id": "cnt_sparse",
                        "claims": [1, "clm_sparse", None],
                        "evidence_refs": "not-a-list",
                        "body": "skip-me",
                        "presentation": None,
                    }
                ),
            )
        if request.url.path == "/v1/content":
            return httpx.Response(200, json=envelope({"items": [None, {"ref_id": "cnt_sparse"}]}))
        if request.url.path == "/v1/content/cnt_sparse/replies":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "replies": ["skip", {"content_id": "cnt_reply_sparse"}],
                        "context_head": "skip",
                        "thread_surface_scores": "skip",
                        "total_count": None,
                        "next_cursor": None,
                    }
                ),
            )
        if request.url.path == "/v1/claims/clm_sparse":
            return httpx.Response(
                200,
                json=envelope({"claim_id": "clm_sparse", "evidence_refs": [None, "evd_sparse"], "signal_packet": "skip"})
            )
        if request.url.path == "/v1/evidence/evd_sparse":
            return httpx.Response(200, json=envelope({"evidence_id": "evd_sparse", "source_reliability": None}))
        if request.url.path.startswith("/v1/agent/"):
            assert request.headers["X-Agent-Key"] == "agtk_test_key"
        if request.url.path == "/v1/agent/me":
            return httpx.Response(200, json=envelope({"agent_id": "agt_sparse"}))
        if request.url.path == "/v1/agent/topics":
            return httpx.Response(200, json=envelope({"topics": ["skip", {"topic_key": "ai.infra", "priority": None}]}))
        if request.url.path == "/v1/agent/feed":
            return httpx.Response(200, json=envelope({"items": [None, {"content_id": "cnt_feed_sparse"}]}))
        if request.url.path == "/v1/agent/content/cnt_agent_sparse":
            return httpx.Response(200, json=envelope({"content_id": "cnt_agent_sparse", "claims": "skip"}))
        if request.url.path == "/v1/agent/threads/thr_sparse":
            return httpx.Response(200, json=envelope({"thread_id": "thr_sparse", "items": ["skip", {"content_id": "cnt_agent_sparse"}]}))
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler, agent_key="agtk_test_key") as client:
        home = client.get_network_home(limit=2)
        detail = client.get_network_content("cnt_sparse")
        batch = client.get_network_content_batch(["cnt_sparse"])
        replies = client.list_network_content_replies("cnt_sparse")
        claim = client.get_network_claim("clm_sparse")
        evidence = client.get_network_evidence("evd_sparse")
        profile = client.get_agent_profile()
        topics = client.list_agent_topics()
        feed = client.get_agent_feed()
        agent_content = client.get_agent_content("cnt_agent_sparse")
        thread = client.get_agent_thread("thr_sparse")

    assert home.items[0].content_id == "cnt_sparse"
    assert home.items[0].confidence == 0.0
    assert home.next_cursor == "cursor_sparse"
    assert detail.claims == ["clm_sparse"]
    assert detail.evidence_refs == []
    assert detail.body == {}
    assert batch[0].content_id == "cnt_sparse"
    assert replies.replies[0].content_id == "cnt_reply_sparse"
    assert replies.context_head is None
    assert replies.thread_surface_scores == []
    assert replies.total_count == 0
    assert claim.evidence_refs == ["evd_sparse"]
    assert claim.signal_packet == {}
    assert evidence.source_reliability == 0.0
    assert profile.agent_id == "agt_sparse"
    assert topics[0].priority == 0
    assert feed[0].content_id == "cnt_feed_sparse"
    assert agent_content.claims == []
    assert thread.items[0].content_id == "cnt_agent_sparse"


def test_portal_grants_accounts_support_and_submit_review_are_typed() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/developer/portal":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "platform": {"developer_portal_url": "https://siglume.com/owner/publish"},
                        "monetization": {"developer_share_bps": 9340},
                        "payout_readiness": {"verified_destination": True},
                        "listings": {"total_count": 2},
                        "usage": {"event_count": 12},
                        "support": {"open_case_count": 1},
                        "apps": [
                            {
                                "id": "lst_1",
                                "capability_key": "price-compare-helper",
                                "name": "Price Compare Helper",
                                "status": "published",
                                "dry_run_supported": True,
                                "price_model": "free",
                                "price_value_minor": 0,
                                "currency": "USD",
                            }
                        ],
                    }
                ),
            )
        if request.url.path == "/v1/market/sandbox/sessions":
            body = json.loads(request.content.decode("utf-8"))
            assert body["capability_key"] == "price-compare-helper"
            return httpx.Response(
                201,
                json=envelope(
                    {
                        "session_id": "ses_123",
                        "agent_id": "agt_123",
                        "capability_key": "price-compare-helper",
                        "environment": "sandbox",
                        "dry_run_supported": True,
                        "approval_mode": "auto",
                    }
                ),
            )
        if request.url.path == "/v1/market/access-grants":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {
                                "id": "grt_123",
                                "capability_listing_id": "lst_1",
                                "grant_status": "active",
                                "billing_model": "subscription",
                                "bindings": [],
                            }
                        ],
                        "next_cursor": None,
                        "limit": 20,
                        "offset": 0,
                    }
                ),
            )
        if request.url.path == "/v1/market/access-grants/grt_123/bind-agent":
            body = json.loads(request.content.decode("utf-8"))
            assert body["agent_id"] == "agt_123"
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "binding": {
                            "id": "bnd_123",
                            "access_grant_id": "grt_123",
                            "agent_id": "agt_123",
                            "binding_status": "active",
                        },
                        "access_grant": {
                            "id": "grt_123",
                            "capability_listing_id": "lst_1",
                            "grant_status": "active",
                            "billing_model": "subscription",
                            "bindings": [],
                        },
                    }
                ),
            )
        if request.url.path == "/v1/market/connected-accounts":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {
                                "id": "ca_123",
                                "provider_key": "slack",
                                "account_role": "publisher",
                                "display_name": "Team Slack",
                                "environment": "live",
                                "connection_status": "connected",
                                "scopes": ["chat:write"],
                            }
                        ],
                        "next_cursor": None,
                        "limit": 50,
                        "offset": 0,
                    }
                ),
            )
        if request.url.path == "/v1/market/support-cases" and request.method == "POST":
            body = json.loads(request.content.decode("utf-8"))
            assert body["summary"] == "Missing receipt\n\nPlease investigate the missing receipt."
            assert body["trace_id"] == "trc_support"
            return httpx.Response(
                201,
                json=envelope(
                    {
                        "id": "sup_123",
                        "case_type": "app_execution",
                        "summary": body["summary"],
                        "status": "open",
                        "trace_id": "trc_support",
                    }
                ),
            )
        if request.url.path == "/v1/market/support-cases" and request.method == "GET":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {
                                "id": "sup_123",
                                "case_type": "app_execution",
                                "summary": "Missing receipt\n\nPlease investigate the missing receipt.",
                                "status": "open",
                                "trace_id": "trc_support",
                            }
                        ],
                        "next_cursor": None,
                        "limit": 50,
                        "offset": 0,
                    }
                ),
            )
        if request.url.path == "/v1/market/capabilities/lst_1/submit-review":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "id": "lst_1",
                        "capability_key": "price-compare-helper",
                        "name": "Price Compare Helper",
                        "status": "active",
                        "dry_run_supported": True,
                        "price_model": "free",
                        "price_value_minor": 0,
                        "currency": "USD",
                    }
                ),
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        portal = client.get_developer_portal()
        sandbox = client.create_sandbox_session(agent_id="agt_123", capability_key="price-compare-helper")
        grants = client.list_access_grants()
        binding = client.bind_agent_to_grant("grt_123", agent_id="agt_123")
        accounts = client.list_connected_accounts()
        support_case = client.create_support_case("Missing receipt", "Please investigate the missing receipt.", trace_id="trc_support")
        support_cases = client.list_support_cases()
        review = client.submit_review("lst_1")

    assert portal.apps[0].capability_key == "price-compare-helper"
    assert sandbox.session_id == "ses_123"
    assert grants.items[0].grant_status == "active"
    assert binding.binding.binding_status == "active"
    assert accounts.items[0].provider_key == "slack"
    assert support_case.trace_id == "trc_support"
    assert support_cases.items[0].support_case_id == "sup_123"
    assert review.status == "active"


def test_preview_quality_score_maps_server_validation_and_quality_issues() -> None:
    tool_manual = build_tool_manual()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/market/tool-manuals/preview-quality"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["tool_manual"]["tool_name"] == tool_manual.tool_name
        return httpx.Response(
            200,
            json=envelope(
                {
                    "ok": False,
                    "errors": [
                        {
                            "code": "MISSING_FIELD",
                            "message": "usage_hints is missing",
                            "field": "usage_hints",
                        }
                    ],
                    "warnings": [],
                    "quality": {
                        "overall_score": 78,
                        "grade": "B",
                        "keyword_coverage_estimate": 61,
                        "issues": [
                            {
                                "category": "trigger_specificity",
                                "severity": "warning",
                                "message": "Trigger conditions could be more concrete.",
                                "suggestion": "Use explicit nouns and verbs.",
                            }
                        ],
                        "improvement_suggestions": ["Add one more concrete trigger example."],
                    },
                }
            ),
        )

    with build_client(handler) as client:
        report = client.preview_quality_score(tool_manual)

    assert report.overall_score == 78
    assert report.grade == "B"
    assert report.publishable is False
    assert report.validation_ok is False
    assert report.keyword_coverage_estimate == 61
    assert [issue.code for issue in report.validation_errors] == ["MISSING_FIELD"]
    assert report.validation_warnings == []
    assert [issue.code for issue in report.issues] == ["MISSING_FIELD", "trigger_specificity"]
    assert report.improvement_suggestions == ["Add one more concrete trigger example."]


def test_auto_register_uses_source_url_without_sending_source_code() -> None:
    manifest = build_manifest()
    tool_manual = build_tool_manual()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/market/capabilities/auto-register"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["source_url"] == "https://github.com/example/repo/blob/main/app.py"
        assert "source_code" not in payload
        return httpx.Response(
            201,
            json=envelope(
                {
                    "listing_id": "lst_url",
                    "status": "draft",
                    "auto_manifest": {"capability_key": manifest.capability_key},
                    "confidence": {},
                    "review_url": None,
                }
            ),
        )

    with build_client(handler) as client:
        receipt = client.auto_register(
            manifest,
            tool_manual,
            source_url="https://github.com/example/repo/blob/main/app.py",
            runtime_validation=build_runtime_validation(),
        )

    assert receipt.listing_id == "lst_url"


def test_preview_quality_score_preserves_zero_values_from_canonical_fields() -> None:
    tool_manual = build_tool_manual()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/market/tool-manuals/preview-quality"
        return httpx.Response(
            200,
            json=envelope(
                {
                    "ok": True,
                    "errors": [],
                    "warnings": [],
                    "quality": {
                        "overall_score": 0,
                        "score": 91,
                        "grade": "F",
                        "publishable": False,
                        "keyword_coverage_estimate": 0,
                        "keyword_coverage": 44,
                        "issues": [],
                        "improvement_suggestions": [],
                    },
                }
            ),
        )

    with build_client(handler) as client:
        report = client.preview_quality_score(tool_manual)

    assert report.overall_score == 0
    assert report.keyword_coverage_estimate == 0


def test_retry_and_api_error_capture_status_code_and_trace_id() -> None:
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        if attempts["count"] == 1:
            return httpx.Response(503, headers={"Retry-After": "0"})
        return httpx.Response(
            409,
            json={
                "error": {
                    "code": "CONFLICT",
                    "message": "Listing already exists.",
                    "details": {"capability_key": "price-compare-helper"},
                },
                "meta": {"trace_id": "trc_conflict", "request_id": "req_conflict"},
            },
        )

    with build_client(handler) as client:
        try:
            client.get_listing("lst_conflict")
        except SiglumeAPIError as exc:
            error = exc
        else:
            raise AssertionError("Expected SiglumeAPIError to be raised.")

    assert attempts["count"] == 2
    assert error.status_code == 409
    assert error.error_code == "CONFLICT"
    assert error.trace_id == "trc_conflict"
    assert error.details["capability_key"] == "price-compare-helper"


def test_list_agents_without_query_returns_personal_agent_singleton() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/me/agent"
        return httpx.Response(
            200,
            json=envelope(
                {
                    "agent_id": "agt_owner_demo",
                    "agent_type": "personal",
                    "name": "Owner Demo",
                    "avatar_url": "/avatars/owner-demo.png",
                    "description": "Owner-managed marketplace agent.",
                    "status": "active",
                    "capabilities": {"marketplace": True},
                    "settings": {"paused": False},
                }
            ),
        )

    with build_client(handler) as client:
        agents = client.list_agents()

    assert len(agents) == 1
    assert agents[0].agent_id == "agt_owner_demo"
    assert agents[0].capabilities["marketplace"] is True
    assert agents[0].settings["paused"] is False


def test_list_agents_with_query_and_get_agent_parse_search_and_profile_shapes() -> None:
    search_calls: list[dict[str, str | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/search/agents":
            assert request.url.params["query"] == "budget"
            search_calls.append(
                {
                    "cursor": request.url.params.get("cursor"),
                    "limit": request.url.params.get("limit"),
                }
            )
            if request.url.params.get("cursor") == "next_agents":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "items": [
                                {
                                    "agent_id": "agt_budget_helper",
                                    "name": "Budget Helper",
                                    "avatar_url": "/avatars/budget-helper.png",
                                    "description": "Tracks cautious purchasing rules.",
                                    "expertise": ["budgeting"],
                                    "post_count": 1,
                                    "reply_count": 0,
                                }
                            ],
                            "next_cursor": None,
                        }
                    ),
                )
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {
                                "agent_id": "agt_budget_demo",
                                "name": "Budget Demo",
                                "avatar_url": "/avatars/budget-demo.png",
                                "description": "Focuses on budget-safe travel purchases.",
                                "expertise": ["travel", "budgeting"],
                                "post_count": 3,
                                "reply_count": 1,
                            }
                        ],
                        "next_cursor": "next_agents",
                    }
                ),
            )
        if request.url.path == "/v1/agents/agt_budget_demo/profile":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": "agt_budget_demo",
                        "name": "Budget Demo",
                        "avatar_url": "/avatars/budget-demo.png",
                        "description": "Focuses on budget-safe travel purchases.",
                        "agent_type": "personal",
                        "expertise": ["travel", "budgeting"],
                        "style": "careful",
                        "paused": False,
                        "manifesto_text": "Prefer clear budgets and explicit approvals.",
                        "plan": {"tier": "pro"},
                        "reputation": {"score": 0.92},
                        "post_count": 3,
                        "reply_count": 1,
                        "items": [{"content_id": "cnt_demo_1", "title": "Travel safety checklist"}],
                        "next_cursor": None,
                    }
                ),
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        agents = client.list_agents(query="budget", limit=5)
        agent = client.get_agent("agt_budget_demo")

    assert [item.agent_id for item in agents] == ["agt_budget_demo", "agt_budget_helper"]
    assert agents[0].expertise == ["travel", "budgeting"]
    assert agent.manifesto_text == "Prefer clear budgets and explicit approvals."
    assert agent.plan["tier"] == "pro"
    assert agent.items[0]["content_id"] == "cnt_demo_1"
    assert search_calls == [
        {"cursor": None, "limit": "5"},
        {"cursor": "next_agents", "limit": "4"},
    ]


def test_update_agent_charter_maps_charter_text_into_goals_payload() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/owner/agents/agt_owner_demo/charter"
        assert request.method == "PUT"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["goals"]["charter_text"] == "Prefer capped spend and explicit approval for unusual purchases."
        assert payload["role"] == "buyer"
        assert payload["success_metrics"]["approval_rate_floor"] == 0.8
        assert "wait_for_completion" not in payload
        return httpx.Response(
            200,
            json=envelope(
                {
                    "charter_id": "chr_demo_2",
                    "agent_id": "agt_owner_demo",
                    "principal_user_id": "usr_owner_demo",
                    "version": 2,
                    "active": True,
                    "role": "buyer",
                    "goals": {"charter_text": payload["goals"]["charter_text"]},
                    "target_profile": {},
                    "qualification_criteria": {},
                    "success_metrics": payload["success_metrics"],
                    "constraints": {},
                }
            ),
        )

    with build_client(handler) as client:
        charter = client.update_agent_charter(
            "agt_owner_demo",
            "Prefer capped spend and explicit approval for unusual purchases.",
            role="buyer",
            success_metrics={"approval_rate_floor": 0.8},
            wait_for_completion=True,
        )

    assert charter.charter_id == "chr_demo_2"
    assert charter.charter_text == "Prefer capped spend and explicit approval for unusual purchases."
    assert charter.success_metrics["approval_rate_floor"] == 0.8


def test_update_approval_policy_sanitizes_server_managed_fields() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/owner/agents/agt_owner_demo/approval-policy"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload == {
            "auto_approve_below": {"JPY": 3000},
            "always_require_approval_for": ["travel.booking"],
            "approval_ttl_minutes": 720,
            "structured_only": True,
        }
        return httpx.Response(
            200,
            json=envelope(
                {
                    "approval_policy_id": "apl_demo_2",
                    "agent_id": "agt_owner_demo",
                    "principal_user_id": "usr_owner_demo",
                    "version": 2,
                    "active": True,
                    "auto_approve_below": {"JPY": 3000},
                    "always_require_approval_for": ["travel.booking"],
                    "deny_if": {},
                    "approval_ttl_minutes": 720,
                    "structured_only": True,
                    "merchant_allowlist": [],
                    "merchant_denylist": [],
                    "category_allowlist": [],
                    "category_denylist": [],
                    "risk_policy": {},
                }
            ),
        )

    with build_client(handler) as client:
        policy = client.update_approval_policy(
            "agt_owner_demo",
            {
                "approval_policy_id": "apl_ignore_me",
                "version": 999,
                "auto_approve_below": {"JPY": 3000},
                "always_require_approval_for": ["travel.booking"],
                "approval_ttl_minutes": 720,
                "structured_only": True,
            },
            wait_for_completion=True,
        )

    assert policy.approval_policy_id == "apl_demo_2"
    assert policy.auto_approve_below["JPY"] == 3000
    assert policy.default_requires_approval is True
    assert policy.approval_ttl_minutes == 720


def test_update_budget_policy_sanitizes_server_managed_fields() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/owner/agents/agt_owner_demo/budget"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload == {
            "currency": "JPY",
            "period_limit_minor": 50000,
            "per_order_limit_minor": 12000,
            "auto_approve_below_minor": 3000,
            "metadata": {"source": "sdk-test"},
        }
        return httpx.Response(
            200,
            json=envelope(
                {
                    "budget_id": "bdg_demo_2",
                    "agent_id": "agt_owner_demo",
                    "principal_user_id": "usr_owner_demo",
                    "currency": "JPY",
                    "period_start": "2026-04-01T00:00:00Z",
                    "period_end": "2026-05-01T00:00:00Z",
                    "period_limit_minor": 50000,
                    "spent_minor": 0,
                    "reserved_minor": 0,
                    "per_order_limit_minor": 12000,
                    "auto_approve_below_minor": 3000,
                    "limits": {
                        "period_limit": 50000,
                        "per_order_limit": 12000,
                        "auto_approve_below": 3000,
                    },
                    "metadata": {"source": "sdk-test"},
                }
            ),
        )

    with build_client(handler) as client:
        budget = client.update_budget_policy(
            "agt_owner_demo",
            {
                "budget_id": "bdg_ignore_me",
                "currency": "JPY",
                "period_limit_minor": 50000,
                "per_order_limit_minor": 12000,
                "auto_approve_below_minor": 3000,
                "metadata": {"source": "sdk-test"},
            },
            wait_for_completion=True,
        )

    assert budget.budget_id == "bdg_demo_2"
    assert budget.period_limit_minor == 50000
    assert budget.limits["per_order_limit"] == 12000


def test_update_budget_policy_forwards_null_period_dates_to_clear_them() -> None:
    """period_start / period_end are nullable — sending None must clear the boundary on the server."""

    captured_payload: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/owner/agents/agt_owner_demo/budget"
        captured_payload.update(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json=envelope(
                {
                    "budget_id": "bdg_clear_dates",
                    "agent_id": "agt_owner_demo",
                    "principal_user_id": "usr_owner_demo",
                    "currency": "JPY",
                    "period_start": None,
                    "period_end": None,
                    "period_limit_minor": 50000,
                    "spent_minor": 0,
                    "reserved_minor": 0,
                    "limits": {},
                    "metadata": {},
                }
            ),
        )

    with build_client(handler) as client:
        client.update_budget_policy(
            "agt_owner_demo",
            {"period_start": None, "period_end": None},
        )

    assert captured_payload == {"period_start": None, "period_end": None}


def test_update_budget_policy_still_strips_nulls_for_non_nullable_fields() -> None:
    """Non-nullable fields like currency must still be filtered when None is passed."""

    captured_payload: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_payload.update(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json=envelope(
                {
                    "budget_id": "bdg_strip_nonnullable",
                    "agent_id": "agt_owner_demo",
                    "principal_user_id": "usr_owner_demo",
                    "currency": "USD",
                    "period_limit_minor": 1000,
                    "spent_minor": 0,
                    "reserved_minor": 0,
                    "limits": {},
                    "metadata": {},
                }
            ),
        )

    with build_client(handler) as client:
        client.update_budget_policy(
            "agt_owner_demo",
            {"currency": None, "period_limit_minor": 1000},
        )

    assert captured_payload == {"period_limit_minor": 1000}


def test_update_budget_policy_rejects_payload_with_only_filtered_fields() -> None:
    """If the only field provided is a non-nullable None, the whole call should still error."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("handler should not be called")

    with build_client(handler) as client:
        try:
            client.update_budget_policy("agt_owner_demo", {"currency": None})
        except SiglumeClientError:
            return
    raise AssertionError("Expected SiglumeClientError when the only field is a stripped None")


def test_update_budget_policy_preserves_nullable_period_boundaries() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/owner/agents/agt_owner_demo/budget"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload == {
            "currency": "JPY",
            "period_start": None,
            "period_end": None,
            "period_limit_minor": 9000,
        }
        return httpx.Response(
            200,
            json=envelope(
                {
                    "budget_id": "bdg_nullable",
                    "agent_id": "agt_owner_demo",
                    "currency": "JPY",
                    "period_start": None,
                    "period_end": None,
                    "period_limit_minor": 9000,
                    "spent_minor": 0,
                    "reserved_minor": 0,
                    "per_order_limit_minor": 0,
                    "auto_approve_below_minor": 0,
                    "limits": {},
                    "metadata": {},
                }
            ),
        )

    with build_client(handler) as client:
        budget = client.update_budget_policy(
            "agt_owner_demo",
            {
                "currency": "JPY",
                "period_start": None,
                "period_end": None,
                "period_limit_minor": 9000,
            },
        )

    assert budget.budget_id == "bdg_nullable"
    assert budget.period_start is None
    assert budget.period_end is None


def test_list_operations_uses_owner_operation_catalog_and_execute_route() -> None:
    requests: list[tuple[str, str, dict[str, object]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations":
            assert request.url.params["lang"] == "ja"
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "items": [
                            {
                                "name": "owner.charter.update",
                                "summary": "Update the owner charter.",
                                "params": "Supports goals and constraints.",
                                "allowed_params": ["goals", "constraints"],
                                "required_params": ["goals"],
                                "requires_params": True,
                                "page_href": "/owner/charters",
                            }
                        ]
                    }
                ),
            )
        if request.url.path == f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute":
            body = json.loads(request.content.decode("utf-8")) if request.content else {}
            requests.append((request.method, request.url.path, body))
            assert body["operation"] == "owner.charter.update"
            assert body["params"]["goals"]["charter_text"] == "Prefer budget discipline."
            assert body["lang"] == "ja"
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Updated charter successfully.",
                        "action": "owner_charter_update",
                        "result": {"version": 2},
                    },
                    trace_id="trc_operation",
                    request_id="req_operation",
                ),
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        operations = client.list_operations(agent_id=DEFAULT_OPERATION_AGENT_ID, lang="ja")
        operation = client.get_operation_metadata("owner.charter.update", agent_id=DEFAULT_OPERATION_AGENT_ID, lang="ja")
        execution = client.execute_owner_operation(
            DEFAULT_OPERATION_AGENT_ID,
            "owner.charter.update",
            {"goals": {"charter_text": "Prefer budget discipline."}},
            lang="ja",
        )

    assert [item.operation_key for item in operations] == ["owner.charter.update"]
    assert operations[0].permission_class == "action"
    assert operation.required_params == ["goals"]
    assert execution.agent_id == DEFAULT_OPERATION_AGENT_ID
    assert execution.action == "owner_charter_update"
    assert execution.result["version"] == 2
    assert execution.trace_id == "trc_operation"
    assert requests == [
        (
            "POST",
            f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute",
            {
                "operation": "owner.charter.update",
                "params": {"goals": {"charter_text": "Prefer budget discipline."}},
                "lang": "ja",
            },
        )
    ]


def test_list_operations_falls_back_to_bundled_catalog_when_route_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/me/agent":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "agent_type": "personal",
                        "name": "Owner Demo",
                    }
                ),
            )
        if request.url.path == f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations":
            return httpx.Response(404, json={"error": {"code": "NOT_FOUND", "message": "missing"}})
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        operations = client.list_operations(lang="en")

    assert {item.operation_key for item in operations} >= {
        "owner.charter.get",
        "owner.charter.update",
        "owner.approval_policy.get",
        "owner.budget.update",
    }
    assert all(item.agent_id == DEFAULT_OPERATION_AGENT_ID for item in operations)


def test_market_need_wrappers_round_trip_through_owner_operation_cassette(tmp_path: Path) -> None:
    cassette_path = tmp_path / "market-needs-roundtrip.json"
    requests: list[tuple[str, str, dict[str, object]]] = []

    need_one = {
        "need_id": "need_demo_1",
        "owner_user_id": "usr_owner_demo",
        "principal_user_id": "usr_owner_demo",
        "buyer_agent_id": DEFAULT_OPERATION_AGENT_ID,
        "charter_id": "chr_owner_demo",
        "charter_version": 3,
        "title": "Localize release notes into Japanese",
        "problem_statement": "Need a reviewable EN->JA translation within 24 hours.",
        "category_key": "translation",
        "budget_min_minor": 8000,
        "budget_max_minor": 15000,
        "urgency": 7,
        "requirement_jsonb": {"languages": ["en", "ja"], "sla_hours": 24},
        "status": "open",
        "metadata": {"source": "sdk-test"},
        "detected_at": "2026-04-20T08:00:00Z",
        "created_at": "2026-04-20T08:00:00Z",
        "updated_at": "2026-04-20T08:10:00Z",
    }
    need_two = {
        "need_id": "need_demo_2",
        "owner_user_id": "usr_owner_demo",
        "principal_user_id": "usr_owner_demo",
        "buyer_agent_id": DEFAULT_OPERATION_AGENT_ID,
        "charter_id": "chr_owner_demo",
        "charter_version": 3,
        "title": "Summarize partner invoices",
        "problem_statement": "Need an invoice anomaly summary before finance review.",
        "category_key": "finance",
        "budget_min_minor": 6000,
        "budget_max_minor": 12000,
        "urgency": 5,
        "requirement_jsonb": {"period": "monthly"},
        "status": "open",
        "metadata": {"source": "sdk-test"},
        "detected_at": "2026-04-19T21:00:00Z",
        "created_at": "2026-04-19T21:00:00Z",
        "updated_at": "2026-04-20T07:00:00Z",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        requests.append((request.method, request.url.path, body))
        operation = body.get("operation")
        params = body.get("params") if isinstance(body.get("params"), dict) else {}
        if operation == "market.needs.list":
            if params.get("cursor") == "next_need":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "message": "Market needs loaded.",
                            "action": "market_needs_list",
                            "result": {"items": [need_two], "next_cursor": None},
                        },
                        trace_id="trc_market_needs_list_2",
                        request_id="req_market_needs_list_2",
                    ),
                )
            assert params == {"limit": 1, "status": "open"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Market needs loaded.",
                        "action": "market_needs_list",
                        "result": {"items": [need_one], "next_cursor": "next_need"},
                    },
                        trace_id="trc_market_needs_list_1",
                        request_id="req_market_needs_list_1",
                ),
            )
        if operation == "market.needs.get":
            assert params == {"need_id": "need_demo_1"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Market need loaded.",
                        "action": "market_needs_get",
                        "result": need_one,
                    },
                    trace_id="trc_market_needs_get",
                    request_id="req_market_needs_get",
                ),
            )
        if operation == "market.needs.create":
            assert params == {
                "title": "Draft Japanese release-note translation need",
                "problem_statement": "Need a publish-ready translation within 24 hours.",
                "category_key": "translation",
                "budget_min_minor": 9000,
                "budget_max_minor": 15000,
                "urgency": 8,
                "requirement_jsonb": {"languages": ["en", "ja"]},
                "metadata": {"source": "sdk-test"},
                "status": "open",
            }
            created = dict(need_one)
            created["need_id"] = "need_created_1"
            created["title"] = str(params["title"])
            created["problem_statement"] = str(params["problem_statement"])
            created["budget_min_minor"] = int(params["budget_min_minor"])
            created["budget_max_minor"] = int(params["budget_max_minor"])
            created["urgency"] = int(params["urgency"])
            created["requirement_jsonb"] = dict(params["requirement_jsonb"])
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Market need created.",
                        "action": "market_needs_create",
                        "result": created,
                    },
                    trace_id="trc_market_needs_create",
                    request_id="req_market_needs_create",
                ),
            )
        if operation == "market.needs.update":
            assert params == {
                "need_id": "need_demo_1",
                "status": "closed",
                "metadata": {"source": "sdk-test", "reviewed": True},
            }
            updated = dict(need_one)
            updated["status"] = "closed"
            updated["metadata"] = {"source": "sdk-test", "reviewed": True}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Market need updated.",
                        "action": "market_needs_update",
                        "result": updated,
                    },
                    trace_id="trc_market_needs_update",
                    request_id="req_market_needs_update",
                ),
            )
        raise AssertionError(f"Unexpected operation payload: {body}")

    with Recorder(cassette_path, mode=RecordMode.RECORD) as recorder:
        with recorder.wrap(build_client(handler)) as client:
            first_page = client.list_market_needs(agent_id=DEFAULT_OPERATION_AGENT_ID, status="open", limit=1)
            all_needs = first_page.all_items()
            detail = client.get_market_need("need_demo_1", agent_id=DEFAULT_OPERATION_AGENT_ID)
            created = client.create_market_need(
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                title="Draft Japanese release-note translation need",
                problem_statement="Need a publish-ready translation within 24 hours.",
                category_key="translation",
                budget_min_minor=9000,
                budget_max_minor=15000,
                urgency=8,
                requirement_jsonb={"languages": ["en", "ja"]},
                metadata={"source": "sdk-test"},
                status="open",
            )
            updated = client.update_market_need(
                "need_demo_1",
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                status="closed",
                metadata={"source": "sdk-test", "reviewed": True},
            )

    with Recorder(cassette_path, mode=RecordMode.REPLAY) as recorder:
        with recorder.wrap(build_client(lambda request: (_ for _ in ()).throw(AssertionError(f"Replay should not hit transport: {request.method} {request.url}")))) as client:
            replay_page = client.list_market_needs(agent_id=DEFAULT_OPERATION_AGENT_ID, status="open", limit=1)
            replay_needs = replay_page.all_items()
            replay_detail = client.get_market_need("need_demo_1", agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_created = client.create_market_need(
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                title="Draft Japanese release-note translation need",
                problem_statement="Need a publish-ready translation within 24 hours.",
                category_key="translation",
                budget_min_minor=9000,
                budget_max_minor=15000,
                urgency=8,
                requirement_jsonb={"languages": ["en", "ja"]},
                metadata={"source": "sdk-test"},
                status="open",
            )
            replay_updated = client.update_market_need(
                "need_demo_1",
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                status="closed",
                metadata={"source": "sdk-test", "reviewed": True},
            )

    assert [item.need_id for item in all_needs] == ["need_demo_1", "need_demo_2"]
    assert first_page.meta.trace_id == "trc_market_needs_list_1"
    assert detail.title == "Localize release notes into Japanese"
    assert detail.requirement_jsonb == {"languages": ["en", "ja"], "sla_hours": 24}
    assert created.need_id == "need_created_1"
    assert updated.status == "closed"
    assert replay_needs[1].title == "Summarize partner invoices"
    assert replay_detail.need_id == detail.need_id
    assert replay_created.need_id == created.need_id
    assert replay_updated.metadata["reviewed"] is True
    assert [item[2]["operation"] for item in requests] == [
        "market.needs.list",
        "market.needs.list",
        "market.needs.get",
        "market.needs.create",
        "market.needs.update",
    ]


def test_market_need_wrappers_validate_required_inputs() -> None:
    with build_client(lambda request: (_ for _ in ()).throw(AssertionError(f"Unexpected request: {request.method} {request.url}"))) as client:
        with pytest.raises(SiglumeClientError, match="need_id is required."):
            client.get_market_need("")
        with pytest.raises(SiglumeClientError, match="title is required."):
            client.create_market_need(
                title="",
                problem_statement="Need a translation.",
                category_key="translation",
                budget_min_minor=10,
                budget_max_minor=20,
            )
        with pytest.raises(SiglumeClientError, match="problem_statement is required."):
            client.create_market_need(
                title="Translate release notes",
                problem_statement="",
                category_key="translation",
                budget_min_minor=10,
                budget_max_minor=20,
            )
        with pytest.raises(SiglumeClientError, match="category_key is required."):
            client.create_market_need(
                title="Translate release notes",
                problem_statement="Need a translation.",
                category_key="",
                budget_min_minor=10,
                budget_max_minor=20,
            )
        with pytest.raises(SiglumeClientError, match="budget_min_minor cannot exceed budget_max_minor."):
            client.create_market_need(
                title="Translate release notes",
                problem_statement="Need a translation.",
                category_key="translation",
                budget_min_minor=30,
                budget_max_minor=20,
            )
        with pytest.raises(SiglumeClientError, match="update_market_need requires at least one field to update."):
            client.update_market_need("need_demo_1")


def test_market_need_wrappers_resolve_default_agent_and_parse_sparse_payloads() -> None:
    requests: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        if request.url.path == "/v1/me/agent":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "agent_type": "personal",
                        "name": "Owner Demo",
                    }
                ),
            )
        if request.url.path == f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute":
            body = json.loads(request.content.decode("utf-8")) if request.content else {}
            operation = body.get("operation")
            if operation == "market.needs.list":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "message": "Market needs loaded.",
                            "action": "market_needs_list",
                            "result": {"items": [{"need_id": "need_sparse", "status": "open"}], "next_cursor": "cursor_sparse"},
                        }
                    ),
                )
            if operation == "market.needs.get":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "message": "Market need loaded.",
                            "action": "market_needs_get",
                            "result": {"need_id": "need_sparse", "status": "open"},
                        }
                    ),
                )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        page = client.list_market_needs(limit=2)
        detail = client.get_market_need("need_sparse")

    assert page.items[0].need_id == "need_sparse"
    assert page.items[0].metadata == {}
    assert page.next_cursor == "cursor_sparse"
    assert detail.need_id == "need_sparse"
    assert detail.requirement_jsonb == {}
    assert requests == [
        ("GET", "/v1/me/agent"),
        ("POST", f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute"),
        ("GET", "/v1/me/agent"),
        ("POST", f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute"),
    ]


def test_market_proposal_wrappers_record_and_replay_round_trip(tmp_path: Path) -> None:
    requests: list[tuple[str, str, dict[str, object]]] = []
    cassette_path = tmp_path / "market_proposals_recorded.json"
    proposal_one = {
        "proposal_id": "prop_demo_1",
        "opportunity_id": "opp_demo_1",
        "listing_id": "lst_demo_1",
        "need_id": "need_demo_1",
        "seller_agent_id": "agt_seller_1",
        "buyer_agent_id": DEFAULT_OPERATION_AGENT_ID,
        "proposal_kind": "proposal",
        "proposed_terms_jsonb": {"delivery_days": 7, "amount_minor": 25000},
        "status": "draft",
        "reason_codes": ["needs_owner_review"],
        "approval_policy_snapshot_jsonb": {"mode": "owner_review"},
        "delegated_budget_snapshot_jsonb": {"remaining_minor": 50000},
        "explanation": {"summary": "Opening proposal."},
        "soft_budget_check": {"within_budget": True},
        "created_at": "2026-04-20T08:00:00Z",
        "updated_at": "2026-04-20T08:05:00Z",
    }
    proposal_two = {
        "proposal_id": "prop_demo_2",
        "opportunity_id": "opp_demo_1",
        "listing_id": "lst_demo_1",
        "need_id": "need_demo_1",
        "seller_agent_id": "agt_seller_1",
        "buyer_agent_id": DEFAULT_OPERATION_AGENT_ID,
        "proposal_kind": "counter",
        "proposed_terms_jsonb": {"delivery_days": 5, "amount_minor": 26000},
        "status": "pending_buyer",
        "reason_codes_jsonb": ["counter_received"],
        "approval_policy_snapshot_jsonb": {"mode": "owner_review"},
        "delegated_budget_snapshot_jsonb": {"remaining_minor": 50000},
        "explanation": {"summary": "Counter proposal."},
        "soft_budget_check": {"within_budget": True},
        "created_at": "2026-04-20T09:00:00Z",
        "updated_at": "2026-04-20T09:10:00Z",
    }

    def approval_response(
        operation_key: str,
        *,
        intent_id: str,
        preview: dict[str, object],
        trace_id: str,
        request_id: str,
    ) -> httpx.Response:
        return httpx.Response(
            200,
            json=envelope(
                {
                    "agent_id": DEFAULT_OPERATION_AGENT_ID,
                    "status": "approval_required",
                    "approval_required": True,
                    "intent_id": intent_id,
                    "approval_status": "pending_owner",
                    "approval_snapshot_hash": f"snap_{intent_id}",
                    "message": f"{operation_key} requires owner approval.",
                    "action": {
                        "type": "operation",
                        "operation": operation_key,
                        "status": "approval_required",
                        "summary": f"{operation_key} staged for owner review.",
                    },
                    "result": {
                        "preview": preview,
                        "approval_snapshot_hash": f"snap_{intent_id}",
                    },
                    "safety": {"approval_required": True, "actor_scope": "owner"},
                },
                trace_id=trace_id,
                request_id=request_id,
            ),
        )

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        requests.append((request.method, request.url.path, body))
        if request.url.path != f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        operation = body.get("operation")
        params = body.get("params") if isinstance(body.get("params"), dict) else {}
        if operation == "market.proposals.list":
            if params.get("cursor") == "cursor_2":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "message": "Market proposals loaded.",
                            "action": "market_proposals_list",
                            "result": {"items": [proposal_two], "next_cursor": None},
                        },
                        trace_id="trc_market_proposals_list_2",
                        request_id="req_market_proposals_list_2",
                    ),
                )
            assert params == {"limit": 1, "status": "draft"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Market proposals loaded.",
                        "action": "market_proposals_list",
                        "result": {"items": [proposal_one], "next_cursor": "cursor_2"},
                    },
                    trace_id="trc_market_proposals_list_1",
                    request_id="req_market_proposals_list_1",
                ),
            )
        if operation == "market.proposals.get":
            assert params == {"proposal_id": "prop_demo_1"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Market proposal loaded.",
                        "action": "market_proposals_get",
                        "result": proposal_one,
                    },
                    trace_id="trc_market_proposals_get",
                    request_id="req_market_proposals_get",
                ),
            )
        if operation == "market.proposals.create":
            assert params["opportunity_id"] == "opp_demo_1"
            assert params["amount_minor"] == 25000
            return approval_response(
                "market.proposals.create",
                intent_id="intent_prop_create_1",
                preview={
                    "opportunity_id": params["opportunity_id"],
                    "proposal_kind": params["proposal_kind"],
                    "amount_minor": params["amount_minor"],
                },
                trace_id="trc_market_proposals_create",
                request_id="req_market_proposals_create",
            )
        if operation == "market.proposals.counter":
            assert params["proposal_id"] == "prop_demo_1"
            return approval_response(
                "market.proposals.counter",
                intent_id="intent_prop_counter_1",
                preview={"proposal_id": params["proposal_id"], "proposal_kind": params["proposal_kind"]},
                trace_id="trc_market_proposals_counter",
                request_id="req_market_proposals_counter",
            )
        if operation == "market.proposals.accept":
            assert params["proposal_id"] == "prop_demo_1"
            return approval_response(
                "market.proposals.accept",
                intent_id="intent_prop_accept_1",
                preview={"proposal_id": params["proposal_id"], "comment": params["comment"]},
                trace_id="trc_market_proposals_accept",
                request_id="req_market_proposals_accept",
            )
        if operation == "market.proposals.reject":
            assert params["proposal_id"] == "prop_demo_1"
            return approval_response(
                "market.proposals.reject",
                intent_id="intent_prop_reject_1",
                preview={"proposal_id": params["proposal_id"], "comment": params["comment"]},
                trace_id="trc_market_proposals_reject",
                request_id="req_market_proposals_reject",
            )
        raise AssertionError(f"Unexpected operation payload: {body}")

    with Recorder(cassette_path, mode=RecordMode.RECORD) as recorder:
        with recorder.wrap(build_client(handler)) as client:
            first_page = client.list_market_proposals(agent_id=DEFAULT_OPERATION_AGENT_ID, status="draft", limit=1)
            all_proposals = first_page.all_items()
            detail = client.get_market_proposal("prop_demo_1", agent_id=DEFAULT_OPERATION_AGENT_ID)
            created = client.create_market_proposal(
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                opportunity_id="opp_demo_1",
                proposal_kind="proposal",
                currency="USD",
                amount_minor=25000,
                proposed_terms_jsonb={"delivery_days": 7},
            )
            countered = client.counter_market_proposal(
                "prop_demo_1",
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                proposal_kind="counter",
                proposed_terms_jsonb={"delivery_days": 5},
            )
            accepted = client.accept_market_proposal(
                "prop_demo_1",
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                comment="Accept if the owner approves.",
            )
            rejected = client.reject_market_proposal(
                "prop_demo_1",
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                comment="Reject if the owner does not approve.",
            )

    with Recorder(cassette_path, mode=RecordMode.REPLAY) as recorder:
        with recorder.wrap(build_client(lambda request: (_ for _ in ()).throw(AssertionError(f"Replay should not hit transport: {request.method} {request.url}")))) as client:
            replay_page = client.list_market_proposals(agent_id=DEFAULT_OPERATION_AGENT_ID, status="draft", limit=1)
            replay_all = replay_page.all_items()
            replay_detail = client.get_market_proposal("prop_demo_1", agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_created = client.create_market_proposal(
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                opportunity_id="opp_demo_1",
                proposal_kind="proposal",
                currency="USD",
                amount_minor=25000,
                proposed_terms_jsonb={"delivery_days": 7},
            )
            replay_countered = client.counter_market_proposal(
                "prop_demo_1",
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                proposal_kind="counter",
                proposed_terms_jsonb={"delivery_days": 5},
            )
            replay_accepted = client.accept_market_proposal(
                "prop_demo_1",
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                comment="Accept if the owner approves.",
            )
            replay_rejected = client.reject_market_proposal(
                "prop_demo_1",
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                comment="Reject if the owner does not approve.",
            )

    assert [item.proposal_id for item in all_proposals] == ["prop_demo_1", "prop_demo_2"]
    assert first_page.meta.trace_id == "trc_market_proposals_list_1"
    assert detail.proposal_kind == "proposal"
    assert detail.reason_codes == ["needs_owner_review"]
    assert created.approval_required is True
    assert created.action == "market.proposals.create"
    assert created.intent_id == "intent_prop_create_1"
    assert countered.approval_snapshot_hash == "snap_intent_prop_counter_1"
    assert accepted.preview["proposal_id"] == "prop_demo_1"
    assert rejected.approval_required is True
    assert replay_all[1].proposal_kind == "counter"
    assert replay_detail.proposal_id == detail.proposal_id
    assert replay_created.intent_id == created.intent_id
    assert replay_countered.intent_id == countered.intent_id
    assert replay_accepted.intent_id == accepted.intent_id
    assert replay_rejected.intent_id == rejected.intent_id
    assert [item[2]["operation"] for item in requests] == [
        "market.proposals.list",
        "market.proposals.list",
        "market.proposals.get",
        "market.proposals.create",
        "market.proposals.counter",
        "market.proposals.accept",
        "market.proposals.reject",
    ]


def test_market_proposal_wrappers_validate_required_inputs() -> None:
    with build_client(lambda request: (_ for _ in ()).throw(AssertionError(f"Unexpected request: {request.method} {request.url}"))) as client:
        with pytest.raises(SiglumeClientError, match="proposal_id is required."):
            client.get_market_proposal("")
        with pytest.raises(SiglumeClientError, match="opportunity_id is required."):
            client.create_market_proposal(opportunity_id="")
        with pytest.raises(SiglumeClientError, match="counter_market_proposal requires at least one field besides proposal_id."):
            client.counter_market_proposal("prop_demo_1")
        with pytest.raises(SiglumeClientError, match="proposal_id is required."):
            client.accept_market_proposal("")
        with pytest.raises(SiglumeClientError, match="proposal_id is required."):
            client.reject_market_proposal("")


@pytest.mark.parametrize("me_agent_payload, expected_agent_id", [
    ({"agent_id": "agt_current"}, "agt_current"),
    ({"id": "agt_legacy"}, "agt_legacy"),
])
def test_market_proposal_wrappers_resolve_default_agent_and_surface_guarded_approval(
    me_agent_payload: dict[str, str],
    expected_agent_id: str,
) -> None:
    seen_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        if request.url.path == "/v1/me/agent" and request.method == "GET":
            return httpx.Response(200, json=envelope(me_agent_payload))
        if request.url.path == f"/v1/owner/agents/{expected_agent_id}/operations/execute" and request.method == "POST":
            body = json.loads(request.content.decode("utf-8")) if request.content else {}
            operation = body.get("operation")
            if operation == "market.proposals.list":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": expected_agent_id,
                            "message": "Market proposals loaded.",
                            "action": {"operation": operation},
                            "result": {"items": [{"proposal_id": "prop_sparse", "status": "draft"}], "next_cursor": None},
                        }
                    ),
                )
            if operation == "market.proposals.get":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": expected_agent_id,
                            "message": "Market proposal loaded.",
                            "action": {"operation": operation},
                            "result": {"proposal_id": "prop_sparse", "status": "draft"},
                        }
                    ),
                )
            if operation in {
                "market.proposals.create",
                "market.proposals.counter",
                "market.proposals.accept",
                "market.proposals.reject",
            }:
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": expected_agent_id,
                            "status": "approval_required",
                            "approval_required": True,
                            "intent_id": f"intent_{operation.replace('.', '_')}",
                            "approval_status": "pending_owner",
                            "approval_snapshot_hash": f"snap_{operation.replace('.', '_')}",
                            "message": f"{operation} requires owner approval.",
                            "action": {"type": "operation", "operation": operation},
                            "result": {"preview": {"operation": operation}},
                            "safety": {"approval_required": True},
                        }
                    ),
                )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        page = client.list_market_proposals(limit=2)
        detail = client.get_market_proposal("prop_sparse")
        created = client.create_market_proposal(opportunity_id="opp_demo_1")
        countered = client.counter_market_proposal("prop_sparse", proposal_kind="counter")
        accepted = client.accept_market_proposal("prop_sparse")
        rejected = client.reject_market_proposal("prop_sparse")

    assert page.items[0].proposal_id == "prop_sparse"
    assert detail.proposal_id == "prop_sparse"
    assert created.approval_required is True
    assert created.status == "approval_required"
    assert created.intent_id == "intent_market_proposals_create"
    assert created.preview == {"operation": "market.proposals.create"}
    assert countered.intent_id == "intent_market_proposals_counter"
    assert accepted.intent_id == "intent_market_proposals_accept"
    assert rejected.intent_id == "intent_market_proposals_reject"
    assert f"/v1/owner/agents/{expected_agent_id}/operations/execute" in seen_paths


def test_partner_and_ads_wrappers_round_trip_through_recorder(tmp_path: Path) -> None:
    requests: list[tuple[str, str, dict[str, object]]] = []
    cassette_path = tmp_path / "partner_and_ads_wrappers.json"

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        requests.append((request.method, request.url.path, body))
        if request.url.path != f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        operation = body.get("operation")
        params = body.get("params") if isinstance(body.get("params"), dict) else {}
        if operation == "partner.dashboard.get":
            assert params == {}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Partner dashboard loaded.",
                        "action": "partner_dashboard_get",
                        "result": {
                            "partner_id": "usr_partner_demo",
                            "company_name": "Demo Feeds",
                            "plan": "starter",
                            "plan_label": "Starter",
                            "month_bytes_used": 1048576,
                            "month_bytes_limit": 10485760,
                            "month_usage_pct": 10.0,
                            "total_source_items": 3,
                            "has_billing": True,
                            "has_subscription": True,
                        },
                    },
                    trace_id="trc_partner_dashboard",
                    request_id="req_partner_dashboard",
                ),
            )
        if operation == "partner.usage.get":
            assert params == {}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Partner usage loaded.",
                        "action": "partner_usage_get",
                        "result": {
                            "plan": "starter",
                            "month_bytes_used": 1048576,
                            "month_bytes_limit": 10485760,
                            "month_bytes_remaining": 9437184,
                            "month_usage_pct": 10.0,
                        },
                    },
                    trace_id="trc_partner_usage",
                    request_id="req_partner_usage",
                ),
            )
        if operation == "partner.keys.list":
            assert params == {}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Partner API keys loaded.",
                        "action": "partner_keys_list",
                        "result": {
                            "keys": [
                                {
                                    "credential_id": "cred_partner_1",
                                    "name": "Primary Feed",
                                    "key_id": "src_partner_1",
                                    "allowed_source_types": ["partner_api", "rss"],
                                    "last_used_at": "2026-04-20T08:40:00Z",
                                    "created_at": "2026-04-19T23:10:00Z",
                                    "revoked": False,
                                }
                            ]
                        },
                    },
                    trace_id="trc_partner_keys_list",
                    request_id="req_partner_keys_list",
                ),
            )
        if operation == "partner.keys.create":
            assert params == {"name": "SDK Feed", "allowed_source_types": ["rss", "partner_api"]}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Partner API key created.",
                        "action": "partner_keys_create",
                        "result": {
                            "credential_id": "cred_partner_2",
                            "name": "SDK Feed",
                            "key_id": "src_partner_2",
                            "allowed_source_types": ["rss", "partner_api"],
                            "masked_key_hint": "src_partner_2.********",
                        },
                    },
                    trace_id="trc_partner_keys_create",
                    request_id="req_partner_keys_create",
                ),
            )
        if operation == "ads.billing.get":
            assert params == {"rail": "web3"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Ads billing loaded.",
                        "action": "ads_billing_get",
                        "result": {
                            "currency": "usd",
                            "billing_mode": "web3",
                            "month_spend_jpy": 0,
                            "month_spend_usd": 12000,
                            "all_time_spend_jpy": 0,
                            "all_time_spend_usd": 54000,
                            "total_impressions": 18300,
                            "total_replies": 37,
                            "has_billing": True,
                            "has_subscription": True,
                            "balances": [{"symbol": "USDC", "amount_minor": 700000}],
                            "supported_tokens": [{"symbol": "USDC", "decimals": 6}],
                            "funding_instructions": {"network": "polygon", "memo": "fund-usdc"},
                            "wallet": {"user_wallet_id": "uw_ads_1", "smart_account_address": "0xabc"},
                            "mandate": {
                                "mandate_id": "mdt_ads_1",
                                "purpose": "ad_spend",
                                "display_currency": "USD",
                                "token_symbol": "USDC",
                                "max_amount_minor": 30000,
                                "status": "active",
                            },
                            "invoices": [{"invoice_id": "inv_ads_1", "amount_due_minor": 12000}],
                        },
                    },
                    trace_id="trc_ads_billing",
                    request_id="req_ads_billing",
                ),
            )
        if operation == "ads.billing.settle":
            assert params == {}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Ads billing settlement status loaded.",
                        "action": "ads_billing_settle",
                        "result": {
                            "status": "auto_settles",
                            "message": "Ads Web3 billing settles automatically at month end.",
                            "settles_automatically": True,
                        },
                    },
                    trace_id="trc_ads_settle",
                    request_id="req_ads_settle",
                ),
            )
        if operation == "ads.profile.get":
            assert params == {}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Ads profile loaded.",
                        "action": "ads_profile_get",
                        "result": {
                            "has_profile": True,
                            "company_name": "Demo Ads",
                            "ad_currency": "usd",
                            "has_billing": True,
                        },
                    },
                    trace_id="trc_ads_profile",
                    request_id="req_ads_profile",
                ),
            )
        if operation == "ads.campaigns.list":
            assert params == {}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Ad campaigns loaded.",
                        "action": "ads_campaigns_list",
                        "result": {
                            "campaigns": [
                                {
                                    "campaign_id": "cmp_ads_1",
                                    "name": "Spring Launch",
                                    "target_url": "https://example.com/spring-launch",
                                    "content_brief": "Promote the launch announcement.",
                                    "target_topics": ["ai", "launch"],
                                    "posting_interval_minutes": 720,
                                    "max_posts_per_day": 2,
                                    "currency": "usd",
                                    "monthly_budget_jpy": 30000,
                                    "cpm_jpy": 250,
                                    "cpr_jpy": 30,
                                    "monthly_budget_usd": 30000,
                                    "cpm_usd": 250,
                                    "cpr_usd": 30,
                                    "status": "active",
                                    "month_spend_jpy": 0,
                                    "month_spend_usd": 12000,
                                    "total_posts": 4,
                                    "total_impressions": 18300,
                                    "total_replies": 37,
                                    "next_post_at": "2026-04-20T16:00:00Z",
                                    "created_at": "2026-04-19T09:00:00Z",
                                }
                            ]
                        },
                    },
                    trace_id="trc_ads_campaigns",
                    request_id="req_ads_campaigns",
                ),
            )
        if operation == "ads.campaign_posts.list":
            assert params == {"campaign_id": "cmp_ads_1"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "message": "Ad campaign posts loaded.",
                        "action": "ads_campaign_posts_list",
                        "result": {
                            "posts": [
                                {
                                    "post_id": "pst_ads_1",
                                    "content_id": "cnt_ads_1",
                                    "cost_jpy": 0,
                                    "cost_usd": 1200,
                                    "impressions": 5000,
                                    "replies": 11,
                                    "status": "served",
                                    "created_at": "2026-04-20T07:00:00Z",
                                }
                            ]
                        },
                    },
                    trace_id="trc_ads_posts",
                    request_id="req_ads_posts",
                ),
            )
        raise AssertionError(f"Unexpected operation payload: {body}")

    with Recorder(cassette_path, mode=RecordMode.RECORD) as recorder:
        with recorder.wrap(build_client(handler)) as client:
            dashboard = client.get_partner_dashboard(agent_id=DEFAULT_OPERATION_AGENT_ID)
            usage = client.get_partner_usage(agent_id=DEFAULT_OPERATION_AGENT_ID)
            keys = client.list_partner_api_keys(agent_id=DEFAULT_OPERATION_AGENT_ID)
            created_key = client.create_partner_api_key(
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                name="SDK Feed",
                allowed_source_types=["rss", "partner_api"],
            )
            billing = client.get_ads_billing(agent_id=DEFAULT_OPERATION_AGENT_ID, rail="web3")
            settlement = client.settle_ads_billing(agent_id=DEFAULT_OPERATION_AGENT_ID)
            profile = client.get_ads_profile(agent_id=DEFAULT_OPERATION_AGENT_ID)
            campaigns = client.list_ads_campaigns(agent_id=DEFAULT_OPERATION_AGENT_ID)
            posts = client.list_ads_campaign_posts("cmp_ads_1", agent_id=DEFAULT_OPERATION_AGENT_ID)

    assert dashboard.plan == "starter"
    assert dashboard.total_source_items == 3
    assert usage.month_bytes_remaining == 9437184
    assert keys[0].key_id == "src_partner_1"
    assert keys[0].allowed_source_types == ["partner_api", "rss"]
    assert created_key.masked_key_hint == "src_partner_2.********"
    assert billing.billing_mode == "web3"
    assert billing.mandate is not None
    assert billing.mandate.mandate_id == "mdt_ads_1"
    assert billing.supported_tokens[0]["symbol"] == "USDC"
    assert settlement.settles_automatically is True
    assert profile.company_name == "Demo Ads"
    assert campaigns[0].campaign_id == "cmp_ads_1"
    assert campaigns[0].total_impressions == 18300
    assert posts[0].post_id == "pst_ads_1"
    assert posts[0].cost_usd == 1200

    with Recorder(cassette_path, mode=RecordMode.REPLAY) as recorder:
        with recorder.wrap(build_client(lambda request: (_ for _ in ()).throw(AssertionError(f"Replay should not hit transport: {request.method} {request.url}")))) as client:
            replay_dashboard = client.get_partner_dashboard(agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_usage = client.get_partner_usage(agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_keys = client.list_partner_api_keys(agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_created_key = client.create_partner_api_key(
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                name="SDK Feed",
                allowed_source_types=["rss", "partner_api"],
            )
            replay_billing = client.get_ads_billing(agent_id=DEFAULT_OPERATION_AGENT_ID, rail="web3")
            replay_settlement = client.settle_ads_billing(agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_profile = client.get_ads_profile(agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_campaigns = client.list_ads_campaigns(agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_posts = client.list_ads_campaign_posts("cmp_ads_1", agent_id=DEFAULT_OPERATION_AGENT_ID)

    assert replay_dashboard.partner_id == "usr_partner_demo"
    assert replay_usage.plan == "starter"
    assert replay_keys[0].created_at == "2026-04-19T23:10:00Z"
    assert replay_created_key.key_id == "src_partner_2"
    assert replay_billing.wallet == {"user_wallet_id": "uw_ads_1", "smart_account_address": "0xabc"}
    assert replay_settlement.status == "auto_settles"
    assert replay_profile.has_profile is True
    assert replay_campaigns[0].target_topics == ["ai", "launch"]
    assert replay_posts[0].status == "served"
    assert [item[2]["operation"] for item in requests] == [
        "partner.dashboard.get",
        "partner.usage.get",
        "partner.keys.list",
        "partner.keys.create",
        "ads.billing.get",
        "ads.billing.settle",
        "ads.profile.get",
        "ads.campaigns.list",
        "ads.campaign_posts.list",
    ]


def test_partner_and_ads_wrappers_validate_inputs_and_scrub_handle_only_key_payload() -> None:
    with build_client(lambda request: (_ for _ in ()).throw(AssertionError(f"Unexpected request: {request.method} {request.url}"))) as client:
        with pytest.raises(SiglumeClientError, match="name cannot be empty."):
            client.create_partner_api_key(agent_id=DEFAULT_OPERATION_AGENT_ID, name="  ")
        with pytest.raises(SiglumeClientError, match="allowed_source_types must be a list of strings."):
            client.create_partner_api_key(agent_id=DEFAULT_OPERATION_AGENT_ID, allowed_source_types="rss")  # type: ignore[arg-type]
        with pytest.raises(SiglumeClientError, match="allowed_source_types must contain only strings."):
            client.create_partner_api_key(agent_id=DEFAULT_OPERATION_AGENT_ID, allowed_source_types=["rss", 7])  # type: ignore[list-item]
        with pytest.raises(SiglumeClientError, match="campaign_id is required."):
            client.list_ads_campaign_posts("")

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        assert request.url.path == f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute"
        assert body["operation"] == "partner.keys.create"
        return httpx.Response(
            200,
            json=envelope(
                {
                    "agent_id": DEFAULT_OPERATION_AGENT_ID,
                    "message": "Partner API key created.",
                    "action": "partner_keys_create",
                    "result": {
                        "credential_id": "cred_partner_scrubbed",
                        "name": "Leak Test",
                        "key_id": "src_partner_scrubbed",
                        "allowed_source_types": ["rss"],
                        "masked_key_hint": "src_partner_scrubbed.********",
                        "ingest_key": "src_partner_scrubbed.super_secret",
                        "full_key": "src_partner_scrubbed.super_secret",
                    },
                }
            ),
        )

    with build_client(handler) as client:
        created = client.create_partner_api_key(
            agent_id=DEFAULT_OPERATION_AGENT_ID,
            name="Leak Test",
            allowed_source_types=["rss"],
        )

    assert created.credential_id == "cred_partner_scrubbed"
    assert created.allowed_source_types == ["rss"]
    assert created.masked_key_hint == "src_partner_scrubbed.********"
    assert not hasattr(created, "ingest_key")
    assert "ingest_key" not in created.raw
    assert "full_key" not in created.raw


def test_partner_and_ads_wrappers_resolve_default_agent_and_parse_sparse_payloads() -> None:
    requests: list[tuple[str, str, dict[str, object]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        requests.append((request.method, request.url.path, body))
        if request.url.path == "/v1/me/agent":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "id": DEFAULT_OPERATION_AGENT_ID,
                        "agent_type": "personal",
                        "name": "Owner Demo",
                    }
                ),
            )
        if request.url.path != f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        operation = body.get("operation")
        if operation == "partner.dashboard.get":
            return httpx.Response(200, json=envelope({"result": {"partner_id": "usr_sparse", "has_billing": 1, "has_subscription": 0}}))
        if operation == "partner.usage.get":
            return httpx.Response(200, json=envelope({"result": {"month_bytes_used": None, "month_bytes_limit": "1024"}}))
        if operation == "partner.keys.list":
            return httpx.Response(200, json=envelope({"result": {"keys": [None, {"credential_id": "cred_sparse"}]}}))
        if operation == "partner.keys.create":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "result": {
                            "credential_id": "cred_sparse_created",
                            "key_id": "src_sparse",
                            "masked_key_hint": "src_sparse.********",
                            "ingest_key": "src_sparse.secret",
                        }
                    }
                ),
            )
        if operation == "ads.billing.get":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "result": {
                            "billing_mode": "web3",
                            "balances": "skip",
                            "supported_tokens": "skip",
                            "funding_instructions": "skip",
                            "wallet": "skip",
                            "mandate": "skip",
                        }
                    }
                ),
            )
        if operation == "ads.billing.settle":
            return httpx.Response(200, json=envelope({"result": {"detail": "auto"}}))
        if operation == "ads.profile.get":
            return httpx.Response(200, json=envelope({"result": {"company_name": None}}))
        if operation == "ads.campaigns.list":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "result": {
                            "campaigns": [None, {"campaign_id": "cmp_sparse", "total_posts": None, "status": None}]
                        }
                    }
                ),
            )
        if operation == "ads.campaign_posts.list":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "result": {
                            "posts": [None, {"post_id": "pst_sparse", "impressions": None, "cost_usd": "1500"}]
                        }
                    }
                ),
            )
        raise AssertionError(f"Unexpected operation payload: {body}")

    with build_client(handler) as client:
        dashboard = client.get_partner_dashboard()
        usage = client.get_partner_usage(agent_id=DEFAULT_OPERATION_AGENT_ID)
        keys = client.list_partner_api_keys()
        created = client.create_partner_api_key(agent_id=DEFAULT_OPERATION_AGENT_ID)
        billing = client.get_ads_billing()
        settlement = client.settle_ads_billing(agent_id=DEFAULT_OPERATION_AGENT_ID)
        profile = client.get_ads_profile(agent_id=DEFAULT_OPERATION_AGENT_ID)
        campaigns = client.list_ads_campaigns(agent_id=DEFAULT_OPERATION_AGENT_ID)
        posts = client.list_ads_campaign_posts("cmp_sparse")

    assert dashboard.partner_id == "usr_sparse"
    assert dashboard.has_billing is True
    assert dashboard.has_subscription is False
    assert usage.month_bytes_used == 0
    assert usage.month_bytes_limit == 1024
    assert usage.plan is None
    assert keys[0].credential_id == "cred_sparse"
    assert keys[0].allowed_source_types == []
    assert created.key_id == "src_sparse"
    assert "ingest_key" not in created.raw
    assert billing.billing_mode == "web3"
    assert billing.wallet is None
    assert billing.balances == []
    assert billing.mandate is None
    assert settlement.message == "auto"
    assert settlement.settles_automatically is None
    assert profile.has_profile is False
    assert profile.ad_currency is None
    assert campaigns[0].campaign_id == "cmp_sparse"
    assert campaigns[0].total_posts == 0
    assert campaigns[0].status == "active"
    assert posts[0].post_id == "pst_sparse"
    assert posts[0].impressions == 0
    assert posts[0].cost_usd == 1500
    assert [request[1] for request in requests].count("/v1/me/agent") == 4


def test_works_wrappers_round_trip_through_owner_operation_cassette(tmp_path: Path) -> None:
    cassette_path = tmp_path / "works-roundtrip.json"
    requests: list[tuple[str, str, dict[str, object]]] = []

    categories = [
        {
            "key": "design",
            "name_ja": "デザイン",
            "name_en": "Design",
            "description_ja": "UI とブランドの制作。",
            "description_en": "UI and brand design work.",
            "icon_url": "https://cdn.example.test/works/design.png",
            "open_job_count": 5,
            "display_order": 1,
        },
        {
            "key": "frontend",
            "name_ja": "フロントエンド",
            "name_en": "Frontend",
            "description_ja": "Web アプリ実装。",
            "description_en": "Web app implementation.",
            "icon_url": "https://cdn.example.test/works/frontend.png",
            "open_job_count": 3,
            "display_order": 2,
        },
    ]
    registration = {
        "agent_id": DEFAULT_OPERATION_AGENT_ID,
        "works_registered": True,
        "tagline": "Fast prototype builder",
        "categories": ["design", "frontend"],
        "capabilities": ["prototype", "react"],
        "description": "I build and ship product prototypes quickly.",
    }
    owner_dashboard = {
        "agents": [
            {
                "id": DEFAULT_OPERATION_AGENT_ID,
                "name": "Owner Demo",
                "reputation": {"works_registered": True, "works_completed": 12},
                "capabilities": ["prototype", "react"],
            }
        ],
        "pending_pitches": [
            {
                "proposal_id": "prop_works_1",
                "need_id": "need_works_1",
                "title": "Landing page redesign",
                "title_en": "Landing page redesign",
                "status": "proposed",
            }
        ],
        "active_orders": [
            {
                "order_id": "ord_works_active_1",
                "need_id": "need_works_2",
                "title": "Build waitlist page",
                "title_en": "Build waitlist page",
                "status": "funds_locked",
            }
        ],
        "completed_orders": [
            {
                "order_id": "ord_works_done_1",
                "need_id": "need_works_3",
                "title": "Summarize invoices",
                "title_en": "Summarize invoices",
                "status": "settled",
            }
        ],
        "stats": {"total_agents": 1, "total_pending": 1, "total_active": 1},
    }
    poster_dashboard = {
        "open_jobs": [
            {
                "id": "need_open_1",
                "title": "Translate product docs",
                "title_en": "Translate product docs",
                "proposal_count": 4,
                "created_at": "2026-04-20T08:00:00Z",
            }
        ],
        "in_progress_orders": [
            {
                "order_id": "ord_poster_1",
                "need_id": "need_active_1",
                "title": "Prototype onboarding flow",
                "title_en": "Prototype onboarding flow",
                "status": "fulfillment_submitted",
                "has_deliverable": True,
                "deliverable_count": 2,
                "awaiting_buyer_action": True,
            }
        ],
        "completed_orders": [
            {
                "order_id": "ord_poster_done_1",
                "need_id": "need_done_1",
                "title": "Summarize invoices",
                "title_en": "Summarize invoices",
                "status": "settled",
                "has_deliverable": True,
                "deliverable_count": 1,
                "awaiting_buyer_action": False,
            }
        ],
        "stats": {"total_posted": 3, "total_completed": 1},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        requests.append((request.method, request.url.path, body))
        operation = body.get("operation")
        params = body.get("params") if isinstance(body.get("params"), dict) else {}
        if operation == "works.categories.list":
            assert params == {}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "status": "completed",
                        "message": "AI Works categories loaded.",
                        "action": {"operation": "works.categories.list", "status": "completed"},
                        "result": categories,
                    },
                    trace_id="trc_works_categories_list",
                    request_id="req_works_categories_list",
                ),
            )
        if operation == "works.registration.get":
            assert params == {}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "status": "completed",
                        "message": "AI Works registration loaded.",
                        "action": {"operation": "works.registration.get", "status": "completed"},
                        "result": registration,
                    },
                    trace_id="trc_works_registration_get",
                    request_id="req_works_registration_get",
                ),
            )
        if operation == "works.registration.register":
            assert params == {
                "tagline": "Fast prototype builder",
                "description": "I build and ship product prototypes quickly.",
                "categories": ["design", "frontend"],
                "capabilities": ["prototype", "react"],
            }
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "status": "completed",
                        "message": "AI Works registration updated.",
                        "action": {"operation": "works.registration.register", "status": "completed"},
                        "result": {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "works_registered": True,
                        },
                    },
                    trace_id="trc_works_registration_register",
                    request_id="req_works_registration_register",
                ),
            )
        if operation == "works.owner_dashboard.get":
            assert params == {}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "status": "completed",
                        "message": "AI Works owner dashboard loaded.",
                        "action": {"operation": "works.owner_dashboard.get", "status": "completed"},
                        "result": owner_dashboard,
                    },
                    trace_id="trc_works_owner_dashboard_get",
                    request_id="req_works_owner_dashboard_get",
                ),
            )
        if operation == "works.poster_dashboard.get":
            assert params == {}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "status": "completed",
                        "message": "AI Works poster dashboard loaded.",
                        "action": {"operation": "works.poster_dashboard.get", "status": "completed"},
                        "result": poster_dashboard,
                    },
                    trace_id="trc_works_poster_dashboard_get",
                    request_id="req_works_poster_dashboard_get",
                ),
            )
        raise AssertionError(f"Unexpected operation payload: {body}")

    with Recorder(cassette_path, mode=RecordMode.RECORD) as recorder:
        with recorder.wrap(build_client(handler)) as client:
            listed_categories = client.list_works_categories(agent_id=DEFAULT_OPERATION_AGENT_ID)
            current_registration = client.get_works_registration(agent_id=DEFAULT_OPERATION_AGENT_ID)
            registered = client.register_for_works(
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                tagline="Fast prototype builder",
                description="I build and ship product prototypes quickly.",
                categories=["design", "frontend"],
                capabilities=["prototype", "react"],
            )
            owner_view = client.get_works_owner_dashboard(agent_id=DEFAULT_OPERATION_AGENT_ID)
            poster_view = client.get_works_poster_dashboard(agent_id=DEFAULT_OPERATION_AGENT_ID)

    with Recorder(cassette_path, mode=RecordMode.REPLAY) as recorder:
        with recorder.wrap(build_client(lambda request: (_ for _ in ()).throw(AssertionError(f"Replay should not hit transport: {request.method} {request.url}")))) as client:
            replay_categories = client.list_works_categories(agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_registration = client.get_works_registration(agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_registered = client.register_for_works(
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                tagline="Fast prototype builder",
                description="I build and ship product prototypes quickly.",
                categories=["design", "frontend"],
                capabilities=["prototype", "react"],
            )
            replay_owner_view = client.get_works_owner_dashboard(agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_poster_view = client.get_works_poster_dashboard(agent_id=DEFAULT_OPERATION_AGENT_ID)

    assert [item.key for item in listed_categories] == ["design", "frontend"]
    assert listed_categories[0].open_job_count == 5
    assert current_registration.tagline == "Fast prototype builder"
    assert current_registration.categories == ["design", "frontend"]
    assert registered.works_registered is True
    assert registered.execution_status == "completed"
    assert owner_view.agents[0].agent_id == DEFAULT_OPERATION_AGENT_ID
    assert owner_view.pending_pitches[0].proposal_id == "prop_works_1"
    assert poster_view.in_progress_orders[0].awaiting_buyer_action is True
    assert poster_view.stats.total_posted == 3
    assert replay_categories[1].name_en == "Frontend"
    assert replay_registration.description == current_registration.description
    assert replay_registered.works_registered is True
    assert replay_owner_view.completed_orders[0].order_id == "ord_works_done_1"
    assert replay_poster_view.open_jobs[0].job_id == "need_open_1"
    assert [item[2]["operation"] for item in requests] == [
        "works.categories.list",
        "works.registration.get",
        "works.registration.register",
        "works.owner_dashboard.get",
        "works.poster_dashboard.get",
    ]


def test_works_wrappers_resolve_default_agent_and_surface_approval_metadata() -> None:
    requests: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        if request.url.path == "/v1/me/agent":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "id": DEFAULT_OPERATION_AGENT_ID,
                        "agent_type": "personal",
                        "name": "Owner Demo",
                    }
                ),
            )
        if request.url.path == f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute":
            body = json.loads(request.content.decode("utf-8")) if request.content else {}
            operation = body.get("operation")
            params = body.get("params") if isinstance(body.get("params"), dict) else {}
            if operation == "works.categories.list":
                assert params == {}
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "status": "completed",
                            "message": "AI Works categories loaded.",
                            "action": {"operation": "works.categories.list", "status": "completed"},
                            "result": [{"key": "design", "open_job_count": 0}],
                        }
                    ),
                )
            if operation == "works.registration.register":
                assert params == {"tagline": "Nimble design partner"}
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "status": "approval_required",
                            "approval_required": True,
                            "intent_id": "int_works_register",
                            "approval_status": "pending_owner",
                            "approval_snapshot_hash": "sha_works_register",
                            "message": "Operation works.registration.register requires approval before live execution.",
                            "action": {"operation": "works.registration.register", "status": "approval_required"},
                            "result": {
                                "preview": {
                                    "operation_name": "works.registration.register",
                                    "params": {"tagline": "Nimble design partner"},
                                }
                            },
                        }
                    ),
                )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        categories = client.list_works_categories()
        pending = client.register_for_works(tagline="Nimble design partner")
        with pytest.raises(SiglumeClientError, match="categories must contain only strings."):
            client.register_for_works(categories=["design", 1])  # type: ignore[list-item]
        with pytest.raises(SiglumeClientError, match="capabilities must be a list of strings."):
            client.register_for_works(capabilities="prototype")  # type: ignore[arg-type]

    assert categories[0].key == "design"
    assert pending.agent_id == DEFAULT_OPERATION_AGENT_ID
    assert pending.execution_status == "approval_required"
    assert pending.approval_required is True
    assert pending.intent_id == "int_works_register"
    assert pending.approval_preview["operation_name"] == "works.registration.register"
    assert requests == [
        ("GET", "/v1/me/agent"),
        ("POST", f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute"),
        ("GET", "/v1/me/agent"),
        ("POST", f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute"),
    ]


def test_installed_tool_wrappers_round_trip_owner_operation_results() -> None:
    cassette_path = ROOT / "tests" / "cassettes" / "installed-tool-wrappers.json"
    requests: list[tuple[str, str, dict[str, Any]]] = []

    tool_one = {
        "binding_id": "bind_inst_1",
        "listing_id": "lst_inst_1",
        "release_id": "rel_inst_1",
        "display_name": "Seller Search",
        "permission_class": "action",
        "binding_status": "active",
        "account_readiness": "ready",
        "settlement_mode": "embedded_wallet_charge",
        "settlement_currency": "USD",
        "settlement_network": "polygon",
        "accepted_payment_tokens": ["USDC"],
        "last_used_at": "2026-04-20T08:30:00Z",
    }
    tool_two = {
        "binding_id": "bind_inst_2",
        "listing_id": "lst_inst_2",
        "release_id": "rel_inst_2",
        "display_name": "Invoice Mailer",
        "permission_class": "read-only",
        "binding_status": "active",
        "account_readiness": "missing_connected_account",
        "settlement_mode": "free",
        "accepted_payment_tokens": [],
        "last_used_at": None,
    }
    execution = {
        "id": "int_inst_1",
        "agent_id": DEFAULT_OPERATION_AGENT_ID,
        "owner_user_id": "usr_owner_demo",
        "binding_id": "bind_inst_1",
        "release_id": "rel_inst_1",
        "source": "owner_ui",
        "goal": "Run seller search",
        "input_payload_jsonb": {"binding_id": "bind_inst_1", "query": "translation seller"},
        "plan_jsonb": {"steps": [{"tool_name": "seller_api_search"}]},
        "status": "queued",
        "approval_status": None,
        "approval_snapshot_jsonb": {},
        "metadata_jsonb": {"source": "sdk-test"},
        "queued_at": "2026-04-20T08:31:00Z",
        "created_at": "2026-04-20T08:31:00Z",
        "updated_at": "2026-04-20T08:31:00Z",
    }
    receipt = {
        "id": "rcp_inst_1",
        "intent_id": "int_inst_1",
        "agent_id": DEFAULT_OPERATION_AGENT_ID,
        "owner_user_id": "usr_owner_demo",
        "binding_id": "bind_inst_1",
        "grant_id": "grt_inst_1",
        "release_ids_jsonb": ["rel_inst_1"],
        "execution_source": "owner_http",
        "status": "completed",
        "permission_class": "action",
        "approval_status": "approved",
        "step_count": 1,
        "total_latency_ms": 1820,
        "total_billable_units": 2,
        "total_amount_usd_cents": 45,
        "summary": "Seller search completed.",
        "trace_id": "trc_inst_receipt",
        "metadata_jsonb": {"source": "sdk-test"},
        "started_at": "2026-04-20T08:31:05Z",
        "completed_at": "2026-04-20T08:31:07Z",
        "created_at": "2026-04-20T08:31:07Z",
    }
    step = {
        "id": "stp_inst_1",
        "intent_id": "int_inst_1",
        "step_id": "step_1",
        "tool_name": "seller_api_search",
        "binding_id": "bind_inst_1",
        "release_id": "rel_inst_1",
        "dry_run": False,
        "status": "completed",
        "args_hash": "hash_args_1",
        "args_preview_redacted": "{\"query\":\"translation seller\"}",
        "output_hash": "hash_output_1",
        "output_preview_redacted": "{\"matches\":3}",
        "provider_latency_ms": 910,
        "retry_count": 0,
        "connected_account_ref": "acct_google_demo",
        "metadata_jsonb": {"source": "sdk-test"},
        "created_at": "2026-04-20T08:31:06Z",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        requests.append((request.method, request.url.path, body))
        operation = body.get("operation")
        params = body.get("params") if isinstance(body.get("params"), dict) else {}
        if operation == "installed_tools.list":
            assert params == {}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "status": "completed",
                        "message": "Installed tools loaded.",
                        "action": {"operation": operation, "status": "completed"},
                        "result": [tool_one, tool_two],
                    },
                    trace_id="trc_installed_tools_list",
                    request_id="req_installed_tools_list",
                ),
            )
        if operation == "installed_tools.connection_readiness":
            assert params == {}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "status": "completed",
                        "message": "Installed tool readiness loaded.",
                        "action": {"operation": operation, "status": "completed"},
                        "result": {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "all_ready": False,
                            "bindings": {
                                "bind_inst_1": "ready",
                                "bind_inst_2": "missing_connected_account",
                            },
                        },
                    },
                    trace_id="trc_installed_tools_ready",
                    request_id="req_installed_tools_ready",
                ),
            )
        if operation == "installed_tools.binding.update_policy":
            assert params == {
                "binding_id": "bind_inst_1",
                "require_owner_approval": True,
                "allowed_tasks_jsonb": ["seller_search"],
                "metadata_jsonb": {"source": "sdk-test"},
            }
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "status": "approval_required",
                        "approval_required": True,
                        "intent_id": "ooi_inst_policy_1",
                        "approval_status": "pending",
                        "message": "Operation installed_tools.binding.update_policy requires approval before live execution.",
                        "action": {"operation": operation, "status": "approval_required"},
                        "result": {
                            "preview": {
                                "operation_name": operation,
                                "permission_class": "action",
                                "risk_level": "high",
                                "result_mode": "redacted",
                                "params": params,
                            },
                            "approval_snapshot_hash": "snap_inst_policy_1",
                        },
                        "safety": {
                            "actor_scope": "owner",
                            "permission_class": "action",
                            "risk_level": "high",
                            "result_mode": "redacted",
                            "approval_required": True,
                            "execute_mode": "guarded",
                        },
                    },
                    trace_id="trc_installed_tools_policy",
                    request_id="req_installed_tools_policy",
                ),
            )
        if operation == "installed_tools.execution.get":
            assert params == {"intent_id": "int_inst_1"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "status": "completed",
                        "message": "Installed tool execution loaded.",
                        "action": {"operation": operation, "status": "completed"},
                        "result": execution,
                    },
                    trace_id="trc_installed_tools_execution",
                    request_id="req_installed_tools_execution",
                ),
            )
        if operation == "installed_tools.receipts.list":
            assert params == {"limit": 1, "offset": 0, "status": "completed"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "status": "completed",
                        "message": "Installed tool receipts loaded.",
                        "action": {"operation": operation, "status": "completed"},
                        "result": [receipt],
                    },
                    trace_id="trc_installed_tools_receipts_list",
                    request_id="req_installed_tools_receipts_list",
                ),
            )
        if operation == "installed_tools.receipts.get":
            assert params == {"receipt_id": "rcp_inst_1"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "status": "completed",
                        "message": "Installed tool receipt loaded.",
                        "action": {"operation": operation, "status": "completed"},
                        "result": receipt,
                    },
                    trace_id="trc_installed_tools_receipt_get",
                    request_id="req_installed_tools_receipt_get",
                ),
            )
        if operation == "installed_tools.receipts.steps.get":
            assert params == {"receipt_id": "rcp_inst_1"}
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "status": "completed",
                        "message": "Installed tool receipt steps loaded.",
                        "action": {"operation": operation, "status": "completed"},
                        "result": [step],
                    },
                    trace_id="trc_installed_tools_steps",
                    request_id="req_installed_tools_steps",
                ),
            )
        raise AssertionError(f"Unexpected operation payload: {body}")

    with Recorder(cassette_path, mode=RecordMode.RECORD) as recorder:
        with recorder.wrap(build_client(handler)) as client:
            tools = client.list_installed_tools(agent_id=DEFAULT_OPERATION_AGENT_ID)
            readiness = client.get_installed_tools_connection_readiness(agent_id=DEFAULT_OPERATION_AGENT_ID)
            policy_update = client.update_installed_tool_binding_policy(
                "bind_inst_1",
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                require_owner_approval=True,
                allowed_tasks_jsonb=["seller_search"],
                metadata_jsonb={"source": "sdk-test"},
            )
            execution_record = client.get_installed_tool_execution("int_inst_1", agent_id=DEFAULT_OPERATION_AGENT_ID)
            receipts = client.list_installed_tool_receipts(
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                status="completed",
                limit=1,
            )
            receipt_record = client.get_installed_tool_receipt("rcp_inst_1", agent_id=DEFAULT_OPERATION_AGENT_ID)
            steps = client.get_installed_tool_receipt_steps("rcp_inst_1", agent_id=DEFAULT_OPERATION_AGENT_ID)

    with Recorder(cassette_path, mode=RecordMode.REPLAY) as recorder:
        with recorder.wrap(build_client(lambda request: (_ for _ in ()).throw(AssertionError(f"Replay should not hit transport: {request.method} {request.url}")))) as client:
            replay_tools = client.list_installed_tools(agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_readiness = client.get_installed_tools_connection_readiness(agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_policy_update = client.update_installed_tool_binding_policy(
                "bind_inst_1",
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                require_owner_approval=True,
                allowed_tasks_jsonb=["seller_search"],
                metadata_jsonb={"source": "sdk-test"},
            )
            replay_execution = client.get_installed_tool_execution("int_inst_1", agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_receipts = client.list_installed_tool_receipts(
                agent_id=DEFAULT_OPERATION_AGENT_ID,
                status="completed",
                limit=1,
            )
            replay_receipt = client.get_installed_tool_receipt("rcp_inst_1", agent_id=DEFAULT_OPERATION_AGENT_ID)
            replay_steps = client.get_installed_tool_receipt_steps("rcp_inst_1", agent_id=DEFAULT_OPERATION_AGENT_ID)

    assert [item.binding_id for item in tools] == ["bind_inst_1", "bind_inst_2"]
    assert readiness.all_ready is False
    assert readiness.bindings["bind_inst_2"] == "missing_connected_account"
    assert policy_update.approval_required is True
    assert policy_update.status == "approval_required"
    assert policy_update.intent_id == "ooi_inst_policy_1"
    assert policy_update.approval_snapshot_hash == "snap_inst_policy_1"
    assert policy_update.policy is None
    assert policy_update.preview["operation_name"] == "installed_tools.binding.update_policy"
    assert execution_record.intent_id == "int_inst_1"
    assert execution_record.input_payload_jsonb["query"] == "translation seller"
    assert receipts[0].receipt_id == "rcp_inst_1"
    assert receipt_record.summary == "Seller search completed."
    assert steps[0].tool_name == "seller_api_search"
    assert replay_tools[0].display_name == "Seller Search"
    assert replay_readiness.bindings["bind_inst_1"] == "ready"
    assert replay_policy_update.intent_id == policy_update.intent_id
    assert replay_execution.status == "queued"
    assert replay_receipts[0].step_count == 1
    assert replay_receipt.receipt_id == receipt_record.receipt_id
    assert replay_steps[0].step_id == "step_1"
    assert [item[2]["operation"] for item in requests] == [
        "installed_tools.list",
        "installed_tools.connection_readiness",
        "installed_tools.binding.update_policy",
        "installed_tools.execution.get",
        "installed_tools.receipts.list",
        "installed_tools.receipts.get",
        "installed_tools.receipts.steps.get",
    ]


def test_installed_tool_wrappers_validate_required_inputs() -> None:
    with build_client(lambda request: (_ for _ in ()).throw(AssertionError(f"Unexpected request: {request.method} {request.url}"))) as client:
        with pytest.raises(SiglumeClientError, match="binding_id is required."):
            client.update_installed_tool_binding_policy("")
        with pytest.raises(SiglumeClientError, match="requires at least one policy field to update."):
            client.update_installed_tool_binding_policy("bind_inst_1")
        with pytest.raises(SiglumeClientError, match="intent_id is required."):
            client.get_installed_tool_execution("")
        with pytest.raises(SiglumeClientError, match="receipt_id is required."):
            client.get_installed_tool_receipt("")
        with pytest.raises(SiglumeClientError, match="receipt_id is required."):
            client.get_installed_tool_receipt_steps("")


def test_installed_tool_wrappers_resolve_default_agent_and_parse_sparse_payloads() -> None:
    requests: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        if request.url.path == "/v1/me/agent":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "agent_id": DEFAULT_OPERATION_AGENT_ID,
                        "agent_type": "personal",
                        "name": "Owner Demo",
                    }
                ),
            )
        if request.url.path == f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute":
            body = json.loads(request.content.decode("utf-8")) if request.content else {}
            operation = body.get("operation")
            if operation == "installed_tools.list":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "status": "completed",
                            "message": "Installed tools loaded.",
                            "result": [{"binding_id": "bind_sparse", "listing_id": "lst_sparse"}],
                        }
                    ),
                )
            if operation == "installed_tools.connection_readiness":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "status": "completed",
                            "message": "Installed tool readiness loaded.",
                            "result": {"agent_id": DEFAULT_OPERATION_AGENT_ID, "bindings": {"bind_sparse": "ready"}},
                        }
                    ),
                )
            if operation == "installed_tools.execution.get":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "status": "completed",
                            "message": "Installed tool execution loaded.",
                            "result": {"id": "int_sparse", "agent_id": DEFAULT_OPERATION_AGENT_ID, "status": "queued"},
                        }
                    ),
                )
            if operation == "installed_tools.receipts.get":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "status": "completed",
                            "message": "Installed tool receipt loaded.",
                            "result": {
                                "id": "rcp_sparse",
                                "intent_id": "int_sparse",
                                "agent_id": DEFAULT_OPERATION_AGENT_ID,
                                "status": "completed",
                            },
                        }
                    ),
                )
            if operation == "installed_tools.receipts.steps.get":
                return httpx.Response(
                    200,
                    json=envelope(
                        {
                            "agent_id": DEFAULT_OPERATION_AGENT_ID,
                            "status": "completed",
                            "message": "Installed tool receipt steps loaded.",
                            "result": [{"id": "stp_sparse", "intent_id": "int_sparse", "step_id": "step_sparse", "tool_name": "seller_api_search"}],
                        }
                    ),
                )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with build_client(handler) as client:
        tools = client.list_installed_tools()
        readiness = client.get_installed_tools_connection_readiness()
        execution = client.get_installed_tool_execution("int_sparse")
        receipt = client.get_installed_tool_receipt("rcp_sparse")
        steps = client.get_installed_tool_receipt_steps("rcp_sparse")

    assert tools[0].binding_id == "bind_sparse"
    assert tools[0].accepted_payment_tokens == []
    assert readiness.all_ready is True
    assert readiness.bindings == {"bind_sparse": "ready"}
    assert execution.intent_id == "int_sparse"
    assert execution.input_payload_jsonb == {}
    assert receipt.receipt_id == "rcp_sparse"
    assert receipt.metadata_jsonb == {}
    assert steps[0].step_receipt_id == "stp_sparse"
    assert steps[0].metadata_jsonb == {}
    assert requests == [
        ("GET", "/v1/me/agent"),
        ("POST", f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute"),
        ("GET", "/v1/me/agent"),
        ("POST", f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute"),
        ("GET", "/v1/me/agent"),
        ("POST", f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute"),
        ("GET", "/v1/me/agent"),
        ("POST", f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute"),
        ("GET", "/v1/me/agent"),
        ("POST", f"/v1/owner/agents/{DEFAULT_OPERATION_AGENT_ID}/operations/execute"),
    ]
