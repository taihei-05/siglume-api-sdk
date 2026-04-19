import { describe, expect, it } from "vitest";

import {
  AppTestHarness,
  PermissionClass,
  score_tool_manual_offline,
  validate_tool_manual,
} from "../src/index";
import { buildStubs as buildCrmStubs, buildToolManual as buildCrmToolManual, CrmSyncApp, runCrmSyncExample } from "../../examples-ts/crm_sync";
import { buildToolManual as buildNewsDigestToolManual, NewsDigestApp, runNewsDigestExample } from "../../examples-ts/news_digest";
import {
  buildStubs as buildWalletStubs,
  buildToolManual as buildWalletToolManual,
  runWalletBalanceExample,
  WalletBalanceApp,
} from "../../examples-ts/wallet_balance";
import { runMockWebhookExpressExample } from "../../examples-ts/webhook_handler_express";

const EXAMPLES = [
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
  });

  it("returns stable summary lines for crm_sync", async () => {
    const lines = await runCrmSyncExample();

    expect(lines[0]).toBe("tool_manual_valid: true 0");
    expect(lines[1]).toMatch(/^quality_grade: [AB] \d+$/);
    expect(lines[3]).toBe("dry_run: true");
    expect(lines[4]).toBe("action: true");
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
});
