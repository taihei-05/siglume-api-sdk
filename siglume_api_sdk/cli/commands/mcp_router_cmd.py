from __future__ import annotations

import json
import os
from typing import Any

import click
import httpx
from siglume_api_sdk import SiglumeClient
from siglume_api_sdk.cli.project import render_json

OWNER_KEY_HELP = (
    "Siglume provider API key (cli_...) issued at /owner/publish/advanced. "
    "This proves the registration owner; it is not the upstream MCP bearer token. "
    "Defaults to SIGLUME_API_KEY."
)

MCP_REGISTRY_SERVERS_URL = "https://registry.modelcontextprotocol.io/v0.1/servers"
MCP_PROTOCOL_VERSION = "2025-06-18"
_REGISTRY_REMOTE_TYPES = {"streamable-http", "sse"}
_HIGH_RISK_TERMS = (
    "ads",
    "advertising",
    "bank",
    "crypto",
    "diagnosis",
    "fdic",
    "finance",
    "financial",
    "health",
    "loan",
    "medical",
    "mortgage",
    "payment",
    "portfolio",
    "trading",
)


def _fetch_registry_page(
    *,
    registry_url: str,
    cursor: str | None,
    limit: int,
    timeout_s: float,
) -> dict[str, Any]:
    params: dict[str, object] = {"limit": limit}
    if cursor:
        params["cursor"] = cursor
    try:
        response = httpx.get(
            registry_url,
            params=params,
            timeout=timeout_s,
            headers={"Accept": "application/json", "User-Agent": "siglume-api-sdk/mcp-router-import"},
            follow_redirects=False,
        )
        response.raise_for_status()
        data = response.json()
    except Exception as exc:  # noqa: BLE001 - surface registry fetch failures as CLI errors.
        raise click.ClickException(f"Could not fetch MCP Registry page: {exc}") from exc
    return data if isinstance(data, dict) else {}


def _official_meta(item: dict[str, Any]) -> dict[str, Any]:
    meta = item.get("_meta")
    if not isinstance(meta, dict):
        return {}
    official = meta.get("io.modelcontextprotocol.registry/official")
    return official if isinstance(official, dict) else {}


def _is_latest_registry_item(item: dict[str, Any]) -> bool:
    official = _official_meta(item)
    # Some registry-like feeds omit the official metadata; keep those, but skip
    # explicit historical versions so batch imports do not register stale URLs.
    return official.get("isLatest") is not False


def _remote_requires_auth(remote: dict[str, Any]) -> bool:
    headers = remote.get("headers")
    if not isinstance(headers, list):
        return False
    for header in headers:
        if not isinstance(header, dict):
            continue
        name = str(header.get("name") or "").strip().lower()
        description = str(header.get("description") or "").strip().lower()
        if header.get("isRequired") is True:
            return True
        if name in {"authorization", "x-api-key", "api-key"}:
            return True
        if "api key" in description or "token" in description:
            return True
    return False


def _select_registry_remote(
    server: dict[str, Any],
    *,
    include_auth_required: bool,
) -> tuple[dict[str, Any] | None, str | None]:
    remotes = server.get("remotes")
    if not isinstance(remotes, list) or not remotes:
        return None, "no_remote"
    first_auth_required: dict[str, Any] | None = None
    for remote in remotes:
        if not isinstance(remote, dict):
            continue
        transport = str(remote.get("type") or "").strip().lower()
        url = str(remote.get("url") or "").strip()
        if transport not in _REGISTRY_REMOTE_TYPES:
            continue
        if not url.startswith("https://"):
            continue
        if "{" in url or "}" in url:
            continue
        if _remote_requires_auth(remote) and not include_auth_required:
            first_auth_required = first_auth_required or remote
            continue
        return remote, None
    if first_auth_required is not None:
        return None, "auth_required"
    return None, "no_supported_remote"


def _is_high_risk_registry_item(server: dict[str, Any]) -> bool:
    text = " ".join(
        str(server.get(key) or "")
        for key in ("name", "title", "description")
    ).lower()
    return any(term in text for term in _HIGH_RISK_TERMS)


def _registry_query_matches(server: dict[str, Any], query: str) -> bool:
    raw = query.strip().lower()
    if not raw:
        return True
    haystack = " ".join(
        str(server.get(key) or "")
        for key in ("name", "title", "description")
    ).lower()
    repository = server.get("repository")
    if isinstance(repository, dict):
        haystack += " " + str(repository.get("url") or "").lower()
    return all(term in haystack for term in raw.split())


def _candidate_from_registry_item(
    item: dict[str, Any],
    *,
    include_auth_required: bool,
    include_high_risk: bool,
) -> tuple[dict[str, Any] | None, str | None]:
    if not _is_latest_registry_item(item):
        return None, "not_latest"
    server = item.get("server")
    if not isinstance(server, dict):
        return None, "invalid_server"
    if _is_high_risk_registry_item(server) and not include_high_risk:
        return None, "high_risk"
    remote, reason = _select_registry_remote(server, include_auth_required=include_auth_required)
    if remote is None:
        return None, reason or "no_supported_remote"
    repository = server.get("repository")
    repository_url = repository.get("url") if isinstance(repository, dict) else None
    title = str(server.get("title") or "").strip()
    name = str(server.get("name") or "").strip()
    description = str(server.get("description") or "").strip()
    display_name = title or name
    return {
        "registry_name": name,
        "name": display_name[:255],
        "description": description or None,
        "base_url": str(remote.get("url") or "").strip(),
        "transport": str(remote.get("type") or "").strip(),
        "version": str(server.get("version") or "").strip() or None,
        "repository_url": repository_url,
        "requires_auth": _remote_requires_auth(remote),
    }, None


def _parse_mcp_response(response: httpx.Response) -> dict[str, Any]:
    text = response.text
    if "text/event-stream" in response.headers.get("content-type", ""):
        chunks = []
        for line in text.splitlines():
            if line.startswith("data:"):
                chunks.append(line[5:].strip())
        text = "\n".join(chunks)
    payload = json.loads(text or "{}")
    return payload if isinstance(payload, dict) else {}


def _mcp_post(
    client: httpx.Client,
    base_url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
) -> httpx.Response:
    response = client.post(base_url, json=payload, headers=headers)
    response.raise_for_status()
    return response


def _probe_mcp_tools(base_url: str, *, timeout_s: float) -> dict[str, Any]:
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        "User-Agent": "siglume-api-sdk/mcp-router-import",
    }
    try:
        with httpx.Client(timeout=timeout_s, follow_redirects=False, trust_env=False) as client:
            initialize = _mcp_post(
                client,
                base_url,
                {
                    "jsonrpc": "2.0",
                    "id": "initialize",
                    "method": "initialize",
                    "params": {
                        "protocolVersion": MCP_PROTOCOL_VERSION,
                        "capabilities": {},
                        "clientInfo": {"name": "Siglume MCP Router import", "version": "1.0"},
                    },
                },
                headers,
            )
            initialized = _parse_mcp_response(initialize)
            result = initialized.get("result") if isinstance(initialized.get("result"), dict) else {}
            protocol = str(result.get("protocolVersion") or "")
            if protocol and protocol != MCP_PROTOCOL_VERSION:
                return {"ok": False, "error": f"unsupported_protocol:{protocol}"}
            session_id = initialize.headers.get("Mcp-Session-Id") or initialize.headers.get("MCP-Session-Id")
            list_headers = dict(headers)
            if session_id:
                list_headers["Mcp-Session-Id"] = session_id
            try:
                _mcp_post(
                    client,
                    base_url,
                    {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
                    list_headers,
                )
            except Exception:
                pass
            tools_response = _mcp_post(
                client,
                base_url,
                {"jsonrpc": "2.0", "id": "tools-list", "method": "tools/list", "params": {}},
                list_headers,
            )
            tools_payload = _parse_mcp_response(tools_response)
            tools_result = tools_payload.get("result") if isinstance(tools_payload.get("result"), dict) else {}
            tools = tools_result.get("tools")
            if not isinstance(tools, list):
                return {"ok": False, "error": "tools_list_missing"}
            sample = [str(tool.get("name") or "") for tool in tools if isinstance(tool, dict)][:5]
            return {"ok": True, "tool_count": len(tools), "sample_tools": sample}
    except Exception as exc:  # noqa: BLE001 - probe failures should not abort the whole import.
        return {"ok": False, "error": str(exc)}


def _discover_registry_candidates(
    *,
    registry_url: str,
    query: str,
    limit: int,
    max_pages: int,
    page_size: int,
    include_auth_required: bool,
    include_high_risk: bool,
    probe: bool,
    timeout_s: float,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    candidates: list[dict[str, Any]] = []
    skip_counts: dict[str, int] = {}
    seen_urls: set[str] = set()
    cursor: str | None = None
    page_limit = max(1, min(page_size, 100))
    for _ in range(max(1, max_pages)):
        page = _fetch_registry_page(
            registry_url=registry_url,
            cursor=cursor,
            limit=page_limit,
            timeout_s=timeout_s,
        )
        items = page.get("servers")
        if not isinstance(items, list):
            break
        for raw_item in items:
            item = raw_item if isinstance(raw_item, dict) else {}
            server = item.get("server") if isinstance(item.get("server"), dict) else {}
            if not _registry_query_matches(server, query):
                skip_counts["query_mismatch"] = skip_counts.get("query_mismatch", 0) + 1
                continue
            candidate, reason = _candidate_from_registry_item(
                item,
                include_auth_required=include_auth_required,
                include_high_risk=include_high_risk,
            )
            if candidate is None:
                key = reason or "not_candidate"
                skip_counts[key] = skip_counts.get(key, 0) + 1
                continue
            base_url = str(candidate["base_url"]).lower()
            if base_url in seen_urls:
                skip_counts["duplicate_remote"] = skip_counts.get("duplicate_remote", 0) + 1
                continue
            seen_urls.add(base_url)
            if probe:
                probe_result = _probe_mcp_tools(str(candidate["base_url"]), timeout_s=timeout_s)
                candidate["probe"] = probe_result
                if not probe_result.get("ok"):
                    skip_counts["probe_failed"] = skip_counts.get("probe_failed", 0) + 1
                    continue
            candidates.append(candidate)
            if len(candidates) >= limit:
                return candidates, skip_counts
        metadata = page.get("metadata") if isinstance(page.get("metadata"), dict) else {}
        cursor = str(metadata.get("nextCursor") or "").strip() or None
        if not cursor:
            break
    return candidates, skip_counts


def _existing_mcp_router_urls(client: SiglumeClient) -> set[str]:
    urls: set[str] = set()
    for server in client.list_mcp_router_servers():
        if isinstance(server, dict):
            base_url = str(server.get("base_url") or "").strip().lower()
            if base_url:
                urls.add(base_url)
    return urls


def _register_registry_candidates(
    client: SiglumeClient,
    candidates: list[dict[str, Any]],
    *,
    jurisdiction: str,
    skip_existing: bool,
) -> list[dict[str, Any]]:
    existing_urls = _existing_mcp_router_urls(client) if skip_existing else set()
    results: list[dict[str, Any]] = []
    for candidate in candidates:
        base_url = str(candidate.get("base_url") or "").strip()
        if skip_existing and base_url.lower() in existing_urls:
            results.append({"candidate": candidate, "status": "skipped", "reason": "already_registered"})
            continue
        try:
            server = client.register_mcp_router_server(
                name=str(candidate.get("name") or candidate.get("registry_name") or "MCP Server")[:255],
                base_url=base_url,
                description=str(candidate.get("description") or "").strip() or None,
                upstream_auth_mode="none",
                monetization="free",
                currency="USD",
                jurisdiction=jurisdiction,
            )
            existing_urls.add(base_url.lower())
            results.append({"candidate": candidate, "status": "registered", "server": server})
        except Exception as exc:  # noqa: BLE001 - continue importing the rest.
            results.append({"candidate": candidate, "status": "failed", "error": str(exc)})
    return results


def _open_client(api_key: str | None, api_base_url: str | None) -> SiglumeClient:
    normalized_api_key = api_key.strip() if api_key else None
    if not normalized_api_key:
        raise click.ClickException(
            "Missing Siglume provider API key. Issue a cli_... key from "
            "Owner Console -> API keys (/owner/publish/advanced), then pass it "
            "with --api-key or set SIGLUME_API_KEY. This owner key is separate "
            "from the upstream MCP bearer token."
        )
    return SiglumeClient(
        api_key=normalized_api_key,
        base_url=(api_base_url.strip() if api_base_url else None),
    )


def _account_label(account: dict[str, Any]) -> str:
    email = str(account.get("email") or "").strip()
    name = str(account.get("display_name") or "").strip()
    user_id = str(account.get("user_id") or "").strip()
    if name and email:
        return f"{name} <{email}>"
    return email or name or user_id or "unknown account"


def _verify_owner(
    client: SiglumeClient,
    *,
    expect_owner_email: str,
    expect_owner_id: str,
) -> dict[str, Any]:
    account = client.get_mcp_router_account()
    actual_email = str(account.get("email") or "").strip().lower()
    actual_id = str(account.get("user_id") or "").strip()
    expected_email = expect_owner_email.strip().lower()
    expected_id = expect_owner_id.strip()
    if expected_email and actual_email != expected_email:
        raise click.ClickException(
            "Owner mismatch: API key resolves to "
            f"{_account_label(account)}, expected {expect_owner_email}."
        )
    if expected_id and actual_id != expected_id:
        raise click.ClickException(
            "Owner mismatch: API key resolves to user_id "
            f"{actual_id or 'unknown'}, expected {expect_owner_id}."
        )
    return account


def _resolve_bearer_secret(secret: str | None, secret_env: str | None) -> str | None:
    if secret_env:
        env_name = secret_env.strip()
        value = os.environ.get(env_name)
        if not value:
            raise click.ClickException(f"Environment variable {env_name} is empty or not set.")
        return value
    if secret:
        return secret
    return click.prompt("Upstream bearer token", hide_input=True)


def _billing_to_monetization(billing: str, sdrp: bool) -> str:
    if billing == "free":
        return "free"
    return "sdrp" if sdrp else "off_platform"


def _echo_account(account: dict[str, Any]) -> None:
    click.echo(f"account: {_account_label(account)}")
    if account.get("user_id"):
        click.echo(f"user_id: {account['user_id']}")
    if account.get("plan"):
        click.echo(f"plan: {account['plan']}")
    if account.get("status"):
        click.echo(f"status: {account['status']}")


def _echo_server(server: dict[str, Any]) -> None:
    click.echo(f"server_id: {server.get('id') or ''}")
    click.echo(f"name: {server.get('name') or ''}")
    click.echo(f"status: {server.get('status') or ''}")
    if server.get("short_id"):
        click.echo(f"short_id: {server['short_id']}")
    if server.get("base_url"):
        click.echo(f"mcp_url: {server['base_url']}")
    if server.get("monetization"):
        click.echo(f"billing_metadata: {server['monetization']}")


@click.group("mcp-router")
def mcp_router_command() -> None:
    """Register upstream MCP servers with a Siglume provider API key (cli_...)."""


@mcp_router_command.command("account")
@click.option(
    "--api-key",
    envvar="SIGLUME_API_KEY",
    default=None,
    help=OWNER_KEY_HELP,
)
@click.option(
    "--api-base-url",
    envvar="SIGLUME_API_BASE",
    default=None,
    help="Siglume API base URL. Defaults to SIGLUME_API_BASE or production.",
)
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
def account_command(api_key: str | None, api_base_url: str | None, json_output: bool) -> None:
    """Show the owner account resolved by the CLI/API key."""
    with _open_client(api_key, api_base_url) as client:
        account = client.get_mcp_router_account()
    if json_output:
        click.echo(render_json(account))
        return
    _echo_account(account)


@mcp_router_command.command("list")
@click.option(
    "--api-key",
    envvar="SIGLUME_API_KEY",
    default=None,
    help=OWNER_KEY_HELP,
)
@click.option(
    "--api-base-url",
    envvar="SIGLUME_API_BASE",
    default=None,
    help="Siglume API base URL. Defaults to SIGLUME_API_BASE or production.",
)
@click.option(
    "--expect-owner-email",
    default="",
    help="Fail if the API key belongs to another email.",
)
@click.option(
    "--expect-owner-id",
    default="",
    help="Fail if the API key belongs to another user id.",
)
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
def list_command(
    api_key: str | None,
    api_base_url: str | None,
    expect_owner_email: str,
    expect_owner_id: str,
    json_output: bool,
) -> None:
    """List MCP Router servers owned by the CLI/API key account."""
    with _open_client(api_key, api_base_url) as client:
        account = _verify_owner(
            client,
            expect_owner_email=expect_owner_email,
            expect_owner_id=expect_owner_id,
        )
        servers = client.list_mcp_router_servers()
    payload = {"account": account, "servers": servers}
    if json_output:
        click.echo(render_json(payload))
        return
    _echo_account(account)
    if not servers:
        click.echo("No MCP Router servers registered.")
        return
    for server in servers:
        click.echo("")
        _echo_server(server)


@mcp_router_command.command("register")
@click.option(
    "--api-key",
    envvar="SIGLUME_API_KEY",
    default=None,
    help=OWNER_KEY_HELP,
)
@click.option(
    "--api-base-url",
    envvar="SIGLUME_API_BASE",
    default=None,
    help="Siglume API base URL. Defaults to SIGLUME_API_BASE or production.",
)
@click.option(
    "--expect-owner-email",
    default="",
    help="Fail if the API key belongs to another email.",
)
@click.option(
    "--expect-owner-id",
    default="",
    help="Fail if the API key belongs to another user id.",
)
@click.option("--name", required=True, help="Display name for the upstream MCP server.")
@click.option("--mcp-url", required=True, help="HTTPS URL of the upstream MCP server.")
@click.option("--description", default="", help="Short provider-controlled description.")
@click.option(
    "--auth",
    "auth_mode",
    type=click.Choice(["none", "bearer"]),
    default="none",
    show_default=True,
)
@click.option(
    "--bearer-secret",
    default=None,
    help="Upstream bearer token. Prefer --bearer-secret-env.",
)
@click.option(
    "--bearer-secret-env",
    default=None,
    help="Environment variable containing the upstream bearer token.",
)
@click.option("--billing", type=click.Choice(["free", "paid"]), default="free", show_default=True)
@click.option(
    "--sdrp/--no-sdrp",
    default=False,
    show_default=True,
    help="Mark paid billing metadata as SDRP-capable.",
)
@click.option(
    "--currency",
    default="USD",
    show_default=True,
    help="Optional billing metadata currency.",
)
@click.option("--jurisdiction", default="US", show_default=True, help="Evaluation jurisdiction.")
@click.option("--yes", is_flag=True, help="Confirm registration without an interactive prompt.")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
def register_command(
    api_key: str | None,
    api_base_url: str | None,
    expect_owner_email: str,
    expect_owner_id: str,
    name: str,
    mcp_url: str,
    description: str,
    auth_mode: str,
    bearer_secret: str | None,
    bearer_secret_env: str | None,
    billing: str,
    sdrp: bool,
    currency: str,
    jurisdiction: str,
    yes: bool,
    json_output: bool,
) -> None:
    """Register an upstream MCP server under the cli_... owner account."""
    if json_output and not yes:
        raise click.ClickException(
            "Pass --yes with --json to confirm the owner-scoped registration."
        )
    with _open_client(api_key, api_base_url) as client:
        account = _verify_owner(
            client,
            expect_owner_email=expect_owner_email,
            expect_owner_id=expect_owner_id,
        )
        if not yes:
            _echo_account(account)
            click.confirm("Register this MCP server under the account above?", abort=True)
        secret = None
        if auth_mode == "bearer":
            secret = _resolve_bearer_secret(bearer_secret, bearer_secret_env)
        server = client.register_mcp_router_server(
            name=name,
            base_url=mcp_url,
            description=description.strip() or None,
            upstream_auth_mode=auth_mode,
            bearer_secret=secret,
            monetization=_billing_to_monetization(billing, sdrp),
            currency=currency,
            jurisdiction=jurisdiction,
        )
    payload = {"account": account, "server": server}
    if json_output:
        click.echo(render_json(payload))
        return
    click.secho("MCP Router server registered.", fg="green")
    _echo_server(server)


@mcp_router_command.command("import-registry")
@click.option(
    "--api-key",
    envvar="SIGLUME_API_KEY",
    default=None,
    help=OWNER_KEY_HELP,
)
@click.option(
    "--api-base-url",
    envvar="SIGLUME_API_BASE",
    default=None,
    help="Siglume API base URL. Defaults to SIGLUME_API_BASE or production.",
)
@click.option(
    "--expect-owner-email",
    default="",
    help="Fail if the API key belongs to another email.",
)
@click.option(
    "--expect-owner-id",
    default="",
    help="Fail if the API key belongs to another user id.",
)
@click.option(
    "--registry-url",
    default=MCP_REGISTRY_SERVERS_URL,
    show_default=True,
    help="MCP Registry servers endpoint to import from.",
)
@click.option("--query", default="", help="Optional search terms matched against registry name/title/description.")
@click.option("--limit", type=click.IntRange(1, 100), default=10, show_default=True, help="Maximum servers to register.")
@click.option("--max-pages", type=click.IntRange(1, 200), default=20, show_default=True, help="Registry pages to scan.")
@click.option("--page-size", type=click.IntRange(1, 100), default=100, show_default=True, help="Registry page size.")
@click.option(
    "--include-auth-required",
    is_flag=True,
    help="Include registry remotes that declare required auth headers. These still register with auth=none.",
)
@click.option(
    "--include-high-risk",
    is_flag=True,
    help="Include finance, medical, advertising, crypto, payment, and trading-like servers.",
)
@click.option("--probe/--no-probe", default=True, show_default=True, help="Probe initialize + tools/list before import.")
@click.option("--timeout", "timeout_s", type=float, default=8.0, show_default=True, help="Registry/probe timeout seconds.")
@click.option("--skip-existing/--no-skip-existing", default=True, show_default=True, help="Skip already-owned matching URLs.")
@click.option("--jurisdiction", default="US", show_default=True, help="Evaluation jurisdiction for Siglume registration.")
@click.option(
    "--dry-run",
    is_flag=True,
    help="Only discover and probe candidates; do not register them.",
)
@click.option("--yes", is_flag=True, help="Confirm automatic registrations without an interactive prompt.")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
def import_registry_command(
    api_key: str | None,
    api_base_url: str | None,
    expect_owner_email: str,
    expect_owner_id: str,
    registry_url: str,
    query: str,
    limit: int,
    max_pages: int,
    page_size: int,
    include_auth_required: bool,
    include_high_risk: bool,
    probe: bool,
    timeout_s: float,
    skip_existing: bool,
    jurisdiction: str,
    dry_run: bool,
    yes: bool,
    json_output: bool,
) -> None:
    """Import live remote MCP servers from the official MCP Registry."""
    candidates, skip_counts = _discover_registry_candidates(
        registry_url=registry_url,
        query=query,
        limit=limit,
        max_pages=max_pages,
        page_size=page_size,
        include_auth_required=include_auth_required,
        include_high_risk=include_high_risk,
        probe=probe,
        timeout_s=max(1.0, timeout_s),
    )
    if dry_run:
        payload = {"dry_run": True, "candidates": candidates, "skip_counts": skip_counts}
        if json_output:
            click.echo(render_json(payload))
            return
        click.echo(f"Discovered {len(candidates)} importable MCP Registry candidates.")
        if skip_counts:
            click.echo(f"Skipped: {render_json(skip_counts)}")
        for candidate in candidates:
            click.echo("")
            click.echo(f"name: {candidate.get('name') or candidate.get('registry_name')}")
            click.echo(f"mcp_url: {candidate.get('base_url')}")
            if candidate.get("probe"):
                probe_result = candidate["probe"]
                click.echo(f"tools: {probe_result.get('tool_count', 0)}")
        click.echo("")
        click.echo("Dry run only. Re-run without --dry-run to register these servers.")
        return

    if json_output and not yes:
        raise click.ClickException("Pass --yes with --json to confirm automatic registry import.")
    if not candidates:
        payload = {"registered": [], "skip_counts": skip_counts}
        if json_output:
            click.echo(render_json(payload))
            return
        click.echo("No importable MCP Registry candidates found.")
        if skip_counts:
            click.echo(f"Skipped: {render_json(skip_counts)}")
        return

    with _open_client(api_key, api_base_url) as client:
        account = _verify_owner(
            client,
            expect_owner_email=expect_owner_email,
            expect_owner_id=expect_owner_id,
        )
        if not yes:
            _echo_account(account)
            click.confirm(
                f"Automatically register {len(candidates)} MCP Registry candidates under this account?",
                abort=True,
            )
        results = _register_registry_candidates(
            client,
            candidates,
            jurisdiction=jurisdiction,
            skip_existing=skip_existing,
        )
    payload = {
        "account": account,
        "results": results,
        "skip_counts": skip_counts,
        "registered_count": sum(1 for item in results if item.get("status") == "registered"),
        "failed_count": sum(1 for item in results if item.get("status") == "failed"),
        "skipped_count": sum(1 for item in results if item.get("status") == "skipped"),
    }
    if json_output:
        click.echo(render_json(payload))
        return
    _echo_account(account)
    click.echo("")
    click.echo(
        "MCP Registry import finished: "
        f"{payload['registered_count']} registered, "
        f"{payload['skipped_count']} skipped, "
        f"{payload['failed_count']} failed."
    )
    for result in results:
        candidate = result.get("candidate") if isinstance(result.get("candidate"), dict) else {}
        click.echo("")
        click.echo(f"{result.get('status')}: {candidate.get('name') or candidate.get('registry_name')}")
        click.echo(f"mcp_url: {candidate.get('base_url')}")
        if result.get("server"):
            _echo_server(result["server"])
        if result.get("reason"):
            click.echo(f"reason: {result['reason']}")
        if result.get("error"):
            click.echo(f"error: {result['error']}")


@mcp_router_command.command("unregister")
@click.argument("server_id")
@click.option(
    "--api-key",
    envvar="SIGLUME_API_KEY",
    default=None,
    help=OWNER_KEY_HELP,
)
@click.option(
    "--api-base-url",
    envvar="SIGLUME_API_BASE",
    default=None,
    help="Siglume API base URL. Defaults to SIGLUME_API_BASE or production.",
)
@click.option(
    "--expect-owner-email",
    default="",
    help="Fail if the API key belongs to another email.",
)
@click.option(
    "--expect-owner-id",
    default="",
    help="Fail if the API key belongs to another user id.",
)
@click.option("--yes", is_flag=True, help="Confirm unregister without an interactive prompt.")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
def unregister_command(
    server_id: str,
    api_key: str | None,
    api_base_url: str | None,
    expect_owner_email: str,
    expect_owner_id: str,
    yes: bool,
    json_output: bool,
) -> None:
    """Unregister an MCP Router server owned by the CLI/API key account."""
    if json_output and not yes:
        raise click.ClickException("Pass --yes with --json to confirm unregister.")
    with _open_client(api_key, api_base_url) as client:
        account = _verify_owner(
            client,
            expect_owner_email=expect_owner_email,
            expect_owner_id=expect_owner_id,
        )
        if not yes:
            _echo_account(account)
            click.confirm(
                f"Unregister MCP Router server {server_id} under the account above?",
                abort=True,
            )
        server = client.unregister_mcp_router_server(server_id)
    payload = {"account": account, "server": server}
    if json_output:
        click.echo(render_json(payload))
        return
    click.secho("MCP Router server unregistered.", fg="green")
    _echo_server(server)
