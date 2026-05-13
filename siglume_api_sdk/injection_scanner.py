from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal


RiskLevel = Literal["clean", "suspicious", "high_risk"]


@dataclass(frozen=True)
class ScanResult:
    risk_level: RiskLevel
    matched_patterns: list[str]
    llm_verdict: None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_HIGH_RISK_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("ignore previous", re.compile(r"\bignore\s+(?:all\s+)?previous\b", re.IGNORECASE)),
    ("ignore above", re.compile(r"\bignore\s+(?:the\s+)?above\b", re.IGNORECASE)),
    ("disregard prior", re.compile(r"\bdisregard\s+(?:all\s+)?prior\b", re.IGNORECASE)),
    (
        "system role marker",
        re.compile(
            r"(?im)(?:^|\n)\s*system\s*:\s*"
            r"(?:ignore|you are|developer|assistant|user|system|disregard|follow|do not)\b"
        ),
    ),
    ("[INST] marker", re.compile(r"\[INST\]", re.IGNORECASE)),
    ("im_start marker", re.compile(r"<\|im_start\|>", re.IGNORECASE)),
    ("you are now", re.compile(r"\byou\s+are\s+now\b", re.IGNORECASE)),
    ("上記指示を無視", re.compile(r"上記指示を無視")),
    ("前の指示を", re.compile(r"前の指示を")),
]

_SUSPICIOUS_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("as an AI", re.compile(r"\bas\s+an\s+AI\b", re.IGNORECASE)),
    ("base64-like block", re.compile(r"(?<![A-Za-z0-9+/=])[A-Za-z0-9+/=]{200,}(?![A-Za-z0-9+/=])")),
    ("zero-width or rtl control", re.compile(r"[\u200b\u200c\u200d\u200e\u200f\u202a-\u202e\u2066-\u2069]")),
    ("hidden trailing url", re.compile(r"<https?://[^\s>]+>?\s*$", re.IGNORECASE)),
]

_RISK_ORDER = {"clean": 0, "suspicious": 1, "high_risk": 2}


def scan_text(text: str) -> ScanResult:
    raw = str(text or "")
    if not raw.strip():
        return ScanResult("clean", [])
    matched: list[str] = []
    risk: RiskLevel = "clean"
    for name, pattern in _HIGH_RISK_PATTERNS:
        if pattern.search(raw):
            matched.append(name)
            risk = "high_risk"
    for name, pattern in _SUSPICIOUS_PATTERNS:
        if pattern.search(raw):
            matched.append(name)
            if risk == "clean":
                risk = "suspicious"
    return ScanResult(risk, matched)


def scan_manifest_payload(payload: dict[str, Any], tool_manual: dict[str, Any] | None = None) -> ScanResult:
    matches: list[str] = []
    highest = "clean"
    for label, value in _manifest_scan_texts(payload, tool_manual or {}):
        result = scan_text(value)
        if _RISK_ORDER[result.risk_level] > _RISK_ORDER[highest]:
            highest = result.risk_level
        for pattern in result.matched_patterns:
            entry = f"{label}: {pattern}"
            if entry not in matches:
                matches.append(entry)
    return ScanResult(highest, matches)  # type: ignore[arg-type]


def load_manifest_file(path: str | Path) -> dict[str, Any]:
    manifest_path = Path(path)
    raw = manifest_path.read_text(encoding="utf-8")
    if manifest_path.suffix.lower() in {".yaml", ".yml"}:
        try:
            import yaml
        except ModuleNotFoundError as exc:
            raise RuntimeError("PyYAML is required to read manifest.yaml") from exc
        payload = yaml.safe_load(raw)
    else:
        payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("manifest must be an object")
    return payload


def _manifest_scan_texts(
    manifest: dict[str, Any],
    tool_manual: dict[str, Any],
) -> list[tuple[str, str]]:
    texts: list[tuple[str, str]] = []
    for key in ("name", "display_name", "short_description", "description", "job_to_be_done"):
        value = manifest.get(key)
        if isinstance(value, str) and value.strip():
            texts.append((f"manifest.{key}", value))
    i18n = manifest.get("i18n")
    if isinstance(i18n, dict):
        for key, value in i18n.items():
            if "description" in str(key) and isinstance(value, str) and value.strip():
                texts.append((f"manifest.i18n.{key}", value))
    texts.extend((f"tool_manual.{label}", value) for label, value in _tool_manual_description_texts(tool_manual))
    return texts


def _tool_manual_description_texts(value: Any, path: str = "") -> list[tuple[str, str]]:
    texts: list[tuple[str, str]] = []
    if isinstance(value, dict):
        for key, item in value.items():
            item_path = f"{path}.{key}" if path else str(key)
            if key in {
                "description",
                "summary_for_model",
                "job_to_be_done",
                "approval_summary_template",
                "side_effect_summary",
            } and isinstance(item, str):
                texts.append((item_path, item))
            elif isinstance(item, (dict, list)):
                texts.extend(_tool_manual_description_texts(item, item_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            texts.extend(_tool_manual_description_texts(item, f"{path}[{index}]"))
    return texts
