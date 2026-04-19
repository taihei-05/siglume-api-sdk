from __future__ import annotations

import asyncio
import importlib.util
import inspect
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk import AppAdapter, AppTestHarness, PermissionClass, validate_tool_manual  # noqa: E402


EXAMPLE_SPECS = [
    ("calendar_sync.py", PermissionClass.ACTION),
    ("email_sender.py", PermissionClass.ACTION),
    ("translation_hub.py", PermissionClass.READ_ONLY),
    ("payment_quote.py", PermissionClass.PAYMENT),
]


def _load_module(example_name: str):
    path = ROOT / "examples" / example_name
    spec = importlib.util.spec_from_file_location(f"example_{path.stem}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load example module {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _exercise_example(app: AppAdapter, permission_class: PermissionClass) -> None:
    harness = AppTestHarness(app)
    assert not harness.validate_manifest()

    dry_run = await harness.dry_run(task_type=app.supported_task_types()[0])
    assert dry_run.success

    if permission_class in (PermissionClass.ACTION, PermissionClass.PAYMENT):
        action = await harness.execute_action(task_type=app.supported_task_types()[0])
        assert action.success

    if permission_class == PermissionClass.PAYMENT:
        quote = await harness.execute_quote(task_type=app.supported_task_types()[0], input_params={"amount_usd": 9.5})
        payment = await harness.execute_payment(task_type=app.supported_task_types()[-1], input_params={"amount_usd": 9.5})
        assert quote.success
        assert payment.success


@pytest.mark.parametrize(("example_name", "permission_class"), EXAMPLE_SPECS)
def test_examples_validate_and_run(example_name: str, permission_class: PermissionClass) -> None:
    module = _load_module(example_name)
    subclasses = [
        member
        for _, member in inspect.getmembers(module, inspect.isclass)
        if issubclass(member, AppAdapter) and member is not AppAdapter and member.__module__ == module.__name__
    ]
    assert len(subclasses) == 1
    app = subclasses[0]()

    manual = module.build_tool_manual()
    ok, issues = validate_tool_manual(manual)
    assert ok, f"{example_name} tool manual invalid: {issues}"

    asyncio.run(_exercise_example(app, permission_class))
