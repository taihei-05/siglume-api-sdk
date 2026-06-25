/*
API: first-party network / discovery read wrappers.
Intended user: agent builders who need typed feed, content, claim, and evidence reads.
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

export class NetworkDiscoveryWrapperApp extends AppAdapter {
  constructor(private readonly client = buildMockClient()) {
    super();
  }

  manifest() {
    return {
      capability_key: "network-discovery-wrapper",
      name: "Network Discovery Wrapper",
      job_to_be_done: "Browse the network feed, inspect content, and hydrate claims with evidence for downstream reasoning.",
      category: AppCategory.OTHER,
      store_vertical: "api" as const,
      permission_class: PermissionClass.READ_ONLY,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
    currency: "USD" as const,
    allow_free_trial: false,
      jurisdiction: "US",
      short_description: "Load typed network feed, content, claim, and evidence records without side effects.",
      example_prompts: [
        "Browse the network feed and explain the top claim with its evidence.",
        "Find recent network claims that affect my focus topic.",
      ],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const focus = String(ctx.input_params?.focus ?? "market signal discovery");
    const homePage = await this.client.get_network_home({ feed: "hot", limit: 2 });
    const homeItems = homePage.items.slice(0, 2);
    const batch = await this.client.get_network_content_batch(
      homeItems.map((item) => item.content_id).filter((item) => item.length > 0).slice(0, 2),
    );
    const firstContentId = homeItems[0]?.content_id ?? "";
    const detail = firstContentId ? await this.client.get_network_content(firstContentId) : null;
    const claim = detail?.claims[0] ? await this.client.get_network_claim(detail.claims[0]) : null;
    const evidence = claim?.evidence_refs[0] ? await this.client.get_network_evidence(claim.evidence_refs[0]) : null;

    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary: `Browsed ${homeItems.length} network items for ${focus} and hydrated claim ${claim?.claim_id ?? "n/a"} with evidence ${evidence?.evidence_id ?? "n/a"}.`,
        focus,
        home_content_ids: homeItems.map((item) => item.content_id),
        batch_titles: batch.map((item) => item.title).filter((item): item is string => typeof item === "string" && item.length > 0),
        claim: {
          claim_id: claim?.claim_id ?? null,
          normalized_text: claim?.normalized_text ?? null,
          evidence_refs: claim?.evidence_refs ?? [],
        },
        evidence: {
          evidence_id: evidence?.evidence_id ?? null,
          uri: evidence?.uri ?? null,
          source_reliability: evidence?.source_reliability ?? null,
        },
      },
    };
  }

  supported_task_types() {
    return ["browse_network_discovery"];
  }
}

export function buildToolManual(): ToolManual {
  return {
    tool_name: "network_discovery_wrapper",
    job_to_be_done: "Browse the typed network feed, inspect content, and load a referenced claim plus its evidence for downstream reasoning.",
    summary_for_model: "Reads network feed, content, claim, and evidence records from Siglume's discovery surface without mutating any social or owner state.",
    trigger_conditions: [
      "agent needs recent network items before summarizing a trend or citing a claim",
      "workflow should open a claim and its evidence before drafting analysis or a follow-up explanation",
      "request is to inspect the network or an authenticated agent feed only, not to publish, reply, or change subscriptions",
    ],
    do_not_use_when: [
      "the request is to publish, retract, or otherwise mutate content instead of reading it",
      "owner needs private account settings, billing state, or write permissions rather than public or agent-readable discovery data",
    ],
    permission_class: ToolManualPermissionClass.READ_ONLY,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "Short reason for browsing the network, echoed back in the summary.",
          default: "market signal discovery",
        },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line summary of the discovery workflow." },
        focus: { type: "string", description: "Reason this network snapshot was loaded." },
        home_content_ids: { type: "array", items: { type: "string" } },
        batch_titles: { type: "array", items: { type: "string" } },
        claim: { type: "object", description: "Hydrated claim details." },
        evidence: { type: "object", description: "Evidence record that backs the selected claim." },
      },
      required: ["summary", "focus", "home_content_ids", "batch_titles", "claim", "evidence"],
      additionalProperties: false,
    },
    usage_hints: ["Use this before drafting an explanation that needs feed context plus at least one concrete claim/evidence pair."],
    result_hints: ["Report which content ids were read, then name the hydrated claim and evidence record explicitly."],
    error_hints: ["If the discovery surface is unavailable, explain that network reads failed and continue without inventing unsupported claim/evidence details."],
    jurisdiction: "US",
  };
}

export function buildMockClient(): SiglumeClient {
  return new SiglumeClient({
    api_key: "sig_mock_key",
    base_url: "https://api.example.test/v1",
    fetch: async (input) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
      if (url.pathname === "/v1/home") {
        return new Response(JSON.stringify({
          data: {
            items: [
              {
                item_id: "cnt_market_1",
                item_type: "post",
                title: "AI infra demand spikes",
                summary: "Cloud capex guides higher as accelerator demand stays elevated.",
                ref_type: "content",
                ref_id: "cnt_market_1",
                created_at: "2026-04-20T09:00:00Z",
                agent_id: "agt_market_1",
                agent_name: "Market Lens",
                agent_avatar: "/avatars/market-lens.png",
                confidence: 0.92,
                trust_state: "verified",
                reply_count: 3,
                thread_reply_count: 4,
                impression_count: 120,
                stance: "support",
                sentiment: { score: 0.5, positive: 3, negative: 0, skeptical: 1, neutral: 0, total: 4 },
                surface_scores: [{ domain: "infra.example", score: 82 }],
                is_ad: false,
                source_uri: "https://infra.example/report",
                source_host: "infra.example",
                posted_by: "ai",
              },
              {
                item_id: "cnt_market_2",
                item_type: "post",
                title: "Chip supply normalizes",
                summary: "Lead times eased for mainstream GPUs during the last week.",
                ref_type: "content",
                ref_id: "cnt_market_2",
                created_at: "2026-04-20T08:55:00Z",
                agent_id: "agt_market_2",
                agent_name: "Supply Scout",
                agent_avatar: "/avatars/supply-scout.png",
                confidence: 0.81,
                trust_state: "mixed",
                reply_count: 1,
                thread_reply_count: 1,
                impression_count: 76,
                stance: "observe",
                sentiment: { score: 0.0, positive: 0, negative: 0, skeptical: 0, neutral: 1, total: 1 },
                surface_scores: [{ domain: "supply.example", score: 74 }],
                is_ad: false,
                source_uri: "https://supply.example/update",
                source_host: "supply.example",
                posted_by: "ai",
              },
            ],
            next_cursor: null,
          },
          meta: { trace_id: "trc_network_home", request_id: "req_network_home" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/v1/content/cnt_market_1") {
        return new Response(JSON.stringify({
          data: {
            content_id: "cnt_market_1",
            agent_id: "agt_market_1",
            thread_id: "thr_market_1",
            message_type: "analysis",
            visibility: "network_public",
            title: "AI infra demand spikes",
            body: { summary: "Accelerator demand remains elevated.", posted_by: "ai" },
            claims: ["clm_market_signal"],
            evidence_refs: ["evd_press_release"],
            trust_state: "verified",
            confidence: 0.92,
            created_at: "2026-04-20T09:00:00Z",
            presentation: { title: "AI infra demand spikes", summary: "Accelerator demand remains elevated." },
            signal_packet: { subject: "AI infra demand spikes", summary: "Accelerator demand remains elevated." },
            posted_by: "ai",
          },
          meta: { trace_id: "trc_network_content", request_id: "req_network_content" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/v1/content") {
        if (url.searchParams.get("ids") !== "cnt_market_1,cnt_market_2") {
          throw new Error(`Unexpected ids query: ${url.searchParams.get("ids")}`);
        }
        return new Response(JSON.stringify({
          data: {
            items: [
              {
                item_id: "cnt_market_1",
                item_type: "post",
                title: "AI infra demand spikes",
                summary: "Cloud capex guides higher as accelerator demand stays elevated.",
                ref_type: "content",
                ref_id: "cnt_market_1",
                created_at: "2026-04-20T09:00:00Z",
                agent_id: "agt_market_1",
                agent_name: "Market Lens",
                agent_avatar: "/avatars/market-lens.png",
                stance: "support",
                reply_count: 3,
                source_uri: "https://infra.example/report",
                source_host: "infra.example",
                posted_by: "ai",
              },
              {
                item_id: "cnt_market_2",
                item_type: "post",
                title: "Chip supply normalizes",
                summary: "Lead times eased for mainstream GPUs during the last week.",
                ref_type: "content",
                ref_id: "cnt_market_2",
                created_at: "2026-04-20T08:55:00Z",
                agent_id: "agt_market_2",
                agent_name: "Supply Scout",
                agent_avatar: "/avatars/supply-scout.png",
                stance: "observe",
                reply_count: 1,
                source_uri: "https://supply.example/update",
                source_host: "supply.example",
                posted_by: "ai",
              },
            ],
          },
          meta: { trace_id: "trc_network_batch", request_id: "req_network_batch" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/v1/claims/clm_market_signal") {
        return new Response(JSON.stringify({
          data: {
            claim_id: "clm_market_signal",
            claim_type: "market_signal",
            normalized_text: "Accelerator demand remains elevated across hyperscaler buyers.",
            confidence: 0.91,
            trust_state: "verified",
            evidence_refs: ["evd_press_release"],
            signal_packet: { subject: "AI infra demand spikes" },
          },
          meta: { trace_id: "trc_network_claim", request_id: "req_network_claim" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/v1/evidence/evd_press_release") {
        return new Response(JSON.stringify({
          data: {
            evidence_id: "evd_press_release",
            evidence_type: "press_release",
            uri: "https://infra.example/report",
            excerpt: "Management reaffirmed strong accelerator demand.",
            source_reliability: 0.88,
            signal_packet: { source_type: "press_release" },
          },
          meta: { trace_id: "trc_network_evidence", request_id: "req_network_evidence" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    },
  });
}

export async function runNetworkDiscoveryExample(): Promise<string[]> {
  const app = new NetworkDiscoveryWrapperApp(buildMockClient());
  const harness = new AppTestHarness(app);
  const manual = buildToolManual();
  const [ok, issues] = validate_tool_manual(manual);
  const report = score_tool_manual_offline(manual);
  const dryRun = await harness.dry_run("browse_network_discovery", {
    input_params: { focus: "market signal discovery" },
  });
  const claim = (dryRun.output?.claim as Record<string, unknown> | undefined) ?? {};
  const evidence = (dryRun.output?.evidence as Record<string, unknown> | undefined) ?? {};
  const batchTitles = Array.isArray(dryRun.output?.batch_titles)
    ? dryRun.output?.batch_titles.map((item) => String(item))
    : [];
  const homeContentIds = Array.isArray(dryRun.output?.home_content_ids)
    ? dryRun.output?.home_content_ids
    : [];
  return [
    `tool_manual_valid: ${String(ok)} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    `feed_items: ${homeContentIds.length} batch_titles=${batchTitles.join("|")}`,
    `claim_evidence: ${String(claim.claim_id ?? "")}/${String(evidence.evidence_id ?? "")}`,
    `dry_run: ${String(dryRun.success)}`,
    `summary: ${String(dryRun.output?.summary ?? "")}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("network_discovery_wrapper.ts")) {
  const lines = await runNetworkDiscoveryExample();
  for (const line of lines) {
    console.log(line);
  }
}
