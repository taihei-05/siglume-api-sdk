from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any

import click

from siglume_api_sdk.diff import Change, ChangeLevel, diff_manifest, diff_tool_manual


_CAPABILITY_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$")
_MANIFEST_REQUIRED_KEYS = {
    "capability_key",
    "name",
    "job_to_be_done",
    "permission_class",
    "approval_mode",
    "dry_run_supported",
    "required_connected_accounts",
    "price_model",
    "jurisdiction",
}
_TOOL_MANUAL_REQUIRED_KEYS = {
    "tool_name",
    "job_to_be_done",
    "summary_for_model",
    "trigger_conditions",
    "do_not_use_when",
    "permission_class",
    "dry_run_supported",
    "requires_connected_accounts",
    "input_schema",
    "output_schema",
    "usage_hints",
    "result_hints",
    "error_hints",
}


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
    if not _MANIFEST_REQUIRED_KEYS.issubset(payload):
        return False
    if not isinstance(payload.get("capability_key"), str) or not _CAPABILITY_KEY_RE.match(payload["capability_key"]):
        return False
    if not isinstance(payload.get("name"), str) or not payload["name"].strip():
        return False
    if not isinstance(payload.get("job_to_be_done"), str) or not payload["job_to_be_done"].strip():
        return False
    if not isinstance(payload.get("permission_class"), str):
        return False
    if not isinstance(payload.get("approval_mode"), str):
        return False
    if not isinstance(payload.get("dry_run_supported"), bool):
        return False
    if not isinstance(payload.get("required_connected_accounts"), list):
        return False
    if not isinstance(payload.get("price_model"), str):
        return False
    if not isinstance(payload.get("jurisdiction"), str) or not payload["jurisdiction"].strip():
        return False
    return True


def _is_tool_manual_payload(payload: dict[str, Any]) -> bool:
    if not _TOOL_MANUAL_REQUIRED_KEYS.issubset(payload):
        return False
    if not isinstance(payload.get("tool_name"), str) or not payload["tool_name"].strip():
        return False
    if not isinstance(payload.get("job_to_be_done"), str) or not payload["job_to_be_done"].strip():
        return False
    if not isinstance(payload.get("summary_for_model"), str) or not payload["summary_for_model"].strip():
        return False
    if not isinstance(payload.get("permission_class"), str):
        return False
    if not isinstance(payload.get("dry_run_supported"), bool):
        return False
    if not isinstance(payload.get("trigger_conditions"), list):
        return False
    if not isinstance(payload.get("do_not_use_when"), list):
        return False
    if not isinstance(payload.get("requires_connected_accounts"), list):
        return False
    if not isinstance(payload.get("usage_hints"), list):
        return False
    if not isinstance(payload.get("result_hints"), list):
        return False
    if not isinstance(payload.get("error_hints"), list):
        return False
    if not isinstance(payload.get("input_schema"), dict):
        return False
    if not isinstance(payload.get("output_schema"), dict):
        return False
    return True


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
