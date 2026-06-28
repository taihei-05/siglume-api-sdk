from __future__ import annotations

import click

from siglume_api_sdk.cli.commands.scan_cmd import scan_path
from siglume_api_sdk.cli.project import render_json, run_registration


@click.command("register")
@click.option("--confirm", is_flag=True, help="Explicitly confirm the registration. This is the default unless --draft-only is set.")
@click.option("--private-confirm", is_flag=True, help="Confirm the registration for private production testing without publishing it.")
@click.option("--draft-only", is_flag=True, help="Create or refresh the draft without confirming publication.")
@click.option("--submit-review", is_flag=True, help="Legacy alias: publish immediately if your environment still routes through submit-review.")
@click.option("--yes", is_flag=True, help="Skip local scan confirmation prompts.")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
@click.argument("path", required=False, default=".")
def register_command(
    confirm: bool,
    private_confirm: bool,
    draft_only: bool,
    submit_review: bool,
    yes: bool,
    json_output: bool,
    path: str,
) -> None:
    if draft_only and confirm:
        raise click.ClickException("--draft-only cannot be combined with --confirm.")
    if draft_only and private_confirm:
        raise click.ClickException("--draft-only cannot be combined with --private-confirm.")
    if confirm and private_confirm:
        raise click.ClickException("--confirm cannot be combined with --private-confirm.")
    if draft_only and submit_review:
        raise click.ClickException("--draft-only cannot be combined with --submit-review.")
    if private_confirm and submit_review:
        raise click.ClickException("--private-confirm cannot be combined with --submit-review.")

    should_confirm = confirm or private_confirm or (not draft_only and not submit_review)
    confirm_visibility = "private" if private_confirm else "public"
    scan_result = scan_path(path)
    risky_publish = scan_result["risk_level"] != "clean" and (
        (confirm_visibility == "public" and should_confirm) or submit_review
    )
    if risky_publish and not yes and json_output:
        raise click.ClickException(
            "Local prompt-injection scan found suspicious capability metadata; "
            "review it or pass --yes to continue."
        )
    if risky_publish and not yes:
        click.secho(
            f"Local prompt-injection scan returned {scan_result['risk_level']}.",
            fg="yellow",
        )
        for pattern in scan_result["matched_patterns"]:
            click.echo(f"- {pattern}")
        click.confirm("Continue publishing anyway?", abort=True)
    result = run_registration(
        path,
        confirm=should_confirm,
        confirm_visibility=confirm_visibility,
        submit_review=submit_review,
    )
    result["local_prompt_injection_scan"] = scan_result
    if private_confirm and isinstance(result.get("confirmation"), dict) and not result["confirmation"].get("visibility"):
        result["confirmation"]["visibility"] = "private"
    if json_output:
        click.echo(render_json(result))
        return

    receipt = result["receipt"]
    registration_mode = receipt.get("registration_mode")
    confirmation_visibility = None
    if isinstance(result.get("confirmation"), dict):
        confirmation_visibility = result["confirmation"].get("visibility")
    published = confirmation_visibility != "private" and ("confirmation" in result or "review" in result)
    privately_confirmed = confirmation_visibility == "private"
    if privately_confirmed:
        click.secho("Registration privately confirmed.", fg="green")
    elif published and registration_mode == "upgrade":
        click.secho("Upgrade registered.", fg="green")
    elif published:
        click.secho("Registration accepted.", fg="green")
    elif registration_mode == "upgrade":
        click.secho("Upgrade staged.", fg="green")
    elif registration_mode == "refresh":
        click.secho("Draft refreshed.", fg="green")
    else:
        click.secho("Draft listing created.", fg="green")
    click.echo(f"listing_id: {receipt['listing_id']}")
    click.echo(f"receipt_status: {receipt['status']}")
    if receipt.get("listing_status"):
        click.echo(f"listing_status: {receipt['listing_status']}")
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
        if confirmation.get("visibility") == "private":
            click.secho("Listing confirmed privately for production testing.", fg="green")
        else:
            click.secho("Listing published.", fg="green")
        click.echo(f"confirmation_status: {confirmation['status']}")
        if confirmation.get("visibility"):
            click.echo(f"confirmation_visibility: {confirmation['visibility']}")
        release = confirmation.get("release")
        if isinstance(release, dict) and release.get("release_status"):
            click.echo(f"release_status: {release['release_status']}")
        click.echo(f"quality: {quality['grade']} ({quality['overall_score']}/100)")
    elif "review" in result:
        click.secho("Listing published via legacy submit-review alias.", fg="green")
        click.echo(f"publish_status: {result['review']['status']}")
    if result.get("submit_review_skipped"):
        click.echo("submit-review skipped: confirm-auto-register already submitted the listing.")
