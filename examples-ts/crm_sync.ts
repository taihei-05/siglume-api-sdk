/*
API: CRM lead upsert for revenue and sales operations workflows.
Intended user: operators or agent builders who need to create or refresh leads.
Connected account: hubspot.
*/
import {
  AppAdapter,
  AppCategory,
  AppTestHarness,
  ApprovalMode,
  PermissionClass,
  PriceModel,
  StubProvider,
  ToolManualPermissionClass,
  score_tool_manual_offline,
  validate_tool_manual,
} from "../siglume-api-sdk-ts/src/index";
import type { ExecutionContext, ExecutionResult, ToolManual } from "../siglume-api-sdk-ts/src/index";

export class CrmSyncApp extends AppAdapter {
  manifest() {
    return {
      capability_key: "crm-sync",
      name: "CRM Sync",
      job_to_be_done: "Create or update CRM lead records after the owner approves the write.",
      category: AppCategory.CRM,
      permission_class: PermissionClass.ACTION,
      approval_mode: ApprovalMode.ALWAYS_ASK,
      dry_run_supported: true,
      required_connected_accounts: ["hubspot"],
      price_model: PriceModel.FREE,
      jurisdiction: "US",
      short_description: "Preview and upsert HubSpot lead records with explicit approval.",
      example_prompts: ["Sync this inbound contact into HubSpot as a lead."],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const external_id = String(ctx.input_params?.external_id ?? "lead-ext-1001");
    const full_name = String(ctx.input_params?.full_name ?? "Avery Stone");
    const email = String(ctx.input_params?.email ?? "avery.stone@example.com");
    const company = String(ctx.input_params?.company ?? "Northwind Labs");
    const notes = String(ctx.input_params?.notes ?? "Qualified inbound lead from pricing page.");
    const lead_id = `hubspot_${external_id.replaceAll("-", "_")}`;
    const preview = {
      summary: `Would sync lead ${full_name} (${email}) to HubSpot.`,
      external_id,
      full_name,
      email,
      company,
    };
    if (ctx.execution_kind === "dry_run") {
      return {
        success: true,
        execution_kind: ctx.execution_kind,
        output: preview,
        needs_approval: true,
        approval_prompt: `Sync CRM lead ${external_id} for ${email} into HubSpot.`,
      };
    }
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary: `Synced HubSpot lead ${full_name}.`,
        lead_id,
        external_id,
        provider: "hubspot",
        notes,
      },
      receipt_summary: {
        action: "crm_lead_upserted",
        lead_id,
        external_id,
        provider: "hubspot",
      },
      artifacts: [
        {
          artifact_type: "crm_lead",
          external_id: lead_id,
          title: full_name,
          summary: `CRM lead record for ${email}`,
        },
      ],
      side_effects: [
        {
          action: "crm_lead_upserted",
          provider: "hubspot",
          external_id: lead_id,
          reversible: true,
          reversal_hint: "Archive the lead record in HubSpot if it was created in error.",
          metadata: { external_id, company },
        },
      ],
    };
  }

  supported_task_types() {
    return ["sync_crm_lead", "create_crm_lead"];
  }
}

export function buildStubs() {
  return { hubspot: new StubProvider("hubspot") };
}

export function buildToolManual(): ToolManual {
  return {
    tool_name: "crm_sync",
    job_to_be_done: "Create or update a CRM lead record in HubSpot after the owner reviews the lead preview.",
    summary_for_model: "Previews a HubSpot lead upsert and then writes the lead only after explicit owner approval.",
    trigger_conditions: [
      "owner asks to create or update a CRM lead after collecting contact information",
      "agent needs to push a qualified inbound lead into HubSpot with an external_id for dedupe",
      "request is to sync contact details into CRM rather than only summarize the lead",
    ],
    do_not_use_when: [
      "the owner only wants a draft message or notes without writing any CRM record",
      "the contact has not consented to being stored in the CRM system",
    ],
    permission_class: ToolManualPermissionClass.ACTION,
    dry_run_supported: true,
    requires_connected_accounts: ["hubspot"],
    input_schema: {
      type: "object",
      properties: {
        external_id: { type: "string", description: "Stable dedupe key for the lead." },
        full_name: { type: "string", description: "Lead full name." },
        email: { type: "string", description: "Lead email address." },
        company: { type: "string", description: "Company name.", default: "" },
        notes: { type: "string", description: "Qualification notes.", default: "" },
      },
      required: ["external_id", "full_name", "email"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line outcome summary." },
        lead_id: { type: "string", description: "HubSpot lead identifier." },
        external_id: { type: "string", description: "Caller-provided dedupe key." },
        provider: { type: "string", description: "CRM provider that received the write." },
      },
      required: ["summary", "lead_id", "external_id", "provider"],
      additionalProperties: false,
    },
    usage_hints: ["Use dry_run first so the owner can verify the contact details before the CRM write happens."],
    result_hints: ["Show both the HubSpot lead_id and external_id so follow-up automations can reuse the same record."],
    error_hints: ["If contact details are incomplete, ask for the missing email or full_name before retrying."],
    approval_summary_template: "Sync CRM lead {external_id} for {email}.",
    preview_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Preview of the CRM write." },
        external_id: { type: "string", description: "Lead dedupe key." },
        full_name: { type: "string", description: "Lead full name." },
        email: { type: "string", description: "Lead email address." },
      },
      required: ["summary", "external_id", "full_name", "email"],
      additionalProperties: false,
    },
    idempotency_support: true,
    side_effect_summary: "Creates or updates a lead record in HubSpot using the provided external_id as the dedupe key.",
    jurisdiction: "US",
    legal_notes: "Only sync personal data that the approving owner is authorized to store in HubSpot.",
  };
}

export async function runCrmSyncExample(): Promise<string[]> {
  const harness = new AppTestHarness(new CrmSyncApp(), buildStubs());
  const [ok, issues] = validate_tool_manual(buildToolManual());
  const report = score_tool_manual_offline(buildToolManual());
  const dryRun = await harness.dry_run("sync_crm_lead");
  const action = await harness.execute_action("sync_crm_lead");
  return [
    `tool_manual_valid: ${String(ok)} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    `manifest_issues: ${(await harness.validate_manifest()).length}`,
    `dry_run: ${String(dryRun.success)}`,
    `action: ${String(action.success)}`,
    `receipt_issues: ${harness.validate_receipt(action).length}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("crm_sync.ts")) {
  const lines = await runCrmSyncExample();
  for (const line of lines) {
    console.log(line);
  }
}
