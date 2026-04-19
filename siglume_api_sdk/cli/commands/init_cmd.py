from __future__ import annotations

from pathlib import Path

import click

from siglume_api_sdk.cli.project import render_json, write_init_template


@click.command("init")
@click.option(
    "--template",
    type=click.Choice(["echo", "price-compare", "publisher", "payment"], case_sensitive=False),
    default="echo",
    show_default=True,
)
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
@click.argument("path", required=False, default=".")
def init_command(template: str, json_output: bool, path: str) -> None:
    written = write_init_template(template, Path(path).resolve())
    payload = {
        "ok": True,
        "template": template,
        "files": [str(item) for item in written],
    }
    if json_output:
        click.echo(render_json(payload))
        return

    click.secho(f"Initialized Siglume starter template '{template}'.", fg="green")
    for file_path in written:
        click.echo(f"- {file_path}")
