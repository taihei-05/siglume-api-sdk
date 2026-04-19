import { describe, expect, it } from "vitest";

import {
  AppCategory,
  ApprovalMode,
  PermissionClass,
  PriceModel,
  SiglumeAPIError,
  SiglumeClient,
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

describe("SiglumeClient", () => {
  it("returns typed objects for auto-register and confirm-registration", async () => {
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        requests.push({ method: String(init?.method ?? "GET"), path: url.pathname, body });
        if (url.pathname === "/v1/market/capabilities/auto-register") {
          return new Response(
            JSON.stringify(
              envelope({
                listing_id: "lst_123",
                status: "draft",
                auto_manifest: { capability_key: "price-compare-helper" },
                confidence: { overall: 0.94 },
                review_url: "/owner/publish?listing=lst_123",
              }),
            ),
            { status: 201 },
          );
        }
        if (url.pathname === "/v1/market/capabilities/lst_123/confirm-auto-register") {
          return new Response(
            JSON.stringify(
              envelope({
                listing_id: "lst_123",
                status: "pending_review",
                release: { release_id: "rel_123", release_status: "pending_review" },
                quality: {
                  overall_score: 84,
                  grade: "B",
                  issues: [],
                  improvement_suggestions: ["Add one more retailer-specific trigger example."],
                },
              }, { request_id: "req_confirm", trace_id: "trc_confirm" }),
            ),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 500 });
      },
    });

    const receipt = await client.auto_register(buildManifest(), buildToolManual());
    const confirmation = await client.confirm_registration(receipt.listing_id);

    expect(receipt.listing_id).toBe("lst_123");
    expect(receipt.trace_id).toBe("trc_test");
    expect(confirmation.listing_id).toBe("lst_123");
    expect(confirmation.quality.overall_score).toBe(84);
    expect(confirmation.trace_id).toBe("trc_confirm");
    expect(requests[0]?.path).toBe("/v1/market/capabilities/auto-register");
    expect(requests[1]?.path).toBe("/v1/market/capabilities/lst_123/confirm-auto-register");
  });

  it("follows cursor pagination for capabilities and usage", async () => {
    const counts = { listings: 0, usage: 0 };
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/capabilities") {
          counts.listings += 1;
          if (url.searchParams.get("cursor") === "next_listing") {
            return new Response(JSON.stringify(envelope({
              items: [{ id: "lst_2", capability_key: "calendar-sync", name: "Calendar Sync", status: "published", dry_run_supported: true, price_model: "free", price_value_minor: 0, currency: "USD" }],
              next_cursor: null,
              limit: 1,
              offset: 1,
            })), { status: 200 });
          }
          return new Response(JSON.stringify(envelope({
            items: [{ id: "lst_1", capability_key: "price-compare-helper", name: "Price Compare Helper", status: "draft", dry_run_supported: true, price_model: "free", price_value_minor: 0, currency: "USD" }],
            next_cursor: "next_listing",
            limit: 1,
            offset: 0,
          })), { status: 200 });
        }
        if (url.pathname === "/v1/market/usage") {
          counts.usage += 1;
          if (url.searchParams.get("cursor") === "next_usage") {
            return new Response(JSON.stringify(envelope({
              items: [{ id: "use_2", capability_key: "price-compare-helper", units_consumed: 3, outcome: "success", execution_kind: "dry_run", created_at: "2026-04-19T00:00:00Z" }],
              next_cursor: null,
              limit: 1,
              offset: 1,
            })), { status: 200 });
          }
          return new Response(JSON.stringify(envelope({
            items: [{ id: "use_1", capability_key: "price-compare-helper", units_consumed: 1, outcome: "success", execution_kind: "dry_run", created_at: "2026-04-18T00:00:00Z" }],
            next_cursor: "next_usage",
            limit: 1,
            offset: 0,
          })), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const listings = await client.list_capabilities({ limit: 1 });
    const usage = await client.get_usage({ limit: 1 });

    expect((await listings.all_items()).map((item) => item.listing_id)).toEqual(["lst_1", "lst_2"]);
    expect((await usage.all_items()).map((item) => item.usage_event_id)).toEqual(["use_1", "use_2"]);
    expect(counts.listings).toBe(2);
    expect(counts.usage).toBe(2);
  });

  it("parses quality previews and surfaces API errors", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/tool-manuals/preview-quality") {
          return new Response(JSON.stringify(envelope({
            ok: true,
            quality: {
              overall_score: 96,
              grade: "A",
              publishable: true,
              keyword_coverage_estimate: 33,
              issues: [{ category: "description_quality", severity: "suggestion", message: "Looks good", field: "summary_for_model" }],
              improvement_suggestions: ["none"],
            },
          })), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { code: "NOPE", message: "bad request" } }), { status: 400 });
      },
    });

    const quality = await client.preview_quality_score(buildToolManual());
    expect(quality.overall_score).toBe(96);
    expect(quality.grade).toBe("A");
    expect(quality.publishable).toBe(true);

    await expect(client.get_listing("missing")).rejects.toBeInstanceOf(SiglumeAPIError);
  });

  it("covers developer portal, sandbox, grants, accounts, support, and retries", async () => {
    let retryCount = 0;
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/capabilities/retry_listing") {
          retryCount += 1;
          if (retryCount === 1) {
            return new Response(JSON.stringify({ error: { code: "TEMP", message: "retry later" } }), { status: 500 });
          }
          return new Response(JSON.stringify(envelope({
            id: "retry_listing",
            capability_key: "price-compare-helper",
            name: "Price Compare Helper",
            status: "published",
            dry_run_supported: true,
            price_model: "free",
            price_value_minor: 0,
            currency: "USD",
          })), { status: 200 });
        }
        if (url.pathname === "/v1/market/developer/portal") {
          return new Response(JSON.stringify(envelope({
            seller_onboarding: { status: "ready" },
            platform: { region: "us" },
            monetization: { active: true },
            payout_readiness: { ready: true },
            listings: { total: 2 },
            usage: { total_events: 10 },
            support: { open_cases: 1 },
            apps: [{ id: "lst_1", capability_key: "price-compare-helper", name: "Price Compare Helper", status: "published", dry_run_supported: true, price_model: "free", price_value_minor: 0, currency: "USD" }],
          })), { status: 200 });
        }
        if (url.pathname === "/v1/market/sandbox/sessions") {
          return new Response(JSON.stringify(envelope({
            session_id: "sns_123",
            agent_id: "agt_123",
            capability_key: "price-compare-helper",
            environment: "sandbox",
            dry_run_supported: true,
            required_connected_accounts: [],
            connected_accounts: [],
            stub_providers_enabled: true,
            simulated_receipts: true,
            approval_simulator: true,
          })), { status: 200 });
        }
        if (url.pathname === "/v1/market/access-grants") {
          return new Response(JSON.stringify(envelope({
            items: [{
              id: "grant_1",
              capability_listing_id: "lst_1",
              grant_status: "active",
              bindings: [],
              metadata: { tier: "pro" },
            }],
            next_cursor: null,
            limit: 20,
            offset: 0,
          })), { status: 200 });
        }
        if (url.pathname === "/v1/market/access-grants/grant_1/bind-agent") {
          return new Response(JSON.stringify(envelope({
            binding: { id: "bind_1", access_grant_id: "grant_1", agent_id: "agt_123", binding_status: "active" },
            access_grant: { id: "grant_1", capability_listing_id: "lst_1", grant_status: "active", bindings: [], metadata: {} },
          })), { status: 200 });
        }
        if (url.pathname === "/v1/market/connected-accounts") {
          return new Response(JSON.stringify(envelope({
            items: [{
              id: "conn_1",
              provider_key: "stripe",
              account_role: "seller",
              scopes: ["charges:read"],
              metadata: {},
            }],
            next_cursor: null,
            limit: 50,
            offset: 0,
          })), { status: 200 });
        }
        if (url.pathname === "/v1/market/support-cases" && init?.method === "POST") {
          return new Response(JSON.stringify(envelope({
            id: "case_1",
            case_type: "app_execution",
            summary: "subject\n\nbody",
            status: "open",
            metadata: {},
          })), { status: 200 });
        }
        if (url.pathname === "/v1/market/support-cases" && (!init?.method || init.method === "GET")) {
          return new Response(JSON.stringify(envelope({
            items: [{
              id: "case_1",
              case_type: "app_execution",
              summary: "subject\n\nbody",
              status: "open",
              metadata: {},
            }],
            next_cursor: null,
            limit: 50,
            offset: 0,
          })), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      },
    });

    const listing = await client.get_listing("retry_listing");
    const portal = await client.get_developer_portal();
    const sandbox = await client.create_sandbox_session({ agent_id: "agt_123", capability_key: "price-compare-helper" });
    const grants = await client.list_access_grants();
    const binding = await client.bind_agent_to_grant("grant_1", { agent_id: "agt_123" });
    const accounts = await client.list_connected_accounts();
    const supportCase = await client.create_support_case("subject", "body", { trace_id: "trc_123" });
    const supportCases = await client.list_support_cases();

    expect(retryCount).toBe(2);
    expect(listing.listing_id).toBe("retry_listing");
    expect(portal.apps).toHaveLength(1);
    expect(sandbox.session_id).toBe("sns_123");
    expect((await grants.all_items()).map((item) => item.access_grant_id)).toEqual(["grant_1"]);
    expect(binding.binding.binding_id).toBe("bind_1");
    expect((await accounts.all_items()).map((item) => item.connected_account_id)).toEqual(["conn_1"]);
    expect(supportCase.support_case_id).toBe("case_1");
    expect((await supportCases.all_items()).map((item) => item.support_case_id)).toEqual(["case_1"]);
  });

  it("validates support case payloads locally", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.create_support_case("", "")).rejects.toThrow("Support case subject or body is required.");
    await expect(client.create_support_case("x".repeat(1001), "y".repeat(1001))).rejects.toThrow(
      "Support case summary/body must fit within the 2000 character API limit.",
    );
  });
});
