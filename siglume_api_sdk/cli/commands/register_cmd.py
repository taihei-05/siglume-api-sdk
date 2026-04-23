from __future__ import annotations

import click

from siglume_api_sdk.cli.project import render_json, run_registration


@click.command("register")
@click.option("--confirm", is_flag=True, help="Confirm the registration and publish it when the self-serve checks pass.")
@click.option("--submit-review", is_flag=True, help="Legacy alias: publish immediately if your environment still routes through submit-review.")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
@click.argument("path", required=False, default=".")
def register_command(confirm: bool, submit_review: bool, json_output: bool, path: str) -> None:
    result = run_registration(path, confirm=confirm, submit_review=submit_review)
    if json_output:
        click.echo(render_json(result))
        return

    receipt = result["receipt"]
    registration_mode = receipt.get("registration_mode")
    if registration_mode == "upgrade":
        click.secho("Upgrade staged.", fg="green")
    elif registration_mode == "refresh":
        click.secho("Draft refreshed.", fg="green")
    else:
        click.secho("Draft listing created.", fg="green")
    click.echo(f"listing_id: {receipt['listing_id']}")
    click.echo(f"receipt_status: {receipt['status']}")
    if receipt.get("listing_status"):
        click.echo(f"listing_status: {receipt['listing_status']}")
    if receipt.get("oauth_status"):
        oauth_status = receipt["oauth_status"]
        if isinstance(oauth_status, dict):
            click.echo(f"oauth_configured: {bool(oauth_status.get('configured'))}")
    if receipt.get("review_url"):
        click.echo(f"review_url: {receipt['review_url']}")
    if receipt.get("trace_id"):
        click.echo(f"trace_id: {receipt['trace_id']}")
    if receipt.get("request_id"):
        click.echo(f"request_id: {receipt['request_id']}")
    preflight = result.get("registration_preflight")
    if isinstance(preflight, dict) and preflight.get("remote_quality"):
        quality = preflight["remote_quality"]
        if isinstance(quality, dict):
            click.echo(f"preflight_quality: {quality.get('grade')} ({quality.get('overall_score')}/100)")
    if "confirmation" in result:
        confirmation = result["confirmation"]
        quality = confirmation["quality"]
        click.secho("Listing published.", fg="green")
        click.echo(f"confirmation_status: {confirmation['status']}")
        release = confirmation.get("release")
        if isinstance(release, dict) and release.get("release_status"):
            click.echo(f"release_status: {release['release_status']}")
        click.echo(f"quality: {quality['grade']} ({quality['overall_score']}/100)")
    elif "review" in result:
        click.secho("Listing published via legacy submit-review alias.", fg="green")
        click.echo(f"publish_status: {result['review']['status']}")
    if result.get("submit_review_skipped"):
        click.echo("submit-review skipped: confirm-auto-register already submitted the listing.")
