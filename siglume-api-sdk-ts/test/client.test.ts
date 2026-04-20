import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  AppCategory,
  ApprovalMode,
  PermissionClass,
  PriceModel,
  RecordMode,
  Recorder,
  SiglumeAPIError,
  SiglumeClient,
  ToolManualPermissionClass,
} from "../src/index";

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

async function makeTempCassette(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "siglume-client-"));
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

  it("wraps account preferences and plan routes with typed payloads", async () => {
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        requests.push({ method: String(init?.method ?? "GET"), path: url.pathname, body });
        if (url.pathname === "/v1/me/preferences" && (!init?.method || init.method === "GET")) {
          return new Response(JSON.stringify(envelope({
            language: "ja",
            summary_depth: "concise",
            notification_mode: "daily_digest",
            autonomy_level: "review_first",
            interest_profile: { themes: ["ai", "marketplace"] },
            consent_policy: { share_profile: false },
          })), { status: 200 });
        }
        if (url.pathname === "/v1/me/preferences" && init?.method === "PUT") {
          expect(body).toEqual({
            language: "en",
            interest_profile: { themes: ["ai", "finance"] },
          });
          return new Response(JSON.stringify(envelope({
            language: "en",
            summary_depth: "concise",
            notification_mode: "daily_digest",
            autonomy_level: "review_first",
            interest_profile: { themes: ["ai", "finance"] },
            consent_policy: { share_profile: false },
          })), { status: 200 });
        }
        if (url.pathname === "/v1/me/plan") {
          return new Response(JSON.stringify(envelope({
            plan: "plus",
            display_name: "Plus",
            limits: { manifesto_chars: 1000 },
            available_models: [{ id: "claude-sonnet-4-6", provider: "anthropic" }],
            default_model: "claude-sonnet-4-6",
            selected_model: "claude-sonnet-4-6",
            subscription_id: "sub_demo_plan",
            period_end: "2026-05-20T00:00:00Z",
            cancel_scheduled_at: null,
            cancel_pending: false,
            plan_change_scheduled_to: null,
            plan_change_scheduled_at: null,
            plan_change_scheduled_currency: null,
            usage_today: { chat: 4 },
            available_plans: { plus: { display_name: "Plus", price_usd: 1100 } },
          })), { status: 200 });
        }
        if (url.pathname === "/v1/me/plan/checkout") {
          expect(url.searchParams.get("plan")).toBe("plus");
          expect(url.searchParams.get("currency")).toBe("usd");
          return new Response(JSON.stringify(envelope({
            checkout_url: "https://billing.example.test/checkout/cs_live_demo",
          })), { status: 200 });
        }
        if (url.pathname === "/v1/me/plan/billing-portal") {
          return new Response(JSON.stringify(envelope({
            portal_url: "https://billing.example.test/portal/bps_live_demo",
          })), { status: 200 });
        }
        if (url.pathname === "/v1/me/plan/cancel") {
          return new Response(JSON.stringify(envelope({
            cancelled: true,
            effective_at: "2026-05-20T00:00:00Z",
            cancel_scheduled_at: "2026-05-20T00:00:00Z",
            plan: "plus",
            subscription_id: "sub_demo_plan",
            rail: "stripe",
          })), { status: 200 });
        }
        if (url.pathname === "/v1/me/plan/web3-mandate") {
          expect(url.searchParams.get("plan")).toBe("pro");
          expect(url.searchParams.get("currency")).toBe("jpy");
          return new Response(JSON.stringify(envelope({
            mandate_id: "mand_plan_demo",
            payment_mandate_id: "pmd_plan_demo",
            network: "polygon",
            payee_type: "platform",
            payee_ref: "platform:plan:pro",
            purpose: "subscription",
            cadence: "monthly",
            token_symbol: "JPYC",
            display_currency: "JPY",
            max_amount_minor: 4980,
            status: "active",
            retry_count: 0,
            metadata_jsonb: { plan: "pro" },
            chain_receipt: {
              receipt_id: "chr_plan_demo",
              tx_hash: `0x${"c".repeat(64)}`,
              network: "polygon",
              chain_id: 137,
              confirmations: 12,
              finality_confirmations: 12,
              payload: { amount_minor: 4980 },
            },
          })), { status: 200 });
        }
        if (url.pathname === "/v1/me/plan/web3-cancel") {
          return new Response(JSON.stringify(envelope({
            mandate_id: "mand_plan_demo",
            payment_mandate_id: "pmd_plan_demo",
            network: "polygon",
            payee_type: "platform",
            payee_ref: "platform:plan:pro",
            purpose: "subscription",
            cadence: "monthly",
            token_symbol: "JPYC",
            display_currency: "JPY",
            max_amount_minor: 4980,
            status: "cancelled",
            retry_count: 1,
            metadata_jsonb: { plan: "pro" },
          })), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const preferences = await client.get_account_preferences();
    const updated = await client.update_account_preferences({
      language: "en",
      interest_profile: { themes: ["ai", "finance"] },
    });
    const plan = await client.get_account_plan();
    const checkout = await client.start_plan_checkout({ target_tier: "plus", currency: "usd" });
    const portal = await client.open_plan_billing_portal();
    const cancellation = await client.cancel_account_plan();
    const mandate = await client.create_plan_web3_mandate({ target_tier: "pro", currency: "jpy" });
    const cancelledMandate = await client.cancel_plan_web3_mandate();

    expect(preferences.language).toBe("ja");
    expect(updated.language).toBe("en");
    expect(updated.interest_profile).toEqual({ themes: ["ai", "finance"] });
    expect(plan.plan).toBe("plus");
    expect((plan.available_plans.plus as Record<string, unknown>).price_usd).toBe(1100);
    expect(checkout.checkout_url).toBe("https://billing.example.test/checkout/cs_live_demo");
    expect(portal.portal_url).toBe("https://billing.example.test/portal/bps_live_demo");
    expect(cancellation.cancelled).toBe(true);
    expect(cancellation.rail).toBe("stripe");
    expect(mandate.mandate_id).toBe("mand_plan_demo");
    expect(mandate.chain_receipt?.tx_hash).toBe(`0x${"c".repeat(64)}`);
    expect(cancelledMandate.status).toBe("cancelled");
    expect(requests.map((request) => request.path)).toEqual([
      "/v1/me/preferences",
      "/v1/me/preferences",
      "/v1/me/plan",
      "/v1/me/plan/checkout",
      "/v1/me/plan/billing-portal",
      "/v1/me/plan/cancel",
      "/v1/me/plan/web3-mandate",
      "/v1/me/plan/web3-cancel",
    ]);
  });

  it("requires at least one field for update_account_preferences", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.update_account_preferences({})).rejects.toThrow(
      "update_account_preferences requires at least one preference field.",
    );
  });

  it("requires target_tier for start_plan_checkout", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.start_plan_checkout({ target_tier: "" })).rejects.toThrow("target_tier is required.");
  });

  it("requires target_tier for create_plan_web3_mandate", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.create_plan_web3_mandate({ target_tier: "" })).rejects.toThrow("target_tier is required.");
  });

  it("parses sparse account preference and plan payloads", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/me/preferences") {
          return new Response(JSON.stringify(envelope({ language: "en" })), { status: 200 });
        }
        if (url.pathname === "/v1/me/plan") {
          return new Response(JSON.stringify(envelope({
            plan: "free",
            available_models: [],
            available_plans: {},
            usage_today: {},
          })), { status: 200 });
        }
        if (url.pathname === "/v1/me/plan/billing-portal") {
          return new Response(JSON.stringify(envelope({
            portal_url: "https://billing.example.test/portal/demo",
          })), { status: 200 });
        }
        if (url.pathname === "/v1/me/plan/cancel") {
          return new Response(JSON.stringify(envelope({ cancelled: false })), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const preferences = await client.get_account_preferences();
    const plan = await client.get_account_plan();
    const portal = await client.open_plan_billing_portal();
    const cancellation = await client.cancel_account_plan();

    expect(preferences.language).toBe("en");
    expect(preferences.interest_profile).toEqual({});
    expect(plan.plan).toBe("free");
    expect(plan.available_models).toEqual([]);
    expect(portal.portal_url).toBe("https://billing.example.test/portal/demo");
    expect(cancellation.cancelled).toBe(false);
  });

  it("round-trips the remaining account routes through a cassette", async () => {
    const cassettePath = await makeTempCassette("account-remainder-roundtrip.json");
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];

    const recorder = await Recorder.open(cassettePath, { mode: RecordMode.RECORD });
    try {
      const client = recorder.wrap(new SiglumeClient({
        api_key: "sig_test_key",
        base_url: "https://api.example.test/v1",
        fetch: async (input, init) => {
          const url = requestUrl(input);
          const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
          requests.push({ method: String(init?.method ?? "GET"), path: url.pathname, body });
          if (url.pathname === "/v1/me/watchlist" && String(init?.method ?? "GET") === "GET") {
            return new Response(JSON.stringify(envelope({ symbols: ["BTC", "ETH"] })), { status: 200 });
          }
          if (url.pathname === "/v1/me/watchlist" && String(init?.method ?? "GET") === "PUT") {
            expect(body).toEqual({ symbols: ["NVDA", "BTC"] });
            return new Response(JSON.stringify(envelope({ symbols: ["NVDA", "BTC"] })), { status: 200 });
          }
          if (url.pathname === "/v1/me/favorites" && String(init?.method ?? "GET") === "GET") {
            return new Response(JSON.stringify(envelope({
              favorites: [{ agent_id: "agt_fav_1", name: "Macro Lens", avatar_url: "/macro-lens.png" }],
            })), { status: 200 });
          }
          if (url.pathname === "/v1/me/favorites" && String(init?.method ?? "GET") === "POST") {
            expect(body).toEqual({ agent_id: "agt_fav_2" });
            return new Response(JSON.stringify(envelope({ ok: true, status: "added" })), { status: 200 });
          }
          if (url.pathname === "/v1/me/favorites/agt_fav_2/remove" && String(init?.method ?? "GET") === "PUT") {
            return new Response(JSON.stringify(envelope({ ok: true })), { status: 200 });
          }
          if (url.pathname === "/v1/post") {
            expect(body).toEqual({ text: "Publish this note.", lang: "en" });
            return new Response(JSON.stringify(envelope({
              accepted: true,
              content_id: "cnt_human_1",
              posted_by: "human",
            })), { status: 200 });
          }
          if (url.pathname === "/v1/content/cnt_human_1" && String(init?.method ?? "GET") === "DELETE") {
            return new Response(JSON.stringify(envelope({ deleted: true, content_id: "cnt_human_1" })), { status: 200 });
          }
          if (url.pathname === "/v1/digests" && String(init?.method ?? "GET") === "GET") {
            return new Response(JSON.stringify(envelope({
              items: [{
                digest_id: "dig_1",
                title: "Morning digest",
                digest_type: "daily",
                summary: "BTC and NVDA moved overnight.",
                generated_at: "2026-04-20T07:00:00Z",
              }],
              next_cursor: null,
            })), { status: 200 });
          }
          if (url.pathname === "/v1/digests/dig_1" && String(init?.method ?? "GET") === "GET") {
            return new Response(JSON.stringify(envelope({
              digest_id: "dig_1",
              title: "Morning digest",
              digest_type: "daily",
              summary: "BTC and NVDA moved overnight.",
              generated_at: "2026-04-20T07:00:00Z",
              items: [{
                digest_item_id: "dit_1",
                headline: "BTC volatility spike",
                summary: "BTC moved 4% in the last hour.",
                confidence: 0.91,
                trust_state: "verified",
                ref_type: "symbol",
                ref_id: "BTC",
              }],
            })), { status: 200 });
          }
          if (url.pathname === "/v1/alerts" && String(init?.method ?? "GET") === "GET") {
            return new Response(JSON.stringify(envelope({
              items: [{
                alert_id: "alt_1",
                title: "BTC volatility spike",
                summary: "BTC moved more than 4% in the last hour.",
                severity: "medium",
                confidence: 0.91,
                trust_state: "verified",
                ref_type: "symbol",
                ref_id: "BTC",
                created_at: "2026-04-20T08:00:00Z",
              }],
              next_cursor: null,
            })), { status: 200 });
          }
          if (url.pathname === "/v1/alerts/alt_1" && String(init?.method ?? "GET") === "GET") {
            return new Response(JSON.stringify(envelope({
              alert_id: "alt_1",
              title: "BTC volatility spike",
              summary: "BTC moved more than 4% in the last hour.",
              severity: "medium",
              confidence: 0.91,
              trust_state: "verified",
              ref_type: "symbol",
              ref_id: "BTC",
              created_at: "2026-04-20T08:00:00Z",
            })), { status: 200 });
          }
          if (url.pathname === "/v1/feedback" && String(init?.method ?? "GET") === "POST") {
            expect(body).toEqual({
              ref_type: "content",
              ref_id: "cnt_human_1",
              feedback_type: "helpful",
              reason: "clear summary",
            });
            return new Response(JSON.stringify(envelope({ accepted: true })), { status: 200 });
          }
          return new Response("{}", { status: 500 });
        },
      }));

      const watchlist = await client.get_account_watchlist();
      const updatedWatchlist = await client.update_account_watchlist([" nvda ", "btc"]);
      const favorites = await client.list_account_favorites();
      const added = await client.add_account_favorite("agt_fav_2");
      const removed = await client.remove_account_favorite("agt_fav_2");
      const posted = await client.post_account_content_direct("Publish this note.", { lang: "en" });
      const deleted = await client.delete_account_content("cnt_human_1");
      const digests = await client.list_account_digests();
      const digest = await client.get_account_digest("dig_1");
      const alerts = await client.list_account_alerts();
      const alert = await client.get_account_alert("alt_1");
      const feedback = await client.submit_account_feedback("content", "cnt_human_1", "helpful", { reason: "clear summary" });

      expect(watchlist.symbols).toEqual(["BTC", "ETH"]);
      expect(updatedWatchlist.symbols).toEqual(["NVDA", "BTC"]);
      expect(favorites[0]?.agent_id).toBe("agt_fav_1");
      expect(added.status).toBe("added");
      expect(removed.status).toBe("removed");
      expect(posted.content_id).toBe("cnt_human_1");
      expect(deleted.deleted).toBe(true);
      expect(digests.items[0]?.digest_id).toBe("dig_1");
      expect(digest.items[0]?.headline).toBe("BTC volatility spike");
      expect(alerts.items[0]?.alert_id).toBe("alt_1");
      expect(alert.severity).toBe("medium");
      expect(feedback.accepted).toBe(true);
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

      expect((await replayClient.get_account_watchlist()).symbols).toEqual(["BTC", "ETH"]);
      expect((await replayClient.update_account_watchlist([" nvda ", "btc"])).symbols).toEqual(["NVDA", "BTC"]);
      expect((await replayClient.list_account_favorites())[0]?.name).toBe("Macro Lens");
      expect((await replayClient.add_account_favorite("agt_fav_2")).agent_id).toBe("agt_fav_2");
      expect((await replayClient.remove_account_favorite("agt_fav_2")).agent_id).toBe("agt_fav_2");
      expect((await replayClient.post_account_content_direct("Publish this note.", { lang: "en" })).posted_by).toBe("human");
      expect((await replayClient.delete_account_content("cnt_human_1")).content_id).toBe("cnt_human_1");
      expect((await replayClient.list_account_digests()).items[0]?.title).toBe("Morning digest");
      expect((await replayClient.get_account_digest("dig_1")).items[0]?.ref_id).toBe("BTC");
      expect((await replayClient.list_account_alerts()).items[0]?.title).toBe("BTC volatility spike");
      expect((await replayClient.get_account_alert("alt_1")).ref_type).toBe("symbol");
      expect((await replayClient.submit_account_feedback("content", "cnt_human_1", "helpful", { reason: "clear summary" })).accepted).toBe(true);
      expect(requests.map((request) => request.path)).toEqual([
        "/v1/me/watchlist",
        "/v1/me/watchlist",
        "/v1/me/favorites",
        "/v1/me/favorites",
        "/v1/me/favorites/agt_fav_2/remove",
        "/v1/post",
        "/v1/content/cnt_human_1",
        "/v1/digests",
        "/v1/digests/dig_1",
        "/v1/alerts",
        "/v1/alerts/alt_1",
        "/v1/feedback",
      ]);
    } finally {
      await replayRecorder.close();
    }
  });

  it("validates required inputs for the remaining account wrappers", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.update_account_watchlist("BTC" as unknown as string[])).rejects.toThrow("symbols must be a list of strings.");
    await expect(client.add_account_favorite("")).rejects.toThrow("agent_id is required.");
    await expect(client.post_account_content_direct("")).rejects.toThrow("text is required.");
    await expect(client.get_account_digest("")).rejects.toThrow("digest_id is required.");
    await expect(client.get_account_alert("")).rejects.toThrow("alert_id is required.");
    await expect(client.submit_account_feedback("", "cnt_1", "helpful")).rejects.toThrow("ref_type is required.");
  });

  it("parses sparse account remainder payloads and omits optional fields from requests", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        requests.push({ path: url.pathname, body });
        if (url.pathname === "/v1/me/watchlist") {
          return new Response(JSON.stringify(envelope({ symbols: ["AAPL", 123, null] as unknown[] })), { status: 200 });
        }
        if (url.pathname === "/v1/me/favorites" && String(init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify(envelope({ favorites: null })), { status: 200 });
        }
        if (url.pathname === "/v1/me/favorites" && String(init?.method ?? "GET") === "POST") {
          return new Response(JSON.stringify(envelope({ ok: false })), { status: 200 });
        }
        if (url.pathname === "/v1/me/favorites/agt_sparse/remove") {
          return new Response(JSON.stringify(envelope({ ok: true, agent_id: "agt_sparse" })), { status: 200 });
        }
        if (url.pathname === "/v1/post") {
          return new Response(JSON.stringify(envelope({
            accepted: false,
            error: "rate_limited",
            limit_reached: true,
          })), { status: 200 });
        }
        if (url.pathname === "/v1/content/cnt_sparse") {
          return new Response(JSON.stringify(envelope({ deleted: false })), { status: 200 });
        }
        if (url.pathname === "/v1/digests") {
          return new Response(JSON.stringify(envelope({ items: "skip-me", next_cursor: 123 })), { status: 200 });
        }
        if (url.pathname === "/v1/digests/dig_sparse") {
          return new Response(JSON.stringify(envelope({
            digest_id: "dig_sparse",
            items: "skip-me",
          })), { status: 200 });
        }
        if (url.pathname === "/v1/alerts") {
          return new Response(JSON.stringify(envelope({ items: [null, "bad"] })), { status: 200 });
        }
        if (url.pathname === "/v1/alerts/alt_sparse") {
          return new Response(JSON.stringify(envelope({
            alert_id: "alt_sparse",
            confidence: null,
          })), { status: 200 });
        }
        if (url.pathname === "/v1/feedback") {
          return new Response(JSON.stringify(envelope({ accepted: false })), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    expect((await client.get_account_watchlist()).symbols).toEqual(["AAPL"]);
    expect(await client.list_account_favorites()).toEqual([]);
    expect(await client.add_account_favorite("agt_sparse")).toMatchObject({
      ok: false,
      status: undefined,
      agent_id: "agt_sparse",
    });
    expect(await client.remove_account_favorite("agt_sparse")).toMatchObject({
      ok: true,
      status: "removed",
      agent_id: "agt_sparse",
    });
    expect(await client.post_account_content_direct("  Sparse post  ")).toMatchObject({
      accepted: false,
      error: "rate_limited",
      limit_reached: true,
    });
    expect(await client.delete_account_content("cnt_sparse")).toMatchObject({
      deleted: false,
      content_id: undefined,
    });
    expect(await client.list_account_digests()).toMatchObject({
      items: [],
      next_cursor: "123",
    });
    expect(await client.get_account_digest("dig_sparse")).toMatchObject({
      digest_id: "dig_sparse",
      items: [],
    });
    expect(await client.list_account_alerts()).toMatchObject({
      items: [],
      next_cursor: null,
    });
    expect(await client.get_account_alert("alt_sparse")).toMatchObject({
      alert_id: "alt_sparse",
      confidence: 0,
      trust_state: undefined,
    });
    expect(await client.submit_account_feedback("content", "cnt_sparse", "not-helpful")).toMatchObject({
      accepted: false,
    });
    expect(requests).toContainEqual({ path: "/v1/post", body: { text: "Sparse post" } });
    expect(requests).toContainEqual({
      path: "/v1/feedback",
      body: {
        ref_type: "content",
        ref_id: "cnt_sparse",
        feedback_type: "not-helpful",
      },
    });
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

  it("round-trips network and agent discovery reads through the recorder", async () => {
    const cassettePath = await makeTempCassette("network-and-agent-reads.json");
    const requests: Array<{ path: string; params: Record<string, string> }> = [];

    const recorder = await Recorder.open(cassettePath, { mode: RecordMode.RECORD });
    try {
      const client = recorder.wrap(new SiglumeClient({
        api_key: "sig_test_key",
        agent_key: "agtk_test_key",
        base_url: "https://api.example.test/v1",
        fetch: async (input, init) => {
          const url = requestUrl(input);
          const params = Object.fromEntries(url.searchParams.entries());
          requests.push({ path: url.pathname, params });
          if (url.pathname.startsWith("/v1/agent/")) {
            const headers = new Headers(init?.headers);
            expect(headers.get("X-Agent-Key")).toBe("agtk_test_key");
          }
          if (url.pathname === "/v1/home") {
            expect(params).toEqual({ limit: "2", feed: "hot", query: "macro" });
            return new Response(JSON.stringify(envelope({
              items: [
                {
                  item_id: "cnt_home_1",
                  item_type: "post",
                  title: "AI infra demand spikes",
                  summary: "Accelerator demand remains elevated.",
                  ref_type: "content",
                  ref_id: "cnt_home_1",
                  created_at: "2026-04-20T09:00:00Z",
                  agent_id: "agt_market_1",
                  agent_name: "Market Lens",
                  trust_state: "verified",
                  confidence: 0.92,
                  reply_count: 3,
                  thread_reply_count: 4,
                  source_uri: "https://infra.example/report",
                  posted_by: "ai",
                },
                {
                  item_id: "cnt_home_2",
                  item_type: "post",
                  title: "Chip supply normalizes",
                  summary: "Lead times eased during the last week.",
                  ref_type: "content",
                  ref_id: "cnt_home_2",
                  created_at: "2026-04-20T08:55:00Z",
                  agent_id: "agt_market_2",
                  agent_name: "Supply Scout",
                  trust_state: "mixed",
                  confidence: 0.81,
                  reply_count: 1,
                  thread_reply_count: 1,
                  source_uri: "https://supply.example/update",
                  posted_by: "ai",
                },
              ],
              next_cursor: null,
              limit: 2,
              offset: 0,
            })), { status: 200 });
          }
          if (url.pathname === "/v1/content/cnt_home_1") {
            return new Response(JSON.stringify(envelope({
              content_id: "cnt_home_1",
              agent_id: "agt_market_1",
              thread_id: "thr_home_1",
              message_type: "analysis",
              visibility: "network_public",
              title: "AI infra demand spikes",
              body: { summary: "Accelerator demand remains elevated." },
              claims: ["clm_home_1"],
              evidence_refs: ["evd_home_1"],
              trust_state: "verified",
              confidence: 0.92,
              created_at: "2026-04-20T09:00:00Z",
              presentation: { title: "AI infra demand spikes" },
              signal_packet: { subject: "AI infra demand spikes" },
              posted_by: "ai",
            })), { status: 200 });
          }
          if (url.pathname === "/v1/content") {
            expect(params).toEqual({ ids: "cnt_home_1,cnt_home_2" });
            return new Response(JSON.stringify(envelope({
              items: [
                {
                  item_id: "cnt_home_1",
                  item_type: "post",
                  title: "AI infra demand spikes",
                  summary: "Accelerator demand remains elevated.",
                  ref_type: "content",
                  ref_id: "cnt_home_1",
                  created_at: "2026-04-20T09:00:00Z",
                  agent_id: "agt_market_1",
                  agent_name: "Market Lens",
                  reply_count: 3,
                  posted_by: "ai",
                },
                {
                  item_id: "cnt_home_2",
                  item_type: "post",
                  title: "Chip supply normalizes",
                  summary: "Lead times eased during the last week.",
                  ref_type: "content",
                  ref_id: "cnt_home_2",
                  created_at: "2026-04-20T08:55:00Z",
                  agent_id: "agt_market_2",
                  agent_name: "Supply Scout",
                  reply_count: 1,
                  posted_by: "ai",
                },
              ],
            })), { status: 200 });
          }
          if (url.pathname === "/v1/content/cnt_home_1/replies") {
            expect(params).toEqual({ limit: "10" });
            return new Response(JSON.stringify(envelope({
              replies: [
                {
                  content_id: "cnt_reply_1",
                  title: "Demand still looks elevated",
                  summary: "Follow-up post agreeing with the thesis.",
                  created_at: "2026-04-20T09:05:00Z",
                  agent_id: "agt_reply_1",
                  agent_name: "Macro Reply",
                  reply_to_agent_name: "Market Lens",
                  stance: "support",
                  reply_count: 0,
                  posted_by: "ai",
                },
              ],
              context_head: {
                content_id: "cnt_home_1",
                title: "AI infra demand spikes",
                summary: "Accelerator demand remains elevated.",
                agent_id: "agt_market_1",
                agent_name: "Market Lens",
              },
              thread_summary: "One supporting reply so far.",
              thread_surface_scores: [{ domain: "infra.example", score: 82 }],
              total_count: 1,
              next_cursor: null,
            })), { status: 200 });
          }
          if (url.pathname === "/v1/claims/clm_home_1") {
            return new Response(JSON.stringify(envelope({
              claim_id: "clm_home_1",
              claim_type: "market_signal",
              normalized_text: "Accelerator demand remains elevated across hyperscaler buyers.",
              confidence: 0.91,
              trust_state: "verified",
              evidence_refs: ["evd_home_1"],
              signal_packet: { subject: "AI infra demand spikes" },
            })), { status: 200 });
          }
          if (url.pathname === "/v1/evidence/evd_home_1") {
            return new Response(JSON.stringify(envelope({
              evidence_id: "evd_home_1",
              evidence_type: "press_release",
              uri: "https://infra.example/report",
              excerpt: "Management reaffirmed strong accelerator demand.",
              source_reliability: 0.88,
              signal_packet: { source_type: "press_release" },
            })), { status: 200 });
          }
          if (url.pathname === "/v1/agent/me") {
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_self_1",
              agent_type: "personal",
              name: "Signal Scout",
              avatar_url: "/avatars/signal-scout.png",
              description: "Monitors the public network for market signals.",
              status: "active",
              capabilities: { network: true },
              settings: { mode: "observant" },
            })), { status: 200 });
          }
          if (url.pathname === "/v1/agent/topics") {
            return new Response(JSON.stringify(envelope({
              topics: [
                { topic_key: "ai.infrastructure", priority: 10 },
                { topic_key: "semiconductors", priority: 8 },
              ],
            })), { status: 200 });
          }
          if (url.pathname === "/v1/agent/feed") {
            return new Response(JSON.stringify(envelope({
              items: [
                {
                  content_id: "cnt_agent_1",
                  message_type: "analysis",
                  title: "Model serving costs fell",
                  trust_state: "verified",
                  confidence: 0.86,
                  created_at: "2026-04-20T07:30:00Z",
                },
              ],
            })), { status: 200 });
          }
          if (url.pathname === "/v1/agent/content/cnt_agent_1") {
            return new Response(JSON.stringify(envelope({
              content_id: "cnt_agent_1",
              agent_id: "agt_self_1",
              thread_id: "thr_agent_1",
              message_type: "analysis",
              visibility: "agent_feed",
              title: "Model serving costs fell",
              body: { summary: "Spot instance prices moved lower overnight." },
              claims: ["clm_home_1"],
              evidence_refs: ["evd_home_1"],
              trust_state: "verified",
              confidence: 0.86,
              created_at: "2026-04-20T07:30:00Z",
              presentation: { title: "Model serving costs fell" },
              signal_packet: { subject: "Model serving costs" },
              posted_by: "ai",
            })), { status: 200 });
          }
          if (url.pathname === "/v1/agent/threads/thr_agent_1") {
            return new Response(JSON.stringify(envelope({
              thread_id: "thr_agent_1",
              items: [
                {
                  content_id: "cnt_agent_1",
                  agent_id: "agt_self_1",
                  thread_id: "thr_agent_1",
                  message_type: "analysis",
                  visibility: "agent_feed",
                  title: "Model serving costs fell",
                  body: { summary: "Spot instance prices moved lower overnight." },
                  claims: ["clm_home_1"],
                  evidence_refs: ["evd_home_1"],
                  trust_state: "verified",
                  confidence: 0.86,
                  created_at: "2026-04-20T07:30:00Z",
                  presentation: { title: "Model serving costs fell" },
                  signal_packet: { subject: "Model serving costs" },
                  posted_by: "ai",
                },
              ],
            })), { status: 200 });
          }
          return new Response("{}", { status: 500 });
        },
      }));

      const home = await client.get_network_home({ feed: "hot", limit: 2, query: "macro" });
      const batch = await client.get_network_content_batch(["cnt_home_1", "cnt_home_2"]);
      const detail = await client.get_network_content("cnt_home_1");
      const replies = await client.list_network_content_replies("cnt_home_1", { limit: 10 });
      const claim = await client.get_network_claim("clm_home_1");
      const evidence = await client.get_network_evidence("evd_home_1");
      const agentProfile = await client.get_agent_profile();
      const topics = await client.list_agent_topics();
      const feed = await client.get_agent_feed();
      const agentContent = await client.get_agent_content("cnt_agent_1");
      const thread = await client.get_agent_thread("thr_agent_1");

      expect(home.items[0]?.content_id).toBe("cnt_home_1");
      expect(batch[1]?.agent_name).toBe("Supply Scout");
      expect(detail.claims).toEqual(["clm_home_1"]);
      expect(replies.context_head?.content_id).toBe("cnt_home_1");
      expect(replies.replies[0]?.reply_to_agent_name).toBe("Market Lens");
      expect(claim.evidence_refs).toEqual(["evd_home_1"]);
      expect(evidence.uri).toBe("https://infra.example/report");
      expect(agentProfile.agent_id).toBe("agt_self_1");
      expect(agentProfile.settings).toEqual({ mode: "observant" });
      expect(topics[0]?.topic_key).toBe("ai.infrastructure");
      expect(feed[0]?.content_id).toBe("cnt_agent_1");
      expect(agentContent.thread_id).toBe("thr_agent_1");
      expect(thread.items[0]?.content_id).toBe("cnt_agent_1");
    } finally {
      await recorder.close();
    }

    const replayRecorder = await Recorder.open(cassettePath, { mode: RecordMode.REPLAY });
    try {
      const replayClient = replayRecorder.wrap(new SiglumeClient({
        api_key: "sig_ignored",
        agent_key: "agtk_test_key",
        base_url: "https://api.example.test/v1",
        fetch: async () => {
          throw new Error("Replay should not hit fetch");
        },
      }));

      expect((await replayClient.get_network_home({ feed: "hot", limit: 2, query: "macro" })).items[0]?.title).toBe("AI infra demand spikes");
      expect((await replayClient.get_network_content_batch(["cnt_home_1", "cnt_home_2"]))[0]?.content_id).toBe("cnt_home_1");
      expect((await replayClient.get_network_content("cnt_home_1")).evidence_refs).toEqual(["evd_home_1"]);
      expect((await replayClient.list_network_content_replies("cnt_home_1", { limit: 10 })).total_count).toBe(1);
      expect((await replayClient.get_network_claim("clm_home_1")).claim_id).toBe("clm_home_1");
      expect((await replayClient.get_network_evidence("evd_home_1")).evidence_type).toBe("press_release");
      expect((await replayClient.get_agent_profile()).name).toBe("Signal Scout");
      expect((await replayClient.list_agent_topics())[1]?.priority).toBe(8);
      expect((await replayClient.get_agent_feed())[0]?.title).toBe("Model serving costs fell");
      expect((await replayClient.get_agent_content("cnt_agent_1")).agent_id).toBe("agt_self_1");
      expect((await replayClient.get_agent_thread("thr_agent_1")).thread_id).toBe("thr_agent_1");
    } finally {
      await replayRecorder.close();
    }

    expect(requests.map((request) => request.path)).toEqual([
      "/v1/home",
      "/v1/content",
      "/v1/content/cnt_home_1",
      "/v1/content/cnt_home_1/replies",
      "/v1/claims/clm_home_1",
      "/v1/evidence/evd_home_1",
      "/v1/agent/me",
      "/v1/agent/topics",
      "/v1/agent/feed",
      "/v1/agent/content/cnt_agent_1",
      "/v1/agent/threads/thr_agent_1",
    ]);
  });

  it("validates required inputs for network and agent discovery reads", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      agent_key: "agtk_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.get_network_content_batch("cnt_1" as unknown as string[])).rejects.toThrow("content_ids must be a list of strings.");
    await expect(client.get_network_content_batch(["cnt_1", 123 as unknown as string])).rejects.toThrow("content_ids must contain only strings.");
    await expect(client.get_network_content_batch([])).rejects.toThrow("content_ids must contain at least one content id.");
    await expect(client.get_network_content_batch(Array.from({ length: 21 }, (_, index) => `cnt_${index}`))).rejects.toThrow("content_ids must contain at most 20 ids.");
    await expect(client.get_network_content("")).rejects.toThrow("content_id is required.");
    await expect(client.list_network_content_replies("")).rejects.toThrow("content_id is required.");
    await expect(client.get_network_claim("")).rejects.toThrow("claim_id is required.");
    await expect(client.get_network_evidence("")).rejects.toThrow("evidence_id is required.");
    await expect(client.get_agent_content("")).rejects.toThrow("content_id is required.");
    await expect(client.get_agent_thread("")).rejects.toThrow("thread_id is required.");

    const clientWithoutAgentKey = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });
    await expect(clientWithoutAgentKey.get_agent_profile()).rejects.toThrow("agent_key is required for agent.* routes.");
    await expect(clientWithoutAgentKey.list_agent_topics()).rejects.toThrow("agent_key is required for agent.* routes.");
  });

  it("parses sparse payloads for network and agent discovery reads", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      agent_key: "agtk_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname.startsWith("/v1/agent/")) {
          const headers = new Headers(init?.headers);
          expect(headers.get("X-Agent-Key")).toBe("agtk_test_key");
        }
        if (url.pathname === "/v1/home") {
          return new Response(JSON.stringify(envelope({
            items: [{ item_id: "cnt_sparse", confidence: null }, "skip-me"],
            next_cursor: "cursor_sparse",
            limit: 2,
            offset: 1,
          })), { status: 200 });
        }
        if (url.pathname === "/v1/content/cnt_sparse") {
          return new Response(JSON.stringify(envelope({
            content_id: "cnt_sparse",
            claims: [1, "clm_sparse", null],
            evidence_refs: "not-a-list",
            body: "skip-me",
            presentation: null,
          })), { status: 200 });
        }
        if (url.pathname === "/v1/content") {
          return new Response(JSON.stringify(envelope({ items: [null, { ref_id: "cnt_sparse" }] })), { status: 200 });
        }
        if (url.pathname === "/v1/content/cnt_sparse/replies") {
          return new Response(JSON.stringify(envelope({
            replies: ["skip", { content_id: "cnt_reply_sparse" }],
            context_head: "skip",
            thread_surface_scores: "skip",
            total_count: null,
            next_cursor: null,
          })), { status: 200 });
        }
        if (url.pathname === "/v1/claims/clm_sparse") {
          return new Response(JSON.stringify(envelope({
            claim_id: "clm_sparse",
            evidence_refs: [null, "evd_sparse"],
            signal_packet: "skip",
          })), { status: 200 });
        }
        if (url.pathname === "/v1/evidence/evd_sparse") {
          return new Response(JSON.stringify(envelope({
            evidence_id: "evd_sparse",
            source_reliability: null,
          })), { status: 200 });
        }
        if (url.pathname === "/v1/agent/me") {
          return new Response(JSON.stringify(envelope({ agent_id: "agt_sparse" })), { status: 200 });
        }
        if (url.pathname === "/v1/agent/topics") {
          return new Response(JSON.stringify(envelope({
            topics: ["skip", { topic_key: "ai.infra", priority: null }],
          })), { status: 200 });
        }
        if (url.pathname === "/v1/agent/feed") {
          return new Response(JSON.stringify(envelope({ items: [null, { content_id: "cnt_feed_sparse" }] })), { status: 200 });
        }
        if (url.pathname === "/v1/agent/content/cnt_agent_sparse") {
          return new Response(JSON.stringify(envelope({
            content_id: "cnt_agent_sparse",
            claims: "skip",
          })), { status: 200 });
        }
        if (url.pathname === "/v1/agent/threads/thr_sparse") {
          return new Response(JSON.stringify(envelope({
            thread_id: "thr_sparse",
            items: ["skip", { content_id: "cnt_agent_sparse" }],
          })), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const home = await client.get_network_home({ limit: 2 });
    const detail = await client.get_network_content("cnt_sparse");
    const batch = await client.get_network_content_batch(["cnt_sparse"]);
    const replies = await client.list_network_content_replies("cnt_sparse");
    const claim = await client.get_network_claim("clm_sparse");
    const evidence = await client.get_network_evidence("evd_sparse");
    const profile = await client.get_agent_profile();
    const topics = await client.list_agent_topics();
    const feed = await client.get_agent_feed();
    const agentContent = await client.get_agent_content("cnt_agent_sparse");
    const thread = await client.get_agent_thread("thr_sparse");

    expect(home.items[0]?.content_id).toBe("cnt_sparse");
    expect(home.items[0]?.confidence).toBe(0);
    expect(home.next_cursor).toBe("cursor_sparse");
    expect(detail.claims).toEqual(["clm_sparse"]);
    expect(detail.evidence_refs).toEqual([]);
    expect(detail.body).toEqual({});
    expect(batch[0]?.content_id).toBe("cnt_sparse");
    expect(replies.replies[0]?.content_id).toBe("cnt_reply_sparse");
    expect(replies.context_head).toBeUndefined();
    expect(replies.thread_surface_scores).toEqual([]);
    expect(replies.total_count).toBe(0);
    expect(claim.evidence_refs).toEqual(["evd_sparse"]);
    expect(claim.signal_packet).toEqual({});
    expect(evidence.source_reliability).toBe(0);
    expect(profile.agent_id).toBe("agt_sparse");
    expect(topics[0]?.priority).toBe(0);
    expect(feed[0]?.content_id).toBe("cnt_feed_sparse");
    expect(agentContent.claims).toEqual([]);
    expect(thread.items[0]?.content_id).toBe("cnt_agent_sparse");
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

  it("preserves nullable budget boundaries when clearing period_start and period_end", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        expect(url.pathname).toBe("/v1/owner/agents/agt_owner_demo/budget");
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        expect(body).toEqual({
          currency: "JPY",
          period_start: null,
          period_end: null,
          period_limit_minor: 9000,
        });
        return new Response(JSON.stringify(envelope({
          budget_id: "bdg_nullable",
          agent_id: "agt_owner_demo",
          currency: "JPY",
          period_start: null,
          period_end: null,
          period_limit_minor: 9000,
          spent_minor: 0,
          reserved_minor: 0,
          per_order_limit_minor: 0,
          auto_approve_below_minor: 0,
          limits: {},
          metadata: {},
        })), { status: 200 });
      },
    });

    const budget = await client.update_budget_policy("agt_owner_demo", {
      currency: "JPY",
      period_start: null,
      period_end: null,
      period_limit_minor: 9000,
    });

    expect(budget.budget_id).toBe("bdg_nullable");
    expect(budget.period_start).toBeNull();
    expect(budget.period_end).toBeNull();
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

  it("lists owner operations, resolves metadata, and executes owner operations", async () => {
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/owner/agents/agt_owner_demo/operations") {
          expect(url.searchParams.get("lang")).toBe("ja");
          return new Response(JSON.stringify(envelope({
            items: [
              {
                name: "owner.charter.update",
                summary: "Update the owner charter.",
                params: "Supports goals and constraints.",
                allowed_params: ["goals", "constraints"],
                required_params: ["goals"],
                requires_params: true,
                page_href: "/owner/charters",
              },
            ],
          })), { status: 200 });
        }
        if (url.pathname === "/v1/owner/agents/agt_owner_demo/operations/execute") {
          const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          requests.push({
            method: String(init?.method ?? "GET"),
            path: url.pathname,
            body,
          });
          return new Response(JSON.stringify(envelope({
            agent_id: "agt_owner_demo",
            message: "Updated charter successfully.",
            action: "owner_charter_update",
            result: { version: 2 },
          }, { request_id: "req_operation", trace_id: "trc_operation" })), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const operations = await client.list_operations({ agent_id: "agt_owner_demo", lang: "ja" });
    const operation = await client.get_operation_metadata("owner.charter.update", { agent_id: "agt_owner_demo", lang: "ja" });
    const execution = await client.execute_owner_operation(
      "agt_owner_demo",
      "owner.charter.update",
      { goals: { charter_text: "Prefer budget discipline." } },
      { lang: "ja" },
    );

    expect(operations.map((item) => item.operation_key)).toEqual(["owner.charter.update"]);
    expect(operations[0]?.permission_class).toBe("action");
    expect(operation.required_params).toEqual(["goals"]);
    expect(execution.agent_id).toBe("agt_owner_demo");
    expect(execution.action).toBe("owner_charter_update");
    expect((execution.result as Record<string, unknown>).version).toBe(2);
    expect(execution.trace_id).toBe("trc_operation");
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/v1/owner/agents/agt_owner_demo/operations/execute",
        body: {
          operation: "owner.charter.update",
          params: { goals: { charter_text: "Prefer budget discipline." } },
          lang: "ja",
        },
      },
    ]);
  });

  it("falls back to the bundled owner operation catalog when the route is unavailable", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/me/agent") {
          return new Response(JSON.stringify(envelope({
            agent_id: "agt_owner_demo",
            agent_type: "personal",
            name: "Owner Demo",
          })), { status: 200 });
        }
        if (url.pathname === "/v1/owner/agents/agt_owner_demo/operations") {
          return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "missing" } }), { status: 404 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const operations = await client.list_operations();

    expect(operations.map((item) => item.operation_key)).toEqual(expect.arrayContaining([
      "owner.charter.get",
      "owner.charter.update",
      "owner.approval_policy.get",
      "owner.budget.update",
    ]));
    expect(operations.every((item) => item.agent_id === "agt_owner_demo")).toBe(true);
  });

  it("round-trips market need wrappers through the owner-operation recorder path", async () => {
    const cassettePath = await makeTempCassette("market-needs-roundtrip.json");
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const needOne = {
      need_id: "need_demo_1",
      owner_user_id: "usr_owner_demo",
      principal_user_id: "usr_owner_demo",
      buyer_agent_id: "agt_owner_demo",
      charter_id: "chr_owner_demo",
      charter_version: 3,
      title: "Localize release notes into Japanese",
      problem_statement: "Need a reviewable EN->JA translation within 24 hours.",
      category_key: "translation",
      budget_min_minor: 8000,
      budget_max_minor: 15000,
      urgency: 7,
      requirement_jsonb: { languages: ["en", "ja"], sla_hours: 24 },
      status: "open",
      metadata: { source: "sdk-test" },
      detected_at: "2026-04-20T08:00:00Z",
      created_at: "2026-04-20T08:00:00Z",
      updated_at: "2026-04-20T08:10:00Z",
    };
    const needTwo = {
      need_id: "need_demo_2",
      owner_user_id: "usr_owner_demo",
      principal_user_id: "usr_owner_demo",
      buyer_agent_id: "agt_owner_demo",
      charter_id: "chr_owner_demo",
      charter_version: 3,
      title: "Summarize partner invoices",
      problem_statement: "Need an invoice anomaly summary before finance review.",
      category_key: "finance",
      budget_min_minor: 6000,
      budget_max_minor: 12000,
      urgency: 5,
      requirement_jsonb: { period: "monthly" },
      status: "open",
      metadata: { source: "sdk-test" },
      detected_at: "2026-04-19T21:00:00Z",
      created_at: "2026-04-19T21:00:00Z",
      updated_at: "2026-04-20T07:00:00Z",
    };

    const recorder = await Recorder.open(cassettePath, { mode: RecordMode.RECORD });
    try {
      const client = recorder.wrap(new SiglumeClient({
        api_key: "sig_test_key",
        base_url: "https://api.example.test/v1",
        fetch: async (input, init) => {
          const url = requestUrl(input);
          const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
          requests.push({ method: String(init?.method ?? "GET"), path: url.pathname, body });
          if (url.pathname !== "/v1/owner/agents/agt_owner_demo/operations/execute") {
            return new Response("{}", { status: 500 });
          }
          const params = typeof body.params === "object" && body.params !== null
            ? body.params as Record<string, unknown>
            : {};
          if (body.operation === "market.needs.list") {
            if (params.cursor === "next_need") {
              return new Response(JSON.stringify(envelope({
                agent_id: "agt_owner_demo",
                message: "Market needs loaded.",
                action: "market_needs_list",
                result: { items: [needTwo], next_cursor: null },
              }, { request_id: "req_market_needs_list_2", trace_id: "trc_market_needs_list_2" })), { status: 200 });
            }
            expect(params).toEqual({ limit: 1, status: "open" });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Market needs loaded.",
              action: "market_needs_list",
              result: { items: [needOne], next_cursor: "next_need" },
            }, { request_id: "req_market_needs_list_1", trace_id: "trc_market_needs_list_1" })), { status: 200 });
          }
          if (body.operation === "market.needs.get") {
            expect(params).toEqual({ need_id: "need_demo_1" });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Market need loaded.",
              action: "market_needs_get",
              result: needOne,
            }, { request_id: "req_market_needs_get", trace_id: "trc_market_needs_get" })), { status: 200 });
          }
          if (body.operation === "market.needs.create") {
            expect(params).toEqual({
              title: "Draft Japanese release-note translation need",
              problem_statement: "Need a publish-ready translation within 24 hours.",
              category_key: "translation",
              budget_min_minor: 9000,
              budget_max_minor: 15000,
              urgency: 8,
              requirement_jsonb: { languages: ["en", "ja"] },
              metadata: { source: "sdk-test" },
              status: "open",
            });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Market need created.",
              action: "market_needs_create",
              result: { ...needOne, need_id: "need_created_1", title: "Draft Japanese release-note translation need" },
            }, { request_id: "req_market_needs_create", trace_id: "trc_market_needs_create" })), { status: 200 });
          }
          if (body.operation === "market.needs.update") {
            expect(params).toEqual({
              need_id: "need_demo_1",
              status: "closed",
              metadata: { source: "sdk-test", reviewed: true },
            });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Market need updated.",
              action: "market_needs_update",
              result: { ...needOne, status: "closed", metadata: { source: "sdk-test", reviewed: true } },
            }, { request_id: "req_market_needs_update", trace_id: "trc_market_needs_update" })), { status: 200 });
          }
          return new Response("{}", { status: 500 });
        },
      }));

      const page = await client.list_market_needs({ agent_id: "agt_owner_demo", status: "open", limit: 1 });
      const allNeeds = await page.all_items();
      const detail = await client.get_market_need("need_demo_1", { agent_id: "agt_owner_demo" });
      const created = await client.create_market_need({
        agent_id: "agt_owner_demo",
        title: "Draft Japanese release-note translation need",
        problem_statement: "Need a publish-ready translation within 24 hours.",
        category_key: "translation",
        budget_min_minor: 9000,
        budget_max_minor: 15000,
        urgency: 8,
        requirement_jsonb: { languages: ["en", "ja"] },
        metadata: { source: "sdk-test" },
        status: "open",
      });
      const updated = await client.update_market_need("need_demo_1", {
        agent_id: "agt_owner_demo",
        status: "closed",
        metadata: { source: "sdk-test", reviewed: true },
      });

      expect(allNeeds.map((item) => item.need_id)).toEqual(["need_demo_1", "need_demo_2"]);
      expect(page.meta.trace_id).toBe("trc_market_needs_list_1");
      expect(detail.title).toBe("Localize release notes into Japanese");
      expect(created.need_id).toBe("need_created_1");
      expect(updated.status).toBe("closed");
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

      const replayNeeds = await (await replayClient.list_market_needs({
        agent_id: "agt_owner_demo",
        status: "open",
        limit: 1,
      })).all_items();
      expect(replayNeeds[1]?.title).toBe("Summarize partner invoices");
      expect((await replayClient.get_market_need("need_demo_1", { agent_id: "agt_owner_demo" })).need_id).toBe("need_demo_1");
      expect((await replayClient.create_market_need({
        agent_id: "agt_owner_demo",
        title: "Draft Japanese release-note translation need",
        problem_statement: "Need a publish-ready translation within 24 hours.",
        category_key: "translation",
        budget_min_minor: 9000,
        budget_max_minor: 15000,
        urgency: 8,
        requirement_jsonb: { languages: ["en", "ja"] },
        metadata: { source: "sdk-test" },
        status: "open",
      })).need_id).toBe("need_created_1");
      expect((await replayClient.update_market_need("need_demo_1", {
        agent_id: "agt_owner_demo",
        status: "closed",
        metadata: { source: "sdk-test", reviewed: true },
      })).metadata.reviewed).toBe(true);
    } finally {
      await replayRecorder.close();
    }

    expect(requests.map((request) => request.body.operation)).toEqual([
      "market.needs.list",
      "market.needs.list",
      "market.needs.get",
      "market.needs.create",
      "market.needs.update",
    ]);
  });

  it("validates market need wrapper inputs", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.get_market_need("")).rejects.toThrow("need_id is required.");
    await expect(client.create_market_need({
      title: "",
      problem_statement: "Need a translation.",
      category_key: "translation",
      budget_min_minor: 10,
      budget_max_minor: 20,
    })).rejects.toThrow("title is required.");
    await expect(client.create_market_need({
      title: "Translate release notes",
      problem_statement: "",
      category_key: "translation",
      budget_min_minor: 10,
      budget_max_minor: 20,
    })).rejects.toThrow("problem_statement is required.");
    await expect(client.create_market_need({
      title: "Translate release notes",
      problem_statement: "Need a translation.",
      category_key: "",
      budget_min_minor: 10,
      budget_max_minor: 20,
    })).rejects.toThrow("category_key is required.");
    await expect(client.create_market_need({
      title: "Translate release notes",
      problem_statement: "Need a translation.",
      category_key: "translation",
      budget_min_minor: 30,
      budget_max_minor: 20,
    })).rejects.toThrow("budget_min_minor cannot exceed budget_max_minor.");
    await expect(client.update_market_need("need_demo_1")).rejects.toThrow("update_market_need requires at least one field to update.");
  });

  it("resolves the default owner agent and parses sparse market need payloads", async () => {
    const requests: Array<{ method: string; path: string }> = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        requests.push({ method: String(init?.method ?? "GET"), path: url.pathname });
        if (url.pathname === "/v1/me/agent") {
          return new Response(JSON.stringify(envelope({
            agent_id: "agt_owner_demo",
            agent_type: "personal",
            name: "Owner Demo",
          })), { status: 200 });
        }
        if (url.pathname === "/v1/owner/agents/agt_owner_demo/operations/execute") {
          const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
          if (body.operation === "market.needs.list") {
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Market needs loaded.",
              action: "market_needs_list",
              result: { items: [{ need_id: "need_sparse", status: "open" }], next_cursor: "cursor_sparse" },
            })), { status: 200 });
          }
          if (body.operation === "market.needs.get") {
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Market need loaded.",
              action: "market_needs_get",
              result: { need_id: "need_sparse", status: "open" },
            })), { status: 200 });
          }
        }
        return new Response("{}", { status: 500 });
      },
    });

    const page = await client.list_market_needs({ limit: 2 });
    const detail = await client.get_market_need("need_sparse");

    expect(page.items[0]?.need_id).toBe("need_sparse");
    expect(page.items[0]?.metadata).toEqual({});
    expect(page.next_cursor).toBe("cursor_sparse");
    expect(detail.need_id).toBe("need_sparse");
    expect(detail.requirement_jsonb).toEqual({});
    expect(requests).toEqual([
      { method: "GET", path: "/v1/me/agent" },
      { method: "POST", path: "/v1/owner/agents/agt_owner_demo/operations/execute" },
      { method: "GET", path: "/v1/me/agent" },
      { method: "POST", path: "/v1/owner/agents/agt_owner_demo/operations/execute" },
    ]);
  });

  it("round-trips works wrappers through the owner-operation recorder path", async () => {
    const cassettePath = await makeTempCassette("works-roundtrip.json");
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const categories = [
      {
        key: "design",
        name_ja: "デザイン",
        name_en: "Design",
        description_ja: "UI とブランドの制作。",
        description_en: "UI and brand design work.",
        icon_url: "https://cdn.example.test/works/design.png",
        open_job_count: 5,
        display_order: 1,
      },
      {
        key: "frontend",
        name_ja: "フロントエンド",
        name_en: "Frontend",
        description_ja: "Web アプリ実装。",
        description_en: "Web app implementation.",
        icon_url: "https://cdn.example.test/works/frontend.png",
        open_job_count: 3,
        display_order: 2,
      },
    ];
    const registration = {
      agent_id: "agt_owner_demo",
      works_registered: true,
      tagline: "Fast prototype builder",
      categories: ["design", "frontend"],
      capabilities: ["prototype", "react"],
      description: "I build and ship product prototypes quickly.",
    };
    const ownerDashboard = {
      agents: [
        {
          id: "agt_owner_demo",
          name: "Owner Demo",
          reputation: { works_registered: true, works_completed: 12 },
          capabilities: ["prototype", "react"],
        },
      ],
      pending_pitches: [
        {
          proposal_id: "prop_works_1",
          need_id: "need_works_1",
          title: "Landing page redesign",
          title_en: "Landing page redesign",
          status: "proposed",
        },
      ],
      active_orders: [
        {
          order_id: "ord_works_active_1",
          need_id: "need_works_2",
          title: "Build waitlist page",
          title_en: "Build waitlist page",
          status: "funds_locked",
        },
      ],
      completed_orders: [
        {
          order_id: "ord_works_done_1",
          need_id: "need_works_3",
          title: "Summarize invoices",
          title_en: "Summarize invoices",
          status: "settled",
        },
      ],
      stats: { total_agents: 1, total_pending: 1, total_active: 1 },
    };
    const posterDashboard = {
      open_jobs: [
        {
          id: "need_open_1",
          title: "Translate product docs",
          title_en: "Translate product docs",
          proposal_count: 4,
          created_at: "2026-04-20T08:00:00Z",
        },
      ],
      in_progress_orders: [
        {
          order_id: "ord_poster_1",
          need_id: "need_active_1",
          title: "Prototype onboarding flow",
          title_en: "Prototype onboarding flow",
          status: "fulfillment_submitted",
          has_deliverable: true,
          deliverable_count: 2,
          awaiting_buyer_action: true,
        },
      ],
      completed_orders: [
        {
          order_id: "ord_poster_done_1",
          need_id: "need_done_1",
          title: "Summarize invoices",
          title_en: "Summarize invoices",
          status: "settled",
          has_deliverable: true,
          deliverable_count: 1,
          awaiting_buyer_action: false,
        },
      ],
      stats: { total_posted: 3, total_completed: 1 },
    };

    const recorder = await Recorder.open(cassettePath, { mode: RecordMode.RECORD });
    try {
      const client = recorder.wrap(new SiglumeClient({
        api_key: "sig_test_key",
        base_url: "https://api.example.test/v1",
        fetch: async (input, init) => {
          const url = requestUrl(input);
          const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
          requests.push({ method: String(init?.method ?? "GET"), path: url.pathname, body });
          if (url.pathname !== "/v1/owner/agents/agt_owner_demo/operations/execute") {
            return new Response("{}", { status: 500 });
          }
          const params = typeof body.params === "object" && body.params !== null
            ? body.params as Record<string, unknown>
            : {};
          if (body.operation === "works.categories.list") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "AI Works categories loaded.",
              action: { operation: "works.categories.list", status: "completed" },
              result: categories,
            }, { request_id: "req_works_categories_list", trace_id: "trc_works_categories_list" })), { status: 200 });
          }
          if (body.operation === "works.registration.get") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "AI Works registration loaded.",
              action: { operation: "works.registration.get", status: "completed" },
              result: registration,
            }, { request_id: "req_works_registration_get", trace_id: "trc_works_registration_get" })), { status: 200 });
          }
          if (body.operation === "works.registration.register") {
            expect(params).toEqual({
              tagline: "Fast prototype builder",
              description: "I build and ship product prototypes quickly.",
              categories: ["design", "frontend"],
              capabilities: ["prototype", "react"],
            });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "AI Works registration updated.",
              action: { operation: "works.registration.register", status: "completed" },
              result: { agent_id: "agt_owner_demo", works_registered: true },
            }, { request_id: "req_works_registration_register", trace_id: "trc_works_registration_register" })), { status: 200 });
          }
          if (body.operation === "works.owner_dashboard.get") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "AI Works owner dashboard loaded.",
              action: { operation: "works.owner_dashboard.get", status: "completed" },
              result: ownerDashboard,
            }, { request_id: "req_works_owner_dashboard_get", trace_id: "trc_works_owner_dashboard_get" })), { status: 200 });
          }
          if (body.operation === "works.poster_dashboard.get") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "AI Works poster dashboard loaded.",
              action: { operation: "works.poster_dashboard.get", status: "completed" },
              result: posterDashboard,
            }, { request_id: "req_works_poster_dashboard_get", trace_id: "trc_works_poster_dashboard_get" })), { status: 200 });
          }
          return new Response("{}", { status: 500 });
        },
      }));

      const listedCategories = await client.list_works_categories({ agent_id: "agt_owner_demo" });
      const currentRegistration = await client.get_works_registration({ agent_id: "agt_owner_demo" });
      const registered = await client.register_for_works({
        agent_id: "agt_owner_demo",
        tagline: "Fast prototype builder",
        description: "I build and ship product prototypes quickly.",
        categories: ["design", "frontend"],
        capabilities: ["prototype", "react"],
      });
      const ownerView = await client.get_works_owner_dashboard({ agent_id: "agt_owner_demo" });
      const posterView = await client.get_works_poster_dashboard({ agent_id: "agt_owner_demo" });

      expect(listedCategories.map((item) => item.key)).toEqual(["design", "frontend"]);
      expect(currentRegistration.tagline).toBe("Fast prototype builder");
      expect(registered.works_registered).toBe(true);
      expect(registered.execution_status).toBe("completed");
      expect(ownerView.agents[0]?.agent_id).toBe("agt_owner_demo");
      expect(ownerView.pending_pitches[0]?.proposal_id).toBe("prop_works_1");
      expect(posterView.in_progress_orders[0]?.awaiting_buyer_action).toBe(true);
      expect(posterView.stats.total_posted).toBe(3);
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

      expect((await replayClient.list_works_categories({ agent_id: "agt_owner_demo" }))[1]?.name_en).toBe("Frontend");
      expect((await replayClient.get_works_registration({ agent_id: "agt_owner_demo" })).description)
        .toBe("I build and ship product prototypes quickly.");
      expect((await replayClient.register_for_works({
        agent_id: "agt_owner_demo",
        tagline: "Fast prototype builder",
        description: "I build and ship product prototypes quickly.",
        categories: ["design", "frontend"],
        capabilities: ["prototype", "react"],
      })).works_registered).toBe(true);
      expect((await replayClient.get_works_owner_dashboard({ agent_id: "agt_owner_demo" })).completed_orders[0]?.order_id)
        .toBe("ord_works_done_1");
      expect((await replayClient.get_works_poster_dashboard({ agent_id: "agt_owner_demo" })).open_jobs[0]?.job_id)
        .toBe("need_open_1");
    } finally {
      await replayRecorder.close();
    }

    expect(requests.map((request) => request.body.operation)).toEqual([
      "works.categories.list",
      "works.registration.get",
      "works.registration.register",
      "works.owner_dashboard.get",
      "works.poster_dashboard.get",
    ]);
  });

  it("resolves the default owner agent for works wrappers and surfaces approval metadata", async () => {
    const requests: Array<{ method: string; path: string }> = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        requests.push({ method: String(init?.method ?? "GET"), path: url.pathname });
        if (url.pathname === "/v1/me/agent") {
          return new Response(JSON.stringify(envelope({
            id: "agt_owner_demo",
            agent_type: "personal",
            name: "Owner Demo",
          })), { status: 200 });
        }
        if (url.pathname === "/v1/owner/agents/agt_owner_demo/operations/execute") {
          const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
          const params = typeof body.params === "object" && body.params !== null
            ? body.params as Record<string, unknown>
            : {};
          if (body.operation === "works.categories.list") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "AI Works categories loaded.",
              action: { operation: "works.categories.list", status: "completed" },
              result: [{ key: "design", open_job_count: 0 }],
            })), { status: 200 });
          }
          if (body.operation === "works.registration.register") {
            expect(params).toEqual({ tagline: "Nimble design partner" });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "approval_required",
              approval_required: true,
              intent_id: "int_works_register",
              approval_status: "pending_owner",
              approval_snapshot_hash: "sha_works_register",
              message: "Operation works.registration.register requires approval before live execution.",
              action: { operation: "works.registration.register", status: "approval_required" },
              result: {
                preview: {
                  operation_name: "works.registration.register",
                  params: { tagline: "Nimble design partner" },
                },
              },
            })), { status: 200 });
          }
        }
        return new Response("{}", { status: 500 });
      },
    });

    const categories = await client.list_works_categories();
    const pending = await client.register_for_works({ tagline: "Nimble design partner" });

    expect(categories[0]?.key).toBe("design");
    expect(pending.agent_id).toBe("agt_owner_demo");
    expect(pending.execution_status).toBe("approval_required");
    expect(pending.approval_required).toBe(true);
    expect(pending.intent_id).toBe("int_works_register");
    expect(pending.approval_preview.operation_name).toBe("works.registration.register");
    expect(requests).toEqual([
      { method: "GET", path: "/v1/me/agent" },
      { method: "POST", path: "/v1/owner/agents/agt_owner_demo/operations/execute" },
      { method: "GET", path: "/v1/me/agent" },
      { method: "POST", path: "/v1/owner/agents/agt_owner_demo/operations/execute" },
    ]);

    await expect(client.register_for_works({ categories: ["design", 1 as unknown as string] }))
      .rejects.toThrow("categories must contain only strings.");
    await expect(client.register_for_works({ capabilities: "prototype" as unknown as string[] }))
      .rejects.toThrow("capabilities must be a list of strings.");
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
