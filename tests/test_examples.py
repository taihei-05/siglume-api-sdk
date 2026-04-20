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

from siglume_api_sdk import (  # noqa: E402
    AppAdapter,
    AppTestHarness,
    PermissionClass,
    score_tool_manual_offline,
    validate_tool_manual,
)


EXAMPLE_SPECS = [
    ("agent_behavior_adapter.py", PermissionClass.ACTION),
    ("calendar_sync.py", PermissionClass.ACTION),
    ("crm_sync.py", PermissionClass.ACTION),
    ("email_sender.py", PermissionClass.ACTION),
    ("news_digest.py", PermissionClass.READ_ONLY),
    ("polygon_mandate_adapter.py", PermissionClass.PAYMENT),
    ("translation_hub.py", PermissionClass.READ_ONLY),
    ("wallet_balance.py", PermissionClass.READ_ONLY),
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


async def _exercise_example(harness: AppTestHarness, app: AppAdapter, permission_class: PermissionClass) -> None:
    assert not harness.validate_manifest()

    dry_run = await harness.dry_run(task_type=app.supported_task_types()[0])
    assert dry_run.success

    if permission_class in (PermissionClass.ACTION, PermissionClass.PAYMENT):
        action = await harness.execute_action(task_type=app.supported_task_types()[0])
        assert action.success
        assert not harness.validate_receipt(action)

    if permission_class == PermissionClass.PAYMENT:
        quote = await harness.execute_quote(task_type=app.supported_task_types()[0], input_params={"amount_usd": 9.5})
        payment = await harness.execute_payment(task_type=app.supported_task_types()[-1], input_params={"amount_usd": 9.5})
        assert quote.success
        assert payment.success
        assert not harness.validate_receipt(payment)


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
    stubs = module.build_stubs() if hasattr(module, "build_stubs") else {}
    harness = AppTestHarness(app, stubs=stubs)

    manual = module.build_tool_manual()
    ok, issues = validate_tool_manual(manual)
    assert ok, f"{example_name} tool manual invalid: {issues}"
    report = score_tool_manual_offline(manual)
    assert report.grade in {"A", "B"}, f"{example_name} tool manual fell below publish bar: {report.grade}"

    asyncio.run(_exercise_example(harness, app, permission_class))


def test_generate_tool_manual_example_requires_explicit_llm_api_key(monkeypatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    module = _load_module("generate_tool_manual.py")

    with pytest.raises(SystemExit, match="Set ANTHROPIC_API_KEY or OPENAI_API_KEY"):
        module.main()


def test_buyer_langchain_example_runs_with_mock_client(capsys) -> None:
    module = _load_module("buyer_langchain.py")

    module.main()

    output = capsys.readouterr().out.strip().splitlines()
    assert output[0].startswith("tool_name: currency_converter_v2")
    assert output[-1].startswith("result_currency: JPY")


def test_webhook_handler_flask_example_runs_with_mock_payload() -> None:
    module = _load_module("webhook_handler_flask.py")

    output = module.run_mock_webhook_example()

    assert output[0] == "verified: evt_subscription_created_demo duplicate=False"
    assert output[1] == "handled_type: subscription.created"
    assert output[-1] == "duplicate_on_replay: True"


def test_refund_partial_example_runs_with_mock_client() -> None:
    module = _load_module("refund_partial.py")

    output = module.run_refund_partial_example()

    assert output[0].startswith("refund_note: Refunds are issued against the original receipt.")
    assert output[1] == "refund_status: issued replay=False"
    assert output[3] == "refunds_for_receipt: 1"
    assert output[4] == "dispute_status: contested response=contest"


def test_metering_record_example_runs_with_mock_client() -> None:
    module = _load_module("metering_record.py")

    output = module.run_metering_example()

    assert output[0].startswith("experimental_note: usage_based / per_action remain planned")
    assert output[1] == "record_status: accepted=True replayed=False external_id=evt_usage_001"
    assert output[2] == "batch_items: 2 last_period=202604"
    assert output[3] == "preview_subtotal_minor: 7615"
    assert output[4] == "usage_dimensions: tokens_in,tokens_out,calls"


def test_polygon_mandate_adapter_example_runs_with_simulated_web3_receipts() -> None:
    module = _load_module("polygon_mandate_adapter.py")

    output = module.run_polygon_mandate_example()

    assert output[0] == "tool_manual_valid: True 0"
    assert output[1].startswith("quality_grade: ")
    assert output[2] == "mandate_status: active cancel_scheduled=False"
    assert output[3] == f"charge_tx: {'0x' + 'a' * 64} user_operation={'0x' + 'b' * 64}"
    assert output[4] == "dry_run: True"
    assert output[5] == "quote: True"
    assert output[6] == "payment: True"
    assert output[7] == "receipt_issues: 0"


def test_agent_behavior_adapter_example_returns_owner_review_preview() -> None:
    module = _load_module("agent_behavior_adapter.py")

    output = asyncio.run(module.run_agent_behavior_example())

    assert output[0] == "tool_manual_valid: True 0"
    assert output[1].startswith("quality_grade: ")
    assert output[2] == "dry_run: True"
    assert output[3] == "action: True"
    assert output[4] == "proposal_preview: Would ask the owner to update charter / approval / budget for agt_owner_demo."
    assert output[5] == "receipt_issues: 0"


def test_wallet_balance_example_resolves_native_symbol_to_chain_default() -> None:
    # Codex bot P2 on PR #107: the tool manual defaults token_symbol to
    # "native" but the adapter uppercased "NATIVE" and fell through to
    # the synthetic ERC-20 branch, contradicting its own schema default.
    # Passing "native" must route to the chain's native asset (ETH on
    # ethereum, MATIC on polygon).
    module = _load_module("wallet_balance.py")
    app_cls = next(
        member
        for _, member in inspect.getmembers(module, inspect.isclass)
        if issubclass(member, AppAdapter) and member is not AppAdapter and member.__module__ == module.__name__
    )
    app = app_cls()

    async def _run() -> None:
        from siglume_api_sdk import ExecutionContext, ExecutionKind

        for chain, expected_symbol, expected_balance in (("ethereum", "ETH", 1.2345), ("polygon", "MATIC", 542.1)):
            ctx = ExecutionContext(
                agent_id="agent_test",
                owner_user_id="user_test",
                task_type=app.supported_task_types()[0],
                input_params={"chain": chain, "token_symbol": "native"},
                execution_kind=ExecutionKind.DRY_RUN,
            )
            result = await app.execute(ctx)
            assert result.success
            assert result.output["token_symbol"] == expected_symbol, (
                f"'native' on {chain} should resolve to {expected_symbol}, got {result.output['token_symbol']}"
            )
            assert result.output["balance"] == expected_balance

    asyncio.run(_run())
