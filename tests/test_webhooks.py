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
    InMemoryWebhookDedupe,
    SiglumeClient,
    SiglumeClientError,
    SiglumeWebhookError,
    SiglumeWebhookPayloadError,
    SiglumeWebhookSignatureError,
    WebhookHandler,
    build_webhook_signature_header,
    parse_webhook_delivery,
    parse_webhook_event,
    parse_webhook_subscription,
    verify_webhook_signature,
)


def build_event(event_type: str = "subscription.created") -> dict[str, object]:
    return {
        "id": "evt_demo_123",
        "type": event_type,
        "api_version": "2026-04-20",
        "occurred_at": "2026-04-20T12:00:00Z",
        "idempotency_key": "evt_demo_123",
        "trace_id": "trc_demo_123",
        "data": {
            "subscription_id": "sub_demo_123",
            "access_grant_id": "grant_demo_123",
            "listing_id": "lst_demo_123",
            "capability_key": "currency-converter-v2",
            "currency": "USD",
            "amount_minor": 1200,
        },
    }


def envelope(data, *, trace_id: str = "trc_webhook", request_id: str = "req_webhook") -> dict[str, object]:
    return {
        "data": data,
        "meta": {"trace_id": trace_id, "request_id": request_id},
        "error": None,
    }


def test_verify_webhook_signature_round_trip() -> None:
    event = build_event()
    raw_body = json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    signature_header = build_webhook_signature_header(
        "whsec_test_secret",
        raw_body,
        timestamp=1713571200,
    )

    verification = verify_webhook_signature(
        "whsec_test_secret",
        raw_body,
        signature_header,
        now=1713571200,
    )
    parsed = parse_webhook_event(event)

    assert verification.timestamp == 1713571200
    assert parsed.type == "subscription.created"
    assert parsed.data["subscription_id"] == "sub_demo_123"


def test_webhook_handler_dispatches_once_and_marks_duplicate() -> None:
    event = build_event()
    raw_body = json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    signature_header = build_webhook_signature_header(
        "whsec_test_secret",
        raw_body,
        timestamp=1713571200,
    )
    seen: list[str] = []
    handler = WebhookHandler(
        signing_secret="whsec_test_secret",
        deduper=InMemoryWebhookDedupe(ttl_seconds=600),
    )

    @handler.on("subscription.created")
    def on_created(event) -> None:
        seen.append(str(event.data.get("subscription_id") or ""))

    first = handler.handle(
        raw_body,
        {
            "Siglume-Signature": signature_header,
            "Siglume-Event-Id": event["id"],
            "Siglume-Event-Type": event["type"],
        },
        now=1713571200,
    )
    second = handler.handle(
        raw_body,
        {
            "Siglume-Signature": signature_header,
            "Siglume-Event-Id": event["id"],
            "Siglume-Event-Type": event["type"],
        },
        now=1713571200,
    )

    assert first.duplicate is False
    assert second.duplicate is True
    assert seen == ["sub_demo_123"]


def test_webhook_handler_rejects_stale_timestamp() -> None:
    event = build_event()
    raw_body = json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    signature_header = build_webhook_signature_header(
        "whsec_test_secret",
        raw_body,
        timestamp=1713571200,
    )
    handler = WebhookHandler(signing_secret="whsec_test_secret")

    with pytest.raises(SiglumeWebhookSignatureError, match="outside the allowed tolerance"):
        handler.handle(raw_body, {"Siglume-Signature": signature_header}, now=1713571801)


def test_webhook_handler_rejects_header_mismatch() -> None:
    event = build_event()
    raw_body = json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    signature_header = build_webhook_signature_header(
        "whsec_test_secret",
        raw_body,
        timestamp=1713571200,
    )
    handler = WebhookHandler(signing_secret="whsec_test_secret")

    with pytest.raises(SiglumeWebhookPayloadError, match="Event-Type header did not match"):
        handler.handle(
            raw_body,
            {
                "Siglume-Signature": signature_header,
                "Siglume-Event-Id": event["id"],
                "Siglume-Event-Type": "payment.failed",
            },
            now=1713571200,
        )


def test_webhook_handler_rejects_unknown_registration() -> None:
    handler = WebhookHandler(signing_secret="whsec_test_secret")

    with pytest.raises(SiglumeWebhookError, match="Unsupported Siglume webhook event type"):
        handler.on("unknown.event")  # type: ignore[arg-type]


def test_parse_webhook_subscription_and_delivery_records() -> None:
    subscription = parse_webhook_subscription(
        {
            "id": "whsub_123",
            "owner_user_id": "usr_123",
            "callback_url": "https://hooks.example.test/siglume",
            "status": "active",
            "event_types": ["subscription.created"],
            "signing_secret_hint": "abcd1234",
            "metadata": {"env": "test"},
        }
    )
    delivery = parse_webhook_delivery(
        {
            "id": "whdel_123",
            "subscription_id": "whsub_123",
            "event_id": "evt_demo_123",
            "event_type": "subscription.created",
            "idempotency_key": "evt_demo_123",
            "callback_url": "https://hooks.example.test/siglume",
            "delivery_status": "delivered",
            "attempt_count": 1,
            "request_headers": {"siglume-signature": "t=1,v1=abc"},
            "request_body": {"id": "evt_demo_123"},
            "response_headers": {"x-mock": "ok"},
        }
    )

    assert subscription.subscription_id == "whsub_123"
    assert subscription.metadata["env"] == "test"
    assert delivery.delivery_id == "whdel_123"
    assert delivery.delivery_status == "delivered"


def test_siglume_client_webhook_lifecycle_methods_return_typed_records() -> None:
    event = build_event("payment.succeeded")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/market/webhooks/subscriptions" and request.method == "POST":
            return httpx.Response(
                201,
                json=envelope(
                    {
                        "id": "whsub_123",
                        "owner_user_id": "usr_123",
                        "callback_url": "https://hooks.example.test/siglume",
                        "status": "active",
                        "event_types": ["payment.succeeded"],
                        "signing_secret_hint": "abcd1234",
                        "signing_secret": "whsec_live_123",
                        "metadata": {"env": "test"},
                    }
                ),
            )
        if request.url.path == "/v1/market/webhooks/subscriptions" and request.method == "GET":
            return httpx.Response(
                200,
                json=envelope(
                    [
                        {
                            "id": "whsub_123",
                            "owner_user_id": "usr_123",
                            "callback_url": "https://hooks.example.test/siglume",
                            "status": "active",
                            "event_types": ["payment.succeeded"],
                            "metadata": {"env": "test"},
                        }
                    ]
                ),
            )
        if request.url.path == "/v1/market/webhooks/subscriptions/whsub_123":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "id": "whsub_123",
                        "owner_user_id": "usr_123",
                        "callback_url": "https://hooks.example.test/siglume",
                        "status": "active",
                        "event_types": ["payment.succeeded"],
                        "metadata": {"env": "test"},
                    }
                ),
            )
        if request.url.path == "/v1/market/webhooks/subscriptions/whsub_123/rotate-secret":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "id": "whsub_123",
                        "owner_user_id": "usr_123",
                        "callback_url": "https://hooks.example.test/siglume",
                        "status": "active",
                        "event_types": ["payment.succeeded"],
                        "signing_secret_hint": "rotated12",
                        "signing_secret": "whsec_rotated_123",
                        "metadata": {"env": "test"},
                    }
                ),
            )
        if request.url.path.endswith("/pause") or request.url.path.endswith("/resume"):
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "id": "whsub_123",
                        "owner_user_id": "usr_123",
                        "callback_url": "https://hooks.example.test/siglume",
                        "status": "paused" if request.url.path.endswith("/pause") else "active",
                        "event_types": ["payment.succeeded"],
                        "metadata": {"env": "test"},
                    }
                ),
            )
        if request.url.path == "/v1/market/webhooks/deliveries":
            return httpx.Response(
                200,
                json=envelope(
                    [
                        {
                            "id": "whdel_123",
                            "subscription_id": "whsub_123",
                            "event_id": "evt_demo_123",
                            "event_type": "payment.succeeded",
                            "idempotency_key": "evt_demo_123",
                            "callback_url": "https://hooks.example.test/siglume",
                            "delivery_status": "delivered",
                            "attempt_count": 1,
                            "request_headers": {"siglume-signature": "t=1,v1=abc"},
                            "request_body": event,
                            "response_headers": {"x-mock": "ok"},
                        }
                    ]
                ),
            )
        if request.url.path == "/v1/market/webhooks/deliveries/whdel_123/redeliver":
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "id": "whdel_123",
                        "subscription_id": "whsub_123",
                        "event_id": "evt_demo_123",
                        "event_type": "payment.succeeded",
                        "idempotency_key": "evt_demo_123",
                        "callback_url": "https://hooks.example.test/siglume",
                        "delivery_status": "delivered",
                        "attempt_count": 2,
                        "request_headers": {"siglume-signature": "t=1,v1=abc"},
                        "request_body": event,
                        "response_headers": {"x-mock": "ok"},
                    }
                ),
            )
        if request.url.path == "/v1/market/webhooks/test-deliveries":
            return httpx.Response(
                202,
                json=envelope({"queued": True, "event": event}),
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    with SiglumeClient(
        api_key="sig_test_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    ) as client:
        created = client.create_webhook_subscription(
            "https://hooks.example.test/siglume",
            event_types=["payment.succeeded"],
            metadata={"env": "test"},
        )
        listed = client.list_webhook_subscriptions()
        fetched = client.get_webhook_subscription("whsub_123")
        rotated = client.rotate_webhook_subscription_secret("whsub_123")
        paused = client.pause_webhook_subscription("whsub_123")
        resumed = client.resume_webhook_subscription("whsub_123")
        deliveries = client.list_webhook_deliveries(limit=5)
        redelivered = client.redeliver_webhook_delivery("whdel_123")
        queued = client.send_test_webhook_delivery("payment.succeeded", data={"sequence": 1})

    assert created.signing_secret == "whsec_live_123"
    assert len(listed) == 1
    assert fetched.subscription_id == "whsub_123"
    assert rotated.signing_secret == "whsec_rotated_123"
    assert paused.status == "paused"
    assert resumed.status == "active"
    assert deliveries[0].event_type == "payment.succeeded"
    assert redelivered.attempt_count == 2
    assert queued.queued is True
    assert queued.event.type == "payment.succeeded"


def test_create_webhook_subscription_requires_non_empty_event_types() -> None:
    with SiglumeClient(api_key="sig_test_key", base_url="https://api.example.test/v1") as client:
        with pytest.raises(SiglumeClientError, match="event_types must contain at least one webhook event type"):
            client.create_webhook_subscription(
                "https://hooks.example.test/siglume",
                event_types=[],
            )


def test_parse_webhook_event_rejects_unknown_type() -> None:
    with pytest.raises(SiglumeWebhookPayloadError, match="Unsupported webhook event type"):
        parse_webhook_event(
            {
                "id": "evt_demo_123",
                "type": "unknown.event",
                "api_version": "2026-04-20",
                "occurred_at": "2026-04-20T12:00:00Z",
                "idempotency_key": "evt_demo_123",
                "data": {},
            }
        )
