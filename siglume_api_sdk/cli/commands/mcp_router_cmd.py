from __future__ import annotations

import os
from typing import Any

import click
from siglume_api_sdk import SiglumeClient
from siglume_api_sdk.cli.project import render_json

OWNER_KEY_HELP = (
    "Siglume provider API key (cli_...) issued at /owner/publish/advanced. "
    "This proves the registration owner; it is not the upstream MCP bearer token. "
    "Defaults to SIGLUME_API_KEY."
)


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
