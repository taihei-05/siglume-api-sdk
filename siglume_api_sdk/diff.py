from __future__ import annotations

from dataclasses import asdict, dataclass, is_dataclass
from enum import Enum
from typing import Any, Mapping


class ChangeLevel(str, Enum):
    BREAKING = "breaking"
    WARNING = "warning"
    INFO = "info"


BreakingChange = ChangeLevel.BREAKING


@dataclass(frozen=True)
class Change:
    level: ChangeLevel
    path: str
    old: Any
    new: Any
    message: str

    @property
    def is_breaking(self) -> bool:
        return self.level == ChangeLevel.BREAKING

    def to_dict(self) -> dict[str, Any]:
        return {
            "level": self.level.value,
            "path": self.path,
            "old": self.old,
            "new": self.new,
            "message": self.message,
            "is_breaking": self.is_breaking,
        }


_MANIFEST_PERMISSION_ORDER = {
    "read-only": 0,
    "recommendation": 0,
    "action": 1,
    "payment": 2,
}
_TOOL_MANUAL_PERMISSION_ORDER = {
    "read_only": 0,
    "action": 1,
    "payment": 2,
}
_SPECIAL_MANIFEST_KEYS = {
    "version",
    "name",
    "short_description",
    "permission_class",
    "price_model",
    "currency",
    "jurisdiction",
}
_SPECIAL_TOOL_MANUAL_KEYS = {
    "input_schema",
    "output_schema",
    "permission_class",
    "settlement_mode",
    "currency",
    "side_effect_summary",
    "jurisdiction",
    "trigger_conditions",
    "do_not_use_when",
    "approval_summary_template",
}


def diff_manifest(*, old: Any, new: Any) -> list[Change]:
    old_payload = _normalize_manifest(old)
    new_payload = _normalize_manifest(new)
    changes: list[Change] = []
    emitted_keys: set[str] = set()

    _append_permission_class_change(
        changes,
        emitted_keys,
        key="permission_class",
        old_value=old_payload.get("permission_class"),
        new_value=new_payload.get("permission_class"),
        rank_map=_MANIFEST_PERMISSION_ORDER,
        escalate_message="Manifest permission_class escalated; existing callers may now require stronger approval.",
        downgrade_message="Manifest permission_class downgraded.",
    )
    _append_value_change(
        changes,
        emitted_keys,
        level=ChangeLevel.BREAKING,
        key="price_model",
        old_value=old_payload.get("price_model"),
        new_value=new_payload.get("price_model"),
        message="Manifest price_model changed; billing compatibility may break existing installs.",
    )
    _append_value_change(
        changes,
        emitted_keys,
        level=ChangeLevel.BREAKING,
        key="currency",
        old_value=old_payload.get("currency"),
        new_value=new_payload.get("currency"),
        message="Manifest currency changed.",
    )
    _append_value_change(
        changes,
        emitted_keys,
        level=ChangeLevel.BREAKING,
        key="jurisdiction",
        old_value=old_payload.get("jurisdiction"),
        new_value=new_payload.get("jurisdiction"),
        message="Manifest jurisdiction changed.",
    )
    _append_value_change(
        changes,
        emitted_keys,
        level=ChangeLevel.INFO,
        key="version",
        old_value=old_payload.get("version"),
        new_value=new_payload.get("version"),
        message="Manifest version changed.",
    )
    _append_value_change(
        changes,
        emitted_keys,
        level=ChangeLevel.INFO,
        key="name",
        old_value=old_payload.get("name"),
        new_value=new_payload.get("name"),
        message="Manifest display name changed.",
    )
    _append_value_change(
        changes,
        emitted_keys,
        level=ChangeLevel.INFO,
        key="short_description",
        old_value=old_payload.get("short_description"),
        new_value=new_payload.get("short_description"),
        message="Manifest short_description changed.",
    )

    for key in sorted(set(old_payload) | set(new_payload)):
        if key in emitted_keys or key in _SPECIAL_MANIFEST_KEYS:
            continue
        old_value = old_payload.get(key)
        new_value = new_payload.get(key)
        if _values_differ(old_value, new_value):
            changes.append(
                Change(
                    level=ChangeLevel.INFO,
                    path=key,
                    old=old_value,
                    new=new_value,
                    message=f"Manifest field '{key}' changed.",
                )
            )

    return _sort_changes(changes)


def diff_tool_manual(*, old: Any, new: Any) -> list[Change]:
    old_payload = _normalize_tool_manual(old)
    new_payload = _normalize_tool_manual(new)
    changes: list[Change] = []
    emitted_keys: set[str] = set()

    old_required = _string_list(_mapping(old_payload.get("input_schema")).get("required"))
    new_required = _string_list(_mapping(new_payload.get("input_schema")).get("required"))
    added_required = sorted(set(new_required) - set(old_required))
    removed_required = sorted(set(old_required) - set(new_required))
    if added_required:
        changes.append(
            Change(
                level=ChangeLevel.BREAKING,
                path="input_schema.required",
                old=old_required,
                new=new_required,
                message=f"input_schema.required added new required fields: {', '.join(added_required)}.",
            )
        )
        emitted_keys.add("input_schema")
    if removed_required:
        changes.append(
            Change(
                level=ChangeLevel.INFO,
                path="input_schema.required",
                old=old_required,
                new=new_required,
                message=f"input_schema.required removed fields: {', '.join(removed_required)}.",
            )
        )
        emitted_keys.add("input_schema")

    _append_permission_class_change(
        changes,
        emitted_keys,
        key="permission_class",
        old_value=old_payload.get("permission_class"),
        new_value=new_payload.get("permission_class"),
        rank_map=_TOOL_MANUAL_PERMISSION_ORDER,
        escalate_message="ToolManual permission_class escalated; existing callers may now require stronger approval.",
        downgrade_message="ToolManual permission_class downgraded.",
    )
    _append_value_change(
        changes,
        emitted_keys,
        level=ChangeLevel.BREAKING,
        key="settlement_mode",
        old_value=old_payload.get("settlement_mode"),
        new_value=new_payload.get("settlement_mode"),
        message="ToolManual settlement_mode changed.",
    )
    _append_value_change(
        changes,
        emitted_keys,
        level=ChangeLevel.BREAKING,
        key="currency",
        old_value=old_payload.get("currency"),
        new_value=new_payload.get("currency"),
        message="ToolManual currency changed.",
    )
    if _values_differ(old_payload.get("side_effect_summary"), new_payload.get("side_effect_summary")):
        old_side_effect = old_payload.get("side_effect_summary")
        new_side_effect = new_payload.get("side_effect_summary")
        if _is_blank(old_side_effect) and not _is_blank(new_side_effect):
            level = ChangeLevel.BREAKING
            message = "ToolManual side_effect_summary was added, introducing a new side-effect contract."
        elif not _is_blank(old_side_effect) and _is_blank(new_side_effect):
            level = ChangeLevel.INFO
            message = "ToolManual side_effect_summary was removed."
        else:
            level = ChangeLevel.BREAKING
            message = "ToolManual side_effect_summary changed."
        changes.append(
            Change(
                level=level,
                path="side_effect_summary",
                old=old_side_effect,
                new=new_side_effect,
                message=message,
            )
        )
        emitted_keys.add("side_effect_summary")
    _append_value_change(
        changes,
        emitted_keys,
        level=ChangeLevel.BREAKING,
        key="jurisdiction",
        old_value=old_payload.get("jurisdiction"),
        new_value=new_payload.get("jurisdiction"),
        message="ToolManual jurisdiction changed.",
    )

    old_output_fields = sorted(_mapping(_mapping(old_payload.get("output_schema")).get("properties")).keys())
    new_output_fields = sorted(_mapping(_mapping(new_payload.get("output_schema")).get("properties")).keys())
    added_output_fields = sorted(set(new_output_fields) - set(old_output_fields))
    removed_output_fields = sorted(set(old_output_fields) - set(new_output_fields))
    changed_output_fields = sorted(
        field_name
        for field_name in set(old_output_fields) & set(new_output_fields)
        if _values_differ(
            _mapping(_mapping(old_payload.get("output_schema")).get("properties")).get(field_name),
            _mapping(_mapping(new_payload.get("output_schema")).get("properties")).get(field_name),
        )
    )
    if added_output_fields:
        changes.append(
            Change(
                level=ChangeLevel.WARNING,
                path="output_schema.properties",
                old=old_output_fields,
                new=new_output_fields,
                message=f"output_schema added fields: {', '.join(added_output_fields)}.",
            )
        )
        emitted_keys.add("output_schema")
    if removed_output_fields:
        changes.append(
            Change(
                level=ChangeLevel.BREAKING,
                path="output_schema.properties",
                old=old_output_fields,
                new=new_output_fields,
                message=f"output_schema removed fields: {', '.join(removed_output_fields)}.",
            )
        )
        emitted_keys.add("output_schema")
    if changed_output_fields:
        changes.append(
            Change(
                level=ChangeLevel.WARNING,
                path="output_schema.properties",
                old=old_output_fields,
                new=new_output_fields,
                message=f"output_schema changed field definitions: {', '.join(changed_output_fields)}.",
            )
        )
        emitted_keys.add("output_schema")

    _append_large_list_change(
        changes,
        emitted_keys,
        key="trigger_conditions",
        old_items=_string_list(old_payload.get("trigger_conditions")),
        new_items=_string_list(new_payload.get("trigger_conditions")),
        warning_message="trigger_conditions changed substantially.",
        info_message="trigger_conditions changed.",
    )
    _append_large_list_change(
        changes,
        emitted_keys,
        key="do_not_use_when",
        old_items=_string_list(old_payload.get("do_not_use_when")),
        new_items=_string_list(new_payload.get("do_not_use_when")),
        warning_message="do_not_use_when changed substantially.",
        info_message="do_not_use_when changed.",
    )
    _append_value_change(
        changes,
        emitted_keys,
        level=ChangeLevel.WARNING,
        key="approval_summary_template",
        old_value=old_payload.get("approval_summary_template"),
        new_value=new_payload.get("approval_summary_template"),
        message="approval_summary_template changed.",
    )

    for key in sorted(set(old_payload) | set(new_payload)):
        if key in emitted_keys or key in _SPECIAL_TOOL_MANUAL_KEYS:
            continue
        old_value = old_payload.get(key)
        new_value = new_payload.get(key)
        if _values_differ(old_value, new_value):
            changes.append(
                Change(
                    level=ChangeLevel.INFO,
                    path=key,
                    old=old_value,
                    new=new_value,
                    message=f"ToolManual field '{key}' changed.",
                )
            )

    return _sort_changes(changes)


def _append_large_list_change(
    changes: list[Change],
    emitted_keys: set[str],
    *,
    key: str,
    old_items: list[str],
    new_items: list[str],
    warning_message: str,
    info_message: str,
) -> None:
    if old_items == new_items:
        return
    if _is_major_list_change(old_items, new_items):
        level = ChangeLevel.WARNING
        message = warning_message
    else:
        level = ChangeLevel.INFO
        message = info_message
    changes.append(Change(level=level, path=key, old=old_items, new=new_items, message=message))
    emitted_keys.add(key)


def _append_permission_class_change(
    changes: list[Change],
    emitted_keys: set[str],
    *,
    key: str,
    old_value: Any,
    new_value: Any,
    rank_map: Mapping[str, int],
    escalate_message: str,
    downgrade_message: str,
) -> None:
    if not _values_differ(old_value, new_value):
        return
    old_rank = rank_map.get(str(old_value)) if old_value is not None else None
    new_rank = rank_map.get(str(new_value)) if new_value is not None else None
    if old_rank is not None and new_rank is not None and new_rank > old_rank:
        level = ChangeLevel.BREAKING
        message = escalate_message
    elif old_rank is not None and new_rank is not None and new_rank < old_rank:
        level = ChangeLevel.INFO
        message = downgrade_message
    else:
        level = ChangeLevel.INFO
        message = f"{key} changed."
    changes.append(Change(level=level, path=key, old=old_value, new=new_value, message=message))
    emitted_keys.add(key)


def _append_value_change(
    changes: list[Change],
    emitted_keys: set[str],
    *,
    level: ChangeLevel,
    key: str,
    old_value: Any,
    new_value: Any,
    message: str,
) -> None:
    if _values_differ(old_value, new_value):
        changes.append(Change(level=level, path=key, old=old_value, new=new_value, message=message))
        emitted_keys.add(key)


def _normalize_manifest(value: Any) -> dict[str, Any]:
    payload = _mapping(_normalize_value(value))
    normalized = dict(payload)
    normalized["price_model"] = normalized.get("price_model") or "free"
    normalized["currency"] = normalized.get("currency") or "USD"
    # AppManifest defaults permission_class to "read-only" (hyphen form,
    # PermissionClass.READ_ONLY). Without this default, a legacy/minimal
    # manifest without permission_class compared against an upgraded
    # manifest would leave oldRank undefined and appendPermissionClassChange
    # would downgrade the permission escalation from BREAKING to INFO —
    # letting the diff CLI exit 0 on a genuinely breaking change.
    normalized["permission_class"] = normalized.get("permission_class") or "read-only"
    return normalized


def _normalize_tool_manual(value: Any) -> dict[str, Any]:
    payload = _mapping(_normalize_value(value))
    normalized = dict(payload)
    normalized["permission_class"] = normalized.get("permission_class") or "read_only"
    normalized["requires_connected_accounts"] = _string_list(normalized.get("requires_connected_accounts"))
    return normalized


def _normalize_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return {key: _normalize_value(item) for key, item in asdict(value).items()}
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        return _normalize_value(to_dict())
    if isinstance(value, Mapping):
        return {str(key): _normalize_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_normalize_value(item) for item in value]
    return value


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str)]


def _values_differ(left: Any, right: Any) -> bool:
    return _stable_value(_normalize_value(left)) != _stable_value(_normalize_value(right))


def _is_blank(value: Any) -> bool:
    return not isinstance(value, str) or value.strip() == ""


def _is_major_list_change(old_items: list[str], new_items: list[str]) -> bool:
    old_set = {item.strip().lower() for item in old_items if item.strip()}
    new_set = {item.strip().lower() for item in new_items if item.strip()}
    if old_set == new_set:
        return False
    if not old_set or not new_set:
        return True
    union = old_set | new_set
    if not union:
        return False
    similarity = len(old_set & new_set) / len(union)
    return similarity < 0.5 or (similarity == 0.5 and abs(len(old_set) - len(new_set)) >= 1)


def _sort_changes(changes: list[Change]) -> list[Change]:
    priority = {
        ChangeLevel.BREAKING: 0,
        ChangeLevel.WARNING: 1,
        ChangeLevel.INFO: 2,
    }
    return sorted(changes, key=lambda item: (priority[item.level], item.path))


def _stable_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            key: _stable_value(value[key])
            for key in sorted(value)
        }
    if isinstance(value, list):
        return [_stable_value(item) for item in value]
    return value


__all__ = [
    "BreakingChange",
    "Change",
    "ChangeLevel",
    "diff_manifest",
    "diff_tool_manual",
]
