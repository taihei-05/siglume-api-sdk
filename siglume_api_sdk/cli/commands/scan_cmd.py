from __future__ import annotations

import json
from pathlib import Path

import click

from siglume_api_sdk.cli.project import load_project, render_json, tool_manual_to_dict, to_jsonable
from siglume_api_sdk.injection_scanner import load_manifest_file, scan_manifest_payload


@click.command("scan")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
@click.argument("path")
def scan_command(json_output: bool, path: str) -> None:
    """Scan local manifest metadata for prompt-injection patterns."""
    result = scan_path(path)
    if json_output:
        click.echo(render_json(result))
        return
    risk = result["risk_level"]
    color = "green" if risk == "clean" else "yellow" if risk == "suspicious" else "red"
    click.secho(f"risk_level: {risk}", fg=color)
    for pattern in result["matched_patterns"]:
        click.echo(f"- {pattern}")


def scan_path(path: str) -> dict[str, object]:
    target = Path(path)
    if target.is_dir():
        project = load_project(target)
        manifest_payload = to_jsonable(project.manifest)
        tool_manual_payload = tool_manual_to_dict(project.tool_manual)
    else:
        manifest_payload = load_manifest_file(target)
        tool_manual_payload = _load_sibling_tool_manual(target)
    result = scan_manifest_payload(manifest_payload, tool_manual_payload)
    return result.to_dict()


def _load_sibling_tool_manual(manifest_path: Path) -> dict[str, object]:
    for name in ("tool_manual.json", "tool-manual.json"):
        candidate = manifest_path.parent / name
        if not candidate.exists():
            continue
        payload = json.loads(candidate.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
    return {}
