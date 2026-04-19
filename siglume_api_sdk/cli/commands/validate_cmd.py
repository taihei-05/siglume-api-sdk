from __future__ import annotations

import click

from siglume_api_sdk.cli.project import render_json, validate_project


@click.command("validate")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
@click.argument("path", required=False, default=".")
def validate_command(json_output: bool, path: str) -> None:
    report = validate_project(path)
    if json_output:
        click.echo(render_json(report))
    else:
        click.secho("Validation passed." if report["ok"] else "Validation failed.", fg="green" if report["ok"] else "red")
        click.echo(f"Adapter: {report['adapter_path']}")
        if report["manifest_issues"]:
            click.echo("Manifest issues:")
            for issue in report["manifest_issues"]:
                click.echo(f"- {issue}")
        click.echo("Tool manual structure:")
        click.echo("  valid" if report["tool_manual_valid"] else "  invalid")
        for issue in report["tool_manual_issues"]:
            click.echo(f"- [{issue['severity']}] {issue.get('field') or 'manual'}: {issue['message']}")
        quality = report["remote_quality"]
        click.echo(f"Remote quality: {quality['grade']} ({quality['overall_score']}/100)")
        for issue in quality["issues"]:
            click.echo(f"- [{issue['severity']}] {issue.get('field') or issue.get('code')}: {issue['message']}")
    if not report["ok"]:
        raise SystemExit(1)
