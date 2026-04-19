"""Package wrapper that preserves the legacy flat-module public API."""
from __future__ import annotations

from importlib import util
from pathlib import Path
import sys
from types import ModuleType


_LEGACY_MODULE_NAME = "_siglume_api_sdk_legacy"
_LEGACY_MODULE_PATH = Path(__file__).resolve().parent.parent / "siglume_api_sdk.py"


def _load_legacy_module() -> ModuleType:
    existing = sys.modules.get(_LEGACY_MODULE_NAME)
    if existing is not None:
        return existing
    spec = util.spec_from_file_location(_LEGACY_MODULE_NAME, _LEGACY_MODULE_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load legacy SDK module from {_LEGACY_MODULE_PATH}")
    module = util.module_from_spec(spec)
    sys.modules[_LEGACY_MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


_legacy = _load_legacy_module()

for _name, _value in vars(_legacy).items():
    if _name.startswith("_"):
        continue
    globals()[_name] = _value

from .client import (  # noqa: E402
    AccessGrantRecord,
    AppListingRecord,
    AutoRegistrationReceipt,
    CapabilityBindingRecord,
    ConnectedAccountRecord,
    CursorPage,
    DEFAULT_SIGLUME_API_BASE,
    DeveloperPortalSummary,
    EnvelopeMeta,
    GrantBindingResult,
    RegistrationConfirmation,
    RegistrationQuality,
    SandboxSession,
    SiglumeAPIError,
    SiglumeClient,
    SiglumeClientError,
    SiglumeNotFoundError,
    SupportCaseRecord,
    UsageEventRecord,
)
from .tool_manual_grader import score_tool_manual_offline, score_tool_manual_remote  # noqa: E402

__all__ = [name for name in globals() if not name.startswith("_")]
