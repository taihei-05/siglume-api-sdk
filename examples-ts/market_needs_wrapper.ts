/*
API: first-party market.needs.* typed wrappers over the owner-operation surface.
Intended user: owners or orchestration builders who triage demand before proposal work starts.
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

export class MarketNeedsWrapperApp extends AppAdapter {
  constructor(private readonly client = buildMockClient()) {
    super();
  }

  manifest() {
    return {
      capability_key: "market-needs-wrapper",
      name: "Market Needs Wrapper",
      job_to_be_done: "Load the owner's open market needs so a downstream workflow can triage demand before writing proposals.",
      category: AppCategory.OTHER,
      permission_class: PermissionClass.READ_ONLY,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
      jurisdiction: "US",
      short_description: "Reads typed market needs from the owner-operation surface without creating or updating any need.",
      example_prompts: ["Show the top open market needs before drafting a seller proposal."],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const focus = String(ctx.input_params?.focus ?? "translation coverage triage");
    const page = await this.client.list_market_needs({ agent_id: DEMO_AGENT_ID, status: "open", limit: 2 });
    const items = page.items;
    const first = items[0] ? await this.client.get_market_need(items[0].need_id, { agent_id: DEMO_AGENT_ID }) : null;
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary: `Loaded ${items.length} open market needs for ${focus}; first need: ${first?.title ?? "n/a"}.`,
        focus,
        need_ids: items.map((item) => item.need_id),
        titles: items.map((item) => item.title).filter((item): item is string => typeof item === "string" && item.length > 0),
        first_need: {
          need_id: first?.need_id ?? null,
          title: first?.title ?? null,
          category_key: first?.category_key ?? null,
          budget_max_minor: first?.budget_max_minor ?? null,
          status: first?.status ?? null,
        },
      },
    };
  }

  supported_task_types() {
    return ["review_market_needs"];
  }
}

export function buildToolManual(): ToolManual {
  return {
    tool_name: "market_needs_wrapper",
    job_to_be_done: "Read the owner's typed market-need backlog so a downstream workflow can prioritize unmet demand before writing proposals.",
    summary_for_model: "Lists open market needs and hydrates the first need detail through Siglume's first-party owner-operation surface without mutating any need.",
    trigger_conditions: [
      "agent should inspect open market demand before drafting a proposal, pitch, or seller recommendation",
      "workflow needs the owner's current backlog of needs, budgets, and categories without changing any stored state",
      "request is to triage or summarize needs only, not to create, edit, or close a market need",
    ],
    do_not_use_when: [
      "the owner is asking to create or update a market need instead of reading the current backlog",
      "workflow already has the exact need id and only needs a seller-side proposal mutation rather than a read-only backlog snapshot",
    ],
    permission_class: ToolManualPermissionClass.READ_ONLY,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "Short reason for loading the need backlog, echoed back in the summary.",
          default: "translation coverage triage",
        },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line summary of the market-need triage read." },
        focus: { type: "string", description: "Reason the backlog snapshot was loaded." },
        need_ids: { type: "array", items: { type: "string" } },
        titles: { type: "array", items: { type: "string" } },
        first_need: { type: "object", description: "Hydrated detail for the first open need." },
      },
      required: ["summary", "focus", "need_ids", "titles", "first_need"],
      additionalProperties: false,
    },
    usage_hints: ["Use this before seller matching or proposal drafting when the workflow should start from the owner's open demand backlog."],
    result_hints: ["Report the number of open needs, then name the first need title, category, and budget range explicitly."],
    error_hints: ["If the owner-operation surface is unavailable, explain that market needs could not be loaded and avoid fabricating demand details."],
    jurisdiction: "US",
  };
}

export function buildMockClient(): SiglumeClient {
  const needOne = {
    need_id: "need_demo_1",
    owner_user_id: "usr_owner_demo",
    principal_user_id: "usr_owner_demo",
    buyer_agent_id: DEMO_AGENT_ID,
    charter_id: "chr_owner_demo",
    charter_version: 3,
    title: "Localize release notes into Japanese",
    problem_statement: "We publish English release notes first and need a reviewable Japanese translation within 24 hours.",
    category_key: "translation",
    budget_min_minor: 8000,
    budget_max_minor: 15000,
    urgency: 7,
    requirement_jsonb: { languages: ["en", "ja"], sla_hours: 24 },
    status: "open",
    metadata: { source: "owner-dashboard" },
    detected_at: "2026-04-20T08:00:00Z",
    created_at: "2026-04-20T08:00:00Z",
    updated_at: "2026-04-20T08:10:00Z",
  };
  const needTwo = {
    need_id: "need_demo_2",
    owner_user_id: "usr_owner_demo",
    principal_user_id: "usr_owner_demo",
    buyer_agent_id: DEMO_AGENT_ID,
    charter_id: "chr_owner_demo",
    charter_version: 3,
    title: "Summarize partner invoices",
    problem_statement: "We need a monthly invoice summary with anomalies highlighted before the finance review.",
    category_key: "finance",
    budget_min_minor: 6000,
    budget_max_minor: 12000,
    urgency: 5,
    requirement_jsonb: { period: "monthly" },
    status: "open",
    metadata: { source: "owner-dashboard" },
    detected_at: "2026-04-19T21:00:00Z",
    created_at: "2026-04-19T21:00:00Z",
    updated_at: "2026-04-20T07:00:00Z",
  };

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
      if (payload.operation === "market.needs.list") {
        if (params.status !== "open" || params.limit !== 2) {
          throw new Error(`Unexpected market.needs.list params: ${JSON.stringify(params)}`);
        }
        return new Response(JSON.stringify({
          data: {
            agent_id: DEMO_AGENT_ID,
            message: "Market needs loaded.",
            action: "market_needs_list",
            result: { items: [needOne, needTwo], next_cursor: null },
          },
          meta: { trace_id: "trc_market_needs_list", request_id: "req_market_needs_list" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "market.needs.get") {
        if (params.need_id !== "need_demo_1") {
          throw new Error(`Unexpected market.needs.get params: ${JSON.stringify(params)}`);
        }
        return new Response(JSON.stringify({
          data: {
            agent_id: DEMO_AGENT_ID,
            message: "Market need loaded.",
            action: "market_needs_get",
            result: needOne,
          },
          meta: { trace_id: "trc_market_need_get", request_id: "req_market_need_get" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected operation payload: ${JSON.stringify(payload)}`);
    },
  });
}

export async function runMarketNeedsExample(): Promise<string[]> {
  const app = new MarketNeedsWrapperApp(buildMockClient());
  const harness = new AppTestHarness(app);
  const manual = buildToolManual();
  const [ok, issues] = validate_tool_manual(manual);
  const report = score_tool_manual_offline(manual);
  const dryRun = await harness.dry_run("review_market_needs", {
    input_params: { focus: "translation coverage triage" },
  });
  const titles = Array.isArray(dryRun.output?.titles) ? dryRun.output?.titles : [];
  return [
    `tool_manual_valid: ${ok} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    `needs_loaded: ${Array.isArray(dryRun.output?.need_ids) ? dryRun.output.need_ids.length : 0} first=need_demo_1`,
    `titles: ${titles.map((item) => String(item)).join("|")}`,
    `dry_run: ${dryRun.success}`,
    `summary: ${String(dryRun.output?.summary ?? "")}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("market_needs_wrapper.ts")) {
  for (const line of await runMarketNeedsExample()) {
    console.log(line);
  }
}
