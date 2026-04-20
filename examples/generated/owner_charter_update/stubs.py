"""Generated stubs for `owner.charter.update`."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

try:
    from siglume_api_sdk import StubProvider
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
    from siglume_api_sdk import StubProvider

OPERATION_KEY = "owner.charter.update"


class GeneratedOperationStub(StubProvider):
    def __init__(self, operation_key: str = OPERATION_KEY) -> None:
        super().__init__("siglume_owner_operation")
        self.operation_key = operation_key

    async def handle(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        agent_id = str(params.get("agent_id") or "agt_owner_demo")
        payload = dict(params.get("params") or {})
        return {
            "message": f"Stubbed {self.operation_key} for {agent_id}.",
            "action": self.operation_key.replace(".", "_"),
            "result": {
                "operation_key": self.operation_key,
                "agent_id": agent_id,
                "stubbed": True,
                "params": payload,
            },
        }


def build_stubs() -> dict[str, StubProvider]:
    return {"siglume_owner_operation": GeneratedOperationStub()}
