import type { AppManifest, JsonValue, ToolManual } from "./types";
import { coerceMapping, isRecord, toJsonable } from "./utils";

const MANIFEST_PERMISSION_ORDER: Record<string, number> = {
  "read-only": 0,
  recommendation: 0,
  action: 1,
  payment: 2,
};
const TOOL_MANUAL_PERMISSION_ORDER: Record<string, number> = {
  read_only: 0,
  action: 1,
  payment: 2,
};
const SPECIAL_MANIFEST_KEYS = new Set([
  "version",
  "name",
  "short_description",
  "permission_class",
  "price_model",
  "currency",
  "jurisdiction",
]);
const SPECIAL_TOOL_MANUAL_KEYS = new Set([
  "input_schema",
  "output_schema",
  "permission_class",
  "settlement_mode",
  "currency",
  "side_effect_summary",
  "jurisdiction",
  "trigger_conditions",
  "do_not_use_when",
  "approval_summary_template",
]);

export const ChangeLevel = {
  BREAKING: "breaking",
  WARNING: "warning",
  INFO: "info",
} as const;
export type ChangeLevel = (typeof ChangeLevel)[keyof typeof ChangeLevel];

export const BreakingChange = ChangeLevel.BREAKING;

export interface Change {
  level: ChangeLevel;
  path: string;
  old: JsonValue | Record<string, unknown> | unknown[] | null;
  new: JsonValue | Record<string, unknown> | unknown[] | null;
  message: string;
  is_breaking: boolean;
}

export function diff_manifest(options: {
  old: AppManifest | Record<string, unknown>;
  new: AppManifest | Record<string, unknown>;
}): Change[] {
  const oldPayload = normalizeManifest(options.old);
  const newPayload = normalizeManifest(options.new);
  const changes: Change[] = [];
  const emittedKeys = new Set<string>();

  appendPermissionClassChange(
    changes,
    emittedKeys,
    "permission_class",
    oldPayload.permission_class,
    newPayload.permission_class,
    MANIFEST_PERMISSION_ORDER,
    "Manifest permission_class escalated; existing callers may now require stronger approval.",
    "Manifest permission_class downgraded.",
  );
  appendValueChange(
    changes,
    emittedKeys,
    ChangeLevel.BREAKING,
    "price_model",
    oldPayload.price_model,
    newPayload.price_model,
    "Manifest price_model changed; billing compatibility may break existing installs.",
  );
  appendValueChange(
    changes,
    emittedKeys,
    ChangeLevel.BREAKING,
    "currency",
    oldPayload.currency,
    newPayload.currency,
    "Manifest currency changed.",
  );
  appendValueChange(
    changes,
    emittedKeys,
    ChangeLevel.BREAKING,
    "jurisdiction",
    oldPayload.jurisdiction,
    newPayload.jurisdiction,
    "Manifest jurisdiction changed.",
  );
  appendValueChange(
    changes,
    emittedKeys,
    ChangeLevel.INFO,
    "version",
    oldPayload.version,
    newPayload.version,
    "Manifest version changed.",
  );
  appendValueChange(
    changes,
    emittedKeys,
    ChangeLevel.INFO,
    "name",
    oldPayload.name,
    newPayload.name,
    "Manifest display name changed.",
  );
  appendValueChange(
    changes,
    emittedKeys,
    ChangeLevel.INFO,
    "short_description",
    oldPayload.short_description,
    newPayload.short_description,
    "Manifest short_description changed.",
  );

  for (const key of [...new Set([...Object.keys(oldPayload), ...Object.keys(newPayload)])].sort()) {
    if (emittedKeys.has(key) || SPECIAL_MANIFEST_KEYS.has(key)) {
      continue;
    }
    const oldValue = oldPayload[key];
    const newValue = newPayload[key];
    if (valuesDiffer(oldValue, newValue)) {
      changes.push(createChange(ChangeLevel.INFO, key, oldValue, newValue, `Manifest field '${key}' changed.`));
    }
  }

  return sortChanges(changes);
}

export function diff_tool_manual(options: {
  old: ToolManual | Record<string, unknown>;
  new: ToolManual | Record<string, unknown>;
}): Change[] {
  const oldPayload = normalizeToolManual(options.old);
  const newPayload = normalizeToolManual(options.new);
  const changes: Change[] = [];
  const emittedKeys = new Set<string>();

  const oldRequired = stringList(toRecordValue(oldPayload.input_schema).required);
  const newRequired = stringList(toRecordValue(newPayload.input_schema).required);
  const addedRequired = [...new Set(newRequired.filter((fieldName) => !oldRequired.includes(fieldName)))].sort();
  const removedRequired = [...new Set(oldRequired.filter((fieldName) => !newRequired.includes(fieldName)))].sort();
  if (addedRequired.length > 0) {
    changes.push(
      createChange(
        ChangeLevel.BREAKING,
        "input_schema.required",
        oldRequired,
        newRequired,
        `input_schema.required added new required fields: ${addedRequired.join(", ")}.`,
      ),
    );
    emittedKeys.add("input_schema");
  }
  if (removedRequired.length > 0) {
    changes.push(
      createChange(
        ChangeLevel.INFO,
        "input_schema.required",
        oldRequired,
        newRequired,
        `input_schema.required removed fields: ${removedRequired.join(", ")}.`,
      ),
    );
    emittedKeys.add("input_schema");
  }

  appendPermissionClassChange(
    changes,
    emittedKeys,
    "permission_class",
    oldPayload.permission_class,
    newPayload.permission_class,
    TOOL_MANUAL_PERMISSION_ORDER,
    "ToolManual permission_class escalated; existing callers may now require stronger approval.",
    "ToolManual permission_class downgraded.",
  );
  appendValueChange(
    changes,
    emittedKeys,
    ChangeLevel.BREAKING,
    "settlement_mode",
    oldPayload.settlement_mode,
    newPayload.settlement_mode,
    "ToolManual settlement_mode changed.",
  );
  appendValueChange(
    changes,
    emittedKeys,
    ChangeLevel.BREAKING,
    "currency",
    oldPayload.currency,
    newPayload.currency,
    "ToolManual currency changed.",
  );
  if (valuesDiffer(oldPayload.side_effect_summary, newPayload.side_effect_summary)) {
    const oldSideEffect = oldPayload.side_effect_summary ?? null;
    const newSideEffect = newPayload.side_effect_summary ?? null;
    const level =
      isBlank(oldSideEffect) && !isBlank(newSideEffect)
        ? ChangeLevel.BREAKING
        : !isBlank(oldSideEffect) && isBlank(newSideEffect)
          ? ChangeLevel.INFO
          : ChangeLevel.BREAKING;
    const message =
      isBlank(oldSideEffect) && !isBlank(newSideEffect)
        ? "ToolManual side_effect_summary was added, introducing a new side-effect contract."
        : !isBlank(oldSideEffect) && isBlank(newSideEffect)
          ? "ToolManual side_effect_summary was removed."
          : "ToolManual side_effect_summary changed.";
    changes.push(
      createChange(
        level,
        "side_effect_summary",
        oldSideEffect,
        newSideEffect,
        message,
      ),
    );
    emittedKeys.add("side_effect_summary");
  }
  appendValueChange(
    changes,
    emittedKeys,
    ChangeLevel.BREAKING,
    "jurisdiction",
    oldPayload.jurisdiction,
    newPayload.jurisdiction,
    "ToolManual jurisdiction changed.",
  );

  const oldOutputProperties = toRecordValue(toRecordValue(oldPayload.output_schema).properties);
  const newOutputProperties = toRecordValue(toRecordValue(newPayload.output_schema).properties);
  const oldOutputFields = Object.keys(oldOutputProperties).sort();
  const newOutputFields = Object.keys(newOutputProperties).sort();
  const addedOutputFields = [...new Set(newOutputFields.filter((fieldName) => !oldOutputFields.includes(fieldName)))].sort();
  const removedOutputFields = [...new Set(oldOutputFields.filter((fieldName) => !newOutputFields.includes(fieldName)))].sort();
  const changedOutputFields = [...new Set(
    oldOutputFields
      .filter((fieldName) => newOutputFields.includes(fieldName))
      .filter((fieldName) => valuesDiffer(oldOutputProperties[fieldName], newOutputProperties[fieldName])),
  )].sort();
  if (addedOutputFields.length > 0) {
    changes.push(
      createChange(
        ChangeLevel.WARNING,
        "output_schema.properties",
        oldOutputFields,
        newOutputFields,
        `output_schema added fields: ${addedOutputFields.join(", ")}.`,
      ),
    );
    emittedKeys.add("output_schema");
  }
  if (removedOutputFields.length > 0) {
    changes.push(
      createChange(
        ChangeLevel.BREAKING,
        "output_schema.properties",
        oldOutputFields,
        newOutputFields,
        `output_schema removed fields: ${removedOutputFields.join(", ")}.`,
      ),
    );
    emittedKeys.add("output_schema");
  }
  if (changedOutputFields.length > 0) {
    changes.push(
      createChange(
        ChangeLevel.WARNING,
        "output_schema.properties",
        oldOutputFields,
        newOutputFields,
        `output_schema changed field definitions: ${changedOutputFields.join(", ")}.`,
      ),
    );
    emittedKeys.add("output_schema");
  }

  appendLargeListChange(
    changes,
    emittedKeys,
    "trigger_conditions",
    stringList(oldPayload.trigger_conditions),
    stringList(newPayload.trigger_conditions),
    "trigger_conditions changed substantially.",
    "trigger_conditions changed.",
  );
  appendLargeListChange(
    changes,
    emittedKeys,
    "do_not_use_when",
    stringList(oldPayload.do_not_use_when),
    stringList(newPayload.do_not_use_when),
    "do_not_use_when changed substantially.",
    "do_not_use_when changed.",
  );
  appendValueChange(
    changes,
    emittedKeys,
    ChangeLevel.WARNING,
    "approval_summary_template",
    oldPayload.approval_summary_template,
    newPayload.approval_summary_template,
    "approval_summary_template changed.",
  );

  for (const key of [...new Set([...Object.keys(oldPayload), ...Object.keys(newPayload)])].sort()) {
    if (emittedKeys.has(key) || SPECIAL_TOOL_MANUAL_KEYS.has(key)) {
      continue;
    }
    const oldValue = oldPayload[key];
    const newValue = newPayload[key];
    if (valuesDiffer(oldValue, newValue)) {
      changes.push(createChange(ChangeLevel.INFO, key, oldValue, newValue, `ToolManual field '${key}' changed.`));
    }
  }

  return sortChanges(changes);
}

function appendLargeListChange(
  changes: Change[],
  emittedKeys: Set<string>,
  key: string,
  oldItems: string[],
  newItems: string[],
  warningMessage: string,
  infoMessage: string,
): void {
  if (sameArray(oldItems, newItems)) {
    return;
  }
  const level = isMajorListChange(oldItems, newItems) ? ChangeLevel.WARNING : ChangeLevel.INFO;
  changes.push(createChange(level, key, oldItems, newItems, level === ChangeLevel.WARNING ? warningMessage : infoMessage));
  emittedKeys.add(key);
}

function appendPermissionClassChange(
  changes: Change[],
  emittedKeys: Set<string>,
  key: string,
  oldValue: unknown,
  newValue: unknown,
  rankMap: Record<string, number>,
  escalateMessage: string,
  downgradeMessage: string,
): void {
  if (!valuesDiffer(oldValue, newValue)) {
    return;
  }
  const oldRank = typeof oldValue === "string" ? rankMap[oldValue] : undefined;
  const newRank = typeof newValue === "string" ? rankMap[newValue] : undefined;
  const level =
    oldRank !== undefined && newRank !== undefined && newRank > oldRank
      ? ChangeLevel.BREAKING
      : ChangeLevel.INFO;
  const message =
    oldRank !== undefined && newRank !== undefined && newRank > oldRank
      ? escalateMessage
      : oldRank !== undefined && newRank !== undefined && newRank < oldRank
        ? downgradeMessage
        : `${key} changed.`;
  changes.push(createChange(level, key, oldValue, newValue, message));
  emittedKeys.add(key);
}

function appendValueChange(
  changes: Change[],
  emittedKeys: Set<string>,
  level: ChangeLevel,
  key: string,
  oldValue: unknown,
  newValue: unknown,
  message: string,
): void {
  if (valuesDiffer(oldValue, newValue)) {
    changes.push(createChange(level, key, oldValue, newValue, message));
    emittedKeys.add(key);
  }
}

function normalizeManifest(value: AppManifest | Record<string, unknown>): Record<string, unknown> {
  const payload = coerceMapping(value, "manifest");
  return {
    ...payload,
    price_model: payload.price_model ?? "free",
    currency: payload.currency ?? "USD",
    // AppManifest defaults permission_class to "read-only" (hyphen form,
    // PermissionClass.READ_ONLY). Without this default, a legacy / minimal
    // manifest without permission_class compared against an upgraded one
    // would leave oldRank undefined and appendPermissionClassChange would
    // downgrade the permission escalation from BREAKING to INFO — letting
    // the diff CLI exit 0 on a genuinely breaking change.
    permission_class: payload.permission_class ?? "read-only",
  };
}

function normalizeToolManual(value: ToolManual | Record<string, unknown>): Record<string, unknown> {
  const payload = coerceMapping(value, "tool manual");
  return {
    ...payload,
    permission_class: payload.permission_class ?? "read_only",
    requires_connected_accounts: stringList(payload.requires_connected_accounts),
  };
}

function createChange(
  level: ChangeLevel,
  path: string,
  oldValue: unknown,
  newValue: unknown,
  message: string,
): Change {
  return {
    level,
    path,
    old: normalizeForChange(oldValue),
    new: normalizeForChange(newValue),
    message,
    is_breaking: level === ChangeLevel.BREAKING,
  };
}

function normalizeForChange(value: unknown): JsonValue | Record<string, unknown> | unknown[] | null {
  if (value === undefined) {
    return null;
  }
  const normalized = toJsonable(value);
  if (normalized === undefined) {
    return null;
  }
  return normalized as JsonValue | Record<string, unknown> | unknown[] | null;
}

function toRecordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function valuesDiffer(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(normalizeForChange(left))) !== JSON.stringify(stableValue(normalizeForChange(right)));
}

function sameArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

function isMajorListChange(oldItems: string[], newItems: string[]): boolean {
  const oldSet = new Set(oldItems.map((item) => item.trim().toLowerCase()).filter(Boolean));
  const newSet = new Set(newItems.map((item) => item.trim().toLowerCase()).filter(Boolean));
  if (oldSet.size === newSet.size && [...oldSet].every((item) => newSet.has(item))) {
    return false;
  }
  if (oldSet.size === 0 || newSet.size === 0) {
    return true;
  }
  const union = new Set([...oldSet, ...newSet]);
  const intersection = [...oldSet].filter((item) => newSet.has(item));
  const similarity = intersection.length / union.size;
  return similarity < 0.5 || (similarity === 0.5 && Math.abs(oldSet.size - newSet.size) >= 1);
}

function sortChanges(changes: Change[]): Change[] {
  const priority: Record<ChangeLevel, number> = {
    [ChangeLevel.BREAKING]: 0,
    [ChangeLevel.WARNING]: 1,
    [ChangeLevel.INFO]: 2,
  };
  return [...changes].sort((left, right) => {
    const levelDelta = priority[left.level] - priority[right.level];
    return levelDelta !== 0 ? levelDelta : left.path.localeCompare(right.path);
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}
