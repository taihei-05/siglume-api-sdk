/*
API: recurring subscription payment through embedded wallet settlement on Polygon.
Intended user: seller-side payment adapter author shipping a PAYMENT tool.
Connected account: none — settlement runs on the platform's on-chain contracts
(SubscriptionHub) and the platform paymaster sponsors gas. Wallets stay
non-custodial: Siglume never holds the buyer's or seller's funds or keys, and
the SubscriptionHub contract can only pull up to the mandate cap the buyer
signed on-chain.
*/
import {
  AppAdapter,
  AppCategory,
  AppTestHarness,
  ApprovalMode,
  ExecutionKind,
  PermissionClass,
  PriceModel,
  SettlementMode,
  ToolManualPermissionClass,
  score_tool_manual_offline,
  simulate_embedded_wallet_charge,
  simulate_polygon_mandate,
  validate_tool_manual,
} from "../siglume-api-sdk-ts/src/index";

const DEFAULT_MONTHLY_CAP_MINOR = 148000;
const DEFAULT_SETTLEMENT_TOKEN = "JPYC";

export class EmbeddedWalletPaymentApp extends AppAdapter {
  manifest() {
    return {
      capability_key: "embedded-wallet-payment",
      name: "Embedded Wallet Payment",
      job_to_be_done: "Preview and charge a recurring subscription through embedded-wallet settlement on Polygon.",
      category: AppCategory.FINANCE,
      permission_class: PermissionClass.PAYMENT,
      approval_mode: ApprovalMode.ALWAYS_ASK,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.SUBSCRIPTION,
      price_value_minor: 1480,
      jurisdiction: "US",
      short_description: "Simulate an ERC-4337 charge with platform-covered gas.",
      example_prompts: [
        "Charge the Plus plan through the saved embedded wallet mandate.",
        "Charge this month's subscription from the saved embedded wallet mandate.",
      ],
    };
  }

  async execute(ctx: Parameters<AppAdapter["execute"]>[0]) {
    const amount_minor = Number(ctx.input_params?.amount_minor ?? DEFAULT_MONTHLY_CAP_MINOR);
    const amount_usd = Number((amount_minor / 100).toFixed(2));
    const settlement_token = String(ctx.input_params?.settlement_token ?? DEFAULT_SETTLEMENT_TOKEN).toUpperCase();
    const mandate = simulate_polygon_mandate({
      mandate_id: "pmd_demo_001",
      payer_wallet: `0x${"1".repeat(40)}`,
      payee_wallet: `0x${"2".repeat(40)}`,
      monthly_cap_minor: amount_minor,
      currency: settlement_token,
      status: "active",
      next_attempt_at_iso: "2026-05-01T00:00:00Z",
      cancel_scheduled: false,
    });
    const summary = `Charge ${settlement_token} ${(amount_minor / 100).toFixed(2)} through the saved embedded wallet mandate.`;

    if (ctx.execution_kind === ExecutionKind.DRY_RUN) {
      return {
        success: true,
        execution_kind: ctx.execution_kind,
        output: {
          summary,
          amount_usd,
          currency: "USD",
          mandate_id: mandate.mandate_id,
          settlement_token,
          monthly_cap_minor: amount_minor,
        },
        needs_approval: true,
        approval_prompt: summary,
      };
    }

    if (ctx.execution_kind === ExecutionKind.QUOTE) {
      return {
        success: true,
        execution_kind: ctx.execution_kind,
        output: {
          summary: `Quoted ${settlement_token} ${(amount_minor / 100).toFixed(2)} for the upcoming renewal.`,
          amount_usd,
          currency: "USD",
          mandate_id: mandate.mandate_id,
          monthly_cap_minor: amount_minor,
          settlement_token,
        },
        units_consumed: 1,
        receipt_summary: {
          action: "embedded_wallet_quote",
          amount_usd,
          currency: "USD",
          mandate_id: mandate.mandate_id,
          monthly_cap_minor: amount_minor,
          settlement_token,
        },
      };
    }

    const charge = simulate_embedded_wallet_charge({
      mandate,
      amount_minor,
      tx_hash: `0x${"a".repeat(64)}`,
      user_operation_hash: `0x${"b".repeat(64)}`,
      platform_fee_minor: 800,
    });
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary: `Charged ${settlement_token} ${(amount_minor / 100).toFixed(2)} via embedded wallet settlement.`,
        amount_usd,
        currency: "USD",
        mandate_id: mandate.mandate_id,
        tx_hash: charge.tx_hash,
        user_operation_hash: charge.user_operation_hash,
        developer_net_minor: charge.developer_net_minor,
        settlement_token,
      },
      units_consumed: 1,
      receipt_summary: {
        action: "embedded_wallet_charge",
        amount_usd,
        currency: "USD",
        mandate_id: mandate.mandate_id,
        tx_hash: charge.tx_hash,
        user_operation_hash: charge.user_operation_hash,
        settlement_token,
      },
      side_effects: [
        {
          action: "charge_embedded_wallet",
          provider: "siglume_web3",
          external_id: mandate.mandate_id,
          reversible: false,
          metadata: {
            tx_hash: charge.tx_hash,
            user_operation_hash: charge.user_operation_hash,
          },
        },
      ],
    };
  }

  supported_task_types() {
    return ["prepare_subscription_charge", "charge_subscription"];
  }
}

export function buildToolManual() {
  return {
    tool_name: "embedded_wallet_payment",
    job_to_be_done: "Preview, quote, and charge a recurring subscription through embedded-wallet settlement on Polygon.",
    summary_for_model: "Uses Siglume's embedded-wallet rail to quote a recurring cap and then emit an ERC-4337 payment receipt after approval.",
    trigger_conditions: [
      "owner asks to renew a subscription or recurring plan through the embedded wallet rail",
      "agent needs a dry-run or quote before charging the recurring payment",
      "request is to complete a subscription charge on Siglume's web3 settlement rail",
    ],
    do_not_use_when: [
      "the request is only to inspect a balance and does not require any payment action",
      "the owner has not approved a recurring charge or wants to compare plans without paying",
    ],
    permission_class: ToolManualPermissionClass.PAYMENT,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        amount_minor: { type: "integer", description: "Settlement-token amount in minor units.", default: DEFAULT_MONTHLY_CAP_MINOR },
        settlement_token: { type: "string", description: "Settlement token on Polygon (for example JPYC or USDC).", default: DEFAULT_SETTLEMENT_TOKEN },
      },
      required: ["amount_minor"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line summary of the quote or payment result." },
        amount_usd: { type: "number", description: "USD-equivalent amount shown to the owner for approval." },
        currency: { type: "string", description: "Pricing currency exposed through the public SDK contract." },
        mandate_id: { type: "string", description: "Siglume payment mandate identifier." },
        tx_hash: { type: "string", description: "On-chain transaction hash after the payment is submitted." },
        user_operation_hash: { type: "string", description: "ERC-4337 user operation hash when available." },
        developer_net_minor: { type: "integer", description: "Developer net amount after the platform fee." },
        settlement_token: { type: "string", description: "Settlement token used on Polygon." },
      },
      required: ["summary", "amount_usd", "currency", "mandate_id", "settlement_token"],
      additionalProperties: false,
    },
    usage_hints: ["Run dry_run or quote first so the owner can inspect the recurring cap before the payment is submitted."],
    result_hints: ["Report the mandate_id and settlement token before secondary details like developer_net_minor."],
    error_hints: ["If the payer wallet or mandate is missing, ask the owner to reconnect or recreate the payment mandate."],
    approval_summary_template: "Charge {amount_minor} minor units of {settlement_token} via the saved embedded wallet mandate.",
    preview_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Preview of the recurring web3 charge." },
        amount_usd: { type: "number", description: "USD-equivalent amount that would be approved." },
        currency: { type: "string", description: "Pricing currency exposed to the owner." },
        mandate_id: { type: "string", description: "Mandate that would be used for settlement." },
      },
      required: ["summary", "amount_usd", "currency", "mandate_id"],
      additionalProperties: false,
    },
    idempotency_support: true,
    side_effect_summary: "Submits an embedded-wallet charge against the saved Polygon mandate after approval.",
    quote_schema: {
      type: "object",
      properties: {
        monthly_cap_minor: { type: "integer", description: "Quoted recurring cap in the settlement token's minor units." },
        amount_usd: { type: "number", description: "USD-equivalent amount shown in the quote." },
        currency: { type: "string", description: "Pricing currency exposed to the owner." },
        settlement_token: { type: "string", description: "Settlement token used on Polygon." },
      },
      required: ["monthly_cap_minor", "amount_usd", "currency", "settlement_token"],
      additionalProperties: false,
    },
    currency: "USD",
    settlement_mode: SettlementMode.EMBEDDED_WALLET_CHARGE,
    refund_or_cancellation_note: "Cancellations before final settlement follow the seller policy; on-chain settlement itself is not reversed by the SDK helper.",
    jurisdiction: "US",
  };
}

export async function runEmbeddedWalletPaymentExample(): Promise<string[]> {
  const harness = new AppTestHarness(new EmbeddedWalletPaymentApp());
  const toolManual = buildToolManual();
  const [ok, issues] = validate_tool_manual(toolManual);
  const report = score_tool_manual_offline(toolManual);
  const previewMandate = harness.simulate_polygon_mandate({
    mandate_id: "pmd_test_001",
    payer_wallet: `0x${"1".repeat(40)}`,
    payee_wallet: `0x${"2".repeat(40)}`,
    monthly_cap_minor: DEFAULT_MONTHLY_CAP_MINOR,
    currency: DEFAULT_SETTLEMENT_TOKEN,
  });
  const previewCharge = harness.simulate_embedded_wallet_charge({
    mandate: previewMandate,
    amount_minor: DEFAULT_MONTHLY_CAP_MINOR,
    tx_hash: `0x${"a".repeat(64)}`,
    user_operation_hash: `0x${"b".repeat(64)}`,
    platform_fee_minor: 800,
  });
  const dryRun = await harness.dry_run("prepare_subscription_charge", {
    input_params: { amount_minor: DEFAULT_MONTHLY_CAP_MINOR, settlement_token: DEFAULT_SETTLEMENT_TOKEN },
  });
  const quote = await harness.execute_quote("prepare_subscription_charge", {
    input_params: { amount_minor: DEFAULT_MONTHLY_CAP_MINOR, settlement_token: DEFAULT_SETTLEMENT_TOKEN },
  });
  const payment = await harness.execute_payment("charge_subscription", {
    input_params: { amount_minor: DEFAULT_MONTHLY_CAP_MINOR, settlement_token: DEFAULT_SETTLEMENT_TOKEN },
  });
  return [
    `tool_manual_valid: ${String(ok)} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    `mandate_status: ${previewMandate.status} cancel_scheduled=${String(previewMandate.cancel_scheduled)}`,
    `charge_tx: ${previewCharge.tx_hash} user_operation=${previewCharge.user_operation_hash}`,
    `dry_run: ${String(dryRun.success)}`,
    `quote: ${String(quote.success)}`,
    `payment: ${String(payment.success)}`,
    `receipt_issues: ${harness.validate_receipt(payment).length}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("embedded_wallet_payment.ts")) {
  void (async () => {
    const lines = await runEmbeddedWalletPaymentExample();
    for (const line of lines) {
      console.log(line);
    }
  })();
}
