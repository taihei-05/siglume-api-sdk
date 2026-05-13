/*
API: first-party partner.* typed wrappers over the owner-operation surface.
Intended user: operators who review partner usage, existing ingest keys, and
optionally prepare a new source credential handle for onboarding.
Connected account: none.
*/
import {
  AppAdapter,
  AppCategory,
  AppTestHarness,
  ApprovalMode,
  ExecutionKind,
  PermissionClass,
  PriceModel,
  SiglumeClient,
  ToolManualPermissionClass,
  score_tool_manual_offline,
  validate_tool_manual,
} from "../siglume-api-sdk-ts/src/index";
import type { ExecutionContext, ExecutionResult, ToolManual } from "../siglume-api-sdk-ts/src/index";

const DEMO_AGENT_ID = "agt_owner_demo";

export class PartnerDashboardWrapperApp extends AppAdapter {
  constructor(private readonly client = buildMockClient()) {
    super();
  }

  manifest() {
    return {
      capability_key: "partner-dashboard-wrapper",
      name: "Partner Dashboard Wrapper",
      job_to_be_done: "Review Partner dashboard state and optionally prepare a handle-only API key reference for source onboarding.",
      category: AppCategory.FINANCE,
      store_vertical: "api" as const,
      permission_class: PermissionClass.ACTION,
      approval_mode: ApprovalMode.ALWAYS_ASK,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
    currency: "USD" as const,
    allow_free_trial: false,
      jurisdiction: "US",
      short_description: "Loads partner dashboard usage plus existing keys, then creates only the credential handle via the owner-operation bus.",
      example_prompts: [
        "Prepare a partner source onboarding snapshot and issue a new ingest-key handle.",
        "Rotate the ingest-key for the partner onboarding dashboard.",
      ],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const focus = String(ctx.input_params?.focus ?? "source onboarding");
    const sourceName = String(ctx.input_params?.source_name ?? "SDK Feed").trim() || "SDK Feed";
    const dashboard = await this.client.get_partner_dashboard({ agent_id: DEMO_AGENT_ID });
    const usage = await this.client.get_partner_usage({ agent_id: DEMO_AGENT_ID });
    const keys = await this.client.list_partner_api_keys({ agent_id: DEMO_AGENT_ID });
    const preview = {
      focus,
      plan: dashboard.plan ?? null,
      month_usage_pct: usage.month_usage_pct,
      existing_key_ids: keys.map((item) => item.key_id).filter((item): item is string => typeof item === "string" && item.length > 0),
      requested_source_name: sourceName,
      allowed_source_types: ["rss", "partner_api"],
      legacy_http_note: "Use POST /v1/partner/keys to reveal the raw ingest_key once; the owner-operation bus returns only the handle.",
    };
    if (ctx.execution_kind === ExecutionKind.DRY_RUN) {
      return {
        success: true,
        execution_kind: ctx.execution_kind,
        output: preview,
        needs_approval: true,
        approval_prompt: `Create a handle-only partner source credential for ${sourceName}.`,
        approval_hint: {
          action_summary: `Create a handle-only partner source credential for ${sourceName}`,
          permission_class: "action",
          side_effects: ["Creates a new Partner API key handle; the raw ingest_key is not returned on the owner-operation bus."],
          preview,
          reversible: true,
        },
      };
    }
    const createdHandle = await this.client.create_partner_api_key({
      agent_id: DEMO_AGENT_ID,
      name: sourceName,
      allowed_source_types: ["rss", "partner_api"],
    });
    const summary = `Loaded Partner dashboard for ${focus}; plan ${dashboard.plan ?? "unknown"} at ${usage.month_usage_pct.toFixed(1)}% monthly usage across ${keys.length} existing keys. Created handle ${createdHandle.key_id}; raw ingest_key is available only via POST /v1/partner/keys.`;
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary,
        focus,
        plan: dashboard.plan ?? null,
        month_usage_pct: usage.month_usage_pct,
        existing_key_ids: keys.map((item) => item.key_id).filter((item): item is string => typeof item === "string" && item.length > 0),
        created_key_handle: {
          credential_id: createdHandle?.credential_id ?? null,
          key_id: createdHandle?.key_id ?? null,
          masked_key_hint: createdHandle?.masked_key_hint ?? null,
        },
        legacy_http_note: "Use POST /v1/partner/keys to reveal the raw ingest_key once; the owner-operation bus returns only the handle.",
      },
      receipt_summary: {
        action: "partner_key_handle_created",
        credential_id: createdHandle.credential_id,
        key_id: createdHandle.key_id,
      },
      artifacts: [{
        artifact_type: "partner_api_key_handle",
        external_id: createdHandle.credential_id,
        title: `Partner API key handle for ${sourceName}`,
        summary: "Handle-only Partner API key reference returned by the owner-operation bus.",
        metadata: {
          key_id: createdHandle.key_id,
          masked_key_hint: createdHandle.masked_key_hint,
        },
      }],
      side_effects: [{
        action: "partner_key_handle_created",
        provider: "siglume-owner-operations",
        external_id: createdHandle.credential_id,
        reversible: true,
        reversal_hint: "Revoke the created Partner API key from the partner dashboard if it is no longer needed.",
        metadata: {
          key_id: createdHandle.key_id,
          masked_key_hint: createdHandle.masked_key_hint,
        },
      }],
    };
  }

  supported_task_types() {
    return ["prepare_partner_source_onboarding"];
  }
}

export function buildToolManual(): ToolManual {
  return {
    tool_name: "partner_dashboard_wrapper",
    job_to_be_done: "Inspect Partner dashboard usage and existing API keys, then optionally create a handle-only partner source credential for onboarding.",
    summary_for_model: "Loads partner dashboard state and returns the created key handle without exposing the raw ingest_key on the owner-operation bus.",
    trigger_conditions: [
      "operator wants a partner dashboard snapshot before onboarding a new source feed",
      "workflow needs current partner usage plus existing key inventory before deciding whether to create another key",
      "the task is to prepare a handle-only partner credential reference instead of revealing the one-time raw secret",
    ],
    do_not_use_when: [
      "the human specifically needs the one-time raw ingest_key value instead of the handle-only owner-operation result",
      "the task is only to inspect ads billing or campaigns rather than partner source onboarding",
    ],
    permission_class: ToolManualPermissionClass.ACTION,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "Short reason for loading the partner dashboard snapshot.",
          default: "source onboarding",
        },
        source_name: {
          type: "string",
          description: "Display name for the new partner source key handle when the action path runs.",
          default: "SDK Feed",
        },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line dashboard and onboarding summary." },
        focus: { type: "string" },
        plan: { type: "string" },
        month_usage_pct: { type: "number" },
        existing_key_ids: { type: "array", items: { type: "string" } },
        created_key_handle: { type: "object", description: "Handle-only result for the created partner key." },
        legacy_http_note: { type: "string", description: "Reminder that the raw ingest_key is only available from the legacy HTTP route." },
      },
      required: ["summary", "focus", "plan", "month_usage_pct", "existing_key_ids", "created_key_handle", "legacy_http_note"],
      additionalProperties: false,
    },
    preview_schema: {
      type: "object",
      properties: {
        focus: { type: "string" },
        plan: { type: "string" },
        month_usage_pct: { type: "number" },
        existing_key_ids: { type: "array", items: { type: "string" } },
        requested_source_name: { type: "string" },
        allowed_source_types: { type: "array", items: { type: "string" } },
        legacy_http_note: { type: "string" },
      },
      required: ["focus", "plan", "month_usage_pct", "existing_key_ids", "requested_source_name", "allowed_source_types", "legacy_http_note"],
      additionalProperties: false,
    },
    usage_hints: ["Use this when a partner operator needs billing/usage context plus a new handle-only source credential reference."],
    result_hints: ["If a key was created, report the masked hint and explicitly state that the raw ingest_key is not included here."],
    error_hints: ["If the human needs the raw key, direct them to the legacy POST /v1/partner/keys route instead of fabricating a secret."],
    approval_summary_template: "Create a handle-only partner source credential for {source_name}.",
    idempotency_support: true,
    side_effect_summary: "Creates a handle-only Partner API key reference and never returns the raw ingest_key on the owner-operation bus.",
    jurisdiction: "US",
  };
}

export function buildMockClient(): SiglumeClient {
  const dashboard = {
    partner_id: "usr_partner_demo",
    company_name: "Demo Feeds",
    plan: "starter",
    plan_label: "Starter",
    month_bytes_used: 1048576,
    month_bytes_limit: 10485760,
    month_usage_pct: 10.0,
    total_source_items: 3,
    has_billing: true,
    has_subscription: true,
  };
  const usage = {
    plan: "starter",
    month_bytes_used: 1048576,
    month_bytes_limit: 10485760,
    month_bytes_remaining: 9437184,
    month_usage_pct: 10.0,
  };
  const keys = [
    {
      credential_id: "cred_partner_1",
      name: "Primary Feed",
      key_id: "src_partner_1",
      allowed_source_types: ["partner_api", "rss"],
      last_used_at: "2026-04-20T08:40:00Z",
      created_at: "2026-04-19T23:10:00Z",
      revoked: false,
    },
    {
      credential_id: "cred_partner_2",
      name: "Archive Feed",
      key_id: "src_partner_2",
      allowed_source_types: ["partner_api"],
      last_used_at: null,
      created_at: "2026-04-18T11:00:00Z",
      revoked: false,
    },
  ];

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
      if (payload.operation === "partner.dashboard.get") {
        return new Response(JSON.stringify({
          data: { agent_id: DEMO_AGENT_ID, message: "Partner dashboard loaded.", action: "partner_dashboard_get", result: dashboard },
          meta: { trace_id: "trc_partner_dashboard", request_id: "req_partner_dashboard" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "partner.usage.get") {
        return new Response(JSON.stringify({
          data: { agent_id: DEMO_AGENT_ID, message: "Partner usage loaded.", action: "partner_usage_get", result: usage },
          meta: { trace_id: "trc_partner_usage", request_id: "req_partner_usage" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "partner.keys.list") {
        return new Response(JSON.stringify({
          data: { agent_id: DEMO_AGENT_ID, message: "Partner API keys loaded.", action: "partner_keys_list", result: { keys } },
          meta: { trace_id: "trc_partner_keys_list", request_id: "req_partner_keys_list" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "partner.keys.create") {
        if (JSON.stringify(params) !== JSON.stringify({ name: "SDK Feed", allowed_source_types: ["rss", "partner_api"] })) {
          throw new Error(`Unexpected partner.keys.create params: ${JSON.stringify(params)}`);
        }
        return new Response(JSON.stringify({
          data: {
            agent_id: DEMO_AGENT_ID,
            message: "Partner API key created.",
            action: "partner_keys_create",
            result: {
              credential_id: "cred_partner_3",
              name: "SDK Feed",
              key_id: "src_partner_3",
              allowed_source_types: ["rss", "partner_api"],
              masked_key_hint: "src_partner_3.********",
            },
          },
          meta: { trace_id: "trc_partner_keys_create", request_id: "req_partner_keys_create" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected operation payload: ${JSON.stringify(payload)}`);
    },
  });
}

export async function runPartnerDashboardExample(): Promise<string[]> {
  const app = new PartnerDashboardWrapperApp(buildMockClient());
  const harness = new AppTestHarness(app);
  const manual = buildToolManual();
  const [ok, issues] = validate_tool_manual(manual);
  const report = score_tool_manual_offline(manual);
  const dryRun = await harness.dry_run("prepare_partner_source_onboarding", {
    input_params: { focus: "source onboarding", source_name: "SDK Feed" },
  });
  const action = await harness.execute_action("prepare_partner_source_onboarding", {
    input_params: { focus: "source onboarding", source_name: "SDK Feed" },
  });
  const createdHandle = typeof action.output?.created_key_handle === "object" && action.output?.created_key_handle !== null
    ? action.output.created_key_handle as Record<string, unknown>
    : {};
  return [
    `tool_manual_valid: ${ok} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    `dashboard: plan=${String(dryRun.output?.plan ?? "")} usage=${Number(dryRun.output?.month_usage_pct ?? 0).toFixed(1)} keys=${Array.isArray(dryRun.output?.existing_key_ids) ? dryRun.output.existing_key_ids.length : 0}`,
    `created_key: ${String(createdHandle.credential_id ?? "")} hint=${String(createdHandle.masked_key_hint ?? "")}`,
    `dry_run: ${dryRun.success}`,
    `action: ${action.success}`,
    `summary: ${String(action.output?.summary ?? "")}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("partner_dashboard_wrapper.ts")) {
  for (const line of await runPartnerDashboardExample()) {
    console.log(line);
  }
}
