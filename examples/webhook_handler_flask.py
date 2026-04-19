"""Siglume webhook handler example for Flask-based sellers.

What API:
    Receives signed marketplace lifecycle webhooks from Siglume.
Target user:
    Marketplace sellers who need subscription/payment/execution notifications.
Required connected account:
    None.
"""
from __future__ import annotations

import json
import os

from siglume_api_sdk import (
    InMemoryWebhookDedupe,
    WebhookHandler,
    build_webhook_signature_header,
)


EXAMPLE_SECRET = os.environ.get("SIGLUME_WEBHOOK_SECRET", "whsec_example_secret")


def build_example_event() -> dict[str, object]:
    return {
        "id": "evt_subscription_created_demo",
        "type": "subscription.created",
        "api_version": "2026-04-20",
        "occurred_at": "2026-04-20T12:00:00Z",
        "idempotency_key": "evt_subscription_created_demo",
        "trace_id": "trc_webhook_demo",
        "data": {
            "subscription_id": "sub_demo_123",
            "access_grant_id": "grant_demo_123",
            "listing_id": "lst_demo_123",
            "capability_key": "currency-converter-v2",
            "buyer_user_id": "usr_buyer_demo",
            "seller_user_id": "usr_seller_demo",
            "billing_model": "subscription",
            "currency": "USD",
            "amount_minor": 1200,
        },
    }


def build_handler(*, signing_secret: str = EXAMPLE_SECRET) -> WebhookHandler:
    handler = WebhookHandler(
        signing_secret=signing_secret,
        deduper=InMemoryWebhookDedupe(ttl_seconds=600),
    )

    @handler.on("subscription.created")
    def on_subscription_created(event) -> None:
        subscription_id = str(event.data.get("subscription_id") or "")
        capability_key = str(event.data.get("capability_key") or "")
        print(f"handled subscription.created for {subscription_id} ({capability_key})")

    return handler


def create_flask_app(*, signing_secret: str = EXAMPLE_SECRET):
    from flask import Flask

    app = Flask(__name__)
    handler = build_handler(signing_secret=signing_secret)
    app.add_url_rule(
        "/webhooks/siglume",
        view_func=handler.as_flask_view(),
        methods=["POST"],
    )
    return app


def run_mock_webhook_example() -> list[str]:
    event = build_example_event()
    raw_body = json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    signature_header = build_webhook_signature_header(
        EXAMPLE_SECRET,
        raw_body,
        timestamp=1713571200,
    )

    lines: list[str] = []
    handler = WebhookHandler(
        signing_secret=EXAMPLE_SECRET,
        deduper=InMemoryWebhookDedupe(ttl_seconds=600),
    )

    @handler.on("subscription.created")
    def on_subscription_created(event) -> None:
        lines.append(f"handled_type: {event.type}")
        lines.append(f"subscription_id: {event.data.get('subscription_id')}")
        lines.append(f"capability_key: {event.data.get('capability_key')}")

    result = handler.handle(
        raw_body,
        {
            "Content-Type": "application/json",
            "Siglume-Signature": signature_header,
            "Siglume-Event-Id": event["id"],
            "Siglume-Event-Type": event["type"],
        },
        now=1713571200,
    )
    duplicate = handler.handle(
        raw_body,
        {
            "Content-Type": "application/json",
            "Siglume-Signature": signature_header,
            "Siglume-Event-Id": event["id"],
            "Siglume-Event-Type": event["type"],
        },
        now=1713571200,
    )
    lines.insert(0, f"verified: {result.event.id} duplicate={result.duplicate}")
    lines.append(f"duplicate_on_replay: {duplicate.duplicate}")
    return lines


def main() -> None:
    for line in run_mock_webhook_example():
        print(line)
    print("Flask app factory ready: create_flask_app()")


if __name__ == "__main__":
    main()
