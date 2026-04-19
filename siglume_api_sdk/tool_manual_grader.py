from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Mapping

from .client import SiglumeClient


AMBIGUOUS_PHRASES = [
    "use when helpful",
    "use for productivity",
    "use this tool",
    "for many tasks",
    "general purpose",
    "various uses",
    "when needed",
    "as needed",
    "if appropriate",
    "for convenience",
    "to help",
    "to assist",
    "\u4fbf\u5229\u306a\u6642",
    "\u5fc5\u8981\u306b\u5fdc\u3058\u3066",
    "\u9069\u5b9c",
    "\u3044\u308d\u3044\u308d\u306a\u5834\u9762\u3067",
    "\u5f79\u306b\u7acb\u3064\u6642",
    "\u56f0\u3063\u305f\u6642",
]

MARKETING_FLUFF = [
    "ultimate",
    "revolutionary",
    "cutting-edge",
    "best-in-class",
    "world-class",
    "game-changing",
    "next-generation",
    "powerful",
    "amazing",
    "incredible",
    "awesome",
    "unbeatable",
    "\u6700\u9ad8\u306e",
    "\u9769\u547d\u7684\u306a",
    "\u753b\u671f\u7684\u306a",
    "\u7a76\u6975\u306e",
    "\u6700\u5f37\u306e",
]

STOP_WORDS = frozenset({
    "a",
    "about",
    "above",
    "after",
    "again",
    "all",
    "also",
    "an",
    "and",
    "any",
    "are",
    "aren",
    "at",
    "be",
    "been",
    "before",
    "being",
    "below",
    "between",
    "both",
    "but",
    "by",
    "can",
    "could",
    "did",
    "didn",
    "do",
    "does",
    "doesn",
    "don",
    "during",
    "each",
    "every",
    "few",
    "for",
    "from",
    "further",
    "had",
    "hadn",
    "has",
    "hasn",
    "have",
    "haven",
    "he",
    "here",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "isn",
    "it",
    "just",
    "may",
    "me",
    "might",
    "more",
    "most",
    "must",
    "my",
    "no",
    "nor",
    "not",
    "of",
    "off",
    "on",
    "once",
    "only",
    "or",
    "other",
    "our",
    "out",
    "over",
    "own",
    "s",
    "same",
    "shall",
    "she",
    "should",
    "shouldn",
    "so",
    "some",
    "such",
    "t",
    "than",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "to",
    "too",
    "under",
    "up",
    "very",
    "was",
    "wasn",
    "we",
    "were",
    "weren",
    "when",
    "where",
    "why",
    "will",
    "with",
    "won",
    "would",
    "wouldn",
    "you",
    "your",
})

IMPERATIVE_PREFIXES = [
    "use this",
    "use the",
    "call this",
    "call the",
    "invoke this",
    "run this",
    "execute this",
]

WORD_RE = re.compile(r"[A-Za-z\u3040-\u9fff]{2,}")
KEYWORD_COVERAGE_BANDS = [
    (20, 10),
    (15, 8),
    (10, 6),
    (5, 4),
]
GRADE_THRESHOLDS = [
    ("A", 90),
    ("B", 70),
    ("C", 50),
    ("D", 30),
]


def _override_rules_from_json() -> None:
    global AMBIGUOUS_PHRASES, MARKETING_FLUFF, STOP_WORDS, IMPERATIVE_PREFIXES
    global KEYWORD_COVERAGE_BANDS, GRADE_THRESHOLDS

    rules_path = Path(__file__).resolve().parents[1] / "schemas" / "tool-manual-grader-rules.json"
    if not rules_path.exists():
        return

    rules = json.loads(rules_path.read_text(encoding="utf-8"))

    ambiguity_phrases = rules.get("ambiguity_phrases")
    if isinstance(ambiguity_phrases, list):
        AMBIGUOUS_PHRASES = [str(item) for item in ambiguity_phrases]

    marketing_fluff = rules.get("marketing_fluff")
    if isinstance(marketing_fluff, list):
        MARKETING_FLUFF = [str(item) for item in marketing_fluff]

    imperative_prefixes = rules.get("imperative_prefixes")
    if isinstance(imperative_prefixes, list):
        IMPERATIVE_PREFIXES = [str(item) for item in imperative_prefixes]

    stop_words = rules.get("stop_words")
    if isinstance(stop_words, list):
        STOP_WORDS = frozenset(str(item) for item in stop_words)

    keyword_bands = rules.get("keyword_coverage_bands")
    if isinstance(keyword_bands, list):
        parsed_bands: list[tuple[int, int]] = []
        for band in keyword_bands:
            if not isinstance(band, Mapping):
                continue
            minimum = band.get("minimum_keywords")
            score = band.get("score")
            if isinstance(minimum, int) and isinstance(score, int):
                parsed_bands.append((minimum, score))
        if parsed_bands:
            KEYWORD_COVERAGE_BANDS = sorted(parsed_bands, reverse=True)

    grade_thresholds = rules.get("grade_thresholds")
    if isinstance(grade_thresholds, Mapping):
        parsed_thresholds: list[tuple[str, int]] = []
        for grade in ("A", "B", "C", "D"):
            minimum = grade_thresholds.get(grade)
            if isinstance(minimum, int):
                parsed_thresholds.append((grade, minimum))
        if parsed_thresholds:
            GRADE_THRESHOLDS = parsed_thresholds


_override_rules_from_json()


def score_tool_manual_remote(
    tool_manual: Mapping[str, Any],
    *,
    api_key: str,
    base_url: str | None = None,
) -> Any:
    """Fetch the authoritative ToolManual quality report from the platform."""
    with SiglumeClient(api_key=api_key, base_url=base_url) as client:
        return client.preview_quality_score(tool_manual)


def score_tool_manual_offline(tool_manual: Any) -> Any:
    """Score a ToolManual locally using the current server-parity heuristic."""
    ToolManualIssue, ToolManualQualityReport, validate_tool_manual = _load_sdk_runtime()

    manual = _coerce_tool_manual(tool_manual)
    validation_ok, validation_issues = validate_tool_manual(manual)
    quality = _score_manual_quality(manual, ToolManualIssue)

    validation_errors = [issue for issue in validation_issues if getattr(issue, "severity", "error") == "error"]
    validation_warnings = [issue for issue in validation_issues if getattr(issue, "severity", "error") != "error"]
    has_critical_quality_issue = any(
        getattr(issue, "severity", "warning") == "critical"
        for issue in quality["issues"]
    )
    # v0.4 hardens the local gate ahead of the current platform scorer so
    # malformed hint payloads cannot still look publishable in offline checks.
    publishable = bool(validation_ok) and quality["grade"] in {"A", "B"} and not has_critical_quality_issue

    return ToolManualQualityReport(
        overall_score=quality["overall_score"],
        grade=quality["grade"],
        issues=[*validation_issues, *quality["issues"]],
        keyword_coverage_estimate=quality["keyword_coverage_estimate"],
        improvement_suggestions=quality["improvement_suggestions"],
        publishable=publishable,
        validation_ok=bool(validation_ok),
        validation_errors=validation_errors,
        validation_warnings=validation_warnings,
    )


def _load_sdk_runtime() -> tuple[Any, Any, Any]:
    from siglume_api_sdk import ToolManualIssue, ToolManualQualityReport, validate_tool_manual

    return ToolManualIssue, ToolManualQualityReport, validate_tool_manual


def _coerce_tool_manual(tool_manual: Any) -> Any:
    to_dict = getattr(tool_manual, "to_dict", None)
    if callable(to_dict):
        coerced = to_dict()
        if isinstance(coerced, Mapping):
            return dict(coerced)
        return coerced
    if isinstance(tool_manual, Mapping):
        return dict(tool_manual)
    return tool_manual


def _issue(
    issue_cls: Any,
    category: str,
    severity: str,
    message: str,
    *,
    field: str | None = None,
    suggestion: str | None = None,
) -> Any:
    return issue_cls(
        code=category,
        message=message,
        field=field,
        severity=severity,
        suggestion=suggestion,
    )


def _score_manual_quality(manual: Any, issue_cls: Any) -> dict[str, Any]:
    if not isinstance(manual, dict):
        return {
            "overall_score": 0,
            "grade": "F",
            "issues": [_issue(issue_cls, "ambiguity", "critical", "Manual is not a dict")],
            "keyword_coverage_estimate": 0,
            "improvement_suggestions": ["Provide a valid manual dict"],
        }

    issues: list[Any] = []

    trigger_score = _score_trigger_conditions(manual, issues, issue_cls)
    do_not_use_score = _score_do_not_use_when(manual, issues, issue_cls)
    summary_score = _score_summary_for_model(manual, issues, issue_cls)
    input_schema_score = _score_input_schema_descriptions(manual, issues, issue_cls)
    output_schema_score = _score_output_schema_completeness(manual, issues, issue_cls)
    hints_score = _score_hints(manual, issues, issue_cls)
    keyword_count = _estimate_keyword_coverage(manual)
    keyword_score = _score_keyword_coverage(keyword_count)

    overall = max(
        0,
        min(
            100,
            trigger_score
            + do_not_use_score
            + summary_score
            + input_schema_score
            + output_schema_score
            + hints_score
            + keyword_score,
        ),
    )

    return {
        "overall_score": overall,
        "grade": _overall_to_grade(overall),
        "issues": issues,
        "keyword_coverage_estimate": keyword_count,
        "improvement_suggestions": _build_improvement_suggestions(
            trigger_score=trigger_score,
            do_not_use_score=do_not_use_score,
            summary_score=summary_score,
            input_schema_score=input_schema_score,
            output_schema_score=output_schema_score,
            hints_score=hints_score,
            keyword_count=keyword_count,
        ),
    }


def _score_trigger_conditions(manual: dict[str, Any], issues: list[Any], issue_cls: Any) -> int:
    conditions = manual.get("trigger_conditions")
    if not isinstance(conditions, list) or len(conditions) == 0:
        issues.append(
            _issue(
                issue_cls,
                "trigger_specificity",
                "critical",
                "No trigger_conditions provided",
                field="trigger_conditions",
            )
        )
        return 0

    score = 30
    for index, condition in enumerate(conditions):
        if not isinstance(condition, str):
            issues.append(
                _issue(
                    issue_cls,
                    "trigger_specificity",
                    "warning",
                    "Trigger condition must be a string to be matchable by agents",
                    field=f"trigger_conditions[{index}]",
                    suggestion="Replace non-string trigger conditions with concrete text descriptions",
                )
            )
            score -= 5
            continue
        field_ref = f"trigger_conditions[{index}]"
        if len(condition) < 15:
            issues.append(
                _issue(
                    issue_cls,
                    "trigger_specificity",
                    "warning",
                    f"Trigger condition is too short ({len(condition)} chars) - be more specific",
                    field=field_ref,
                    suggestion="Describe a concrete situation, e.g. 'When the owner asks for a weather forecast for a specific city'",
                )
            )
            score -= 5

        lowered = condition.lower()
        for phrase in AMBIGUOUS_PHRASES:
            if phrase.lower() in lowered:
                issues.append(
                    _issue(
                        issue_cls,
                        "ambiguity",
                        "warning",
                        f"Contains vague phrase '{phrase}' - agents cannot reliably match on this",
                        field=field_ref,
                        suggestion="Replace with a concrete situation description",
                    )
                )
                score -= 5
                break

        for fluff in MARKETING_FLUFF:
            if fluff.lower() in lowered:
                issues.append(
                    _issue(
                        issue_cls,
                        "description_quality",
                        "warning",
                        f"Marketing language '{fluff}' in trigger condition reduces selection accuracy",
                        field=field_ref,
                        suggestion="Use factual, situation-based language instead",
                    )
                )
                score -= 3
                break

        for prefix in IMPERATIVE_PREFIXES:
            if lowered.startswith(prefix):
                issues.append(
                    _issue(
                        issue_cls,
                        "trigger_specificity",
                        "suggestion",
                        "Trigger reads as an imperative command rather than a situation description",
                        field=field_ref,
                        suggestion="Rewrite as a situation: 'When the user needs...' or 'The agent encounters...'",
                    )
                )
                score -= 2
                break

    if len(conditions) < 3:
        issues.append(
            _issue(
                issue_cls,
                "trigger_specificity",
                "suggestion",
                f"Only {len(conditions)} trigger condition(s) - 3+ increases selection chances",
                field="trigger_conditions",
            )
        )
        score -= 5

    return max(0, score)


def _score_do_not_use_when(manual: dict[str, Any], issues: list[Any], issue_cls: Any) -> int:
    items = manual.get("do_not_use_when")
    if not isinstance(items, list) or len(items) == 0:
        issues.append(
            _issue(
                issue_cls,
                "description_quality",
                "warning",
                "No do_not_use_when items - agents need negative conditions to avoid false positives",
                field="do_not_use_when",
            )
        )
        return 0

    score = 10
    trigger_texts = [
        item.lower()
        for item in manual.get("trigger_conditions", [])
        if isinstance(item, str)
    ]

    for index, item in enumerate(items):
        if not isinstance(item, str):
            issues.append(
                _issue(
                    issue_cls,
                    "description_quality",
                    "warning",
                    "do_not_use_when entries must be strings to describe negative cases clearly",
                    field=f"do_not_use_when[{index}]",
                )
            )
            score -= 3
            continue
        field_ref = f"do_not_use_when[{index}]"
        lowered = item.lower()
        item_words = set(_extract_words(lowered))
        for trigger_text in trigger_texts:
            trigger_words = set(_extract_words(trigger_text))
            if item_words and trigger_words:
                overlap = len(item_words & trigger_words) / max(len(item_words), 1)
                if overlap > 0.6:
                    issues.append(
                        _issue(
                            issue_cls,
                            "ambiguity",
                            "suggestion",
                            "This do_not_use_when item closely mirrors a trigger_condition - add a genuinely different negative case",
                            field=field_ref,
                        )
                    )
                    score -= 3
                    break

        if len(item) < 10:
            issues.append(
                _issue(
                    issue_cls,
                    "description_quality",
                    "suggestion",
                    "do_not_use_when item is very short - describe a concrete negative condition",
                    field=field_ref,
                )
            )
            score -= 2

    return max(0, score)


def _score_summary_for_model(manual: dict[str, Any], issues: list[Any], issue_cls: Any) -> int:
    summary = manual.get("summary_for_model")
    if summary is None:
        issues.append(
            _issue(
                issue_cls,
                "description_quality",
                "warning",
                "summary_for_model is missing",
                field="summary_for_model",
            )
        )
        return 0
    if not isinstance(summary, str):
        issues.append(
            _issue(
                issue_cls,
                "description_quality",
                "warning",
                "summary_for_model must be a string",
                field="summary_for_model",
            )
        )
        return 0
    if len(summary) == 0:
        issues.append(
            _issue(
                issue_cls,
                "description_quality",
                "warning",
                "summary_for_model is empty",
                field="summary_for_model",
            )
        )
        return 0

    score = 10
    lowered = summary.lower()
    fluff_found = False
    for fluff in MARKETING_FLUFF:
        if fluff.lower() in lowered:
            issues.append(
                _issue(
                    issue_cls,
                    "description_quality",
                    "warning",
                    f"Marketing language '{fluff}' in summary_for_model - agents ignore hype, use factual descriptions",
                    field="summary_for_model",
                    suggestion="Describe what the tool actually does in plain terms",
                )
            )
            if not fluff_found:
                score -= 3
                fluff_found = True

    if len(summary) < 20:
        issues.append(
            _issue(
                issue_cls,
                "description_quality",
                "suggestion",
                "summary_for_model is very brief - a longer factual description helps agent selection",
                field="summary_for_model",
            )
        )
        score -= 3

    return max(0, score)


def _score_input_schema_descriptions(manual: dict[str, Any], issues: list[Any], issue_cls: Any) -> int:
    schema = manual.get("input_schema")
    if not isinstance(schema, dict):
        issues.append(
            _issue(
                issue_cls,
                "schema_completeness",
                "warning",
                "input_schema must be a JSON Schema object",
                field="input_schema",
            )
        )
        return 0

    schema_issues = _check_schema_descriptions(schema, issue_cls)
    issues.extend(schema_issues)
    if not schema_issues:
        return 20

    score = 20
    for issue in schema_issues:
        if getattr(issue, "severity", "") == "warning":
            score -= 5
        elif getattr(issue, "severity", "") == "suggestion":
            score -= 2

    return max(0, score)


def _score_output_schema_completeness(manual: dict[str, Any], issues: list[Any], issue_cls: Any) -> int:
    schema = manual.get("output_schema")
    if not isinstance(schema, dict):
        issues.append(
            _issue(
                issue_cls,
                "schema_completeness",
                "warning",
                "output_schema must be a JSON Schema object",
                field="output_schema",
            )
        )
        return 0

    props = schema.get("properties", {})
    if not isinstance(props, dict):
        issues.append(
            _issue(
                issue_cls,
                "schema_completeness",
                "warning",
                "output_schema.properties must be an object mapping field names to schema definitions",
                field="output_schema.properties",
            )
        )
        return 0
    if len(props) == 0:
        issues.append(
            _issue(
                issue_cls,
                "schema_completeness",
                "warning",
                "output_schema has no properties defined",
                field="output_schema",
            )
        )
        return 0

    undescribed = 0
    for property_definition in props.values():
        if isinstance(property_definition, dict) and not property_definition.get("description"):
            undescribed += 1

    score = 10
    if undescribed > 0:
        issues.append(
            _issue(
                issue_cls,
                "schema_completeness",
                "suggestion",
                f"{undescribed} output field(s) lack descriptions",
                field="output_schema",
                suggestion="Add description to each output property so agents know what to expect",
            )
        )
        score -= min(undescribed * 2, 6)

    return max(0, score)


def _score_hints(manual: dict[str, Any], issues: list[Any], issue_cls: Any) -> int:
    score = 10
    for field_name in ("usage_hints", "result_hints", "error_hints"):
        hints = manual.get(field_name)
        if not isinstance(hints, list):
            issues.append(
                _issue(
                    issue_cls,
                    "description_quality",
                    "warning",
                    f"{field_name} must be a list of hint strings",
                    field=field_name,
                )
            )
            score -= 5
            continue
        if len(hints) == 0:
            issues.append(
                _issue(
                    issue_cls,
                    "description_quality",
                    "suggestion",
                    f"{field_name} is empty - hints help agents use the tool correctly",
                    field=field_name,
                )
            )
            score -= 3
            continue

        short_count = 0
        for index, item in enumerate(hints):
            if not isinstance(item, str):
                issues.append(
                    _issue(
                        issue_cls,
                        "description_quality",
                        "critical",
                        f"{field_name} items must be strings",
                        field=f"{field_name}[{index}]",
                        suggestion="Replace non-string hint items with short plain-language guidance",
                    )
                )
                score -= 10
                continue
            if len(item) < 10:
                short_count += 1
        if short_count > 0:
            issues.append(
                _issue(
                    issue_cls,
                    "description_quality",
                    "suggestion",
                    f"{short_count} item(s) in {field_name} are very short - provide actionable guidance",
                    field=field_name,
                )
            )
            score -= min(short_count, 3)

    return max(0, score)


def _score_keyword_coverage(keyword_count: int) -> int:
    for minimum_keywords, score in KEYWORD_COVERAGE_BANDS:
        if keyword_count >= minimum_keywords:
            return score
    return max(0, keyword_count)


def _check_schema_descriptions(schema: dict[str, Any], issue_cls: Any) -> list[Any]:
    issues: list[Any] = []
    props = schema.get("properties", {})
    if not isinstance(props, dict):
        return issues

    for property_name, property_definition in props.items():
        if not isinstance(property_definition, dict):
            issues.append(
                _issue(
                    issue_cls,
                    "schema_completeness",
                    "warning",
                    f"Field '{property_name}' must be described by a schema object",
                    field=f"input_schema.properties.{property_name}",
                )
            )
            continue
        field_ref = f"input_schema.properties.{property_name}"
        description = property_definition.get("description")
        if description is None or (isinstance(description, str) and len(description.strip()) == 0):
            issues.append(
                _issue(
                    issue_cls,
                    "schema_completeness",
                    "warning",
                    f"Field '{property_name}' has no description - agents will not know what to pass",
                    field=field_ref,
                    suggestion=f"Add a description explaining what '{property_name}' represents and any constraints",
                )
            )
        elif not isinstance(description, str):
            issues.append(
                _issue(
                    issue_cls,
                    "schema_completeness",
                    "warning",
                    f"Field '{property_name}' description must be a string",
                    field=field_ref,
                    suggestion="Replace non-string descriptions with short explanatory text",
                )
            )
        elif isinstance(description, str) and len(description.strip()) < 10:
            issues.append(
                _issue(
                    issue_cls,
                    "schema_completeness",
                    "suggestion",
                    f"Field '{property_name}' has a very short description ({len(description.strip())} chars)",
                    field=field_ref,
                    suggestion="Expand the description to at least 10 characters for clarity",
                )
            )

        enum_values = property_definition.get("enum")
        if isinstance(enum_values, list):
            trivial = [item for item in enum_values if isinstance(item, str) and len(item) <= 1]
            if trivial and len(trivial) == len(enum_values):
                issues.append(
                    _issue(
                        issue_cls,
                        "schema_completeness",
                        "warning",
                        f"Field '{property_name}' has only single-character enum values - use meaningful names",
                        field=field_ref,
                        suggestion="Replace enum values like 'a','b','c' with descriptive names like 'celsius','fahrenheit'",
                    )
                )

        if property_definition.get("type") == "object":
            issues.extend(_check_schema_descriptions(property_definition, issue_cls))

        items = property_definition.get("items")
        if isinstance(items, dict) and items.get("type") == "object":
            issues.extend(_check_schema_descriptions(items, issue_cls))

    return issues


def _estimate_keyword_coverage(manual: dict[str, Any]) -> int:
    text_parts: list[str] = []

    conditions = manual.get("trigger_conditions")
    if isinstance(conditions, list):
        text_parts.extend(item for item in conditions if isinstance(item, str))

    job_to_be_done = manual.get("job_to_be_done")
    if isinstance(job_to_be_done, str):
        text_parts.append(job_to_be_done)

    summary_for_model = manual.get("summary_for_model")
    if isinstance(summary_for_model, str):
        text_parts.append(summary_for_model)

    usage_hints = manual.get("usage_hints")
    if isinstance(usage_hints, list):
        text_parts.extend(item for item in usage_hints if isinstance(item, str))

    words = _extract_words(" ".join(text_parts).lower())
    meaningful = {word for word in words if word not in STOP_WORDS and len(word) >= 2}
    return len(meaningful)


def _extract_words(text: str) -> list[str]:
    return WORD_RE.findall(text)


def _overall_to_grade(score: int) -> str:
    for grade, minimum_score in GRADE_THRESHOLDS:
        if score >= minimum_score:
            return grade
    return "F"


def _build_improvement_suggestions(
    *,
    trigger_score: int,
    do_not_use_score: int,
    summary_score: int,
    input_schema_score: int,
    output_schema_score: int,
    hints_score: int,
    keyword_count: int,
) -> list[str]:
    suggestions: list[str] = []
    if trigger_score < 20:
        suggestions.append(
            "Improve trigger_conditions: write 3-5 specific situations describing "
            "WHEN an agent should select this tool (e.g. 'When the user asks for current "
            "weather in a named city')."
        )
    if input_schema_score < 15:
        suggestions.append(
            "Add descriptions to all input_schema properties. Each description should "
            "be at least 10 characters and explain what the field represents."
        )
    if summary_score < 7:
        suggestions.append(
            "Rewrite summary_for_model with factual, plain language. Avoid marketing "
            "adjectives - describe what the tool does, not how great it is."
        )
    if do_not_use_score < 7:
        suggestions.append(
            "Add concrete do_not_use_when conditions that are genuinely different from "
            "your trigger_conditions. These help agents avoid false-positive matches."
        )
    if output_schema_score < 7:
        suggestions.append(
            "Add descriptions to output_schema properties so agents know what data "
            "they will receive."
        )
    if hints_score < 7:
        suggestions.append(
            "Expand usage_hints and result_hints with actionable guidance for agents."
        )
    if keyword_count < 10:
        suggestions.append(
            f"Keyword coverage is low ({keyword_count} unique terms). Use varied "
            "vocabulary across trigger_conditions and hints to cover more request phrasings."
        )
    return suggestions
