type FetchLike = typeof fetch;
type CassetteHeaderValue = string | string[];
declare const Deno:
  | {
      stat(path: string): Promise<unknown>;
      readTextFile(path: string): Promise<string>;
      writeTextFile(path: string, content: string): Promise<void>;
      mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    }
  | undefined;

const CASSETTE_VERSION = 1;
const SECRET_KEY_RE = /(api[_-]?key|secret|private[_-]?key|access[_-]?token|refresh[_-]?token)/i;
const HANDLE_URL_KEY_RE = /(checkout[_-]?url|portal[_-]?url)/i;
const PRIVKEY_RE = /0x[a-f0-9]{64}/g;
const TOKEN_RE = /(pypi|ghp|gho|ghu|ghs)-[A-Za-z0-9]+/g;
const BOUNDARY_RE = /boundary="?([^";]+)"?/i;

export enum RecordMode {
  RECORD = "record",
  REPLAY = "replay",
  AUTO = "auto",
}

export interface RecorderOptions {
  mode?: RecordMode;
  ignore_body_fields?: string[];
}

export interface CassetteInteraction {
  request: {
    method: string;
    url: string;
    headers: Record<string, CassetteHeaderValue>;
    body: unknown;
  };
  response: {
    status: number;
    headers: Record<string, CassetteHeaderValue>;
    body: unknown;
    duration_ms: number;
  };
}

export interface CassetteFile {
  version: number;
  interactions: CassetteInteraction[];
}

function redactString(value: string): string {
  return value.replace(PRIVKEY_RE, "<REDACTED_PRIVKEY>").replace(TOKEN_RE, "<REDACTED_TOKEN>");
}

function appendHeader(result: Record<string, CassetteHeaderValue>, key: string, value: string): void {
  const existing = result[key];
  if (existing === undefined) {
    result[key] = value;
    return;
  }
  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }
  result[key] = [existing, value];
}

function redactHeaderValue(key: string, value: string): string {
  if (key === "content-type" && value.toLowerCase().includes("multipart/form-data")) {
    return normalizeMultipartContentType(value);
  }
  if (key === "authorization") {
    // Preserve the scheme token so cassettes stay readable, but redact
    // every credential regardless of scheme (Bearer / Basic / Digest /
    // custom tokens). Falling through to redactString only catches values
    // that match our narrow secret regexes, which would leave plenty of
    // credentials in the clear.
    const stripped = value.trim();
    if (!stripped) {
      return "<REDACTED>";
    }
    // If the value has no whitespace separator, there is no scheme to
    // preserve — the entire value IS the credential (e.g. a bare
    // GitHub PAT `ghp_...` or a hex-encoded API key). Returning
    // `${head} <REDACTED>` in that case would echo the secret back.
    if (!/\s/.test(stripped)) {
      return "<REDACTED>";
    }
    const head = stripped.split(/\s+/)[0] ?? "";
    return head ? `${head} <REDACTED>` : "<REDACTED>";
  }
  if (key === "cookie" || key === "set-cookie" || SECRET_KEY_RE.test(key)) {
    const redacted = redactString(value);
    return redacted !== value ? redacted : "<REDACTED>";
  }
  return redactString(value);
}

function redactHeaders(headers: Headers): Record<string, CassetteHeaderValue> {
  const result: Record<string, CassetteHeaderValue> = {};
  headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    appendHeader(result, normalizedKey, redactHeaderValue(normalizedKey, value));
  });
  const getSetCookie = Reflect.get(headers as object, "getSetCookie");
  if (typeof getSetCookie === "function") {
    const setCookies = (getSetCookie as () => string[]).call(headers)
      .map((value) => redactHeaderValue("set-cookie", value));
    if (setCookies.length === 1 && setCookies[0] !== undefined) {
      result["set-cookie"] = setCookies[0];
    } else if (setCookies.length > 1) {
      result["set-cookie"] = setCookies;
    }
  }
  return result;
}

function redactUrl(urlText: string): string {
  const url = new URL(urlText);
  const nextParams = new URLSearchParams();
  for (const [key, value] of Array.from(url.searchParams.entries())) {
    if (SECRET_KEY_RE.test(key) || HANDLE_URL_KEY_RE.test(key)) {
      const redacted = redactString(value);
      nextParams.append(key, redacted !== value ? redacted : "<REDACTED>");
    } else {
      nextParams.append(key, redactString(value));
    }
  }
  url.search = nextParams.toString();
  return url.toString();
}

function redactBody(value: unknown, keyName?: string): unknown {
  if (keyName && HANDLE_URL_KEY_RE.test(keyName)) {
    return "<REDACTED>";
  }
  if (keyName && SECRET_KEY_RE.test(keyName)) {
    if (typeof value === "string") {
      const redacted = redactString(value);
      return redacted !== value ? redacted : "<REDACTED>";
    }
    return "<REDACTED>";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactBody(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, redactBody(child, key)]),
    );
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  return value;
}

function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeysDeep((value as Record<string, unknown>)[key])]),
    ) as T;
  }
  return value;
}

function normalizeTopLevelBody(body: unknown, ignoreBodyFields: Set<string>): unknown {
  if (!body || typeof body !== "object") {
    return body;
  }
  if (Array.isArray(body)) {
    return body.map((item) => normalizeTopLevelBody(item, new Set<string>()));
  }
  const record = body as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => !ignoreBodyFields.has(key))
      .sort()
      .map((key) => [key, normalizeTopLevelBody(record[key], new Set<string>())]),
  );
}

function requestSignature(request: { method: string; url: string; body: unknown }, ignoreBodyFields: Set<string>): string {
  return JSON.stringify({
    method: request.method.toUpperCase(),
    url: request.url,
    body: normalizeTopLevelBody(request.body, ignoreBodyFields),
  });
}

async function parseTextBody(text: string): Promise<unknown> {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function normalizeMultipartText(text: string, contentType: string | null): string {
  if (!contentType) {
    return text;
  }
  const match = BOUNDARY_RE.exec(contentType);
  if (!match?.[1]) {
    return text;
  }
  return text.split(match[1]).join("<BOUNDARY>");
}

function replaceAllBytes(source: Uint8Array, search: Uint8Array, replacement: Uint8Array): Uint8Array {
  if (search.length === 0) {
    return source;
  }
  const parts: number[] = [];
  for (let index = 0; index < source.length;) {
    let matched = true;
    for (let offset = 0; offset < search.length; offset += 1) {
      if (source[index + offset] !== search[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      parts.push(...replacement);
      index += search.length;
      continue;
    }
    parts.push(source[index] as number);
    index += 1;
  }
  return Uint8Array.from(parts);
}

function normalizeMultipartBytes(bytes: Uint8Array, contentType: string | null): Uint8Array {
  if (!contentType) {
    return bytes;
  }
  const match = BOUNDARY_RE.exec(contentType);
  if (!match?.[1]) {
    return bytes;
  }
  return replaceAllBytes(bytes, new TextEncoder().encode(match[1]), new TextEncoder().encode("<BOUNDARY>"));
}

function normalizeMultipartContentType(contentType: string | null): string {
  if (!contentType) {
    return "multipart/form-data; boundary=<BOUNDARY>";
  }
  return contentType.replace(BOUNDARY_RE, "boundary=<BOUNDARY>");
}

function toBase64(bytes: Uint8Array): string {
  const bufferCtor = Reflect.get(globalThis as object, "Buffer") as { from(data: Uint8Array): { toString(encoding: string): string } } | undefined;
  if (bufferCtor?.from) {
    return bufferCtor.from(bytes).toString("base64");
  }
  if (typeof btoa === "function") {
    let binary = "";
    bytes.forEach((value) => {
      binary += String.fromCharCode(value);
    });
    return btoa(binary);
  }
  throw new Error("No base64 encoder available for multipart cassette recording.");
}

async function parseRequestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type");
  if (contentType?.toLowerCase().includes("multipart/form-data")) {
    const bytes = new Uint8Array(await request.clone().arrayBuffer());
    return {
      content_type: normalizeMultipartContentType(contentType),
      encoding: "base64",
      base64: toBase64(normalizeMultipartBytes(bytes, contentType)),
    };
  }
  const text = await request.clone().text();
  if (!text) {
    return null;
  }
  return parseTextBody(text);
}

function buildResponseFromCassette(interaction: CassetteInteraction, request: Request): Response {
  const headers = new Headers();
  Object.entries(interaction.response.headers).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(key, entry));
      return;
    }
    headers.append(key, value);
  });
  const body = interaction.response.body;
  const payload = typeof body === "string" ? body : body == null ? "" : JSON.stringify(body);
  if (body !== null && body !== undefined && typeof body !== "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Response(payload, {
    status: interaction.response.status,
    headers,
  });
}

async function fileExists(path: string): Promise<boolean> {
  if (typeof Deno !== "undefined" && typeof Deno.stat === "function") {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const fs = await import("node:fs/promises");
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(path: string): Promise<string> {
  if (typeof Deno !== "undefined" && typeof Deno.readTextFile === "function") {
    return Deno.readTextFile(path);
  }
  const fs = await import("node:fs/promises");
  return fs.readFile(path, "utf8");
}

async function writeTextFile(path: string, content: string): Promise<void> {
  if (typeof Deno !== "undefined" && typeof Deno.writeTextFile === "function") {
    const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
    if (dir) {
      await Deno.mkdir(dir, { recursive: true });
    }
    await Deno.writeTextFile(path, content);
    return;
  }
  const fs = await import("node:fs/promises");
  const pathModule = await import("node:path");
  await fs.mkdir(pathModule.dirname(path), { recursive: true });
  await fs.writeFile(path, content, "utf8");
}

export class Recorder {
  readonly cassettePath: string;
  readonly mode: RecordMode;
  readonly ignore_body_fields: string[];
  private effectiveMode: RecordMode | null = null;
  private interactions: CassetteInteraction[] = [];
  private cursor = 0;
  private wrappedClients: Array<{ client: object; fetchImpl: FetchLike }> = [];

  constructor(cassettePath: string, options: RecorderOptions = {}) {
    this.cassettePath = cassettePath;
    this.mode = options.mode ?? RecordMode.AUTO;
    this.ignore_body_fields = options.ignore_body_fields ?? [];
  }

  static async open(cassettePath: string, options: RecorderOptions = {}): Promise<Recorder> {
    const recorder = new Recorder(cassettePath, options);
    return recorder.start();
  }

  async start(): Promise<this> {
    this.effectiveMode = await this.resolveMode();
    this.interactions = this.effectiveMode === RecordMode.REPLAY ? await this.loadCassette() : [];
    this.cursor = 0;
    return this;
  }

  async close(): Promise<void> {
    for (const wrapped of this.wrappedClients.splice(0)) {
      Reflect.set(wrapped.client, "fetchImpl", wrapped.fetchImpl);
    }
    if (this.effectiveMode === RecordMode.RECORD) {
      const payload: CassetteFile = { version: CASSETTE_VERSION, interactions: this.interactions };
      await writeTextFile(this.cassettePath, `${JSON.stringify(sortKeysDeep(payload), null, 2)}\n`);
    }
  }

  wrap<T extends object>(client: T): T {
    if (!this.effectiveMode) {
      throw new Error("Recorder.wrap() requires start() first.");
    }
    const currentFetch = Reflect.get(client, "fetchImpl");
    if (typeof currentFetch !== "function") {
      throw new Error("Recorder.wrap() expects a SiglumeClient-like object with fetchImpl.");
    }
    this.wrappedClients.push({ client, fetchImpl: currentFetch as FetchLike });
    Reflect.set(client, "fetchImpl", this.createFetch(currentFetch as FetchLike));
    return client;
  }

  async withGlobalFetch<T>(fn: () => Promise<T> | T): Promise<T> {
    if (!this.effectiveMode) {
      throw new Error("Recorder.withGlobalFetch() requires start() first.");
    }
    const originalFetch = globalThis.fetch;
    if (typeof originalFetch !== "function") {
      throw new Error("Global fetch is not available in this runtime.");
    }
    const recorderFetch = this.createFetch(originalFetch);
    Reflect.set(globalThis as object, "fetch", recorderFetch);
    try {
      return await fn();
    } finally {
      Reflect.set(globalThis as object, "fetch", originalFetch);
    }
  }

  private async resolveMode(): Promise<RecordMode> {
    if (this.mode === RecordMode.AUTO) {
      return await fileExists(this.cassettePath) ? RecordMode.REPLAY : RecordMode.RECORD;
    }
    return this.mode;
  }

  private async loadCassette(): Promise<CassetteInteraction[]> {
    if (!(await fileExists(this.cassettePath))) {
      throw new Error(`Cassette not found for replay: ${this.cassettePath}`);
    }
    const payload = JSON.parse(await readTextFile(this.cassettePath)) as Partial<CassetteFile>;
    if (payload.version !== CASSETTE_VERSION || !Array.isArray(payload.interactions)) {
      throw new Error(`Invalid cassette format: ${this.cassettePath}`);
    }
    return payload.interactions;
  }

  private createFetch(fetchImpl: FetchLike): FetchLike {
    const ignoreBodyFields = new Set(this.ignore_body_fields);
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const requestBody = await parseRequestBody(request);
      const requestRecord = {
        method: request.method,
        url: redactUrl(request.url),
        headers: redactHeaders(request.headers),
        body: redactBody(requestBody),
      };

      if (this.effectiveMode === RecordMode.REPLAY) {
        if (this.cursor >= this.interactions.length) {
          throw new Error(`Replay attempted unexpected fetch ${request.method} ${request.url}`);
        }
        const interaction = this.interactions[this.cursor];
        if (!interaction) {
          throw new Error(`Replay interaction missing at index ${this.cursor}`);
        }
        if (requestSignature(interaction.request, ignoreBodyFields) !== requestSignature(requestRecord, ignoreBodyFields)) {
          throw new Error(
            `Replay request mismatch.\nExpected: ${requestSignature(interaction.request, ignoreBodyFields)}\nActual:   ${requestSignature(requestRecord, ignoreBodyFields)}`,
          );
        }
        this.cursor += 1;
        return buildResponseFromCassette(interaction, request);
      }

      const started = Date.now();
      const response = await fetchImpl(input, init);
      const responseText = response.status === 204 ? "" : await response.clone().text();
      const responseBody = await parseTextBody(responseText);
      this.interactions.push({
        request: requestRecord,
        response: {
          status: response.status,
          headers: redactHeaders(response.headers),
          body: redactBody(responseBody),
          duration_ms: Date.now() - started,
        },
      });
      return response;
    }) satisfies FetchLike;
  }
}
