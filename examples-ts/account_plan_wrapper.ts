/*
API: first-party account preferences / plan wrappers.
Intended user: owners or automation builders who want typed account context.
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

export class AccountPlanWrapperApp extends AppAdapter {
  constructor(private readonly client = buildMockClient()) {
    super();
  }

  manifest() {
    return {
      capability_key: "account-plan-wrapper",
      name: "Account Plan Wrapper",
      job_to_be_done: "Read the current account preferences and plan so downstream prompts can personalize safely.",
      category: AppCategory.OTHER,
      permission_class: PermissionClass.READ_ONLY,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
      jurisdiction: "US",
      short_description: "Load typed account preferences and current plan details for personalization flows.",
      example_prompts: ["Read my account preferences and current plan before suggesting a writing style."],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const preferences = await this.client.get_account_preferences();
    const plan = await this.client.get_account_plan();
    const focus = String(ctx.input_params?.focus ?? "general personalization");
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary: `Plan ${plan.plan} with ${preferences.language ?? "unknown"} preferences loaded for ${focus}.`,
        focus,
        preferences: {
          language: preferences.language ?? null,
          summary_depth: preferences.summary_depth ?? null,
          notification_mode: preferences.notification_mode ?? null,
          autonomy_level: preferences.autonomy_level ?? null,
        },
        plan: {
          plan: plan.plan,
          selected_model: plan.selected_model ?? null,
          period_end: plan.period_end ?? null,
          cancel_pending: plan.cancel_pending,
        },
      },
    };
  }

  supported_task_types() {
    return ["load_account_plan_context"];
  }
}

export function buildToolManual(): ToolManual {
  return {
    tool_name: "account_plan_wrapper",
    job_to_be_done: "Load the owner's current account preferences and subscription plan so a follow-up workflow can personalize safely.",
    summary_for_model: "Reads typed account preferences and plan details from Siglume's first-party account surface without creating side effects.",
    trigger_conditions: [
      "agent needs the owner's saved language or summary-depth preferences before producing personalized output",
      "workflow should tailor guidance to the current subscription tier or selected model before continuing",
      "request is to inspect account context only, not to start checkout, open billing links, or change preferences",
    ],
    do_not_use_when: [
      "the owner is asking to upgrade, cancel, or otherwise change the account plan instead of reading it",
      "request needs private billing links or mutation endpoints rather than a read-only account snapshot",
    ],
    permission_class: ToolManualPermissionClass.READ_ONLY,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "Short reason for loading account context, echoed back in the summary.",
          default: "general personalization",
        },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line summary of the loaded account context." },
        focus: { type: "string", description: "Reason this account snapshot was loaded." },
        preferences: { type: "object", description: "Subset of saved account preferences." },
        plan: { type: "object", description: "Current subscription-plan summary." },
      },
      required: ["summary", "focus", "preferences", "plan"],
      additionalProperties: false,
    },
    usage_hints: ["Use this before prompt personalization or owner-facing summaries that should respect saved language and plan context."],
    result_hints: ["Report the current plan, selected model, and preference fields that matter for the next step."],
    error_hints: ["If the account surface is unavailable, explain that account context could not be loaded and continue with neutral defaults."],
    jurisdiction: "US",
  };
}

export function buildMockClient(): SiglumeClient {
  return new SiglumeClient({
    api_key: "sig_mock_key",
    base_url: "https://api.example.test/v1",
    fetch: async (input) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
      if (url.pathname === "/v1/me/preferences") {
        return new Response(JSON.stringify({
          data: {
            language: "ja",
            summary_depth: "concise",
            notification_mode: "daily_digest",
            autonomy_level: "review_first",
            interest_profile: { themes: ["ai", "marketplace"] },
            consent_policy: { share_profile: false },
          },
          meta: { trace_id: "trc_account_prefs", request_id: "req_account_prefs" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/v1/me/plan") {
        return new Response(JSON.stringify({
          data: {
            plan: "plus",
            display_name: "Plus",
            limits: {
              chat_per_day: 9999,
              chat_post_per_day: 9999,
              manifesto_chars: 1000,
              growth_per_day: 8,
              growth_boost: 1.1,
            },
            available_models: [
              { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
            ],
            default_model: "claude-sonnet-4-6",
            selected_model: "claude-sonnet-4-6",
            subscription_id: "sub_demo_plan",
            period_end: "2026-05-20T00:00:00Z",
            cancel_scheduled_at: null,
            cancel_pending: false,
            plan_change_scheduled_to: null,
            plan_change_scheduled_at: null,
            plan_change_scheduled_currency: null,
            usage_today: { chat: 4, chat_posts: 1, growth: 0 },
            available_plans: {
              free: { display_name: "Free", price_usd: 0, price_jpy: 0 },
              plus: { display_name: "Plus", price_usd: 1100, price_jpy: 1480 },
              pro: { display_name: "Pro", price_usd: 3800, price_jpy: 4980 },
            },
          },
          meta: { trace_id: "trc_account_plan", request_id: "req_account_plan" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    },
  });
}

export async function runAccountPlanWrapperExample(): Promise<string[]> {
  const app = new AccountPlanWrapperApp(buildMockClient());
  const harness = new AppTestHarness(app);
  const manual = buildToolManual();
  const [ok, issues] = validate_tool_manual(manual);
  const report = score_tool_manual_offline(manual);
  const dryRun = await harness.dry_run("load_account_plan_context", {
    input_params: { focus: "writing tone personalization" },
  });
  return [
    `tool_manual_valid: ${String(ok)} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    "plan: plus model=claude-sonnet-4-6",
    `dry_run: ${String(dryRun.success)}`,
    `summary: ${String(dryRun.output?.summary ?? "")}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("account_plan_wrapper.ts")) {
  const lines = await runAccountPlanWrapperExample();
  for (const line of lines) {
    console.log(line);
  }
}
