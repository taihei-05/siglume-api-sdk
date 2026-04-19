from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any

import click

from siglume_api_sdk.diff import Change, ChangeLevel, diff_manifest, diff_tool_manual


_CAPABILITY_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$")


@click.command("diff")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
@click.argument("old_path")
@click.argument("new_path")
def diff_command(json_output: bool, old_path: str, new_path: str) -> None:
    old_payload = _load_json_file(old_path)
    new_payload = _load_json_file(new_path)
    kind = _detect_kind(old_payload, new_payload)
    changes = diff_manifest(old=old_payload, new=new_payload) if kind == "manifest" else diff_tool_manual(old=old_payload, new=new_payload)
    summary = _build_summary(kind, changes, old_path, new_path)

    if json_output:
        click.echo(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        _render_text(summary)

    raise SystemExit(summary["exit_code"])


def _load_json_file(path: str) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise click.ClickException(f"{path} must contain a top-level JSON object.")
    return payload


def _detect_kind(old_payload: dict[str, Any], new_payload: dict[str, Any]) -> str:
    old_kind = _payload_kind(old_payload)
    new_kind = _payload_kind(new_payload)
    if old_kind != new_kind:
        raise click.ClickException("Both files must be the same document type (manifest or tool_manual).")
    if old_kind is None:
        raise click.ClickException("Could not detect document type. Expected AppManifest or ToolManual JSON.")
    return old_kind


def _payload_kind(payload: dict[str, Any]) -> str | None:
    if _is_manifest_payload(payload):
        return "manifest"
    if _is_tool_manual_payload(payload):
        return "tool_manual"
    return None


def _is_manifest_payload(payload: dict[str, Any]) -> bool:
    # Identify AppManifest by its unique capability_key (format-checked).
    # Other fields have defaults in the dataclass, so requiring them would
    # reject legitimate minimal / legacy manifests; the diff engine already
    # normalizes missing defaults.
    key = payload.get("capability_key")
    return isinstance(key, str) and bool(_CAPABILITY_KEY_RE.match(key))


def _is_tool_manual_payload(payload: dict[str, Any]) -> bool:
    # Identify ToolManual by tool_name. AppManifest has no tool_name field,
    # so this is unambiguous against manifests. Optional fields are not
    # required for discrimination — the diff engine fills in defaults.
    tool_name = payload.get("tool_name")
    return isinstance(tool_name, str) and bool(tool_name.strip())


def _build_summary(kind: str, changes: list[Change], old_path: str, new_path: str) -> dict[str, Any]:
    counts = {
        "breaking": sum(1 for change in changes if change.level == ChangeLevel.BREAKING),
        "warning": sum(1 for change in changes if change.level == ChangeLevel.WARNING),
        "info": sum(1 for change in changes if change.level == ChangeLevel.INFO),
    }
    exit_code = 1 if counts["breaking"] else 2 if counts["warning"] else 0
    return {
        "kind": kind,
        "old_path": str(Path(old_path)),
        "new_path": str(Path(new_path)),
        "exit_code": exit_code,
        "counts": counts,
        "changes": [change.to_dict() for change in changes],
    }


def _render_text(summary: dict[str, Any]) -> None:
    if not summary["changes"]:
        click.echo("No differences detected.")
        return
    for level in (ChangeLevel.BREAKING.value, ChangeLevel.WARNING.value, ChangeLevel.INFO.value):
        items = [item for item in summary["changes"] if item["level"] == level]
        if not items:
            continue
        click.secho(level.upper(), bold=True)
        for item in items:
            click.echo(f"- {item['path']}: {item['message']}")
        click.echo("")
