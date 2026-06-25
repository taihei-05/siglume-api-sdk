from __future__ import annotations

import click

from siglume_api_sdk.cli.project import render_json, run_preflight


@click.command("preflight")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
@click.argument("path", required=False, default=".")
def preflight_command(json_output: bool, path: str) -> None:
    """Run registration checks without creating or publishing a draft."""
    result = run_preflight(path)
    if json_output:
        click.echo(render_json(result))
        return

    click.secho("Preflight passed.", fg="green")
    preflight = result.get("registration_preflight")
    if isinstance(preflight, dict) and preflight.get("remote_quality"):
        quality = preflight["remote_quality"]
        if isinstance(quality, dict):
            click.echo(f"preflight_quality: {quality.get('grade')} ({quality.get('overall_score')}/100)")
    if result.get("runtime_validation_path"):
        click.echo(f"runtime_validation_path: {result['runtime_validation_path']}")
