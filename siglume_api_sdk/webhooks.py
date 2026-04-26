"""Webhook helpers for receiving Siglume marketplace events."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Mapping, TypeAlias


WEBHOOK_SIGNATURE_HEADER = "Siglume-Signature"
WEBHOOK_EVENT_ID_HEADER = "Siglume-Event-Id"
WEBHOOK_EVENT_TYPE_HEADER = "Siglume-Event-Type"
DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300
WEBHOOK_EVENT_TYPES: tuple[str, ...] = (
    "subscription.created",
    "subscription.renewed",
    "subscription.cancelled",
    "subscription.paused",
    "subscription.reinstated",
    "payment.succeeded",
    "payment.failed",
    "capability.published",
    "capability.delisted",
    "execution.completed",
    "execution.failed",
)
_EVENT_TYPE_SET = frozenset(WEBHOOK_EVENT_TYPES)

WebhookEventType: TypeAlias = Literal[
    "subscription.created",
    "subscription.renewed",
    "subscription.cancelled",
    "subscription.paused",
    "subscription.reinstated",
    "payment.succeeded",
    "payment.failed",
    "capability.published",
    "capability.delisted",
    "execution.completed",
    "execution.failed",
]


class SiglumeWebhookError(RuntimeError):
    """Base exception for webhook verification and dispatch failures."""


class SiglumeWebhookSignatureError(SiglumeWebhookError):
    """Raised when a webhook signature is missing or invalid."""


class SiglumeWebhookPayloadError(SiglumeWebhookError):
    """Raised when a webhook payload cannot be parsed into a known event."""


class SiglumeWebhookReplayError(SiglumeWebhookError):
    """Raised when a webhook idempotency key has already been processed."""


@dataclass
class WebhookSignatureVerification:
    timestamp: int
    signature: str


@dataclass
class WebhookSubscriptionRecord:
    subscription_id: str
    owner_user_id: str
    callback_url: str
    status: str
    event_types: list[str] = field(default_factory=list)
    description: str | None = None
    signing_secret_hint: str | None = None
    signing_secret: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    last_delivery_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class WebhookDeliveryRecord:
    delivery_id: str
    subscription_id: str
    event_id: str
    event_type: str
    idempotency_key: str
    callback_url: str
    delivery_status: str
    request_headers: dict[str, Any] = field(default_factory=dict)
    request_body: dict[str, Any] = field(default_factory=dict)
    response_status: int | None = None
    response_headers: dict[str, Any] = field(default_factory=dict)
    response_body: Any | None = None
    duration_ms: int | None = None
    attempt_count: int = 0
    last_attempt_at: str | None = None
    delivered_at: str | None = None
    error_message: str | None = None
    trace_id: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class QueuedWebhookEvent:
    queued: bool
    event: BaseWebhookEvent


@dataclass(kw_only=True)
class BaseWebhookEvent:
    id: str
    type: WebhookEventType
    api_version: str
    occurred_at: str
    idempotency_key: str
    data: dict[str, Any] = field(default_factory=dict)
    trace_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass(kw_only=True)
class SubscriptionCreatedEvent(BaseWebhookEvent):
    type: Literal["subscription.created"] = "subscription.created"


@dataclass(kw_only=True)
class SubscriptionRenewedEvent(BaseWebhookEvent):
    type: Literal["subscription.renewed"] = "subscription.renewed"


@dataclass(kw_only=True)
class SubscriptionCancelledEvent(BaseWebhookEvent):
    type: Literal["subscription.cancelled"] = "subscription.cancelled"


@dataclass(kw_only=True)
class SubscriptionPausedEvent(BaseWebhookEvent):
    type: Literal["subscription.paused"] = "subscription.paused"


@dataclass(kw_only=True)
class SubscriptionReinstatedEvent(BaseWebhookEvent):
    type: Literal["subscription.reinstated"] = "subscription.reinstated"


@dataclass(kw_only=True)
class PaymentSucceededEvent(BaseWebhookEvent):
    type: Literal["payment.succeeded"] = "payment.succeeded"


@dataclass(kw_only=True)
class PaymentFailedEvent(BaseWebhookEvent):
    type: Literal["payment.failed"] = "payment.failed"


@dataclass(kw_only=True)
class CapabilityPublishedEvent(BaseWebhookEvent):
    type: Literal["capability.published"] = "capability.published"


@dataclass(kw_only=True)
class CapabilityDelistedEvent(BaseWebhookEvent):
    type: Literal["capability.delisted"] = "capability.delisted"


@dataclass(kw_only=True)
class ExecutionCompletedEvent(BaseWebhookEvent):
    type: Literal["execution.completed"] = "execution.completed"


@dataclass(kw_only=True)
class ExecutionFailedEvent(BaseWebhookEvent):
    type: Literal["execution.failed"] = "execution.failed"


SiglumeWebhookEvent: TypeAlias = (
    SubscriptionCreatedEvent
    | SubscriptionRenewedEvent
    | SubscriptionCancelledEvent
    | SubscriptionPausedEvent
    | SubscriptionReinstatedEvent
    | PaymentSucceededEvent
    | PaymentFailedEvent
    | CapabilityPublishedEvent
    | CapabilityDelistedEvent
    | ExecutionCompletedEvent
    | ExecutionFailedEvent
)

_EVENT_CLASS_BY_TYPE: dict[str, type[BaseWebhookEvent]] = {
    "subscription.created": SubscriptionCreatedEvent,
    "subscription.renewed": SubscriptionRenewedEvent,
    "subscription.cancelled": SubscriptionCancelledEvent,
    "subscription.paused": SubscriptionPausedEvent,
    "subscription.reinstated": SubscriptionReinstatedEvent,
    "payment.succeeded": PaymentSucceededEvent,
    "payment.failed": PaymentFailedEvent,
    "capability.published": CapabilityPublishedEvent,
    "capability.delisted": CapabilityDelistedEvent,
    "execution.completed": ExecutionCompletedEvent,
    "execution.failed": ExecutionFailedEvent,
}

WebhookCallback: TypeAlias = Callable[[SiglumeWebhookEvent], Any]


@dataclass
class WebhookDispatchResult:
    event: SiglumeWebhookEvent
    verification: WebhookSignatureVerification
    duplicate: bool = False
    callback_results: list[Any] = field(default_factory=list)


class InMemoryWebhookDedupe:
    """Small in-memory idempotency helper keyed by webhook idempotency_key."""

    def __init__(self, *, ttl_seconds: int = 3600, max_entries: int = 4096) -> None:
        self.ttl_seconds = max(1, int(ttl_seconds))
        self.max_entries = max(32, int(max_entries))
        self._entries: dict[str, float] = {}

    def _purge(self, now: float) -> None:
        expired = [key for key, expires_at in self._entries.items() if expires_at <= now]
        for key in expired:
            self._entries.pop(key, None)
        while len(self._entries) > self.max_entries:
            oldest = min(self._entries.items(), key=lambda item: item[1])[0]
            self._entries.pop(oldest, None)

    def is_duplicate(self, idempotency_key: str, *, now: float | None = None) -> bool:
        moment = float(now if now is not None else time.time())
        self._purge(moment)
        key = str(idempotency_key or "").strip()
        if not key:
            return False
        return key in self._entries

    def mark_processed(self, idempotency_key: str, *, now: float | None = None) -> None:
        moment = float(now if now is not None else time.time())
        self._purge(moment)
        key = str(idempotency_key or "").strip()
        if not key:
            return
        self._entries[key] = moment + self.ttl_seconds
        self._purge(moment)


def _to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return {str(key): _clone_json(item) for key, item in value.items()}
    return {}


def _clone_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _clone_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_clone_json(item) for item in value]
    return value


def _require_mapping(value: Any, *, name: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise SiglumeWebhookPayloadError(f"{name} must be an object.")
    return {str(key): _clone_json(item) for key, item in value.items()}


def _string_or_none(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _header_value(headers: Mapping[str, Any], name: str) -> str | None:
    target = name.lower()
    for key, value in headers.items():
        if str(key).lower() == target:
            if isinstance(value, (list, tuple)):
                return str(value[0]).strip() if value else None
            return _string_or_none(value)
    return None


def _body_bytes(body: bytes | bytearray | memoryview | str | Mapping[str, Any]) -> bytes:
    if isinstance(body, (bytes, bytearray, memoryview)):
        return bytes(body)
    if isinstance(body, str):
        return body.encode("utf-8")
    if isinstance(body, Mapping):
        return json.dumps(_clone_json(body), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    raise SiglumeWebhookPayloadError("Webhook body must be bytes, str, or a JSON object.")


def _parse_signature_header(signature_header: str) -> tuple[int, str]:
    timestamp: int | None = None
    signature: str | None = None
    for item in str(signature_header or "").split(","):
        key, _, value = item.strip().partition("=")
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError as exc:
                raise SiglumeWebhookSignatureError("Webhook signature timestamp is invalid.") from exc
        elif key == "v1":
            signature = value.strip()
    if timestamp is None or not signature:
        raise SiglumeWebhookSignatureError("Webhook signature header is incomplete.")
    return timestamp, signature


def compute_webhook_signature(
    signing_secret: str,
    body: bytes | bytearray | memoryview | str | Mapping[str, Any],
    *,
    timestamp: int,
) -> str:
    if not signing_secret:
        raise SiglumeWebhookSignatureError("SIGLUME webhook signing secret is required.")
    body_bytes = _body_bytes(body)
    signed_payload = f"{int(timestamp)}.".encode("utf-8") + body_bytes
    return hmac.new(signing_secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()


def build_webhook_signature_header(
    signing_secret: str,
    body: bytes | bytearray | memoryview | str | Mapping[str, Any],
    *,
    timestamp: int | None = None,
) -> str:
    moment = int(time.time()) if timestamp is None else int(timestamp)
    signature = compute_webhook_signature(signing_secret, body, timestamp=moment)
    return f"t={moment},v1={signature}"


def verify_webhook_signature(
    signing_secret: str,
    body: bytes | bytearray | memoryview | str | Mapping[str, Any],
    signature_header: str,
    *,
    tolerance_seconds: int = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
    now: int | None = None,
) -> WebhookSignatureVerification:
    timestamp, signature = _parse_signature_header(signature_header)
    moment = int(time.time()) if now is None else int(now)
    if abs(moment - timestamp) > max(1, int(tolerance_seconds)):
        raise SiglumeWebhookSignatureError("Webhook timestamp is outside the allowed tolerance window.")
    expected = compute_webhook_signature(signing_secret, body, timestamp=timestamp)
    if not hmac.compare_digest(expected, signature):
        raise SiglumeWebhookSignatureError("Webhook signature did not match.")
    return WebhookSignatureVerification(timestamp=timestamp, signature=signature)


def parse_webhook_subscription(payload: Mapping[str, Any]) -> WebhookSubscriptionRecord:
    record = _require_mapping(payload, name="webhook subscription")
    return WebhookSubscriptionRecord(
        subscription_id=str(record.get("id") or record.get("subscription_id") or ""),
        owner_user_id=str(record.get("owner_user_id") or ""),
        callback_url=str(record.get("callback_url") or ""),
        status=str(record.get("status") or ""),
        event_types=[
            str(item).strip()
            for item in list(record.get("event_types") or [])
            if str(item).strip()
        ],
        description=_string_or_none(record.get("description")),
        signing_secret_hint=_string_or_none(record.get("signing_secret_hint")),
        signing_secret=_string_or_none(record.get("signing_secret")),
        metadata=_to_dict(record.get("metadata")),
        last_delivery_at=_string_or_none(record.get("last_delivery_at")),
        created_at=_string_or_none(record.get("created_at")),
        updated_at=_string_or_none(record.get("updated_at")),
        raw=record,
    )


def parse_webhook_delivery(payload: Mapping[str, Any]) -> WebhookDeliveryRecord:
    record = _require_mapping(payload, name="webhook delivery")
    response_status = record.get("response_status")
    duration_ms = record.get("duration_ms")
    attempt_count = record.get("attempt_count")
    return WebhookDeliveryRecord(
        delivery_id=str(record.get("id") or record.get("delivery_id") or ""),
        subscription_id=str(record.get("subscription_id") or ""),
        event_id=str(record.get("event_id") or ""),
        event_type=str(record.get("event_type") or ""),
        idempotency_key=str(record.get("idempotency_key") or ""),
        callback_url=str(record.get("callback_url") or ""),
        delivery_status=str(record.get("delivery_status") or ""),
        request_headers=_to_dict(record.get("request_headers")),
        request_body=_to_dict(record.get("request_body")),
        response_status=int(response_status) if response_status is not None else None,
        response_headers=_to_dict(record.get("response_headers")),
        response_body=_clone_json(record.get("response_body")),
        duration_ms=int(duration_ms) if duration_ms is not None else None,
        attempt_count=int(attempt_count) if attempt_count is not None else 0,
        last_attempt_at=_string_or_none(record.get("last_attempt_at")),
        delivered_at=_string_or_none(record.get("delivered_at")),
        error_message=_string_or_none(record.get("error_message")),
        trace_id=_string_or_none(record.get("trace_id")),
        created_at=_string_or_none(record.get("created_at")),
        updated_at=_string_or_none(record.get("updated_at")),
        raw=record,
    )


def parse_webhook_event(payload: Mapping[str, Any]) -> SiglumeWebhookEvent:
    record = _require_mapping(payload, name="webhook event")
    event_type = str(record.get("type") or "").strip()
    if event_type not in _EVENT_TYPE_SET:
        raise SiglumeWebhookPayloadError(f"Unsupported webhook event type: {event_type or '<missing>'}.")
    event_cls = _EVENT_CLASS_BY_TYPE[event_type]
    event = event_cls(
        id=str(record.get("id") or ""),
        type=event_type,
        api_version=str(record.get("api_version") or ""),
        occurred_at=str(record.get("occurred_at") or ""),
        idempotency_key=str(record.get("idempotency_key") or record.get("id") or ""),
        data=_to_dict(record.get("data")),
        trace_id=_string_or_none(record.get("trace_id")),
        raw=record,
    )
    if not event.id:
        raise SiglumeWebhookPayloadError("Webhook event id is required.")
    if not event.api_version:
        raise SiglumeWebhookPayloadError("Webhook api_version is required.")
    if not event.occurred_at:
        raise SiglumeWebhookPayloadError("Webhook occurred_at is required.")
    return event


def parse_queued_webhook_event(payload: Mapping[str, Any]) -> QueuedWebhookEvent:
    record = _require_mapping(payload, name="queued webhook event")
    return QueuedWebhookEvent(
        queued=bool(record.get("queued")),
        event=parse_webhook_event(_require_mapping(record.get("event"), name="queued webhook event.event")),
    )


def _invoke_callback(callback: WebhookCallback, event: SiglumeWebhookEvent) -> Any:
    result = callback(event)
    if asyncio.iscoroutine(result):
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(result)
        raise SiglumeWebhookError(
            "Async webhook callbacks require a sync-free adapter; call the coroutine yourself inside the handler."
        )
    return result


class WebhookHandler:
    """Verify and dispatch signed Siglume webhook events."""

    def __init__(
        self,
        *,
        signing_secret: str,
        tolerance_seconds: int = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
        deduper: InMemoryWebhookDedupe | None = None,
    ) -> None:
        if not signing_secret:
            raise SiglumeWebhookSignatureError("SIGLUME_WEBHOOK_SECRET is required.")
        self.signing_secret = signing_secret
        self.tolerance_seconds = max(1, int(tolerance_seconds))
        self.deduper = deduper
        self._handlers: dict[str, list[WebhookCallback]] = {}

    def on(self, event_type: WebhookEventType | Literal["*"]) -> Callable[[WebhookCallback], WebhookCallback]:
        normalized = str(event_type or "").strip()
        if normalized != "*" and normalized not in _EVENT_TYPE_SET:
            raise SiglumeWebhookError(f"Unsupported Siglume webhook event type: {normalized}")

        def decorator(callback: WebhookCallback) -> WebhookCallback:
            self._handlers.setdefault(normalized, []).append(callback)
            return callback

        return decorator

    def verify(
        self,
        body: bytes | bytearray | memoryview | str | Mapping[str, Any],
        headers: Mapping[str, Any],
        *,
        now: int | None = None,
    ) -> tuple[SiglumeWebhookEvent, WebhookSignatureVerification]:
        signature_header = _header_value(headers, WEBHOOK_SIGNATURE_HEADER)
        if not signature_header:
            raise SiglumeWebhookSignatureError("Missing Siglume-Signature header.")
        body_bytes = _body_bytes(body)
        verification = verify_webhook_signature(
            self.signing_secret,
            body_bytes,
            signature_header,
            tolerance_seconds=self.tolerance_seconds,
            now=now,
        )
        try:
            payload = json.loads(body_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SiglumeWebhookPayloadError("Webhook body must contain valid UTF-8 JSON.") from exc
        event = parse_webhook_event(_require_mapping(payload, name="webhook event"))
        event_id_header = _header_value(headers, WEBHOOK_EVENT_ID_HEADER)
        event_type_header = _header_value(headers, WEBHOOK_EVENT_TYPE_HEADER)
        if event_id_header and event_id_header != event.id:
            raise SiglumeWebhookPayloadError("Siglume-Event-Id header did not match the webhook body.")
        if event_type_header and event_type_header != event.type:
            raise SiglumeWebhookPayloadError("Siglume-Event-Type header did not match the webhook body.")
        return event, verification

    def dispatch(self, event: SiglumeWebhookEvent) -> list[Any]:
        callbacks = [*self._handlers.get("*", []), *self._handlers.get(event.type, [])]
        return [_invoke_callback(callback, event) for callback in callbacks]

    def handle(
        self,
        body: bytes | bytearray | memoryview | str | Mapping[str, Any],
        headers: Mapping[str, Any],
        *,
        now: int | None = None,
    ) -> WebhookDispatchResult:
        event, verification = self.verify(body, headers, now=now)
        if self.deduper is not None and self.deduper.is_duplicate(event.idempotency_key):
            return WebhookDispatchResult(
                event=event,
                verification=verification,
                duplicate=True,
                callback_results=[],
            )
        callback_results = self.dispatch(event)
        if self.deduper is not None:
            self.deduper.mark_processed(event.idempotency_key)
        return WebhookDispatchResult(
            event=event,
            verification=verification,
            duplicate=False,
            callback_results=callback_results,
        )

    def as_flask_view(self) -> Callable[[], Any]:
        try:
            from flask import jsonify, request
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise SiglumeWebhookError(
                "Flask is not installed. Install flask to use WebhookHandler.as_flask_view()."
            ) from exc

        def view():
            try:
                result = self.handle(request.get_data(cache=False, as_text=False), request.headers)
            except SiglumeWebhookSignatureError as exc:
                return jsonify({"ok": False, "error": str(exc), "code": "INVALID_SIGNATURE"}), 401
            except SiglumeWebhookReplayError as exc:
                return jsonify({"ok": False, "error": str(exc), "code": "DUPLICATE_EVENT"}), 409
            except SiglumeWebhookPayloadError as exc:
                return jsonify({"ok": False, "error": str(exc), "code": "INVALID_PAYLOAD"}), 400
            return jsonify(
                {
                    "ok": True,
                    "duplicate": result.duplicate,
                    "event_id": result.event.id,
                    "event_type": result.event.type,
                }
            ), 200

        return view


__all__ = [
    "BaseWebhookEvent",
    "CapabilityDelistedEvent",
    "CapabilityPublishedEvent",
    "DEFAULT_WEBHOOK_TOLERANCE_SECONDS",
    "ExecutionCompletedEvent",
    "ExecutionFailedEvent",
    "InMemoryWebhookDedupe",
    "PaymentFailedEvent",
    "PaymentSucceededEvent",
    "QueuedWebhookEvent",
    "SiglumeWebhookError",
    "SiglumeWebhookEvent",
    "SiglumeWebhookPayloadError",
    "SiglumeWebhookReplayError",
    "SiglumeWebhookSignatureError",
    "SubscriptionCancelledEvent",
    "SubscriptionCreatedEvent",
    "SubscriptionPausedEvent",
    "SubscriptionReinstatedEvent",
    "SubscriptionRenewedEvent",
    "WebhookDeliveryRecord",
    "WebhookDispatchResult",
    "WebhookEventType",
    "WebhookHandler",
    "WebhookSignatureVerification",
    "WebhookSubscriptionRecord",
    "WEBHOOK_EVENT_ID_HEADER",
    "WEBHOOK_EVENT_TYPE_HEADER",
    "WEBHOOK_EVENT_TYPES",
    "WEBHOOK_SIGNATURE_HEADER",
    "build_webhook_signature_header",
    "compute_webhook_signature",
    "parse_webhook_delivery",
    "parse_webhook_event",
    "parse_queued_webhook_event",
    "parse_webhook_subscription",
    "verify_webhook_signature",
]
