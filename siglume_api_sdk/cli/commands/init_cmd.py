from __future__ import annotations

from pathlib import Path

import click

from siglume_api_sdk.cli.project import (
    list_operation_catalog,
    render_json,
    write_init_template,
    write_operation_template,
)


TEMPLATE_CHOICES = ("echo", "price-compare", "publisher", "payment")


def _render_operation_table(operations: list[dict[str, object]]) -> str:
    rows = [
        (
            str(item.get("operation_key") or ""),
            str(item.get("permission_class") or "read-only"),
            str(item.get("summary") or ""),
        )
        for item in operations
    ]
    headers = ("operation_key", "permission_class", "summary")
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in rows)) if rows else len(headers[index])
        for index in range(len(headers))
    ]
    lines = [
        "  ".join(headers[index].ljust(widths[index]) for index in range(len(headers))),
        "  ".join("-" * widths[index] for index in range(len(headers))),
    ]
    for row in rows:
        lines.append("  ".join(row[index].ljust(widths[index]) for index in range(len(headers))))
    return "\n".join(lines)


@click.command("init")
@click.option(
    "--template",
    type=click.Choice(TEMPLATE_CHOICES, case_sensitive=False),
    default=None,
    help="Starter template name for the legacy scaffold flow.",
)
@click.option("--from-operation", "operation_key", help="Generate an AppAdapter wrapper for a first-party owner operation.")
@click.option("--list-operations", is_flag=True, help="List owner operations available for template generation.")
@click.option("--capability-key", help="Override the generated manifest capability_key when using --from-operation.")
@click.option("--agent-id", help="Target owner agent_id used to resolve operation metadata and seed defaults.")
@click.option("--lang", default="en", show_default=True, help="Catalog language when querying live owner operations.")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
@click.argument("path", required=False, default=".")
def init_command(
    template: str | None,
    operation_key: str | None,
    list_operations: bool,
    capability_key: str | None,
    agent_id: str | None,
    lang: str,
    json_output: bool,
    path: str,
) -> None:
    if list_operations and operation_key:
        raise click.ClickException("Choose either --list-operations or --from-operation, not both.")
    if list_operations and capability_key:
        raise click.ClickException("--capability-key is only valid together with --from-operation.")
    if template and (list_operations or operation_key):
        raise click.ClickException("--template cannot be combined with --list-operations or --from-operation.")

    if list_operations:
        payload = {"ok": True, **list_operation_catalog(agent_id=agent_id, lang=lang)}
        if json_output:
            click.echo(render_json(payload))
            return
        if payload.get("warning"):
            click.secho(str(payload["warning"]), fg="yellow")
        operations = payload["operations"] if isinstance(payload.get("operations"), list) else []
        click.echo(f"Owner operation catalog ({payload.get('source', 'fallback')})")
        click.echo(_render_operation_table([item for item in operations if isinstance(item, dict)]))
        return

    if operation_key:
        written, operation, report = write_operation_template(
            operation_key,
            Path(path).resolve(),
            capability_key_override=capability_key,
            agent_id=agent_id,
            lang=lang,
        )
        payload = {
            "ok": True,
            "mode": "from-operation",
            "operation": render_jsonable_operation(operation),
            "files": [str(item) for item in written],
            "report": report,
        }
        if json_output:
            click.echo(render_json(payload))
            return
        warning = report.get("warning")
        if warning:
            click.secho(str(warning), fg="yellow")
        quality = report.get("quality") if isinstance(report.get("quality"), dict) else {}
        click.secho(f"Generated wrapper for '{operation.operation_key}'.", fg="green")
        click.echo(f"grade: {quality.get('grade', '?')} ({quality.get('overall_score', '?')}/100)")
        for file_path in written:
            click.echo(f"- {file_path}")
        return

    resolved_template = template or "echo"
    written = write_init_template(resolved_template, Path(path).resolve())
    payload = {
        "ok": True,
        "mode": "template",
        "template": resolved_template,
        "files": [str(item) for item in written],
    }
    if json_output:
        click.echo(render_json(payload))
        return

    click.secho(f"Initialized Siglume starter template '{resolved_template}'.", fg="green")
    for file_path in written:
        click.echo(f"- {file_path}")


def render_jsonable_operation(operation: object) -> dict[str, object]:
    if hasattr(operation, "__dict__"):
        return {
            str(key): value
            for key, value in vars(operation).items()
            if not str(key).startswith("_")
        }
    return {"operation": str(operation)}
