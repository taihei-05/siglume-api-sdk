import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SiglumeBuyerClient,
  SiglumeClientError,
  SiglumeExperimentalError,
} from "../src/index";
import { runMockBuyerClaudeExample } from "../../examples/buyer_claude_agent_sdk";

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(String(input));
}

function loadFixtureListings(): Array<Record<string, unknown>> {
  const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "fixtures", "buyer_search_cases.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")).listings as Array<Record<string, unknown>>;
}

function envelope(data: Record<string, unknown>, meta: Record<string, unknown> = { request_id: "req_buyer", trace_id: "trc_buyer" }) {
  return { data, meta, error: null };
}

function buildClient(
  fetchImpl: typeof fetch,
  options: Partial<ConstructorParameters<typeof SiglumeBuyerClient>[0]> = {},
): SiglumeBuyerClient {
  return new SiglumeBuyerClient({
    api_key: "sig_test_key",
    base_url: "https://api.example.test/v1",
    fetch: fetchImpl,
    ...options,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SiglumeBuyerClient", () => {
  it("uses SIGLUME_API_KEY fallback for buyer Authorization headers", async () => {
    const previous = process.env.SIGLUME_API_KEY;
    process.env.SIGLUME_API_KEY = " sig_env_key ";
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => process);
    try {
      const client = new SiglumeBuyerClient({
        base_url: "https://api.example.test/v1",
        fetch: async (_input, init) => {
          expect((init?.headers as Headers).get("Authorization")).toBe("Bearer sig_env_key");
          return new Response(JSON.stringify(envelope({ items: [], next_cursor: null, limit: 20, offset: 0 })), {
            status: 200,
          });
        },
      });

      await client.search_capabilities({ query: "currency", limit: 1 });
      client.close();
      expect(emitWarning).toHaveBeenCalledOnce();
    } finally {
      if (previous === undefined) {
        delete process.env.SIGLUME_API_KEY;
      } else {
        process.env.SIGLUME_API_KEY = previous;
      }
    }
  });

  it("lets explicit buyer API keys override SIGLUME_API_KEY", async () => {
    const previous = process.env.SIGLUME_API_KEY;
    process.env.SIGLUME_API_KEY = "sig_env_key";
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => process);
    try {
      const client = new SiglumeBuyerClient({
        api_key: " sig_explicit_key ",
        base_url: "https://api.example.test/v1",
        fetch: async (_input, init) => {
          expect((init?.headers as Headers).get("Authorization")).toBe("Bearer sig_explicit_key");
          return new Response(JSON.stringify(envelope({ items: [], next_cursor: null, limit: 20, offset: 0 })), {
            status: 200,
          });
        },
      });

      await client.search_capabilities({ query: "currency", limit: 1 });
      client.close();
      expect(emitWarning).toHaveBeenCalledOnce();
    } finally {
      if (previous === undefined) {
        delete process.env.SIGLUME_API_KEY;
      } else {
        process.env.SIGLUME_API_KEY = previous;
      }
    }
  });

  it("rejects explicit empty buyer API keys even when SIGLUME_API_KEY is set", () => {
    const previous = process.env.SIGLUME_API_KEY;
    process.env.SIGLUME_API_KEY = "sig_env_key";
    try {
      expect(() => new SiglumeBuyerClient({
        api_key: "",
        base_url: "https://api.example.test/v1",
      })).toThrow(SiglumeClientError);
    } finally {
      if (previous === undefined) {
        delete process.env.SIGLUME_API_KEY;
      } else {
        process.env.SIGLUME_API_KEY = previous;
      }
    }
  });

  it("searches with local substring scoring and returns the strongest match first", async () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => process);
    const client = buildClient(async (input) => {
      const url = requestUrl(input);
      expect(url.pathname).toBe("/v1/market/capabilities");
      return new Response(JSON.stringify(envelope({ items: loadFixtureListings(), next_cursor: null, limit: 20, offset: 0 })), {
        status: 200,
      });
    });

    const results = await client.search_capabilities({ query: "convert currency", limit: 3 });

    expect(results[0]?.capability_key).toBe("currency-converter-v2");
    expect(results[0]!.tool_manual.tool_name).toBe("currency_converter_v2");
    expect(emitWarning).toHaveBeenCalledOnce();
  });

  it("filters by permission class and limit", async () => {
    const client = buildClient(async () => new Response(JSON.stringify(envelope({ items: loadFixtureListings(), next_cursor: null, limit: 20, offset: 0 })), {
      status: 200,
    }));

    const results = await client.search_capabilities({ query: "email", permission_class: "action", limit: 1 });

    expect(results).toHaveLength(1);
    expect(results[0]!.capability_key).toBe("invoice-emailer");
  });

  it("resolves a capability key and synthesizes a minimal tool manual", async () => {
    const client = buildClient(async () => new Response(JSON.stringify(envelope({ items: loadFixtureListings(), next_cursor: null, limit: 20, offset: 0 })), {
      status: 200,
    }));

    const listing = await client.get_listing("currency-converter-v2");

    expect(listing.listing_id).toBe("lst_currency");
    expect(listing.description).toContain("live exchange rates");
    expect((listing.tool_manual.input_schema as Record<string, unknown>).required).toEqual(["amount_usd", "to"]);
    expect(listing.experimental).toBe(true);
  });

  it("subscribes without binding when bind_agent is false", async () => {
    const client = buildClient(async (input) => {
      const url = requestUrl(input);
      if (url.pathname === "/v1/market/capabilities") {
        return new Response(JSON.stringify(envelope({ items: loadFixtureListings(), next_cursor: null, limit: 20, offset: 0 })), {
          status: 200,
        });
      }
      if (url.pathname === "/v1/market/capabilities/lst_currency/purchase") {
        return new Response(JSON.stringify(envelope({
          purchase_status: "created",
          access_grant: {
            id: "grant_123",
            capability_listing_id: "lst_currency",
            grant_status: "active",
          },
        }, { request_id: "req_purchase", trace_id: "trc_purchase" })), {
          status: 200,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const subscription = await client.subscribe({ capability_key: "currency-converter-v2", bind_agent: false });

    expect(subscription.access_grant_id).toBe("grant_123");
    expect(subscription.binding_id).toBeNull();
    expect(subscription.trace_id).toBe("trc_purchase");
  });

  it("binds a purchased grant when a default agent id is configured", async () => {
    const client = buildClient(async (input, init) => {
      const url = requestUrl(input);
      if (url.pathname === "/v1/market/capabilities") {
        return new Response(JSON.stringify(envelope({ items: loadFixtureListings(), next_cursor: null, limit: 20, offset: 0 })), {
          status: 200,
        });
      }
      if (url.pathname === "/v1/market/capabilities/lst_currency/purchase") {
        return new Response(JSON.stringify(envelope({
          purchase_status: "created",
          access_grant: {
            id: "grant_123",
            capability_listing_id: "lst_currency",
            grant_status: "active",
          },
        })), {
          status: 200,
        });
      }
      if (url.pathname === "/v1/market/access-grants/grant_123/bind-agent") {
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        expect(body.agent_id).toBe("agent_demo");
        return new Response(JSON.stringify(envelope({
          binding: {
            id: "bind_123",
            access_grant_id: "grant_123",
            agent_id: "agent_demo",
            binding_status: "active",
          },
          access_grant: {
            id: "grant_123",
            capability_listing_id: "lst_currency",
            grant_status: "active",
          },
        }, { request_id: "req_bind", trace_id: "trc_bind" })), {
          status: 200,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, { default_agent_id: "agent_demo" });

    const subscription = await client.subscribe({ capability_key: "currency-converter-v2" });

    expect(subscription.binding_id).toBe("bind_123");
    expect(subscription.agent_id).toBe("agent_demo");
    expect(subscription.trace_id).toBe("trc_bind");
  });

  it("maps accepted invoke responses into ExecutionResult", async () => {
    const client = buildClient(async (input, init) => {
      const url = requestUrl(input);
      if (url.pathname !== "/v1/internal/market/capability/execute") {
        throw new Error(`Unexpected request: ${url}`);
      }
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      expect((body.arguments as Record<string, unknown>).amount_usd).toBe(100);
      return new Response(JSON.stringify(envelope({
        accepted: true,
        allowed: true,
        reason: "accepted",
        reason_code: null,
        usage_event: { units_consumed: 1, execution_kind: "action" },
        result: {
          summary: "Converted USD 100.00 to JPY 15000.00.",
          amount: 15000,
          currency: "JPY",
        },
        receipt: { execution_kind: "action", currency: "JPY", amount_minor: 0 },
      }, { request_id: "req_exec", trace_id: "trc_exec" })), {
        status: 200,
      });
    }, { default_agent_id: "agent_demo", allow_internal_execute: true });

    const result = await client.invoke({
      capability_key: "currency-converter-v2",
      input: { amount_usd: 100, to: "JPY" },
    });

    expect(result.success).toBe(true);
    expect(result.output?.currency).toBe("JPY");
    expect(result.execution_kind).toBe("action");
  });

  it("maps approval-required invoke responses into approval hints", async () => {
    const client = buildClient(async () => new Response(JSON.stringify(envelope({
      accepted: false,
      allowed: false,
      reason: "owner approval is required before execution",
      reason_code: "APPROVAL_REQUIRED",
      approval_request: { id: "apr_123" },
      approval_explanation: {
        title: "Approve invoice email",
        preview: { summary: "Send invoice INV-1001 to finance@example.com" },
        side_effects: ["email delivery to finance@example.com"],
      },
      usage_event: { units_consumed: 1, execution_kind: "action" },
      receipt: { execution_kind: "action", currency: "USD", amount_minor: 0 },
    })), {
      status: 200,
    }), { default_agent_id: "agent_demo", allow_internal_execute: true });

    const result = await client.invoke({
      capability_key: "invoice-emailer",
      input: { invoice_id: "INV-1001" },
    });

    expect(result.success).toBe(false);
    expect(result.needs_approval).toBe(true);
    expect(result.approval_hint?.action_summary).toBe("Approve invoice email");
  });

  it("does not invent approval currency when the receipt omits it", async () => {
    const client = buildClient(async () => new Response(JSON.stringify(envelope({
      accepted: false,
      allowed: false,
      reason: "owner approval is required before execution",
      reason_code: "APPROVAL_REQUIRED",
      approval_request: { id: "apr_124" },
      approval_explanation: { title: "Approve invoice email" },
      usage_event: { units_consumed: 1, execution_kind: "payment" },
      receipt: { execution_kind: "payment", amount_minor: 9900 },
    })), {
      status: 200,
    }), { default_agent_id: "agent_demo", allow_internal_execute: true });

    const result = await client.invoke({
      capability_key: "invoice-emailer",
      input: { invoice_id: "INV-1002" },
    });

    expect(result.needs_approval).toBe(true);
    expect(result.approval_hint?.currency).toBeUndefined();
  });

  it("requires an explicit opt-in for internal execute and keeps the Claude example runnable", async () => {
    const client = buildClient(async () => new Response(JSON.stringify(envelope({})), { status: 200 }), {
      default_agent_id: "agent_demo",
    });

    await expect(
      client.invoke({
        capability_key: "currency-converter-v2",
        input: { amount_usd: 100 },
      }),
    ).rejects.toBeInstanceOf(SiglumeExperimentalError);

    const lines = await runMockBuyerClaudeExample();
    expect(lines[0]).toBe("tool_name: currency_converter_v2");
    expect(lines.at(-1)).toBe("result_currency: JPY");
  });
});
