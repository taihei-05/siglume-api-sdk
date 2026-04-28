from __future__ import annotations

import asyncio
import dataclasses
import importlib.util
import inspect
import json
import os
import sys
import textwrap
import tomllib
from contextlib import contextmanager
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from shutil import copyfile
from typing import Any, Iterator
from urllib.parse import urlparse

import click

from siglume_api_sdk import (
    AppAdapter,
    AppCategory,
    AppManifest,
    AppTestHarness,
    ApprovalMode,
    PermissionClass,
    PriceModel,
    SettlementMode,
    SiglumeClient,
    SiglumeClientError,
    ToolManual,
    ToolManualPermissionClass,
    score_tool_manual_offline,
    validate_tool_manual,
)
from siglume_api_sdk.operations import (
    DEFAULT_OPERATION_AGENT_ID,
    OperationMetadata,
    default_capability_key_for_operation,
    fallback_operation_catalog,
)


SDK_ROOT = Path(__file__).resolve().parents[2]
EXAMPLES_ROOT = SDK_ROOT / "examples"

TEMPLATE_EXAMPLES = {
    "echo": "hello_echo.py",
    "price-compare": "hello_price_compare.py",
    "publisher": "x_publisher.py",
    "payment": "metamask_connector.py",
}

FALLBACK_OPERATION_WARNING = (
    "Using the bundled fallback owner-operation catalog because the live "
    "catalog is unavailable. Generated templates remain experimental until the "
    "platform operation catalog is reachable."
)


@dataclass
class LoadedProject:
    root_dir: Path
    adapter_path: Path
    app: AppAdapter
    manifest: AppManifest
    tool_manual_path: Path | None
    tool_manual: dict[str, Any]
    runtime_validation_path: Path | None
    runtime_validation: dict[str, Any] | None
    oauth_credentials_path: Path | None
    oauth_credentials: dict[str, Any] | list[Any] | None


def to_jsonable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if dataclasses.is_dataclass(value):
        return {key: to_jsonable(item) for key, item in dataclasses.asdict(value).items()}
    if hasattr(value, "__dict__") and not isinstance(value, type):
        return {
            str(key): to_jsonable(item)
            for key, item in vars(value).items()
            if not str(key).startswith("_")
        }
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    return value


def tool_manual_to_dict(manual: ToolManual | dict[str, Any]) -> dict[str, Any]:
    if isinstance(manual, ToolManual):
        return manual.to_dict()
    return {str(key): to_jsonable(value) for key, value in dict(manual).items()}


def _remote_quality_ok(report: Any) -> bool:
    validation_ok = bool(getattr(report, "validation_ok", True))
    publishable = getattr(report, "publishable", None)
    if publishable is None:
        publishable = str(getattr(report, "grade", "F")) in {"A", "B"}
    return validation_ok and bool(publishable)


def build_tool_manual_template(manifest: AppManifest) -> dict[str, Any]:
    job_text = str(manifest.job_to_be_done or manifest.name or manifest.capability_key.replace("-", " "))
    summary_text = str(manifest.short_description or manifest.job_to_be_done or manifest.name or manifest.capability_key.replace("-", " "))
    tool_name = manifest.capability_key.replace("-", "_")
    summary = (
        manifest.short_description
        or manifest.job_to_be_done
        or f"Use this tool to {manifest.capability_key.replace('-', ' ')}."
    )
    manual: dict[str, Any] = {
        "tool_name": tool_name,
        "job_to_be_done": job_text or f"Use {manifest.name} to complete the requested task.",
        "summary_for_model": summary,
        "trigger_conditions": [
            f"The owner asks for help with {job_text.lower()}",
            f"A workflow needs {manifest.name} to complete a specific external task",
            f"The request matches the capability described as {summary_text}",
        ],
        "do_not_use_when": [
            "The request is unrelated to this tool's documented capability",
            "A required connected account or required input is missing",
        ],
        "permission_class": _tool_manual_permission_class(manifest.permission_class).value,
        "dry_run_supported": bool(manifest.dry_run_supported),
        "requires_connected_accounts": list(manifest.required_connected_accounts),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural-language request describing what the tool should do.",
                },
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        "output_schema": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "A concise summary of the result returned by the tool.",
                },
                "result": {
                    "type": "object",
                    "description": "Structured result payload returned by the tool.",
                },
            },
            "required": ["summary", "result"],
            "additionalProperties": False,
        },
        "usage_hints": [
            "Use the result summary to explain the outcome in plain language.",
        ],
        "result_hints": [
            "Highlight the most important result field before showing raw details.",
        ],
        "error_hints": [
            "If execution fails, explain what input or connected account needs attention.",
        ],
    }

    if manifest.permission_class in (PermissionClass.ACTION, PermissionClass.PAYMENT):
        manual.update(
            {
                "approval_summary_template": (
                    f"{manifest.name}: {{query}}"
                    if manifest.permission_class == PermissionClass.ACTION
                    else f"{manifest.name}: approve {{query}} for {{amount_minor}} {{currency}}"
                ),
                "preview_schema": {
                    "type": "object",
                    "properties": {
                        "summary": {
                            "type": "string",
                            "description": "Human-readable preview of what will happen.",
                        },
                    },
                    "required": ["summary"],
                    "additionalProperties": False,
                },
                "idempotency_support": True,
                "side_effect_summary": (
                    f"Using {manifest.name} may create or modify an external resource."
                    if manifest.permission_class == PermissionClass.ACTION
                    else f"Using {manifest.name} may initiate a payment or settlement attempt."
                ),
                "jurisdiction": manifest.jurisdiction,
            }
        )

    if manifest.permission_class == PermissionClass.PAYMENT:
        manual.update(
            {
                "output_schema": {
                    "type": "object",
                    "properties": {
                        "summary": {
                            "type": "string",
                            "description": "A concise summary of the payment or quote result.",
                        },
                        "amount_usd": {
                            "type": "number",
                            "description": "Total amount in USD for the quote or completed payment.",
                        },
                        "currency": {
                            "type": "string",
                            "description": "Currency code for the quoted or charged amount.",
                        },
                        "payment_id": {
                            "type": "string",
                            "description": "Provider or platform payment identifier when execution completes.",
                        },
                    },
                    "required": ["summary", "amount_usd", "currency"],
                    "additionalProperties": False,
                },
                "quote_schema": {
                    "type": "object",
                    "properties": {
                        "amount_minor": {
                            "type": "integer",
                            "description": "Quoted amount in minor currency units.",
                        },
                        "currency": {
                            "type": "string",
                            "description": "Quoted currency code.",
                        },
                    },
                    "required": ["amount_minor", "currency"],
                    "additionalProperties": False,
                },
                "currency": "USD",
                "settlement_mode": SettlementMode.STRIPE_CHECKOUT.value,
                "refund_or_cancellation_note": "Explain the refund or cancellation policy for this payment flow.",
            }
        )

    return manual


def load_project(path: str | Path = ".") -> LoadedProject:
    target = Path(path).resolve()
    adapter_path = _find_adapter_path(target)
    root_dir = adapter_path.parent
    app = _load_app(adapter_path)
    manifest = app.manifest()
    tool_manual_path = _find_tool_manual_path(root_dir)
    if tool_manual_path is not None:
        tool_manual = json.loads(tool_manual_path.read_text(encoding="utf-8"))
    else:
        tool_manual = build_tool_manual_template(manifest)
    runtime_validation_path = _find_runtime_validation_path(root_dir)
    runtime_validation = (
        _load_json_object(runtime_validation_path, "runtime_validation")
        if runtime_validation_path is not None
        else None
    )
    oauth_credentials_path = _find_oauth_credentials_path(root_dir)
    oauth_credentials = None
    if oauth_credentials_path is not None:
        try:
            oauth_credentials = json.loads(oauth_credentials_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise click.ClickException(f"{oauth_credentials_path.name} is not valid JSON: {exc}") from exc
        if not isinstance(oauth_credentials, (dict, list)):
            raise click.ClickException("oauth_credentials must be a JSON object or array")
    return LoadedProject(
        root_dir=root_dir,
        adapter_path=adapter_path,
        app=app,
        manifest=manifest,
        tool_manual_path=tool_manual_path,
        tool_manual=tool_manual,
        runtime_validation_path=runtime_validation_path,
        runtime_validation=runtime_validation,
        oauth_credentials_path=oauth_credentials_path,
        oauth_credentials=oauth_credentials,
    )


def render_json(data: Any) -> str:
    return json.dumps(to_jsonable(data), ensure_ascii=False, indent=2)


_OAUTH_PROVIDER_ALIASES = {
    "x": "twitter",
    "x-twitter": "twitter",
    "twitter": "twitter",
    "slack": "slack",
    "google": "google",
    "gmail": "google",
    "google-drive": "google",
    "google-calendar": "google",
    "github": "github",
    "linear": "linear",
    "notion": "notion",
}


def _is_platform_managed_requirement(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if value.get("platform_managed") is True:
        return True
    owner = str(
        value.get("managed_by")
        or value.get("auth_managed_by")
        or value.get("connection_owner")
        or ""
    ).strip().lower().replace("_", "-")
    return owner in {"platform", "siglume", "siglume-platform"}


def _oauth_provider_key_from_requirement(value: Any) -> str | None:
    if isinstance(value, dict):
        for key in ("provider_key", "provider", "account_type", "name"):
            provider_key = _oauth_provider_key_from_requirement(value.get(key))
            if provider_key:
                return provider_key
        return None
    raw = str(value or "").strip().lower().replace("_", "-")
    if not raw:
        return None
    if raw in _OAUTH_PROVIDER_ALIASES:
        return _OAUTH_PROVIDER_ALIASES[raw]
    for token in raw.replace("/", "-").replace(":", "-").split("-"):
        token = token.strip()
        if token in _OAUTH_PROVIDER_ALIASES:
            return _OAUTH_PROVIDER_ALIASES[token]
    return None


def _required_oauth_providers(requirements: list[Any] | tuple[Any, ...] | None) -> list[str]:
    providers: list[str] = []
    for item in requirements or []:
        if not _is_platform_managed_requirement(item):
            continue
        provider_key = _oauth_provider_key_from_requirement(item)
        if not provider_key:
            raise click.ClickException(
                "required_connected_accounts platform-managed entries must include a supported provider_key"
            )
        if provider_key and provider_key not in providers:
            providers.append(provider_key)
    return providers


def _connected_account_requirement_label(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("provider_key", "provider", "account_type", "name"):
            label = str(value.get(key) or "").strip()
            if label:
                return label
        return ""
    return str(value or "").strip()


def _oauth_provider_records_map(payload: dict[str, Any] | list[Any] | None) -> dict[str, dict[str, Any]]:
    if payload is None:
        return {}
    items: Any = payload
    if isinstance(payload, dict):
        items = payload.get("items") if isinstance(payload.get("items"), list) else [payload]
    if not isinstance(items, list):
        raise click.ClickException("oauth_credentials must be a JSON object or array.")
    resolved: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise click.ClickException(f"oauth_credentials[{index}] must be a JSON object.")
        provider_key = _oauth_provider_key_from_requirement(
            item.get("provider_key") or item.get("provider")
        )
        if not provider_key:
            raise click.ClickException(f"oauth_credentials[{index}].provider_key is unsupported.")
        client_id = str(item.get("client_id") or "").strip()
        client_secret = str(item.get("client_secret") or "").strip()
        if not client_id or not client_secret:
            raise click.ClickException(
                f"oauth_credentials[{index}] must include client_id and client_secret."
            )
        raw_scopes = item.get("required_scopes")
        if raw_scopes is None:
            raw_scopes = item.get("scopes")
        if raw_scopes is None:
            scopes: list[str] = []
        elif not isinstance(raw_scopes, list):
            raise click.ClickException(
                f"oauth_credentials[{index}].required_scopes must be a JSON array."
            )
        else:
            scopes = [str(scope).strip() for scope in raw_scopes if str(scope).strip()]
        resolved[provider_key] = {
            "provider_key": provider_key,
            "client_id": client_id,
            "client_secret": client_secret,
            "required_scopes": scopes,
        }
    return resolved


def _canonical_oauth_credentials_payload(
    payload: dict[str, Any] | list[Any] | None,
) -> dict[str, list[dict[str, Any]]] | None:
    records = _oauth_provider_records_map(payload)
    if not records:
        return None
    return {"items": [records[provider_key] for provider_key in sorted(records)]}


def _ensure_required_oauth_credentials(project: LoadedProject) -> None:
    required_providers = _required_oauth_providers(project.manifest.required_connected_accounts)
    if not required_providers:
        return
    provided = _oauth_provider_records_map(project.oauth_credentials).keys()
    missing = [provider for provider in required_providers if provider not in provided]
    if not missing:
        return
    path = project.oauth_credentials_path or (project.root_dir / "oauth_credentials.json")
    raise click.ClickException(
        f"{path} is required for platform-managed OAuth APIs. Missing provider seeds: {', '.join(missing)}"
    )


def _sample_value_for_schema(schema: dict[str, Any]) -> Any:
    schema_type = schema.get("type")
    if schema_type == "integer":
        return 1
    if schema_type == "number":
        return 1.0
    if schema_type == "boolean":
        return True
    if schema_type == "array":
        return []
    if schema_type == "object":
        return {}
    return "example"


def _build_runtime_validation_template(tool_manual: dict[str, Any]) -> dict[str, Any]:
    input_schema = tool_manual.get("input_schema") if isinstance(tool_manual.get("input_schema"), dict) else {}
    properties = input_schema.get("properties") if isinstance(input_schema.get("properties"), dict) else {}
    required = input_schema.get("required") if isinstance(input_schema.get("required"), list) else []
    request_payload: dict[str, Any] = {}
    for field_name in required:
        if isinstance(field_name, str):
            field_schema = properties.get(field_name) if isinstance(properties.get(field_name), dict) else {}
            request_payload[field_name] = _sample_value_for_schema(field_schema)
    if bool(tool_manual.get("dry_run_supported")):
        request_payload.setdefault("dry_run", True)

    output_schema = tool_manual.get("output_schema") if isinstance(tool_manual.get("output_schema"), dict) else {}
    output_required = output_schema.get("required") if isinstance(output_schema.get("required"), list) else []
    expected_fields = [str(field) for field in output_required if isinstance(field, str)]
    if not expected_fields:
        expected_fields = ["summary"]

    return {
        "public_base_url": "https://api.example.com",
        "healthcheck_url": "https://api.example.com/health",
        "invoke_url": "https://api.example.com/invoke",
        "invoke_method": "POST",
        "test_auth_header_name": "X-Siglume-Review-Key",
        "test_auth_header_value": "replace-with-dedicated-review-key",
        "request_payload": request_payload,
        "expected_response_fields": expected_fields,
        "timeout_seconds": 10,
    }


def list_operation_catalog(
    *,
    agent_id: str | None = None,
    lang: str = "en",
) -> dict[str, Any]:
    resolved_agent_id = str(agent_id or "").strip()
    warning_message: str | None = None
    try:
        api_key = resolve_api_key()
    except click.ClickException as exc:
        api_key = None
        warning_message = str(exc)
    if api_key:
        try:
            with SiglumeClient(api_key=api_key) as client:
                operations = client.list_operations(agent_id=resolved_agent_id or None, lang=lang)
            return {
                "agent_id": operations[0].agent_id if operations else (resolved_agent_id or None),
                "source": "live",
                "warning": None,
                "operations": [to_jsonable(item) for item in operations],
            }
        except SiglumeClientError as exc:
            warning_message = str(exc)
    operations = fallback_operation_catalog(agent_id=resolved_agent_id or DEFAULT_OPERATION_AGENT_ID)
    return {
        "agent_id": operations[0].agent_id if operations else (resolved_agent_id or DEFAULT_OPERATION_AGENT_ID),
        "source": "fallback",
        "warning": warning_message or FALLBACK_OPERATION_WARNING,
        "operations": [to_jsonable(item) for item in operations],
    }


def _resolve_operation_metadata(
    operation_key: str,
    *,
    agent_id: str | None = None,
    lang: str = "en",
) -> tuple[OperationMetadata, str | None]:
    normalized_key = str(operation_key or "").strip()
    if not normalized_key:
        raise click.ClickException("operation_key is required.")
    catalog = list_operation_catalog(agent_id=agent_id, lang=lang)
    operations = catalog["operations"] if isinstance(catalog.get("operations"), list) else []
    for item in operations:
        if isinstance(item, dict) and str(item.get("operation_key") or "") == normalized_key:
            return (
                OperationMetadata(
                    operation_key=str(item["operation_key"]),
                    summary=str(item["summary"]),
                    params_summary=str(item.get("params_summary") or ""),
                    page_href=str(item.get("page_href") or "") or None,
                    allowed_params=[str(value) for value in item.get("allowed_params", []) if isinstance(value, str)],
                    required_params=[str(value) for value in item.get("required_params", []) if isinstance(value, str)],
                    requires_params=bool(item.get("requires_params")),
                    param_types={str(key): str(value) for key, value in dict(item.get("param_types") or {}).items()},
                    permission_class=str(item.get("permission_class") or "read-only"),
                    approval_mode=str(item.get("approval_mode") or "auto"),
                    input_schema=dict(item.get("input_schema") or {}),
                    output_schema=dict(item.get("output_schema") or {}),
                    agent_id=str(item.get("agent_id") or "") or None,
                    source=str(item.get("source") or catalog.get("source") or "fallback"),
                    raw=dict(item.get("raw") or {}),
                ),
                str(catalog.get("warning") or "") or None,
            )
    raise click.ClickException(f"Unknown operation key: {normalized_key}")


def _permission_class_from_operation(operation: OperationMetadata) -> PermissionClass:
    mapping = {
        "action": PermissionClass.ACTION,
        "payment": PermissionClass.PAYMENT,
    }
    return mapping.get(operation.permission_class, PermissionClass.READ_ONLY)


def _approval_mode_from_operation(operation: OperationMetadata) -> ApprovalMode:
    mapping = {
        "always-ask": ApprovalMode.ALWAYS_ASK,
        "budget-bounded": ApprovalMode.BUDGET_BOUNDED,
        "deny": ApprovalMode.DENY,
    }
    return mapping.get(operation.approval_mode, ApprovalMode.AUTO)


def _tool_permission_class_from_operation(operation: OperationMetadata) -> ToolManualPermissionClass:
    permission = _permission_class_from_operation(operation)
    return _tool_manual_permission_class(permission)


def _operation_display_name(operation: OperationMetadata) -> str:
    chunks = [
        chunk.capitalize()
        for chunk in operation.operation_key.replace(".", " ").replace("-", " ").replace("_", " ").split()
    ]
    return " ".join(chunks) + " Wrapper"


def _operation_task_type(operation: OperationMetadata) -> str:
    return f"wrap_{operation.operation_key.replace('.', '_').replace('-', '_')}"


def _operation_class_name(operation: OperationMetadata) -> str:
    chunks = [
        chunk.capitalize()
        for chunk in operation.operation_key.replace(".", " ").replace("-", " ").replace("_", " ").split()
    ]
    return "".join(chunks) + "WrapperApp"


def _operation_trigger_conditions(operation: OperationMetadata) -> list[str]:
    summary = operation.summary.rstrip(".")
    capability = operation.operation_key.replace(".", " ")
    if operation.permission_class in {"action", "payment"}:
        return [
            f"owner explicitly asks to {summary.lower()}",
            f"agent needs to run the first-party operation {operation.operation_key} instead of calling an external API",
            f"request matches the owner-governance workflow described as {capability}",
        ]
    return [
        f"owner asks to inspect or review data covered by {operation.operation_key}",
        f"agent needs the first-party platform context described as {summary.lower()}",
        f"request matches the owner-operation workflow described as {capability}",
    ]


def _operation_do_not_use_when(operation: OperationMetadata) -> list[str]:
    if operation.permission_class in {"action", "payment"}:
        return [
            "the owner has not reviewed the preview or has not approved the requested first-party platform change",
            "the request is unrelated to the documented owner operation or targets the wrong owned agent",
        ]
    return [
        "the owner wants to mutate state instead of only reading first-party platform data",
        "the request is unrelated to the documented owner operation",
    ]


def _operation_usage_hints(operation: OperationMetadata) -> list[str]:
    return [
        f"Use dry_run first so the owner can review the {operation.operation_key} preview before any live execution.",
    ]


def _operation_result_hints(operation: OperationMetadata) -> list[str]:
    return [
        "Lead with the summary and action, then include the structured result payload for follow-up tooling.",
    ]


def _operation_error_hints(operation: OperationMetadata) -> list[str]:
    return [
        "If the operation rejects the payload, surface which input field needs correction before retrying.",
    ]


def _operation_preview_schema(operation: OperationMetadata) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "Preview of the first-party operation."},
            "operation_key": {"type": "string", "description": "Owner operation that would run."},
            "agent_id": {"type": "string", "description": "Owned agent that would receive the operation."},
            "params": {"type": "object", "description": "Operation params after agent_id is removed from input."},
        },
        "required": ["summary", "operation_key", "agent_id", "params"],
        "additionalProperties": False,
    }


def build_operation_manifest(
    operation: OperationMetadata,
    *,
    capability_key_override: str | None = None,
) -> AppManifest:
    permission = _permission_class_from_operation(operation)
    return AppManifest(
        capability_key=(capability_key_override or default_capability_key_for_operation(operation.operation_key)).strip(),
        name=_operation_display_name(operation),
        job_to_be_done=f"Wrap the Siglume first-party operation `{operation.operation_key}` for owned agents.",
        category=AppCategory.OTHER,
        permission_class=permission,
        approval_mode=_approval_mode_from_operation(operation),
        dry_run_supported=True,
        required_connected_accounts=[],
        price_model=PriceModel.FREE,
        jurisdiction="US",
        short_description=operation.summary,
        docs_url="https://example.com/docs",
        support_contact="support@example.com",
        example_prompts=[f"Run {operation.operation_key} for my owned agent."],
    )


def build_operation_tool_manual(
    operation: OperationMetadata,
    manifest: AppManifest,
) -> dict[str, Any]:
    manual: dict[str, Any] = {
        "tool_name": operation.operation_key.replace(".", "_").replace("-", "_"),
        "job_to_be_done": f"Run the Siglume first-party operation `{operation.operation_key}` for an owned agent.",
        "summary_for_model": (
            f"Wraps the built-in Siglume owner operation `{operation.operation_key}` "
            f"and returns the structured platform response."
        ),
        "trigger_conditions": _operation_trigger_conditions(operation),
        "do_not_use_when": _operation_do_not_use_when(operation),
        "permission_class": _tool_permission_class_from_operation(operation).value,
        "dry_run_supported": True,
        "requires_connected_accounts": [],
        "input_schema": dict(operation.input_schema),
        "output_schema": dict(operation.output_schema),
        "usage_hints": _operation_usage_hints(operation),
        "result_hints": _operation_result_hints(operation),
        "error_hints": _operation_error_hints(operation),
    }
    if manifest.permission_class in (PermissionClass.ACTION, PermissionClass.PAYMENT):
        manual.update(
            {
                "approval_summary_template": f"Run {operation.operation_key} for {{agent_id}}.",
                "preview_schema": _operation_preview_schema(operation),
                "idempotency_support": True,
                "side_effect_summary": (
                    f"Runs the first-party owner operation `{operation.operation_key}` against the selected owned agent."
                ),
                "jurisdiction": manifest.jurisdiction,
            }
        )
    return manual


def _operation_adapter_source(operation: OperationMetadata, manifest: AppManifest) -> str:
    class_name = _operation_class_name(operation)
    permission_enum_name = {
        PermissionClass.ACTION: "ACTION",
        PermissionClass.PAYMENT: "PAYMENT",
    }.get(manifest.permission_class, "READ_ONLY")
    approval_enum_name = {
        ApprovalMode.ALWAYS_ASK: "ALWAYS_ASK",
        ApprovalMode.BUDGET_BOUNDED: "BUDGET_BOUNDED",
        ApprovalMode.DENY: "DENY",
    }.get(manifest.approval_mode, "AUTO")
    needs_approval = "True" if manifest.permission_class in (PermissionClass.ACTION, PermissionClass.PAYMENT) else "False"
    approval_prompt_line = (
        'approval_prompt=f"Run {OPERATION_KEY} for {agent_id}.",' if manifest.permission_class in (PermissionClass.ACTION, PermissionClass.PAYMENT) else ""
    )
    return textwrap.dedent(
        f'''\
        """Generated Siglume wrapper for `{operation.operation_key}`."""
        from __future__ import annotations

        import asyncio
        import os
        import sys
        from pathlib import Path

        try:
            from siglume_api_sdk import (
                AppAdapter,
                AppCategory,
                AppManifest,
                AppTestHarness,
                ApprovalMode,
                ExecutionContext,
                ExecutionKind,
                ExecutionResult,
                PermissionClass,
                PriceModel,
                SideEffectRecord,
                SiglumeClient,
            )
        except ImportError:
            sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
            from siglume_api_sdk import (
                AppAdapter,
                AppCategory,
                AppManifest,
                AppTestHarness,
                ApprovalMode,
                ExecutionContext,
                ExecutionKind,
                ExecutionResult,
                PermissionClass,
                PriceModel,
                SideEffectRecord,
                SiglumeClient,
            )

        try:
            from .stubs import GeneratedOperationStub, build_stubs
        except ImportError:
            from stubs import GeneratedOperationStub, build_stubs

        OPERATION_KEY = "{operation.operation_key}"
        DEFAULT_AGENT_ID = "{operation.agent_id or DEFAULT_OPERATION_AGENT_ID}"
        DEFAULT_LANGUAGE = "en"


        class {class_name}(AppAdapter):
            def __init__(self, client: SiglumeClient | None = None, stub_provider: GeneratedOperationStub | None = None) -> None:
                self._client = client
                self._stub_provider = stub_provider or GeneratedOperationStub(OPERATION_KEY)

            def manifest(self) -> AppManifest:
                return AppManifest(
                    capability_key="{manifest.capability_key}",
                    name="{manifest.name}",
                    job_to_be_done="{manifest.job_to_be_done}",
                    category=AppCategory.OTHER,
                    permission_class=PermissionClass.{permission_enum_name},
                    approval_mode=ApprovalMode.{approval_enum_name},
                    dry_run_supported=True,
                    required_connected_accounts=[],
                    price_model=PriceModel.FREE,
                    jurisdiction="{manifest.jurisdiction}",
                    short_description="{manifest.short_description}",
                    support_contact="{manifest.support_contact}",
                    docs_url="{manifest.docs_url}",
                    example_prompts={json.dumps(list(manifest.example_prompts or []))},
                )

            async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
                payload = dict(ctx.input_params or {{}})
                agent_id = str(payload.pop("agent_id", DEFAULT_AGENT_ID) or DEFAULT_AGENT_ID)
                preview = {{
                    "summary": f"Would run {{OPERATION_KEY}} for {{agent_id}}.",
                    "operation_key": OPERATION_KEY,
                    "agent_id": agent_id,
                    "params": payload,
                }}
                if ctx.execution_kind == ExecutionKind.DRY_RUN:
                    return ExecutionResult(
                        success=True,
                        execution_kind=ctx.execution_kind,
                        output=preview,
                        needs_approval={needs_approval},
                        {approval_prompt_line}
                    )

                execution = await self._invoke_operation(agent_id, payload)
                return ExecutionResult(
                    success=True,
                    execution_kind=ctx.execution_kind,
                    output={{
                        "summary": execution["message"],
                        "action": execution["action"],
                        "result": execution["result"],
                    }},
                    receipt_summary={{
                        "action": execution["action"],
                        "operation_key": OPERATION_KEY,
                        "agent_id": agent_id,
                    }},
                    side_effects=[
                        SideEffectRecord(
                            action=execution["action"],
                            provider="siglume_owner_operation",
                            external_id=agent_id,
                            reversible=False,
                            metadata={{"operation_key": OPERATION_KEY}},
                        )
                    ] if ctx.execution_kind != ExecutionKind.DRY_RUN else [],
                )

            async def _invoke_operation(self, agent_id: str, params: dict[str, object]) -> dict[str, object]:
                if self._client is not None:
                    result = self._client.execute_owner_operation(agent_id, OPERATION_KEY, params, lang=DEFAULT_LANGUAGE)
                    return {{"message": result.message, "action": result.action, "result": result.result}}
                api_key = str(os.environ.get("SIGLUME_API_KEY") or "").strip()
                if api_key:
                    with SiglumeClient(api_key=api_key) as client:
                        result = client.execute_owner_operation(agent_id, OPERATION_KEY, params, lang=DEFAULT_LANGUAGE)
                    return {{"message": result.message, "action": result.action, "result": result.result}}
                return await self._stub_provider.handle("execute", {{"operation": OPERATION_KEY, "agent_id": agent_id, "params": params}})

            def supported_task_types(self) -> list[str]:
                return ["{_operation_task_type(operation)}"]


        async def main() -> None:
            harness = AppTestHarness({class_name}(), stubs=build_stubs())
            print("manifest_issues:", harness.validate_manifest())
            dry_run = await harness.dry_run(task_type="{_operation_task_type(operation)}")
            print("dry_run:", dry_run.success)
            if {needs_approval}:
                action = await harness.execute_action(task_type="{_operation_task_type(operation)}")
                print("action:", action.success)
                print("receipt_issues:", len(harness.validate_receipt(action)))


        if __name__ == "__main__":
            asyncio.run(main())
        '''
    )


def _operation_stubs_source(operation: OperationMetadata) -> str:
    return textwrap.dedent(
        f'''\
        """Generated stubs for `{operation.operation_key}`."""
        from __future__ import annotations

        import sys
        from pathlib import Path
        from typing import Any

        try:
            from siglume_api_sdk import StubProvider
        except ImportError:
            sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
            from siglume_api_sdk import StubProvider

        OPERATION_KEY = "{operation.operation_key}"


        class GeneratedOperationStub(StubProvider):
            def __init__(self, operation_key: str = OPERATION_KEY) -> None:
                super().__init__("siglume_owner_operation")
                self.operation_key = operation_key

            async def handle(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
                agent_id = str(params.get("agent_id") or "{operation.agent_id or DEFAULT_OPERATION_AGENT_ID}")
                payload = dict(params.get("params") or {{}})
                return {{
                    "message": f"Stubbed {{self.operation_key}} for {{agent_id}}.",
                    "action": self.operation_key.replace(".", "_"),
                    "result": {{
                        "operation_key": self.operation_key,
                        "agent_id": agent_id,
                        "stubbed": True,
                        "params": payload,
                    }},
                }}


        def build_stubs() -> dict[str, StubProvider]:
            return {{"siglume_owner_operation": GeneratedOperationStub()}}
        '''
    )


def _operation_test_source(operation: OperationMetadata) -> str:
    class_name = _operation_class_name(operation)
    return textwrap.dedent(
        f'''\
        from __future__ import annotations

        import asyncio
        import json
        import sys
        from pathlib import Path

        ROOT = Path(__file__).resolve().parents[1]
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))

        from ..adapter import {class_name}  # noqa: E402
        from ..stubs import build_stubs  # noqa: E402
        from siglume_api_sdk import AppTestHarness, score_tool_manual_offline, validate_tool_manual  # noqa: E402


        def test_generated_template_harness_and_quality() -> None:
            harness = AppTestHarness({class_name}(), stubs=build_stubs())
            manual = json.loads((ROOT / "tool_manual.json").read_text(encoding="utf-8"))
            ok, issues = validate_tool_manual(manual)
            report = score_tool_manual_offline(manual)

            assert ok, issues
            assert report.grade in {{"A", "B"}}
            assert not harness.validate_manifest()

            async def _run() -> None:
                dry_run = await harness.dry_run(task_type="{_operation_task_type(operation)}")
                assert dry_run.success
                if "{operation.permission_class}" in {{"action", "payment"}}:
                    action = await harness.execute_action(task_type="{_operation_task_type(operation)}")
                    assert action.success
                    assert not harness.validate_receipt(action)

            asyncio.run(_run())
        '''
    )


def _operation_readme_template(operation: OperationMetadata, manifest: AppManifest, warning: str | None) -> str:
    lines = [
        f"# {manifest.name}",
        "",
        f"This starter wraps the first-party Siglume owner operation `{operation.operation_key}`.",
        "",
        f"- Source catalog: `{operation.source}`",
        f"- Default agent_id: `{operation.agent_id or DEFAULT_OPERATION_AGENT_ID}`",
        f"- Permission class: `{operation.permission_class}`",
        f"- Approval mode: `{operation.approval_mode}`",
    ]
    if warning:
        lines.append(f"- Warning: {warning}")
    lines.extend(
        [
            f"- Route page: `{operation.page_href or '/owner'}`",
            "",
            "## Generated files",
            "",
            "- `adapter.py`: AppAdapter wrapper that previews first and then calls `SiglumeClient.execute_owner_operation()`",
            "- `stubs.py`: mock fallback used when `SIGLUME_API_KEY` is not set",
            "- `manifest.json`: reviewable manifest snapshot",
            "- `tool_manual.json`: machine-generated ToolManual scaffold",
            "- `runtime_validation.json`: local public endpoint and review-key checks used by auto-register",
            "- `docs/api-usage.md`: publishable API usage guide template for `docs_url`",
            "- `.gitignore`: keeps runtime review keys and OAuth client secrets out of Git",
            "- `tests/test_adapter.py`: smoke test for `AppTestHarness`",
            "",
            "Before registering, replace all generated placeholders:",
            "- In `adapter.py` and `manifest.json`, replace `docs_url` with a dedicated public API usage guide, not a homepage.",
            "- Replace `support_contact` with a real support email address or public support URL.",
            "- Optional `seller_homepage_url` is the seller's official site and can stay blank.",
            "- In the local `runtime_validation.json`, replace the public URL and review-key placeholders.",
            "- If the API uses seller-side OAuth, create a local `oauth_credentials.json` next to the adapter.",
            "- Do not commit real review keys or OAuth client secrets; the generated `.gitignore` excludes those files.",
            "- Because `runtime_validation.json` is ignored, GitHub samples do not commit review-key values.",
            "",
            "## Commands",
            "",
            "Start locally without a Siglume API key:",
            "",
            "```bash",
            "siglume test .",
            "pytest tests/test_adapter.py",
            "siglume score . --offline",
            "```",
            "",
            "After placeholders are replaced and `SIGLUME_API_KEY` is issued from Developer Portal -> CLI / API keys, run the server-aligned checks:",
            "",
            "```bash",
            "siglume validate .",
            "siglume score . --remote",
            "siglume preflight .",
            "siglume register .",
            "# inspect the draft, then explicitly approve publish:",
            "siglume register . --confirm",
            "```",
            "",
        ]
    )
    return "\n".join(lines)


def _api_usage_docs_template(manifest: AppManifest) -> str:
    payload = to_jsonable(manifest)
    name = str(payload.get("name") or payload.get("capability_key") or "Siglume API")
    capability_key = str(payload.get("capability_key") or "replace-with-capability-key")
    job_to_be_done = str(payload.get("job_to_be_done") or "Describe what this API lets an agent do.")
    permission_class = str(payload.get("permission_class") or "read-only")
    price_model = str(payload.get("price_model") or "free")
    required_accounts = (
        ", ".join(
            label
            for label in (
                _connected_account_requirement_label(item)
                for item in (payload.get("required_connected_accounts") or [])
            )
            if label
        )
        or "none"
    )
    support_contact = str(payload.get("support_contact") or "replace-with-support-contact")
    return textwrap.dedent(
        f"""
        # {name} API Usage Guide

        This page is the dedicated public usage guide for the Siglume API
        listing `{capability_key}`. Publish this page at an anonymous HTTP 200
        URL and use that URL as `docs_url`.

        Do not use your company homepage as `docs_url`; keep seller/company
        homepages in `seller_homepage_url`.

        ## What This API Does

        {job_to_be_done}

        ## Permission Model

        - Permission class: `{permission_class}`
        - Price model: `{price_model}`
        - Required connected accounts: `{required_accounts}`

        ## Inputs

        Describe the request fields your API accepts. Keep this aligned with
        `tool_manual.json` and `runtime_validation.json`.

        ## Outputs

        Describe the response fields your API returns. Include the fields in
        `runtime_validation.expected_response_fields`.

        ## Errors And Support

        Explain common error messages and how an owner should recover.

        Support contact: {support_contact}
        """
    ).strip() + "\n"


def _generated_gitignore() -> str:
    return "\n".join(
        [
            "# Local secrets and registration-only runtime checks.",
            ".env",
            ".env.*",
            "!.env.example",
            "runtime_validation.json",
            "runtime-validation.json",
            "oauth_credentials.json",
            "oauth-credentials.json",
            "",
            "# Python / test artifacts.",
            "__pycache__/",
            "*.py[cod]",
            ".pytest_cache/",
            ".mypy_cache/",
            ".coverage",
            "htmlcov/",
            "dist/",
            "build/",
            "*.egg-info/",
            "",
            "# JavaScript tooling if this project also uses TypeScript helpers.",
            "node_modules/",
            "coverage/",
        ]
    ) + "\n"


def _write_or_merge_gitignore(path: Path) -> None:
    generated_lines = _generated_gitignore().splitlines()
    if not path.exists():
        path.write_text("\n".join(generated_lines) + "\n", encoding="utf-8")
        return

    existing = path.read_text(encoding="utf-8")
    existing_entries = {line.strip() for line in existing.splitlines()}
    additions = [line for line in generated_lines if line.strip() and line.strip() not in existing_entries]
    if not additions:
        return

    prefix = existing if existing.endswith("\n") else f"{existing}\n"
    path.write_text(
        f"{prefix}\n# Siglume generated ignores.\n" + "\n".join(additions) + "\n",
        encoding="utf-8",
    )


def write_operation_template(
    operation_key: str,
    destination: Path,
    *,
    capability_key_override: str | None = None,
    agent_id: str | None = None,
    lang: str = "en",
) -> tuple[list[Path], OperationMetadata, dict[str, Any]]:
    destination.mkdir(parents=True, exist_ok=True)
    tests_dir = destination / "tests"
    tests_dir.mkdir(parents=True, exist_ok=True)
    package_init_path = destination / "__init__.py"
    tests_init_path = tests_dir / "__init__.py"
    adapter_path = destination / "adapter.py"
    stubs_path = destination / "stubs.py"
    manifest_path = destination / "manifest.json"
    tool_manual_path = destination / "tool_manual.json"
    runtime_validation_path = destination / "runtime_validation.json"
    gitignore_path = destination / ".gitignore"
    readme_path = destination / "README.md"
    test_path = tests_dir / "test_adapter.py"
    docs_dir = destination / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    docs_usage_path = docs_dir / "api-usage.md"

    for path in (
        package_init_path,
        tests_init_path,
        adapter_path,
        stubs_path,
        manifest_path,
        tool_manual_path,
        runtime_validation_path,
        docs_usage_path,
        readme_path,
        test_path,
    ):
        if path.exists():
            raise click.ClickException(f"{path.name} already exists in {destination}")

    operation, warning = _resolve_operation_metadata(operation_key, agent_id=agent_id, lang=lang)
    manifest = build_operation_manifest(operation, capability_key_override=capability_key_override)
    tool_manual = build_operation_tool_manual(operation, manifest)
    valid, issues = validate_tool_manual(tool_manual)
    quality = score_tool_manual_offline(tool_manual)
    if not valid:
        raise click.ClickException(f"Generated tool manual for {operation.operation_key} is invalid: {issues}")
    if quality.grade not in {"A", "B"}:
        raise click.ClickException(
            f"Generated tool manual for {operation.operation_key} scored below publish bar: {quality.grade}"
        )

    package_init_path.write_text("", encoding="utf-8")
    tests_init_path.write_text("", encoding="utf-8")
    adapter_path.write_text(_operation_adapter_source(operation, manifest), encoding="utf-8")
    stubs_path.write_text(_operation_stubs_source(operation), encoding="utf-8")
    manifest_path.write_text(render_json(manifest), encoding="utf-8")
    tool_manual_path.write_text(render_json(tool_manual), encoding="utf-8")
    runtime_validation_path.write_text(render_json(_build_runtime_validation_template(tool_manual)), encoding="utf-8")
    docs_usage_path.write_text(_api_usage_docs_template(manifest), encoding="utf-8")
    _write_or_merge_gitignore(gitignore_path)
    readme_path.write_text(_operation_readme_template(operation, manifest, warning), encoding="utf-8")
    test_path.write_text(_operation_test_source(operation), encoding="utf-8")
    return (
        [
            package_init_path,
            tests_init_path,
            adapter_path,
            stubs_path,
            manifest_path,
            tool_manual_path,
            runtime_validation_path,
            docs_usage_path,
            gitignore_path,
            readme_path,
            test_path,
        ],
        operation,
        {
            "tool_manual_valid": valid,
            "tool_manual_issues": [to_jsonable(issue) for issue in issues],
            "quality": to_jsonable(quality),
            "warning": warning,
        },
    )


def write_init_template(template: str, destination: Path) -> list[Path]:
    destination.mkdir(parents=True, exist_ok=True)
    adapter_path = destination / "adapter.py"
    manifest_path = destination / "manifest.json"
    tool_manual_path = destination / "tool_manual.json"
    runtime_validation_path = destination / "runtime_validation.json"
    gitignore_path = destination / ".gitignore"
    readme_path = destination / "README.md"
    docs_dir = destination / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    docs_usage_path = docs_dir / "api-usage.md"

    for path in (adapter_path, manifest_path, tool_manual_path, runtime_validation_path, docs_usage_path, readme_path):
        if path.exists():
            raise click.ClickException(f"{path.name} already exists in {destination}")

    example_name = TEMPLATE_EXAMPLES[template]
    example_path = EXAMPLES_ROOT / example_name
    if example_path.exists():
        copyfile(example_path, adapter_path)
    else:
        adapter_path.write_text(_fallback_template_source(template), encoding="utf-8")

    project = load_project(adapter_path)
    manifest_path.write_text(render_json(project.manifest), encoding="utf-8")
    tool_manual_path.write_text(render_json(project.tool_manual), encoding="utf-8")
    runtime_validation_path.write_text(
        render_json(_build_runtime_validation_template(project.tool_manual)),
        encoding="utf-8",
    )
    docs_usage_path.write_text(_api_usage_docs_template(project.manifest), encoding="utf-8")
    _write_or_merge_gitignore(gitignore_path)
    readme_path.write_text(_readme_template(template), encoding="utf-8")
    return [adapter_path, manifest_path, tool_manual_path, runtime_validation_path, docs_usage_path, gitignore_path, readme_path]


def resolve_api_key() -> str:
    env_value = os.environ.get("SIGLUME_API_KEY")
    if env_value:
        return env_value

    credentials_path = Path.home() / ".siglume" / "credentials.toml"
    if credentials_path.exists():
        data = tomllib.loads(credentials_path.read_text(encoding="utf-8"))
        api_key = data.get("api_key")
        if isinstance(api_key, str) and api_key.strip():
            return api_key.strip()
        default_section = data.get("default")
        if isinstance(default_section, dict):
            nested_key = default_section.get("api_key")
            if isinstance(nested_key, str) and nested_key.strip():
                return nested_key.strip()

    raise click.ClickException(
        "SIGLUME_API_KEY is not set. Export it or add api_key to ~/.siglume/credentials.toml."
    )


def validate_project(path: str | Path) -> dict[str, Any]:
    project = load_project(path)
    manifest_issues = project_validation_issues(project)
    manual_valid, manual_issues = validate_tool_manual(project.tool_manual)
    api_key = resolve_api_key()
    with SiglumeClient(api_key=api_key) as client:
        remote_quality = client.preview_quality_score(project.tool_manual)
    return {
        "adapter_path": str(project.adapter_path),
        "manifest": to_jsonable(project.manifest),
        "manifest_issues": manifest_issues,
        "tool_manual_path": str(project.tool_manual_path) if project.tool_manual_path else None,
        "tool_manual": project.tool_manual,
        "tool_manual_valid": manual_valid,
        "tool_manual_issues": [to_jsonable(issue) for issue in manual_issues],
        "remote_quality": to_jsonable(remote_quality),
        "ok": not manifest_issues and manual_valid and _remote_quality_ok(remote_quality),
    }


def score_project(path: str | Path, *, mode: str) -> dict[str, Any]:
    project = load_project(path)
    manual_valid, manual_issues = validate_tool_manual(project.tool_manual)
    if mode == "remote":
        api_key = resolve_api_key()
        with SiglumeClient(api_key=api_key) as client:
            quality = client.preview_quality_score(project.tool_manual)
    elif mode == "offline":
        quality = score_tool_manual_offline(project.tool_manual)
    else:
        raise click.ClickException(f"Unknown score mode: {mode}")
    return {
        "mode": mode,
        "adapter_path": str(project.adapter_path),
        "tool_manual_path": str(project.tool_manual_path) if project.tool_manual_path else None,
        "tool_manual_valid": manual_valid,
        "tool_manual_issues": [to_jsonable(issue) for issue in manual_issues],
        "quality": to_jsonable(quality),
        "ok": manual_valid and _remote_quality_ok(quality),
    }


def _manifest_price_model(manifest: AppManifest) -> str:
    return str(to_jsonable(manifest.price_model) or "free").strip().lower()


def _ensure_paid_payout_ready(project: LoadedProject, client: SiglumeClient) -> dict[str, Any] | None:
    if _manifest_price_model(project.manifest) == "free":
        return None
    portal = client.get_developer_portal()
    readiness = dict(portal.payout_readiness or {})
    if readiness.get("verified_destination") is not True:
        raise click.ClickException(
            "Paid API registration requires a verified Polygon payout destination. "
            "Open https://siglume.com/owner/credits/payout and confirm the embedded-wallet payout token, or call "
            "`GET /v1/market/developer/portal` and wait until "
            "`payout_readiness.verified_destination` is true."
        )
    return to_jsonable(portal)


def _ensure_manifest_publisher_identity(project: LoadedProject) -> None:
    manifest_payload = to_jsonable(project.manifest)
    docs_url = str(manifest_payload.get("docs_url") or manifest_payload.get("documentation_url") or "").strip()
    support_contact = str(manifest_payload.get("support_contact") or "").strip()
    seller_homepage_url = str(manifest_payload.get("seller_homepage_url") or "").strip()
    seller_social_url = str(manifest_payload.get("seller_social_url") or "").strip()
    jurisdiction = str(manifest_payload.get("jurisdiction") or "").strip()
    issues = []
    if not docs_url:
        issues.append("manifest.docs_url is required")
    elif _looks_like_placeholder(docs_url):
        issues.append("manifest.docs_url must be replaced with your public documentation URL")
    elif not _looks_like_http_url(docs_url):
        issues.append("manifest.docs_url must be an http(s) URL")
    elif _looks_like_root_url(docs_url):
        issues.append("manifest.docs_url must be a dedicated API usage page, not a root homepage URL")
    if not support_contact:
        issues.append("manifest.support_contact is required")
    elif _looks_like_placeholder(support_contact):
        issues.append("manifest.support_contact must be replaced with your real support email or support URL")
    elif not _looks_like_email(support_contact) and not _looks_like_http_url(support_contact):
        issues.append("manifest.support_contact must be a real email address or http(s) support URL")
    if seller_homepage_url and (_looks_like_placeholder(seller_homepage_url) or not _looks_like_http_url(seller_homepage_url)):
        issues.append("manifest.seller_homepage_url must be a real http(s) official homepage URL when provided")
    if seller_social_url and (_looks_like_placeholder(seller_social_url) or not _looks_like_http_url(seller_social_url)):
        issues.append("manifest.seller_social_url must be a real http(s) official social/profile URL when provided")
    if not jurisdiction:
        issues.append("manifest.jurisdiction is required")
    if issues:
        raise click.ClickException(
            "Production auto-register requires real publisher identity before calling Siglume:\n"
            + "\n".join(f"- {issue}" for issue in issues)
        )


def _looks_like_placeholder(value: str) -> bool:
    normalized = value.strip().lower()
    return (
        not normalized
        or "example.com" in normalized
        or "example.net" in normalized
        or "example.org" in normalized
        or normalized.startswith("replace-with-")
        or normalized.startswith("your-")
        or "your-domain" in normalized
        or "localhost" in normalized
        or "127.0.0.1" in normalized
        or "0.0.0.0" in normalized
    )


def _looks_like_http_url(value: str) -> bool:
    parsed = urlparse(value.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _looks_like_root_url(value: str) -> bool:
    parsed = urlparse(value.strip())
    return _looks_like_http_url(value) and (parsed.path or "/").strip("/") == ""


def _looks_like_email(value: str) -> bool:
    normalized = value.strip()
    return (
        "@" in normalized
        and " " not in normalized
        and "." in normalized.rsplit("@", 1)[-1]
        and not normalized.startswith("@")
    )


def _runtime_placeholder_issues(runtime_validation: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    required_fields = (
        "public_base_url",
        "healthcheck_url",
        "invoke_url",
        "test_auth_header_name",
        "test_auth_header_value",
        "expected_response_fields",
    )
    for field_name in required_fields:
        if not runtime_validation.get(field_name):
            issues.append(f"runtime_validation.{field_name} is required")

    for field_name in ("public_base_url", "healthcheck_url", "invoke_url"):
        value = str(runtime_validation.get(field_name) or "").strip().lower()
        if _looks_like_placeholder(value):
            issues.append(f"runtime_validation.{field_name} must be replaced with your public production URL")

    auth_value = str(runtime_validation.get("test_auth_header_value") or "").strip()
    if not auth_value or auth_value.startswith("replace-with-"):
        issues.append("runtime_validation.test_auth_header_value must be a dedicated review secret, not a placeholder")

    request_payload = runtime_validation.get("request_payload")
    if request_payload is None:
        request_payload = runtime_validation.get("test_request_body")
    if request_payload is None:
        request_payload = runtime_validation.get("runtime_sample")
    if request_payload is None:
        request_payload = runtime_validation.get("sample_request_payload")
    if request_payload is None:
        request_payload = runtime_validation.get("runtime_sample_request")
    if not isinstance(request_payload, dict):
        issues.append("runtime_validation.request_payload must be a JSON object")

    expected_fields = runtime_validation.get("expected_response_fields")
    if not isinstance(expected_fields, list) or not any(isinstance(item, str) and item.strip() for item in expected_fields):
        issues.append("runtime_validation.expected_response_fields must include at least one field path")
    return issues


def _ensure_runtime_validation_ready(project: LoadedProject) -> None:
    if project.runtime_validation is None:
        raise click.ClickException(
            "runtime_validation.json is required for `siglume register`. "
            "Create it with your public_base_url, healthcheck_url, invoke_url, "
            "dedicated review auth header, request_payload, and expected_response_fields."
        )
    issues = _runtime_placeholder_issues(project.runtime_validation)
    if issues:
        path = project.runtime_validation_path or (project.root_dir / "runtime_validation.json")
        raise click.ClickException(
            f"{path} is not ready for production registration:\n"
            + "\n".join(f"- {issue}" for issue in issues)
        )


def _ensure_explicit_tool_manual(project: LoadedProject) -> None:
    if project.tool_manual_path is None:
        raise click.ClickException(
            "tool_manual.json is required for `siglume register`. "
            "Run `siglume init`, or create a Tool Manual explicitly before registering."
        )


def _registration_preflight(project: LoadedProject, client: SiglumeClient) -> dict[str, Any]:
    manifest_issues = project_validation_issues(project)
    manual_valid, manual_issues = validate_tool_manual(project.tool_manual)
    remote_quality = client.preview_quality_score(project.tool_manual)
    required_oauth_providers = _required_oauth_providers(project.manifest.required_connected_accounts)
    oauth_provider_records = _oauth_provider_records_map(project.oauth_credentials)
    missing_oauth_providers = [
        provider for provider in required_oauth_providers if provider not in oauth_provider_records
    ]
    errors: list[str] = []
    errors.extend(str(issue) for issue in manifest_issues)
    blocking_manual_issues = [
        issue
        for issue in manual_issues
        if str(getattr(issue, "severity", "error") or "error").lower() == "error"
    ]
    errors.extend(str(issue.message) for issue in blocking_manual_issues)
    if not manual_valid:
        errors.append("tool_manual.json is not valid for production registration")
    if not _remote_quality_ok(remote_quality):
        grade = getattr(remote_quality, "grade", "?")
        score = getattr(remote_quality, "overall_score", "?")
        errors.append(f"remote Tool Manual quality is not publishable: {grade} ({score}/100)")
    if missing_oauth_providers:
        errors.append(
            "oauth_credentials.json is required for platform-managed OAuth APIs: "
            + ", ".join(missing_oauth_providers)
        )
    preflight = {
        "manifest_issues": manifest_issues,
        "tool_manual_valid": manual_valid,
        "tool_manual_issues": [to_jsonable(issue) for issue in manual_issues],
        "remote_quality": to_jsonable(remote_quality),
        "required_oauth_providers": required_oauth_providers,
        "oauth_credentials_path": str(project.oauth_credentials_path) if project.oauth_credentials_path else None,
        "oauth_missing_providers": missing_oauth_providers,
        "ok": not errors,
    }
    if errors:
        raise click.ClickException(
            "Registration preflight failed. Fix these before calling auto-register:\n"
            + "\n".join(f"- {error}" for error in errors)
        )
    return preflight


def run_registration(path: str | Path, *, confirm: bool, submit_review: bool) -> dict[str, Any]:
    project = load_project(path)
    _ensure_explicit_tool_manual(project)
    _ensure_manifest_publisher_identity(project)
    _ensure_runtime_validation_ready(project)
    _ensure_required_oauth_credentials(project)
    canonical_oauth_credentials = _canonical_oauth_credentials_payload(project.oauth_credentials)
    api_key = resolve_api_key()
    with SiglumeClient(api_key=api_key) as client:
        registration_preflight = _registration_preflight(project, client)
        portal_preflight = _ensure_paid_payout_ready(project, client)
        receipt = client.auto_register(
            project.manifest,
            project.tool_manual,
            runtime_validation=project.runtime_validation,
            oauth_credentials=canonical_oauth_credentials,
        )
        result: dict[str, Any] = {
            "receipt": to_jsonable(receipt),
            "registration_preflight": registration_preflight,
            "runtime_validation_path": str(project.runtime_validation_path) if project.runtime_validation_path else None,
            "oauth_credentials_path": str(project.oauth_credentials_path) if project.oauth_credentials_path else None,
        }
        if portal_preflight is not None:
            result["developer_portal_preflight"] = portal_preflight
        if confirm:
            confirmation = client.confirm_registration(receipt.listing_id)
            result["confirmation"] = to_jsonable(confirmation)
            if submit_review:
                result["submit_review_skipped"] = True
        elif submit_review:
            review = client.submit_review(receipt.listing_id)
            result["review"] = to_jsonable(review)
        return result


def run_preflight(path: str | Path) -> dict[str, Any]:
    project = load_project(path)
    _ensure_explicit_tool_manual(project)
    _ensure_manifest_publisher_identity(project)
    _ensure_runtime_validation_ready(project)
    _ensure_required_oauth_credentials(project)
    api_key = resolve_api_key()
    with SiglumeClient(api_key=api_key) as client:
        registration_preflight = _registration_preflight(project, client)
        portal_preflight = _ensure_paid_payout_ready(project, client)
    result: dict[str, Any] = {
        "ok": True,
        "adapter_path": str(project.adapter_path),
        "registration_preflight": registration_preflight,
        "runtime_validation_path": str(project.runtime_validation_path) if project.runtime_validation_path else None,
        "oauth_credentials_path": str(project.oauth_credentials_path) if project.oauth_credentials_path else None,
    }
    if portal_preflight is not None:
        result["developer_portal_preflight"] = portal_preflight
    return result


def create_support_case_report(
    *,
    subject: str,
    body: str,
    trace_id: str | None,
) -> dict[str, Any]:
    api_key = resolve_api_key()
    with SiglumeClient(api_key=api_key) as client:
        support_case = client.create_support_case(subject, body, trace_id=trace_id)
    return {"case": to_jsonable(support_case)}


def get_usage_report(
    *,
    capability_key: str | None,
    window: str,
) -> dict[str, Any]:
    api_key = resolve_api_key()
    with SiglumeClient(api_key=api_key) as client:
        page = client.get_usage(capability_key=capability_key, period_key=window)
        items = page.all_items()
    return {
        "window": window,
        "capability_key": capability_key,
        "items": [to_jsonable(item) for item in items],
        "count": len(items),
    }


def run_harness(path: str | Path) -> dict[str, Any]:
    project = load_project(path)
    return asyncio.run(_run_harness_async(project))


def project_validation_issues(project: LoadedProject) -> list[str]:
    harness = AppTestHarness(project.app)
    return harness.validate_manifest()


async def _run_harness_async(project: LoadedProject) -> dict[str, Any]:
    harness = AppTestHarness(project.app)
    manifest_issues = harness.validate_manifest()
    health = await harness.health()
    task_types = project.app.supported_task_types() or ["default"]
    task_type = task_types[0]
    sample_input = _sample_input_from_schema(project.tool_manual.get("input_schema"))

    checks: list[dict[str, Any]] = [
        {
            "name": "manifest_validation",
            "ok": not manifest_issues,
            "details": manifest_issues,
        },
        {
            "name": "health",
            "ok": bool(health.healthy),
            "details": {"healthy": health.healthy, "message": health.message},
        },
    ]

    dry_run = await harness.dry_run(task_type=task_type, input_params=sample_input)
    checks.append(_execution_check("dry_run", dry_run, harness))

    if project.manifest.permission_class in (PermissionClass.ACTION, PermissionClass.PAYMENT):
        action_result = await harness.execute_action(task_type=task_type, input_params=sample_input)
        checks.append(_execution_check("action", action_result, harness))

    if project.manifest.permission_class == PermissionClass.PAYMENT:
        quote_result = await harness.execute_quote(task_type=task_type, input_params=sample_input)
        checks.append(_execution_check("quote", quote_result, harness))
        payment_result = await harness.execute_payment(task_type=task_type, input_params=sample_input)
        checks.append(_execution_check("payment", payment_result, harness))

    missing_account_result = await harness.simulate_connected_account_missing(
        task_type=task_type,
        input_params=sample_input,
    )
    checks.append(_execution_check("missing_account_simulation", missing_account_result, harness))

    overall_ok = all(check["ok"] for check in checks)
    return {
        "adapter_path": str(project.adapter_path),
        "task_type": task_type,
        "sample_input": sample_input,
        "checks": checks,
        "ok": overall_ok,
    }


def _execution_check(name: str, result: Any, harness: AppTestHarness) -> dict[str, Any]:
    receipt_issues = harness.validate_receipt(result)
    return {
        "name": name,
        "ok": bool(getattr(result, "success", False)) and not receipt_issues,
        "details": {
            "success": bool(getattr(result, "success", False)),
            "execution_kind": getattr(getattr(result, "execution_kind", None), "value", getattr(result, "execution_kind", None)),
            "receipt_issues": receipt_issues,
            "output": to_jsonable(getattr(result, "output", {})),
        },
    }


def _tool_manual_permission_class(permission_class: PermissionClass) -> ToolManualPermissionClass:
    mapping = {
        PermissionClass.READ_ONLY: ToolManualPermissionClass.READ_ONLY,
        PermissionClass.RECOMMENDATION: ToolManualPermissionClass.READ_ONLY,
        PermissionClass.ACTION: ToolManualPermissionClass.ACTION,
        PermissionClass.PAYMENT: ToolManualPermissionClass.PAYMENT,
    }
    return mapping[permission_class]


def _find_adapter_path(target: Path) -> Path:
    if target.is_file():
        if target.suffix != ".py":
            raise click.ClickException("Path must point to a Python adapter file or a project directory.")
        return target
    if not target.exists():
        raise click.ClickException(f"Path not found: {target}")

    preferred = target / "adapter.py"
    if preferred.exists():
        return preferred

    python_files = sorted(
        path
        for path in target.glob("*.py")
        if path.name not in {"__init__.py", "register_via_client.py"}
    )
    if len(python_files) == 1:
        return python_files[0]
    if not python_files:
        raise click.ClickException(f"No adapter Python file found in {target}")
    raise click.ClickException(
        f"Multiple Python files found in {target}. Pass the adapter file path explicitly."
    )


def _find_tool_manual_path(root_dir: Path) -> Path | None:
    for name in ("tool_manual.json", "tool-manual.json"):
        candidate = root_dir / name
        if candidate.exists():
            return candidate
    return None


def _find_runtime_validation_path(root_dir: Path) -> Path | None:
    for name in ("runtime_validation.json", "runtime-validation.json"):
        candidate = root_dir / name
        if candidate.exists():
            return candidate
    return None


def _find_oauth_credentials_path(root_dir: Path) -> Path | None:
    for name in ("oauth_credentials.json", "oauth-credentials.json"):
        candidate = root_dir / name
        if candidate.exists():
            return candidate
    return None


def _load_json_object(path: Path, label: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise click.ClickException(f"{path.name} is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise click.ClickException(f"{label} must be a JSON object")
    return payload


@contextmanager
def _temporary_sys_path(*paths: Path) -> Iterator[None]:
    additions = [str(path) for path in paths if str(path) not in sys.path]
    sys.path[:0] = additions
    try:
        yield
    finally:
        for path in additions:
            if path in sys.path:
                sys.path.remove(path)


def _load_app(adapter_path: Path) -> AppAdapter:
    module_name = f"siglume_cli_target_{adapter_path.stem}_{abs(hash(str(adapter_path)))}"
    spec = importlib.util.spec_from_file_location(module_name, adapter_path)
    if spec is None or spec.loader is None:
        raise click.ClickException(f"Could not load adapter module from {adapter_path}")
    module = importlib.util.module_from_spec(spec)
    with _temporary_sys_path(adapter_path.parent, SDK_ROOT):
        spec.loader.exec_module(module)

    subclasses = [
        member
        for _, member in inspect.getmembers(module, inspect.isclass)
        if issubclass(member, AppAdapter) and member is not AppAdapter and member.__module__ == module.__name__
    ]
    if not subclasses:
        raise click.ClickException(f"No AppAdapter subclass found in {adapter_path}")
    if len(subclasses) > 1:
        raise click.ClickException(
            f"Multiple AppAdapter subclasses found in {adapter_path}. Keep one per file for CLI workflows."
        )
    return subclasses[0]()


def _sample_input_from_schema(schema: Any) -> dict[str, Any]:
    if not isinstance(schema, dict):
        return {"query": "Run a representative test request."}
    properties = schema.get("properties")
    required = schema.get("required")
    if not isinstance(properties, dict):
        return {"query": "Run a representative test request."}
    required_fields = [item for item in required if isinstance(item, str)] if isinstance(required, list) else list(properties.keys())
    return {
        field_name: _sample_value_from_property(field_schema)
        for field_name, field_schema in properties.items()
        if field_name in required_fields
    } or {"query": "Run a representative test request."}


def _sample_value_from_property(schema: Any) -> Any:
    if not isinstance(schema, dict):
        return "sample"
    if "default" in schema:
        return schema["default"]
    enum_values = schema.get("enum")
    if isinstance(enum_values, list) and enum_values:
        return enum_values[0]
    schema_type = schema.get("type")
    if schema_type == "integer":
        return 1
    if schema_type == "number":
        return 1.0
    if schema_type == "boolean":
        return True
    if schema_type == "array":
        items = schema.get("items", {})
        return [_sample_value_from_property(items)]
    if schema_type == "object":
        nested_properties = schema.get("properties")
        if isinstance(nested_properties, dict):
            return {
                key: _sample_value_from_property(value)
                for key, value in nested_properties.items()
            }
        return {}
    return "sample"


def _fallback_template_source(template: str) -> str:
    class_name = {
        "echo": "StarterEchoApp",
        "price-compare": "StarterPriceCompareApp",
        "publisher": "StarterPublisherApp",
        "payment": "StarterPaymentApp",
    }[template]
    permission_class = {
        "echo": "PermissionClass.READ_ONLY",
        "price-compare": "PermissionClass.READ_ONLY",
        "publisher": "PermissionClass.ACTION",
        "payment": "PermissionClass.PAYMENT",
    }[template]
    approval_mode = {
        "echo": "ApprovalMode.AUTO",
        "price-compare": "ApprovalMode.AUTO",
        "publisher": "ApprovalMode.ALWAYS_ASK",
        "payment": "ApprovalMode.ALWAYS_ASK",
    }[template]
    return textwrap.dedent(
        f"""
        from siglume_api_sdk import (
            AppAdapter,
            AppCategory,
            AppManifest,
            ApprovalMode,
            ExecutionContext,
            ExecutionResult,
            PermissionClass,
            PriceModel,
        )


        class {class_name}(AppAdapter):
            def manifest(self) -> AppManifest:
                return AppManifest(
                    capability_key="{template}-starter",
                    name="{class_name}",
                    job_to_be_done="Describe what this starter API should do.",
                    category=AppCategory.OTHER,
                    permission_class={permission_class},
                    approval_mode={approval_mode},
                    dry_run_supported=True,
                    required_connected_accounts=[],
                    price_model=PriceModel.FREE,
                    jurisdiction="US",
                    short_description="Starter template generated by siglume init.",
                    support_contact="support@example.com",
                    docs_url="https://example.com/docs",
                    example_prompts=["Describe a realistic prompt for this API."],
                    compatibility_tags=["starter"],
                )

            async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
                return ExecutionResult(
                    success=True,
                    execution_kind=ctx.execution_kind,
                    output={{
                        "summary": "Starter execution completed.",
                        "input": ctx.input_params,
                    }},
                )
        """
    ).strip() + "\n"


def _readme_template(template: str) -> str:
    return textwrap.dedent(
        f"""
        # Siglume Starter

        This project was generated with `siglume init --template {template}`.

        Files:
        - `adapter.py`: your AppAdapter implementation
        - `manifest.json`: serialized AppManifest snapshot
        - `tool_manual.json`: editable ToolManual draft for validation and registration
        - `runtime_validation.json`: local live API smoke-test contract used during registration
        - `docs/api-usage.md`: publish this page and use its public URL as `docs_url`
        - `.gitignore`: keeps runtime review keys and OAuth client secrets out of Git

        Before registering, replace all generated placeholders:
        - In `adapter.py` and `manifest.json`, replace `docs_url` with a dedicated public API usage guide, not a homepage.
        - Replace `support_contact` with a real support email address or public support URL.
        - Optional `seller_homepage_url` is the seller's official site and can stay blank.
        - In the local `runtime_validation.json`, replace the public URL and review-key placeholders.
        - If the API uses seller-side OAuth, create a local `oauth_credentials.json` next to the adapter.
        - Do not commit real review keys or OAuth client secrets; the generated `.gitignore` excludes those files.
        - Because `runtime_validation.json` is ignored, GitHub samples do not commit review-key values.

        Suggested workflow:

        Start locally without a Siglume API key:

        ```bash
        siglume test .
        siglume score . --offline
        ```

        After placeholders are replaced and `SIGLUME_API_KEY` is issued from Developer Portal -> CLI / API keys, run the server-aligned checks:

        ```bash
        siglume validate .
        siglume score . --remote
        siglume preflight .
        siglume register .
        # inspect the draft, then explicitly approve publish:
        siglume register . --confirm
        ```
        """
    ).strip() + "\n"
