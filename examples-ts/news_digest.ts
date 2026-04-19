/*
API: read-only topic digest over public news feeds.
Intended user: researchers, assistants, or monitoring agents.
Connected account: none.
*/
import {
  AppAdapter,
  AppCategory,
  AppTestHarness,
  ApprovalMode,
  PermissionClass,
  PriceModel,
  ToolManualPermissionClass,
  score_tool_manual_offline,
  validate_tool_manual,
} from "../siglume-api-sdk-ts/src/index";
import type { ExecutionContext, ExecutionResult, ToolManual } from "../siglume-api-sdk-ts/src/index";

export class NewsDigestApp extends AppAdapter {
  manifest() {
    return {
      capability_key: "news-digest",
      name: "News Digest",
      job_to_be_done: "Summarize recent public news articles for a topic without any external side effects.",
      category: AppCategory.MONITORING,
      permission_class: PermissionClass.READ_ONLY,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
      jurisdiction: "US",
      short_description: "Collect and summarize public news articles for a requested topic.",
      example_prompts: ["Give me a 3-day digest of news about AI agents."],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const topic = String(ctx.input_params?.topic ?? "AI agents");
    const lookback_days = Number(ctx.input_params?.lookback_days ?? 3);
    const articles = [
      {
        title: `${topic}: enterprise adoption accelerates`,
        source: "Example Wire",
        published_at: "2026-04-18",
        url: "https://news.example.test/enterprise-adoption",
      },
      {
        title: `${topic}: new tooling reduces agent evaluation time`,
        source: "Signal Post",
        published_at: "2026-04-17",
        url: "https://news.example.test/eval-speedup",
      },
      {
        title: `${topic}: builders focus on safer approval flows`,
        source: "Daily Runtime",
        published_at: "2026-04-16",
        url: "https://news.example.test/approval-flows",
      },
    ];
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary: `Found ${articles.length} notable ${topic} stories from the last ${lookback_days} days.`,
        articles,
        topic,
      },
    };
  }

  supported_task_types() {
    return ["news_digest", "monitor_topic"];
  }
}

export function buildToolManual(): ToolManual {
  return {
    tool_name: "news_digest",
    job_to_be_done: "Collect recent public news coverage for a topic and return a concise digest with article links.",
    summary_for_model: "Searches recent public news coverage for a topic and returns a structured digest with article metadata and a concise summary.",
    trigger_conditions: [
      "owner asks for a recent digest of public news on a specific topic",
      "agent needs fresh article coverage before summarizing market or product movement",
      "request is to monitor or brief recent headlines without contacting any private account",
    ],
    do_not_use_when: [
      "the request is to publish, email, or otherwise write back to an external system",
      "the owner needs private or paywalled sources that are not part of the configured public feed",
    ],
    permission_class: ToolManualPermissionClass.READ_ONLY,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to monitor in public news coverage." },
        lookback_days: {
          type: "integer",
          description: "How many days of recent news to scan.",
          default: 3,
        },
      },
      required: ["topic"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line digest summary." },
        articles: {
          type: "array",
          description: "Recent articles returned for the requested topic.",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              source: { type: "string" },
              published_at: { type: "string" },
              url: { type: "string" },
            },
            required: ["title", "source", "published_at", "url"],
            additionalProperties: false,
          },
        },
        topic: { type: "string", description: "Topic that was queried." },
      },
      required: ["summary", "articles", "topic"],
      additionalProperties: false,
    },
    usage_hints: ["Use this tool when the owner wants a recent public-news briefing before making a decision."],
    result_hints: ["Lead with the digest summary, then cite the most relevant article titles and sources."],
    error_hints: ["If the topic is too broad, ask for a narrower company, product, or sector focus."],
  };
}

export async function runNewsDigestExample(): Promise<string[]> {
  const harness = new AppTestHarness(new NewsDigestApp());
  const [ok, issues] = validate_tool_manual(buildToolManual());
  const report = score_tool_manual_offline(buildToolManual());
  const dryRun = await harness.dry_run("news_digest", { input_params: { topic: "AI agents", lookback_days: 3 } });
  return [
    `tool_manual_valid: ${String(ok)} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    `manifest_issues: ${(await harness.validate_manifest()).length}`,
    `dry_run: ${String(dryRun.success)}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("news_digest.ts")) {
  const lines = await runNewsDigestExample();
  for (const line of lines) {
    console.log(line);
  }
}
