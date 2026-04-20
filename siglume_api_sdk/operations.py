"""Operation-catalog helpers for first-party owner-operation wrappers."""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Mapping


DEFAULT_OPERATION_AGENT_ID = "agt_owner_demo"


@dataclass
class OperationMetadata:
    operation_key: str
    summary: str
    params_summary: str
    page_href: str | None = None
    allowed_params: list[str] = field(default_factory=list)
    required_params: list[str] = field(default_factory=list)
    requires_params: bool = False
    param_types: dict[str, str] = field(default_factory=dict)
    permission_class: str = "read-only"
    approval_mode: str = "auto"
    input_schema: dict[str, Any] = field(default_factory=dict)
    output_schema: dict[str, Any] = field(default_factory=dict)
    agent_id: str | None = None
    source: str = "live"
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


def default_operation_output_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "One-line summary of the first-party operation result.",
            },
            "action": {
                "type": "string",
                "description": "Structured action label returned by Siglume.",
            },
            "result": {
                "type": "object",
                "description": "Raw first-party operation payload returned by Siglume.",
            },
        },
        "required": ["summary", "action", "result"],
        "additionalProperties": False,
    }


_KNOWN_OPERATION_OVERRIDES: dict[str, dict[str, Any]] = {
    "owner.charter.get": {
        "summary": "Read the current owner charter.",
        "params_summary": "No parameters.",
        "page_href": "/owner/charters",
        "allowed_params": [],
        "required_params": [],
        "requires_params": False,
        "permission_class": "read-only",
        "approval_mode": "auto",
        "input_schema": {
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "Owned agent to target. Defaults to the agent used during template generation.",
                },
            },
            "required": [],
            "additionalProperties": False,
        },
    },
    "owner.charter.update": {
        "summary": "Update the owner charter.",
        "params_summary": (
            "Supports partial updates for role, goals, target_profile, "
            "qualification_criteria, success_metrics, and constraints."
        ),
        "page_href": "/owner/charters",
        "allowed_params": [
            "role",
            "goals",
            "target_profile",
            "qualification_criteria",
            "success_metrics",
            "constraints",
        ],
        "required_params": ["goals"],
        "requires_params": True,
        "param_types": {
            "role": "string",
            "goals": "dict",
            "target_profile": "dict",
            "qualification_criteria": "dict",
            "success_metrics": "dict",
            "constraints": "dict",
        },
        "permission_class": "action",
        "approval_mode": "always-ask",
        "input_schema": {
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "Owned agent to target. Defaults to the agent used during template generation.",
                },
                "role": {
                    "type": "string",
                    "description": "Updated owner role label, such as buyer or researcher.",
                    "default": "buyer",
                },
                "goals": {
                    "type": "object",
                    "description": "Updated charter goals payload.",
                    "properties": {
                        "charter_text": {
                            "type": "string",
                            "description": "Human-readable charter text to store in the owner charter.",
                            "default": "Prefer explicit approvals for unusual purchases.",
                        },
                    },
                    "required": ["charter_text"],
                    "additionalProperties": True,
                },
                "target_profile": {
                    "type": "object",
                    "description": "Optional target-profile constraints for the agent.",
                    "default": {},
                },
                "qualification_criteria": {
                    "type": "object",
                    "description": "Optional qualification criteria for tasks the agent may accept.",
                    "default": {},
                },
                "success_metrics": {
                    "type": "object",
                    "description": "Optional success metrics, such as approval_rate_floor.",
                    "default": {"approval_rate_floor": 0.8},
                },
                "constraints": {
                    "type": "object",
                    "description": "Optional constraint payload applied to the charter.",
                    "default": {},
                },
            },
            "required": ["goals"],
            "additionalProperties": False,
        },
    },
    "owner.approval_policy.get": {
        "summary": "Read the current owner approval policy.",
        "params_summary": "No parameters.",
        "page_href": "/owner/policies",
        "allowed_params": [],
        "required_params": [],
        "requires_params": False,
        "permission_class": "read-only",
        "approval_mode": "auto",
        "input_schema": {
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "Owned agent to target. Defaults to the agent used during template generation.",
                },
            },
            "required": [],
            "additionalProperties": False,
        },
    },
    "owner.approval_policy.update": {
        "summary": "Update the owner approval policy.",
        "params_summary": (
            "Supports partial updates for auto_approve_below, "
            "always_require_approval_for, deny_if, approval_ttl_minutes, "
            "structured_only, merchant_allowlist, merchant_denylist, "
            "category_allowlist, category_denylist, and risk_policy."
        ),
        "page_href": "/owner/policies",
        "allowed_params": [
            "auto_approve_below",
            "always_require_approval_for",
            "deny_if",
            "approval_ttl_minutes",
            "structured_only",
            "merchant_allowlist",
            "merchant_denylist",
            "category_allowlist",
            "category_denylist",
            "risk_policy",
        ],
        "required_params": ["auto_approve_below"],
        "requires_params": True,
        "param_types": {
            "auto_approve_below": "dict_int",
            "always_require_approval_for": "list_str",
            "deny_if": "dict",
            "approval_ttl_minutes": "int",
            "structured_only": "bool",
            "merchant_allowlist": "list_str",
            "merchant_denylist": "list_str",
            "category_allowlist": "list_str",
            "category_denylist": "list_str",
            "risk_policy": "dict",
        },
        "permission_class": "action",
        "approval_mode": "always-ask",
        "input_schema": {
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "Owned agent to target. Defaults to the agent used during template generation.",
                },
                "auto_approve_below": {
                    "type": "object",
                    "description": "Currency-to-threshold map for auto-approved actions in minor units.",
                    "default": {"JPY": 3000},
                    "additionalProperties": {"type": "integer"},
                },
                "always_require_approval_for": {
                    "type": "array",
                    "description": "Scopes that should always require approval.",
                    "items": {"type": "string"},
                    "default": ["travel.booking"],
                },
                "deny_if": {
                    "type": "object",
                    "description": "Risk filters that should deny execution.",
                    "default": {},
                },
                "approval_ttl_minutes": {
                    "type": "integer",
                    "description": "Approval request time-to-live in minutes.",
                    "default": 720,
                },
                "structured_only": {
                    "type": "boolean",
                    "description": "Require machine-structured action requests before approval.",
                    "default": True,
                },
                "merchant_allowlist": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": [],
                },
                "merchant_denylist": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": [],
                },
                "category_allowlist": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": [],
                },
                "category_denylist": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": [],
                },
                "risk_policy": {
                    "type": "object",
                    "description": "Structured risk-policy payload.",
                    "default": {},
                },
            },
            "required": ["auto_approve_below"],
            "additionalProperties": False,
        },
    },
    "owner.budget.get": {
        "summary": "Read the current delegated budget.",
        "params_summary": "Optional currency parameter.",
        "page_href": "/owner/budgets",
        "allowed_params": ["currency"],
        "required_params": [],
        "requires_params": False,
        "param_types": {"currency": "string"},
        "permission_class": "read-only",
        "approval_mode": "auto",
        "input_schema": {
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "Owned agent to target. Defaults to the agent used during template generation.",
                },
                "currency": {
                    "type": "string",
                    "description": "Optional currency filter for the delegated-budget snapshot.",
                    "default": "JPY",
                },
            },
            "required": [],
            "additionalProperties": False,
        },
    },
    "owner.budget.update": {
        "summary": "Update the delegated budget.",
        "params_summary": (
            "Supports partial updates for currency, period_limit_minor, "
            "per_order_limit_minor, auto_approve_below_minor, period_start, "
            "period_end, limits, and metadata."
        ),
        "page_href": "/owner/budgets",
        "allowed_params": [
            "currency",
            "period_start",
            "period_end",
            "period_limit_minor",
            "per_order_limit_minor",
            "auto_approve_below_minor",
            "limits",
            "metadata",
        ],
        "required_params": ["period_limit_minor"],
        "requires_params": True,
        "param_types": {
            "currency": "string",
            "period_start": "string",
            "period_end": "string",
            "period_limit_minor": "int",
            "per_order_limit_minor": "int",
            "auto_approve_below_minor": "int",
            "limits": "dict",
            "metadata": "dict",
        },
        "permission_class": "action",
        "approval_mode": "always-ask",
        "input_schema": {
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "Owned agent to target. Defaults to the agent used during template generation.",
                },
                "currency": {
                    "type": "string",
                    "description": "Budget currency code.",
                    "default": "JPY",
                },
                "period_start": {
                    "type": "string",
                    "description": "Optional RFC3339 start time for the budget window.",
                    "default": "2026-04-01T00:00:00Z",
                },
                "period_end": {
                    "type": "string",
                    "description": "Optional RFC3339 end time for the budget window.",
                    "default": "2026-05-01T00:00:00Z",
                },
                "period_limit_minor": {
                    "type": "integer",
                    "description": "Maximum delegated spend for the budget period in minor units.",
                    "default": 50000,
                },
                "per_order_limit_minor": {
                    "type": "integer",
                    "description": "Maximum delegated spend per order in minor units.",
                    "default": 12000,
                },
                "auto_approve_below_minor": {
                    "type": "integer",
                    "description": "Auto-approve threshold in minor units.",
                    "default": 3000,
                },
                "limits": {
                    "type": "object",
                    "description": "Optional nested budget limits payload.",
                    "default": {},
                },
                "metadata": {
                    "type": "object",
                    "description": "Optional metadata persisted with the delegated budget.",
                    "default": {"source": "siglume_init"},
                },
            },
            "required": ["period_limit_minor"],
            "additionalProperties": False,
        },
    },
}


def _string(value: Any) -> str:
    return str(value or "").strip()


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in (_string(item) for item in value) if item]


def _mapping(value: Any) -> dict[str, Any]:
    return copy.deepcopy(dict(value)) if isinstance(value, Mapping) else {}


def _infer_permission_class(operation_key: str) -> str:
    lowered = _string(operation_key).lower()
    if any(
        token in lowered
        for token in (
            ".update",
            ".create",
            ".delete",
            ".execute",
            ".issue",
            ".respond",
            ".bind",
            ".pause",
            ".resume",
            ".cancel",
            ".publish",
            ".delist",
        )
    ):
        return "action"
    if any(token in lowered for token in ("payment", "mandate", "charge", "swap", "refund")):
        return "payment"
    return "read-only"


def _approval_mode_for(permission_class: str) -> str:
    return "always-ask" if permission_class in {"action", "payment"} else "auto"


def _infer_param_type(name: str) -> str:
    normalized = _string(name).lower()
    if normalized in {"structured_only"}:
        return "bool"
    if normalized in {"limit", "approval_ttl_minutes", "period_limit_minor", "per_order_limit_minor", "auto_approve_below_minor"}:
        return "int"
    if normalized.endswith("_minor") or normalized.endswith("_minutes") or normalized.endswith("_seconds"):
        return "int"
    if normalized in {
        "goals",
        "target_profile",
        "qualification_criteria",
        "success_metrics",
        "constraints",
        "deny_if",
        "risk_policy",
        "limits",
        "metadata",
        "payload",
        "projection",
    }:
        return "dict"
    if normalized in {
        "always_require_approval_for",
        "merchant_allowlist",
        "merchant_denylist",
        "category_allowlist",
        "category_denylist",
        "required_connected_accounts",
    }:
        return "list_str"
    if normalized.startswith("include_"):
        return "bool"
    if normalized in {"auto_approve_below"}:
        return "dict_int"
    return "string"


def _property_schema_for(name: str, param_type: str) -> dict[str, Any]:
    title = name.replace("_", " ")
    if param_type == "int":
        return {"type": "integer", "description": f"Operation parameter {title}."}
    if param_type == "bool":
        return {"type": "boolean", "description": f"Operation parameter {title}."}
    if param_type == "dict":
        return {"type": "object", "description": f"Operation parameter {title}.", "default": {}}
    if param_type == "dict_int":
        return {
            "type": "object",
            "description": f"Operation parameter {title}.",
            "default": {},
            "additionalProperties": {"type": "integer"},
        }
    if param_type == "list_str":
        return {
            "type": "array",
            "description": f"Operation parameter {title}.",
            "items": {"type": "string"},
            "default": [],
        }
    return {"type": "string", "description": f"Operation parameter {title}."}


def _build_input_schema(
    operation_key: str,
    agent_id: str | None,
    allowed_params: list[str],
    required_params: list[str],
    requires_params: bool,
    param_types: dict[str, str],
) -> dict[str, Any]:
    properties: dict[str, Any] = {
        "agent_id": {
            "type": "string",
            "description": "Owned agent to target. Defaults to the agent used during template generation.",
        }
    }
    if agent_id:
        properties["agent_id"]["default"] = agent_id
    for name in allowed_params:
        properties[name] = _property_schema_for(name, param_types.get(name) or _infer_param_type(name))
    normalized_required = [name for name in required_params if name in properties and name != "agent_id"]
    if requires_params and not normalized_required:
        first_param = next((name for name in allowed_params if name in properties), None)
        if first_param:
            normalized_required = [first_param]
    return {
        "type": "object",
        "properties": properties,
        "required": normalized_required,
        "additionalProperties": False,
    }


def _summary_for(operation_key: str) -> str:
    normalized = _string(operation_key)
    if normalized.endswith(".get"):
        return f"Read {normalized}."
    if normalized.endswith(".list"):
        return f"List {normalized}."
    return f"Run the {normalized} first-party owner operation."


def default_capability_key_for_operation(operation_key: str) -> str:
    return f"my-{_string(operation_key).replace('.', '-').replace('_', '-')}-wrapper"


def fallback_operation_catalog(agent_id: str | None = None) -> list[OperationMetadata]:
    resolved_agent_id = _string(agent_id) or DEFAULT_OPERATION_AGENT_ID
    return [
        build_operation_metadata({"name": operation_key}, agent_id=resolved_agent_id, source="fallback")
        for operation_key in sorted(_KNOWN_OPERATION_OVERRIDES)
    ]


def build_operation_metadata(
    payload: Mapping[str, Any],
    *,
    agent_id: str | None = None,
    source: str = "live",
) -> OperationMetadata:
    raw = dict(payload)
    operation_key = _string(raw.get("operation_key") or raw.get("name"))
    if not operation_key:
        raise ValueError("operation_key is required")

    override = _KNOWN_OPERATION_OVERRIDES.get(operation_key, {})
    summary = _string(raw.get("summary")) or _string(override.get("summary")) or _summary_for(operation_key)
    params_summary = _string(raw.get("params_summary") or raw.get("params")) or _string(override.get("params_summary"))
    allowed_params = _string_list(raw.get("allowed_params")) or list(override.get("allowed_params", []))
    required_params = _string_list(raw.get("required_params")) or list(override.get("required_params", []))
    requires_params = bool(raw.get("requires_params")) or bool(override.get("requires_params"))
    param_types = {
        str(key): _string(value)
        for key, value in (_mapping(raw.get("param_types")) or _mapping(override.get("param_types"))).items()
        if _string(key) and _string(value)
    }
    resolved_agent_id = _string(agent_id) or _string(raw.get("agent_id")) or None
    permission_class = _string(raw.get("permission_class")) or _string(override.get("permission_class")) or _infer_permission_class(operation_key)
    approval_mode = _string(raw.get("approval_mode")) or _string(override.get("approval_mode")) or _approval_mode_for(permission_class)
    input_schema = _mapping(raw.get("input_schema")) or _mapping(override.get("input_schema")) or _build_input_schema(
        operation_key,
        resolved_agent_id,
        allowed_params,
        required_params,
        requires_params,
        param_types,
    )
    if "properties" in input_schema and isinstance(input_schema["properties"], dict):
        if "agent_id" in input_schema["properties"]:
            if resolved_agent_id:
                input_schema["properties"]["agent_id"].setdefault("default", resolved_agent_id)
    output_schema = _mapping(raw.get("output_schema")) or _mapping(override.get("output_schema")) or default_operation_output_schema()
    return OperationMetadata(
        operation_key=operation_key,
        summary=summary,
        params_summary=params_summary,
        page_href=_string(raw.get("page_href")) or _string(override.get("page_href")) or None,
        allowed_params=allowed_params,
        required_params=required_params,
        requires_params=requires_params,
        param_types=param_types,
        permission_class=permission_class,
        approval_mode=approval_mode,
        input_schema=input_schema,
        output_schema=output_schema,
        agent_id=resolved_agent_id,
        source=source,
        raw=raw,
    )
