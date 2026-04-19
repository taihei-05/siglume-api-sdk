import { SiglumeBuyerClient, to_anthropic_tool } from "../siglume-api-sdk-ts/src/index";

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(String(input));
}

export function buildMockBuyerClient(): SiglumeBuyerClient {
  const listing = {
    id: "lst_currency",
    capability_key: "currency-converter-v2",
    name: "Currency Converter",
    description: "Convert USD amounts to JPY with live exchange rates and return a concise summary.",
    job_to_be_done: "Convert currency amounts between USD and JPY.",
    permission_class: "read-only",
    approval_mode: "auto",
    dry_run_supported: true,
    price_model: "free",
    price_value_minor: 0,
    currency: "USD",
    short_description: "Convert currency with live rates.",
    status: "published",
    input_schema: {
      type: "object",
      properties: {
        amount_usd: { type: "number", description: "USD amount to convert." },
        to: { type: "string", description: "Target currency code." },
      },
      required: ["amount_usd", "to"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line conversion summary." },
        amount: { type: "number", description: "Converted amount." },
        currency: { type: "string", description: "Target currency." },
      },
      required: ["summary", "amount", "currency"],
      additionalProperties: false,
    },
  };

  return new SiglumeBuyerClient({
    api_key: process.env.SIGLUME_API_KEY ?? "sig_mock_key",
    base_url: "https://api.example.test/v1",
    default_agent_id: process.env.SIGLUME_AGENT_ID ?? "agent_mock_demo",
    allow_internal_execute: true,
    fetch: async (input, init) => {
      const url = requestUrl(input);
      if (url.pathname === "/v1/market/capabilities") {
        return new Response(
          JSON.stringify({
            data: { items: [listing], next_cursor: null, limit: 20, offset: 0 },
            meta: { trace_id: "trc_buyer", request_id: "req_buyer" },
            error: null,
          }),
          { status: 200 },
        );
      }
      if (url.pathname === "/v1/internal/market/capability/execute") {
        const payload = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        const args = (payload.arguments ?? {}) as Record<string, unknown>;
        const amountUsd = Number(args.amount_usd ?? 0);
        const target = String(args.to ?? "JPY");
        const converted = Math.round(amountUsd * 15000) / 100;
        return new Response(
          JSON.stringify({
            data: {
              accepted: true,
              allowed: true,
              reason: "accepted",
              reason_code: null,
              usage_event: { units_consumed: 1, execution_kind: "action" },
              result: {
                summary: `Converted USD ${amountUsd.toFixed(2)} to ${target} ${converted.toFixed(2)}.`,
                amount: converted,
                currency: target,
              },
              receipt: { execution_kind: "action", currency: target, amount_minor: 0 },
            },
            meta: { trace_id: "trc_exec", request_id: "req_exec" },
            error: null,
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected request: ${String(init?.method ?? "GET")} ${url}`);
    },
  });
}

export async function runMockBuyerClaudeExample(): Promise<string[]> {
  const buyer = buildMockBuyerClient();
  const listing = await buyer.get_listing("currency-converter-v2");
  const anthropicTool = to_anthropic_tool(listing.tool_manual).schema;
  const toolUse = {
    name: anthropicTool.name,
    input: { amount_usd: 100, to: "JPY" },
  };
  const result = await buyer.invoke({
    capability_key: "currency-converter-v2",
    input: toolUse.input,
  });
  return [
    `tool_name: ${anthropicTool.name}`,
    `tool_description: ${anthropicTool.description}`,
    `tool_use_name: ${toolUse.name}`,
    `result_summary: ${String(result.output?.summary ?? "")}`,
    `result_currency: ${String(result.output?.currency ?? "")}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("buyer_claude_agent_sdk.ts")) {
  const lines = await runMockBuyerClaudeExample();
  for (const line of lines) {
    console.log(line);
  }
}
