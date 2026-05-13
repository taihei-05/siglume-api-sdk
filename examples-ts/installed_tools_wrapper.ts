/*
API: first-party installed_tools.* typed wrappers over the owner-operation surface.
Intended user: owners or orchestration builders who need a safe snapshot of installed-tool posture.
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

export class InstalledToolsWrapperApp extends AppAdapter {
  constructor(private readonly client = buildMockClient()) {
    super();
  }

  manifest() {
    return {
      capability_key: "installed-tools-wrapper",
      name: "Installed Tools Wrapper",
      job_to_be_done: "Load installed tool posture, readiness, and recent receipt detail so an owner can triage operational health without mutating policies.",
      category: AppCategory.OTHER,
      store_vertical: "api" as const,
      permission_class: PermissionClass.READ_ONLY,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
    currency: "USD" as const,
      jurisdiction: "US",
      short_description: "Reads installed tools, readiness, executions, and receipts from the owner-operation surface without changing any binding policy.",
      example_prompts: [
        "Show which installed tools are ready before I troubleshoot a recent execution.",
        "List my agent's installed tools and their connection status.",
      ],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const focus = String(ctx.input_params?.focus ?? "installed tool readiness triage");
    const tools = await this.client.list_installed_tools({ agent_id: DEMO_AGENT_ID });
    const readiness = await this.client.get_installed_tools_connection_readiness({ agent_id: DEMO_AGENT_ID });
    const receipts = await this.client.list_installed_tool_receipts({
      agent_id: DEMO_AGENT_ID,
      status: "completed",
      limit: 1,
    });
    const firstReceipt = receipts[0]
      ? await this.client.get_installed_tool_receipt(receipts[0].receipt_id, { agent_id: DEMO_AGENT_ID })
      : null;
    const steps = firstReceipt
      ? await this.client.get_installed_tool_receipt_steps(firstReceipt.receipt_id, { agent_id: DEMO_AGENT_ID })
      : [];
    const execution = firstReceipt
      ? await this.client.get_installed_tool_execution(firstReceipt.intent_id, { agent_id: DEMO_AGENT_ID })
      : null;
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary: `Loaded ${tools.length} installed tools for ${focus}; first receipt: ${firstReceipt?.receipt_id ?? "n/a"} (${execution?.status ?? "n/a"}).`,
        focus,
        binding_ids: tools.map((item) => item.binding_id),
        readiness: readiness.bindings,
        first_receipt: {
          receipt_id: firstReceipt?.receipt_id ?? null,
          status: firstReceipt?.status ?? null,
          step_count: firstReceipt?.step_count ?? null,
          execution_status: execution?.status ?? null,
          step_ids: steps.map((item) => item.step_id),
        },
      },
    };
  }

  supported_task_types() {
    return ["review_installed_tools"];
  }
}

export function buildToolManual(): ToolManual {
  return {
    tool_name: "installed_tools_wrapper",
    job_to_be_done: "Read installed tool posture, connected-account readiness, and recent receipt detail without changing any execution policy.",
    summary_for_model: "Lists installed tools, loads readiness, and hydrates a recent receipt plus its execution/step detail through Siglume's first-party owner-operation surface without mutating bindings.",
    trigger_conditions: [
      "owner wants to inspect installed tool readiness before debugging a failed execution or missing connected account",
      "workflow needs a read-only snapshot of installed tools and recent receipts before deciding whether to request a policy change",
      "request is to review installed tool health or recent activity only, not to pause, resume, or update a binding policy",
    ],
    do_not_use_when: [
      "the owner is explicitly asking to update an installed tool binding policy or any other guarded installed_tools write path",
      "workflow already has the exact receipt or intent payload and does not need a broader installed-tool posture snapshot",
    ],
    permission_class: ToolManualPermissionClass.READ_ONLY,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "Short reason for loading the installed-tool snapshot, echoed back in the summary.",
          default: "installed tool readiness triage",
        },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line summary of the installed-tool inspection." },
        focus: { type: "string", description: "Reason the installed-tool snapshot was loaded." },
        binding_ids: { type: "array", items: { type: "string" } },
        readiness: { type: "object", description: "Binding readiness map keyed by binding id." },
        first_receipt: { type: "object", description: "Hydrated receipt, execution, and step summary for the first matching receipt." },
      },
      required: ["summary", "focus", "binding_ids", "readiness", "first_receipt"],
      additionalProperties: false,
    },
    usage_hints: ["Use this before policy changes or support escalation when the workflow first needs a read-only installed-tool health snapshot."],
    result_hints: ["Report how many installed tools were found, whether all bindings are ready, and the first receipt/execution status explicitly."],
    error_hints: ["If the owner-operation surface is unavailable, explain that installed tool posture could not be loaded and avoid inventing readiness or receipt details."],
    jurisdiction: "US",
  };
}

export function buildMockClient(): SiglumeClient {
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
    agent_id: DEMO_AGENT_ID,
    owner_user_id: "usr_owner_demo",
    binding_id: "bind_inst_1",
    release_id: "rel_inst_1",
    source: "owner_ui",
    goal: "Run seller search",
    input_payload_jsonb: { binding_id: "bind_inst_1", query: "translation seller" },
    plan_jsonb: { steps: [{ tool_name: "seller_api_search" }] },
    status: "queued",
    approval_snapshot_jsonb: {},
    metadata_jsonb: { source: "sdk-test" },
    queued_at: "2026-04-20T08:31:00Z",
    created_at: "2026-04-20T08:31:00Z",
    updated_at: "2026-04-20T08:31:00Z",
  };
  const receipt = {
    id: "rcp_inst_1",
    intent_id: "int_inst_1",
    agent_id: DEMO_AGENT_ID,
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
      if (payload.operation === "installed_tools.list") {
        return new Response(JSON.stringify({
          data: {
            agent_id: DEMO_AGENT_ID,
            status: "completed",
            message: "Installed tools loaded.",
            result: [toolOne, toolTwo],
          },
          meta: { trace_id: "trc_installed_tools_list", request_id: "req_installed_tools_list" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "installed_tools.connection_readiness") {
        return new Response(JSON.stringify({
          data: {
            agent_id: DEMO_AGENT_ID,
            status: "completed",
            message: "Installed tool readiness loaded.",
            result: {
              agent_id: DEMO_AGENT_ID,
              all_ready: false,
              bindings: {
                bind_inst_1: "ready",
                bind_inst_2: "missing_connected_account",
              },
            },
          },
          meta: { trace_id: "trc_installed_tools_ready", request_id: "req_installed_tools_ready" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "installed_tools.receipts.list") {
        if (params.status !== "completed" || params.limit !== 1) {
          throw new Error(`Unexpected installed_tools.receipts.list params: ${JSON.stringify(params)}`);
        }
        return new Response(JSON.stringify({
          data: {
            agent_id: DEMO_AGENT_ID,
            status: "completed",
            message: "Installed tool receipts loaded.",
            result: [receipt],
          },
          meta: { trace_id: "trc_installed_tools_receipts", request_id: "req_installed_tools_receipts" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "installed_tools.receipts.get") {
        if (params.receipt_id !== "rcp_inst_1") {
          throw new Error(`Unexpected installed_tools.receipts.get params: ${JSON.stringify(params)}`);
        }
        return new Response(JSON.stringify({
          data: {
            agent_id: DEMO_AGENT_ID,
            status: "completed",
            message: "Installed tool receipt loaded.",
            result: receipt,
          },
          meta: { trace_id: "trc_installed_tools_receipt", request_id: "req_installed_tools_receipt" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "installed_tools.receipts.steps.get") {
        if (params.receipt_id !== "rcp_inst_1") {
          throw new Error(`Unexpected installed_tools.receipts.steps.get params: ${JSON.stringify(params)}`);
        }
        return new Response(JSON.stringify({
          data: {
            agent_id: DEMO_AGENT_ID,
            status: "completed",
            message: "Installed tool receipt steps loaded.",
            result: [step],
          },
          meta: { trace_id: "trc_installed_tools_steps", request_id: "req_installed_tools_steps" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "installed_tools.execution.get") {
        if (params.intent_id !== "int_inst_1") {
          throw new Error(`Unexpected installed_tools.execution.get params: ${JSON.stringify(params)}`);
        }
        return new Response(JSON.stringify({
          data: {
            agent_id: DEMO_AGENT_ID,
            status: "completed",
            message: "Installed tool execution loaded.",
            result: execution,
          },
          meta: { trace_id: "trc_installed_tools_execution", request_id: "req_installed_tools_execution" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected operation payload: ${JSON.stringify(payload)}`);
    },
  });
}

export async function runInstalledToolsExample(): Promise<string[]> {
  const app = new InstalledToolsWrapperApp(buildMockClient());
  const harness = new AppTestHarness(app);
  const manual = buildToolManual();
  const [ok, issues] = validate_tool_manual(manual);
  const report = score_tool_manual_offline(manual);
  const dryRun = await harness.dry_run("review_installed_tools", {
    input_params: { focus: "installed tool readiness triage" },
  });
  const output = typeof dryRun.output === "object" && dryRun.output !== null ? dryRun.output as Record<string, unknown> : {};
  const readiness = typeof output.readiness === "object" && output.readiness !== null ? output.readiness as Record<string, unknown> : {};
  const firstReceipt = typeof output.first_receipt === "object" && output.first_receipt !== null
    ? output.first_receipt as Record<string, unknown>
    : {};
  const bindingIds = Array.isArray(output.binding_ids) ? output.binding_ids : [];
  const stepIds = Array.isArray(firstReceipt.step_ids) ? firstReceipt.step_ids : [];
  return [
    `tool_manual_valid: ${ok} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    `installed_tools: ${bindingIds.length} ready=${Object.values(readiness).every((value) => value === "ready")}`,
    `receipt_steps: ${stepIds.length} execution=${String(firstReceipt.execution_status ?? "")}`,
    `dry_run: ${dryRun.success}`,
    `summary: ${String(output.summary ?? "")}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("installed_tools_wrapper.ts")) {
  for (const line of await runInstalledToolsExample()) {
    console.log(line);
  }
}
