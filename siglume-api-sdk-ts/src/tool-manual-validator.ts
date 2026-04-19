import type { ToolManual, ToolManualIssue, ToolManualPermissionClass } from "./types";
import { PermissionClass, SettlementMode, ToolManualPermissionClass as ToolManualPermissionClassValues } from "./types";
import { isRecord } from "./utils";

const JURISDICTION_PATTERN = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;
const TOOL_NAME_RE = /^[A-Za-z0-9_]{3,64}$/;
const PLATFORM_INJECTED_FIELDS = new Set([
  "execution_id",
  "trace_id",
  "connected_account_id",
  "dry_run",
  "idempotency_key",
  "budget_snapshot",
]);
const COMPOSITION_KEYWORDS = new Set(["oneOf", "anyOf", "allOf"]);
const INPUT_SCHEMA_FORBIDDEN_KEYS = new Set(["patternProperties"]);

type ManualInput = ToolManual | Record<string, unknown> | { to_dict(): unknown } | unknown;

function issue(
  code: string,
  message: string,
  field?: string,
  severity: ToolManualIssue["severity"] = "error",
  suggestion?: string,
): ToolManualIssue {
  return { code, message, field, severity, suggestion };
}

function coerceToolManual(manual: ManualInput): unknown {
  if (isRecord(manual) && typeof manual.to_dict === "function") {
    return manual.to_dict();
  }
  return manual;
}

function checkSchemaForbiddenRecursive(
  schema: Record<string, unknown>,
  rootField: string,
  pushIssue: (nextIssue: ToolManualIssue) => void,
  path = "",
): void {
  for (const keyword of COMPOSITION_KEYWORDS) {
    if (keyword in schema) {
      const location = path ? `${rootField}.${path}.${keyword}` : `${rootField}.${keyword}`;
      pushIssue(
        issue(
          "INPUT_SCHEMA",
          `Composition keyword '${keyword}' is not allowed in beta${path ? ` at ${path}` : ""}`,
          location,
        ),
      );
    }
  }

  for (const forbidden of INPUT_SCHEMA_FORBIDDEN_KEYS) {
    if (forbidden in schema) {
      const location = path ? `${rootField}.${path}.${forbidden}` : `${rootField}.${forbidden}`;
      pushIssue(
        issue(
          "INPUT_SCHEMA",
          `'${forbidden}' is not allowed${path ? ` at ${path}` : ""}`,
          location,
        ),
      );
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && isRecord(value)) {
      for (const [propertyName, propertyDefinition] of Object.entries(value)) {
        if (!isRecord(propertyDefinition)) {
          continue;
        }
        const subPath = path ? `${path}.${propertyName}` : propertyName;
        checkSchemaForbiddenRecursive(propertyDefinition, rootField, pushIssue, subPath);
      }
    } else if (key === "items" && isRecord(value)) {
      const subPath = path ? `${path}.items` : "items";
      checkSchemaForbiddenRecursive(value, rootField, pushIssue, subPath);
    }
  }
}

export function tool_manual_to_dict(manual: ToolManual | Record<string, unknown>): Record<string, unknown> {
  return isRecord(manual) ? { ...manual } : {};
}

export function validate_tool_manual(manualInput: ManualInput): [boolean, ToolManualIssue[]] {
  const manual = coerceToolManual(manualInput);
  const issues: ToolManualIssue[] = [];
  const pushError = (code: string, message: string, field?: string) => {
    issues.push(issue(code, message, field, "error"));
  };
  const pushWarning = (code: string, message: string, field?: string) => {
    issues.push(issue(code, message, field, "warning"));
  };

  if (!isRecord(manual)) {
    pushError("INVALID_ROOT", "tool manual must be a dict");
    return [false, issues];
  }

  const requiredFields = [
    "tool_name",
    "job_to_be_done",
    "summary_for_model",
    "trigger_conditions",
    "do_not_use_when",
    "permission_class",
    "dry_run_supported",
    "requires_connected_accounts",
    "input_schema",
    "output_schema",
    "usage_hints",
    "result_hints",
    "error_hints",
  ];
  for (const fieldName of requiredFields) {
    if (!(fieldName in manual)) {
      pushError("MISSING_FIELD", `required field '${fieldName}' is missing`, fieldName);
    }
  }

  const toolName = manual.tool_name;
  if (typeof toolName === "string" && toolName.length > 0 && !TOOL_NAME_RE.test(toolName)) {
    pushError("INVALID_TOOL_NAME", "tool_name must be alphanumeric + underscore, 3-64 chars", "tool_name");
  }

  for (const [fieldName, minLength, maxLength] of [
    ["job_to_be_done", 10, 500],
    ["summary_for_model", 10, 300],
  ] as const) {
    const value = manual[fieldName];
    if (typeof value === "string" && (value.length < minLength || value.length > maxLength)) {
      pushError("INVALID_TYPE", `${fieldName} must be ${minLength}-${maxLength} characters`, fieldName);
    }
  }

  const triggerConditions = manual.trigger_conditions;
  if (Array.isArray(triggerConditions)) {
    if (triggerConditions.length < 3) {
      pushError("TOO_FEW_ITEMS", "trigger_conditions needs at least 3 items", "trigger_conditions");
    } else if (triggerConditions.length > 8) {
      pushError("TOO_MANY_ITEMS", "trigger_conditions allows at most 8 items", "trigger_conditions");
    }
    triggerConditions.forEach((item, index) => {
      if (typeof item === "string" && (item.length < 10 || item.length > 200)) {
        pushError(
          item.length < 10 ? "ITEM_TOO_SHORT" : "ITEM_TOO_LONG",
          `trigger_conditions[${index}] must be 10-200 chars`,
          `trigger_conditions[${index}]`,
        );
      }
    });
  }

  const doNotUseWhen = manual.do_not_use_when;
  if (Array.isArray(doNotUseWhen)) {
    if (doNotUseWhen.length < 1) {
      pushError("TOO_FEW_ITEMS", "do_not_use_when needs at least 1 item", "do_not_use_when");
    } else if (doNotUseWhen.length > 5) {
      pushError("TOO_MANY_ITEMS", "do_not_use_when allows at most 5 items", "do_not_use_when");
    }
  }

  const permissionClass = manual.permission_class;
  const validPermissionClasses: ToolManualPermissionClass[] = [
    ToolManualPermissionClassValues.READ_ONLY,
    ToolManualPermissionClassValues.ACTION,
    ToolManualPermissionClassValues.PAYMENT,
  ];
  if (typeof permissionClass === "string" && !validPermissionClasses.includes(permissionClass as ToolManualPermissionClass)) {
    if (permissionClass === PermissionClass.READ_ONLY || permissionClass === PermissionClass.RECOMMENDATION) {
      pushError(
        "INVALID_PERMISSION_CLASS",
        `ToolManual uses underscored values (${JSON.stringify(validPermissionClasses)}), not the hyphenated AppManifest form '${permissionClass}'`,
        "permission_class",
      );
    } else {
      pushError(
        "INVALID_PERMISSION_CLASS",
        `permission_class must be one of ${JSON.stringify(validPermissionClasses)}`,
        "permission_class",
      );
    }
  }

  const requireString = (fieldName: string, context: string) => {
    const value = manual[fieldName];
    if (value === undefined || value === null) {
      pushError("MISSING_FIELD", `'${fieldName}' is required for permission_class='${context}'`, fieldName);
    } else if (typeof value !== "string") {
      pushError("INVALID_TYPE", `'${fieldName}' must be a string`, fieldName);
    } else if (value.length === 0) {
      pushError("TOO_SHORT", `'${fieldName}' must be at least 1 char`, fieldName);
    }
  };

  const requireSchema = (fieldName: string, context: string) => {
    const value = manual[fieldName];
    if (value === undefined || value === null) {
      pushError("MISSING_FIELD", `'${fieldName}' is required for permission_class='${context}'`, fieldName);
    } else if (!isRecord(value)) {
      pushError("INVALID_TYPE", `'${fieldName}' must be a JSON Schema object`, fieldName);
    }
  };

  if (permissionClass === ToolManualPermissionClassValues.ACTION || permissionClass === ToolManualPermissionClassValues.PAYMENT) {
    requireString("approval_summary_template", permissionClass);
    requireSchema("preview_schema", permissionClass);
    requireString("side_effect_summary", permissionClass);
    requireString("jurisdiction", permissionClass);
    if (typeof manual.jurisdiction === "string" && manual.jurisdiction.length > 0 && !JURISDICTION_PATTERN.test(manual.jurisdiction)) {
      pushError(
        "INVALID_JURISDICTION",
        `jurisdiction must be ISO 3166-1 alpha-2 (optionally -subregion), got: ${JSON.stringify(manual.jurisdiction)}`,
        "jurisdiction",
      );
    }
    if (!("idempotency_support" in manual)) {
      pushError("MISSING_FIELD", `'idempotency_support' is required for permission_class='${permissionClass}'`, "idempotency_support");
    } else if (manual.idempotency_support !== true) {
      pushError("IDEMPOTENCY_REQUIRED", "idempotency_support must be true for action/payment", "idempotency_support");
    }
  }

  if (permissionClass === ToolManualPermissionClassValues.PAYMENT) {
    requireSchema("quote_schema", "payment");
    requireString("currency", "payment");
    requireString("settlement_mode", "payment");
    requireString("refund_or_cancellation_note", "payment");
    if (typeof manual.currency === "string" && manual.currency !== "USD") {
      pushError("INVALID_CURRENCY", "currency must be 'USD'", "currency");
    }
    if (
      typeof manual.settlement_mode === "string" &&
      !Object.values(SettlementMode).includes(manual.settlement_mode as SettlementMode)
    ) {
      pushError(
        "INVALID_SETTLEMENT_MODE",
        `settlement_mode must be one of ${JSON.stringify(Object.values(SettlementMode))}`,
        "settlement_mode",
      );
    }
  }

  const inputSchema = manual.input_schema;
  if (isRecord(inputSchema)) {
    if (inputSchema.type !== "object") {
      pushError("INPUT_SCHEMA", "Root type must be 'object'", "input_schema");
    }
    if (inputSchema.additionalProperties !== false) {
      pushError("INPUT_SCHEMA", "additionalProperties must be false", "input_schema");
    }
    checkSchemaForbiddenRecursive(inputSchema, "input_schema", (nextIssue) => issues.push(nextIssue));
    const properties = inputSchema.properties;
    if (isRecord(properties)) {
      for (const fieldName of Object.keys(properties)) {
        if (PLATFORM_INJECTED_FIELDS.has(fieldName)) {
          pushWarning(
            "INPUT_SCHEMA",
            `'${fieldName}' is platform-injected; remove from input_schema`,
            `input_schema.properties.${fieldName}`,
          );
        }
      }
    }
  }

  const outputSchema = manual.output_schema;
  if (isRecord(outputSchema)) {
    const required = outputSchema.required;
    if (!Array.isArray(required) || required.length === 0) {
      pushError("OUTPUT_SCHEMA", "output_schema must have at least one stable required key", "output_schema.required");
    }
    const properties = outputSchema.properties;
    if (isRecord(properties) && !("summary" in properties)) {
      pushError("OUTPUT_SCHEMA", "output_schema must include a 'summary' property", "output_schema.properties");
    }
    if (permissionClass === ToolManualPermissionClassValues.PAYMENT) {
      if (Array.isArray(required)) {
        if (!required.includes("amount_usd")) {
          pushError("OUTPUT_SCHEMA", "Payment output_schema must require 'amount_usd'", "output_schema.required");
        }
        if (!required.includes("currency")) {
          pushError("OUTPUT_SCHEMA", "Payment output_schema must require 'currency'", "output_schema.required");
        }
      }
      if (isRecord(properties)) {
        if (!("amount_usd" in properties)) {
          pushError("OUTPUT_SCHEMA", "Payment output_schema must include 'amount_usd' in properties", "output_schema.properties");
        }
        if (!("currency" in properties)) {
          pushError("OUTPUT_SCHEMA", "Payment output_schema must include 'currency' in properties", "output_schema.properties");
        }
      }
    }
  }

  return [!issues.some((nextIssue) => nextIssue.severity === "error"), issues];
}
