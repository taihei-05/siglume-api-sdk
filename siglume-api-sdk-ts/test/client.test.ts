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
    description: "Compare current retailer offers, return ranked trade-offs, and help the owner decide where to buy.",
    docs_url: "https://docs.example.com/price-compare",
    support_contact: "support@example.com",
    seller_homepage_url: "https://example.com",
    seller_social_url: "https://x.com/example",
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

function buildRuntimeValidation() {
  return {
    public_base_url: "https://api.example.com",
    healthcheck_url: "https://api.example.com/health",
    invoke_url: "https://api.example.com/invoke",
    invoke_method: "POST",
    test_auth_header_name: "X-Siglume-Review-Key",
    test_auth_header_value: "review-secret",
    request_payload: { query: "Sony WH-1000XM5" },
    expected_response_fields: ["summary", "offers"],
  };
}

describe("SiglumeClient", () => {
  it("returns typed objects for auto-register and confirm-registration", async () => {
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const manifest = buildManifest();
    const toolManual = buildToolManual();
    const runtimeValidation = buildRuntimeValidation();
    const oauthCredentials = {
      items: [
        {
          provider_key: "twitter",
          client_id: "client-id",
          client_secret: "client-secret",
          required_scopes: ["tweet.write", "users.read"],
        },
      ],
    };
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        requests.push({ method: String(init?.method ?? "GET"), path: url.pathname, body });
        if (url.pathname === "/v1/market/capabilities/auto-register") {
          expect(body.manifest).toMatchObject({ docs_url: manifest.docs_url });
          expect(body.description).toBe(manifest.description);
          expect(body.tool_manual).toMatchObject({ tool_name: toolManual.tool_name });
          expect(body.runtime_validation).toMatchObject({ invoke_url: runtimeValidation.invoke_url });
          expect((body.oauth_credentials as { items?: Array<{ provider_key?: string }> }).items?.[0]?.provider_key).toBe("twitter");
          expect(body.publisher_identity).toMatchObject({ documentation_url: manifest.docs_url });
          expect(body.legal).toMatchObject({
            publisher_identity: {
              support_contact: manifest.support_contact,
              seller_homepage_url: manifest.seller_homepage_url,
              seller_social_url: manifest.seller_social_url,
            },
          });
          expect(body.jurisdiction).toBe(manifest.jurisdiction);
          return new Response(
            JSON.stringify(
              envelope({
                listing_id: "lst_123",
                status: "draft",
                registration_mode: "upgrade",
                listing_status: "active",
                auto_manifest: { capability_key: "price-compare-helper" },
                confidence: { overall: 0.94 },
                validation_report: { checks: [] },
                oauth_status: { configured: true, missing_providers: [] },
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
                status: "active",
                message: "Listing published automatically after the self-serve checks passed.",
                checklist: { docs_url: true, seller_onboarding: true },
                release: { release_id: "rel_123", release_status: "published" },
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

    const receipt = await client.auto_register(manifest, toolManual, {
      runtime_validation: runtimeValidation,
      oauth_credentials: oauthCredentials,
    });
    const confirmation = await client.confirm_registration(receipt.listing_id);

    expect(receipt.listing_id).toBe("lst_123");
    expect(receipt.trace_id).toBe("trc_test");
    expect(receipt.registration_mode).toBe("upgrade");
    expect(receipt.listing_status).toBe("active");
    expect(receipt.oauth_status).toEqual({ configured: true, missing_providers: [] });
    expect(confirmation.listing_id).toBe("lst_123");
    expect(confirmation.status).toBe("active");
    expect(confirmation.message).toBe("Listing published automatically after the self-serve checks passed.");
    expect(confirmation.checklist).toEqual({ docs_url: true, seller_onboarding: true });
    expect((confirmation.release as { release_status?: string }).release_status).toBe("published");
    expect(confirmation.quality.overall_score).toBe(84);
    expect(confirmation.trace_id).toBe("trc_confirm");
    expect(requests[0]?.path).toBe("/v1/market/capabilities/auto-register");
    expect(requests[1]?.path).toBe("/v1/market/capabilities/lst_123/confirm-auto-register");
  });

  it("wraps oauth_credentials arrays in the canonical items envelope", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/capabilities/auto-register") {
          const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
          expect((body.oauth_credentials as { items?: Array<{ provider_key?: string }> }).items?.[0]?.provider_key).toBe("twitter");
          return new Response(
            JSON.stringify(
              envelope({
                listing_id: "lst_seq",
                status: "draft",
                auto_manifest: {},
                confidence: {},
              }),
            ),
            { status: 201 },
          );
        }
        return new Response("{}", { status: 500 });
      },
    });

    const receipt = await client.auto_register(buildManifest(), buildToolManual(), {
      runtime_validation: buildRuntimeValidation(),
      oauth_credentials: [
        {
          provider_key: "twitter",
          client_id: "client-id",
          client_secret: "client-secret",
          required_scopes: ["tweet.write"],
        },
      ],
    });

    expect(receipt.listing_id).toBe("lst_seq");
  });

  it("hoists input_form_spec from tool_manual before auto_register", async () => {
    const inputFormSpec = {
      version: "1.0",
      title: "Wallet lookup",
      fields: [
        {
          key: "wallet_address",
          type: "text",
          label: "Wallet address",
          required: true,
        },
      ],
    };
    const toolManual = {
      ...buildToolManual(),
      input_form_spec: inputFormSpec,
    };
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/capabilities/auto-register") {
          const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
          expect(body.input_form_spec).toEqual(inputFormSpec);
          expect((body.tool_manual as Record<string, unknown>).input_form_spec).toBeUndefined();
          return new Response(
            JSON.stringify(
              envelope({
                listing_id: "lst_form",
                status: "draft",
                auto_manifest: {},
                confidence: {},
              }),
            ),
            { status: 201 },
          );
        }
        return new Response("{}", { status: 500 });
      },
    });

    const receipt = await client.auto_register(buildManifest(), toolManual, {
      source_url: "https://github.com/example/wallet",
      runtime_validation: buildRuntimeValidation(),
    });

    expect(receipt.listing_id).toBe("lst_form");
  });

  it("rejects non-object oauth_credentials sequence entries before sending the request", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(
      client.auto_register(buildManifest(), buildToolManual(), {
        runtime_validation: buildRuntimeValidation(),
        oauth_credentials: [123 as unknown as Record<string, unknown>],
      }),
    ).rejects.toThrow("oauth_credentials[0] must be a mapping-like object");
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

  it("round-trips installed tool wrappers and surfaces guarded policy updates cleanly", async () => {
    const cassettePath = await makeTempCassette("installed-tool-wrappers.json");
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const toolOne = {
      binding_id: "bind_inst_1",
      listing_id: "lst_inst_1",
      release_id: "rel_inst_1",
      display_name: "Seller Search",
      permission_class: "action",
      binding_status: "active",
      account_readiness: "ready",
      settlement_mode: "embedded_wallet_charge",
      settlement_currency: "USD",
      settlement_network: "polygon",
      accepted_payment_tokens: ["USDC"],
      last_used_at: "2026-04-20T08:30:00Z",
    };
    const toolTwo = {
      binding_id: "bind_inst_2",
      listing_id: "lst_inst_2",
      release_id: "rel_inst_2",
      display_name: "Invoice Mailer",
      permission_class: "read-only",
      binding_status: "active",
      account_readiness: "missing_connected_account",
      settlement_mode: "free",
      accepted_payment_tokens: [],
      last_used_at: null,
    };
    const execution = {
      id: "int_inst_1",
      agent_id: "agt_owner_demo",
      owner_user_id: "usr_owner_demo",
      binding_id: "bind_inst_1",
      release_id: "rel_inst_1",
      source: "owner_ui",
      goal: "Run seller search",
      input_payload_jsonb: { binding_id: "bind_inst_1", query: "translation seller" },
      plan_jsonb: { steps: [{ tool_name: "seller_api_search" }] },
      status: "queued",
      approval_status: null,
      approval_snapshot_jsonb: {},
      metadata_jsonb: { source: "sdk-test" },
      queued_at: "2026-04-20T08:31:00Z",
      created_at: "2026-04-20T08:31:00Z",
      updated_at: "2026-04-20T08:31:00Z",
    };
    const receipt = {
      id: "rcp_inst_1",
      intent_id: "int_inst_1",
      agent_id: "agt_owner_demo",
      owner_user_id: "usr_owner_demo",
      binding_id: "bind_inst_1",
      grant_id: "grt_inst_1",
      release_ids_jsonb: ["rel_inst_1"],
      execution_source: "owner_http",
      status: "completed",
      permission_class: "action",
      approval_status: "approved",
      step_count: 1,
      total_latency_ms: 1820,
      total_billable_units: 2,
      total_amount_usd_cents: 45,
      summary: "Seller search completed.",
      trace_id: "trc_inst_receipt",
      metadata_jsonb: { source: "sdk-test" },
      started_at: "2026-04-20T08:31:05Z",
      completed_at: "2026-04-20T08:31:07Z",
      created_at: "2026-04-20T08:31:07Z",
    };
    const step = {
      id: "stp_inst_1",
      intent_id: "int_inst_1",
      step_id: "step_1",
      tool_name: "seller_api_search",
      binding_id: "bind_inst_1",
      release_id: "rel_inst_1",
      dry_run: false,
      status: "completed",
      args_hash: "hash_args_1",
      args_preview_redacted: "{\"query\":\"translation seller\"}",
      output_hash: "hash_output_1",
      output_preview_redacted: "{\"matches\":3}",
      provider_latency_ms: 910,
      retry_count: 0,
      connected_account_ref: "acct_google_demo",
      metadata_jsonb: { source: "sdk-test" },
      created_at: "2026-04-20T08:31:06Z",
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
          const params =
            body.params && typeof body.params === "object" && !Array.isArray(body.params)
              ? body.params as Record<string, unknown>
              : {};
          if (body.operation === "installed_tools.list") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "Installed tools loaded.",
              action: { operation: body.operation, status: "completed" },
              result: [toolOne, toolTwo],
            }, { request_id: "req_installed_tools_list", trace_id: "trc_installed_tools_list" })), { status: 200 });
          }
          if (body.operation === "installed_tools.connection_readiness") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "Installed tool readiness loaded.",
              action: { operation: body.operation, status: "completed" },
              result: {
                agent_id: "agt_owner_demo",
                all_ready: false,
                bindings: {
                  bind_inst_1: "ready",
                  bind_inst_2: "missing_connected_account",
                },
              },
            }, { request_id: "req_installed_tools_ready", trace_id: "trc_installed_tools_ready" })), { status: 200 });
          }
          if (body.operation === "installed_tools.binding.update_policy") {
            expect(params).toEqual({
              binding_id: "bind_inst_1",
              require_owner_approval: true,
              allowed_tasks_jsonb: ["seller_search"],
              metadata_jsonb: { source: "sdk-test" },
            });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "approval_required",
              approval_required: true,
              intent_id: "ooi_inst_policy_1",
              approval_status: "pending",
              message: "Operation installed_tools.binding.update_policy requires approval before live execution.",
              action: { operation: body.operation, status: "approval_required" },
              result: {
                preview: {
                  operation_name: body.operation,
                  permission_class: "action",
                  risk_level: "high",
                  result_mode: "redacted",
                  params,
                },
                approval_snapshot_hash: "snap_inst_policy_1",
              },
              safety: {
                actor_scope: "owner",
                permission_class: "action",
                risk_level: "high",
                result_mode: "redacted",
                approval_required: true,
                execute_mode: "guarded",
              },
            }, { request_id: "req_installed_tools_policy", trace_id: "trc_installed_tools_policy" })), { status: 200 });
          }
          if (body.operation === "installed_tools.execution.get") {
            expect(params).toEqual({ intent_id: "int_inst_1" });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "Installed tool execution loaded.",
              action: { operation: body.operation, status: "completed" },
              result: execution,
            }, { request_id: "req_installed_tools_execution", trace_id: "trc_installed_tools_execution" })), { status: 200 });
          }
          if (body.operation === "installed_tools.receipts.list") {
            expect(params).toEqual({ limit: 1, offset: 0, status: "completed" });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "Installed tool receipts loaded.",
              action: { operation: body.operation, status: "completed" },
              result: [receipt],
            }, { request_id: "req_installed_tools_receipts_list", trace_id: "trc_installed_tools_receipts_list" })), { status: 200 });
          }
          if (body.operation === "installed_tools.receipts.get") {
            expect(params).toEqual({ receipt_id: "rcp_inst_1" });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "Installed tool receipt loaded.",
              action: { operation: body.operation, status: "completed" },
              result: receipt,
            }, { request_id: "req_installed_tools_receipt_get", trace_id: "trc_installed_tools_receipt_get" })), { status: 200 });
          }
          if (body.operation === "installed_tools.receipts.steps.get") {
            expect(params).toEqual({ receipt_id: "rcp_inst_1" });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "Installed tool receipt steps loaded.",
              action: { operation: body.operation, status: "completed" },
              result: [step],
            }, { request_id: "req_installed_tools_steps", trace_id: "trc_installed_tools_steps" })), { status: 200 });
          }
          return new Response("{}", { status: 500 });
        },
      }));

      const tools = await client.list_installed_tools({ agent_id: "agt_owner_demo" });
      const readiness = await client.get_installed_tools_connection_readiness({ agent_id: "agt_owner_demo" });
      const policyUpdate = await client.update_installed_tool_binding_policy("bind_inst_1", {
        agent_id: "agt_owner_demo",
        require_owner_approval: true,
        allowed_tasks_jsonb: ["seller_search"],
        metadata_jsonb: { source: "sdk-test" },
      });
      const executionRecord = await client.get_installed_tool_execution("int_inst_1", { agent_id: "agt_owner_demo" });
      const receipts = await client.list_installed_tool_receipts({ agent_id: "agt_owner_demo", status: "completed", limit: 1 });
      const receiptRecord = await client.get_installed_tool_receipt("rcp_inst_1", { agent_id: "agt_owner_demo" });
      const steps = await client.get_installed_tool_receipt_steps("rcp_inst_1", { agent_id: "agt_owner_demo" });

      expect(tools.map((item) => item.binding_id)).toEqual(["bind_inst_1", "bind_inst_2"]);
      expect(readiness.all_ready).toBe(false);
      expect(readiness.bindings.bind_inst_2).toBe("missing_connected_account");
      expect(policyUpdate.approval_required).toBe(true);
      expect(policyUpdate.status).toBe("approval_required");
      expect(policyUpdate.intent_id).toBe("ooi_inst_policy_1");
      expect(policyUpdate.approval_snapshot_hash).toBe("snap_inst_policy_1");
      expect(policyUpdate.policy).toBeNull();
      expect(policyUpdate.preview.operation_name).toBe("installed_tools.binding.update_policy");
      expect(executionRecord.intent_id).toBe("int_inst_1");
      expect(executionRecord.input_payload_jsonb.query).toBe("translation seller");
      expect(receipts[0]?.receipt_id).toBe("rcp_inst_1");
      expect(receiptRecord.summary).toBe("Seller search completed.");
      expect(steps[0]?.tool_name).toBe("seller_api_search");
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

      expect((await replayClient.list_installed_tools({ agent_id: "agt_owner_demo" }))[0]?.display_name).toBe("Seller Search");
      expect((await replayClient.get_installed_tools_connection_readiness({ agent_id: "agt_owner_demo" })).bindings.bind_inst_1).toBe("ready");
      expect((await replayClient.update_installed_tool_binding_policy("bind_inst_1", {
        agent_id: "agt_owner_demo",
        require_owner_approval: true,
        allowed_tasks_jsonb: ["seller_search"],
        metadata_jsonb: { source: "sdk-test" },
      })).intent_id).toBe("ooi_inst_policy_1");
      expect((await replayClient.get_installed_tool_execution("int_inst_1", { agent_id: "agt_owner_demo" })).status).toBe("queued");
      expect((await replayClient.list_installed_tool_receipts({ agent_id: "agt_owner_demo", status: "completed", limit: 1 }))[0]?.step_count).toBe(1);
      expect((await replayClient.get_installed_tool_receipt("rcp_inst_1", { agent_id: "agt_owner_demo" })).receipt_id).toBe("rcp_inst_1");
      expect((await replayClient.get_installed_tool_receipt_steps("rcp_inst_1", { agent_id: "agt_owner_demo" }))[0]?.step_id).toBe("step_1");
    } finally {
      await replayRecorder.close();
    }

    expect(requests.map((request) => request.body.operation)).toEqual([
      "installed_tools.list",
      "installed_tools.connection_readiness",
      "installed_tools.binding.update_policy",
      "installed_tools.execution.get",
      "installed_tools.receipts.list",
      "installed_tools.receipts.get",
      "installed_tools.receipts.steps.get",
    ]);
  });

  it("validates installed tool wrapper inputs", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.update_installed_tool_binding_policy("")).rejects.toThrow("binding_id is required.");
    await expect(client.update_installed_tool_binding_policy("bind_inst_1")).rejects.toThrow(
      "update_installed_tool_binding_policy requires at least one policy field to update.",
    );
    await expect(client.get_installed_tool_execution("")).rejects.toThrow("intent_id is required.");
    await expect(client.get_installed_tool_receipt("")).rejects.toThrow("receipt_id is required.");
    await expect(client.get_installed_tool_receipt_steps("")).rejects.toThrow("receipt_id is required.");
  });

  it("resolves the default owner agent and parses sparse installed tool payloads", async () => {
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
          if (body.operation === "installed_tools.list") {
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "Installed tools loaded.",
              result: [{ binding_id: "bind_sparse", listing_id: "lst_sparse" }],
            })), { status: 200 });
          }
          if (body.operation === "installed_tools.connection_readiness") {
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "Installed tool readiness loaded.",
              result: { agent_id: "agt_owner_demo", bindings: { bind_sparse: "ready" } },
            })), { status: 200 });
          }
          if (body.operation === "installed_tools.execution.get") {
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "Installed tool execution loaded.",
              result: { id: "int_sparse", agent_id: "agt_owner_demo", status: "queued" },
            })), { status: 200 });
          }
          if (body.operation === "installed_tools.receipts.get") {
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "Installed tool receipt loaded.",
              result: {
                id: "rcp_sparse",
                intent_id: "int_sparse",
                agent_id: "agt_owner_demo",
                status: "completed",
              },
            })), { status: 200 });
          }
          if (body.operation === "installed_tools.receipts.steps.get") {
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              status: "completed",
              message: "Installed tool receipt steps loaded.",
              result: [{ id: "stp_sparse", intent_id: "int_sparse", step_id: "step_sparse", tool_name: "seller_api_search" }],
            })), { status: 200 });
          }
        }
        return new Response("{}", { status: 500 });
      },
    });

    const tools = await client.list_installed_tools();
    const readiness = await client.get_installed_tools_connection_readiness();
    const execution = await client.get_installed_tool_execution("int_sparse");
    const receipt = await client.get_installed_tool_receipt("rcp_sparse");
    const steps = await client.get_installed_tool_receipt_steps("rcp_sparse");

    expect(tools[0]?.binding_id).toBe("bind_sparse");
    expect(tools[0]?.accepted_payment_tokens).toEqual([]);
    expect(readiness.all_ready).toBe(true);
    expect(readiness.bindings).toEqual({ bind_sparse: "ready" });
    expect(execution.intent_id).toBe("int_sparse");
    expect(execution.input_payload_jsonb).toEqual({});
    expect(receipt.receipt_id).toBe("rcp_sparse");
    expect(receipt.metadata_jsonb).toEqual({});
    expect(steps[0]?.step_receipt_id).toBe("stp_sparse");
    expect(steps[0]?.metadata_jsonb).toEqual({});
    expect(requests).toEqual([
      { method: "GET", path: "/v1/me/agent" },
      { method: "POST", path: "/v1/owner/agents/agt_owner_demo/operations/execute" },
      { method: "GET", path: "/v1/me/agent" },
      { method: "POST", path: "/v1/owner/agents/agt_owner_demo/operations/execute" },
      { method: "GET", path: "/v1/me/agent" },
      { method: "POST", path: "/v1/owner/agents/agt_owner_demo/operations/execute" },
      { method: "GET", path: "/v1/me/agent" },
      { method: "POST", path: "/v1/owner/agents/agt_owner_demo/operations/execute" },
      { method: "GET", path: "/v1/me/agent" },
      { method: "POST", path: "/v1/owner/agents/agt_owner_demo/operations/execute" },
    ]);
  });

  it("records and replays market proposal wrappers", async () => {
    const cassettePath = await makeTempCassette("market-proposals.json");
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    let detailProposalId = "";
    const proposalOne = {
      proposal_id: "prop_demo_1",
      opportunity_id: "opp_demo_1",
      listing_id: "lst_demo_1",
      need_id: "need_demo_1",
      seller_agent_id: "agt_seller_1",
      buyer_agent_id: "agt_owner_demo",
      proposal_kind: "proposal",
      proposed_terms_jsonb: { delivery_days: 7, amount_minor: 25000 },
      status: "draft",
      reason_codes: ["needs_owner_review"],
      approval_policy_snapshot_jsonb: { mode: "owner_review" },
      delegated_budget_snapshot_jsonb: { remaining_minor: 50000 },
      explanation: { summary: "Opening proposal." },
      soft_budget_check: { within_budget: true },
      created_at: "2026-04-20T08:00:00Z",
      updated_at: "2026-04-20T08:05:00Z",
    };
    const proposalTwo = {
      proposal_id: "prop_demo_2",
      opportunity_id: "opp_demo_1",
      listing_id: "lst_demo_1",
      need_id: "need_demo_1",
      seller_agent_id: "agt_seller_1",
      buyer_agent_id: "agt_owner_demo",
      proposal_kind: "counter",
      proposed_terms_jsonb: { delivery_days: 5, amount_minor: 26000 },
      status: "pending_buyer",
      reason_codes_jsonb: ["counter_received"],
      approval_policy_snapshot_jsonb: { mode: "owner_review" },
      delegated_budget_snapshot_jsonb: { remaining_minor: 50000 },
      explanation: { summary: "Counter proposal." },
      soft_budget_check: { within_budget: true },
      created_at: "2026-04-20T09:00:00Z",
      updated_at: "2026-04-20T09:10:00Z",
    };

    const approvalEnvelope = (
      operationKey: string,
      intentId: string,
      preview: Record<string, unknown>,
      traceId: string,
      requestId: string,
    ) => new Response(JSON.stringify(envelope({
      agent_id: "agt_owner_demo",
      status: "approval_required",
      approval_required: true,
      intent_id: intentId,
      approval_status: "pending_owner",
      approval_snapshot_hash: `snap_${intentId}`,
      message: `${operationKey} requires owner approval.`,
      action: {
        type: "operation",
        operation: operationKey,
        status: "approval_required",
        summary: `${operationKey} staged for owner review.`,
      },
      result: {
        preview,
        approval_snapshot_hash: `snap_${intentId}`,
      },
      safety: { approval_required: true, actor_scope: "owner" },
    }, { request_id: requestId, trace_id: traceId })), { status: 200 });

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
          const params = (body.params && typeof body.params === "object") ? body.params as Record<string, unknown> : {};
          if (body.operation === "market.proposals.list") {
            if (params.cursor === "cursor_2") {
              return new Response(JSON.stringify(envelope({
                agent_id: "agt_owner_demo",
                message: "Market proposals loaded.",
                action: "market_proposals_list",
                result: { items: [proposalTwo], next_cursor: null },
              }, { request_id: "req_market_proposals_list_2", trace_id: "trc_market_proposals_list_2" })), { status: 200 });
            }
            expect(params).toEqual({ limit: 1, status: "draft" });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Market proposals loaded.",
              action: "market_proposals_list",
              result: { items: [proposalOne], next_cursor: "cursor_2" },
            }, { request_id: "req_market_proposals_list_1", trace_id: "trc_market_proposals_list_1" })), { status: 200 });
          }
          if (body.operation === "market.proposals.get") {
            expect(params).toEqual({ proposal_id: "prop_demo_1" });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Market proposal loaded.",
              action: "market_proposals_get",
              result: proposalOne,
            }, { request_id: "req_market_proposals_get", trace_id: "trc_market_proposals_get" })), { status: 200 });
          }
          if (body.operation === "market.proposals.create") {
            expect(params.opportunity_id).toBe("opp_demo_1");
            expect(params.amount_minor).toBe(25000);
            return approvalEnvelope(
              "market.proposals.create",
              "intent_prop_create_1",
              {
                opportunity_id: params.opportunity_id,
                proposal_kind: params.proposal_kind,
                amount_minor: params.amount_minor,
              },
              "trc_market_proposals_create",
              "req_market_proposals_create",
            );
          }
          if (body.operation === "market.proposals.counter") {
            expect(params.proposal_id).toBe("prop_demo_1");
            return approvalEnvelope(
              "market.proposals.counter",
              "intent_prop_counter_1",
              {
                proposal_id: params.proposal_id,
                proposal_kind: params.proposal_kind,
              },
              "trc_market_proposals_counter",
              "req_market_proposals_counter",
            );
          }
          if (body.operation === "market.proposals.accept") {
            expect(params.proposal_id).toBe("prop_demo_1");
            return approvalEnvelope(
              "market.proposals.accept",
              "intent_prop_accept_1",
              {
                proposal_id: params.proposal_id,
                comment: params.comment,
              },
              "trc_market_proposals_accept",
              "req_market_proposals_accept",
            );
          }
          if (body.operation === "market.proposals.reject") {
            expect(params.proposal_id).toBe("prop_demo_1");
            return approvalEnvelope(
              "market.proposals.reject",
              "intent_prop_reject_1",
              {
                proposal_id: params.proposal_id,
                comment: params.comment,
              },
              "trc_market_proposals_reject",
              "req_market_proposals_reject",
            );
          }
          return new Response("{}", { status: 500 });
        },
      }));

      const firstPage = await client.list_market_proposals({ agent_id: "agt_owner_demo", status: "draft", limit: 1 });
      const allProposals = await firstPage.all_items();
      const detail = await client.get_market_proposal("prop_demo_1", { agent_id: "agt_owner_demo" });
      const created = await client.create_market_proposal({
        agent_id: "agt_owner_demo",
        opportunity_id: "opp_demo_1",
        proposal_kind: "proposal",
        currency: "USD",
        amount_minor: 25000,
        proposed_terms_jsonb: { delivery_days: 7 },
      });
      const countered = await client.counter_market_proposal("prop_demo_1", {
        agent_id: "agt_owner_demo",
        proposal_kind: "counter",
        proposed_terms_jsonb: { delivery_days: 5 },
      });
      const accepted = await client.accept_market_proposal("prop_demo_1", {
        agent_id: "agt_owner_demo",
        comment: "Accept if the owner approves.",
      });
      const rejected = await client.reject_market_proposal("prop_demo_1", {
        agent_id: "agt_owner_demo",
        comment: "Reject if the owner does not approve.",
      });

      expect(allProposals.map((item) => item.proposal_id)).toEqual(["prop_demo_1", "prop_demo_2"]);
      expect(firstPage.meta.trace_id).toBe("trc_market_proposals_list_1");
      expect(detail.proposal_kind).toBe("proposal");
      expect(detail.reason_codes).toEqual(["needs_owner_review"]);
      detailProposalId = detail.proposal_id;
      expect(created.approval_required).toBe(true);
      expect(created.action).toBe("market.proposals.create");
      expect(created.intent_id).toBe("intent_prop_create_1");
      expect(countered.approval_snapshot_hash).toBe("snap_intent_prop_counter_1");
      expect(accepted.preview.proposal_id).toBe("prop_demo_1");
      expect(rejected.approval_required).toBe(true);
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

      const replayPage = await replayClient.list_market_proposals({ agent_id: "agt_owner_demo", status: "draft", limit: 1 });
      const replayAll = await replayPage.all_items();
      const replayDetail = await replayClient.get_market_proposal("prop_demo_1", { agent_id: "agt_owner_demo" });
      const replayCreated = await replayClient.create_market_proposal({
        agent_id: "agt_owner_demo",
        opportunity_id: "opp_demo_1",
        proposal_kind: "proposal",
        currency: "USD",
        amount_minor: 25000,
        proposed_terms_jsonb: { delivery_days: 7 },
      });
      const replayCountered = await replayClient.counter_market_proposal("prop_demo_1", {
        agent_id: "agt_owner_demo",
        proposal_kind: "counter",
        proposed_terms_jsonb: { delivery_days: 5 },
      });
      const replayAccepted = await replayClient.accept_market_proposal("prop_demo_1", {
        agent_id: "agt_owner_demo",
        comment: "Accept if the owner approves.",
      });
      const replayRejected = await replayClient.reject_market_proposal("prop_demo_1", {
        agent_id: "agt_owner_demo",
        comment: "Reject if the owner does not approve.",
      });

      expect(replayAll[1]?.proposal_kind).toBe("counter");
      expect(replayDetail.proposal_id).toBe(detailProposalId);
      expect(replayCreated.intent_id).toBe("intent_prop_create_1");
      expect(replayCountered.intent_id).toBe("intent_prop_counter_1");
      expect(replayAccepted.intent_id).toBe("intent_prop_accept_1");
      expect(replayRejected.intent_id).toBe("intent_prop_reject_1");
    } finally {
      await replayRecorder.close();
    }

    expect(requests.map((request) => request.body.operation)).toEqual([
      "market.proposals.list",
      "market.proposals.list",
      "market.proposals.get",
      "market.proposals.create",
      "market.proposals.counter",
      "market.proposals.accept",
      "market.proposals.reject",
    ]);
  });

  it("validates market proposal wrapper inputs", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.get_market_proposal("")).rejects.toThrow("proposal_id is required.");
    await expect(client.create_market_proposal({ opportunity_id: "" })).rejects.toThrow("opportunity_id is required.");
    await expect(client.counter_market_proposal("prop_demo_1")).rejects.toThrow(
      "counter_market_proposal requires at least one field besides proposal_id.",
    );
    await expect(client.accept_market_proposal("")).rejects.toThrow("proposal_id is required.");
    await expect(client.reject_market_proposal("")).rejects.toThrow("proposal_id is required.");
  });

  it.each([
    [{ agent_id: "agt_current" }, "agt_current"],
    [{ id: "agt_legacy" }, "agt_legacy"],
  ])("resolves omitted agent_id for market proposal wrappers (%j)", async (meAgentPayload, expectedAgentId) => {
    const seenPaths: string[] = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        seenPaths.push(url.pathname);
        if (url.pathname === "/v1/me/agent") {
          return new Response(JSON.stringify(envelope(meAgentPayload)), { status: 200 });
        }
        if (url.pathname === `/v1/owner/agents/${expectedAgentId}/operations/execute`) {
          const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
          if (body.operation === "market.proposals.list") {
            return new Response(JSON.stringify(envelope({
              agent_id: expectedAgentId,
              message: "Market proposals loaded.",
              action: { operation: "market.proposals.list" },
              result: { items: [{ proposal_id: "prop_sparse", status: "draft" }], next_cursor: null },
            })), { status: 200 });
          }
          if (body.operation === "market.proposals.get") {
            return new Response(JSON.stringify(envelope({
              agent_id: expectedAgentId,
              message: "Market proposal loaded.",
              action: { operation: "market.proposals.get" },
              result: { proposal_id: "prop_sparse", status: "draft" },
            })), { status: 200 });
          }
          if ([
            "market.proposals.create",
            "market.proposals.counter",
            "market.proposals.accept",
            "market.proposals.reject",
          ].includes(String(body.operation))) {
            return new Response(JSON.stringify(envelope({
              agent_id: expectedAgentId,
              status: "approval_required",
              approval_required: true,
              intent_id: `intent_${String(body.operation).replaceAll(".", "_")}`,
              approval_status: "pending_owner",
              approval_snapshot_hash: `snap_${String(body.operation).replaceAll(".", "_")}`,
              message: `${String(body.operation)} requires owner approval.`,
              action: { type: "operation", operation: body.operation },
              result: { preview: { operation: body.operation } },
              safety: { approval_required: true },
            })), { status: 200 });
          }
        }
        return new Response("{}", { status: 500 });
      },
    });

    const page = await client.list_market_proposals({ limit: 2 });
    const detail = await client.get_market_proposal("prop_sparse");
    const created = await client.create_market_proposal({ opportunity_id: "opp_demo_1" });
    const countered = await client.counter_market_proposal("prop_sparse", { proposal_kind: "counter" });
    const accepted = await client.accept_market_proposal("prop_sparse");
    const rejected = await client.reject_market_proposal("prop_sparse");

    expect(page.items[0]?.proposal_id).toBe("prop_sparse");
    expect(detail.proposal_id).toBe("prop_sparse");
    expect(created.approval_required).toBe(true);
    expect(created.status).toBe("approval_required");
    expect(created.intent_id).toBe("intent_market_proposals_create");
    expect(created.preview).toEqual({ operation: "market.proposals.create" });
    expect(countered.intent_id).toBe("intent_market_proposals_counter");
    expect(accepted.intent_id).toBe("intent_market_proposals_accept");
    expect(rejected.intent_id).toBe("intent_market_proposals_reject");
    expect(seenPaths).toContain(`/v1/owner/agents/${expectedAgentId}/operations/execute`);
  });

  it("round-trips partner and ads wrappers through the owner-operation recorder path", async () => {
    const cassettePath = await makeTempCassette("partner-and-ads-roundtrip.json");
    const requests: Array<{ method: string; path: string; operation?: string | null }> = [];

    const recorder = await Recorder.open(cassettePath, { mode: RecordMode.RECORD });
    try {
      const client = recorder.wrap(new SiglumeClient({
        api_key: "sig_test_key",
        base_url: "https://api.example.test/v1",
        fetch: async (input, init) => {
          const url = requestUrl(input);
          const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
          requests.push({
            method: String(init?.method ?? "GET"),
            path: url.pathname,
            operation: typeof body.operation === "string" ? body.operation : null,
          });
          if (url.pathname !== "/v1/owner/agents/agt_owner_demo/operations/execute") {
            return new Response("{}", { status: 500 });
          }
          const params = typeof body.params === "object" && body.params !== null
            ? body.params as Record<string, unknown>
            : {};
          if (body.operation === "partner.dashboard.get") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Partner dashboard loaded.",
              action: "partner_dashboard_get",
              result: {
                partner_id: "usr_partner_demo",
                company_name: "Demo Feeds",
                plan: "starter",
                plan_label: "Starter",
                month_bytes_used: 1048576,
                month_bytes_limit: 10485760,
                month_usage_pct: 10,
                total_source_items: 3,
                has_billing: true,
                has_subscription: true,
              },
            }, { trace_id: "trc_partner_dashboard", request_id: "req_partner_dashboard" })), { status: 200 });
          }
          if (body.operation === "partner.usage.get") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Partner usage loaded.",
              action: "partner_usage_get",
              result: {
                plan: "starter",
                month_bytes_used: 1048576,
                month_bytes_limit: 10485760,
                month_bytes_remaining: 9437184,
                month_usage_pct: 10,
              },
            }, { trace_id: "trc_partner_usage", request_id: "req_partner_usage" })), { status: 200 });
          }
          if (body.operation === "partner.keys.list") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Partner API keys loaded.",
              action: "partner_keys_list",
              result: {
                keys: [{
                  credential_id: "cred_partner_1",
                  name: "Primary Feed",
                  key_id: "src_partner_1",
                  allowed_source_types: ["partner_api", "rss"],
                  last_used_at: "2026-04-20T08:40:00Z",
                  created_at: "2026-04-19T23:10:00Z",
                  revoked: false,
                }],
              },
            }, { trace_id: "trc_partner_keys_list", request_id: "req_partner_keys_list" })), { status: 200 });
          }
          if (body.operation === "partner.keys.create") {
            expect(params).toEqual({ name: "SDK Feed", allowed_source_types: ["rss", "partner_api"] });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Partner API key created.",
              action: "partner_keys_create",
              result: {
                credential_id: "cred_partner_2",
                name: "SDK Feed",
                key_id: "src_partner_2",
                allowed_source_types: ["rss", "partner_api"],
                masked_key_hint: "src_partner_2.********",
              },
            }, { trace_id: "trc_partner_keys_create", request_id: "req_partner_keys_create" })), { status: 200 });
          }
          if (body.operation === "ads.billing.get") {
            expect(params).toEqual({ rail: "web3" });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Ads billing loaded.",
              action: "ads_billing_get",
              result: {
                currency: "usd",
                billing_mode: "web3",
                month_spend_jpy: 0,
                month_spend_usd: 12000,
                all_time_spend_jpy: 0,
                all_time_spend_usd: 54000,
                total_impressions: 18300,
                total_replies: 37,
                has_billing: true,
                has_subscription: true,
                balances: [{ symbol: "USDC", amount_minor: 700000 }],
                supported_tokens: [{ symbol: "USDC", decimals: 6 }],
                funding_instructions: { network: "polygon", memo: "fund-usdc" },
                wallet: { user_wallet_id: "uw_ads_1", smart_account_address: "0xabc" },
                mandate: {
                  mandate_id: "mdt_ads_1",
                  purpose: "ad_spend",
                  display_currency: "USD",
                  token_symbol: "USDC",
                  max_amount_minor: 30000,
                  status: "active",
                },
                invoices: [{ invoice_id: "inv_ads_1", amount_due_minor: 12000 }],
              },
            }, { trace_id: "trc_ads_billing", request_id: "req_ads_billing" })), { status: 200 });
          }
          if (body.operation === "ads.billing.settle") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Ads billing settlement status loaded.",
              action: "ads_billing_settle",
              result: {
                status: "auto_settles",
                message: "Ads Web3 billing settles automatically at month end.",
                settles_automatically: true,
              },
            }, { trace_id: "trc_ads_settle", request_id: "req_ads_settle" })), { status: 200 });
          }
          if (body.operation === "ads.profile.get") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Ads profile loaded.",
              action: "ads_profile_get",
              result: {
                has_profile: true,
                company_name: "Demo Ads",
                ad_currency: "usd",
                has_billing: true,
              },
            }, { trace_id: "trc_ads_profile", request_id: "req_ads_profile" })), { status: 200 });
          }
          if (body.operation === "ads.campaigns.list") {
            expect(params).toEqual({});
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Ad campaigns loaded.",
              action: "ads_campaigns_list",
              result: {
                campaigns: [{
                  campaign_id: "cmp_ads_1",
                  name: "Spring Launch",
                  target_url: "https://example.com/spring-launch",
                  content_brief: "Promote the launch announcement.",
                  target_topics: ["ai", "launch"],
                  posting_interval_minutes: 720,
                  max_posts_per_day: 2,
                  currency: "usd",
                  monthly_budget_jpy: 30000,
                  cpm_jpy: 250,
                  cpr_jpy: 30,
                  monthly_budget_usd: 30000,
                  cpm_usd: 250,
                  cpr_usd: 30,
                  status: "active",
                  month_spend_jpy: 0,
                  month_spend_usd: 12000,
                  total_posts: 4,
                  total_impressions: 18300,
                  total_replies: 37,
                  next_post_at: "2026-04-20T16:00:00Z",
                  created_at: "2026-04-19T09:00:00Z",
                }],
              },
            }, { trace_id: "trc_ads_campaigns", request_id: "req_ads_campaigns" })), { status: 200 });
          }
          if (body.operation === "ads.campaign_posts.list") {
            expect(params).toEqual({ campaign_id: "cmp_ads_1" });
            return new Response(JSON.stringify(envelope({
              agent_id: "agt_owner_demo",
              message: "Ad campaign posts loaded.",
              action: "ads_campaign_posts_list",
              result: {
                posts: [{
                  post_id: "pst_ads_1",
                  content_id: "cnt_ads_1",
                  cost_jpy: 0,
                  cost_usd: 1200,
                  impressions: 5000,
                  replies: 11,
                  status: "served",
                  created_at: "2026-04-20T07:00:00Z",
                }],
              },
            }, { trace_id: "trc_ads_posts", request_id: "req_ads_posts" })), { status: 200 });
          }
          return new Response("{}", { status: 500 });
        },
      }));

      const dashboard = await client.get_partner_dashboard({ agent_id: "agt_owner_demo" });
      const usage = await client.get_partner_usage({ agent_id: "agt_owner_demo" });
      const keys = await client.list_partner_api_keys({ agent_id: "agt_owner_demo" });
      const createdKey = await client.create_partner_api_key({
        agent_id: "agt_owner_demo",
        name: "SDK Feed",
        allowed_source_types: ["rss", "partner_api"],
      });
      const billing = await client.get_ads_billing({ agent_id: "agt_owner_demo", rail: "web3" });
      const settlement = await client.settle_ads_billing({ agent_id: "agt_owner_demo" });
      const profile = await client.get_ads_profile({ agent_id: "agt_owner_demo" });
      const campaigns = await client.list_ads_campaigns({ agent_id: "agt_owner_demo" });
      const posts = await client.list_ads_campaign_posts("cmp_ads_1", { agent_id: "agt_owner_demo" });

      expect(dashboard.plan).toBe("starter");
      expect(dashboard.total_source_items).toBe(3);
      expect(usage.month_bytes_remaining).toBe(9437184);
      expect(keys[0]?.key_id).toBe("src_partner_1");
      expect(keys[0]?.allowed_source_types).toEqual(["partner_api", "rss"]);
      expect(createdKey.masked_key_hint).toBe("src_partner_2.********");
      expect(billing.billing_mode).toBe("web3");
      expect(billing.mandate?.mandate_id).toBe("mdt_ads_1");
      expect(billing.supported_tokens[0]?.symbol).toBe("USDC");
      expect(settlement.settles_automatically).toBe(true);
      expect(profile.company_name).toBe("Demo Ads");
      expect(campaigns[0]?.campaign_id).toBe("cmp_ads_1");
      expect(campaigns[0]?.total_impressions).toBe(18300);
      expect(posts[0]?.post_id).toBe("pst_ads_1");
      expect(posts[0]?.cost_usd).toBe(1200);
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

      expect((await replayClient.get_partner_dashboard({ agent_id: "agt_owner_demo" })).partner_id).toBe("usr_partner_demo");
      expect((await replayClient.get_partner_usage({ agent_id: "agt_owner_demo" })).plan).toBe("starter");
      expect((await replayClient.list_partner_api_keys({ agent_id: "agt_owner_demo" }))[0]?.created_at).toBe("2026-04-19T23:10:00Z");
      expect((await replayClient.create_partner_api_key({
        agent_id: "agt_owner_demo",
        name: "SDK Feed",
        allowed_source_types: ["rss", "partner_api"],
      })).key_id).toBe("src_partner_2");
      expect((await replayClient.get_ads_billing({ agent_id: "agt_owner_demo", rail: "web3" })).wallet).toEqual({
        user_wallet_id: "uw_ads_1",
        smart_account_address: "0xabc",
      });
      expect((await replayClient.settle_ads_billing({ agent_id: "agt_owner_demo" })).status).toBe("auto_settles");
      expect((await replayClient.get_ads_profile({ agent_id: "agt_owner_demo" })).has_profile).toBe(true);
      expect((await replayClient.list_ads_campaigns({ agent_id: "agt_owner_demo" }))[0]?.target_topics).toEqual(["ai", "launch"]);
      expect((await replayClient.list_ads_campaign_posts("cmp_ads_1", { agent_id: "agt_owner_demo" }))[0]?.status).toBe("served");
    } finally {
      await replayRecorder.close();
    }

    expect(requests.map((request) => request.operation)).toEqual([
      "partner.dashboard.get",
      "partner.usage.get",
      "partner.keys.list",
      "partner.keys.create",
      "ads.billing.get",
      "ads.billing.settle",
      "ads.profile.get",
      "ads.campaigns.list",
      "ads.campaign_posts.list",
    ]);
  });

  it("validates partner and ads wrapper inputs and scrubs handle-only key payloads", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response("{}", { status: 500 }),
    });

    await expect(client.create_partner_api_key({ agent_id: "agt_owner_demo", name: "  " })).rejects.toThrow("name cannot be empty.");
    await expect(client.create_partner_api_key({
      agent_id: "agt_owner_demo",
      allowed_source_types: "rss" as unknown as string[],
    })).rejects.toThrow("allowed_source_types must be a list of strings.");
    await expect(client.create_partner_api_key({
      agent_id: "agt_owner_demo",
      allowed_source_types: ["rss", 7 as unknown as string],
    })).rejects.toThrow("allowed_source_types must contain only strings.");
    await expect(client.list_ads_campaign_posts("")).rejects.toThrow("campaign_id is required.");

    const scrubClient = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        expect(url.pathname).toBe("/v1/owner/agents/agt_owner_demo/operations/execute");
        expect(body.operation).toBe("partner.keys.create");
        return new Response(JSON.stringify(envelope({
          agent_id: "agt_owner_demo",
          message: "Partner API key created.",
          action: "partner_keys_create",
          result: {
            credential_id: "cred_partner_scrubbed",
            name: "Leak Test",
            key_id: "src_partner_scrubbed",
            allowed_source_types: ["rss"],
            masked_key_hint: "src_partner_scrubbed.********",
            ingest_key: "src_partner_scrubbed.super_secret",
            full_key: "src_partner_scrubbed.super_secret",
          },
        })), { status: 200 });
      },
    });

    const created = await scrubClient.create_partner_api_key({
      agent_id: "agt_owner_demo",
      name: "Leak Test",
      allowed_source_types: ["rss"],
    });

    expect(created.credential_id).toBe("cred_partner_scrubbed");
    expect(created.allowed_source_types).toEqual(["rss"]);
    expect(created.masked_key_hint).toBe("src_partner_scrubbed.********");
    expect("ingest_key" in created).toBe(false);
    expect("ingest_key" in created.raw).toBe(false);
    expect("full_key" in created.raw).toBe(false);
  });

  it("resolves default agents for partner and ads wrappers and parses sparse payloads", async () => {
    const requests: Array<{ method: string; path: string; operation?: string | null }> = [];
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        requests.push({ method: String(init?.method ?? "GET"), path: url.pathname, operation: typeof body.operation === "string" ? body.operation : null });
        if (url.pathname === "/v1/me/agent") {
          return new Response(JSON.stringify(envelope({
            id: "agt_owner_demo",
            agent_type: "personal",
            name: "Owner Demo",
          })), { status: 200 });
        }
        if (url.pathname !== "/v1/owner/agents/agt_owner_demo/operations/execute") {
          return new Response("{}", { status: 500 });
        }
        if (body.operation === "partner.dashboard.get") {
          return new Response(JSON.stringify(envelope({ result: { partner_id: "usr_sparse", has_billing: 1, has_subscription: 0 } })), { status: 200 });
        }
        if (body.operation === "partner.usage.get") {
          return new Response(JSON.stringify(envelope({ result: { month_bytes_used: null, month_bytes_limit: "1024" } })), { status: 200 });
        }
        if (body.operation === "partner.keys.list") {
          return new Response(JSON.stringify(envelope({ result: { keys: [null, { credential_id: "cred_sparse" }] } })), { status: 200 });
        }
        if (body.operation === "partner.keys.create") {
          return new Response(JSON.stringify(envelope({
            result: {
              credential_id: "cred_sparse_created",
              key_id: "src_sparse",
              masked_key_hint: "src_sparse.********",
              ingest_key: "src_sparse.secret",
            },
          })), { status: 200 });
        }
        if (body.operation === "ads.billing.get") {
          return new Response(JSON.stringify(envelope({
            result: {
              billing_mode: "web3",
              balances: "skip",
              supported_tokens: "skip",
              funding_instructions: "skip",
              wallet: "skip",
              mandate: "skip",
            },
          })), { status: 200 });
        }
        if (body.operation === "ads.billing.settle") {
          return new Response(JSON.stringify(envelope({ result: { detail: "auto" } })), { status: 200 });
        }
        if (body.operation === "ads.profile.get") {
          return new Response(JSON.stringify(envelope({ result: { company_name: null } })), { status: 200 });
        }
        if (body.operation === "ads.campaigns.list") {
          return new Response(JSON.stringify(envelope({
            result: {
              campaigns: [null, { campaign_id: "cmp_sparse", total_posts: null, status: null }],
            },
          })), { status: 200 });
        }
        if (body.operation === "ads.campaign_posts.list") {
          return new Response(JSON.stringify(envelope({
            result: {
              posts: [null, { post_id: "pst_sparse", impressions: null, cost_usd: "1500" }],
            },
          })), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const dashboard = await client.get_partner_dashboard();
    const usage = await client.get_partner_usage({ agent_id: "agt_owner_demo" });
    const keys = await client.list_partner_api_keys();
    const created = await client.create_partner_api_key({ agent_id: "agt_owner_demo" });
    const billing = await client.get_ads_billing();
    const settlement = await client.settle_ads_billing({ agent_id: "agt_owner_demo" });
    const profile = await client.get_ads_profile({ agent_id: "agt_owner_demo" });
    const campaigns = await client.list_ads_campaigns({ agent_id: "agt_owner_demo" });
    const posts = await client.list_ads_campaign_posts("cmp_sparse");

    expect(dashboard.partner_id).toBe("usr_sparse");
    expect(dashboard.has_billing).toBe(true);
    expect(dashboard.has_subscription).toBe(false);
    expect(usage.month_bytes_used).toBe(0);
    expect(usage.month_bytes_limit).toBe(1024);
    expect(usage.plan).toBeUndefined();
    expect(keys[0]?.credential_id).toBe("cred_sparse");
    expect(keys[0]?.allowed_source_types).toEqual([]);
    expect(created.key_id).toBe("src_sparse");
    expect("ingest_key" in created.raw).toBe(false);
    expect(billing.billing_mode).toBe("web3");
    expect(billing.wallet).toBeNull();
    expect(billing.balances).toEqual([]);
    expect(billing.mandate).toBeNull();
    expect(settlement.message).toBe("auto");
    expect(settlement.settles_automatically).toBeUndefined();
    expect(profile.has_profile).toBe(false);
    expect(profile.ad_currency).toBeUndefined();
    expect(campaigns[0]?.campaign_id).toBe("cmp_sparse");
    expect(campaigns[0]?.total_posts).toBe(0);
    expect(campaigns[0]?.status).toBe("active");
    expect(posts[0]?.post_id).toBe("pst_sparse");
    expect(posts[0]?.impressions).toBe(0);
    expect(posts[0]?.cost_usd).toBe(1500);
    expect(requests.filter((request) => request.path === "/v1/me/agent")).toHaveLength(4);
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
