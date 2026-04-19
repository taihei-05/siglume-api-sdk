from __future__ import annotations

import click

from siglume_api_sdk.cli.project import render_json, run_harness


@click.command("test")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
@click.argument("path", required=False, default=".")
def test_command(json_output: bool, path: str) -> None:
    report = run_harness(path)
    if json_output:
        click.echo(render_json(report))
    else:
        click.secho("Harness passed." if report["ok"] else "Harness failed.", fg="green" if report["ok"] else "red")
        click.echo(f"Adapter: {report['adapter_path']}")
        click.echo(f"Task type: {report['task_type']}")
        for check in report["checks"]:
            status = "OK" if check["ok"] else "FAIL"
            color = "green" if check["ok"] else "red"
            click.secho(f"{status} {check['name']}", fg=color)
    if not report["ok"]:
        raise SystemExit(1)
