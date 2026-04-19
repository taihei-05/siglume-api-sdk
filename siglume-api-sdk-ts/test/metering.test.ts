import { describe, expect, it } from "vitest";

import {
  AppAdapter,
  AppCategory,
  AppTestHarness,
  ApprovalMode,
  MeterClient,
  PermissionClass,
  PriceModel,
  SiglumeClientError,
  SiglumeNotFoundError,
  normalizeUsageRecord,
  type ExecutionContext,
  type ExecutionResult,
  type UsageRecord,
} from "../src/index";

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(String(input));
}

function envelope(data: unknown, meta: Record<string, unknown> = { request_id: "req_meter", trace_id: "trc_meter" }) {
  return { data, meta, error: null };
}

class MeteredApp extends AppAdapter {
  constructor(private readonly priceModel: string) {
    super();
  }

  manifest() {
    return {
      capability_key: "translation-hub",
      name: "Translation Hub",
      job_to_be_done: "Translate text while previewing token-based usage metering.",
      category: AppCategory.COMMUNICATION,
      permission_class: PermissionClass.READ_ONLY,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: this.priceModel as typeof PriceModel[keyof typeof PriceModel],
      price_value_minor: 5,
      jurisdiction: "US",
      short_description: "Translate text and preview token-based usage line items.",
      example_prompts: ["Translate this roadmap update into Japanese."],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: { summary: "translated" },
    };
  }
}

describe("metering", () => {
  it("records a single usage event", async () => {
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        expect(url.pathname).toBe("/v1/market/usage-events");
        const body = init?.body ? JSON.parse(String(init.body)) as { events: UsageRecord[] } : { events: [] };
        expect(body.events[0]?.dimension).toBe("tokens_in");
        return new Response(JSON.stringify(envelope({
          items: [{
            accepted: true,
            external_id: "evt_usage_001",
            server_id: "use_001",
            replayed: false,
            capability_key: "translation-hub",
            agent_id: "agent_demo",
            period_key: "202604",
          }],
          count: 1,
        })), { status: 202 });
      },
    });

    const result = await client.record({
      capability_key: "translation-hub",
      dimension: "tokens_in",
      units: 1523,
      external_id: "evt_usage_001",
      occurred_at_iso: "2026-04-19T10:00:00Z",
      agent_id: "agent_demo",
    });

    expect(result.accepted).toBe(true);
    expect(result.server_id).toBe("use_001");
    expect(result.period_key).toBe("202604");
  });

  it("chunks large batches at 1000 events", async () => {
    const batchSizes: number[] = [];
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (_input, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as { events: UsageRecord[] } : { events: [] };
        batchSizes.push(body.events.length);
        return new Response(JSON.stringify(envelope({
          items: body.events.map((event, index) => ({
            accepted: true,
            external_id: event.external_id,
            server_id: `use_${index}`,
            replayed: false,
            capability_key: event.capability_key,
            agent_id: event.agent_id ?? null,
            period_key: "202604",
          })),
          count: body.events.length,
        })), { status: 202 });
      },
    });

    const records = Array.from({ length: 1001 }, (_, index) => ({
      capability_key: "translation-hub",
      dimension: "calls",
      units: 1,
      external_id: `evt_batch_${index}`,
      occurred_at_iso: "2026-04-19T10:00:00Z",
    }));
    const results = await client.record_batch(records);

    expect(batchSizes).toEqual([1000, 1]);
    expect(results).toHaveLength(1001);
    expect(results.at(-1)?.external_id).toBe("evt_batch_1000");
  });

  it("returns an empty array for empty batches", async () => {
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => {
        throw new Error("fetch should not run for empty batches");
      },
    });

    await expect(client.record_batch([])).resolves.toEqual([]);
  });

  it("validates usage records client-side", async () => {
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.record({
      capability_key: "translation-hub",
      dimension: "tokens_in",
      units: -1,
      external_id: "evt_bad_units",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    })).rejects.toBeInstanceOf(SiglumeClientError);

    await expect(client.record({
      capability_key: "translation-hub",
      dimension: "tokens_in",
      units: 1,
      external_id: "",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    })).rejects.toBeInstanceOf(SiglumeClientError);

    await expect(client.record({
      capability_key: "translation-hub",
      dimension: "tokens_in",
      units: 1,
      external_id: "evt_bad_time",
      occurred_at_iso: "2026-04-19 10:00:00",
    })).rejects.toBeInstanceOf(SiglumeClientError);
  });

  it("normalizes string integers and drops blank agent ids", () => {
    const normalized = normalizeUsageRecord({
      capability_key: "translation-hub",
      dimension: "calls",
      units: "7" as unknown as number,
      external_id: "evt_usage_007",
      occurred_at_iso: "2026-04-19T10:00:00Z",
      agent_id: "   ",
    });

    expect(normalized.units).toBe(7);
    expect("agent_id" in normalized).toBe(false);
  });

  it("rejects malformed usage-record fields across the remaining validation branches", () => {
    expect(() => normalizeUsageRecord({
      capability_key: "",
      dimension: "calls",
      units: 1,
      external_id: "evt_missing_capability",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    })).toThrow(SiglumeClientError);

    expect(() => normalizeUsageRecord({
      capability_key: "translation-hub",
      dimension: "",
      units: 1,
      external_id: "evt_missing_dimension",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    })).toThrow(SiglumeClientError);

    expect(() => normalizeUsageRecord({
      capability_key: "translation-hub",
      dimension: "calls",
      units: "-3" as unknown as number,
      external_id: "evt_negative_string_units",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    })).toThrow(SiglumeClientError);

    expect(() => normalizeUsageRecord({
      capability_key: "translation-hub",
      dimension: "calls",
      units: 1,
      external_id: "evt_missing_timestamp",
      occurred_at_iso: "",
    })).toThrow(SiglumeClientError);
  });

  it("lists usage events with extended fields", async () => {
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        expect(url.pathname).toBe("/v1/market/usage");
        return new Response(JSON.stringify(envelope({
          items: [{
            id: "use_123",
            capability_key: "translation-hub",
            agent_id: "agent_demo",
            dimension: "tokens_out",
            units_consumed: 240,
            external_id: "evt_usage_123",
            occurred_at_iso: "2026-04-19T10:05:00Z",
            period_key: "202604",
            created_at: "2026-04-19T10:05:01Z",
            metadata: { source: "test" },
          }],
          next_cursor: null,
          limit: 50,
          offset: 0,
        })), { status: 200 });
      },
    });

    const page = await client.list_usage_events({ capability_key: "translation-hub", period_key: "202604" });

    expect(page.items[0]?.dimension).toBe("tokens_out");
    expect(page.items[0]?.external_id).toBe("evt_usage_123");
    expect(page.items[0]?.occurred_at_iso).toBe("2026-04-19T10:05:00Z");
  });

  it("retries transient ingest errors before succeeding", async () => {
    let attempts = 0;
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(JSON.stringify({ error: { code: "TEMP", message: "retry later" } }), {
            status: 500,
            headers: { "Retry-After": "0" },
          });
        }
        return new Response(JSON.stringify({
          data: {
            items: [{
              accepted: true,
              external_id: "evt_usage_retry",
              server_id: "use_retry",
              replayed: false,
              capability_key: "translation-hub",
              agent_id: null,
              period_key: "202604",
            }],
          },
          error: null,
        }), {
          status: 202,
          headers: { "x-request-id": "req_retry", "x-trace-id": "trc_retry" },
        });
      },
    });

    const result = await client.record({
      capability_key: "translation-hub",
      dimension: "calls",
      units: 1,
      external_id: "evt_usage_retry",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    });

    expect(attempts).toBe(2);
    expect(result.server_id).toBe("use_retry");
  });

  it("raises when the ingest response omits the items array", async () => {
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response(JSON.stringify(envelope({ count: 1 })), { status: 202 }),
    });

    await expect(client.record_batch([{
      capability_key: "translation-hub",
      dimension: "calls",
      units: 1,
      external_id: "evt_bad_items",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    }])).rejects.toBeInstanceOf(SiglumeClientError);
  });

  it("ignores non-object items while preserving valid ingest results", async () => {
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response(JSON.stringify(envelope({
        items: [null, {
          accepted: true,
          external_id: "evt_usage_valid",
          server_id: "use_valid",
          replayed: false,
          capability_key: "translation-hub",
          agent_id: null,
          period_key: "202604",
        }],
        count: 2,
      })), { status: 202 }),
    });

    const results = await client.record_batch([{
      capability_key: "translation-hub",
      dimension: "calls",
      units: 1,
      external_id: "evt_usage_valid",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    }]);

    expect(results).toHaveLength(1);
    expect(results[0]?.server_id).toBe("use_valid");
  });

  it("raises when a single-record call receives an empty result set", async () => {
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response(JSON.stringify(envelope({ items: [], count: 0 })), { status: 202 }),
    });

    await expect(client.record({
      capability_key: "translation-hub",
      dimension: "calls",
      units: 1,
      external_id: "evt_empty_items",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    })).rejects.toBeInstanceOf(SiglumeClientError);
  });

  it("surfaces 404s as not-found errors", async () => {
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response(JSON.stringify({ error: { code: "MISSING", message: "not found" } }), { status: 404 }),
    });

    await expect(client.record({
      capability_key: "translation-hub",
      dimension: "calls",
      units: 1,
      external_id: "evt_missing",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    })).rejects.toBeInstanceOf(SiglumeNotFoundError);
  });

  it("wraps final network failures into SiglumeClientError", async () => {
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      max_retries: 1,
      fetch: async () => {
        throw new Error("network down");
      },
    });

    await expect(client.record({
      capability_key: "translation-hub",
      dimension: "calls",
      units: 1,
      external_id: "evt_network_down",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    })).rejects.toThrow("network down");
  });

  it("wraps non-Error throws into SiglumeClientError", async () => {
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      max_retries: 1,
      fetch: async () => {
        throw "boom";
      },
    });

    await expect(client.record({
      capability_key: "translation-hub",
      dimension: "calls",
      units: 1,
      external_id: "evt_non_error_throw",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    })).rejects.toThrow("Siglume request failed.");
  });

  it("treats 204 responses as empty payloads and raises a typed ingest error", async () => {
    const client = new MeterClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response(null, { status: 204 }),
    });

    await expect(client.record({
      capability_key: "translation-hub",
      dimension: "calls",
      units: 1,
      external_id: "evt_no_content",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    })).rejects.toBeInstanceOf(SiglumeClientError);
  });

  it("simulates usage-based metering previews", async () => {
    const harness = new AppTestHarness(new MeteredApp(PriceModel.USAGE_BASED));

    const preview = await harness.simulate_metering({
      capability_key: "translation-hub",
      dimension: "tokens_in",
      units: 1523,
      external_id: "evt_usage_001",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    });

    expect(preview.experimental).toBe(true);
    expect(preview.invoice_line_preview?.subtotal_minor).toBe(7615);
    expect(preview.invoice_line_preview?.billable_units).toBe(1523);
  });

  it("simulates per-action metering previews", async () => {
    const harness = new AppTestHarness(new MeteredApp(PriceModel.PER_ACTION));

    const preview = await harness.simulate_metering({
      capability_key: "translation-hub",
      dimension: "calls",
      units: 99,
      external_id: "evt_usage_002",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    }, {
      execution_result: {
        success: true,
        execution_kind: "action",
        output: { summary: "done" },
      },
    });

    expect(preview.invoice_line_preview?.billable_units).toBe(1);
    expect(preview.invoice_line_preview?.subtotal_minor).toBe(5);
  });

  it("returns no invoice preview for non-metered models", async () => {
    const harness = new AppTestHarness(new MeteredApp(PriceModel.SUBSCRIPTION));

    const preview = await harness.simulate_metering({
      capability_key: "translation-hub",
      dimension: "calls",
      units: 1,
      external_id: "evt_usage_003",
      occurred_at_iso: "2026-04-19T10:00:00Z",
    });

    expect(preview.experimental).toBe(false);
    expect(preview.invoice_line_preview).toBeNull();
  });
});
