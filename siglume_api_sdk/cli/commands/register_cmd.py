from __future__ import annotations

import click

from siglume_api_sdk.cli.project import render_json, run_registration


@click.command("register")
@click.option("--confirm", is_flag=True, help="Confirm the draft registration immediately and submit it for review.")
@click.option("--submit-review", is_flag=True, help="Submit the draft for review if --confirm is not used.")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
@click.argument("path", required=False, default=".")
def register_command(confirm: bool, submit_review: bool, json_output: bool, path: str) -> None:
    result = run_registration(path, confirm=confirm, submit_review=submit_review)
    if json_output:
        click.echo(render_json(result))
        return

    receipt = result["receipt"]
    click.secho("Draft listing created.", fg="green")
    click.echo(f"listing_id: {receipt['listing_id']}")
    click.echo(f"status: {receipt['status']}")
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
        click.secho("Confirmed and submitted for review.", fg="green")
        click.echo(f"status: {confirmation['status']}")
        click.echo(f"quality: {quality['grade']} ({quality['overall_score']}/100)")
    elif "review" in result:
        click.secho("Submitted for review.", fg="green")
        click.echo(f"status: {result['review']['status']}")
    if result.get("submit_review_skipped"):
        click.echo("submit-review skipped: confirm-auto-register already submitted the listing.")
