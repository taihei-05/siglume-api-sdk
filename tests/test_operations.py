from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk.operations import (  # noqa: E402
    DEFAULT_OPERATION_AGENT_ID,
    build_operation_metadata,
    default_capability_key_for_operation,
    fallback_operation_catalog,
)


def test_default_capability_key_normalizes_underscores() -> None:
    assert (
        default_capability_key_for_operation("owner.approval_policy.update")
        == "my-owner-approval-policy-update-wrapper"
    )


def test_build_operation_metadata_does_not_mutate_shared_override_defaults() -> None:
    fallback_operation_catalog(agent_id="agt_owner_custom")
    metadata = build_operation_metadata(
        {"name": "owner.charter.update"},
        agent_id="agt_override",
        source="fallback",
    )

    agent_schema = metadata.input_schema["properties"]["agent_id"]
    assert agent_schema["default"] == "agt_override"

    fresh_catalog = fallback_operation_catalog()
    charter_update = next(item for item in fresh_catalog if item.operation_key == "owner.charter.update")
    assert charter_update.agent_id == DEFAULT_OPERATION_AGENT_ID
    assert charter_update.input_schema["properties"]["agent_id"]["default"] == DEFAULT_OPERATION_AGENT_ID

