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

import click

from siglume_api_sdk import (
    AppAdapter,
    AppManifest,
    AppTestHarness,
    PermissionClass,
    SettlementMode,
    SiglumeClient,
    ToolManual,
    ToolManualPermissionClass,
    validate_tool_manual,
    score_tool_manual_offline,
)


SDK_ROOT = Path(__file__).resolve().parents[2]
EXAMPLES_ROOT = SDK_ROOT / "examples"

TEMPLATE_EXAMPLES = {
    "echo": "hello_echo.py",
    "price-compare": "hello_price_compare.py",
    "publisher": "x_publisher.py",
    "payment": "metamask_connector.py",
}


@dataclass
class LoadedProject:
    root_dir: Path
    adapter_path: Path
    app: AppAdapter
    manifest: AppManifest
    tool_manual_path: Path | None
    tool_manual: dict[str, Any]


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
    return LoadedProject(
        root_dir=root_dir,
        adapter_path=adapter_path,
        app=app,
        manifest=manifest,
        tool_manual_path=tool_manual_path,
        tool_manual=tool_manual,
    )


def render_json(data: Any) -> str:
    return json.dumps(to_jsonable(data), ensure_ascii=False, indent=2)


def write_init_template(template: str, destination: Path) -> list[Path]:
    destination.mkdir(parents=True, exist_ok=True)
    adapter_path = destination / "adapter.py"
    manifest_path = destination / "manifest.json"
    tool_manual_path = destination / "tool_manual.json"
    readme_path = destination / "README.md"

    for path in (adapter_path, manifest_path, tool_manual_path, readme_path):
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
    readme_path.write_text(_readme_template(template), encoding="utf-8")
    return [adapter_path, manifest_path, tool_manual_path, readme_path]


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


def run_registration(path: str | Path, *, confirm: bool, submit_review: bool) -> dict[str, Any]:
    project = load_project(path)
    api_key = resolve_api_key()
    with SiglumeClient(api_key=api_key) as client:
        receipt = client.auto_register(project.manifest, project.tool_manual)
        result: dict[str, Any] = {"receipt": to_jsonable(receipt)}
        if confirm:
            confirmation = client.confirm_registration(receipt.listing_id)
            result["confirmation"] = to_jsonable(confirmation)
            if submit_review:
                result["submit_review_skipped"] = True
        elif submit_review:
            review = client.submit_review(receipt.listing_id)
            result["review"] = to_jsonable(review)
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

        Suggested workflow:

        ```bash
        siglume validate .
        siglume test .
        siglume score . --remote
        siglume register . --confirm
        ```
        """
    ).strip() + "\n"
