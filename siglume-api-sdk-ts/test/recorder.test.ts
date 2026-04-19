import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  AppAdapter,
  AppCategory,
  AppTestHarness,
  ApprovalMode,
  PermissionClass,
  PriceModel,
  RecordMode,
  Recorder,
  SiglumeClient,
  ToolManualPermissionClass,
} from "../src/index";
import type { ExecutionContext, ExecutionResult } from "../src/index";

const tempDirs: string[] = [];

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(String(input));
}

function envelope(data: Record<string, unknown>, meta: Record<string, unknown> = { request_id: "req_test", trace_id: "trc_test" }) {
  return { data, meta, error: null };
}

function buildManifest() {
  return {
    capability_key: "price-compare-helper",
    name: "Price Compare Helper",
    job_to_be_done: "Compare retailer prices for a product and return the best current offer.",
    category: AppCategory.COMMERCE,
    permission_class: PermissionClass.READ_ONLY,
    approval_mode: ApprovalMode.AUTO,
    dry_run_supported: true,
    required_connected_accounts: [],
    price_model: PriceModel.FREE,
    price_value_minor: 0,
    jurisdiction: "US",
    short_description: "Search multiple retailers and summarize the best current price.",
    example_prompts: ["Compare prices for Sony WH-1000XM5."],
  };
}

function buildToolManual() {
  return {
    tool_name: "price_compare_helper",
    job_to_be_done: "Search multiple retailers for a product and return a ranked price comparison the agent can cite.",
    summary_for_model: "Looks up current retailer offers and returns a structured comparison with the best deal first.",
    trigger_conditions: [
      "owner asks to compare prices for a product before deciding where to buy",
      "agent needs retailer offer data to support a shopping recommendation",
      "request is to find the cheapest or best-value option for a product query",
    ],
    do_not_use_when: [
      "the request is to complete checkout or place an order instead of comparing offers",
    ],
    permission_class: ToolManualPermissionClass.READ_ONLY,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product name, model number, or search phrase." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line overview of the best available deal." },
        offers: { type: "array", items: { type: "object" }, description: "Ranked retailer offers." },
      },
      required: ["summary", "offers"],
      additionalProperties: false,
    },
    usage_hints: ["Use this tool after the owner has named a product and wants evidence-backed price comparison."],
    result_hints: ["Lead with the best offer and then summarize notable trade-offs."],
    error_hints: ["If no offers are found, ask for a clearer product name or model number."],
  };
}

async function makeTempCassette(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "siglume-recorder-"));
  tempDirs.push(dir);
  return join(dir, name);
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("Recorder", () => {
  it("records and replays a SiglumeClient flow", async () => {
    const cassettePath = await makeTempCassette("client-roundtrip.json");
    const requests: Array<{ method: string; path: string }> = [];

    const recorder = await Recorder.open(cassettePath, { mode: RecordMode.RECORD });
    try {
      const client = recorder.wrap(new SiglumeClient({
        api_key: "sig_test_key",
        base_url: "https://api.example.test/v1",
        fetch: async (input, init) => {
          const url = requestUrl(input);
          requests.push({ method: String(init?.method ?? "GET"), path: url.pathname });
          if (url.pathname === "/v1/market/capabilities/auto-register") {
            return new Response(JSON.stringify(envelope({
              listing_id: "lst_123",
              status: "draft",
              auto_manifest: { capability_key: "price-compare-helper" },
              confidence: { overall: 0.94 },
              review_url: "/owner/publish?listing=lst_123",
            })), { status: 201, headers: { "content-type": "application/json" } });
          }
          if (url.pathname === "/v1/market/capabilities/lst_123/confirm-auto-register") {
            return new Response(JSON.stringify(envelope({
              listing_id: "lst_123",
              status: "pending_review",
              release: { release_id: "rel_123", release_status: "pending_review" },
              quality: {
                overall_score: 84,
                grade: "B",
                issues: [],
                improvement_suggestions: ["Add one more retailer-specific trigger example."],
              },
            }, { request_id: "req_confirm", trace_id: "trc_confirm" })), { status: 200, headers: { "content-type": "application/json" } });
          }
          return new Response("{}", { status: 500 });
        },
      }));

      const receipt = await client.auto_register(buildManifest(), buildToolManual(), { source_code: "# ts recorder stub" });
      const confirmation = await client.confirm_registration(receipt.listing_id);
      expect(receipt.listing_id).toBe("lst_123");
      expect(confirmation.quality.grade).toBe("B");
    } finally {
      await recorder.close();
    }

    const replayRecorder = await Recorder.open(cassettePath, { mode: RecordMode.REPLAY });
    try {
      const replayClient = replayRecorder.wrap(new SiglumeClient({
        api_key: "sig_ignored",
        base_url: "https://api.example.test/v1",
        fetch: async () => {
          throw new Error("Replay should not hit fetch");
        },
      }));

      const replayReceipt = await replayClient.auto_register(buildManifest(), buildToolManual(), { source_code: "# ts recorder stub" });
      const replayConfirmation = await replayClient.confirm_registration(replayReceipt.listing_id);
      expect(replayReceipt.listing_id).toBe("lst_123");
      expect(replayConfirmation.trace_id).toBe("trc_confirm");
      expect(requests).toHaveLength(2);
    } finally {
      await replayRecorder.close();
    }
  });

  it("replays the committed shared cassette in TypeScript", async () => {
    const cassettePath = fileURLToPath(new URL("../../tests/cassettes/auto_register_flow.json", import.meta.url));
    const recorder = await Recorder.open(cassettePath, { mode: RecordMode.REPLAY });
    try {
      const client = recorder.wrap(new SiglumeClient({
        api_key: "sig_ignored",
        base_url: "https://api.example.test/v1",
        fetch: async () => {
          throw new Error("Replay should not hit fetch");
        },
      }));

      const receipt = await client.auto_register(buildManifest(), buildToolManual(), { source_code: "# shared registration stub" });
      const confirmation = await client.confirm_registration(receipt.listing_id);

      expect(receipt.listing_id).toBe("lst_123");
      expect(confirmation.status).toBe("pending_review");
      expect(confirmation.quality.overall_score).toBe(84);
    } finally {
      await recorder.close();
    }
  });

  it("redacts auth, token, and private-key values in cassettes", async () => {
    const cassettePath = await makeTempCassette("redacted.json");
    const recorder = await Recorder.open(cassettePath, { mode: RecordMode.RECORD });
    const originalFetch = globalThis.fetch;
    Reflect.set(globalThis as object, "fetch", async () => new Response(JSON.stringify(envelope({
      refresh_token: "pypi-SECRET123",
      private_key: `0x${"a".repeat(64)}`,
      ok: true,
    })), {
      status: 200,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer downstream",
      },
    }));
    try {
      await recorder.withGlobalFetch(() =>
        fetch("https://api.example.test/secrets?api_key=query-secret&access_token=ghp-QUERYSECRET", {
          method: "POST",
          headers: {
            authorization: "Bearer sig_top_secret",
            cookie: "session=ghp-COOKIESECRET",
            "x-api-key": "sig_header_secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            api_key: "sig_private",
            nested: { private_key: `0x${"b".repeat(64)}` },
            access_token: "ghp-EXAMPLESECRET",
          }),
        }),
      );
    } finally {
      Reflect.set(globalThis as object, "fetch", originalFetch);
      await recorder.close();
    }

    const cassetteText = await readFile(cassettePath, "utf8");
    expect(cassetteText).toContain("Bearer <REDACTED>");
    expect(cassetteText).toContain("<REDACTED>");
    expect(cassetteText).toContain("<REDACTED_PRIVKEY>");
    expect(cassetteText).toContain("<REDACTED_TOKEN>");
    expect(cassetteText).not.toContain("sig_top_secret");
    expect(cassetteText).not.toContain("sig_header_secret");
    expect(cassetteText).not.toContain("query-secret");
    expect(cassetteText).not.toContain("ghp-QUERYSECRET");
    expect(cassetteText).not.toContain("ghp-COOKIESECRET");
    expect(cassetteText).not.toContain("ghp-EXAMPLESECRET");

    const replayRecorder = await Recorder.open(cassettePath, { mode: RecordMode.REPLAY });
    Reflect.set(globalThis as object, "fetch", async () => {
      throw new Error("Replay should not hit fetch");
    });
    try {
      const replayed = await replayRecorder.withGlobalFetch(() =>
        fetch("https://api.example.test/secrets?api_key=query-secret&access_token=ghp-QUERYSECRET", {
          method: "POST",
          headers: {
            authorization: "Bearer sig_top_secret",
            cookie: "session=ghp-COOKIESECRET",
            "x-api-key": "sig_header_secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            api_key: "sig_private",
            nested: { private_key: `0x${"b".repeat(64)}` },
            access_token: "ghp-EXAMPLESECRET",
          }),
        }),
      );
      expect(replayed.status).toBe(200);
    } finally {
      Reflect.set(globalThis as object, "fetch", originalFetch);
      await replayRecorder.close();
    }
  });

  it("ignores configured top-level body fields during replay matching", async () => {
    const cassettePath = await makeTempCassette("ignore-fields.json");
    const recordRecorder = await Recorder.open(cassettePath, {
      mode: RecordMode.RECORD,
      ignore_body_fields: ["request_id", "timestamp"],
    });
    const originalFetch = globalThis.fetch;
    Reflect.set(globalThis as object, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      return new Response(JSON.stringify(envelope({ ok: true, echo: body })), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      await recordRecorder.withGlobalFetch(() =>
        fetch("https://api.example.test/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: "headphones",
            request_id: "req_record",
            timestamp: "2026-04-19T00:00:00Z",
          }),
        }),
      );
    } finally {
      Reflect.set(globalThis as object, "fetch", originalFetch);
      await recordRecorder.close();
    }

    const replayRecorder = await Recorder.open(cassettePath, {
      mode: RecordMode.REPLAY,
      ignore_body_fields: ["request_id", "timestamp"],
    });
    try {
      const originalFetch = globalThis.fetch;
      Reflect.set(globalThis as object, "fetch", async () => {
        throw new Error("Replay should not hit fetch");
      });
      try {
        const response = await replayRecorder.withGlobalFetch(() =>
          fetch("https://api.example.test/events", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              query: "headphones",
              request_id: "req_replay",
              timestamp: "2026-04-19T01:00:00Z",
            }),
          }),
        );
        expect((await response.json()).data.ok).toBe(true);
      } finally {
        Reflect.set(globalThis as object, "fetch", originalFetch);
      }
    } finally {
      await replayRecorder.close();
    }
  });

  it("raises on replay mismatches", async () => {
    const cassettePath = await makeTempCassette("mismatch.json");
    const recordRecorder = await Recorder.open(cassettePath, { mode: RecordMode.RECORD });
    const originalFetch = globalThis.fetch;
    Reflect.set(globalThis as object, "fetch", async () =>
      new Response(JSON.stringify(envelope({ ok: true })), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    try {
      await recordRecorder.withGlobalFetch(() =>
        fetch("https://api.example.test/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "camera" }),
        }),
      );
    } finally {
      Reflect.set(globalThis as object, "fetch", originalFetch);
      await recordRecorder.close();
    }

    const replayRecorder = await Recorder.open(cassettePath, { mode: RecordMode.REPLAY });
    try {
      await expect(
        replayRecorder.withGlobalFetch(() =>
          fetch("https://api.example.test/events", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query: "laptop" }),
          }),
        ),
      ).rejects.toThrow("Replay request mismatch");
    } finally {
      await replayRecorder.close();
    }
  });

  it("preserves repeated query params and repeated response headers in cassettes", async () => {
    const cassettePath = await makeTempCassette("repeat-values.json");
    const recorder = await Recorder.open(cassettePath, { mode: RecordMode.RECORD });
    const originalFetch = globalThis.fetch;
    const upstreamHeaders = new Headers();
    upstreamHeaders.append("set-cookie", "a=1");
    upstreamHeaders.append("set-cookie", "b=2");
    Reflect.set(globalThis as object, "fetch", async () =>
      new Response(JSON.stringify(envelope({ ok: true })), {
        status: 200,
        headers: upstreamHeaders,
      }));
    try {
      await recorder.withGlobalFetch(() =>
        fetch("https://api.example.test/items?tag=a&tag=b&api_key=query-secret", {
          headers: { authorization: "Bearer sig_secret" },
        }),
      );
    } finally {
      Reflect.set(globalThis as object, "fetch", originalFetch);
      await recorder.close();
    }

    const cassette = JSON.parse(await readFile(cassettePath, "utf8")) as {
      interactions: Array<{ request: { url: string }; response: { headers: Record<string, string | string[]> } }>;
    };
    expect(cassette.interactions[0]?.request.url).toContain("tag=a&tag=b");
    expect(cassette.interactions[0]?.response.headers["set-cookie"]).toEqual(["<REDACTED>", "<REDACTED>"]);
  });

  it("replays multipart form-data uploads by normalizing boundaries", async () => {
    const cassettePath = await makeTempCassette("multipart.json");
    const recordRecorder = await Recorder.open(cassettePath, { mode: RecordMode.RECORD });
    const originalFetch = globalThis.fetch;
    const fileBytes = new Uint8Array([255, 0, 254, 16, 98, 105, 110, 97, 114, 121]);
    Reflect.set(globalThis as object, "fetch", async () =>
      new Response(JSON.stringify(envelope({ ok: true })), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    try {
      await recordRecorder.withGlobalFetch(() => {
        const formData = new FormData();
        formData.set("note", "hello");
        formData.set("file", new Blob([fileBytes], { type: "application/octet-stream" }), "hello.bin");
        return fetch("https://api.example.test/upload", {
          method: "POST",
          body: formData,
        });
      });
    } finally {
      Reflect.set(globalThis as object, "fetch", originalFetch);
      await recordRecorder.close();
    }

    const cassetteText = await readFile(cassettePath, "utf8");
    expect(cassetteText).toContain("\"encoding\": \"base64\"");
    expect(cassetteText).toContain("boundary=<BOUNDARY>");

    const replayRecorder = await Recorder.open(cassettePath, { mode: RecordMode.REPLAY });
    Reflect.set(globalThis as object, "fetch", async () => {
      throw new Error("Replay should not hit fetch");
    });
    try {
      const replayed = await replayRecorder.withGlobalFetch(() => {
        const formData = new FormData();
        formData.set("note", "hello");
        formData.set("file", new Blob([fileBytes], { type: "application/octet-stream" }), "hello.bin");
        return fetch("https://api.example.test/upload", {
          method: "POST",
          body: formData,
        });
      });
      expect((await replayed.json()).data.ok).toBe(true);
    } finally {
      Reflect.set(globalThis as object, "fetch", originalFetch);
      await replayRecorder.close();
    }

    const mismatchRecorder = await Recorder.open(cassettePath, { mode: RecordMode.REPLAY });
    Reflect.set(globalThis as object, "fetch", async () => {
      throw new Error("Replay should not hit fetch");
    });
    try {
      await expect(
        mismatchRecorder.withGlobalFetch(() => {
          const formData = new FormData();
          formData.set("note", "hello");
          formData.set("file", new Blob([new Uint8Array([0, 1, 2, 3])], { type: "application/octet-stream" }), "hello.bin");
          return fetch("https://api.example.test/upload", {
            method: "POST",
            body: formData,
          });
        }),
      ).rejects.toThrow("Replay request mismatch");
    } finally {
      Reflect.set(globalThis as object, "fetch", originalFetch);
      await mismatchRecorder.close();
    }
  });
});

class FetchQuoteApp extends AppAdapter {
  manifest() {
    return {
      capability_key: "fetch-quote",
      name: "Fetch Quote",
      job_to_be_done: "Quote a price from an upstream HTTP service.",
      category: AppCategory.COMMERCE,
      permission_class: PermissionClass.READ_ONLY,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
      jurisdiction: "US",
      short_description: "Calls a quote API via fetch.",
      example_prompts: ["Quote this item."],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const response = await fetch("https://api.example.test/quote", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer harness-secret" },
      body: JSON.stringify({
        query: String(ctx.input_params?.query ?? "headphones"),
        timestamp: "2026-04-19T00:00:00Z",
      }),
    });
    const payload = await response.json() as { data: Record<string, unknown> };
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: payload.data,
    };
  }
}

describe("AppTestHarness recorder helpers", () => {
  it("records and replays fetch calls inside harness helpers", async () => {
    const cassettePath = await makeTempCassette("harness.json");
    const harness = new AppTestHarness(new FetchQuoteApp());
    const originalFetch = globalThis.fetch;

    Reflect.set(globalThis as object, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      return new Response(JSON.stringify(envelope({
        summary: `quoted:${String(body.query ?? "")}`,
        provider_status: "ok",
      })), { status: 200, headers: { "content-type": "application/json" } });
    });

    try {
      const recorded = await harness.record(cassettePath, (currentHarness) =>
        currentHarness.dry_run("quote_lookup", { input_params: { query: "sony" } }),
      );
      expect(recorded.output?.summary).toBe("quoted:sony");
    } finally {
      Reflect.set(globalThis as object, "fetch", originalFetch);
    }

    Reflect.set(globalThis as object, "fetch", async () => {
      throw new Error("Replay should not hit fetch");
    });

    try {
      const replayed = await harness.replay(cassettePath, (currentHarness) =>
        currentHarness.dry_run("quote_lookup", { input_params: { query: "sony" } }),
      );
      expect(replayed.output?.summary).toBe("quoted:sony");
    } finally {
      Reflect.set(globalThis as object, "fetch", originalFetch);
    }
  });

  it("redacts non-Bearer Authorization schemes (Codex P1 on PR #105)", async () => {
    // Any Authorization value must be redacted, not only the Bearer form.
    // Basic / Digest / custom-token schemes previously leaked through
    // because they did not match the narrow secret regexes in redactString.
    const dir = await mkdtemp(join(tmpdir(), "siglume-auth-scheme-"));
    tempDirs.push(dir);
    const cassettePath = join(dir, "auth_schemes.json");

    const originalFetch = globalThis.fetch;
    Reflect.set(globalThis as object, "fetch", async (input: RequestInfo | URL) => {
      void input;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const recorder = new Recorder(cassettePath, { mode: RecordMode.RECORD });
    await recorder.start();
    try {
      await recorder.withGlobalFetch(async () => {
        await fetch("https://api.example.test/a", {
          headers: { Authorization: "Basic dXNlcjpwYXNzd29yZA==" },
        });
        await fetch("https://api.example.test/b", {
          headers: { Authorization: "Digest username=\"alice\", nonce=\"abc\"" },
        });
        await fetch("https://api.example.test/c", {
          headers: { Authorization: "Sig-Token abcdef123456" },
        });
      });
    } finally {
      await recorder.close();
      Reflect.set(globalThis as object, "fetch", originalFetch);
    }

    const raw = await readFile(cassettePath, "utf8");
    const data = JSON.parse(raw) as {
      interactions: Array<{ request: { headers: Record<string, string> } }>;
    };
    const headers = data.interactions.map((i) => i.request.headers.authorization);
    expect(headers[0]).toBe("Basic <REDACTED>");
    expect(headers[1]).toBe("Digest <REDACTED>");
    expect(headers[2]).toBe("Sig-Token <REDACTED>");
  });

  it("fully redacts scheme-less Authorization headers (Codex P1 on PR #109)", async () => {
    // A bare-token Authorization (no whitespace, no scheme prefix — e.g.
    // a raw GitHub PAT or hex API key) was previously written back as
    // "${secret} <REDACTED>" because the first split token was treated as
    // the "scheme" and preserved. The whole value IS the credential in
    // that case and must be fully redacted.
    const dir = await mkdtemp(join(tmpdir(), "siglume-auth-bare-"));
    tempDirs.push(dir);
    const cassettePath = join(dir, "bare_token.json");

    const originalFetch = globalThis.fetch;
    Reflect.set(globalThis as object, "fetch", async (input: RequestInfo | URL) => {
      void input;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const recorder = new Recorder(cassettePath, { mode: RecordMode.RECORD });
    await recorder.start();
    try {
      await recorder.withGlobalFetch(async () => {
        await fetch("https://api.example.test/a", {
          headers: { Authorization: "ghp_abcdef0123456789abcdef0123456789abcdef" },
        });
        await fetch("https://api.example.test/b", {
          headers: { Authorization: "0xdeadbeefcafe1234567890abcdef0123456789ab" },
        });
      });
    } finally {
      await recorder.close();
      Reflect.set(globalThis as object, "fetch", originalFetch);
    }

    const raw = await readFile(cassettePath, "utf8");
    const data = JSON.parse(raw) as {
      interactions: Array<{ request: { headers: Record<string, string> } }>;
    };
    const headers = data.interactions.map((i) => i.request.headers.authorization);
    // Must be the fully-masked form — not `ghp_... <REDACTED>` which would leak.
    expect(headers[0]).toBe("<REDACTED>");
    expect(headers[1]).toBe("<REDACTED>");
    expect(raw).not.toContain("ghp_abcdef");
    expect(raw).not.toContain("0xdeadbeefcafe");
  });
});
