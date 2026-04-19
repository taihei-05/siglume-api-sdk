/*
API: wallet balance lookup across Ethereum or Polygon.
Intended user: treasury or portfolio monitoring agents.
Connected account: metamask.
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

const ETHEREUM_DEFAULT: [string, number, number] = ["ETH", 1.2345, 3200.0];
const CHAIN_DEFAULTS: Record<string, [string, number, number]> = {
  ethereum: ETHEREUM_DEFAULT,
  polygon: ["MATIC", 542.1, 0.75],
};

const TOKEN_PRICES: Record<string, number> = {
  ETH: 3200.0,
  MATIC: 0.75,
  USDC: 1.0,
};

export class WalletBalanceApp extends AppAdapter {
  manifest() {
    return {
      capability_key: "wallet-balance",
      name: "Wallet Balance",
      job_to_be_done: "Read the owner's connected wallet balance on Ethereum or Polygon without moving funds.",
      category: AppCategory.FINANCE,
      permission_class: PermissionClass.READ_ONLY,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: true,
      required_connected_accounts: ["metamask"],
      price_model: PriceModel.FREE,
      jurisdiction: "US",
      short_description: "Read native-token or ERC-20 balances from a connected MetaMask wallet.",
      example_prompts: ["Check my Polygon wallet balance."],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const chain = String(ctx.input_params?.chain ?? "ethereum").toLowerCase();
    const chainDefaults = CHAIN_DEFAULTS[chain] ?? ETHEREUM_DEFAULT;
    const [defaultSymbol, defaultBalance, defaultPrice] = chainDefaults;
    const token_symbol = String(ctx.input_params?.token_symbol ?? defaultSymbol).toUpperCase();
    const balance = token_symbol === defaultSymbol ? defaultBalance : token_symbol === "USDC" ? 250.0 : 18.75;
    const usd_equivalent = Math.round(balance * (TOKEN_PRICES[token_symbol] ?? defaultPrice) * 100) / 100;
    const provider = ctx.connected_accounts?.metamask?.provider_key ?? "metamask";
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: {
        summary: `${chain[0]?.toUpperCase() ?? ""}${chain.slice(1)} wallet holds ${balance.toFixed(4)} ${token_symbol} (~USD ${usd_equivalent.toFixed(2)}).`,
        chain,
        token_symbol,
        balance,
        usd_equivalent,
        provider,
      },
    };
  }

  supported_task_types() {
    return ["wallet_balance", "check_wallet_balance"];
  }
}

export function buildStubs() {
  return { metamask: new StubProvider("metamask") };
}

export function buildToolManual(): ToolManual {
  return {
    tool_name: "wallet_balance",
    job_to_be_done: "Read the owner's connected MetaMask wallet balance on Ethereum or Polygon without creating any blockchain side effects.",
    summary_for_model: "Returns native-token or ERC-20 wallet balances plus a USD equivalent for a connected MetaMask wallet on Ethereum or Polygon.",
    trigger_conditions: [
      "owner asks to check a wallet balance on Ethereum or Polygon",
      "agent needs a read-only on-chain balance snapshot before planning a payment or treasury action",
      "request is to inspect holdings rather than transfer funds or approve a transaction",
    ],
    do_not_use_when: [
      "the request is to sign, send, swap, or bridge assets",
      "the owner has not connected a MetaMask wallet for the target chain",
    ],
    permission_class: ToolManualPermissionClass.READ_ONLY,
    dry_run_supported: true,
    requires_connected_accounts: ["metamask"],
    input_schema: {
      type: "object",
      properties: {
        chain: {
          type: "string",
          description: "Target chain to inspect.",
          enum: ["ethereum", "polygon"],
        },
        token_symbol: {
          type: "string",
          description: "Optional token symbol; omit to read the native asset.",
          default: "native",
        },
      },
      required: ["chain"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line balance summary." },
        chain: { type: "string", description: "Chain that was queried." },
        token_symbol: { type: "string", description: "Token that was priced." },
        balance: { type: "number", description: "Token balance on the requested chain." },
        usd_equivalent: { type: "number", description: "Approximate USD equivalent." },
      },
      required: ["summary", "chain", "token_symbol", "balance", "usd_equivalent"],
      additionalProperties: false,
    },
    usage_hints: ["Use this tool before payment planning when the owner needs a read-only wallet balance snapshot."],
    result_hints: ["State the chain, token, and USD equivalent in the first sentence so the owner can sanity-check the result quickly."],
    error_hints: ["If the owner has not connected MetaMask for the requested chain, ask them to connect the wallet before retrying."],
  };
}

export async function runWalletBalanceExample(): Promise<string[]> {
  const harness = new AppTestHarness(new WalletBalanceApp(), buildStubs());
  const [ok, issues] = validate_tool_manual(buildToolManual());
  const report = score_tool_manual_offline(buildToolManual());
  const dryRun = await harness.dry_run("wallet_balance", { input_params: { chain: "polygon" } });
  return [
    `tool_manual_valid: ${String(ok)} ${issues.length}`,
    `quality_grade: ${report.grade} ${report.overall_score}`,
    `manifest_issues: ${(await harness.validate_manifest()).length}`,
    `dry_run: ${String(dryRun.success)}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("wallet_balance.ts")) {
  const lines = await runWalletBalanceExample();
  for (const line of lines) {
    console.log(line);
  }
}
