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
    PersistenceMode,
    PersistencePolicy,
    PriceModel,
    RegistrationConfirmation,
    RegistrationQuality,
    ListingCurrency,
    SiglumeAPIError,
    SiglumeClient,
    SiglumeClientError,
    StoreVertical,
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


def test_registration_confirmation_positional_order_is_compatible() -> None:
    quality = RegistrationQuality(overall_score=90, grade="A")
    confirmation = RegistrationConfirmation(
        "lst_123",
        "active",
        {"release_status": "published"},
        quality,
    )

    assert confirmation.release == {"release_status": "published"}
    assert confirmation.quality is quality
    assert confirmation.visibility is None


def build_manifest() -> AppManifest:
    return AppManifest(
        capability_key="price-compare-helper",
        name="Price Compare Helper",
        job_to_be_done="Compare retailer prices for a product and return the best current offer.",
        category=AppCategory.COMMERCE,
        store_vertical=StoreVertical.GAME,
        permission_class=PermissionClass.READ_ONLY,
        approval_mode=ApprovalMode.AUTO,
        dry_run_supported=True,
        required_connected_accounts=[],
        price_model=PriceModel.FREE,
        currency="USD",
        allow_free_trial=False,
        jurisdiction="US",
        short_description="Compare retailer prices before buying.",
        description="Compare current retailer offers, return ranked trade-offs, and help the owner decide where to buy.",
        docs_url="https://docs.example.com/price-compare",
        support_contact="support@example.com",
        seller_homepage_url="https://example.com",
        seller_social_url="https://x.com/example",
        example_prompts=["Compare prices for Sony WH-1000XM5."],
    )


SAVE_DATA_SCHEMA = {
    "type": "object",
    "properties": {
        "agent": {"type": "object"},
        "avatar_config": {"type": "object"},
        "replays": {"type": "array"},
    },
    "required": ["agent"],
}


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


def test_mcp_router_client_methods_use_owner_api_routes() -> None:
    requests: list[tuple[str, str, dict[str, object]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        requests.append((request.method, request.url.path, body))
        assert request.headers["Authorization"] == "Bearer sig_test_key"
        if request.method == "GET" and request.url.path == "/v1/mcp-router/account":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "user_id": "usr_provider",
                        "email": "provider@example.com",
                        "display_name": "Provider",
                        "plan": "free",
                        "status": "active",
                    }
                ),
            )
        if request.method == "GET" and request.url.path == "/v1/mcp-router/servers":
            return httpx.Response(
                200,
                json=envelope({"items": [{"id": "srv_1", "name": "Provider MCP"}]}),
            )
        if request.method == "POST" and request.url.path == "/v1/mcp-router/servers":
            assert body == {
                "name": "Provider MCP",
                "base_url": "https://provider.example/mcp",
                "upstream_auth_mode": "bearer",
                "monetization": "free",
                "currency": "USD",
                "jurisdiction": "US",
                "bearer_secret": "upstream-secret",
            }
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "id": "srv_1",
                        "name": "Provider MCP",
                        "base_url": "https://provider.example/mcp",
                        "status": "active",
                    }
                ),
            )
        if request.method == "DELETE" and request.url.path == "/v1/mcp-router/servers/srv_1":
            return httpx.Response(200, json=envelope({"id": "srv_1", "status": "disabled"}))
        return httpx.Response(404, json=envelope({"path": request.url.path}))

    with build_client(handler) as client:
        account = client.get_mcp_router_account()
        assert account["email"] == "provider@example.com"

        servers = client.list_mcp_router_servers()
        assert servers == [{"id": "srv_1", "name": "Provider MCP"}]

        registered = client.register_mcp_router_server(
            name="Provider MCP",
            base_url="https://provider.example/mcp",
            upstream_auth_mode="bearer",
            bearer_secret="upstream-secret",
        )
        assert registered["id"] == "srv_1"
        assert "bearer_secret" not in registered

        unregistered = client.unregister_mcp_router_server("srv_1")
        assert unregistered["status"] == "disabled"

    assert [item[:2] for item in requests] == [
        ("GET", "/v1/mcp-router/account"),
        ("GET", "/v1/mcp-router/servers"),
        ("POST", "/v1/mcp-router/servers"),
        ("DELETE", "/v1/mcp-router/servers/srv_1"),
    ]


def test_auto_register_and_confirm_registration_return_typed_objects(tmp_path: Path) -> None:
    manifest = build_manifest()
    tool_manual = build_tool_manual()
    runtime_validation = build_runtime_validation()
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
            assert body["description"] == manifest.description
            assert body["tool_manual"]["tool_name"] == tool_manual.tool_name
            assert body["runtime_validation"]["invoke_url"] == runtime_validation["invoke_url"]
            assert "oauth_credentials" not in body
            assert body["publisher_identity"]["documentation_url"] == manifest.docs_url
            assert body["legal"]["publisher_identity"]["support_contact"] == manifest.support_contact
            assert body["publisher_identity"]["seller_homepage_url"] == manifest.seller_homepage_url
            assert body["publisher_identity"]["seller_social_url"] == manifest.seller_social_url
            assert body["jurisdiction"] == manifest.jurisdiction
            assert body["store_vertical"] == "game"
            assert body["currency"] == "USD"
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
                        "review_url": "/owner/publish?listing=lst_123",
                    }
                ),
            )

        if request.url.path == "/v1/market/capabilities/lst_123/confirm-auto-register":
            assert body["approved"] is True
            assert body["visibility"] == "public"
            assert "overrides" not in body
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "listing_id": "lst_123",
                        "status": "active",
                        "visibility": "public",
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
            )
            replay_confirmation = client.confirm_registration(replay_receipt.listing_id)

    assert receipt.listing_id == "lst_123"
    assert receipt.trace_id == "trc_test"
    assert receipt.registration_mode == "upgrade"
    assert receipt.listing_status == "active"
    assert confirmation.listing_id == "lst_123"
    assert confirmation.status == "active"
    assert confirmation.visibility == "public"
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


def test_confirm_registration_accepts_private_visibility() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        assert request.url.path == "/v1/market/capabilities/lst_123/confirm-auto-register"
        assert body == {"approved": True, "visibility": "private"}
        return httpx.Response(
            200,
            json=envelope(
                {
                    "listing_id": "lst_123",
                    "status": "hidden",
                    "visibility": "private",
                    "message": "Listing confirmed privately.",
                    "checklist": {"docs_url": True},
                    "release": {"release_id": "rel_123", "release_status": "published"},
                    "quality": {"overall_score": 88, "grade": "A", "issues": [], "improvement_suggestions": []},
                }
            ),
        )

    with build_client(handler) as client:
        confirmation = client.confirm_registration("lst_123", visibility="private")

    assert confirmation.status == "hidden"
    assert confirmation.visibility == "private"
    assert confirmation.release["release_id"] == "rel_123"


def test_confirm_registration_rejects_invalid_visibility() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Validation should fail before transport: {request.method} {request.url}")

    with build_client(handler) as client:
        with pytest.raises(SiglumeClientError, match="visibility must be one of"):
            client.confirm_registration("lst_123", visibility="team")  # type: ignore[arg-type]



def test_app_manifest_requires_explicit_listing_currency() -> None:
    with pytest.raises(ValueError, match="AppManifest.currency is REQUIRED"):
        AppManifest(
            capability_key="price-compare-helper",
            name="Price Compare Helper",
            job_to_be_done="Compare prices.",
            category=AppCategory.COMMERCE,
            store_vertical=StoreVertical.API,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",
        )


def test_app_manifest_normalizes_jpy_listing_currency() -> None:
    manifest = AppManifest(
        capability_key="price-compare-helper",
        name="Price Compare Helper",
        job_to_be_done="Compare prices.",
        category=AppCategory.COMMERCE,
        store_vertical=StoreVertical.API,
        permission_class=PermissionClass.READ_ONLY,
        approval_mode=ApprovalMode.AUTO,
        dry_run_supported=True,
        required_connected_accounts=[],
        price_model=PriceModel.SUBSCRIPTION,
        price_value_minor=1200,
        currency="jpy",
        allow_free_trial=False,
        jurisdiction="JP",
    )

    assert manifest.currency == ListingCurrency.JPY


def test_app_manifest_rejects_jpy_operation_price_below_minimum() -> None:
    with pytest.raises(ValueError, match="at least 15"):
        AppManifest(
            capability_key="x-poster",
            name="X Poster",
            job_to_be_done="Post approved social updates.",
            category=AppCategory.COMMUNICATION,
            store_vertical=StoreVertical.API,
            permission_class=PermissionClass.ACTION,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.PER_ACTION,
            price_value_minor=0,
            pricing_plan={
                "currency": "JPY",
                "items": [{"key": "text_post", "label": "Text post", "price_minor": 5}],
            },
            currency="JPY",
            allow_free_trial=False,
            jurisdiction="JP",
        )


def test_app_manifest_accepts_free_and_minimum_jpy_operation_prices() -> None:
    manifest = AppManifest(
        capability_key="x-poster",
        name="X Poster",
        job_to_be_done="Post approved social updates.",
        category=AppCategory.COMMUNICATION,
        store_vertical=StoreVertical.API,
        permission_class=PermissionClass.ACTION,
        approval_mode=ApprovalMode.ALWAYS_ASK,
        dry_run_supported=True,
        required_connected_accounts=[],
        price_model=PriceModel.PER_ACTION,
        price_value_minor=0,
        pricing_plan={
            "currency": "JPY",
            "items": [
                {"key": "dry_run", "label": "Dry run", "price_minor": 0},
                {"key": "text_post", "label": "Text post", "price_minor": 15},
            ],
        },
        currency="JPY",
        allow_free_trial=False,
        jurisdiction="JP",
    )

    assert manifest.pricing_plan["items"][1]["price_minor"] == 15


def test_game_manifest_with_save_persistence_requires_save_data_schema() -> None:
    with pytest.raises(ValueError, match="persistence.save_data_schema is REQUIRED"):
        AppManifest(
            capability_key="arena-game",
            name="Arena Game",
            job_to_be_done="Play a persistent API game.",
            category=AppCategory.OTHER,
            store_vertical=StoreVertical.GAME,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            currency="USD",
            allow_free_trial=False,
            jurisdiction="US",
            persistence=PersistencePolicy(mode="platform"),
        )


def test_game_manifest_accepts_save_data_schema_for_save_persistence() -> None:
    manifest = AppManifest(
        capability_key="arena-game",
        name="Arena Game",
        job_to_be_done="Play a persistent API game.",
        category=AppCategory.OTHER,
        store_vertical=StoreVertical.GAME,
        permission_class=PermissionClass.READ_ONLY,
        approval_mode=ApprovalMode.AUTO,
        dry_run_supported=True,
        required_connected_accounts=[],
        price_model=PriceModel.FREE,
        currency="USD",
        allow_free_trial=False,
        jurisdiction="US",
        persistence=PersistencePolicy(mode="platform", save_data_schema=SAVE_DATA_SCHEMA),
    )

    assert manifest.persistence["save_data_schema"] == SAVE_DATA_SCHEMA


def test_game_manifest_rejects_oversized_save_data_schema() -> None:
    oversized_schema = {
        "type": "object",
        "properties": {
            "agent": {"type": "object", "description": "x" * 8200},
        },
        "required": ["agent"],
    }

    with pytest.raises(ValueError, match="save_data_schema must be at most 8192 bytes"):
        AppManifest(
            capability_key="arena-game",
            name="Arena Game",
            job_to_be_done="Play a persistent API game.",
            category=AppCategory.OTHER,
            store_vertical=StoreVertical.GAME,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            currency="USD",
            allow_free_trial=False,
            jurisdiction="US",
            persistence=PersistencePolicy(mode="platform", save_data_schema=oversized_schema),
        )


def test_api_manifest_does_not_require_save_data_schema() -> None:
    manifest = AppManifest(
        capability_key="normal-api",
        name="Normal API",
        job_to_be_done="Return non-game data.",
        category=AppCategory.OTHER,
        store_vertical=StoreVertical.API,
        permission_class=PermissionClass.READ_ONLY,
        approval_mode=ApprovalMode.AUTO,
        dry_run_supported=True,
        required_connected_accounts=[],
        price_model=PriceModel.FREE,
        currency="USD",
        allow_free_trial=False,
        jurisdiction="US",
        persistence=PersistencePolicy(mode="platform"),
    )

    assert manifest.persistence["mode"] == "platform"


def test_mapping_persistence_accepts_enum_mode() -> None:
    manifest = AppManifest(
        capability_key="arena-game",
        name="Arena Game",
        job_to_be_done="Play a persistent API game.",
        category=AppCategory.OTHER,
        store_vertical=StoreVertical.GAME,
        permission_class=PermissionClass.READ_ONLY,
        approval_mode=ApprovalMode.AUTO,
        dry_run_supported=True,
        required_connected_accounts=[],
        price_model=PriceModel.FREE,
        currency="USD",
        allow_free_trial=False,
        jurisdiction="US",
        persistence={"mode": PersistenceMode.PLATFORM, "save_data_schema": SAVE_DATA_SCHEMA},
    )

    assert manifest.persistence["mode"] == "platform"


def test_auto_register_dict_manifest_requires_game_save_data_schema() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Validation should fail before transport: {request.method} {request.url}")

    manifest = {
        "capability_key": "arena-game",
        "name": "Arena Game",
        "job_to_be_done": "Play a persistent API game.",
        "category": "other",
        "store_vertical": "game",
        "permission_class": "read-only",
        "approval_mode": "auto",
        "dry_run_supported": True,
        "required_connected_accounts": [],
        "price_model": "free",
        "currency": "USD",
        "allow_free_trial": False,
        "jurisdiction": "US",
        "example_prompts": ["Start a run.", "Load my save."],
    }
    manifest["persistence"] = {"mode": "platform"}

    with build_client(handler) as client:
        with pytest.raises(SiglumeClientError, match="persistence.save_data_schema is required"):
            client.auto_register(manifest, build_tool_manual())


def test_auto_register_dict_manifest_rejects_oversized_save_data_schema() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Validation should fail before transport: {request.method} {request.url}")

    manifest = {
        "capability_key": "arena-game",
        "name": "Arena Game",
        "job_to_be_done": "Play a persistent API game.",
        "category": "other",
        "store_vertical": "game",
        "permission_class": "read-only",
        "approval_mode": "auto",
        "dry_run_supported": True,
        "required_connected_accounts": [],
        "price_model": "free",
        "currency": "USD",
        "allow_free_trial": False,
        "jurisdiction": "US",
        "example_prompts": ["Start a run.", "Load my save."],
        "persistence": {
            "mode": "platform",
            "save_data_schema": {
                "type": "object",
                "properties": {"agent": {"type": "object", "description": "x" * 8200}},
                "required": ["agent"],
            },
        },
    }

    with build_client(handler) as client:
        with pytest.raises(SiglumeClientError, match="save_data_schema must be at most 8192 bytes"):
            client.auto_register(manifest, build_tool_manual())


def test_auto_register_dict_manifest_rejects_jpy_operation_price_below_minimum() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Validation should fail before transport: {request.method} {request.url}")

    manifest = {
        "capability_key": "x-poster",
        "name": "X Poster",
        "job_to_be_done": "Post approved social updates.",
        "category": "communication",
        "store_vertical": "api",
        "permission_class": "action",
        "approval_mode": "always-ask",
        "dry_run_supported": True,
        "required_connected_accounts": [],
        "price_model": "per_action",
        "price_value_minor": 0,
        "pricing_plan": {
            "currency": "JPY",
            "items": [{"key": "text_post", "label": "Text post", "price_minor": 5}],
        },
        "currency": "JPY",
        "allow_free_trial": False,
        "jurisdiction": "JP",
        "example_prompts": ["Post this approved draft.", "Create a dry-run preview."],
    }

    with build_client(handler) as client:
        with pytest.raises(SiglumeClientError, match="at least 15"):
            client.auto_register(manifest, build_tool_manual())


def test_auto_register_rejects_listing_text_over_limits() -> None:
    client = build_client(lambda request: httpx.Response(500, json={}))
    manifest = build_manifest()
    manifest.short_description = "x" * 61

    with pytest.raises(SiglumeClientError, match="short_description.*60"):
        client.auto_register(manifest, build_tool_manual())

    manifest = build_manifest()
    manifest.job_to_be_done = "x" * 241
    with pytest.raises(SiglumeClientError, match="job_to_be_done.*240"):
        client.auto_register(manifest, build_tool_manual())

    manifest = build_manifest()
    manifest.description = "x" * 1001
    with pytest.raises(SiglumeClientError, match="description.*1000"):
        client.auto_register(manifest, build_tool_manual())


def test_auto_register_dict_manifest_accepts_enum_persistence_mode() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content.decode()))
        return httpx.Response(201, json=envelope({"listing_id": "lst_game", "status": "draft"}))

    manifest = {
        "capability_key": "arena-game",
        "name": "Arena Game",
        "job_to_be_done": "Play a persistent API game.",
        "category": "other",
        "store_vertical": "game",
        "permission_class": "read-only",
        "approval_mode": "auto",
        "dry_run_supported": True,
        "required_connected_accounts": [],
        "price_model": "free",
        "currency": "USD",
        "allow_free_trial": False,
        "jurisdiction": "US",
        "example_prompts": ["Start a run.", "Load my save."],
        "persistence": {"mode": PersistenceMode.PLATFORM, "save_data_schema": SAVE_DATA_SCHEMA},
    }

    with build_client(handler) as client:
        client.auto_register(manifest, build_tool_manual())

    assert captured["persistence"]["mode"] == "platform"


def test_app_manifest_requires_explicit_free_trial_choice() -> None:
    with pytest.raises(ValueError, match="AppManifest.allow_free_trial is REQUIRED"):
        AppManifest(
            capability_key="price-compare-helper",
            name="Price Compare Helper",
            job_to_be_done="Compare prices.",
            category=AppCategory.COMMERCE,
            store_vertical=StoreVertical.API,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            currency="USD",
            jurisdiction="US",
        )


def test_app_manifest_rejects_out_of_range_free_trial_duration() -> None:
    with pytest.raises(ValueError, match="free_trial_duration_days must be between 1 and 90"):
        AppManifest(
            capability_key="price-compare-helper",
            name="Price Compare Helper",
            job_to_be_done="Compare prices.",
            category=AppCategory.COMMERCE,
            store_vertical=StoreVertical.API,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.SUBSCRIPTION,
            price_value_minor=1200,
            currency="USD",
            allow_free_trial=True,
            free_trial_duration_days=200,
            jurisdiction="US",
        )
def test_auto_register_hoists_input_form_spec_from_tool_manual() -> None:
    manifest = build_manifest()
    tool_manual = build_tool_manual().to_dict()
    input_form_spec = {
        "version": "1.0",
        "title": "Wallet lookup",
        "fields": [
            {
                "key": "wallet_address",
                "type": "text",
                "label": "Wallet address",
                "required": True,
            }
        ],
    }
    tool_manual["input_form_spec"] = input_form_spec

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/market/capabilities/auto-register"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["input_form_spec"] == input_form_spec
        assert "input_form_spec" not in payload["tool_manual"]
        return httpx.Response(
            201,
            json=envelope(
                {
                    "listing_id": "lst_form",
                    "status": "draft",
                    "auto_manifest": {"capability_key": manifest.capability_key},
                    "confidence": {},
                }
            ),
        )

    with build_client(handler) as client:
        receipt = client.auto_register(
            manifest,
            tool_manual,
            source_url="https://github.com/example/wallet",
            runtime_validation=build_runtime_validation(),
        )

    assert receipt.listing_id == "lst_form"


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
        support_case = client.create_support_case("Missing receipt", "Please investigate the missing receipt.", trace_id="trc_support")
        support_cases = client.list_support_cases()
        review = client.submit_review("lst_1")

    assert portal.apps[0].capability_key == "price-compare-helper"
    assert sandbox.session_id == "ses_123"
    assert grants.items[0].grant_status == "active"
    assert binding.binding.binding_status == "active"
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
