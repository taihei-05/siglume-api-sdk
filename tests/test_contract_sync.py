from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import contract_sync


def test_docs_and_contracts_are_in_sync() -> None:
    issues = contract_sync.run_contract_sync(ROOT)
    assert not issues, "\n".join(str(issue) for issue in issues)
