import { describe, expect, it } from "vitest";

import {
  AppCategory,
  ApprovalMode,
  PermissionClass,
  PriceModel,
  SiglumeClient,
  SiglumeClientError,
  SiglumeNotFoundError,
  ToolManualPermissionClass,
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
    jurisdiction: "US",
    docs_url: "https://docs.example.com/price-compare",
    support_contact: "support@example.com",
  };
}

function buildToolManual() {
  return {
    tool_name: "price_compare_helper",
    job_to_be_done: "Search multiple retailers for a product and return a ranked price comparison.",
    summary_for_model: "Looks up current retailer offers and returns the best deal first.",
    trigger_conditions: [
      "owner asks to compare prices for a product before deciding where to buy",
      "agent needs retailer offer data to support a shopping recommendation",
      "request is to find the cheapest or best-value option for a product query",
    ],
    do_not_use_when: ["the request is to complete checkout or place an order instead of comparing offers"],
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
      },
      required: ["summary"],
      additionalProperties: false,
    },
    usage_hints: ["Use this tool after the owner has named a product and wants evidence-backed price comparison."],
    result_hints: ["Lead with the best offer and then summarize notable trade-offs."],
    error_hints: ["If no offers are found, ask for a clearer product name or model number."],
  };
}

function buildRuntimeValidation() {
  return {
    public_base_url: "https://api.example.test",
    healthcheck_url: "https://api.example.test/health",
    invoke_url: "https://api.example.test/v1/price-compare",
    test_auth_header_name: "X-Siglume-Review-Key",
    test_auth_header_value: "review-secret",
    request_payload: { query: "Sony WH-1000XM5" },
    expected_response_fields: ["summary"],
  };
}

describe("SiglumeClient extra branches", () => {
  it("requires an api key at construction time", () => {
    const previous = process.env.SIGLUME_API_KEY;
    delete process.env.SIGLUME_API_KEY;
    try {
      expect(() => new SiglumeClient({ api_key: "" })).toThrow("Pass it as the api_key option");
    } finally {
      if (previous === undefined) {
        delete process.env.SIGLUME_API_KEY;
      } else {
        process.env.SIGLUME_API_KEY = previous;
      }
    }
  });

  it("reads SIGLUME_API_KEY from the environment and lets explicit options override it", () => {
    const previous = process.env.SIGLUME_API_KEY;
    process.env.SIGLUME_API_KEY = " sig_env_key ";
    try {
      const envClient = new SiglumeClient({ base_url: "https://api.example.test/v1" });
      const explicitClient = new SiglumeClient({
        api_key: "sig_explicit_key",
        base_url: "https://api.example.test/v1",
      });

      expect(envClient.api_key).toBe("sig_env_key");
      expect(explicitClient.api_key).toBe("sig_explicit_key");
    } finally {
      if (previous === undefined) {
        delete process.env.SIGLUME_API_KEY;
      } else {
        process.env.SIGLUME_API_KEY = previous;
      }
    }
  });

  it("prefers source_url or source_code and allows confirmation overrides", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        requests.push({ path: url.pathname, body });
        if (url.pathname.endsWith("/auto-register")) {
          return new Response(JSON.stringify({ data: { listing_id: "lst_url", status: "draft" } }), {
            status: 201,
            headers: { "x-request-id": "req_1", "x-trace-id": "trc_1" },
          });
        }
        return new Response(
          JSON.stringify({
            data: {
              listing_id: "lst_url",
              status: "pending_review",
              release: {},
              quality: { score: 88, grade: "B", issues: [], improvement_suggestions: [] },
            },
          }),
          { status: 200 },
        );
      },
    });

    const receipt = await client.auto_register(buildManifest(), buildToolManual(), {
      source_url: "https://github.com/example/repo",
      runtime_validation: buildRuntimeValidation(),
    });
    const confirmation = await client.confirm_registration("lst_url", {
      manifest: { name: "Override Name", job_to_be_done: "Override job" },
      tool_manual: { tool_name: "override_tool" },
    });
    client.close();

    expect(receipt.trace_id).toBe("trc_1");
    expect(requests[0]?.body.source_url).toBe("https://github.com/example/repo");
    expect(requests[0]?.body.source_code).toBeUndefined();
    expect((requests[1]?.body.overrides as Record<string, unknown>).name).toBe("Override Name");
    expect(((requests[1]?.body.overrides as Record<string, unknown>).tool_manual as Record<string, unknown>).tool_name).toBe(
      "override_tool",
    );
    expect(confirmation.quality.grade).toBe("B");
  });

  it("supports list_my_listings, allItems alias, and invalid-json success responses", async () => {
    let sawMine = false;
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/capabilities") {
          sawMine = url.searchParams.get("mine") === "true";
          return new Response(
            JSON.stringify({
              data: {
                items: [{ id: "lst_1", capability_key: "price-compare-helper", name: "Price Compare Helper", status: "draft" }],
                next_cursor: null,
              },
            }),
            { status: 200 },
          );
        }
        return new Response("not-json", {
          status: 200,
          headers: { "x-request-id": "req_raw", "x-trace-id": "trc_raw" },
        });
      },
    });

    const page = await client.list_my_listings();
    const listing = await client.get_listing("broken_json");

    expect(sawMine).toBe(true);
    expect((await page.allItems()).map((item) => item.listing_id)).toEqual(["lst_1"]);
    expect(listing.listing_id).toBe("");
  });

  it("maps top-level preview errors and 404 responses", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/tool-manuals/preview-quality") {
          return new Response(
            JSON.stringify({
              ok: false,
              errors: [{ code: "BAD_ROOT", message: "tool manual must be a dict", field: "tool_manual" }],
              warnings: [{ code: "LOW_HINTS", message: "add more hints", field: "usage_hints" }],
              quality: {
                score: 81,
                grade: "B",
                keyword_coverage: 11,
                improvement_suggestions: ["Add more details."],
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "missing" } }), { status: 404 });
      },
    });

    const quality = await client.preview_quality_score(buildToolManual());

    expect(quality.validation_ok).toBe(false);
    expect(quality.publishable).toBe(false);
    expect(quality.validation_errors).toHaveLength(1);
    expect(quality.validation_warnings).toHaveLength(1);
    await expect(client.get_listing("missing")).rejects.toBeInstanceOf(SiglumeNotFoundError);
  });

  it("retries transport failures and surfaces client errors when retries are exhausted", async () => {
    let attempts = 0;
    const retryingClient = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      max_retries: 2,
      timeout_ms: 20,
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("socket closed");
        }
        return new Response(JSON.stringify({ data: { id: "lst_2", capability_key: "price-compare-helper", name: "ok", status: "published" } }), {
          status: 200,
        });
      },
    });

    const listing = await retryingClient.get_listing("lst_2");
    expect(attempts).toBe(2);
    expect(listing.listing_id).toBe("lst_2");

    const failingClient = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      max_retries: 1,
      fetch: async () => {
        throw new Error("network down");
      },
    });
    await expect(failingClient.get_listing("lst_3")).rejects.toBeInstanceOf(SiglumeClientError);
  });
});
