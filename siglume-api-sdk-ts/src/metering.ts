import { DEFAULT_SIGLUME_API_BASE, SiglumeClient, type SiglumeClientOptions } from "./client";
import { SiglumeAPIError, SiglumeClientError, SiglumeNotFoundError } from "./errors";
import type { CursorPage, EnvelopeMeta, UsageEventRecord } from "./types";
import { isRecord, parseRetryAfter, sleep, stringOrNull, toJsonable, toRecord } from "./utils";

type FetchLike = typeof fetch;
type RequestOptions = {
  params?: Record<string, string | number | boolean | undefined | null>;
  json_body?: Record<string, unknown>;
};
type RequestMetaTuple = [Record<string, unknown>, EnvelopeMeta];

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_BATCH_SIZE = 1000;
const INTEGER_RE = /^-?\d+$/;

export interface UsageRecord {
  capability_key: string;
  dimension: string;
  units: number;
  external_id: string;
  occurred_at_iso: string;
  agent_id?: string;
}

export interface MeterRecordResult {
  accepted: boolean;
  external_id: string;
  server_id?: string | null;
  replayed: boolean;
  capability_key?: string | null;
  agent_id?: string | null;
  period_key?: string | null;
  raw: Record<string, unknown>;
}

export interface MeteringInvoiceLinePreview {
  price_model: string;
  billable_units: number;
  unit_amount_minor: number;
  subtotal_minor: number;
  currency: string;
}

export interface MeteringSimulationResult {
  experimental: boolean;
  usage_record: UsageRecord;
  invoice_line_preview: MeteringInvoiceLinePreview | null;
}

export type MeterClientOptions = SiglumeClientOptions;

/**
 * Experimental analytics / pre-billing wrapper for usage-event ingest.
 */
export class MeterClient {
  readonly experimental = true;
  private readonly client: SiglumeClient;
  private readonly api_key: string;
  private readonly base_url: string;
  private readonly timeout_ms: number;
  private readonly max_retries: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: MeterClientOptions) {
    this.client = new SiglumeClient(options);
    this.api_key = options.api_key;
    this.base_url = (options.base_url ?? DEFAULT_SIGLUME_API_BASE).replace(/\/+$/, "");
    this.timeout_ms = Math.max(1, options.timeout_ms ?? 15_000);
    this.max_retries = Math.max(1, Math.trunc(options.max_retries ?? 3));
    this.fetchImpl = options.fetch ?? fetch;
  }

  close(): void {
    this.client.close();
  }

  async record(record: UsageRecord): Promise<MeterRecordResult> {
    const [result] = await this.record_batch([record]);
    if (!result) {
      throw new SiglumeClientError("Siglume usage metering response did not include any results.");
    }
    return result;
  }

  async record_batch(records: UsageRecord[]): Promise<MeterRecordResult[]> {
    const normalized = records.map((record) => normalizeUsageRecord(record));
    if (normalized.length === 0) {
      return [];
    }

    const results: MeterRecordResult[] = [];
    for (let start = 0; start < normalized.length; start += MAX_BATCH_SIZE) {
      const chunk = normalized.slice(start, start + MAX_BATCH_SIZE);
      const [data] = await this.request("POST", "/market/usage-events", {
        json_body: { events: chunk },
      });
      if (!Array.isArray(data.items)) {
        throw new SiglumeClientError("Siglume usage metering response did not include an items array.");
      }
      for (const item of data.items) {
        if (isRecord(item)) {
          results.push(parseMeterRecordResult(item));
        }
      }
    }
    return results;
  }

  async list_usage_events(options: {
    capability_key?: string;
    agent_id?: string;
    outcome?: string;
    environment?: string;
    period_key?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<CursorPage<UsageEventRecord>> {
    return this.client.get_usage(options);
  }

  private async request(method: string, path: string, options: RequestOptions = {}): Promise<RequestMetaTuple> {
    const url = buildUrl(this.base_url, path, options.params);
    const headers = new Headers({
      Authorization: `Bearer ${this.api_key}`,
      Accept: "application/json",
      "User-Agent": "siglume-api-sdk-ts/0.5.0",
    });
    let body: string | undefined;
    if (options.json_body) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(toJsonable(options.json_body));
    }

    for (let attempt = 0; attempt < this.max_retries; attempt += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.timeout_ms);
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timeoutHandle);
        const text = response.status === 204 ? "" : await response.text();
        const parsed = safeParseJson(text);
        const envelope = isRecord(parsed) ? parsed : {};
        const data = isRecord(envelope.data) ? envelope.data : isRecord(parsed) ? parsed : {};
        const meta: EnvelopeMeta = isRecord(envelope.meta)
          ? {
              request_id: stringOrNull(envelope.meta.request_id),
              trace_id: stringOrNull(envelope.meta.trace_id),
            }
          : {
              request_id: stringOrNull(response.headers.get("x-request-id")),
              trace_id: stringOrNull(response.headers.get("x-trace-id")),
            };
        if (response.ok) {
          return [data, meta];
        }
        if (RETRYABLE_STATUS_CODES.has(response.status) && attempt + 1 < this.max_retries) {
          await sleep(parseRetryAfter(response.headers.get("Retry-After")) ?? (250 * (2 ** attempt)));
          continue;
        }
        const errorBlock = isRecord(envelope.error) ? envelope.error : {};
        const message = String(
          errorBlock.message ??
            (isRecord(parsed) ? parsed.message : undefined) ??
            response.statusText ??
            "Siglume API request failed.",
        );
        const errorCode = stringOrNull(errorBlock.code) ?? undefined;
        if (response.status === 404) {
          throw new SiglumeNotFoundError(message);
        }
        throw new SiglumeAPIError(message, {
          status_code: response.status,
          error_code: errorCode,
          trace_id: meta.trace_id ?? undefined,
          request_id: meta.request_id ?? undefined,
          details: toRecord(errorBlock.details),
          response_body: parsed,
        });
      } catch (error) {
        clearTimeout(timeoutHandle);
        if (error instanceof SiglumeAPIError || error instanceof SiglumeNotFoundError) {
          throw error;
        }
        if (attempt + 1 < this.max_retries) {
          await sleep(250 * (2 ** attempt));
          continue;
        }
        if (error instanceof Error) {
          throw new SiglumeClientError(error.message);
        }
        throw new SiglumeClientError("Siglume request failed.");
      }
    }
    throw new SiglumeClientError("Siglume request failed after retries.");
  }
}

export function normalizeUsageRecord(record: UsageRecord): UsageRecord {
  const capability_key = String(record.capability_key ?? "").trim();
  if (!capability_key) {
    throw new SiglumeClientError("UsageRecord.capability_key is required.");
  }
  const dimension = String(record.dimension ?? "").trim();
  if (!dimension) {
    throw new SiglumeClientError("UsageRecord.dimension is required.");
  }
  const external_id = String(record.external_id ?? "").trim();
  if (!external_id) {
    throw new SiglumeClientError("UsageRecord.external_id is required.");
  }
  const occurred_at_iso = normalizeRfc3339(record.occurred_at_iso);
  const units = coerceNonNegativeInteger(record.units, "UsageRecord.units");
  const agent_id = stringOrNull(record.agent_id) ?? undefined;
  return {
    capability_key,
    dimension,
    units,
    external_id,
    occurred_at_iso,
    ...(agent_id ? { agent_id } : {}),
  };
}

function parseMeterRecordResult(data: Record<string, unknown>): MeterRecordResult {
  return {
    accepted: Boolean(data.accepted ?? false),
    external_id: String(data.external_id ?? data.idempotency_key ?? ""),
    server_id: stringOrNull(data.server_id ?? data.usage_event_id ?? data.id),
    replayed: Boolean(data.replayed ?? false),
    capability_key: stringOrNull(data.capability_key),
    agent_id: stringOrNull(data.agent_id),
    period_key: stringOrNull(data.period_key),
    raw: { ...data },
  };
}

function coerceNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value < 0) {
      throw new SiglumeClientError(`${fieldName} must be a non-negative integer.`);
    }
    return value;
  }
  if (typeof value === "string" && INTEGER_RE.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (parsed < 0) {
      throw new SiglumeClientError(`${fieldName} must be a non-negative integer.`);
    }
    return parsed;
  }
  throw new SiglumeClientError(`${fieldName} must be a non-negative integer.`);
}

function normalizeRfc3339(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new SiglumeClientError("UsageRecord.occurred_at_iso is required.");
  }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed) || !(/[zZ]$|[+-]\d{2}:\d{2}$/.test(text))) {
    throw new SiglumeClientError("UsageRecord.occurred_at_iso must be RFC3339 with timezone.");
  }
  return text;
}

function buildUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): string {
  const normalizedPath = `/${path.replace(/^\/+/, "")}`;
  const url = new URL(baseUrl + normalizedPath);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function safeParseJson(text: string): unknown {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}
