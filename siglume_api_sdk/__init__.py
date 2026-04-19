"""Package wrapper that preserves the legacy flat-module public API."""
from __future__ import annotations

from importlib import util
from pathlib import Path
import sys
from types import ModuleType


_LEGACY_MODULE_NAME = "_siglume_api_sdk_legacy"
_LEGACY_MODULE_PATH = Path(__file__).resolve().parent.parent / "siglume_api_sdk.py"
_LEGACY_PUBLIC_EXPORTS = [
    "AppAdapter",
    "AppCategory",
    "AppManifest",
    "AppTestHarness",
    "ApprovalMode",
    "ApprovalRequestHint",
    "ConnectedAccountRef",
    "Environment",
    "ExecutionArtifact",
    "ExecutionContext",
    "ExecutionKind",
    "ExecutionResult",
    "HealthCheckResult",
    "PermissionClass",
    "PriceModel",
    "ReceiptRef",
    "SettlementMode",
    "SideEffectRecord",
    "StubProvider",
    "ToolManual",
    "ToolManualIssue",
    "ToolManualPermissionClass",
    "ToolManualQualityReport",
    "validate_tool_manual",
]


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

for _name in _LEGACY_PUBLIC_EXPORTS:
    globals()[_name] = getattr(_legacy, _name)

from .client import (  # noqa: E402, F401
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
from .diff import (  # noqa: E402, F401
    BreakingChange,
    Change,
    ChangeLevel,
    diff_manifest,
    diff_tool_manual,
)
from .exporters import (  # noqa: E402, F401
    ToolSchemaExport,
    to_anthropic_tool,
    to_mcp_tool,
    to_openai_function,
    to_openai_responses_tool,
)
from .testing import Recorder, RecordMode  # noqa: E402, F401
from .tool_manual_assist import (  # noqa: E402, F401
    AnthropicProvider,
    LLMProvider,
    OpenAIProvider,
    SiglumeAssistError,
    ToolManualAssistAttempt,
    ToolManualAssistMetadata,
    ToolManualAssistResult,
    draft_tool_manual,
    fill_tool_manual_gaps,
    load_tool_manual_draft_prompt,
)
from .tool_manual_grader import score_tool_manual_offline, score_tool_manual_remote  # noqa: E402, F401

__all__ = sorted(
    set(
        _LEGACY_PUBLIC_EXPORTS
        + [
            "AccessGrantRecord",
            "AppListingRecord",
            "AutoRegistrationReceipt",
            "CapabilityBindingRecord",
            "Change",
            "ChangeLevel",
            "ConnectedAccountRecord",
            "CursorPage",
            "DEFAULT_SIGLUME_API_BASE",
            "DeveloperPortalSummary",
            "EnvelopeMeta",
            "GrantBindingResult",
            "BreakingChange",
            "RegistrationConfirmation",
            "RegistrationQuality",
            "SandboxSession",
            "SiglumeAPIError",
            "SiglumeAssistError",
            "SiglumeClient",
            "SiglumeClientError",
            "SiglumeNotFoundError",
            "SupportCaseRecord",
            "ToolSchemaExport",
            "UsageEventRecord",
            "AnthropicProvider",
            "LLMProvider",
            "OpenAIProvider",
            "RecordMode",
            "Recorder",
            "diff_manifest",
            "diff_tool_manual",
            "to_anthropic_tool",
            "to_mcp_tool",
            "to_openai_function",
            "to_openai_responses_tool",
            "ToolManualAssistAttempt",
            "ToolManualAssistMetadata",
            "ToolManualAssistResult",
            "draft_tool_manual",
            "fill_tool_manual_gaps",
            "load_tool_manual_draft_prompt",
            "score_tool_manual_offline",
            "score_tool_manual_remote",
        ]
    )
)
