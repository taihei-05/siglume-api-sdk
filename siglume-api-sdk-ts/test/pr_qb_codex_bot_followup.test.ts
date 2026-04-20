import { describe, expect, it } from "vitest";

import { SiglumeClient } from "../src/index";

function envelope(data: Record<string, unknown>) {
  return { data, meta: { request_id: "req_test", trace_id: "trc_test" }, error: null };
}

function urlOf(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  if (input instanceof URL) return input;
  return new URL(String(input));
}

describe("PR-Qb codex bot follow-up", () => {
  // ----- Q1: pagination wiring -------------------------------------------

  it("list_account_digests forwards cursor and wires fetchNext", async () => {
    const calls: Array<Record<string, string>> = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = urlOf(input);
        const params: Record<string, string> = {};
        url.searchParams.forEach((value, key) => {
          params[key] = value;
        });
        calls.push(params);
        const cursor = url.searchParams.get("cursor");
        if (cursor === null) {
          return new Response(
            JSON.stringify(
              envelope({
                items: [{ digest_id: "dig_p1_a" }, { digest_id: "dig_p1_b" }],
                next_cursor: "cursor-page-2",
              }),
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (cursor === "cursor-page-2") {
          return new Response(
            JSON.stringify(
              envelope({ items: [{ digest_id: "dig_p2_a" }], next_cursor: null }),
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected cursor: ${cursor}`);
      },
    });

    const page1 = await client.list_account_digests({ limit: 2 });
    expect(page1.next_cursor).toBe("cursor-page-2");
    expect(page1.items.length).toBe(2);

    expect(page1.all_items).toBeDefined();
    const all = await page1.all_items!();
    expect(all.length).toBe(3);

    expect(calls[0]?.limit).toBe("2");
    expect(calls[0]?.cursor).toBeUndefined();
    expect(calls[1]?.cursor).toBe("cursor-page-2");
    expect(calls[1]?.limit).toBe("2");
  });

  it("list_account_alerts forwards cursor and wires fetchNext", async () => {
    const calls: Array<Record<string, string>> = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = urlOf(input);
        const params: Record<string, string> = {};
        url.searchParams.forEach((value, key) => {
          params[key] = value;
        });
        calls.push(params);
        const cursor = url.searchParams.get("cursor");
        if (cursor === null) {
          return new Response(
            JSON.stringify(
              envelope({
                items: [{ alert_id: "alt_p1" }],
                next_cursor: "cursor-alert-2",
              }),
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (cursor === "cursor-alert-2") {
          return new Response(
            JSON.stringify(
              envelope({ items: [{ alert_id: "alt_p2" }], next_cursor: null }),
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected cursor: ${cursor}`);
      },
    });

    const page1 = await client.list_account_alerts({ limit: 1 });
    expect(page1.all_items).toBeDefined();
    const items = await page1.all_items!();
    expect(items.map((i) => i.alert_id)).toEqual(["alt_p1", "alt_p2"]);
    expect(calls[0]?.limit).toBe("1");
    expect(calls[1]?.cursor).toBe("cursor-alert-2");
  });

  // ----- Q2: remove favorite status --------------------------------------

  it("remove_account_favorite does not force status on failure", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () =>
        new Response(JSON.stringify(envelope({ ok: false })), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const result = await client.remove_account_favorite("agt_missing");
    expect(result.ok).toBe(false);
    expect(result.status).toBeUndefined();
    expect(result.agent_id).toBe("agt_missing");
  });

  it("remove_account_favorite infers status on success", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () =>
        new Response(JSON.stringify(envelope({ ok: true })), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const result = await client.remove_account_favorite("agt_success");
    expect(result.ok).toBe(true);
    expect(result.status).toBe("removed");
    expect(result.agent_id).toBe("agt_success");
  });

  it("remove_account_favorite passes through explicit status", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () =>
        new Response(
          JSON.stringify(envelope({ ok: true, status: "already_removed" })),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    const result = await client.remove_account_favorite("agt_explicit");
    expect(result.ok).toBe(true);
    expect(result.status).toBe("already_removed");
  });
});
