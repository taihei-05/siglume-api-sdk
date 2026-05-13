/*
API: first-party account watchlist / digests / alerts wrappers.
Intended user: owners or automation builders assembling dashboard context.
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

export class AccountDigestsAlertsWrapperApp extends AppAdapter {
  constructor(private readonly client = buildMockClient()) {
    super();
  }

  manifest() {
    return {
      capability_key: "account-digests-alerts-wrapper",
      name: "Account Digests Alerts Wrapper",
      job_to_be_done: "Load the owner's watchlist, recent digests, and live alerts for a dashboard widget.",
      category: AppCategory.OTHER,
      store_vertical: "api" as const,
      permission_class: PermissionClass.READ_ONLY,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
      jurisdiction: "US",
      short_description: "Build a typed owner dashboard snapshot from watchlist, digest, and alert context.",
      example_prompts: [
        "Show me the latest watchlist, digest, and alert snapshot for my dashboard.",
        "What's new in my watchlist today?",
      ],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const watchlist = await this.client.get_account_watchlist();
    const digests = await this.client.list_account_digests();
    const alerts = await this.client.list_account_alerts();
    const focus = String(ctx.input_params?.focus ?? "owner dashboard");
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary: `Dashboard widget loaded ${watchlist.symbols.length} watchlist symbols, ${digests.items.length} digests, and ${alerts.items.length} alerts for ${focus}.`,
        focus,
        watchlist_symbols: watchlist.symbols.slice(0, 5),
        digest_titles: digests.items.slice(0, 2).map((item) => item.title ?? item.digest_id),
        alert_titles: alerts.items.slice(0, 2).map((item) => item.title ?? item.alert_id),
      },
    };
  }

  supported_task_types() {
    return ["render_owner_dashboard_widget"];
  }
}

export function buildToolManual(): ToolManual {
  return {
    tool_name: "account_digests_alerts_wrapper",
    job_to_be_done: "Load the owner's saved watchlist together with recent digests and alerts so a dashboard or prompt can summarize what needs attention.",
    summary_for_model: "Reads first-party account watchlist, digest, and alert data to produce a typed owner-dashboard snapshot without mutating account state.",
    trigger_conditions: [
      "workflow needs the owner's current watchlist symbols plus recent digest and alert summaries before deciding what to show on a dashboard",
      "agent must summarize what changed recently across the owner's tracked symbols without opening billing or social-post actions",
      "request is to inspect the latest account dashboard context only, not to favorite an agent, submit feedback, or post content",
    ],
    do_not_use_when: [
      "the owner wants to change the watchlist, dismiss alerts, or create content instead of reading a dashboard snapshot",
      "request needs a single digest or alert in full detail rather than a short dashboard-style summary",
    ],
    permission_class: ToolManualPermissionClass.READ_ONLY,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "Short label describing why the dashboard widget is being loaded.",
          default: "owner dashboard",
        },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Short dashboard summary sentence." },
        focus: { type: "string", description: "The dashboard context label that was requested." },
        watchlist_symbols: {
          type: "array",
          items: { type: "string" },
          description: "Tracked watchlist symbols to highlight in the widget.",
        },
        digest_titles: {
          type: "array",
          items: { type: "string" },
          description: "Most recent digest titles to show in the widget.",
        },
        alert_titles: {
          type: "array",
          items: { type: "string" },
          description: "Most recent alert titles to show in the widget.",
        },
      },
      required: ["summary", "focus", "watchlist_symbols", "digest_titles", "alert_titles"],
      additionalProperties: false,
    },
    usage_hints: ["Use this when you need a compact owner dashboard snapshot before proposing any deeper action."],
    result_hints: ["Lead with the watchlist size, then surface the most recent digest and alert titles."],
    error_hints: ["If dashboard data is unavailable, explain which account surface failed and continue without inventing alerts."],
    jurisdiction: "US",
  };
}

export function buildMockClient(): SiglumeClient {
  return new SiglumeClient({
    api_key: "sig_mock_key",
    base_url: "https://api.example.test/v1",
    fetch: async (input) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
      if (url.pathname === "/v1/me/watchlist") {
        return new Response(JSON.stringify({
          data: { symbols: ["BTC", "ETH", "NVDA"] },
          meta: { trace_id: "trc_watchlist", request_id: "req_watchlist" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/v1/digests") {
        return new Response(JSON.stringify({
          data: {
            items: [
              {
                digest_id: "dig_001",
                title: "Morning market digest",
                digest_type: "daily",
                summary: "BTC and NVDA outperformed overnight.",
                generated_at: "2026-04-20T07:00:00Z",
              },
              {
                digest_id: "dig_002",
                title: "AI tools digest",
                digest_type: "daily",
                summary: "New agent-tool releases landed in the catalog.",
                generated_at: "2026-04-19T19:00:00Z",
              },
            ],
            next_cursor: null,
          },
          meta: { trace_id: "trc_digests", request_id: "req_digests" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/v1/alerts") {
        return new Response(JSON.stringify({
          data: {
            items: [
              {
                alert_id: "alt_001",
                title: "BTC volatility spike",
                summary: "BTC moved more than 4% in the last hour.",
                severity: "medium",
                confidence: 0.91,
                trust_state: "verified",
                ref_type: "symbol",
                ref_id: "BTC",
                created_at: "2026-04-20T08:00:00Z",
              },
              {
                alert_id: "alt_002",
                title: "NVDA earnings call scheduled",
                summary: "The next earnings call was added to the watchlist calendar.",
                severity: "low",
                confidence: 0.88,
                trust_state: "verified",
                ref_type: "equity",
                ref_id: "NVDA",
                created_at: "2026-04-20T06:30:00Z",
              },
            ],
            next_cursor: null,
          },
          meta: { trace_id: "trc_alerts", request_id: "req_alerts" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    },
  });
}

export async function runAccountDigestsAlertsExample(): Promise<string[]> {
  const app = new AccountDigestsAlertsWrapperApp(buildMockClient());
  const harness = new AppTestHarness(app);
  const manual = buildToolManual();
  const [ok, issues] = validate_tool_manual(manual);
  const report = score_tool_manual_offline(manual);
  const dryRun = await harness.dry_run("render_owner_dashboard_widget", {
    input_params: { focus: "morning dashboard" },
  });
  return [
    `tool_manual_valid: ${String(ok)} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    "watchlist: BTC,ETH,NVDA",
    "digests_alerts: 2/2",
    `dry_run: ${String(dryRun.success)}`,
    `summary: ${String(dryRun.output?.summary ?? "")}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("account_digests_alerts_wrapper.ts")) {
  const lines = await runAccountDigestsAlertsExample();
  for (const line of lines) {
    console.log(line);
  }
}
