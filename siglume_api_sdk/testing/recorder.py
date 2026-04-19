"""Lightweight VCR-like recorder for Siglume SDK tests."""
from __future__ import annotations

import base64
import json
import re
import time
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

CASSETTE_VERSION = 1
_SECRET_KEY_RE = re.compile(r"(api[_-]?key|secret|private[_-]?key|access[_-]?token|refresh[_-]?token)", re.IGNORECASE)
_PRIVKEY_RE = re.compile(r"0x[a-f0-9]{64}")
_TOKEN_RE = re.compile(r"(pypi|ghp|gho|ghu|ghs)-[A-Za-z0-9]+")
_BOUNDARY_RE = re.compile(r'boundary="?([^";]+)"?', re.IGNORECASE)
HeaderValue = str | list[str]


class RecordMode(str, Enum):
    RECORD = "record"
    REPLAY = "replay"
    AUTO = "auto"


def _append_header(result: dict[str, HeaderValue], key: str, value: str) -> None:
    existing = result.get(key)
    if existing is None:
        result[key] = value
    elif isinstance(existing, list):
        existing.append(value)
    else:
        result[key] = [existing, value]


def _normalize_headers(headers: Mapping[str, Any] | httpx.Headers | None) -> dict[str, HeaderValue]:
    if headers is None:
        return {}
    result: dict[str, HeaderValue] = {}
    if isinstance(headers, httpx.Headers):
        items = headers.multi_items()
    else:
        items = headers.items()
    for key, value in items:
        normalized_key = str(key).lower()
        if isinstance(value, list):
            for entry in value:
                _append_header(result, normalized_key, str(entry))
        else:
            _append_header(result, normalized_key, str(value))
    return result


def _redact_string(value: str) -> str:
    value = _PRIVKEY_RE.sub("<REDACTED_PRIVKEY>", value)
    value = _TOKEN_RE.sub("<REDACTED_TOKEN>", value)
    return value


def _redact_header_value(key: str, value: str) -> str:
    if key == "content-type" and "multipart/form-data" in value.lower():
        return _normalize_multipart_content_type(value)
    if key == "authorization":
        # Preserve the scheme token so cassettes stay readable, but redact
        # every credential regardless of scheme (Bearer / Basic / Digest /
        # custom tokens). Falling through to _redact_string only catches
        # values that match our narrow secret regexes, which would leave
        # plenty of credentials in the clear.
        stripped = value.strip()
        if not stripped:
            return "<REDACTED>"
        head, sep, _ = stripped.partition(" ")
        # If the value has no whitespace separator, there is no scheme to
        # preserve — the entire value IS the credential (e.g. a bare
        # GitHub PAT `ghp_...` or a hex-encoded API key). Returning
        # `{head} <REDACTED>` in that case would echo the secret back.
        if not sep:
            return "<REDACTED>"
        return f"{head} <REDACTED>"
    if key in {"cookie", "set-cookie"} or _SECRET_KEY_RE.search(key):
        redacted = _redact_string(value)
        return redacted if redacted != value else "<REDACTED>"
    return _redact_string(value)


def _redact_headers(headers: Mapping[str, Any] | httpx.Headers | None) -> dict[str, HeaderValue]:
    normalized = _normalize_headers(headers)
    result: dict[str, HeaderValue] = {}
    for key, value in normalized.items():
        if isinstance(value, list):
            result[key] = [_redact_header_value(key, item) for item in value]
        else:
            result[key] = _redact_header_value(key, value)
    return result


def _redact_url(url: str) -> str:
    parts = urlsplit(url)
    if not parts.query:
        return url
    redacted_query: list[tuple[str, str]] = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if _SECRET_KEY_RE.search(key):
            next_value = _redact_string(value)
            redacted_query.append((key, next_value if next_value != value else "<REDACTED>"))
        else:
            redacted_query.append((key, _redact_string(value)))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(redacted_query), parts.fragment))


def _redact_body(value: Any, *, key_name: str | None = None) -> Any:
    if key_name and _SECRET_KEY_RE.search(key_name):
        if isinstance(value, str):
            redacted = _redact_string(value)
            return redacted if redacted != value else "<REDACTED>"
        return "<REDACTED>"
    if isinstance(value, Mapping):
        return {
            str(child_key): _redact_body(child_value, key_name=str(child_key))
            for child_key, child_value in value.items()
        }
    if isinstance(value, list):
        return [_redact_body(item) for item in value]
    if isinstance(value, str):
        return _redact_string(value)
    return value


def _normalize_multipart_bytes(content: bytes, content_type: str | None) -> bytes:
    if not content_type:
        return content
    match = _BOUNDARY_RE.search(content_type)
    if not match:
        return content
    boundary = match.group(1).encode("utf-8")
    return content.replace(boundary, b"<BOUNDARY>")


def _normalize_multipart_content_type(content_type: str | None) -> str:
    if not content_type:
        return "multipart/form-data; boundary=<BOUNDARY>"
    return _BOUNDARY_RE.sub("boundary=<BOUNDARY>", content_type)


def _parse_body_bytes(content: bytes | str | None, *, content_type: str | None = None) -> Any:
    if content in (None, b"", ""):
        return None
    if content_type and "multipart/form-data" in content_type.lower():
        raw_bytes = content if isinstance(content, bytes) else content.encode("utf-8")
        return {
            "content_type": _normalize_multipart_content_type(content_type),
            "encoding": "base64",
            "base64": base64.b64encode(_normalize_multipart_bytes(raw_bytes, content_type)).decode("ascii"),
        }
    if isinstance(content, bytes):
        text = content.decode("utf-8", errors="replace")
    else:
        text = content
    try:
        return json.loads(text)
    except ValueError:
        return text


def _serialize_request_body(request: httpx.Request) -> Any:
    try:
        body = request.content
    except Exception:
        try:
            body = request.read()
        except Exception:
            return None
    return _parse_body_bytes(body, content_type=request.headers.get("content-type"))


def _serialize_response_body(response: httpx.Response) -> Any:
    try:
        body = response.content
    except Exception:
        return None
    return _parse_body_bytes(body)


def _normalize_body_for_match(body: Any, ignore_body_fields: set[str]) -> Any:
    if isinstance(body, Mapping):
        return {
            key: _normalize_body_for_match(body[key], set())
            for key in sorted(body)
            if key not in ignore_body_fields
        }
    if isinstance(body, list):
        return [_normalize_body_for_match(item, set()) for item in body]
    return body


def _request_signature(request_payload: Mapping[str, Any], ignore_body_fields: set[str]) -> str:
    normalized = {
        "method": str(request_payload.get("method") or "").upper(),
        "url": str(request_payload.get("url") or ""),
        "body": _normalize_body_for_match(request_payload.get("body"), ignore_body_fields),
    }
    return json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))


def _response_from_cassette(response_payload: Mapping[str, Any], request: httpx.Request) -> httpx.Response:
    headers: list[tuple[str, str]] = []
    for key, value in _normalize_headers(response_payload.get("headers")).items():
        if isinstance(value, list):
            headers.extend((str(key), str(item)) for item in value)
        else:
            headers.append((str(key), str(value)))
    body = response_payload.get("body")
    if isinstance(body, str):
        content = body.encode("utf-8")
    elif body is None:
        content = b""
    else:
        content = json.dumps(body, ensure_ascii=False).encode("utf-8")
        if not any(key.lower() == "content-type" for key, _ in headers):
            headers.append(("content-type", "application/json"))
    return httpx.Response(
        int(response_payload.get("status") or 200),
        headers=headers,
        content=content,
        request=request,
    )


class Recorder:
    """Record and replay HTTP interactions as JSON cassettes."""

    def __init__(
        self,
        cassette_path: str | Path,
        *,
        mode: RecordMode = RecordMode.AUTO,
        ignore_body_fields: list[str] | None = None,
    ) -> None:
        self.cassette_path = Path(cassette_path)
        self.mode = mode
        self.ignore_body_fields = set(ignore_body_fields or [])
        self._effective_mode = mode
        self._interactions: list[dict[str, Any]] = []
        self._cursor = 0
        self._original_client_request: Callable[..., httpx.Response] | None = None
        self._original_module_request: Callable[..., httpx.Response] | None = None

    def __enter__(self) -> "Recorder":
        self._effective_mode = self._resolve_mode()
        self._interactions = self._load_cassette() if self._effective_mode == RecordMode.REPLAY else []
        self._cursor = 0
        self._patch_httpx()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self._restore_httpx()
        if exc_type is None and self._effective_mode == RecordMode.RECORD:
            self._write_cassette()

    def wrap(self, client: Any) -> Any:
        return client

    def _resolve_mode(self) -> RecordMode:
        if self.mode == RecordMode.AUTO:
            return RecordMode.REPLAY if self.cassette_path.exists() else RecordMode.RECORD
        return self.mode

    def _load_cassette(self) -> list[dict[str, Any]]:
        if not self.cassette_path.exists():
            raise AssertionError(f"Cassette not found for replay: {self.cassette_path}")
        payload = json.loads(self.cassette_path.read_text(encoding="utf-8"))
        if payload.get("version") != CASSETTE_VERSION:
            raise AssertionError(f"Unsupported cassette version in {self.cassette_path}")
        interactions = payload.get("interactions")
        if not isinstance(interactions, list):
            raise AssertionError(f"Invalid cassette interactions in {self.cassette_path}")
        return [dict(item) for item in interactions if isinstance(item, Mapping)]

    def _write_cassette(self) -> None:
        self.cassette_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": CASSETTE_VERSION, "interactions": self._interactions}
        self.cassette_path.write_text(
            json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def _patch_httpx(self) -> None:
        # Patch both sync Client.request AND AsyncClient.request. httpx.request
        # (module-level) internally constructs a transient sync Client and
        # calls Client.request, so the sync patch catches both paths there.
        # AsyncClient takes an entirely separate code path — without patching
        # it, async callers (a common pattern in app adapters) hit the real
        # network in REPLAY mode, making cassette-based tests non-deterministic
        # and leaking external calls.
        self._original_client_request = httpx.Client.request
        self._original_async_client_request = httpx.AsyncClient.request
        self._original_module_request = None
        recorder = self
        original_client_request = self._original_client_request
        original_async_client_request = self._original_async_client_request

        def client_request_wrapper(client_self: httpx.Client, method: str, url: Any, *args: Any, **kwargs: Any) -> httpx.Response:
            request = client_self.build_request(
                method,
                url,
                content=kwargs.get("content"),
                data=kwargs.get("data"),
                files=kwargs.get("files"),
                json=kwargs.get("json"),
                params=kwargs.get("params"),
                headers=kwargs.get("headers"),
                cookies=kwargs.get("cookies"),
            )
            if recorder._effective_mode == RecordMode.REPLAY:
                return recorder._replay_request(request)
            started = time.perf_counter()
            response = original_client_request(client_self, method, url, *args, **kwargs)
            duration_ms = int(round((time.perf_counter() - started) * 1000))
            recorder._record_interaction(request, response, duration_ms)
            return response

        async def async_client_request_wrapper(client_self: httpx.AsyncClient, method: str, url: Any, *args: Any, **kwargs: Any) -> httpx.Response:
            request = client_self.build_request(
                method,
                url,
                content=kwargs.get("content"),
                data=kwargs.get("data"),
                files=kwargs.get("files"),
                json=kwargs.get("json"),
                params=kwargs.get("params"),
                headers=kwargs.get("headers"),
                cookies=kwargs.get("cookies"),
            )
            if recorder._effective_mode == RecordMode.REPLAY:
                return recorder._replay_request(request)
            started = time.perf_counter()
            response = await original_async_client_request(client_self, method, url, *args, **kwargs)
            duration_ms = int(round((time.perf_counter() - started) * 1000))
            recorder._record_interaction(request, response, duration_ms)
            return response

        httpx.Client.request = client_request_wrapper
        httpx.AsyncClient.request = async_client_request_wrapper

    def _restore_httpx(self) -> None:
        if self._original_client_request is not None:
            httpx.Client.request = self._original_client_request
        if getattr(self, "_original_async_client_request", None) is not None:
            httpx.AsyncClient.request = self._original_async_client_request

    def _record_interaction(self, request: httpx.Request, response: httpx.Response, duration_ms: int) -> None:
        self._interactions.append(
            {
                "request": {
                    "method": request.method,
                    "url": _redact_url(str(request.url)),
                    "headers": _redact_headers(request.headers),
                    "body": _redact_body(_serialize_request_body(request)),
                },
                "response": {
                    "status": response.status_code,
                    "headers": _redact_headers(response.headers),
                    "body": _redact_body(_serialize_response_body(response)),
                    "duration_ms": duration_ms,
                },
            }
        )

    def _replay_request(self, request: httpx.Request) -> httpx.Response:
        if self._cursor >= len(self._interactions):
            raise AssertionError(
                f"Replay attempted unexpected HTTP call {request.method} {request.url} after cassette was exhausted."
            )
        expected = self._interactions[self._cursor]
        actual_request = {
            "method": request.method,
            "url": _redact_url(str(request.url)),
            "body": _redact_body(_serialize_request_body(request)),
        }
        if _request_signature(expected["request"], self.ignore_body_fields) != _request_signature(actual_request, self.ignore_body_fields):
            raise AssertionError(
                "Replay request mismatch.\n"
                f"Expected: {_request_signature(expected['request'], self.ignore_body_fields)}\n"
                f"Actual:   {_request_signature(actual_request, self.ignore_body_fields)}"
            )
        self._cursor += 1
        return _response_from_cassette(expected["response"], request)
