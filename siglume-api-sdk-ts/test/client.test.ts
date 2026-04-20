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

  it("lists the caller's personal agent when no query is provided", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        expect(url.pathname).toBe("/v1/me/agent");
        return new Response(JSON.stringify(envelope({
          agent_id: "agt_owner_demo",
          agent_type: "personal",
          name: "Owner Demo",
          avatar_url: "/avatars/owner-demo.png",
          description: "Owner-managed marketplace agent.",
          status: "active",
          capabilities: { marketplace: true },
          settings: { paused: false },
        })), { status: 200 });
      },
    });

    const agents = await client.list_agents();

    expect(agents).toHaveLength(1);
    expect(agents[0]?.agent_id).toBe("agt_owner_demo");
    expect(agents[0]?.capabilities.marketplace).toBe(true);
  });

  it("uses search and profile routes for list_agents(query) and get_agent", async () => {
    const searchRequests: Array<{ cursor: string | null; limit: string | null }> = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/search/agents") {
          expect(url.searchParams.get("query")).toBe("budget");
          searchRequests.push({
            cursor: url.searchParams.get("cursor"),
            limit: url.searchParams.get("limit"),
          });
          if (url.searchParams.get("cursor") === "next_agents") {
            return new Response(JSON.stringify(envelope({
              items: [{
                agent_id: "agt_budget_helper",
                name: "Budget Helper",
                avatar_url: "/avatars/budget-helper.png",
                description: "Tracks cautious purchasing rules.",
                expertise: ["budgeting"],
                post_count: 1,
                reply_count: 0,
              }],
              next_cursor: null,
            })), { status: 200 });
          }
          return new Response(JSON.stringify(envelope({
            items: [{
              agent_id: "agt_budget_demo",
              name: "Budget Demo",
              avatar_url: "/avatars/budget-demo.png",
              description: "Focuses on budget-safe travel purchases.",
              expertise: ["travel", "budgeting"],
              post_count: 3,
              reply_count: 1,
            }],
            next_cursor: "next_agents",
          })), { status: 200 });
        }
        if (url.pathname === "/v1/agents/agt_budget_demo/profile") {
          return new Response(JSON.stringify(envelope({
            agent_id: "agt_budget_demo",
            name: "Budget Demo",
            avatar_url: "/avatars/budget-demo.png",
            description: "Focuses on budget-safe travel purchases.",
            agent_type: "personal",
            expertise: ["travel", "budgeting"],
            style: "careful",
            paused: false,
            manifesto_text: "Prefer clear budgets and explicit approvals.",
            plan: { tier: "pro" },
            reputation: { score: 0.92 },
            post_count: 3,
            reply_count: 1,
            items: [{ content_id: "cnt_demo_1", title: "Travel safety checklist" }],
            next_cursor: null,
          })), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const agents = await client.list_agents({ query: "budget", limit: 5 });
    const agent = await client.get_agent("agt_budget_demo");

    expect(agents.map((item) => item.agent_id)).toEqual(["agt_budget_demo", "agt_budget_helper"]);
    expect(agents[0]?.expertise).toEqual(["travel", "budgeting"]);
    expect(agent.manifesto_text).toBe("Prefer clear budgets and explicit approvals.");
    expect(agent.plan.tier).toBe("pro");
    expect(agent.items[0]?.content_id).toBe("cnt_demo_1");
    expect(searchRequests).toEqual([
      { cursor: null, limit: "5" },
      { cursor: "next_agents", limit: "4" },
    ]);
  });

  it("maps update_agent_charter into the owner charter payload", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        expect(url.pathname).toBe("/v1/owner/agents/agt_owner_demo/charter");
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        expect(body).toEqual({
          goals: { charter_text: "Prefer capped spend and explicit approval for unusual purchases." },
          role: "buyer",
          success_metrics: { approval_rate_floor: 0.8 },
        });
        return new Response(JSON.stringify(envelope({
          charter_id: "chr_demo_2",
          agent_id: "agt_owner_demo",
          principal_user_id: "usr_owner_demo",
          version: 2,
          active: true,
          role: "buyer",
          goals: { charter_text: "Prefer capped spend and explicit approval for unusual purchases." },
          target_profile: {},
          qualification_criteria: {},
          success_metrics: { approval_rate_floor: 0.8 },
          constraints: {},
        })), { status: 200 });
      },
    });

    const charter = await client.update_agent_charter(
      "agt_owner_demo",
      "Prefer capped spend and explicit approval for unusual purchases.",
      {
        role: "buyer",
        success_metrics: { approval_rate_floor: 0.8 },
        wait_for_completion: true,
      },
    );

    expect(charter.charter_id).toBe("chr_demo_2");
    expect(charter.charter_text).toBe("Prefer capped spend and explicit approval for unusual purchases.");
    expect(charter.success_metrics.approval_rate_floor).toBe(0.8);
  });

  it("sanitizes approval and budget policy updates before sending them", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        requests.push({ path: url.pathname, body });
        if (url.pathname === "/v1/owner/agents/agt_owner_demo/approval-policy") {
          return new Response(JSON.stringify(envelope({
            approval_policy_id: "apl_demo_2",
            agent_id: "agt_owner_demo",
            principal_user_id: "usr_owner_demo",
            version: 2,
            active: true,
            auto_approve_below: { JPY: 3000 },
            always_require_approval_for: ["travel.booking"],
            deny_if: {},
            approval_ttl_minutes: 720,
            structured_only: true,
            merchant_allowlist: [],
            merchant_denylist: [],
            category_allowlist: [],
            category_denylist: [],
            risk_policy: {},
          })), { status: 200 });
        }
        if (url.pathname === "/v1/owner/agents/agt_owner_demo/budget") {
          return new Response(JSON.stringify(envelope({
            budget_id: "bdg_demo_2",
            agent_id: "agt_owner_demo",
            principal_user_id: "usr_owner_demo",
            currency: "JPY",
            period_start: "2026-04-01T00:00:00Z",
            period_end: "2026-05-01T00:00:00Z",
            period_limit_minor: 50000,
            spent_minor: 0,
            reserved_minor: 0,
            per_order_limit_minor: 12000,
            auto_approve_below_minor: 3000,
            limits: {
              period_limit: 50000,
              per_order_limit: 12000,
              auto_approve_below: 3000,
            },
            metadata: { source: "sdk-test" },
          })), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const policy = await client.update_approval_policy(
      "agt_owner_demo",
      {
        approval_policy_id: "apl_ignore_me",
        version: 999,
        auto_approve_below: { JPY: 3000 },
        always_require_approval_for: ["travel.booking"],
        approval_ttl_minutes: 720,
        structured_only: true,
      },
      { wait_for_completion: true },
    );
    const budget = await client.update_budget_policy(
      "agt_owner_demo",
      {
        budget_id: "bdg_ignore_me",
        currency: "JPY",
        period_limit_minor: 50000,
        per_order_limit_minor: 12000,
        auto_approve_below_minor: 3000,
        metadata: { source: "sdk-test" },
      },
      { wait_for_completion: true },
    );

    expect(requests[0]).toEqual({
      path: "/v1/owner/agents/agt_owner_demo/approval-policy",
      body: {
        auto_approve_below: { JPY: 3000 },
        always_require_approval_for: ["travel.booking"],
        approval_ttl_minutes: 720,
        structured_only: true,
      },
    });
    expect(requests[1]).toEqual({
      path: "/v1/owner/agents/agt_owner_demo/budget",
      body: {
        currency: "JPY",
        period_limit_minor: 50000,
        per_order_limit_minor: 12000,
        auto_approve_below_minor: 3000,
        metadata: { source: "sdk-test" },
      },
    });
    expect(policy.approval_policy_id).toBe("apl_demo_2");
    expect(policy.auto_approve_below.JPY).toBe(3000);
    expect(budget.budget_id).toBe("bdg_demo_2");
    expect(budget.limits.per_order_limit).toBe(12000);
  });

  it("validates local inputs for agent behavior updates", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.get_agent("")).rejects.toThrow("agent_id is required.");
    await expect(client.update_agent_charter("", "keep budgets tight")).rejects.toThrow("agent_id is required.");
    await expect(client.update_agent_charter("agt_owner_demo", "")).rejects.toThrow("charter_text is required.");
    await expect(client.update_approval_policy("agt_owner_demo", {})).rejects.toThrow(
      "policy must include at least one supported approval-policy field.",
    );
    await expect(client.update_budget_policy("agt_owner_demo", {})).rejects.toThrow(
      "policy must include at least one supported budget-policy field.",
    );
  });

  it("parses sparse approval and budget responses with numeric fallbacks", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/owner/agents/agt_owner_demo/approval-policy") {
          return new Response(JSON.stringify(envelope({
            id: "apl_sparse",
            agent_id: "agt_owner_demo",
            auto_approve_below: { JPY: 2500, USD: "skip-me" },
            structured_only: false,
          })), { status: 200 });
        }
        if (url.pathname === "/v1/owner/agents/agt_owner_demo/budget") {
          return new Response(JSON.stringify(envelope({
            id: "bdg_sparse",
            agent_id: "agt_owner_demo",
            currency: "USD",
            period_limit_minor: 9000,
            per_order_limit_minor: 1500,
            auto_approve_below_minor: 500,
            limits: null,
          })), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const policy = await client.update_approval_policy("agt_owner_demo", {
      auto_approve_below: { JPY: 2500 },
    });
    const budget = await client.update_budget_policy("agt_owner_demo", {
      currency: "USD",
      period_limit_minor: 9000,
      per_order_limit_minor: 1500,
      auto_approve_below_minor: 500,
    });

    expect(policy.approval_policy_id).toBe("apl_sparse");
    expect(policy.auto_approve_below).toEqual({ JPY: 2500 });
    expect(budget.budget_id).toBe("bdg_sparse");
    expect(budget.limits).toEqual({
      period_limit: 9000,
      per_order_limit: 1500,
      auto_approve_below: 500,
    });
  });

  it("forwards null period_start / period_end so callers can clear budget date boundaries", async () => {
    let captured: Record<string, unknown> | null = null;
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        expect(url.pathname).toBe("/v1/owner/agents/agt_owner_demo/budget");
        captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response(JSON.stringify(envelope({
          id: "bdg_clear_dates",
          agent_id: "agt_owner_demo",
          currency: "JPY",
          period_start: null,
          period_end: null,
          period_limit_minor: 50000,
        })), { status: 200 });
      },
    });

    await client.update_budget_policy("agt_owner_demo", {
      period_start: null,
      period_end: null,
    });

    expect(captured).toEqual({ period_start: null, period_end: null });
  });

  it("still strips null for non-nullable budget fields like currency", async () => {
    let captured: Record<string, unknown> | null = null;
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        expect(url.pathname).toBe("/v1/owner/agents/agt_owner_demo/budget");
        captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response(JSON.stringify(envelope({
          id: "bdg_strip",
          agent_id: "agt_owner_demo",
          currency: "USD",
          period_limit_minor: 1000,
        })), { status: 200 });
      },
    });

    await client.update_budget_policy("agt_owner_demo", {
      currency: null,
      period_limit_minor: 1000,
    });

    expect(captured).toEqual({ period_limit_minor: 1000 });
  });

  it("rejects budget policy update when only filtered nulls remain", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => {
        throw new Error("fetch should not be called for stripped-only payload");
      },
    });

    await expect(client.update_budget_policy("agt_owner_demo", { currency: null }))
      .rejects.toThrow("policy must include at least one supported budget-policy field.");
  });

  it("accepts raw array payloads for webhook list endpoints", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/webhooks/subscriptions") {
          return new Response(JSON.stringify([
            {
              id: "whsub_123",
              event_type: "subscription.created",
              url: "https://example.test/webhooks/siglume",
              status: "active",
            },
          ]), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const subscriptions = await client.list_webhook_subscriptions();

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.subscription_id).toBe("whsub_123");
    expect(subscriptions[0]?.event_types).toEqual([]);
  });

  it("wraps non-Error transport failures as SiglumeClientError", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      max_retries: 1,
      fetch: async () => {
        throw "transport exploded";
      },
    });

    await expect(client.list_agents()).rejects.toThrow("Siglume request failed.");
  });
});
