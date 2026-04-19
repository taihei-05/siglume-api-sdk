import rules from "../../schemas/tool-manual-grader-rules.json";

import { SiglumeClient } from "./client";
import type { ToolManualIssue, ToolManualQualityReport } from "./types";
import { validate_tool_manual } from "./tool-manual-validator";
import { isRecord } from "./utils";

const WORD_RE = /[A-Za-z\u3040-\u9fff]{2,}/gu;

type GraderIssueFactory = (
  code: string,
  message: string,
  options?: { field?: string; severity?: ToolManualIssue["severity"]; suggestion?: string },
) => ToolManualIssue;

type ManualScoreParts = {
  trigger_score: number;
  do_not_use_score: number;
  summary_score: number;
  input_schema_score: number;
  output_schema_score: number;
  hints_score: number;
  keyword_count: number;
};

const ambiguityPhrases = Array.isArray(rules.ambiguity_phrases)
  ? rules.ambiguity_phrases.map((item) => String(item))
  : [];
const marketingFluff = Array.isArray(rules.marketing_fluff)
  ? rules.marketing_fluff.map((item) => String(item))
  : [];
const imperativePrefixes = Array.isArray(rules.imperative_prefixes)
  ? rules.imperative_prefixes.map((item) => String(item))
  : [];
const stopWords = new Set(
  Array.isArray(rules.stop_words) ? rules.stop_words.map((item) => String(item)) : [],
);
const keywordCoverageBands = Array.isArray(rules.keyword_coverage_bands)
  ? rules.keyword_coverage_bands
      .filter((item): item is { minimum_keywords: number; score: number } =>
        isRecord(item) &&
        typeof item.minimum_keywords === "number" &&
        typeof item.score === "number",
      )
      .map((item) => [item.minimum_keywords, item.score] as const)
      .sort((left, right) => right[0] - left[0])
  : [];
const gradeThresholdSource = isRecord(rules.grade_thresholds) ? (rules.grade_thresholds as Record<string, unknown>) : {};
const gradeThresholds = ["A", "B", "C", "D"]
  .map((grade) => [grade, gradeThresholdSource[grade]] as const)
  .filter((entry): entry is [ToolManualQualityReport["grade"], number] => typeof entry[1] === "number");

function createIssueFactory(): GraderIssueFactory {
  return (code, message, options = {}) => ({
    code,
    message,
    field: options.field,
    severity: options.severity ?? "warning",
    suggestion: options.suggestion,
  });
}

function coerceToolManual(tool_manual: unknown): Record<string, unknown> | unknown {
  if (isRecord(tool_manual) && typeof tool_manual.to_dict === "function") {
    return tool_manual.to_dict();
  }
  return tool_manual;
}

export async function score_tool_manual_remote(
  tool_manual: Record<string, unknown>,
  options: { api_key: string; base_url?: string; fetch?: typeof fetch },
): Promise<ToolManualQualityReport> {
  const client = new SiglumeClient({
    api_key: options.api_key,
    base_url: options.base_url,
    fetch: options.fetch,
  });
  return client.preview_quality_score(tool_manual);
}

export function score_tool_manual_offline(tool_manual: unknown): ToolManualQualityReport {
  const manual = coerceToolManual(tool_manual);
  const [validation_ok, validation_issues] = validate_tool_manual(manual);
  const quality = scoreManualQuality(manual);
  const validation_errors = validation_issues.filter((nextIssue) => nextIssue.severity === "error");
  const validation_warnings = validation_issues.filter((nextIssue) => nextIssue.severity !== "error");
  const hasCriticalQualityIssue = quality.issues.some((nextIssue) => nextIssue.severity === "critical");

  return {
    overall_score: quality.overall_score,
    grade: quality.grade,
    issues: [...validation_issues, ...quality.issues],
    keyword_coverage_estimate: quality.keyword_coverage_estimate,
    improvement_suggestions: quality.improvement_suggestions,
    publishable: validation_ok && (quality.grade === "A" || quality.grade === "B") && !hasCriticalQualityIssue,
    validation_ok,
    validation_errors,
    validation_warnings,
  };
}

function scoreManualQuality(manual: Record<string, unknown> | unknown): ToolManualQualityReport {
  const makeIssue = createIssueFactory();
  if (!isRecord(manual)) {
    return {
      overall_score: 0,
      grade: "F",
      issues: [makeIssue("ambiguity", "Manual is not a dict", { severity: "critical" })],
      keyword_coverage_estimate: 0,
      improvement_suggestions: ["Provide a valid manual dict"],
    };
  }

  const issues: ToolManualIssue[] = [];
  const trigger_score = scoreTriggerConditions(manual, issues, makeIssue);
  const do_not_use_score = scoreDoNotUseWhen(manual, issues, makeIssue);
  const summary_score = scoreSummaryForModel(manual, issues, makeIssue);
  const input_schema_score = scoreInputSchemaDescriptions(manual, issues, makeIssue);
  const output_schema_score = scoreOutputSchemaCompleteness(manual, issues, makeIssue);
  const hints_score = scoreHints(manual, issues, makeIssue);
  const keyword_coverage_estimate = estimateKeywordCoverage(manual);
  const keyword_score = scoreKeywordCoverage(keyword_coverage_estimate);

  const overall_score = Math.max(
    0,
    Math.min(
      100,
      trigger_score +
        do_not_use_score +
        summary_score +
        input_schema_score +
        output_schema_score +
        hints_score +
        keyword_score,
    ),
  );

  return {
    overall_score,
    grade: overallToGrade(overall_score),
    issues,
    keyword_coverage_estimate,
    improvement_suggestions: buildImprovementSuggestions({
      trigger_score,
      do_not_use_score,
      summary_score,
      input_schema_score,
      output_schema_score,
      hints_score,
      keyword_count: keyword_coverage_estimate,
    }),
  };
}

function scoreTriggerConditions(
  manual: Record<string, unknown>,
  issues: ToolManualIssue[],
  makeIssue: GraderIssueFactory,
): number {
  const conditions = manual.trigger_conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) {
    issues.push(makeIssue("trigger_specificity", "No trigger_conditions provided", { field: "trigger_conditions", severity: "critical" }));
    return 0;
  }

  let score = 30;
  conditions.forEach((condition, index) => {
    if (typeof condition !== "string") {
      issues.push(
        makeIssue("trigger_specificity", "Trigger condition must be a string to be matchable by agents", {
          field: `trigger_conditions[${index}]`,
          severity: "warning",
          suggestion: "Replace non-string trigger conditions with concrete text descriptions",
        }),
      );
      score -= 5;
      return;
    }

    const field = `trigger_conditions[${index}]`;
    const lowered = condition.toLowerCase();
    if (condition.length < 15) {
      issues.push(
        makeIssue("trigger_specificity", `Trigger condition is too short (${condition.length} chars) - be more specific`, {
          field,
          severity: "warning",
          suggestion: "Describe a concrete situation, e.g. 'When the owner asks for a weather forecast for a specific city'",
        }),
      );
      score -= 5;
    }
    if (ambiguityPhrases.some((phrase) => lowered.includes(phrase.toLowerCase()))) {
      issues.push(
        makeIssue("ambiguity", "Contains vague phrase that agents cannot reliably match on", {
          field,
          severity: "warning",
          suggestion: "Replace with a concrete situation description",
        }),
      );
      score -= 5;
    }
    if (marketingFluff.some((fluff) => lowered.includes(fluff.toLowerCase()))) {
      issues.push(
        makeIssue("description_quality", "Marketing language in trigger condition reduces selection accuracy", {
          field,
          severity: "warning",
          suggestion: "Use factual, situation-based language instead",
        }),
      );
      score -= 3;
    }
    if (imperativePrefixes.some((prefix) => lowered.startsWith(prefix))) {
      issues.push(
        makeIssue("trigger_specificity", "Trigger reads as an imperative command rather than a situation description", {
          field,
          severity: "suggestion",
          suggestion: "Rewrite as a situation: 'When the user needs...' or 'The agent encounters...'",
        }),
      );
      score -= 2;
    }
  });

  if (conditions.length < 3) {
    issues.push(
      makeIssue("trigger_specificity", `Only ${conditions.length} trigger condition(s) - 3+ increases selection chances`, {
        field: "trigger_conditions",
        severity: "suggestion",
      }),
    );
    score -= 5;
  }
  return Math.max(0, score);
}

function scoreDoNotUseWhen(
  manual: Record<string, unknown>,
  issues: ToolManualIssue[],
  makeIssue: GraderIssueFactory,
): number {
  const items = manual.do_not_use_when;
  if (!Array.isArray(items) || items.length === 0) {
    issues.push(
      makeIssue("description_quality", "No do_not_use_when items - agents need negative conditions to avoid false positives", {
        field: "do_not_use_when",
        severity: "warning",
      }),
    );
    return 0;
  }

  let score = 10;
  const triggerTexts = Array.isArray(manual.trigger_conditions)
    ? manual.trigger_conditions.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase())
    : [];

  items.forEach((item, index) => {
    if (typeof item !== "string") {
      issues.push(
        makeIssue("description_quality", "do_not_use_when entries must be strings to describe negative cases clearly", {
          field: `do_not_use_when[${index}]`,
          severity: "warning",
        }),
      );
      score -= 3;
      return;
    }

    const field = `do_not_use_when[${index}]`;
    const itemWords = new Set(extractWords(item.toLowerCase()));
    for (const triggerText of triggerTexts) {
      const triggerWords = new Set(extractWords(triggerText));
      if (itemWords.size === 0 || triggerWords.size === 0) {
        continue;
      }
      const overlap = [...itemWords].filter((word) => triggerWords.has(word)).length / itemWords.size;
      if (overlap > 0.6) {
        issues.push(
          makeIssue("ambiguity", "This do_not_use_when item closely mirrors a trigger_condition - add a genuinely different negative case", {
            field,
            severity: "suggestion",
          }),
        );
        score -= 3;
        break;
      }
    }
    if (item.length < 10) {
      issues.push(
        makeIssue("description_quality", "do_not_use_when item is very short - describe a concrete negative condition", {
          field,
          severity: "suggestion",
        }),
      );
      score -= 2;
    }
  });

  return Math.max(0, score);
}

function scoreSummaryForModel(
  manual: Record<string, unknown>,
  issues: ToolManualIssue[],
  makeIssue: GraderIssueFactory,
): number {
  const summary = manual.summary_for_model;
  if (summary === undefined) {
    issues.push(makeIssue("description_quality", "summary_for_model is missing", { field: "summary_for_model", severity: "warning" }));
    return 0;
  }
  if (typeof summary !== "string") {
    issues.push(makeIssue("description_quality", "summary_for_model must be a string", { field: "summary_for_model", severity: "warning" }));
    return 0;
  }
  if (summary.length === 0) {
    issues.push(makeIssue("description_quality", "summary_for_model is empty", { field: "summary_for_model", severity: "warning" }));
    return 0;
  }

  let score = 10;
  const lowered = summary.toLowerCase();
  let fluffFound = false;
  for (const fluff of marketingFluff) {
    if (lowered.includes(fluff.toLowerCase())) {
      issues.push(
        makeIssue("description_quality", "Marketing language in summary_for_model - use factual descriptions", {
          field: "summary_for_model",
          severity: "warning",
          suggestion: "Describe what the tool actually does in plain terms",
        }),
      );
      if (!fluffFound) {
        score -= 3;
        fluffFound = true;
      }
    }
  }
  if (summary.length < 20) {
    issues.push(
      makeIssue("description_quality", "summary_for_model is very brief - a longer factual description helps agent selection", {
        field: "summary_for_model",
        severity: "suggestion",
      }),
    );
    score -= 3;
  }
  return Math.max(0, score);
}

function scoreInputSchemaDescriptions(
  manual: Record<string, unknown>,
  issues: ToolManualIssue[],
  makeIssue: GraderIssueFactory,
): number {
  if (!isRecord(manual.input_schema)) {
    issues.push(makeIssue("schema_completeness", "input_schema must be a JSON Schema object", { field: "input_schema", severity: "warning" }));
    return 0;
  }
  const schemaIssues = checkSchemaDescriptions(manual.input_schema, makeIssue);
  issues.push(...schemaIssues);
  if (schemaIssues.length === 0) {
    return 20;
  }

  let score = 20;
  for (const schemaIssue of schemaIssues) {
    if (schemaIssue.severity === "warning") {
      score -= 5;
    } else if (schemaIssue.severity === "suggestion") {
      score -= 2;
    }
  }
  return Math.max(0, score);
}

function scoreOutputSchemaCompleteness(
  manual: Record<string, unknown>,
  issues: ToolManualIssue[],
  makeIssue: GraderIssueFactory,
): number {
  if (!isRecord(manual.output_schema)) {
    issues.push(makeIssue("schema_completeness", "output_schema must be a JSON Schema object", { field: "output_schema", severity: "warning" }));
    return 0;
  }

  const properties = manual.output_schema.properties;
  if (!isRecord(properties)) {
    issues.push(
      makeIssue("schema_completeness", "output_schema.properties must be an object mapping field names to schema definitions", {
        field: "output_schema.properties",
        severity: "warning",
      }),
    );
    return 0;
  }
  if (Object.keys(properties).length === 0) {
    issues.push(makeIssue("schema_completeness", "output_schema has no properties defined", { field: "output_schema", severity: "warning" }));
    return 0;
  }

  let undescribed = 0;
  Object.values(properties).forEach((propertyDefinition) => {
    if (isRecord(propertyDefinition) && !propertyDefinition.description) {
      undescribed += 1;
    }
  });

  let score = 10;
  if (undescribed > 0) {
    issues.push(
      makeIssue("schema_completeness", `${undescribed} output field(s) lack descriptions`, {
        field: "output_schema",
        severity: "suggestion",
        suggestion: "Add description to each output property so agents know what to expect",
      }),
    );
    score -= Math.min(undescribed * 2, 6);
  }
  return Math.max(0, score);
}

function scoreHints(manual: Record<string, unknown>, issues: ToolManualIssue[], makeIssue: GraderIssueFactory): number {
  let score = 10;
  for (const fieldName of ["usage_hints", "result_hints", "error_hints"] as const) {
    const hints = manual[fieldName];
    if (!Array.isArray(hints)) {
      issues.push(
        makeIssue("description_quality", `${fieldName} must be a list of hint strings`, {
          field: fieldName,
          severity: "warning",
        }),
      );
      score -= 5;
      continue;
    }
    if (hints.length === 0) {
      issues.push(
        makeIssue("description_quality", `${fieldName} is empty - hints help agents use the tool correctly`, {
          field: fieldName,
          severity: "suggestion",
        }),
      );
      score -= 3;
      continue;
    }

    let shortCount = 0;
    hints.forEach((item, index) => {
      if (typeof item !== "string") {
        issues.push(
          makeIssue("description_quality", `${fieldName} items must be strings`, {
            field: `${fieldName}[${index}]`,
            severity: "critical",
            suggestion: "Replace non-string hint items with short plain-language guidance",
          }),
        );
        score -= 10;
        return;
      }
      if (item.length < 10) {
        shortCount += 1;
      }
    });
    if (shortCount > 0) {
      issues.push(
        makeIssue("description_quality", `${shortCount} item(s) in ${fieldName} are very short - provide actionable guidance`, {
          field: fieldName,
          severity: "suggestion",
        }),
      );
      score -= Math.min(shortCount, 3);
    }
  }
  return Math.max(0, score);
}

function scoreKeywordCoverage(keywordCount: number): number {
  for (const [minimumKeywords, score] of keywordCoverageBands) {
    if (keywordCount >= minimumKeywords) {
      return score;
    }
  }
  return Math.max(0, keywordCount);
}

function checkSchemaDescriptions(schema: Record<string, unknown>, makeIssue: GraderIssueFactory): ToolManualIssue[] {
  const issues: ToolManualIssue[] = [];
  const properties = schema.properties;
  if (!isRecord(properties)) {
    return issues;
  }

  for (const [propertyName, propertyDefinition] of Object.entries(properties)) {
    if (!isRecord(propertyDefinition)) {
      issues.push(
        makeIssue("schema_completeness", `Field '${propertyName}' must be described by a schema object`, {
          field: `input_schema.properties.${propertyName}`,
          severity: "warning",
        }),
      );
      continue;
    }

    const field = `input_schema.properties.${propertyName}`;
    const description = propertyDefinition.description;
    if (description === undefined || (typeof description === "string" && description.trim().length === 0)) {
      issues.push(
        makeIssue("schema_completeness", `Field '${propertyName}' has no description - agents will not know what to pass`, {
          field,
          severity: "warning",
          suggestion: `Add a description explaining what '${propertyName}' represents and any constraints`,
        }),
      );
    } else if (typeof description !== "string") {
      issues.push(
        makeIssue("schema_completeness", `Field '${propertyName}' description must be a string`, {
          field,
          severity: "warning",
          suggestion: "Replace non-string descriptions with short explanatory text",
        }),
      );
    } else if (description.trim().length < 10) {
      issues.push(
        makeIssue("schema_completeness", `Field '${propertyName}' has a very short description (${description.trim().length} chars)`, {
          field,
          severity: "suggestion",
          suggestion: "Expand the description to at least 10 characters for clarity",
        }),
      );
    }

    if (Array.isArray(propertyDefinition.enum)) {
      const trivial = propertyDefinition.enum.filter((item) => typeof item === "string" && item.length <= 1);
      if (trivial.length > 0 && trivial.length === propertyDefinition.enum.length) {
        issues.push(
          makeIssue("schema_completeness", `Field '${propertyName}' has only single-character enum values - use meaningful names`, {
            field,
            severity: "warning",
            suggestion: "Replace enum values like 'a','b','c' with descriptive names like 'celsius','fahrenheit'",
          }),
        );
      }
    }

    if (propertyDefinition.type === "object") {
      issues.push(...checkSchemaDescriptions(propertyDefinition, makeIssue));
    }
    if (isRecord(propertyDefinition.items) && propertyDefinition.items.type === "object") {
      issues.push(...checkSchemaDescriptions(propertyDefinition.items, makeIssue));
    }
  }

  return issues;
}

function estimateKeywordCoverage(manual: Record<string, unknown>): number {
  const textParts: string[] = [];
  if (Array.isArray(manual.trigger_conditions)) {
    textParts.push(...manual.trigger_conditions.filter((item): item is string => typeof item === "string"));
  }
  if (typeof manual.job_to_be_done === "string") {
    textParts.push(manual.job_to_be_done);
  }
  if (typeof manual.summary_for_model === "string") {
    textParts.push(manual.summary_for_model);
  }
  if (Array.isArray(manual.usage_hints)) {
    textParts.push(...manual.usage_hints.filter((item): item is string => typeof item === "string"));
  }
  const words = extractWords(textParts.join(" ").toLowerCase());
  const meaningful = new Set(words.filter((word) => !stopWords.has(word) && word.length >= 2));
  return meaningful.size;
}

function extractWords(text: string): string[] {
  return [...text.matchAll(WORD_RE)].map((match) => match[0]);
}

function overallToGrade(score: number): ToolManualQualityReport["grade"] {
  for (const [grade, minimumScore] of gradeThresholds) {
    if (score >= minimumScore) {
      return grade;
    }
  }
  return "F";
}

function buildImprovementSuggestions(scores: ManualScoreParts): string[] {
  const suggestions: string[] = [];
  if (scores.trigger_score < 20) {
    suggestions.push("Improve trigger_conditions: write 3-5 specific situations describing WHEN an agent should select this tool.");
  }
  if (scores.input_schema_score < 15) {
    suggestions.push("Add descriptions to all input_schema properties. Each description should be at least 10 characters and explain what the field represents.");
  }
  if (scores.summary_score < 7) {
    suggestions.push("Rewrite summary_for_model with factual, plain language. Avoid marketing adjectives and describe what the tool does.");
  }
  if (scores.do_not_use_score < 7) {
    suggestions.push("Add concrete do_not_use_when conditions that are genuinely different from your trigger_conditions.");
  }
  if (scores.output_schema_score < 7) {
    suggestions.push("Add descriptions to output_schema properties so agents know what data they will receive.");
  }
  if (scores.hints_score < 7) {
    suggestions.push("Expand usage_hints and result_hints with actionable guidance for agents.");
  }
  if (scores.keyword_count < 10) {
    suggestions.push(
      `Keyword coverage is low (${scores.keyword_count} unique terms). Use varied vocabulary across trigger_conditions and hints to cover more request phrasings.`,
    );
  }
  return suggestions;
}
