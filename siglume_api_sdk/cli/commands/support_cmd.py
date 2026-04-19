from __future__ import annotations

import click

from siglume_api_sdk.cli.project import create_support_case_report, render_json


@click.group("support")
def support_command() -> None:
    """Support-case workflows."""


@support_command.command("create")
@click.option("--trace-id", default=None, help="Attach a trace_id from a failed API flow.")
@click.option("--subject", required=True, help="Short summary of the issue.")
@click.option("--body", required=True, help="Detailed support case body.")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
def support_create_command(trace_id: str | None, subject: str, body: str, json_output: bool) -> None:
    report = create_support_case_report(subject=subject, body=body, trace_id=trace_id)
    if json_output:
        click.echo(render_json(report))
        return
    case = report["case"]
    click.secho("Support case created.", fg="green")
    click.echo(f"case_id: {case['support_case_id']}")
    click.echo(f"status: {case['status']}")
