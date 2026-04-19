from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk import (  # noqa: E402
    AppAdapter,
    AppCategory,
    AppManifest,
    ApprovalMode,
    ExecutionContext,
    ExecutionResult,
    PermissionClass,
    PriceModel,
    SiglumeClient,
    ToolManual,
    ToolManualPermissionClass,
)
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


def build_client(handler) -> SiglumeClient:
    return SiglumeClient(
        api_key="sig_test_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


def test_python_recorder_replays_committed_shared_cassette() -> None:
    cassette_path = ROOT / "tests" / "cassettes" / "auto_register_flow.json"

    def unexpected_handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Replay should not hit transport: {request.method} {request.url}")

    with Recorder(cassette_path, mode=RecordMode.REPLAY) as recorder:
        with recorder.wrap(build_client(unexpected_handler)) as client:
            receipt = client.auto_register(build_manifest(), build_tool_manual(), source_code="# shared registration stub")
            confirmation = client.confirm_registration(receipt.listing_id)

    assert receipt.listing_id == "lst_123"
    assert confirmation.status == "pending_review"
    assert confirmation.quality.grade == "B"
    assert confirmation.trace_id == "trc_confirm"


def test_python_recorder_redacts_sensitive_values(tmp_path: Path) -> None:
    cassette_path = tmp_path / "redacted.json"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=envelope(
                {
                    "refresh_token": "pypi-SECRET123",
                    "wallet_secret": "0x" + ("a" * 64),
                    "ok": True,
                }
            ),
            headers={"Authorization": "Bearer downstream-secret"},
        )

    with Recorder(cassette_path, mode=RecordMode.RECORD):
        with httpx.Client(
            base_url="https://api.example.test",
            transport=httpx.MockTransport(handler),
            headers={
                "Authorization": "Bearer sig_super_secret",
                "Cookie": "session=ghp-COOKIESECRET",
                "X-API-Key": "sig_header_secret",
            },
        ) as client:
            response = client.post(
                "/secrets?api_key=query-secret&access_token=ghp-QUERYSECRET",
                json={
                    "api_key": "sig_private",
                    "nested": {"private_key": "0x" + ("b" * 64)},
                    "access_token": "ghp-EXAMPLESECRET",
                },
            )
            assert response.status_code == 200

    cassette_text = cassette_path.read_text(encoding="utf-8")
    assert "sig_super_secret" not in cassette_text
    assert "sig_private" not in cassette_text
    assert "sig_header_secret" not in cassette_text
    assert "query-secret" not in cassette_text
    assert "ghp-QUERYSECRET" not in cassette_text
    assert "ghp-COOKIESECRET" not in cassette_text
    assert "ghp-EXAMPLESECRET" not in cassette_text
    assert "<REDACTED>" in cassette_text
    assert "<REDACTED_PRIVKEY>" in cassette_text
    assert "<REDACTED_TOKEN>" in cassette_text
    assert "Bearer <REDACTED>" in cassette_text

    def unexpected_handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Replay should not hit transport: {request.method} {request.url}")

    with Recorder(cassette_path, mode=RecordMode.REPLAY):
        with httpx.Client(
            base_url="https://api.example.test",
            transport=httpx.MockTransport(unexpected_handler),
            headers={
                "Authorization": "Bearer sig_super_secret",
                "Cookie": "session=ghp-COOKIESECRET",
                "X-API-Key": "sig_header_secret",
            },
        ) as client:
            replayed = client.post(
                "/secrets?api_key=query-secret&access_token=ghp-QUERYSECRET",
                json={
                    "api_key": "sig_private",
                    "nested": {"private_key": "0x" + ("b" * 64)},
                    "access_token": "ghp-EXAMPLESECRET",
                },
            )
            assert replayed.status_code == 200


def test_python_recorder_ignore_body_fields_allows_replay_drift(tmp_path: Path) -> None:
    cassette_path = tmp_path / "ignore-fields.json"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=envelope({"ok": True, "echo": json.loads(request.content.decode("utf-8"))}))

    with Recorder(cassette_path, mode=RecordMode.RECORD, ignore_body_fields=["request_id", "timestamp"]):
        with httpx.Client(base_url="https://api.example.test", transport=httpx.MockTransport(handler)) as client:
            recorded = client.post(
                "/events",
                json={"query": "headphones", "request_id": "req_record", "timestamp": "2026-04-19T00:00:00Z"},
            )
            assert recorded.status_code == 200

    def unexpected_handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Replay should not hit transport: {request.method} {request.url}")

    with Recorder(cassette_path, mode=RecordMode.REPLAY, ignore_body_fields=["request_id", "timestamp"]):
        with httpx.Client(base_url="https://api.example.test", transport=httpx.MockTransport(unexpected_handler)) as client:
            replayed = client.post(
                "/events",
                json={"query": "headphones", "request_id": "req_replay", "timestamp": "2026-04-19T01:00:00Z"},
            )
            assert replayed.json()["data"]["ok"] is True


def test_python_recorder_auto_mode_prefers_replay_for_existing_cassette() -> None:
    cassette_path = ROOT / "tests" / "cassettes" / "auto_register_flow.json"

    def unexpected_handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Auto mode should replay instead of hitting transport: {request.method} {request.url}")

    with Recorder(cassette_path, mode=RecordMode.AUTO) as recorder:
        with recorder.wrap(build_client(unexpected_handler)) as client:
            receipt = client.auto_register(build_manifest(), build_tool_manual(), source_code="# shared registration stub")

    assert receipt.listing_id == "lst_123"


class HttpxQuoteApp(AppAdapter):
    def __init__(self, transport: httpx.BaseTransport) -> None:
        self.transport = transport

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="httpx-quote",
            name="HTTPX Quote",
            job_to_be_done="Quote a price from an upstream HTTP service.",
            category=AppCategory.COMMERCE,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",
            short_description="Calls an upstream quote API.",
            example_prompts=["Quote this item."],
        )

    async def execute(self, ctx: ExecutionContext):
        with httpx.Client(
            base_url="https://api.example.test",
            transport=self.transport,
            headers={"Authorization": "Bearer harness-secret"},
        ) as client:
            response = client.post(
                "/quote",
                json={
                    "query": str(ctx.input_params.get("query") or "headphones"),
                    "timestamp": "2026-04-19T00:00:00Z",
                },
            )
        data = response.json()["data"]
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output=data,
        )


def test_app_test_harness_record_and_replay_httpx_calls(tmp_path: Path) -> None:
    from siglume_api_sdk import AppTestHarness

    cassette_path = tmp_path / "harness.json"

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json=envelope({"summary": f"quoted:{payload['query']}", "provider_status": "ok"}),
        )

    harness = AppTestHarness(HttpxQuoteApp(httpx.MockTransport(handler)))

    with harness.record(str(cassette_path)) as recorded_harness:
        recorded = asyncio.run(recorded_harness.dry_run("quote_lookup", input_params={"query": "sony"}))

    def unexpected_handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Replay should not hit transport: {request.method} {request.url}")

    replay_harness = AppTestHarness(HttpxQuoteApp(httpx.MockTransport(unexpected_handler)))
    with replay_harness.replay(str(cassette_path)) as replayed_harness:
        replayed = asyncio.run(replayed_harness.dry_run("quote_lookup", input_params={"query": "sony"}))

    assert recorded.output["summary"] == "quoted:sony"
    assert replayed.output == recorded.output


def test_python_recorder_raises_on_request_mismatch(tmp_path: Path) -> None:
    cassette_path = tmp_path / "mismatch.json"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=envelope({"ok": True}))

    with Recorder(cassette_path, mode=RecordMode.RECORD):
        with httpx.Client(base_url="https://api.example.test", transport=httpx.MockTransport(handler)) as client:
            client.post("/events", json={"query": "camera"})

    with Recorder(cassette_path, mode=RecordMode.REPLAY):
        with httpx.Client(base_url="https://api.example.test", transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(AssertionError, match="Replay request mismatch"):
                client.post("/events", json={"query": "laptop"})


def test_python_recorder_preserves_repeated_response_headers(tmp_path: Path) -> None:
    cassette_path = tmp_path / "repeat-headers.json"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=envelope({"ok": True}),
            headers=[("Set-Cookie", "a=1"), ("Set-Cookie", "b=2")],
        )

    with Recorder(cassette_path, mode=RecordMode.RECORD):
        with httpx.Client(base_url="https://api.example.test", transport=httpx.MockTransport(handler)) as client:
            recorded = client.get("/cookies")
            assert recorded.headers.get_list("set-cookie") == ["a=1", "b=2"]

    cassette = json.loads(cassette_path.read_text(encoding="utf-8"))
    assert cassette["interactions"][0]["response"]["headers"]["set-cookie"] == ["<REDACTED>", "<REDACTED>"]

    def unexpected_handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Replay should not hit transport: {request.method} {request.url}")

    with Recorder(cassette_path, mode=RecordMode.REPLAY):
        with httpx.Client(base_url="https://api.example.test", transport=httpx.MockTransport(unexpected_handler)) as client:
            replayed = client.get("/cookies")
            assert replayed.headers.get_list("set-cookie") == ["<REDACTED>", "<REDACTED>"]


def test_python_recorder_replays_multipart_uploads(tmp_path: Path) -> None:
    cassette_path = tmp_path / "multipart.json"
    file_bytes = b"\xff\x00\xfe\x10binary"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=envelope({"ok": True}))

    with Recorder(cassette_path, mode=RecordMode.RECORD):
        with httpx.Client(base_url="https://api.example.test", transport=httpx.MockTransport(handler)) as client:
            recorded = client.post(
                "/upload",
                data={"note": "hello"},
                files={"file": ("hello.bin", file_bytes, "application/octet-stream")},
            )
            assert recorded.status_code == 200

    cassette_text = cassette_path.read_text(encoding="utf-8")
    assert '"encoding": "base64"' in cassette_text
    assert "boundary=<BOUNDARY>" in cassette_text

    def unexpected_handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Replay should not hit transport: {request.method} {request.url}")

    with Recorder(cassette_path, mode=RecordMode.REPLAY):
        with httpx.Client(base_url="https://api.example.test", transport=httpx.MockTransport(unexpected_handler)) as client:
            replayed = client.post(
                "/upload",
                data={"note": "hello"},
                files={"file": ("hello.bin", file_bytes, "application/octet-stream")},
            )
            assert replayed.json()["data"]["ok"] is True

    with Recorder(cassette_path, mode=RecordMode.REPLAY):
        with httpx.Client(base_url="https://api.example.test", transport=httpx.MockTransport(unexpected_handler)) as client:
            with pytest.raises(AssertionError, match="Replay request mismatch"):
                client.post(
                    "/upload",
                    data={"note": "hello"},
                    files={"file": ("hello.bin", b"\x00\x01different", "application/octet-stream")},
                )


def test_recorder_redacts_non_bearer_auth_schemes(tmp_path: Path) -> None:
    # Codex bot P1 on PR #105: any Authorization value must be redacted,
    # not only the "Bearer " form. Basic / Digest / custom-token schemes
    # previously leaked through because they did not match the narrow
    # secret regexes in _redact_string.
    cassette_path = tmp_path / "auth_schemes.json"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True})

    with Recorder(cassette_path, mode=RecordMode.RECORD):
        transport = httpx.MockTransport(handler)
        with httpx.Client(base_url="https://api.example.test", transport=transport) as client:
            client.get("/x", headers={"Authorization": "Basic dXNlcjpwYXNzd29yZA=="})
            client.get("/y", headers={"Authorization": "Digest username=\"alice\", nonce=\"abc\""})
            client.get("/z", headers={"Authorization": "Sig-Token abcdef123456"})

    data = json.loads(cassette_path.read_text(encoding="utf-8"))
    headers = [i["request"]["headers"] for i in data["interactions"]]
    assert headers[0]["authorization"] == "Basic <REDACTED>"
    assert headers[1]["authorization"] == "Digest <REDACTED>"
    assert headers[2]["authorization"] == "Sig-Token <REDACTED>"


def test_recorder_does_not_double_capture_module_level_httpx_request(tmp_path: Path) -> None:
    # Codex bot P1 on PR #105: module-level httpx.request was patched in
    # addition to Client.request, so module-level calls were recorded
    # twice (once by the module wrapper, once by the internal Client path
    # delegating to the still-patched Client.request), producing
    # cassettes ordered A,A,B,B. Now we only patch Client.request, which
    # catches both paths exactly once.
    cassette_path = tmp_path / "module_level.json"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"path": str(request.url.path)})

    original_request = httpx.request
    try:
        httpx.request = lambda method, url, **kwargs: httpx.Client(  # type: ignore[assignment]
            transport=httpx.MockTransport(handler)
        ).request(method, url, **kwargs)

        with Recorder(cassette_path, mode=RecordMode.RECORD):
            httpx.request("GET", "https://api.example.test/a")
            httpx.request("GET", "https://api.example.test/b")
    finally:
        httpx.request = original_request

    data = json.loads(cassette_path.read_text(encoding="utf-8"))
    assert len(data["interactions"]) == 2
    paths = [i["request"]["url"] for i in data["interactions"]]
    assert paths[0].endswith("/a")
    assert paths[1].endswith("/b")


def test_recorder_fully_redacts_scheme_less_authorization(tmp_path: Path) -> None:
    # Codex bot P1 on PR #109: a bare-token Authorization header (no whitespace,
    # no scheme prefix — e.g. a raw GitHub PAT or hex API key) was being
    # written back as "<secret> <REDACTED>" because the code took the
    # partition head as the "scheme" and kept it. The whole value IS the
    # credential in that case and must be redacted.
    cassette_path = tmp_path / "bare_token.json"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True})

    with Recorder(cassette_path, mode=RecordMode.RECORD):
        transport = httpx.MockTransport(handler)
        with httpx.Client(base_url="https://api.example.test", transport=transport) as client:
            client.get("/a", headers={"Authorization": "ghp_abcdef0123456789abcdef0123456789abcdef"})
            client.get("/b", headers={"Authorization": "0xdeadbeefcafe1234567890abcdef0123456789ab"})

    data = json.loads(cassette_path.read_text(encoding="utf-8"))
    headers = [i["request"]["headers"] for i in data["interactions"]]
    # Must be the fully-masked form — not `ghp_... <REDACTED>` which would leak.
    assert headers[0]["authorization"] == "<REDACTED>"
    assert headers[1]["authorization"] == "<REDACTED>"
    cassette_text = cassette_path.read_text(encoding="utf-8")
    assert "ghp_abcdef" not in cassette_text
    assert "0xdeadbeefcafe" not in cassette_text


def test_recorder_patches_async_client_request(tmp_path: Path) -> None:
    # Codex bot P2 on PR #105: AsyncClient was not patched, so async callers
    # (a common pattern in app adapters) hit the real network in REPLAY mode
    # and leaked external calls in RECORD mode. Patch AsyncClient.request too.
    import asyncio

    cassette_path = tmp_path / "async_client.json"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True, "path": str(request.url.path)})

    async def run_async_calls() -> None:
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(base_url="https://api.example.test", transport=transport) as client:
            await client.get("/async-a")
            await client.get("/async-b")

    with Recorder(cassette_path, mode=RecordMode.RECORD):
        asyncio.run(run_async_calls())

    data = json.loads(cassette_path.read_text(encoding="utf-8"))
    assert len(data["interactions"]) == 2
    paths = [i["request"]["url"] for i in data["interactions"]]
    assert paths[0].endswith("/async-a")
    assert paths[1].endswith("/async-b")
