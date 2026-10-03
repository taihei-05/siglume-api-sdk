import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  AppCategory,
  ApprovalMode,
  PermissionClass,
  PersistenceMode,
  PriceModel,
  RecordMode,
  Recorder,
  SiglumeAPIError,
  SiglumeClient,
  ToolManualPermissionClass,
} from "../src/index";

const tempDirs: string[] = [];

const SAVE_DATA_SCHEMA = {
  type: "object",
  properties: {
    agent: { type: "object" },
    avatar_config: { type: "object" },
    replays: { type: "array" },
  },
  required: ["agent"],
};

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
    store_vertical: "api" as const,
    permission_class: PermissionClass.READ_ONLY,
    approval_mode: ApprovalMode.AUTO,
    dry_run_supported: true,
    required_connected_accounts: [],
    price_model: PriceModel.FREE,
    currency: "USD" as const,
    allow_free_trial: false,
    jurisdiction: "US",
    short_description: "Compare retailer prices before buying.",
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

it("rejects listing text over public copy limits before auto-register", async () => {
  const client = new SiglumeClient({
    api_key: "sig_test_key",
    fetch: async () => new Response(JSON.stringify(envelope({})), { status: 500 }),
  });

  await expect(
    client.auto_register({ ...buildManifest(), short_description: "x".repeat(61) }, buildToolManual()),
  ).rejects.toThrow("short_description");
  await expect(
    client.auto_register({ ...buildManifest(), job_to_be_done: "x".repeat(241) }, buildToolManual()),
  ).rejects.toThrow("job_to_be_done");
  await expect(
    client.auto_register({ ...buildManifest(), description: "x".repeat(1001) }, buildToolManual()),
  ).rejects.toThrow("description");
});

describe("SiglumeClient", () => {
  it("rejects JPY operation prices below the platform minimum before transport", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        throw new Error(`Validation should fail before transport: ${requestUrl(input).pathname}`);
      },
    });

    await expect(
      client.auto_register(
        {
          ...buildManifest(),
          capability_key: "x-poster",
          name: "X Poster",
          job_to_be_done: "Post approved social updates.",
          category: AppCategory.COMMUNICATION,
          permission_class: PermissionClass.ACTION,
          approval_mode: ApprovalMode.ALWAYS_ASK,
          dry_run_supported: true,
          price_model: PriceModel.PER_ACTION,
          price_value_minor: 0,
          pricing_plan: {
            currency: "JPY",
            items: [{ key: "text_post", label: "Text post", price_minor: 5 }],
          },
          currency: "JPY",
          jurisdiction: "JP",
        },
        buildToolManual(),
      ),
    ).rejects.toThrow("at least 15");
  });

  it("returns typed objects for auto-register and confirm-registration", async () => {
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const manifest = buildManifest();
    const toolManual = buildToolManual();
    const runtimeValidation = buildRuntimeValidation();
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
          expect(body).not.toHaveProperty("oauth_credentials");
          expect(body.publisher_identity).toMatchObject({ documentation_url: manifest.docs_url });
          expect(body.legal).toMatchObject({
            publisher_identity: {
              support_contact: manifest.support_contact,
              seller_homepage_url: manifest.seller_homepage_url,
              seller_social_url: manifest.seller_social_url,
            },
          });
          expect(body.jurisdiction).toBe(manifest.jurisdiction);
          expect(body.currency).toBe("USD");
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
                review_url: "/owner/publish?listing=lst_123",
              }),
            ),
            { status: 201 },
          );
        }
        if (url.pathname === "/v1/market/capabilities/lst_123/confirm-auto-register") {
          expect(body.approved).toBe(true);
          expect(body.visibility).toBe("public");
          return new Response(
            JSON.stringify(
              envelope({
                listing_id: "lst_123",
                status: "active",
                visibility: "public",
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
    });
    const confirmation = await client.confirm_registration(receipt.listing_id);

    expect(receipt.listing_id).toBe("lst_123");
    expect(receipt.trace_id).toBe("trc_test");
    expect(receipt.registration_mode).toBe("upgrade");
    expect(receipt.listing_status).toBe("active");
    expect(confirmation.listing_id).toBe("lst_123");
    expect(confirmation.status).toBe("active");
    expect(confirmation.visibility).toBe("public");
    expect(confirmation.message).toBe("Listing published automatically after the self-serve checks passed.");
    expect(confirmation.checklist).toEqual({ docs_url: true, seller_onboarding: true });
    expect((confirmation.release as { release_status?: string }).release_status).toBe("published");
    expect(confirmation.quality.overall_score).toBe(84);
    expect(confirmation.trace_id).toBe("trc_confirm");
    expect(requests[0]?.path).toBe("/v1/market/capabilities/auto-register");
    expect(requests[1]?.path).toBe("/v1/market/capabilities/lst_123/confirm-auto-register");
  });

  it("confirms registration privately when requested", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        expect(url.pathname).toBe("/v1/market/capabilities/lst_123/confirm-auto-register");
        expect(body).toEqual({ approved: true, visibility: "private" });
        return new Response(
          JSON.stringify(
            envelope({
              listing_id: "lst_123",
              status: "hidden",
              visibility: "private",
              message: "Listing confirmed privately.",
              checklist: { docs_url: true },
              release: { release_id: "rel_123", release_status: "published" },
              quality: { overall_score: 91, grade: "A", issues: [], improvement_suggestions: [] },
            }),
          ),
          { status: 200 },
        );
      },
    });

    const confirmation = await client.confirm_registration("lst_123", { visibility: "private" });

    expect(confirmation.status).toBe("hidden");
    expect(confirmation.visibility).toBe("private");
    expect((confirmation.release as { release_id?: string }).release_id).toBe("rel_123");
  });

  it("requires an explicit listing currency before auto_register", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => {
        throw new Error("auto_register should fail before transport");
      },
    });
    const manifest = { ...buildManifest() };
    delete (manifest as Record<string, unknown>).currency;

    await expect(
      client.auto_register(manifest, buildToolManual(), {
        runtime_validation: buildRuntimeValidation(),
      }),
    ).rejects.toThrow("AppManifest.currency is required");
  });

  it("requires an explicit free-trial opt-in before auto_register", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => {
        throw new Error("auto_register should fail before transport");
      },
    });
    const manifest = { ...buildManifest() };
    delete (manifest as Record<string, unknown>).allow_free_trial;

    await expect(
      client.auto_register(manifest, buildToolManual(), {
        runtime_validation: buildRuntimeValidation(),
      }),
    ).rejects.toThrow("AppManifest.allow_free_trial is required");
  });

  it("rejects out-of-range free-trial duration before auto_register", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => {
        throw new Error("auto_register should fail before transport");
      },
    });

    await expect(
      client.auto_register(
        { ...buildManifest(), allow_free_trial: true, free_trial_duration_days: 200 },
        buildToolManual(),
        { runtime_validation: buildRuntimeValidation() },
      ),
    ).rejects.toThrow("free_trial_duration_days must be between 1 and 90");
  });

  it("requires save_data_schema for game manifests with save persistence", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => {
        throw new Error("auto_register should fail before transport");
      },
    });

    await expect(
      client.auto_register(
        {
          ...buildManifest(),
          store_vertical: "game",
          persistence: { mode: PersistenceMode.PLATFORM },
        },
        buildToolManual(),
        { runtime_validation: buildRuntimeValidation() },
      ),
    ).rejects.toThrow("persistence.save_data_schema is required");
  });

  it("rejects invalid persistence contracts before auto_register", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => {
        throw new Error("auto_register should fail before transport");
      },
    });

    await expect(
      client.auto_register(
        { ...buildManifest(), persistence: { mode: "remote" } },
        buildToolManual(),
        { runtime_validation: buildRuntimeValidation() },
      ),
    ).rejects.toThrow("persistence.mode must be one of");

    await expect(
      client.auto_register(
        { ...buildManifest(), persistence: "platform" },
        buildToolManual(),
        { runtime_validation: buildRuntimeValidation() },
      ),
    ).rejects.toThrow("persistence must be an object");

    await expect(
      client.auto_register(
        {
          ...buildManifest(),
          store_vertical: "game",
          persistence: { mode: PersistenceMode.PLATFORM, save_data_schema: "agent" },
        },
        buildToolManual(),
        { runtime_validation: buildRuntimeValidation() },
      ),
    ).rejects.toThrow("save_data_schema must be a JSON Schema object");

    await expect(
      client.auto_register(
        {
          ...buildManifest(),
          store_vertical: "game",
          persistence: { mode: PersistenceMode.PLATFORM, save_data_schema: null },
        },
        buildToolManual(),
        { runtime_validation: buildRuntimeValidation() },
      ),
    ).rejects.toThrow("save_data_schema must be a JSON Schema object");

    await expect(
      client.auto_register(
        {
          ...buildManifest(),
          store_vertical: "game",
          persistence: { mode: PersistenceMode.PLATFORM, save_data_schema: { type: "array", properties: {} } },
        },
        buildToolManual(),
        { runtime_validation: buildRuntimeValidation() },
      ),
    ).rejects.toThrow("save_data_schema.type must be 'object'");

    await expect(
      client.auto_register(
        {
          ...buildManifest(),
          store_vertical: "game",
          persistence: { mode: PersistenceMode.PLATFORM, save_data_schema: { type: "object", properties: {} } },
        },
        buildToolManual(),
        { runtime_validation: buildRuntimeValidation() },
      ),
    ).rejects.toThrow("save_data_schema.properties must be a non-empty object");

    await expect(
      client.auto_register(
        {
          ...buildManifest(),
          store_vertical: "game",
          persistence: {
            mode: PersistenceMode.PLATFORM,
            save_data_schema: { type: "object", properties: { agent: { type: "object" } }, required: "agent" },
          },
        },
        buildToolManual(),
        { runtime_validation: buildRuntimeValidation() },
      ),
    ).rejects.toThrow("save_data_schema.required must be an array of strings");

    await expect(
      client.auto_register(
        {
          ...buildManifest(),
          store_vertical: "game",
          persistence: {
            mode: PersistenceMode.PLATFORM,
            save_data_schema: {
              type: "object",
              properties: { agent: { type: "object", description: "x".repeat(8200) } },
              required: ["agent"],
            },
          },
        },
        buildToolManual(),
        { runtime_validation: buildRuntimeValidation() },
      ),
    ).rejects.toThrow("save_data_schema must be at most 8192 bytes");

    await expect(
      client.auto_register(
        {
          ...buildManifest(),
          store_vertical: "game",
          persistence: {
            mode: PersistenceMode.PLATFORM,
            save_data_schema: { type: "object", properties: { agent: { type: "object" } }, required: ["agent", 3] },
          },
        },
        buildToolManual(),
        { runtime_validation: buildRuntimeValidation() },
      ),
    ).rejects.toThrow("save_data_schema.required must be an array of strings");

    await expect(
      client.auto_register(
        {
          ...buildManifest(),
          store_vertical: "game",
          persistence: {
            mode: PersistenceMode.PLATFORM,
            save_data_schema: { type: "object", properties: { agent: { type: "object" } }, required: ["missing"] },
          },
        },
        buildToolManual(),
        { runtime_validation: buildRuntimeValidation() },
      ),
    ).rejects.toThrow("required references undefined properties");
  });

  it("accepts save_data_schema for game manifests with save persistence", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/capabilities/auto-register") {
          const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
          expect(body.persistence).toMatchObject({ mode: "platform", save_data_schema: SAVE_DATA_SCHEMA });
          return new Response(
            JSON.stringify(envelope({ listing_id: "lst_game", status: "draft", auto_manifest: {}, confidence: {} })),
            { status: 201 },
          );
        }
        return new Response("{}", { status: 500 });
      },
    });

    await client.auto_register(
      {
        ...buildManifest(),
        store_vertical: "game",
        persistence: { mode: PersistenceMode.PLATFORM, save_data_schema: SAVE_DATA_SCHEMA },
      },
      buildToolManual(),
      { runtime_validation: buildRuntimeValidation() },
    );
  });

  it("allows game manifests without save schema when persistence is none", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/capabilities/auto-register") {
          const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
          expect(body.persistence).toMatchObject({ mode: "none" });
          return new Response(
            JSON.stringify(envelope({ listing_id: "lst_game_none", status: "draft", auto_manifest: {}, confidence: {} })),
            { status: 201 },
          );
        }
        return new Response("{}", { status: 500 });
      },
    });

    await client.auto_register(
      {
        ...buildManifest(),
        store_vertical: "game",
        persistence: { mode: PersistenceMode.NONE },
      },
      buildToolManual(),
      { runtime_validation: buildRuntimeValidation() },
    );
  });

  it("allows non-game manifests to carry an optional save schema", async () => {
    const schemaWithoutRequired = {
      type: "object",
      properties: { state: { type: "object" } },
    };
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/capabilities/auto-register") {
          const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
          expect(body.persistence).toMatchObject({ mode: "platform", save_data_schema: schemaWithoutRequired });
          return new Response(
            JSON.stringify(envelope({ listing_id: "lst_api_state", status: "draft", auto_manifest: {}, confidence: {} })),
            { status: 201 },
          );
        }
        return new Response("{}", { status: 500 });
      },
    });

    await client.auto_register(
      {
        ...buildManifest(),
        persistence: { mode: PersistenceMode.PLATFORM, save_data_schema: schemaWithoutRequired },
      },
      buildToolManual(),
      { runtime_validation: buildRuntimeValidation() },
    );
  });

  it("forwards JPY as the listing currency for auto_register", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/capabilities/auto-register") {
          const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
          expect(body.currency).toBe("JPY");
          expect(body.price_value_minor).toBe(1200);
          return new Response(
            JSON.stringify(envelope({ listing_id: "lst_jpy", status: "draft", auto_manifest: {}, confidence: {} })),
            { status: 201 },
          );
        }
        return new Response("{}", { status: 500 });
      },
    });

    await client.auto_register(
      { ...buildManifest(), currency: "JPY" as const, price_value_minor: 1200 },
      buildToolManual(),
      { runtime_validation: buildRuntimeValidation() },
    );
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
            currency: "USD" as const,
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
    const supportCase = await client.create_support_case("subject", "body", { trace_id: "trc_123" });
    const supportCases = await client.list_support_cases();

    expect(retryCount).toBe(2);
    expect(listing.listing_id).toBe("retry_listing");
    expect(portal.apps).toHaveLength(1);
    expect(sandbox.session_id).toBe("sns_123");
    expect((await grants.all_items()).map((item) => item.access_grant_id)).toEqual(["grant_1"]);
    expect(binding.binding.binding_id).toBe("bind_1");
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
            display_currency: "JPY" as const,
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
            display_currency: "JPY" as const,
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

  it("keeps default API error details empty when omitted", () => {
    const error = new SiglumeAPIError("failed", { status_code: 500 });

    expect(error.details).toEqual({});
    expect(error.response_body).toBeUndefined();
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
            currency: "JPY" as const,
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
        currency: "JPY" as const,
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
        currency: "JPY" as const,
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
          currency: "JPY" as const,
          period_start: null,
          period_end: null,
          period_limit_minor: 9000,
        });
        return new Response(JSON.stringify(envelope({
          budget_id: "bdg_nullable",
          agent_id: "agt_owner_demo",
          currency: "JPY" as const,
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
      currency: "JPY" as const,
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
            currency: "USD" as const,
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
      currency: "USD" as const,
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
          currency: "JPY" as const,
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
          currency: "USD" as const,
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

  it("rejects blank owner operation keys before transport", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => {
        throw new Error("execute_owner_operation should fail before transport");
      },
    });

    await expect(client.execute_owner_operation("agt_owner_demo", " ")).rejects.toThrow("operation_key is required.");
  });

  it("rejects object-only API methods when the response body is an array", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response(JSON.stringify([]), { status: 200 }),
    });

    await expect(client.get_account_preferences()).rejects.toThrow(
      "Expected the Siglume API response body to be an object.",
    );
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
      settlement_currency: "USD" as const,
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
