/*
API: first-party market.proposals.* typed wrappers over the owner-operation surface.
Intended user: owners or orchestration builders who negotiate buyer/seller proposals safely.
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
import type {
  ExecutionContext,
  ExecutionResult,
  ToolManual,
} from "../siglume-api-sdk-ts/src/index";

const DEMO_AGENT_ID = "agt_owner_demo";

export class MarketProposalsWrapperApp extends AppAdapter {
  client: SiglumeClient;

  constructor(client?: SiglumeClient) {
    super();
    this.client = client ?? buildMockClient();
  }

  manifest() {
    return {
      capability_key: "market-proposals-wrapper",
      name: "Market Proposals Wrapper",
      job_to_be_done: "Prepare owner-reviewed proposal negotiation steps through the first-party market proposal surface.",
      category: AppCategory.OTHER,
      store_vertical: "api" as const,
      permission_class: PermissionClass.ACTION,
      approval_mode: ApprovalMode.ALWAYS_ASK,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
    currency: "USD" as const,
    allow_free_trial: false,
      jurisdiction: "US",
      short_description: "Loads existing proposals, then prepares create / counter / accept approval intents without inventing an unpublished REST contract.",
      example_prompts: [
        "Prepare the next proposal step for the translation opportunity without sending anything live yet.",
        "Draft a proposal for this market need but keep it in staging.",
      ],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const targetOpportunity = String(ctx.input_params?.opportunity_id ?? "opp_demo_1");
    const targetProposalId = String(ctx.input_params?.proposal_id ?? "prop_demo_1");
    const page = await this.client.list_market_proposals({ agent_id: DEMO_AGENT_ID, status: "draft", limit: 2 });
    const proposals = page.items;
    const first = await this.client.get_market_proposal(targetProposalId, { agent_id: DEMO_AGENT_ID });
    const preview = {
      summary: `Would prepare proposal approval requests for ${targetOpportunity} after reviewing ${proposals.length} existing proposal(s).`,
      opportunity_id: targetOpportunity,
      proposal_id: first.proposal_id,
      proposal_count: proposals.length,
      first_status: first.status,
    };

    if (ctx.execution_kind === "dry_run") {
      return {
        success: true,
        execution_kind: ctx.execution_kind,
        output: preview,
        needs_approval: true,
        approval_prompt: `Create market proposal approval intents for ${targetOpportunity}.`,
        approval_hint: {
          action_summary: `Prepare proposal negotiation for ${targetOpportunity}`,
          permission_class: "action",
          side_effects: [
            "Creates approval intents for proposal create / counter / accept; nothing is published or accepted until the owner approves.",
          ],
          preview,
          reversible: true,
        },
      };
    }

    const created = await this.client.create_market_proposal({
      agent_id: DEMO_AGENT_ID,
      opportunity_id: targetOpportunity,
      proposal_kind: "proposal",
      currency: "USD" as const,
      amount_minor: 25000,
      proposed_terms_jsonb: { delivery_days: 7, scope: "translation+review" },
      publish_to_thread: true,
      thread_content_id: "thr_demo_1",
      note_title: "Initial proposal",
      note_summary: "Opening proposal for the opportunity.",
      note_body: "Prepared for owner approval before publishing.",
      note_visibility: "owner_only",
      note_content_kind: "proposal_note",
      expires_at: "2026-04-30T00:00:00Z",
    });
    const countered = await this.client.counter_market_proposal(targetProposalId, {
      agent_id: DEMO_AGENT_ID,
      proposal_kind: "counter",
      proposed_terms_jsonb: { delivery_days: 5, scope: "translation+qa" },
      publish_to_thread: true,
      thread_content_id: "thr_demo_1",
      note_title: "Counter proposal",
      note_summary: "Tighter turnaround for the same budget.",
      note_body: "Prepared for owner approval before publishing.",
      note_visibility: "owner_only",
      note_content_kind: "proposal_note",
      expires_at: "2026-04-28T00:00:00Z",
    });
    const accepted = await this.client.accept_market_proposal(targetProposalId, {
      agent_id: DEMO_AGENT_ID,
      comment: "Accept if the owner agrees with the delivery timeline.",
      publish_to_thread: true,
      thread_content_id: "thr_demo_1",
      note_title: "Accept proposal",
      note_summary: "Accept the current proposal after owner review.",
      note_visibility: "owner_only",
      note_content_kind: "proposal_note",
    });

    const approvalIntentIds = [created.intent_id, countered.intent_id, accepted.intent_id]
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary: `Prepared ${approvalIntentIds.length} proposal approval requests for ${targetOpportunity}.`,
        opportunity_id: targetOpportunity,
        proposal_id: first.proposal_id,
        approval_intent_ids: approvalIntentIds,
        approval_required: [
          created.approval_required,
          countered.approval_required,
          accepted.approval_required,
        ],
      },
      receipt_summary: {
        action: "market_proposal_approval_intents_created",
        opportunity_id: targetOpportunity,
        approval_intent_ids: approvalIntentIds,
      },
      artifacts: approvalIntentIds.map((intentId, index) => ({
        artifact_type: "owner_operation_proposal",
        external_id: intentId,
        title: `Proposal approval intent ${index + 1}`,
        summary: "Owner approval intent created through market.proposals.*.",
      })),
      side_effects: approvalIntentIds.map((intentId) => ({
        action: "market_proposal_approval_intent_created",
        provider: "siglume-owner-operations",
        external_id: intentId,
        reversible: true,
        reversal_hint: "Discard the pending approval intent before the owner approves it.",
        metadata: { opportunity_id: targetOpportunity, proposal_id: first.proposal_id },
      })),
    };
  }

  supported_task_types() {
    return ["stage_market_proposal_negotiation"];
  }
}

export function buildToolManual(): ToolManual {
  return {
    tool_name: "market_proposals_wrapper",
    job_to_be_done: "Prepare owner-reviewed proposal negotiation steps for a market opportunity without sending them live immediately.",
    summary_for_model: "Loads typed proposal records, previews the current negotiation state, and creates approval intents for create / counter / accept actions only after the owner reviews the plan.",
    trigger_conditions: [
      "owner asks to draft, counter, or accept a market proposal but wants an approval preview first",
      "workflow needs typed proposal context before sending any negotiation step into the shared thread",
      "agent should prepare proposal negotiation safely through Siglume's first-party owner-operation surface",
    ],
    do_not_use_when: [
      "workflow only needs to read proposals without staging any owner-reviewed action",
      "the proposal belongs to a different owner or the owner has not chosen the target opportunity yet",
    ],
    permission_class: ToolManualPermissionClass.ACTION,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        opportunity_id: { type: "string", description: "Opportunity to target when staging a new proposal." },
        proposal_id: { type: "string", description: "Existing proposal to inspect or counter.", default: "prop_demo_1" },
      },
      required: ["opportunity_id"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line summary of the staged approval intents." },
        opportunity_id: { type: "string" },
        proposal_id: { type: "string" },
        approval_intent_ids: { type: "array", items: { type: "string" } },
        approval_required: { type: "array", items: { type: "boolean" } },
      },
      required: ["summary", "opportunity_id", "proposal_id", "approval_intent_ids", "approval_required"],
      additionalProperties: false,
    },
    usage_hints: ["Use dry_run first so the owner can see the current proposal and the staged negotiation path before approval intents are created."],
    result_hints: ["Report the returned approval_intent_ids explicitly so the owner can review or discard them later."],
    error_hints: ["If proposal_id is missing or belongs to another owner, explain that the proposal could not be loaded and do not fabricate a negotiation step."],
    approval_summary_template: "Create proposal approval intents for {opportunity_id}.",
    preview_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        opportunity_id: { type: "string" },
        proposal_id: { type: "string" },
        proposal_count: { type: "integer" },
        first_status: { type: "string" },
      },
      required: ["summary", "opportunity_id", "proposal_id", "proposal_count", "first_status"],
      additionalProperties: false,
    },
    idempotency_support: true,
    side_effect_summary: "Creates owner approval intents for proposal negotiation; the proposal is not created, countered, or accepted until the owner approves.",
    jurisdiction: "US",
  };
}

function approvalEnvelope(
  operationKey: string,
  options: {
    intentId: string;
    preview: Record<string, unknown>;
    traceId: string;
    requestId: string;
  },
) {
  return new Response(JSON.stringify({
    data: {
      agent_id: DEMO_AGENT_ID,
      status: "approval_required",
      approval_required: true,
      intent_id: options.intentId,
      approval_status: "pending_owner",
      approval_snapshot_hash: `snap_${options.intentId}`,
      message: `${operationKey} requires owner approval.`,
      action: {
        type: "operation",
        operation: operationKey,
        status: "approval_required",
        summary: `${operationKey} staged for owner review.`,
      },
      result: {
        preview: options.preview,
        approval_snapshot_hash: `snap_${options.intentId}`,
      },
      safety: { approval_required: true, actor_scope: "owner" },
    },
    meta: { trace_id: options.traceId, request_id: options.requestId },
    error: null,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

export function buildMockClient(): SiglumeClient {
  const proposalOne = {
    proposal_id: "prop_demo_1",
    opportunity_id: "opp_demo_1",
    listing_id: "lst_translation_suite",
    need_id: "need_translation_ja",
    seller_agent_id: "agt_seller_translation",
    buyer_agent_id: DEMO_AGENT_ID,
    proposal_kind: "proposal",
    proposed_terms_jsonb: { delivery_days: 7, scope: "translation+review", amount_minor: 25000 },
    status: "draft",
    reason_codes: ["needs_owner_review"],
    approval_policy_snapshot_jsonb: { mode: "owner_review" },
    delegated_budget_snapshot_jsonb: { remaining_minor: 50000 },
    explanation: { summary: "Initial seller proposal pending owner review." },
    soft_budget_check: { within_budget: true },
    created_at: "2026-04-20T08:00:00Z",
    updated_at: "2026-04-20T08:05:00Z",
  };
  const proposalTwo = {
    proposal_id: "prop_demo_2",
    opportunity_id: "opp_demo_1",
    listing_id: "lst_translation_suite",
    need_id: "need_translation_ja",
    seller_agent_id: "agt_seller_translation",
    buyer_agent_id: DEMO_AGENT_ID,
    proposal_kind: "counter",
    proposed_terms_jsonb: { delivery_days: 5, scope: "translation+qa", amount_minor: 26000 },
    status: "pending_buyer",
    reason_codes: ["counter_received"],
    approval_policy_snapshot_jsonb: { mode: "owner_review" },
    delegated_budget_snapshot_jsonb: { remaining_minor: 50000 },
    explanation: { summary: "Counter proposal waiting for buyer review." },
    soft_budget_check: { within_budget: true },
    created_at: "2026-04-20T09:00:00Z",
    updated_at: "2026-04-20T09:10:00Z",
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
      const operation = payload.operation;
      const params = (payload.params && typeof payload.params === "object") ? payload.params as Record<string, unknown> : {};
      if (operation === "market.proposals.list") {
        if (params.status !== "draft" || params.limit !== 2) {
          throw new Error(`Unexpected list params: ${JSON.stringify(params)}`);
        }
        return new Response(JSON.stringify({
          data: {
            agent_id: DEMO_AGENT_ID,
            message: "Market proposals loaded.",
            action: "market_proposals_list",
            result: { items: [proposalOne, proposalTwo], next_cursor: null },
          },
          meta: { trace_id: "trc_market_proposals_list", request_id: "req_market_proposals_list" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (operation === "market.proposals.get") {
        if (params.proposal_id !== "prop_demo_1") {
          throw new Error(`Unexpected proposal id: ${JSON.stringify(params)}`);
        }
        return new Response(JSON.stringify({
          data: {
            agent_id: DEMO_AGENT_ID,
            message: "Market proposal loaded.",
            action: "market_proposals_get",
            result: proposalOne,
          },
          meta: { trace_id: "trc_market_proposals_get", request_id: "req_market_proposals_get" },
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (operation === "market.proposals.create") {
        return approvalEnvelope("market.proposals.create", {
          intentId: "intent_prop_create_1",
          preview: {
            opportunity_id: params.opportunity_id,
            proposal_kind: params.proposal_kind,
            amount_minor: params.amount_minor,
          },
          traceId: "trc_market_proposals_create",
          requestId: "req_market_proposals_create",
        });
      }
      if (operation === "market.proposals.counter") {
        return approvalEnvelope("market.proposals.counter", {
          intentId: "intent_prop_counter_1",
          preview: {
            proposal_id: params.proposal_id,
            proposal_kind: params.proposal_kind,
          },
          traceId: "trc_market_proposals_counter",
          requestId: "req_market_proposals_counter",
        });
      }
      if (operation === "market.proposals.accept") {
        return approvalEnvelope("market.proposals.accept", {
          intentId: "intent_prop_accept_1",
          preview: {
            proposal_id: params.proposal_id,
            comment: params.comment,
          },
          traceId: "trc_market_proposals_accept",
          requestId: "req_market_proposals_accept",
        });
      }
      throw new Error(`Unexpected operation payload: ${JSON.stringify(payload)}`);
    },
  });
}

export async function runMarketProposalsExample(): Promise<string[]> {
  const harness = new AppTestHarness(new MarketProposalsWrapperApp());
  const manual = buildToolManual();
  const [ok, issues] = validate_tool_manual(manual);
  const report = score_tool_manual_offline(manual);
  const dryRun = await harness.dry_run("stage_market_proposal_negotiation", {
    input_params: { opportunity_id: "opp_demo_1", proposal_id: "prop_demo_1" },
  });
  const action = await harness.execute_action("stage_market_proposal_negotiation", {
    input_params: { opportunity_id: "opp_demo_1", proposal_id: "prop_demo_1" },
  });
  const approvalIntentIds = Array.isArray(action.output?.approval_intent_ids)
    ? action.output.approval_intent_ids.map((item) => String(item))
    : [];
  return [
    `tool_manual_valid: ${String(ok)} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    `proposals_loaded: ${String(dryRun.output?.proposal_count ?? 0)} first=${String(dryRun.output?.proposal_id ?? "")}`,
    `dry_run: ${String(dryRun.success)}`,
    `action: ${String(action.success)}`,
    `approval_intents: ${approvalIntentIds.join("|")}`,
    `summary: ${String(action.output?.summary ?? "")}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("market_proposals_wrapper.ts")) {
  const lines = await runMarketProposalsExample();
  for (const line of lines) {
    console.log(line);
  }
}
