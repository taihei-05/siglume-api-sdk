/*
API: first-party owner operation wrapper for agent behavior governance.
Intended user: owners or automation builders who want to tune an agent safely.
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

export class AgentBehaviorApp extends AppAdapter {
  manifest() {
    return {
      capability_key: "agent-behavior",
      name: "Agent Behavior Governance",
      job_to_be_done: "Prepare owner-reviewed charter, approval-policy, and budget updates for an agent.",
      category: AppCategory.OTHER,
      permission_class: PermissionClass.ACTION,
      approval_mode: ApprovalMode.ALWAYS_ASK,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.FREE,
      jurisdiction: "US",
      short_description: "Preview owner-governed behavior changes before creating an approval proposal.",
      example_prompts: ["Propose a stricter approval policy for my travel-buying agent."],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const agent_id = String(ctx.input_params?.agent_id ?? "agt_owner_demo");
    const charter_text = String(
      ctx.input_params?.charter_text
        ?? "Prioritize approval-safe bookings, explain trade-offs clearly, and stay within the delegated budget.",
    );
    const auto_approve_below_jpy = Math.trunc(Number(ctx.input_params?.auto_approve_below_jpy ?? 3000));
    const period_limit_minor = Math.trunc(Number(ctx.input_params?.period_limit_minor ?? 50000));
    const preview = {
      summary: `Would ask the owner to update charter / approval / budget for ${agent_id}.`,
      agent_id,
      charter_text,
      auto_approve_below_jpy,
      period_limit_minor,
    };

    if (ctx.execution_kind === "dry_run") {
      return {
        success: true,
        execution_kind: ctx.execution_kind,
        output: preview,
        needs_approval: true,
        approval_prompt: `Create an owner-review proposal for agent ${agent_id}.`,
        approval_hint: {
          action_summary: `Propose governance changes for ${agent_id}`,
          permission_class: "action",
          side_effects: ["Creates an owner-review proposal; does not update the live agent until approved."],
          preview,
          reversible: true,
        },
      };
    }

    const proposal_id = `proposal_${agent_id}`;
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary: `Created an owner-review proposal for ${agent_id}.`,
        proposal_id,
        agent_id,
        charter_text,
        auto_approve_below_jpy,
        period_limit_minor,
      },
      receipt_summary: {
        action: "owner_governance_proposal_created",
        proposal_id,
        agent_id,
      },
      artifacts: [
        {
          artifact_type: "owner_operation_proposal",
          external_id: proposal_id,
          title: `Governance proposal for ${agent_id}`,
          summary: "Owner-reviewed proposal covering charter, approval policy, and delegated budget.",
        },
      ],
      side_effects: [
        {
          action: "owner_governance_proposal_created",
          provider: "siglume-owner-operations",
          external_id: proposal_id,
          reversible: true,
          reversal_hint: "Discard the pending proposal before the owner approves it.",
          metadata: {
            agent_id,
            auto_approve_below_jpy,
            period_limit_minor,
          },
        },
      ],
    };
  }

  supported_task_types() {
    return ["propose_agent_behavior"];
  }
}

export function buildToolManual(): ToolManual {
  return {
    tool_name: "agent_behavior_governance",
    job_to_be_done: "Prepare an owner-reviewed proposal that updates an agent's charter, approval policy, and delegated budget.",
    summary_for_model: "Previews governance changes for an owned agent and creates a proposal only after the owner reviews the preview.",
    trigger_conditions: [
      "owner asks to tighten or loosen how their agent makes purchasing or action decisions",
      "agent needs a formal proposal to change charter text, approval thresholds, or delegated budget limits",
      "request is about governed behavior updates rather than immediately executing an external purchase or write",
    ],
    do_not_use_when: [
      "the owner wants to execute a marketplace action directly instead of changing agent governance",
      "the agent_id does not belong to the approving owner",
    ],
    permission_class: ToolManualPermissionClass.ACTION,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Owned agent identifier." },
        charter_text: { type: "string", description: "Short prose charter update to store in the proposal." },
        auto_approve_below_jpy: {
          type: "integer",
          description: "Auto-approval threshold in JPY minor units for the proposal preview.",
          default: 3000,
        },
        period_limit_minor: {
          type: "integer",
          description: "Delegated monthly budget limit in minor units.",
          default: 50000,
        },
      },
      required: ["agent_id", "charter_text"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line proposal outcome summary." },
        proposal_id: { type: "string", description: "Proposal identifier for owner review." },
        agent_id: { type: "string", description: "Owned agent targeted by the proposal." },
      },
      required: ["summary", "proposal_id", "agent_id"],
      additionalProperties: false,
    },
    usage_hints: ["Use dry_run first so the owner can review the charter text and policy thresholds before the proposal is created."],
    result_hints: ["Report the proposal_id and the targeted agent_id so the owner can review or discard the proposal later."],
    error_hints: ["If the owner has not chosen an agent yet, ask for the specific agent_id before retrying."],
    approval_summary_template: "Create an owner governance proposal for {agent_id}.",
    preview_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Preview of the governance proposal." },
        agent_id: { type: "string", description: "Owned agent identifier." },
        charter_text: { type: "string", description: "Charter prose preview." },
        auto_approve_below_jpy: { type: "integer", description: "Approval threshold preview." },
        period_limit_minor: { type: "integer", description: "Budget limit preview." },
      },
      required: ["summary", "agent_id", "charter_text", "auto_approve_below_jpy", "period_limit_minor"],
      additionalProperties: false,
    },
    idempotency_support: true,
    side_effect_summary: "Creates a reviewable governance proposal; live charter and policy updates still require owner approval.",
    jurisdiction: "US",
    legal_notes: "Only the approving owner may apply charter, approval-policy, or budget changes to the targeted agent.",
  };
}

export async function runAgentBehaviorExample(): Promise<string[]> {
  const harness = new AppTestHarness(new AgentBehaviorApp());
  const manual = buildToolManual();
  const [ok, issues] = validate_tool_manual(manual);
  const report = score_tool_manual_offline(manual);
  const dryRun = await harness.dry_run("propose_agent_behavior", {
    input_params: {
      agent_id: "agt_owner_demo",
      charter_text: "Prefer capped travel spend and explicit approval for non-routine purchases.",
    },
  });
  const action = await harness.execute_action("propose_agent_behavior", {
    input_params: {
      agent_id: "agt_owner_demo",
      charter_text: "Prefer capped travel spend and explicit approval for non-routine purchases.",
    },
  });
  return [
    `tool_manual_valid: ${String(ok)} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    `dry_run: ${String(dryRun.success)}`,
    `action: ${String(action.success)}`,
    `proposal_preview: ${String(dryRun.output?.summary ?? "")}`,
    `receipt_issues: ${harness.validate_receipt(action).length}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("agent_behavior_adapter.ts")) {
  const lines = await runAgentBehaviorExample();
  for (const line of lines) {
    console.log(line);
  }
}
