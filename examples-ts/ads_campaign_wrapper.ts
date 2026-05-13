/*
API: first-party ads.* typed wrappers over the owner-operation surface.
Intended user: operators who review billing readiness and current campaign
performance without mutating ads state.
Connected account: none.
*/
import {
  AppAdapter,
  AppCategory,
  AppTestHarness,
  ApprovalMode,
  PermissionClass,
  PriceModel,
  SiglumeClient,
  ToolManualPermissionClass,
  score_tool_manual_offline,
  validate_tool_manual,
} from "../siglume-api-sdk-ts/src/index";
import type { ExecutionContext, ExecutionResult, ToolManual } from "../siglume-api-sdk-ts/src/index";

const DEMO_AGENT_ID = "agt_owner_demo";

export class AdsCampaignWrapperApp extends AppAdapter {
  constructor(private readonly client = buildMockClient()) {
    super();
  }

  manifest() {
    return {
      capability_key: "ads-campaign-wrapper",
      name: "Ads Campaign Wrapper",
      job_to_be_done: "Load ads billing and campaign context so an operator can review pacing and billing readiness without mutating campaigns.",
      category: AppCategory.MONITORING,
      store_vertical: "api" as const,
      permission_class: PermissionClass.READ_ONLY,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
      currency: "USD" as const,
      jurisdiction: "US",
      short_description: "Reads ads billing, profile, campaigns, and recent posts from the owner-operation surface.",
      example_prompts: [
        "Show the current ads billing mode and recent campaign activity.",
        "Summarize how my campaigns have been pacing this week.",
      ],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const focus = String(ctx.input_params?.focus ?? "campaign pacing review");
    const billing = await this.client.get_ads_billing({ agent_id: DEMO_AGENT_ID, rail: "web3" });
    const profile = await this.client.get_ads_profile({ agent_id: DEMO_AGENT_ID });
    const campaigns = await this.client.list_ads_campaigns({ agent_id: DEMO_AGENT_ID });
    const firstCampaign = campaigns[0];
    const posts = firstCampaign
      ? await this.client.list_ads_campaign_posts(firstCampaign.campaign_id, { agent_id: DEMO_AGENT_ID })
      : [];
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary: `Loaded ${campaigns.length} ads campaigns for ${focus}; billing mode ${billing.billing_mode ?? "unknown"} with ${posts.length} recent posts for the first campaign.`,
        focus,
        billing_mode: billing.billing_mode ?? null,
        billing_currency: billing.currency ?? null,
        has_profile: profile.has_profile,
        campaign_ids: campaigns.map((item) => item.campaign_id),
        first_campaign_posts: posts.map((item) => item.post_id).filter((item): item is string => typeof item === "string" && item.length > 0),
      },
    };
  }

  supported_task_types() {
    return ["review_ads_campaign_health"];
  }
}

export function buildToolManual(): ToolManual {
  return {
    tool_name: "ads_campaign_wrapper",
    job_to_be_done: "Read ads billing status, profile readiness, current campaigns, and recent posts for campaign-health review.",
    summary_for_model: "Loads ads billing/profile/campaign reads through first-party owner-operation wrappers without mutating billing or campaign state.",
    trigger_conditions: [
      "operator wants the current ads billing mode before reviewing campaign pacing",
      "workflow needs campaign inventory and recent post ids without editing any campaign settings",
      "task is to inspect ads profile readiness and spend context only",
    ],
    do_not_use_when: [
      "the task is to activate ads billing, edit campaigns, or create a post instead of reading the current state",
      "the request is specifically about partner usage or partner ingest keys rather than ads campaign review",
    ],
    permission_class: ToolManualPermissionClass.READ_ONLY,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "Short reason for loading the ads campaign snapshot.",
          default: "campaign pacing review",
        },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line ads review summary." },
        focus: { type: "string" },
        billing_mode: { type: "string" },
        billing_currency: { type: "string" },
        has_profile: { type: "boolean" },
        campaign_ids: { type: "array", items: { type: "string" } },
        first_campaign_posts: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "focus", "billing_mode", "billing_currency", "has_profile", "campaign_ids", "first_campaign_posts"],
      additionalProperties: false,
    },
    usage_hints: ["Use this when an operator needs a read-only ads health snapshot before deciding whether to adjust billing or campaign settings."],
    result_hints: ["Report the billing mode, profile readiness, campaign count, and whether the first campaign has recent posts."],
    error_hints: ["If no campaigns exist yet, say so explicitly instead of inventing pacing metrics."],
    jurisdiction: "US",
  };
}

export function buildMockClient(): SiglumeClient {
  const billing = {
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
    wallet: { user_wallet_id: "uw_ads_1", smart_account_address: "0xabc" },
  };
  const profile = {
    has_profile: true,
    company_name: "Demo Ads",
    ad_currency: "usd",
    has_billing: true,
  };
  const campaigns = [
    {
      campaign_id: "cmp_ads_1",
      name: "Spring Launch",
      target_url: "https://example.com/spring-launch",
      content_brief: "Promote the launch announcement.",
      target_topics: ["ai", "launch"],
      posting_interval_minutes: 720,
      max_posts_per_day: 2,
      currency: "USD" as const,
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
    },
    {
      campaign_id: "cmp_ads_2",
      name: "April Promotion",
      target_url: "https://example.com/april-promo",
      content_brief: "Promote the April offer.",
      target_topics: ["promotion"],
      posting_interval_minutes: 1440,
      max_posts_per_day: 1,
      currency: "USD" as const,
      monthly_budget_jpy: 30000,
      cpm_jpy: 250,
      cpr_jpy: 30,
      monthly_budget_usd: 20000,
      cpm_usd: 250,
      cpr_usd: 30,
      status: "paused",
      month_spend_jpy: 0,
      month_spend_usd: 0,
      total_posts: 1,
      total_impressions: 1200,
      total_replies: 2,
      next_post_at: null,
      created_at: "2026-04-18T09:00:00Z",
    },
  ];
  const posts = [{
    post_id: "pst_ads_1",
    content_id: "cnt_ads_1",
    cost_jpy: 0,
    cost_usd: 1200,
    impressions: 5000,
    replies: 11,
    status: "served",
    created_at: "2026-04-20T07:00:00Z",
  }];

  return new SiglumeClient({
    api_key: "sig_mock_key",
    base_url: "https://api.example.test/v1",
    fetch: async (input, init) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
      if (url.pathname !== `/v1/owner/agents/${DEMO_AGENT_ID}/operations/execute`) {
        throw new Error(`Unexpected request: ${String(init?.method ?? "GET")} ${url.toString()}`);
      }
      const payload = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      const params = typeof payload.params === "object" && payload.params !== null ? payload.params as Record<string, unknown> : {};
      if (payload.operation === "ads.billing.get") {
        if (JSON.stringify(params) !== JSON.stringify({ rail: "web3" })) {
          throw new Error(`Unexpected ads.billing.get params: ${JSON.stringify(params)}`);
        }
        return new Response(JSON.stringify({
          data: { agent_id: DEMO_AGENT_ID, message: "Ads billing loaded.", action: "ads_billing_get", result: billing },
          meta: { trace_id: "trc_ads_billing", request_id: "req_ads_billing" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "ads.profile.get") {
        return new Response(JSON.stringify({
          data: { agent_id: DEMO_AGENT_ID, message: "Ads profile loaded.", action: "ads_profile_get", result: profile },
          meta: { trace_id: "trc_ads_profile", request_id: "req_ads_profile" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "ads.campaigns.list") {
        return new Response(JSON.stringify({
          data: { agent_id: DEMO_AGENT_ID, message: "Ad campaigns loaded.", action: "ads_campaigns_list", result: { campaigns } },
          meta: { trace_id: "trc_ads_campaigns", request_id: "req_ads_campaigns" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "ads.campaign_posts.list") {
        if (JSON.stringify(params) !== JSON.stringify({ campaign_id: "cmp_ads_1" })) {
          throw new Error(`Unexpected ads.campaign_posts.list params: ${JSON.stringify(params)}`);
        }
        return new Response(JSON.stringify({
          data: { agent_id: DEMO_AGENT_ID, message: "Ad campaign posts loaded.", action: "ads_campaign_posts_list", result: { posts } },
          meta: { trace_id: "trc_ads_posts", request_id: "req_ads_posts" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected operation payload: ${JSON.stringify(payload)}`);
    },
  });
}

export async function runAdsCampaignExample(): Promise<string[]> {
  const app = new AdsCampaignWrapperApp(buildMockClient());
  const harness = new AppTestHarness(app);
  const manual = buildToolManual();
  const [ok, issues] = validate_tool_manual(manual);
  const report = score_tool_manual_offline(manual);
  const dryRun = await harness.dry_run("review_ads_campaign_health", {
    input_params: { focus: "campaign pacing review" },
  });
  return [
    `tool_manual_valid: ${ok} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    `campaigns_loaded: ${Array.isArray(dryRun.output?.campaign_ids) ? dryRun.output.campaign_ids.length : 0} first=cmp_ads_1`,
    `billing_profile: ${String(dryRun.output?.billing_mode ?? "")}/${String(dryRun.output?.billing_currency ?? "")} profile=${String(dryRun.output?.has_profile ?? false)}`,
    `dry_run: ${dryRun.success}`,
    `summary: ${String(dryRun.output?.summary ?? "")}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("ads_campaign_wrapper.ts")) {
  for (const line of await runAdsCampaignExample()) {
    console.log(line);
  }
}
