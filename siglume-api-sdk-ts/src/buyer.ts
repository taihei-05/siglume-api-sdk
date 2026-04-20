import { DEFAULT_SIGLUME_API_BASE, SiglumeClient, type SiglumeClientOptions } from "./client";
import { SiglumeAPIError, SiglumeClientError, SiglumeNotFoundError } from "./errors";
import type {
  AccessGrantRecord,
  AppListingRecord,
  CapabilityBindingRecord,
  EnvelopeMeta,
  ExecutionResult,
  ToolManual,
} from "./types";
import { isRecord, parseRetryAfter, sleep, stringOrNull, toJsonable, toRecord } from "./utils";

type FetchLike = typeof fetch;

type RequestOptions = {
  params?: Record<string, string | number | boolean | undefined | null>;
  json_body?: Record<string, unknown>;
};

type RequestMetaTuple = [Record<string, unknown>, EnvelopeMeta];
type SearchableField = "capability_key" | "name" | "description" | "short_description" | "job_to_be_done" | "category";

const SEARCH_FIELD_WEIGHTS: Array<[SearchableField, number]> = [
  ["capability_key", 40],
  ["name", 36],
  ["description", 30],
  ["short_description", 24],
  ["job_to_be_done", 20],
  ["category", 8],
];
const QUERY_TOKEN_RE = /[a-z0-9]+/g;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const EXPERIMENTAL_EXECUTE_PATH = "/internal/market/capability/execute";

export class SiglumeExperimentalWarning extends Error {
  name = "SiglumeExperimentalWarning";
}

export class SiglumeExperimentalError extends SiglumeClientError {}

export interface CapabilityListing extends AppListingRecord {
  description?: string | null;
  tool_manual: Record<string, unknown>;
  score: number;
  snippet?: string | null;
  match_fields: string[];
  experimental: boolean;
}

export interface Subscription {
  access_grant_id: string;
  capability_listing_id: string;
  capability_key: string;
  purchase_status: string;
  grant_status?: string | null;
  agent_id?: string | null;
  binding_id?: string | null;
  binding_status?: string | null;
  access_grant?: AccessGrantRecord | null;
  binding?: CapabilityBindingRecord | null;
  trace_id?: string | null;
  request_id?: string | null;
  raw: Record<string, unknown>;
}

export interface SiglumeBuyerClientOptions extends SiglumeClientOptions {
  default_agent_id?: string;
  allow_internal_execute?: boolean;
  experimental_execute_path?: string;
}

export class SiglumeBuyerClient {
  private readonly client: SiglumeClient;
  readonly api_key: string;
  readonly base_url: string;
  readonly timeout_ms: number;
  readonly max_retries: number;
  readonly default_agent_id?: string;
  readonly allow_internal_execute: boolean;
  readonly experimental_execute_path: string;
  private readonly fetchImpl: FetchLike;
  private readonly warnedFeatures = new Set<string>();

  constructor(options: SiglumeBuyerClientOptions) {
    this.client = new SiglumeClient(options);
    this.api_key = options.api_key;
    this.base_url = (options.base_url ?? DEFAULT_SIGLUME_API_BASE).replace(/\/+$/, "");
    this.timeout_ms = Math.max(1, options.timeout_ms ?? 15_000);
    this.max_retries = Math.max(1, Math.trunc(options.max_retries ?? 3));
    this.fetchImpl = options.fetch ?? fetch;
    this.default_agent_id = options.default_agent_id ?? stringOrNull(globalThis.process?.env?.SIGLUME_AGENT_ID) ?? undefined;
    this.allow_internal_execute = Boolean(options.allow_internal_execute ?? false);
    this.experimental_execute_path = `/${(options.experimental_execute_path ?? EXPERIMENTAL_EXECUTE_PATH).replace(/^\/+/, "")}`;
  }

  close(): void {
    this.client.close();
  }

  async search_capabilities(options: {
    query: string;
    permission_class?: string;
    limit?: number;
    status?: string;
  }): Promise<CapabilityListing[]> {
    const query = String(options.query ?? "").trim();
    if (!query) {
      throw new SiglumeClientError("search_capabilities requires a non-empty query.");
    }
    this.warnExperimental(
      "search",
      "SiglumeBuyerClient.search_capabilities() uses local substring matching because the platform search API is not public yet.",
    );
    const permission = normalizePermission(options.permission_class);
    const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 10), 100));
    const listings = await this.listAllCapabilities({ status: options.status ?? "published" });
    const matches = listings
      .map((listing) => {
        if (permission && normalizePermission(listing.permission_class) !== permission) {
          return null;
        }
        const { score, match_fields, snippet } = scoreListing(listing, query);
        if (score <= 0) {
          return null;
        }
        return createCapabilityListing(listing, { score, match_fields, snippet, experimental: true });
      })
      .filter((listing): listing is CapabilityListing => Boolean(listing))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.name.toLowerCase() !== right.name.toLowerCase()) {
          return left.name.toLowerCase().localeCompare(right.name.toLowerCase());
        }
        return left.capability_key.toLowerCase().localeCompare(right.capability_key.toLowerCase());
      });
    return matches.slice(0, limit);
  }

  async get_listing(capability_key: string): Promise<CapabilityListing> {
    const lookup = String(capability_key ?? "").trim();
    if (!lookup) {
      throw new SiglumeClientError("capability_key is required.");
    }
    const listings = await this.listAllCapabilities({ status: "published" });
    const exact = listings.find((listing) => listing.capability_key.toLowerCase() === lookup.toLowerCase());
    if (exact) {
      this.warnExperimental(
        "tool-manual",
        "Buyer listings currently synthesize a minimal tool_manual because the public listing surface does not expose the full ToolManual payload yet.",
      );
      return createCapabilityListing(exact, { experimental: true });
    }
    const byListingId = await this.client.get_listing(lookup);
    this.warnExperimental(
      "tool-manual",
      "Buyer listings currently synthesize a minimal tool_manual because the public listing surface does not expose the full ToolManual payload yet.",
    );
    return createCapabilityListing(byListingId, { experimental: true });
  }

  async subscribe(options: {
    capability_key: string;
    agent_id?: string;
    bind_agent?: boolean;
    binding_status?: string;
    buyer_currency?: string;
    buyer_token?: string;
  }): Promise<Subscription> {
    const listing = await this.get_listing(options.capability_key);
    const payload: Record<string, unknown> = {};
    if (options.buyer_currency) {
      payload.buyer_currency = options.buyer_currency;
    }
    if (options.buyer_token) {
      payload.buyer_token = options.buyer_token;
    }
    const [data, meta] = await this.request("POST", `/market/capabilities/${listing.listing_id}/purchase`, {
      json_body: payload,
    });
    const accessGrant = parseAccessGrant(toRecord(data.access_grant));
    if (!accessGrant.access_grant_id) {
      const purchaseStatus = String(data.purchase_status ?? "unknown");
      throw new SiglumeExperimentalError(
        `Purchase completed with status '${purchaseStatus}' but did not return an access grant. Buyer-side subscription flows are still experimental on the public API.`,
      );
    }
    const targetAgentId = resolveAgentId(options.agent_id, this.default_agent_id);
    const shouldBind = options.bind_agent ?? Boolean(targetAgentId);
    let binding: CapabilityBindingRecord | null = null;
    let trace_id = meta.trace_id ?? undefined;
    let request_id = meta.request_id ?? undefined;
    if (shouldBind) {
      if (!targetAgentId) {
        throw new SiglumeClientError("agent_id is required to bind a purchased access grant.");
      }
      const grantBinding = await this.client.bind_agent_to_grant(accessGrant.access_grant_id, {
        agent_id: targetAgentId,
        binding_status: options.binding_status ?? "active",
      });
      binding = grantBinding.binding;
      trace_id = grantBinding.trace_id ?? trace_id;
      request_id = grantBinding.request_id ?? request_id;
    }
    return {
      access_grant_id: accessGrant.access_grant_id,
      capability_listing_id: accessGrant.capability_listing_id || listing.listing_id,
      capability_key: listing.capability_key,
      purchase_status: String(data.purchase_status ?? "created"),
      grant_status: accessGrant.grant_status ?? null,
      agent_id: binding?.agent_id ?? targetAgentId ?? null,
      binding_id: binding?.binding_id ?? null,
      binding_status: binding?.binding_status ?? null,
      access_grant: accessGrant,
      binding,
      trace_id,
      request_id,
      raw: {
        purchase: { ...data },
        binding: binding ? { ...binding.raw } : null,
      },
    };
  }

  async invoke(options: {
    capability_key: string;
    input: Record<string, unknown>;
    idempotency_key?: string;
    dry_run?: boolean;
    agent_id?: string;
    task_type?: string;
    execution_kind?: string;
    source_type?: string;
    environment?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ExecutionResult> {
    if (!this.allow_internal_execute) {
      throw new SiglumeExperimentalError(
        "SiglumeBuyerClient.invoke() requires allow_internal_execute=true because the public buyer execute endpoint is not available yet.",
      );
    }
    this.warnExperimental(
      "invoke",
      "SiglumeBuyerClient.invoke() uses an internal execution endpoint until a public buyer invoke API is available.",
    );
    const agentId = resolveAgentId(options.agent_id, this.default_agent_id);
    if (!agentId) {
      throw new SiglumeClientError("agent_id is required for invoke(); pass it explicitly or set SIGLUME_AGENT_ID.");
    }
    const payload: Record<string, unknown> = {
      agent_id: agentId,
      capability_key: options.capability_key,
      task_type: options.task_type ?? "default",
      arguments: toRecord(options.input),
      dry_run: Boolean(options.dry_run ?? false),
      environment: options.environment ?? "live",
      metadata: toRecord(options.metadata),
    };
    if (options.execution_kind) {
      payload.execution_kind = options.execution_kind;
    } else if (options.dry_run) {
      payload.execution_kind = "dry_run";
    }
    if (options.idempotency_key) {
      payload.idempotency_key = options.idempotency_key;
    }
    if (options.source_type) {
      payload.source_type = options.source_type;
    }
    const [data] = await this.request("POST", this.experimental_execute_path, { json_body: payload });
    return buildExecutionResult(data, payload);
  }

  private async listAllCapabilities(options: { status: string }): Promise<AppListingRecord[]> {
    const page = await this.client.list_capabilities({ status: options.status, limit: 100 });
    return typeof page.all_items === "function" ? await page.all_items() : page.items;
  }

  private warnExperimental(key: string, message: string): void {
    if (this.warnedFeatures.has(key)) {
      return;
    }
    this.warnedFeatures.add(key);
    if (typeof process !== "undefined" && typeof process.emitWarning === "function") {
      process.emitWarning(message, { type: "SiglumeExperimentalWarning" });
      return;
    }
    console.warn(message);
  }

  private async request(method: string, path: string, options: RequestOptions = {}): Promise<RequestMetaTuple> {
    const url = buildUrl(this.base_url, path, options.params);
    const headers = new Headers({
      Authorization: `Bearer ${this.api_key}`,
      Accept: "application/json",
      "User-Agent": "siglume-api-sdk-ts/0.6.0",
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

function createCapabilityListing(
  listing: AppListingRecord,
  options: {
    score?: number;
    snippet?: string | null;
    match_fields?: string[];
    experimental?: boolean;
  } = {},
): CapabilityListing {
  return {
    ...listing,
    description: stringOrNull(listing.raw.description),
    tool_manual: buildListingToolManual(listing),
    score: options.score ?? 0,
    snippet: options.snippet ?? null,
    match_fields: options.match_fields ?? [],
    experimental: options.experimental ?? false,
    raw: { ...listing.raw },
  };
}

function normalizePermission(value: string | undefined | null): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  return text ? text.replaceAll("_", "-") : null;
}

function toolManualPermission(value: string | undefined | null): "read_only" | "action" | "payment" {
  const normalized = normalizePermission(value);
  if (normalized === "payment") {
    return "payment";
  }
  if (normalized === "action") {
    return "action";
  }
  return "read_only";
}

function resolveAgentId(explicit: string | undefined, fallback: string | undefined): string | undefined {
  const candidate = stringOrNull(explicit) ?? stringOrNull(fallback);
  return candidate ?? undefined;
}

function scoreListing(listing: AppListingRecord, query: string): {
  score: number;
  match_fields: string[];
  snippet: string | null;
} {
  const normalizedQuery = query.toLowerCase().trim();
  const tokens = normalizedQuery.match(QUERY_TOKEN_RE) ?? [];
  let score = 0;
  let snippet: string | null = null;
  const match_fields: string[] = [];
  for (const [fieldName, weight] of SEARCH_FIELD_WEIGHTS) {
    const text = listingFieldText(listing, fieldName);
    if (!text) {
      continue;
    }
    const lowered = text.toLowerCase();
    let matched = false;
    if (normalizedQuery && lowered.includes(normalizedQuery)) {
      score += weight * 3;
      matched = true;
      if (!snippet) {
        snippet = buildSnippet(text, normalizedQuery);
      }
    } else {
      const tokenHits = tokens.filter((token) => lowered.includes(token)).length;
      if (tokenHits > 0) {
        score += weight * tokenHits;
        matched = true;
        if (!snippet) {
          snippet = buildSnippet(text, tokens[0] ?? normalizedQuery);
        }
      }
    }
    if (matched) {
      match_fields.push(fieldName);
    }
  }
  return { score, match_fields, snippet };
}

function listingFieldText(listing: AppListingRecord, fieldName: SearchableField): string {
  if (fieldName === "description") {
    return String(listing.raw.description ?? "").trim();
  }
  return String(listing[fieldName] ?? "").trim();
}

function buildSnippet(text: string, term: string): string {
  const lowered = text.toLowerCase();
  const index = lowered.indexOf(term.toLowerCase());
  if (index < 0) {
    return text.slice(0, 96).trim();
  }
  const start = Math.max(index - 24, 0);
  const end = Math.min(index + term.length + 56, text.length);
  let excerpt = text.slice(start, end).trim();
  if (start > 0) {
    excerpt = `...${excerpt}`;
  }
  if (end < text.length) {
    excerpt = `${excerpt}...`;
  }
  return excerpt;
}

function buildListingToolManual(listing: AppListingRecord): Record<string, unknown> {
  const raw = { ...listing.raw };
  if (isRecord(raw.tool_manual)) {
    return { ...raw.tool_manual };
  }
  const description =
    stringOrNull(raw.description) ??
    listing.short_description ??
    listing.job_to_be_done ??
    listing.name;
  const permission_class = toolManualPermission(listing.permission_class);
  const input_schema = isRecord(raw.input_schema)
    ? { ...raw.input_schema }
    : {
        type: "object",
        properties: {},
        additionalProperties: true,
      };
  const output_schema = isRecord(raw.output_schema)
    ? { ...raw.output_schema }
    : {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Summary of what the capability returned.",
          },
        },
        required: ["summary"],
        additionalProperties: true,
      };
  const toolManual: Record<string, unknown> = {
    tool_name: listing.capability_key.replaceAll("-", "_") || "siglume_capability",
    job_to_be_done: listing.job_to_be_done ?? description,
    summary_for_model: boundedSummary(listing, description ?? listing.name),
    trigger_conditions: [
      description ? `Use when the owner asks for ${description.toLowerCase()}.` : `Use when the owner requests ${listing.capability_key}.`,
      `Use when the task explicitly matches capability key '${listing.capability_key}'.`,
      `Use when the workflow needs the output of ${listing.name}.`,
    ],
    do_not_use_when: [
      "Do not use when the request needs a different capability or lacks the required input context.",
    ],
    permission_class,
    dry_run_supported: listing.dry_run_supported,
    requires_connected_accounts: Array.isArray(raw.required_connected_accounts)
      ? raw.required_connected_accounts.filter((item): item is string => typeof item === "string")
      : [],
    input_schema,
    output_schema,
    usage_hints: [
      listing.short_description,
      listing.docs_url ? `Read docs at ${listing.docs_url} before relying on provider-specific behavior.` : null,
    ].filter((item): item is string => Boolean(item)),
    result_hints: [
      String(raw.result_summary ?? "Return the provider result as structured JSON with a concise summary."),
    ],
    error_hints: [
      "If the invocation is denied or requires approval, surface the platform reason to the owner.",
    ],
  };
  if ((toolManual.usage_hints as string[]).length === 0) {
    toolManual.usage_hints = [`Invoke ${listing.capability_key} with the fields described in its input schema.`];
  }
  if (permission_class === "action" || permission_class === "payment") {
    toolManual.approval_summary_template = `Review ${listing.name} before approving the external side effect.`;
    toolManual.preview_schema = {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Preview of the action that would be executed after approval.",
        },
      },
      required: ["summary"],
      additionalProperties: true,
    };
    toolManual.idempotency_support = true;
    toolManual.side_effect_summary = String(
      raw.receipt_summary ??
        raw.result_summary ??
        `${listing.name} may perform an external side effect after approval.`,
    );
  }
  if (permission_class === "payment") {
    toolManual.quote_schema = {
      type: "object",
      properties: {
        amount_minor: { type: "integer", description: "Quoted amount in minor units." },
        currency: { type: "string", description: "Currency code for the quoted amount." },
      },
      required: ["amount_minor", "currency"],
      additionalProperties: true,
    };
    toolManual.currency = listing.currency || "USD";
    toolManual.settlement_mode = String(raw.settlement_mode ?? "stripe_checkout");
    toolManual.refund_or_cancellation_note = String(
      raw.refund_or_cancellation_note ??
        "Refunds and cancellations follow the seller policy shown on the listing.",
    );
    toolManual.jurisdiction = String(raw.jurisdiction ?? "US");
  }
  return toolManual;
}

function boundedSummary(listing: AppListingRecord, description: string): string {
  const summary = description.replace(/\s+/g, " ").trim();
  if (summary.length >= 10) {
    return summary.slice(0, 300);
  }
  return `${listing.name} capability for ${listing.capability_key}.`.slice(0, 300);
}

function parseAccessGrant(data: Record<string, unknown>): AccessGrantRecord {
  return {
    access_grant_id: String(data.access_grant_id ?? data.id ?? ""),
    capability_listing_id: String(data.capability_listing_id ?? ""),
    grant_status: String(data.grant_status ?? ""),
    billing_model: stringOrNull(data.billing_model),
    agent_id: stringOrNull(data.agent_id),
    starts_at: stringOrNull(data.starts_at),
    ends_at: stringOrNull(data.ends_at),
    bindings: Array.isArray(data.bindings)
      ? data.bindings.filter((item): item is Record<string, unknown> => isRecord(item)).map((item) => ({ ...item }))
      : [],
    metadata: toRecord(data.metadata),
    raw: { ...data },
  };
}

function buildExecutionResult(data: Record<string, unknown>, payload: Record<string, unknown>): ExecutionResult {
  const accepted = Boolean(data.accepted);
  const reason = String(data.reason ?? "");
  const reason_code = stringOrNull(data.reason_code) ?? undefined;
  const usage_event = toRecord(data.usage_event);
  const receipt = toRecord(data.receipt);
  const execution_kind = String(receipt.execution_kind ?? payload.execution_kind ?? "action") as ExecutionResult["execution_kind"];
  const amount_minor = Number(receipt.amount_minor ?? usage_event.amount_minor ?? 0);
  const currency = String(receipt.currency ?? usage_event.currency ?? "USD");
  const units_consumed = Number(usage_event.units_consumed ?? 1);
  if (accepted) {
    return {
      success: true,
      output: toRecord(data.result),
      execution_kind,
      units_consumed,
      amount_minor,
      currency,
      provider_status: "ok",
      fallback_applied: Boolean(receipt.fallback_applied ?? false),
      receipt_summary: receipt,
    };
  }
  const approval_request = toRecord(data.approval_request);
  const approval_explanation = toRecord(data.approval_explanation);
  const needs_approval = reason_code === "APPROVAL_REQUIRED" || Object.keys(approval_request).length > 0;
  const approvalPermission: "action" | "payment" = execution_kind === "payment" ? "payment" : "action";
  const approval_hint = needs_approval
    ? {
        action_summary: String(
          approval_explanation.title ??
            approval_explanation.summary ??
            reason ??
            "Owner approval required",
        ),
        permission_class: approvalPermission,
        estimated_amount_minor: amount_minor || undefined,
        currency: receipt.currency ? currency : undefined,
        side_effects: Array.isArray(approval_explanation.side_effects)
          ? approval_explanation.side_effects.filter((item): item is string => typeof item === "string")
          : [],
        preview: toRecord(approval_explanation.preview),
        reversible: false,
      }
    : undefined;
  return {
    success: false,
    output: {
      reason_code,
      approval_request,
      approval_explanation,
    },
    execution_kind,
    units_consumed,
    amount_minor,
    currency,
    provider_status: needs_approval || reason_code ? "denied" : "error",
    error_message: reason || reason_code,
    needs_approval,
    approval_prompt: needs_approval ? (reason || "Owner approval is required.") : undefined,
    fallback_applied: Boolean(receipt.fallback_applied ?? false),
    receipt_summary: receipt,
    approval_hint,
  };
}

function buildUrl(baseUrl: string, path: string, params?: RequestOptions["params"]): string {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
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
    return JSON.parse(text);
  } catch {
    return {};
  }
}
