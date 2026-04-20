from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk import validate_tool_manual  # noqa: E402


DOC_FILES = (
    "README.md",
    "GETTING_STARTED.md",
    "API_IDEAS.md",
)
OPENAPI_FILE = ROOT / "openapi" / "developer-surface.yaml"
FENCED_BLOCK_RE = re.compile(r"```(?P<lang>[A-Za-z0-9_-]+)?\n(?P<body>.*?)\n```", re.DOTALL)
DOC_API_PATH_RE = re.compile(r"/v1/[A-Za-z0-9._~!$&'()*+,;=:@%{}\\/-]+")
PATH_PARAMETER_RE = re.compile(r"^\{[^}]+\}$")
MARKETING_WORDS = (
    "ultimate",
    "revolutionary",
    "best-in-class",
    "world-class",
    "amazing",
    "magical",
)
VAGUE_PHRASES = (
    "use when helpful",
    "for many tasks",
    "general purpose",
    "whenever useful",
    "any request",
)


@dataclass(frozen=True)
class ContractSyncIssue:
    file: str
    line: int
    message: str

    def to_github_annotation(self) -> str:
        return f"::error file={self.file},line={self.line}::{self.message}"

    def __str__(self) -> str:
        return f"{self.file}:{self.line}: {self.message}"


@dataclass(frozen=True)
class ToolManualExampleScore:
    score: int
    grade: str
    issues: tuple[str, ...]


def _line_number(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def load_openapi_paths(root: Path = ROOT) -> set[str]:
    text = (root / "openapi" / "developer-surface.yaml").read_text(encoding="utf-8")
    paths: set[str] = set()
    in_paths = False
    for line in text.splitlines():
        if line == "paths:":
            in_paths = True
            continue
        if in_paths and line and not line.startswith(" "):
            break
        match = re.match(r"^  (/[^:]+):\s*$", line)
        if match:
            paths.add(f"/v1{match.group(1)}")
    return paths


def extract_api_paths(markdown_text: str) -> list[tuple[str, int]]:
    paths: list[tuple[str, int]] = []
    for match in DOC_API_PATH_RE.finditer(markdown_text):
        raw_path = match.group(0).rstrip("`\"').,\\")
        normalized = raw_path.split("?", 1)[0]
        paths.append((normalized, _line_number(markdown_text, match.start())))
    return paths


def _is_placeholder_segment(segment: str) -> bool:
    return bool(PATH_PARAMETER_RE.fullmatch(segment) or re.fullmatch(r"[A-Z][A-Z0-9_]*", segment))


def _path_matches_openapi(doc_path: str, openapi_path: str) -> bool:
    doc_segments = [segment for segment in doc_path.split("/") if segment]
    spec_segments = [segment for segment in openapi_path.split("/") if segment]
    if len(doc_segments) != len(spec_segments):
        return False
    for doc_segment, spec_segment in zip(doc_segments, spec_segments):
        if doc_segment == spec_segment:
            continue
        if _is_placeholder_segment(doc_segment) and PATH_PARAMETER_RE.fullmatch(spec_segment):
            continue
        return False
    return True


def _iter_tool_manual_candidates(node: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        if isinstance(node.get("tool_manual"), dict):
            found.append(node["tool_manual"])
        if {
            "tool_name",
            "permission_class",
            "input_schema",
            "output_schema",
        }.issubset(node):
            found.append(node)
        for value in node.values():
            found.extend(_iter_tool_manual_candidates(value))
    elif isinstance(node, list):
        for value in node:
            found.extend(_iter_tool_manual_candidates(value))
    return found


def extract_tool_manual_examples(markdown_text: str) -> list[tuple[dict[str, Any], int]]:
    examples: list[tuple[dict[str, Any], int]] = []
    for match in FENCED_BLOCK_RE.finditer(markdown_text):
        lang = (match.group("lang") or "").strip().lower()
        if lang != "json":
            continue
        body = match.group("body").strip()
        if '"tool_name"' not in body and '"tool_manual"' not in body:
            continue
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            line = _line_number(markdown_text, match.start()) + exc.lineno - 1
            raise ValueError(f"invalid JSON example at line {line}: {exc.msg}") from exc
        for manual in _iter_tool_manual_candidates(payload):
            examples.append((manual, _line_number(markdown_text, match.start())))
    return examples


def score_tool_manual_example(manual: dict[str, Any]) -> ToolManualExampleScore:
    score = 100
    issues: list[str] = []

    def penalize(points: int, message: str) -> None:
        nonlocal score
        score -= points
        issues.append(message)

    summary = str(manual.get("summary_for_model", "")).lower()
    if any(word in summary for word in MARKETING_WORDS):
        penalize(15, "summary_for_model uses marketing language")

    trigger_conditions = manual.get("trigger_conditions") or []
    for index, condition in enumerate(trigger_conditions):
        lowered = str(condition).lower()
        if any(phrase in lowered for phrase in VAGUE_PHRASES):
            penalize(10, f"trigger_conditions[{index}] is too vague")
        if len(re.findall(r"[A-Za-z0-9_]+", lowered)) < 7:
            penalize(5, f"trigger_conditions[{index}] should be more specific")

    do_not_use_when = manual.get("do_not_use_when") or []
    for index, condition in enumerate(do_not_use_when):
        lowered = str(condition).lower()
        if any(phrase in lowered for phrase in VAGUE_PHRASES):
            penalize(8, f"do_not_use_when[{index}] is too vague")
        if len(re.findall(r"[A-Za-z0-9_]+", lowered)) < 6:
            penalize(4, f"do_not_use_when[{index}] should be more specific")

    input_schema = manual.get("input_schema") if isinstance(manual.get("input_schema"), dict) else {}
    properties = input_schema.get("properties") if isinstance(input_schema.get("properties"), dict) else {}
    required = input_schema.get("required") if isinstance(input_schema.get("required"), list) else []
    for name in required:
        if not isinstance(properties.get(name), dict) or not str(properties[name].get("description", "")).strip():
            penalize(6, f"input_schema.properties.{name} should include a description")

    output_schema = manual.get("output_schema") if isinstance(manual.get("output_schema"), dict) else {}
    output_properties = output_schema.get("properties") if isinstance(output_schema.get("properties"), dict) else {}
    summary_property = output_properties.get("summary") if isinstance(output_properties.get("summary"), dict) else {}
    if not str(summary_property.get("description", "")).strip():
        penalize(5, "output_schema.properties.summary should include a description")

    for field_name in ("usage_hints", "result_hints", "error_hints"):
        hints = manual.get(field_name)
        if not isinstance(hints, list) or not hints:
            penalize(10, f"{field_name} should be non-empty")

    score = max(score, 0)
    if score >= 90:
        grade = "A"
    elif score >= 70:
        grade = "B"
    elif score >= 50:
        grade = "C"
    elif score >= 30:
        grade = "D"
    else:
        grade = "F"
    return ToolManualExampleScore(score=score, grade=grade, issues=tuple(issues))


def check_doc_file(doc_path: Path, valid_paths: set[str]) -> list[ContractSyncIssue]:
    issues: list[ContractSyncIssue] = []
    text = doc_path.read_text(encoding="utf-8")

    for path, line in extract_api_paths(text):
        if not any(_path_matches_openapi(path, valid_path) for valid_path in valid_paths):
            issues.append(
                ContractSyncIssue(
                    file=doc_path.name,
                    line=line,
                    message=f"endpoint path is not present in openapi/developer-surface.yaml: {path}",
                )
            )

    try:
        examples = extract_tool_manual_examples(text)
    except ValueError as exc:
        issues.append(ContractSyncIssue(file=doc_path.name, line=1, message=str(exc)))
        return issues

    if doc_path.name == "GETTING_STARTED.md" and not examples:
        issues.append(
            ContractSyncIssue(
                file=doc_path.name,
                line=1,
                message="expected at least one ToolManual JSON example in GETTING_STARTED.md",
            )
        )

    for manual, line in examples:
        ok, validation_issues = validate_tool_manual(manual)
        if not ok:
            messages = ", ".join(
                f"{issue.field or '<root>'}: {issue.message}" for issue in validation_issues
            )
            issues.append(
                ContractSyncIssue(
                    file=doc_path.name,
                    line=line,
                    message=f"ToolManual example failed validate_tool_manual(): {messages}",
                )
            )
            continue

        quality = score_tool_manual_example(manual)
        if quality.grade not in {"A", "B"}:
            issues.append(
                ContractSyncIssue(
                    file=doc_path.name,
                    line=line,
                    message=(
                        "ToolManual example fell below the publish bar "
                        f"(grade {quality.grade}, score {quality.score}): {'; '.join(quality.issues)}"
                    ),
                )
            )

    return issues


def run_contract_sync(root: Path = ROOT) -> list[ContractSyncIssue]:
    valid_paths = load_openapi_paths(root)
    issues: list[ContractSyncIssue] = []
    for relative in DOC_FILES:
        issues.extend(check_doc_file(root / relative, valid_paths))
    return issues


def main() -> int:
    issues = run_contract_sync(ROOT)
    if issues:
        for issue in issues:
            print(issue.to_github_annotation())
            print(str(issue))
        print(f"contract-sync failed with {len(issues)} issue(s).")
        return 1
    print("contract-sync passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
