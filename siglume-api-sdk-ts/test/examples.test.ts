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
import { runRefundPartialExample } from "../../examples-ts/refund_partial";
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

  it("returns stable summary lines for refund_partial", async () => {
    const lines = await runRefundPartialExample();

    expect(lines[0]).toContain("refund_note: Refunds are issued against the original receipt.");
    expect(lines[1]).toBe("refund_status: issued replay=false");
    expect(lines[3]).toBe("refunds_for_receipt: 1");
    expect(lines[4]).toBe("dispute_status: contested response=contest");
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
