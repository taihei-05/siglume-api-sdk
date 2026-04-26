import { describe, expect, it } from "vitest";

import {
  AppTestHarness,
  PermissionClass,
  score_tool_manual_offline,
  validate_tool_manual,
} from "../src/index";
import {
  AgentBehaviorApp,
  buildToolManual as buildAgentBehaviorToolManual,
  runAgentBehaviorExample,
} from "../../examples-ts/agent_behavior_adapter";
import {
  AccountDigestsAlertsWrapperApp,
  buildToolManual as buildAccountDashboardToolManual,
  runAccountDigestsAlertsExample,
} from "../../examples-ts/account_digests_alerts_wrapper";
import {
  AccountPlanWrapperApp,
  buildToolManual as buildAccountPlanToolManual,
  runAccountPlanWrapperExample,
} from "../../examples-ts/account_plan_wrapper";
import {
  buildToolManual as buildInstalledToolsToolManual,
  InstalledToolsWrapperApp,
  runInstalledToolsExample,
} from "../../examples-ts/installed_tools_wrapper";
import {
  buildToolManual as buildMarketNeedsToolManual,
  MarketNeedsWrapperApp,
  runMarketNeedsExample,
} from "../../examples-ts/market_needs_wrapper";
import {
  buildToolManual as buildMarketProposalsToolManual,
  MarketProposalsWrapperApp,
  runMarketProposalsExample,
} from "../../examples-ts/market_proposals_wrapper";
import {
  buildToolManual as buildNetworkDiscoveryToolManual,
  NetworkDiscoveryWrapperApp,
  runNetworkDiscoveryExample,
} from "../../examples-ts/network_discovery_wrapper";
import {
  AdsCampaignWrapperApp,
  buildToolManual as buildAdsCampaignToolManual,
  runAdsCampaignExample,
} from "../../examples-ts/ads_campaign_wrapper";
import {
  buildToolManual as buildPartnerDashboardToolManual,
  PartnerDashboardWrapperApp,
  runPartnerDashboardExample,
} from "../../examples-ts/partner_dashboard_wrapper";
import { buildStubs as buildCrmStubs, buildToolManual as buildCrmToolManual, CrmSyncApp, runCrmSyncExample } from "../../examples-ts/crm_sync";
import { buildToolManual as buildNewsDigestToolManual, NewsDigestApp, runNewsDigestExample } from "../../examples-ts/news_digest";
import {
  buildStubs as buildWalletStubs,
  buildToolManual as buildWalletToolManual,
  runWalletBalanceExample,
  WalletBalanceApp,
} from "../../examples-ts/wallet_balance";
import {
  buildToolManual as buildEmbeddedWalletToolManual,
  EmbeddedWalletPaymentApp,
  runEmbeddedWalletPaymentExample,
} from "../../examples-ts/embedded_wallet_payment";
import { runMeteringRecordExample } from "../../examples-ts/metering_record";
import { runMockWebhookExpressExample } from "../../examples-ts/webhook_handler_express";

const EXAMPLES = [
  {
    name: "agent_behavior_adapter",
    permissionClass: PermissionClass.ACTION,
    createHarness: () => new AppTestHarness(new AgentBehaviorApp()),
    createManual: () => buildAgentBehaviorToolManual(),
    taskType: "propose_agent_behavior",
  },
  {
    name: "account_digests_alerts_wrapper",
    permissionClass: PermissionClass.READ_ONLY,
    createHarness: () => new AppTestHarness(new AccountDigestsAlertsWrapperApp()),
    createManual: () => buildAccountDashboardToolManual(),
    taskType: "render_owner_dashboard_widget",
  },
  {
    name: "account_plan_wrapper",
    permissionClass: PermissionClass.READ_ONLY,
    createHarness: () => new AppTestHarness(new AccountPlanWrapperApp()),
    createManual: () => buildAccountPlanToolManual(),
    taskType: "load_account_plan_context",
  },
  {
    name: "installed_tools_wrapper",
    permissionClass: PermissionClass.READ_ONLY,
    createHarness: () => new AppTestHarness(new InstalledToolsWrapperApp()),
    createManual: () => buildInstalledToolsToolManual(),
    taskType: "review_installed_tools",
  },
  {
    name: "market_needs_wrapper",
    permissionClass: PermissionClass.READ_ONLY,
    createHarness: () => new AppTestHarness(new MarketNeedsWrapperApp()),
    createManual: () => buildMarketNeedsToolManual(),
    taskType: "review_market_needs",
  },
  {
    name: "market_proposals_wrapper",
    permissionClass: PermissionClass.ACTION,
    createHarness: () => new AppTestHarness(new MarketProposalsWrapperApp()),
    createManual: () => buildMarketProposalsToolManual(),
    taskType: "stage_market_proposal_negotiation",
  },
  {
    name: "partner_dashboard_wrapper",
    permissionClass: PermissionClass.ACTION,
    createHarness: () => new AppTestHarness(new PartnerDashboardWrapperApp()),
    createManual: () => buildPartnerDashboardToolManual(),
    taskType: "prepare_partner_source_onboarding",
  },
  {
    name: "ads_campaign_wrapper",
    permissionClass: PermissionClass.READ_ONLY,
    createHarness: () => new AppTestHarness(new AdsCampaignWrapperApp()),
    createManual: () => buildAdsCampaignToolManual(),
    taskType: "review_ads_campaign_health",
  },
  {
    name: "network_discovery_wrapper",
    permissionClass: PermissionClass.READ_ONLY,
    createHarness: () => new AppTestHarness(new NetworkDiscoveryWrapperApp()),
    createManual: () => buildNetworkDiscoveryToolManual(),
    taskType: "browse_network_discovery",
  },
  {
    name: "crm_sync",
    permissionClass: PermissionClass.ACTION,
    createHarness: () => new AppTestHarness(new CrmSyncApp(), buildCrmStubs()),
    createManual: () => buildCrmToolManual(),
    taskType: "sync_crm_lead",
  },
  {
    name: "news_digest",
    permissionClass: PermissionClass.READ_ONLY,
    createHarness: () => new AppTestHarness(new NewsDigestApp()),
    createManual: () => buildNewsDigestToolManual(),
    taskType: "news_digest",
  },
  {
    name: "embedded_wallet_payment",
    permissionClass: PermissionClass.PAYMENT,
    createHarness: () => new AppTestHarness(new EmbeddedWalletPaymentApp()),
    createManual: () => buildEmbeddedWalletToolManual(),
    taskType: "prepare_subscription_charge",
  },
  {
    name: "wallet_balance",
    permissionClass: PermissionClass.READ_ONLY,
    createHarness: () => new AppTestHarness(new WalletBalanceApp(), buildWalletStubs()),
    createManual: () => buildWalletToolManual(),
    taskType: "wallet_balance",
  },
] as const;

describe("TypeScript example suite", () => {
  it.each(EXAMPLES)("$name validates and clears the publish bar", async ({ createManual }) => {
    const manual = createManual();
    const [ok, issues] = validate_tool_manual(manual);
    const report = score_tool_manual_offline(manual);

    expect(ok).toBe(true);
    expect(issues).toEqual([]);
    expect(["A", "B"]).toContain(report.grade);
  });

  it.each(EXAMPLES)("$name runs through AppTestHarness", async ({ createHarness, permissionClass, taskType }) => {
    const harness = createHarness();

    expect(await harness.validate_manifest()).toEqual([]);

    const dryRun = await harness.dry_run(taskType);
    expect(dryRun.success).toBe(true);

    if (permissionClass === PermissionClass.ACTION) {
      const action = await harness.execute_action(taskType);
      expect(action.success).toBe(true);
      expect(harness.validate_receipt(action)).toEqual([]);
    }

    if (permissionClass === PermissionClass.PAYMENT) {
      const quote = await harness.execute_quote(taskType);
      const payment = await harness.execute_payment("charge_subscription");
      expect(quote.success).toBe(true);
      expect(payment.success).toBe(true);
      expect(harness.validate_receipt(payment)).toEqual([]);
    }
  });

  it("returns stable summary lines for crm_sync", async () => {
    const lines = await runCrmSyncExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[3]).toBe("dry_run: true");
    expect(lines[4]).toBe("action: true");
  });

  it("returns stable summary lines for agent_behavior_adapter", async () => {
    const lines = await runAgentBehaviorExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[2]).toBe("dry_run: true");
    expect(lines[3]).toBe("action: true");
    expect(lines[4]).toBe("proposal_preview: Would ask the owner to update charter / approval / budget for agt_owner_demo.");
    expect(lines[5]).toBe("receipt_issues: 0");
  });

  it("returns stable summary lines for account_plan_wrapper", async () => {
    const lines = await runAccountPlanWrapperExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[2]).toBe("plan: plus model=claude-sonnet-4-6");
    expect(lines[3]).toBe("dry_run: true");
    expect(lines[4]).toBe("summary: Plan plus with ja preferences loaded for writing tone personalization.");
  });

  it("returns stable summary lines for market_needs_wrapper", async () => {
    const lines = await runMarketNeedsExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[2]).toBe("needs_loaded: 2 first=need_demo_1");
    expect(lines[3]).toBe("titles: Localize release notes into Japanese|Summarize partner invoices");
    expect(lines[4]).toBe("dry_run: true");
    expect(lines[5]).toBe("summary: Loaded 2 open market needs for translation coverage triage; first need: Localize release notes into Japanese.");
  });

  it("returns stable summary lines for market_proposals_wrapper", async () => {
    const lines = await runMarketProposalsExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[2]).toBe("proposals_loaded: 2 first=prop_demo_1");
    expect(lines[3]).toBe("dry_run: true");
    expect(lines[4]).toBe("action: true");
    expect(lines[5]).toBe("approval_intents: intent_prop_create_1|intent_prop_counter_1|intent_prop_accept_1");
    expect(lines[6]).toBe("summary: Prepared 3 proposal approval requests for opp_demo_1.");
  });

  it("returns stable summary lines for installed_tools_wrapper", async () => {
    const lines = await runInstalledToolsExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[2]).toBe("installed_tools: 2 ready=false");
    expect(lines[3]).toBe("receipt_steps: 1 execution=queued");
    expect(lines[4]).toBe("dry_run: true");
    expect(lines[5]).toBe("summary: Loaded 2 installed tools for installed tool readiness triage; first receipt: rcp_inst_1 (queued).");
  });

  it("returns stable summary lines for account_digests_alerts_wrapper", async () => {
    const lines = await runAccountDigestsAlertsExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[2]).toBe("watchlist: BTC,ETH,NVDA");
    expect(lines[3]).toBe("digests_alerts: 2/2");
    expect(lines[4]).toBe("dry_run: true");
    expect(lines[5]).toBe("summary: Dashboard widget loaded 3 watchlist symbols, 2 digests, and 2 alerts for morning dashboard.");
  });

  it("returns stable summary lines for network_discovery_wrapper", async () => {
    const lines = await runNetworkDiscoveryExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[2]).toBe("feed_items: 2 batch_titles=AI infra demand spikes|Chip supply normalizes");
    expect(lines[3]).toBe("claim_evidence: clm_market_signal/evd_press_release");
    expect(lines[4]).toBe("dry_run: true");
    expect(lines[5]).toBe("summary: Browsed 2 network items for market signal discovery and hydrated claim clm_market_signal with evidence evd_press_release.");
  });

  it("returns stable summary lines for partner_dashboard_wrapper", async () => {
    const lines = await runPartnerDashboardExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[2]).toBe("dashboard: plan=starter usage=10.0 keys=2");
    expect(lines[3]).toBe("created_key: cred_partner_3 hint=src_partner_3.********");
    expect(lines[4]).toBe("dry_run: true");
    expect(lines[5]).toBe("action: true");
    expect(lines[6]).toContain("raw ingest_key is available only via POST /v1/partner/keys");
  });

  it("returns stable summary lines for ads_campaign_wrapper", async () => {
    const lines = await runAdsCampaignExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[2]).toBe("campaigns_loaded: 2 first=cmp_ads_1");
    expect(lines[3]).toBe("billing_profile: web3/usd profile=true");
    expect(lines[4]).toBe("dry_run: true");
    expect(lines[5]).toBe("summary: Loaded 2 ads campaigns for campaign pacing review; billing mode web3 with 1 recent posts for the first campaign.");
  });

  it("returns stable summary lines for news_digest", async () => {
    const lines = await runNewsDigestExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[3]).toBe("dry_run: true");
  });

  it("returns stable summary lines for wallet_balance", async () => {
    const lines = await runWalletBalanceExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[3]).toBe("dry_run: true");
  });

  it("returns stable summary lines for webhook_handler_express", async () => {
    const lines = await runMockWebhookExpressExample();

    expect(lines[0]).toBe("status: 200");
    expect(lines[1]).toBe("handled_type: payment.succeeded");
    expect(lines[4]).toBe("duplicate_on_replay: true");
  });

  it("returns stable summary lines for metering_record", async () => {
    const lines = await runMeteringRecordExample();

    expect(lines[0]).toContain("experimental_note: usage_based / per_action remain planned");
    expect(lines[1]).toBe("record_status: accepted=true replayed=false external_id=evt_usage_001");
    expect(lines[2]).toBe("batch_items: 2 last_period=202604");
    expect(lines[3]).toBe("preview_subtotal_minor: 7615");
    expect(lines[4]).toBe("usage_dimensions: tokens_in,tokens_out,calls");
  });

  it("returns stable summary lines for embedded_wallet_payment", async () => {
    const lines = await runEmbeddedWalletPaymentExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[2]).toBe("mandate_status: active cancel_scheduled=false");
    expect(lines[3]).toBe(`charge_tx: 0x${"a".repeat(64)} user_operation=0x${"b".repeat(64)}`);
    expect(lines[4]).toBe("dry_run: true");
    expect(lines[5]).toBe("quote: true");
    expect(lines[6]).toBe("payment: true");
    expect(lines[7]).toBe("receipt_issues: 0");
  });
});
