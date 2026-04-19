import type { JsonValue } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

export function toJsonable(value: unknown): JsonValue | Record<string, unknown> | unknown[] {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonable(item));
  }
  if (isRecord(value)) {
    const toDict = value.to_dict;
    if (typeof toDict === "function") {
      return toJsonable(toDict.call(value));
    }
    const toJson = value.toJSON;
    if (typeof toJson === "function") {
      return toJsonable(toJson.call(value));
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith("_"))
        .map(([key, item]) => [key, toJsonable(item)]),
    );
  }
  return String(value);
}

export function coerceMapping(value: unknown, label: string): Record<string, unknown> {
  const payload = toJsonable(value);
  if (!isRecord(payload)) {
    throw new TypeError(`${label} must be a mapping-like object`);
  }
  return payload;
}

export function renderJson(value: unknown): string {
  return JSON.stringify(toJsonable(value), null, 2);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1000 : null;
}

export function camelCaseFromCapabilityKey(capabilityKey: string): string {
  const words = capabilityKey
    .replaceAll("_", "-")
    .split("-")
    .map((item) => item.trim())
    .filter(Boolean);
  if (words.length === 0) {
    return "GeneratedRegistrationApp";
  }
  return `${words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join("")}App`;
}

export function buildDefaultI18n(manifestPayload: Record<string, unknown>): Record<string, string> {
  const job = String(manifestPayload.job_to_be_done ?? "").trim();
  const shortDescription = String(
    manifestPayload.short_description ?? manifestPayload.job_to_be_done ?? manifestPayload.name ?? "",
  ).trim();
  return {
    job_to_be_done_en: job,
    job_to_be_done_ja: job,
    short_description_en: shortDescription,
    short_description_ja: shortDescription,
  };
}

export function buildRegistrationStubSource(
  manifestPayload: Record<string, unknown>,
  toolManualPayload: Record<string, unknown>,
): string {
  const capabilityKey = String(manifestPayload.capability_key ?? "generated-registration");
  const jobToBeDone = String(
    manifestPayload.job_to_be_done ??
      toolManualPayload.job_to_be_done ??
      "Register this API listing on Siglume.",
  );
  const name = String(manifestPayload.name ?? capabilityKey.replaceAll("-", " "));
  const className = camelCaseFromCapabilityKey(capabilityKey);
  return [
    'import { AppAdapter } from "@siglume/api-sdk";',
    "",
    `export default class ${className} extends AppAdapter {`,
    "  manifest() {",
    `    return ${JSON.stringify(
      {
        capability_key: capabilityKey,
        name,
        job_to_be_done: jobToBeDone,
      },
      null,
      2,
    ).replaceAll("\n", "\n    ")};`,
    "  }",
    "",
    "  async execute(ctx) {",
    "    throw new Error(\"Registration bootstrap source is metadata-only.\");",
    "  }",
    "}",
    "",
  ].join("\n");
}
