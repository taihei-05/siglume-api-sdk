import { describe, expect, it } from "vitest";

import { SiglumeClient, SiglumeClientError } from "../src/index";

function envelope(data: Record<string, unknown>) {
  return { data, meta: { request_id: "req_test", trace_id: "trc_test" }, error: null };
}

function urlOf(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  if (input instanceof URL) return input;
  return new URL(String(input));
}

function buildClient(fetchImpl: typeof globalThis.fetch): SiglumeClient {
  return new SiglumeClient({
    api_key: "sig_test_key",
    base_url: "https://api.example.test/v1",
    fetch: fetchImpl,
  });
}

describe("PR-S2a codex bot follow-up: /me/agent id fallback", () => {
  it("accepts agent_id field (current shape)", async () => {
    const paths: string[] = [];
    const client = buildClient(async (input) => {
      const url = urlOf(input);
      paths.push(url.pathname);
      if (url.pathname === "/v1/me/agent") {
        return new Response(JSON.stringify(envelope({ agent_id: "agt_current" })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname === "/v1/owner/agents/agt_current/operations/execute") {
        return new Response(
          JSON.stringify(
            envelope({
              status: "completed",
              result: { items: [], next_cursor: null, limit: 20, offset: 0 },
            }),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url.pathname}`);
    });

    const page = await client.list_market_needs();
    expect(page.items).toEqual([]);
    expect(paths).toContain("/v1/me/agent");
    expect(paths).toContain("/v1/owner/agents/agt_current/operations/execute");
  });

  it("accepts legacy id field (codex-bot P1 case)", async () => {
    const paths: string[] = [];
    const client = buildClient(async (input) => {
      const url = urlOf(input);
      paths.push(url.pathname);
      if (url.pathname === "/v1/me/agent") {
        return new Response(JSON.stringify(envelope({ id: "agt_legacy" })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname === "/v1/owner/agents/agt_legacy/operations/execute") {
        return new Response(
          JSON.stringify(
            envelope({
              status: "completed",
              result: { items: [], next_cursor: null, limit: 20, offset: 0 },
            }),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url.pathname}`);
    });

    const page = await client.list_market_needs();
    expect(page.items).toEqual([]);
    expect(paths).toContain("/v1/owner/agents/agt_legacy/operations/execute");
  });

  it("prefers agent_id over legacy id when both are present", async () => {
    const paths: string[] = [];
    const client = buildClient(async (input) => {
      const url = urlOf(input);
      paths.push(url.pathname);
      if (url.pathname === "/v1/me/agent") {
        return new Response(
          JSON.stringify(envelope({ agent_id: "agt_new", id: "agt_old" })),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/v1/owner/agents/agt_new/operations/execute") {
        return new Response(
          JSON.stringify(
            envelope({
              status: "completed",
              result: { items: [], next_cursor: null, limit: 20, offset: 0 },
            }),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url.pathname}`);
    });

    await client.list_market_needs();
    expect(paths).toContain("/v1/owner/agents/agt_new/operations/execute");
    expect(paths).not.toContain("/v1/owner/agents/agt_old/operations/execute");
  });

  it("honors explicit agent_id argument without calling /me/agent", async () => {
    const client = buildClient(async (input) => {
      const url = urlOf(input);
      if (url.pathname === "/v1/me/agent") {
        throw new Error("must not call /me/agent when agent_id is explicit");
      }
      if (url.pathname === "/v1/owner/agents/agt_explicit/operations/execute") {
        return new Response(
          JSON.stringify(
            envelope({
              status: "completed",
              result: { items: [], next_cursor: null, limit: 20, offset: 0 },
            }),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url.pathname}`);
    });

    await client.list_market_needs({ agent_id: "agt_explicit" });
  });

  it("raises when /me/agent has neither agent_id nor id", async () => {
    const client = buildClient(async (input) => {
      const url = urlOf(input);
      if (url.pathname === "/v1/me/agent") {
        return new Response(JSON.stringify(envelope({ something_else: "x" })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url.pathname}`);
    });

    await expect(client.list_market_needs()).rejects.toThrow(SiglumeClientError);
  });
});
