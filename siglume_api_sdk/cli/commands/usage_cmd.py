from __future__ import annotations

import click

from siglume_api_sdk.cli.project import get_usage_report, render_json


@click.command("usage")
@click.option("--capability", "capability_key", default=None, help="Filter by capability_key.")
@click.option("--window", default="30d", show_default=True, help="Pass-through period_key sent to /market/usage.")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
def usage_command(capability_key: str | None, window: str, json_output: bool) -> None:
    report = get_usage_report(capability_key=capability_key, window=window)
    if json_output:
        click.echo(render_json(report))
        return

    click.secho(f"Usage events: {report['count']}", fg="green")
    for item in report["items"]:
        click.echo(
            f"- {item.get('created_at') or 'unknown'} "
            f"{item.get('capability_key') or '-'} "
            f"{item.get('outcome') or '-'} "
            f"units={item.get('units_consumed', 0)}"
        )
