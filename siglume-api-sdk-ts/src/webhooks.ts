import { SiglumeWebhookError, SiglumeWebhookPayloadError, SiglumeWebhookReplayError, SiglumeWebhookSignatureError } from "./errors";

export const WEBHOOK_SIGNATURE_HEADER = "Siglume-Signature";
export const WEBHOOK_EVENT_ID_HEADER = "Siglume-Event-Id";
export const WEBHOOK_EVENT_TYPE_HEADER = "Siglume-Event-Type";
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export const WEBHOOK_EVENT_TYPES = [
  "subscription.created",
  "subscription.renewed",
  "subscription.cancelled",
  "subscription.paused",
  "subscription.reinstated",
  "payment.succeeded",
  "payment.failed",
  "payment.disputed",
  "capability.published",
  "capability.delisted",
  "execution.completed",
  "execution.failed",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
const WEBHOOK_EVENT_SET = new Set<string>(WEBHOOK_EVENT_TYPES);

export interface WebhookSignatureVerification {
  timestamp: number;
  signature: string;
}

export interface WebhookSubscriptionRecord {
  subscription_id: string;
  owner_user_id: string;
  callback_url: string;
  status: string;
  event_types: string[];
  description?: string | null;
  signing_secret_hint?: string | null;
  signing_secret?: string | null;
  metadata: Record<string, unknown>;
  last_delivery_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface WebhookDeliveryRecord {
  delivery_id: string;
  subscription_id: string;
  event_id: string;
  event_type: string;
  idempotency_key: string;
  callback_url: string;
  delivery_status: string;
  request_headers: Record<string, unknown>;
  request_body: Record<string, unknown>;
  response_status?: number | null;
  response_headers: Record<string, unknown>;
  response_body?: unknown;
  duration_ms?: number | null;
  attempt_count: number;
  last_attempt_at?: string | null;
  delivered_at?: string | null;
  error_message?: string | null;
  trace_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface WebhookEventBase<T extends WebhookEventType = WebhookEventType, D extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  type: T;
  api_version: string;
  occurred_at: string;
  idempotency_key: string;
  trace_id?: string | null;
  data: D;
  raw: Record<string, unknown>;
}

export interface SubscriptionLifecycleEventData extends Record<string, unknown> {
  subscription_id?: string;
  access_grant_id?: string;
  listing_id?: string;
  capability_key?: string;
  buyer_user_id?: string;
  seller_user_id?: string;
  billing_model?: string;
  purchase_path?: string;
  currency?: string;
  amount_minor?: number;
}

export interface PaymentEventData extends SubscriptionLifecycleEventData {
  payment_status?: string;
}

export interface CapabilityEventData extends Record<string, unknown> {
  listing_id?: string;
  capability_key?: string;
  status?: string;
  previous_status?: string;
  owner_user_id?: string;
  published_at?: string;
}

export interface ExecutionCompletedEventData extends Record<string, unknown> {
  usage_event_id?: string;
  access_grant_id?: string;
  listing_id?: string;
  capability_key?: string;
  agent_id?: string;
  execution_kind?: string;
  environment?: string;
}

export interface ExecutionFailedEventData extends ExecutionCompletedEventData {
  reason_code?: string;
  reason?: string;
}

export interface SubscriptionCreatedEvent extends WebhookEventBase<"subscription.created", SubscriptionLifecycleEventData> {}
export interface SubscriptionRenewedEvent extends WebhookEventBase<"subscription.renewed", SubscriptionLifecycleEventData> {}
export interface SubscriptionCancelledEvent extends WebhookEventBase<"subscription.cancelled", SubscriptionLifecycleEventData> {}
export interface SubscriptionPausedEvent extends WebhookEventBase<"subscription.paused", SubscriptionLifecycleEventData> {}
export interface SubscriptionReinstatedEvent extends WebhookEventBase<"subscription.reinstated", SubscriptionLifecycleEventData> {}
export interface PaymentSucceededEvent extends WebhookEventBase<"payment.succeeded", PaymentEventData> {}
export interface PaymentFailedEvent extends WebhookEventBase<"payment.failed", PaymentEventData> {}
export interface PaymentDisputedEvent extends WebhookEventBase<"payment.disputed", PaymentEventData> {}
export interface CapabilityPublishedEvent extends WebhookEventBase<"capability.published", CapabilityEventData> {}
export interface CapabilityDelistedEvent extends WebhookEventBase<"capability.delisted", CapabilityEventData> {}
export interface ExecutionCompletedEvent extends WebhookEventBase<"execution.completed", ExecutionCompletedEventData> {}
export interface ExecutionFailedEvent extends WebhookEventBase<"execution.failed", ExecutionFailedEventData> {}

export type SiglumeWebhookEvent =
  | SubscriptionCreatedEvent
  | SubscriptionRenewedEvent
  | SubscriptionCancelledEvent
  | SubscriptionPausedEvent
  | SubscriptionReinstatedEvent
  | PaymentSucceededEvent
  | PaymentFailedEvent
  | PaymentDisputedEvent
  | CapabilityPublishedEvent
  | CapabilityDelistedEvent
  | ExecutionCompletedEvent
  | ExecutionFailedEvent;

export interface QueuedWebhookEvent {
  queued: boolean;
  event: SiglumeWebhookEvent;
}

export interface WebhookDispatchResult {
  event: SiglumeWebhookEvent;
  verification: WebhookSignatureVerification;
  duplicate: boolean;
  callback_results: unknown[];
}

export type HeaderLike = Headers | Record<string, unknown>;
export type WebhookCallback<T extends SiglumeWebhookEvent = SiglumeWebhookEvent> = (event: T) => unknown | Promise<unknown>;

export interface ExpressLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: string | Uint8Array | ArrayBuffer | Buffer;
  body?: unknown;
}

export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  json(payload: unknown): unknown;
}

export class InMemoryWebhookDedupe {
  readonly ttl_seconds: number;
  readonly max_entries: number;
  private readonly entries = new Map<string, number>();

  constructor(options: { ttl_seconds?: number; max_entries?: number } = {}) {
    this.ttl_seconds = Math.max(1, Math.trunc(options.ttl_seconds ?? 3600));
    this.max_entries = Math.max(32, Math.trunc(options.max_entries ?? 4096));
  }

  private purge(nowMs: number): void {
    for (const [key, expiresAt] of this.entries.entries()) {
      if (expiresAt <= nowMs) {
        this.entries.delete(key);
      }
    }
    while (this.entries.size > this.max_entries) {
      const oldest = [...this.entries.entries()].sort((left, right) => left[1] - right[1])[0]?.[0];
      if (!oldest) {
        return;
      }
      this.entries.delete(oldest);
    }
  }

  is_duplicate(idempotency_key: string, nowMs = Date.now()): boolean {
    this.purge(nowMs);
    const key = String(idempotency_key ?? "").trim();
    if (!key) {
      return false;
    }
    if (this.entries.has(key)) {
      return true;
    }
    this.entries.set(key, nowMs + (this.ttl_seconds * 1000));
    this.purge(nowMs);
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(key), cloneJson(item)]));
}

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJson(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(key), cloneJson(item)]));
  }
  return value;
}

function stringOrNull(value: unknown): string | null {
  const text = value === undefined || value === null ? "" : String(value).trim();
  return text.length > 0 ? text : null;
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SiglumeWebhookPayloadError(`${name} must be an object.`);
  }
  return toRecord(value);
}

function headerValue(headers: HeaderLike, name: string): string | null {
  const target = name.toLowerCase();
  if (headers instanceof Headers) {
    return stringOrNull(headers.get(name));
  }
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (String(key).toLowerCase() !== target) {
      continue;
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? stringOrNull(value[0]) : null;
    }
    return stringOrNull(value);
  }
  return null;
}

function bodyBytes(body: Uint8Array | ArrayBuffer | string | Record<string, unknown>): Uint8Array {
  if (body instanceof Uint8Array) {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }
  if (isRecord(body)) {
    return new TextEncoder().encode(JSON.stringify(cloneJson(body)));
  }
  throw new SiglumeWebhookPayloadError("Webhook body must be raw bytes, a string, or a JSON object.");
}

function parseSignatureHeader(signatureHeader: string): { timestamp: number; signature: string } {
  let timestamp: number | null = null;
  let signature: string | null = null;
  for (const item of String(signatureHeader ?? "").split(",")) {
    const [key, value] = item.trim().split("=", 2);
    if (key === "t") {
      const parsed = Number.parseInt(value ?? "", 10);
      if (!Number.isFinite(parsed)) {
        throw new SiglumeWebhookSignatureError("Webhook signature timestamp is invalid.");
      }
      timestamp = parsed;
    }
    if (key === "v1") {
      signature = String(value ?? "").trim();
    }
  }
  if (timestamp === null || !signature) {
    throw new SiglumeWebhookSignatureError("Webhook signature header is incomplete.");
  }
  return { timestamp, signature };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = String(hex ?? "").trim().toLowerCase();
  if (normalized.length % 2 !== 0) {
    throw new SiglumeWebhookSignatureError("Webhook signature hex digest is invalid.");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

async function hmacSha256(secret: string, payload: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const stablePayload = new Uint8Array(payload.byteLength);
    stablePayload.set(payload);
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await globalThis.crypto.subtle.sign("HMAC", key, stablePayload);
    return bytesToHex(new Uint8Array(digest));
  }
  if (typeof process !== "undefined" && process.versions?.node) {
    const crypto = await import("node:crypto");
    return crypto.createHmac("sha256", secret).update(Buffer.from(payload)).digest("hex");
  }
  throw new SiglumeWebhookError("Web Crypto is required to verify Siglume webhook signatures in this runtime.");
}

async function timingSafeEqualHex(left: string, right: string): Promise<boolean> {
  const leftBytes = hexToBytes(left);
  const rightBytes = hexToBytes(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return diff === 0;
}

export async function compute_webhook_signature(
  signing_secret: string,
  body: Uint8Array | ArrayBuffer | string | Record<string, unknown>,
  options: { timestamp: number },
): Promise<string> {
  if (!signing_secret) {
    throw new SiglumeWebhookSignatureError("SIGLUME webhook signing secret is required.");
  }
  const timestamp = Math.trunc(options.timestamp);
  const bytes = bodyBytes(body);
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const payload = new Uint8Array(prefix.length + bytes.length);
  payload.set(prefix, 0);
  payload.set(bytes, prefix.length);
  return hmacSha256(signing_secret, payload);
}

export async function build_webhook_signature_header(
  signing_secret: string,
  body: Uint8Array | ArrayBuffer | string | Record<string, unknown>,
  options: { timestamp?: number } = {},
): Promise<string> {
  const timestamp = Math.trunc(options.timestamp ?? (Date.now() / 1000));
  const signature = await compute_webhook_signature(signing_secret, body, { timestamp });
  return `t=${timestamp},v1=${signature}`;
}

export async function verify_webhook_signature(
  signing_secret: string,
  body: Uint8Array | ArrayBuffer | string | Record<string, unknown>,
  signature_header: string,
  options: { tolerance_seconds?: number; now?: number } = {},
): Promise<WebhookSignatureVerification> {
  const { timestamp, signature } = parseSignatureHeader(signature_header);
  const toleranceSeconds = Math.max(1, Math.trunc(options.tolerance_seconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS));
  const nowSeconds = Math.trunc(options.now ?? (Date.now() / 1000));
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new SiglumeWebhookSignatureError("Webhook timestamp is outside the allowed tolerance window.");
  }
  const expected = await compute_webhook_signature(signing_secret, body, { timestamp });
  if (!(await timingSafeEqualHex(expected, signature))) {
    throw new SiglumeWebhookSignatureError("Webhook signature did not match.");
  }
  return { timestamp, signature };
}

export function parse_webhook_subscription(payload: unknown): WebhookSubscriptionRecord {
  const record = requireRecord(payload, "webhook subscription");
  return {
    subscription_id: String(record.id ?? record.subscription_id ?? ""),
    owner_user_id: String(record.owner_user_id ?? ""),
    callback_url: String(record.callback_url ?? ""),
    status: String(record.status ?? ""),
    event_types: Array.isArray(record.event_types)
      ? record.event_types.map((item) => String(item)).filter((item) => item.length > 0)
      : [],
    description: stringOrNull(record.description),
    signing_secret_hint: stringOrNull(record.signing_secret_hint),
    signing_secret: stringOrNull(record.signing_secret),
    metadata: toRecord(record.metadata),
    last_delivery_at: stringOrNull(record.last_delivery_at),
    created_at: stringOrNull(record.created_at),
    updated_at: stringOrNull(record.updated_at),
    raw: record,
  };
}

export function parse_webhook_delivery(payload: unknown): WebhookDeliveryRecord {
  const record = requireRecord(payload, "webhook delivery");
  return {
    delivery_id: String(record.id ?? record.delivery_id ?? ""),
    subscription_id: String(record.subscription_id ?? ""),
    event_id: String(record.event_id ?? ""),
    event_type: String(record.event_type ?? ""),
    idempotency_key: String(record.idempotency_key ?? ""),
    callback_url: String(record.callback_url ?? ""),
    delivery_status: String(record.delivery_status ?? ""),
    request_headers: toRecord(record.request_headers),
    request_body: toRecord(record.request_body),
    response_status: typeof record.response_status === "number" ? record.response_status : null,
    response_headers: toRecord(record.response_headers),
    response_body: cloneJson(record.response_body),
    duration_ms: typeof record.duration_ms === "number" ? record.duration_ms : null,
    attempt_count: typeof record.attempt_count === "number" ? record.attempt_count : 0,
    last_attempt_at: stringOrNull(record.last_attempt_at),
    delivered_at: stringOrNull(record.delivered_at),
    error_message: stringOrNull(record.error_message),
    trace_id: stringOrNull(record.trace_id),
    created_at: stringOrNull(record.created_at),
    updated_at: stringOrNull(record.updated_at),
    raw: record,
  };
}

export function parse_webhook_event(payload: unknown): SiglumeWebhookEvent {
  const record = requireRecord(payload, "webhook event");
  const eventType = String(record.type ?? "").trim();
  if (!WEBHOOK_EVENT_SET.has(eventType)) {
    throw new SiglumeWebhookPayloadError(`Unsupported webhook event type: ${eventType || "<missing>"}.`);
  }
  const event = {
    id: String(record.id ?? ""),
    type: eventType as WebhookEventType,
    api_version: String(record.api_version ?? ""),
    occurred_at: String(record.occurred_at ?? ""),
    idempotency_key: String(record.idempotency_key ?? record.id ?? ""),
    trace_id: stringOrNull(record.trace_id),
    data: toRecord(record.data),
    raw: record,
  } as SiglumeWebhookEvent;
  if (!event.id) {
    throw new SiglumeWebhookPayloadError("Webhook event id is required.");
  }
  if (!event.api_version) {
    throw new SiglumeWebhookPayloadError("Webhook api_version is required.");
  }
  if (!event.occurred_at) {
    throw new SiglumeWebhookPayloadError("Webhook occurred_at is required.");
  }
  return event;
}

export function parse_queued_webhook_event(payload: unknown): QueuedWebhookEvent {
  const record = requireRecord(payload, "queued webhook event");
  return {
    queued: Boolean(record.queued),
    event: parse_webhook_event(record.event),
  };
}

function eventBodyFromBytes(bytes: Uint8Array): SiglumeWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new SiglumeWebhookPayloadError("Webhook body must contain valid UTF-8 JSON.");
  }
  return parse_webhook_event(parsed);
}

function rawBodyFromExpressRequest(request: ExpressLikeRequest): Uint8Array {
  const raw = request.rawBody;
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  if (typeof raw === "string") {
    return new TextEncoder().encode(raw);
  }
  if (typeof request.body === "string") {
    return new TextEncoder().encode(request.body);
  }
  if (isRecord(request.body)) {
    throw new SiglumeWebhookPayloadError(
      "Express webhook handling requires req.rawBody (or a string body) so the signature can be verified against the original payload.",
    );
  }
  throw new SiglumeWebhookPayloadError("Webhook request body is missing.");
}

export class WebhookHandler {
  readonly signing_secret: string;
  readonly tolerance_seconds: number;
  readonly deduper?: InMemoryWebhookDedupe;
  private readonly handlers = new Map<string, WebhookCallback[]>();

  constructor(options: {
    signing_secret: string;
    tolerance_seconds?: number;
    deduper?: InMemoryWebhookDedupe;
  }) {
    if (!options.signing_secret) {
      throw new SiglumeWebhookSignatureError("SIGLUME_WEBHOOK_SECRET is required.");
    }
    this.signing_secret = options.signing_secret;
    this.tolerance_seconds = Math.max(1, Math.trunc(options.tolerance_seconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS));
    this.deduper = options.deduper;
  }

  on<T extends WebhookEventType | "*">(
    event_type: T,
    handler: T extends "*" ? WebhookCallback<SiglumeWebhookEvent> : WebhookCallback<Extract<SiglumeWebhookEvent, { type: T }>>,
  ): this {
    const normalized = String(event_type ?? "").trim();
    if (normalized !== "*" && !WEBHOOK_EVENT_SET.has(normalized)) {
      throw new SiglumeWebhookError(`Unsupported Siglume webhook event type: ${normalized}`);
    }
    const bucket = this.handlers.get(normalized) ?? [];
    bucket.push(handler as WebhookCallback);
    this.handlers.set(normalized, bucket);
    return this;
  }

  async verify(
    body: Uint8Array | ArrayBuffer | string | Record<string, unknown>,
    headers: HeaderLike,
    options: { now?: number } = {},
  ): Promise<{ event: SiglumeWebhookEvent; verification: WebhookSignatureVerification }> {
    const signatureHeader = headerValue(headers, WEBHOOK_SIGNATURE_HEADER);
    if (!signatureHeader) {
      throw new SiglumeWebhookSignatureError("Missing Siglume-Signature header.");
    }
    const bytes = bodyBytes(body);
    const verification = await verify_webhook_signature(this.signing_secret, bytes, signatureHeader, {
      tolerance_seconds: this.tolerance_seconds,
      now: options.now,
    });
    const event = eventBodyFromBytes(bytes);
    const eventIdHeader = headerValue(headers, WEBHOOK_EVENT_ID_HEADER);
    const eventTypeHeader = headerValue(headers, WEBHOOK_EVENT_TYPE_HEADER);
    if (eventIdHeader && eventIdHeader !== event.id) {
      throw new SiglumeWebhookPayloadError("Siglume-Event-Id header did not match the webhook body.");
    }
    if (eventTypeHeader && eventTypeHeader !== event.type) {
      throw new SiglumeWebhookPayloadError("Siglume-Event-Type header did not match the webhook body.");
    }
    return { event, verification };
  }

  async dispatch(event: SiglumeWebhookEvent): Promise<unknown[]> {
    const callbacks = [...(this.handlers.get("*") ?? []), ...(this.handlers.get(event.type) ?? [])];
    const results: unknown[] = [];
    for (const callback of callbacks) {
      results.push(await callback(event));
    }
    return results;
  }

  async handle(
    body: Uint8Array | ArrayBuffer | string | Record<string, unknown>,
    headers: HeaderLike,
    options: { now?: number } = {},
  ): Promise<WebhookDispatchResult> {
    const { event, verification } = await this.verify(body, headers, options);
    if (this.deduper?.is_duplicate(event.idempotency_key)) {
      return {
        event,
        verification,
        duplicate: true,
        callback_results: [],
      };
    }
    return {
      event,
      verification,
      duplicate: false,
      callback_results: await this.dispatch(event),
    };
  }

  asExpressHandler() {
    return async (request: ExpressLikeRequest, response: ExpressLikeResponse): Promise<void> => {
      try {
        const result = await this.handle(rawBodyFromExpressRequest(request), request.headers);
        response.status(200).json({
          ok: true,
          duplicate: result.duplicate,
          event_id: result.event.id,
          event_type: result.event.type,
        });
      } catch (error) {
        if (error instanceof SiglumeWebhookSignatureError) {
          response.status(401).json({ ok: false, code: "INVALID_SIGNATURE", error: error.message });
          return;
        }
        if (error instanceof SiglumeWebhookReplayError) {
          response.status(409).json({ ok: false, code: "DUPLICATE_EVENT", error: error.message });
          return;
        }
        if (error instanceof SiglumeWebhookPayloadError || error instanceof SiglumeWebhookError) {
          response.status(400).json({ ok: false, code: "INVALID_PAYLOAD", error: error.message });
          return;
        }
        throw error;
      }
    };
  }
}
