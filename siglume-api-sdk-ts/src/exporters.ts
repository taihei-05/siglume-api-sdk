import type { ToolManual } from "./types";
import { coerceMapping, isRecord, toJsonable } from "./utils";

export interface ToolSchemaExport<TSchema = Record<string, unknown>> {
  schema: TSchema;
  lossy_fields: string[];
  warnings: string[];
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface OpenAIFunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

// OpenAI Responses API flattens the function tool shape: type / name /
// description / parameters / strict live at the top level of the tool
// object. The nested `function: {...}` envelope belongs to the Chat
// Completions API only and is rejected by `responses.create(..., tools=[...])`.
export interface OpenAIResponsesToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
  };
}

const SECTION_ORDER = [
  "summary",
  "permission",
  "when_to_use",
  "avoid_when",
  "usage_hints",
  "result_hints",
  "error_hints",
  "connected_accounts",
  "dry_run",
  "approval_summary_template",
  "side_effect_summary",
  "jurisdiction",
  "legal_notes",
  "idempotency_support",
  "currency",
  "settlement_mode",
  "refund_or_cancellation_note",
] as const;

const LOSSY_WARNING_MESSAGES = {
  anthropic: {
    output_schema: "output_schema omitted - Anthropic tool definitions do not model output schemas.",
    approval_summary_template: "approval_summary_template merged into description - Anthropic tool definitions do not model approval summaries.",
    preview_schema: "preview_schema omitted - Anthropic tool definitions do not model previews.",
    idempotency_support: "idempotency_support merged into description - Anthropic tool definitions do not model idempotency hints.",
    side_effect_summary: "side_effect_summary merged into description - Anthropic tool definitions do not model side-effect summaries.",
    quote_schema: "quote_schema omitted - Anthropic tool definitions do not model payment quote schemas.",
    currency: "currency merged into description - Anthropic tool definitions do not model settlement currency metadata.",
    settlement_mode: "settlement_mode merged into description - Anthropic tool definitions do not model settlement-mode metadata.",
    refund_or_cancellation_note: "refund_or_cancellation_note merged into description - Anthropic tool definitions do not model refund policy metadata.",
    jurisdiction: "jurisdiction merged into description - Anthropic tool definitions do not model jurisdiction metadata.",
    legal_notes: "legal_notes merged into description - Anthropic tool definitions do not model legal note metadata.",
  },
  openai_function: {
    output_schema: "output_schema omitted - OpenAI function definitions do not model output schemas.",
    approval_summary_template: "approval_summary_template merged into description - OpenAI function definitions do not model approval summaries.",
    preview_schema: "preview_schema omitted - OpenAI function definitions do not model previews.",
    idempotency_support: "idempotency_support merged into description - OpenAI function definitions do not model idempotency hints.",
    side_effect_summary: "side_effect_summary merged into description - OpenAI function definitions do not model side-effect summaries.",
    quote_schema: "quote_schema omitted - OpenAI function definitions do not model payment quote schemas.",
    currency: "currency merged into description - OpenAI function definitions do not model settlement currency metadata.",
    settlement_mode: "settlement_mode merged into description - OpenAI function definitions do not model settlement-mode metadata.",
    refund_or_cancellation_note: "refund_or_cancellation_note merged into description - OpenAI function definitions do not model refund policy metadata.",
    jurisdiction: "jurisdiction merged into description - OpenAI function definitions do not model jurisdiction metadata.",
    legal_notes: "legal_notes merged into description - OpenAI function definitions do not model legal note metadata.",
  },
  openai_responses_tool: {
    output_schema: "output_schema omitted - OpenAI Responses tool definitions do not model output schemas.",
    approval_summary_template: "approval_summary_template merged into description - OpenAI Responses tool definitions do not model approval summaries.",
    preview_schema: "preview_schema omitted - OpenAI Responses tool definitions do not model previews.",
    idempotency_support: "idempotency_support merged into description - OpenAI Responses tool definitions do not model idempotency hints.",
    side_effect_summary: "side_effect_summary merged into description - OpenAI Responses tool definitions do not model side-effect summaries.",
    quote_schema: "quote_schema omitted - OpenAI Responses tool definitions do not model payment quote schemas.",
    currency: "currency merged into description - OpenAI Responses tool definitions do not model settlement currency metadata.",
    settlement_mode: "settlement_mode merged into description - OpenAI Responses tool definitions do not model settlement-mode metadata.",
    refund_or_cancellation_note: "refund_or_cancellation_note merged into description - OpenAI Responses tool definitions do not model refund policy metadata.",
    jurisdiction: "jurisdiction merged into description - OpenAI Responses tool definitions do not model jurisdiction metadata.",
    legal_notes: "legal_notes merged into description - OpenAI Responses tool definitions do not model legal note metadata.",
  },
  mcp: {
    approval_summary_template: "approval_summary_template merged into description - MCP tool descriptors do not model approval summaries.",
    preview_schema: "preview_schema omitted - MCP tool descriptors do not model previews.",
    side_effect_summary: "side_effect_summary merged into description - MCP tool descriptors do not model side-effect summaries.",
    quote_schema: "quote_schema omitted - MCP tool descriptors do not model payment quote schemas.",
    currency: "currency merged into description - MCP tool descriptors do not model settlement currency metadata.",
    settlement_mode: "settlement_mode merged into description - MCP tool descriptors do not model settlement-mode metadata.",
    refund_or_cancellation_note: "refund_or_cancellation_note merged into description - MCP tool descriptors do not model refund policy metadata.",
    jurisdiction: "jurisdiction merged into description - MCP tool descriptors do not model jurisdiction metadata.",
    legal_notes: "legal_notes merged into description - MCP tool descriptors do not model legal note metadata.",
  },
} as const;

type LossyProvider = keyof typeof LOSSY_WARNING_MESSAGES;

export function to_anthropic_tool(tool_manual: ToolManual | Record<string, unknown>): ToolSchemaExport<AnthropicToolDefinition> {
  const manual = coerceToolManual(tool_manual);
  const tool_name = requiredNonEmptyString(manual, "tool_name");
  const lossy_fields = lossyFields("anthropic", manual);
  return {
    schema: {
      name: tool_name,
      description: buildDescription(manual),
      input_schema: toRecord(manual.input_schema),
    },
    lossy_fields,
    warnings: warningsFor("anthropic", lossy_fields),
  };
}

export function to_openai_function(tool_manual: ToolManual | Record<string, unknown>): ToolSchemaExport<OpenAIFunctionDefinition> {
  const manual = coerceToolManual(tool_manual);
  const tool_name = requiredNonEmptyString(manual, "tool_name");
  const lossy_fields = lossyFields("openai_function", manual);
  return {
    schema: {
      name: tool_name,
      description: buildDescription(manual),
      parameters: toRecord(manual.input_schema),
      strict: true,
    },
    lossy_fields,
    warnings: warningsFor("openai_function", lossy_fields),
  };
}

export function to_openai_responses_tool(
  tool_manual: ToolManual | Record<string, unknown>,
): ToolSchemaExport<OpenAIResponsesToolDefinition> {
  const manual = coerceToolManual(tool_manual);
  const tool_name = requiredNonEmptyString(manual, "tool_name");
  const lossy_fields = lossyFields("openai_responses_tool", manual);
  return {
    schema: {
      type: "function",
      name: tool_name,
      description: buildDescription(manual),
      parameters: toRecord(manual.input_schema),
      strict: true,
    },
    lossy_fields,
    warnings: warningsFor("openai_responses_tool", lossy_fields),
  };
}

export function to_mcp_tool(tool_manual: ToolManual | Record<string, unknown>): ToolSchemaExport<McpToolDescriptor> {
  const manual = coerceToolManual(tool_manual);
  const tool_name = requiredNonEmptyString(manual, "tool_name");
  const permission_class = stringValue(manual.permission_class) ?? "read_only";
  const lossy_fields = lossyFields("mcp", manual);
  return {
    schema: {
      name: tool_name,
      description: buildDescription(manual),
      inputSchema: toRecord(manual.input_schema),
      outputSchema: toRecord(manual.output_schema),
      annotations: {
        readOnlyHint: permission_class === "read_only",
        destructiveHint: permission_class !== "read_only",
        idempotentHint:
          manual.idempotency_support !== undefined && manual.idempotency_support !== null
            ? Boolean(manual.idempotency_support)
            : permission_class === "read_only",
      },
    },
    lossy_fields,
    warnings: warningsFor("mcp", lossy_fields),
  };
}

function coerceToolManual(tool_manual: ToolManual | Record<string, unknown>): Record<string, unknown> {
  return coerceMapping(tool_manual, "tool_manual");
}

function buildDescription(manual: Record<string, unknown>): string {
  const sections: Record<string, string> = {};
  const summary = stringValue(manual.summary_for_model);
  if (summary) {
    sections.summary = summary;
  }

  const permission_class = stringValue(manual.permission_class);
  if (permission_class) {
    sections.permission = `Permission class: ${permission_class}.`;
  }

  const trigger_conditions = stringList(manual.trigger_conditions);
  if (trigger_conditions.length > 0) {
    sections.when_to_use = renderListSection("When to use", trigger_conditions);
  }

  const do_not_use_when = stringList(manual.do_not_use_when);
  if (do_not_use_when.length > 0) {
    sections.avoid_when = renderListSection("Avoid when", do_not_use_when);
  }

  const usage_hints = stringList(manual.usage_hints);
  if (usage_hints.length > 0) {
    sections.usage_hints = renderListSection("Usage hints", usage_hints);
  }

  const result_hints = stringList(manual.result_hints);
  if (result_hints.length > 0) {
    sections.result_hints = renderListSection("Result hints", result_hints);
  }

  const error_hints = stringList(manual.error_hints);
  if (error_hints.length > 0) {
    sections.error_hints = renderListSection("Error hints", error_hints);
  }

  const connected_accounts = stringList(manual.requires_connected_accounts);
  if (connected_accounts.length > 0) {
    sections.connected_accounts = renderListSection("Requires connected accounts", connected_accounts);
  }

  if ("dry_run_supported" in manual) {
    sections.dry_run = `Dry run supported: ${manual.dry_run_supported ? "yes" : "no"}.`;
  }

  const approval_summary_template = stringValue(manual.approval_summary_template);
  if (approval_summary_template) {
    sections.approval_summary_template = `Approval summary template: ${approval_summary_template}`;
  }

  const side_effect_summary = stringValue(manual.side_effect_summary);
  if (side_effect_summary) {
    sections.side_effect_summary = `Side effects: ${side_effect_summary}`;
  }

  const jurisdiction = stringValue(manual.jurisdiction);
  if (jurisdiction) {
    sections.jurisdiction = `Jurisdiction: ${jurisdiction}.`;
  }

  const legal_notes = stringValue(manual.legal_notes);
  if (legal_notes) {
    sections.legal_notes = `Legal notes: ${legal_notes}`;
  }

  if ("idempotency_support" in manual && manual.idempotency_support !== undefined && manual.idempotency_support !== null) {
    sections.idempotency_support = `Idempotency support: ${manual.idempotency_support ? "yes" : "no"}.`;
  }

  const currency = stringValue(manual.currency);
  if (currency) {
    sections.currency = `Payment currency: ${currency}.`;
  }

  const settlement_mode = stringValue(manual.settlement_mode);
  if (settlement_mode) {
    sections.settlement_mode = `Settlement mode: ${settlement_mode}.`;
  }

  const refund_or_cancellation_note = stringValue(manual.refund_or_cancellation_note);
  if (refund_or_cancellation_note) {
    sections.refund_or_cancellation_note = `Refund or cancellation: ${refund_or_cancellation_note}`;
  }

  return SECTION_ORDER
    .filter((key) => key in sections)
    .map((key) => sections[key]!)
    .join("\n\n");
}

function renderListSection(title: string, items: string[]): string {
  return [title + ":", ...items.map((item) => `- ${item}`)].join("\n");
}

function lossyFields(provider: LossyProvider, manual: Record<string, unknown>): string[] {
  return Object.keys(LOSSY_WARNING_MESSAGES[provider]).filter((field_name) => hasMeaningfulValue(manual[field_name]));
}

function warningsFor(provider: LossyProvider, lossy_fields: string[]): string[] {
  const messages = LOSSY_WARNING_MESSAGES[provider];
  return lossy_fields.map((field_name) => messages[field_name as keyof typeof messages]);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length > 0;
  }
  return true;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function requiredNonEmptyString(payload: Record<string, unknown>, field_name: string): string {
  const value = stringValue(payload[field_name]);
  if (value === null) {
    throw new TypeError(`tool_manual.${field_name} must be a non-empty string`);
  }
  return value;
}

function toRecord(value: unknown): Record<string, unknown> {
  const payload = toJsonable(value);
  return isRecord(payload) ? { ...payload } : {};
}
