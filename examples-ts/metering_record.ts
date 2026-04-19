/*
API: record usage events for analytics and future usage-based billing previews.
Intended user: sellers operating token/call-metered capabilities.
Connected account: none.
*/
import {
  AppAdapter,
  AppCategory,
  AppTestHarness,
  ApprovalMode,
  MeterClient,
  PermissionClass,
  PriceModel,
  type ExecutionContext,
  type ExecutionResult,
  type UsageRecord,
} from "../siglume-api-sdk-ts/src/index";

const EXPERIMENTAL_NOTE =
  "usage_based / per_action remain planned price models on the public platform. Metering currently confirms receipt of events for analytics and future billing previews.";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({
    data,
    meta: { trace_id: "trc_meter", request_id: "req_meter" },
    error: null,
  }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export class TranslationHubMeteredApp extends AppAdapter {
  manifest() {
    return {
      capability_key: "translation-hub",
      name: "Translation Hub",
      job_to_be_done: "Translate text while previewing token-based usage metering.",
      category: AppCategory.COMMUNICATION,
      permission_class: PermissionClass.READ_ONLY,
      approval_mode: ApprovalMode.AUTO,
      dry_run_supported: true,
      required_connected_accounts: [],
      price_model: PriceModel.USAGE_BASED,
      price_value_minor: 5,
      jurisdiction: "US",
      short_description: "Translate text and preview token-based usage line items.",
      example_prompts: ["Translate this roadmap update into Japanese."],
    };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const text = String(ctx.input_params?.text ?? "hello world");
    return {
      success: true,
      execution_kind: ctx.execution_kind,
      output: { summary: `Translated ${text.split(/\s+/).length} tokens.` },
    };
  }
}

export function buildMockMeterClient(): MeterClient {
  const storedEvents = [
    {
      id: "use_demo_001",
      usage_event_id: "use_demo_001",
      capability_key: "translation-hub",
      agent_id: "agent_demo",
      dimension: "tokens_in",
      units_consumed: 1523,
      external_id: "evt_usage_001",
      occurred_at_iso: "2026-04-19T10:00:00Z",
      period_key: "202604",
      created_at: "2026-04-19T10:00:01Z",
      metadata: { source: "example" },
    },
    {
      id: "use_demo_002",
      usage_event_id: "use_demo_002",
      capability_key: "translation-hub",
      agent_id: "agent_demo",
      dimension: "tokens_out",
      units_consumed: 731,
      external_id: "evt_usage_002",
      occurred_at_iso: "2026-04-19T10:00:02Z",
      period_key: "202604",
      created_at: "2026-04-19T10:00:02Z",
      metadata: { source: "example" },
    },
    {
      id: "use_demo_003",
      usage_event_id: "use_demo_003",
      capability_key: "translation-hub",
      agent_id: "agent_demo",
      dimension: "calls",
      units_consumed: 1,
      external_id: "evt_usage_003",
      occurred_at_iso: "2026-04-19T10:00:03Z",
      period_key: "202604",
      created_at: "2026-04-19T10:00:03Z",
      metadata: { source: "example" },
    },
  ];

  return new MeterClient({
    api_key: process.env.SIGLUME_API_KEY ?? "sig_mock_key",
    base_url: "https://api.example.test/v1",
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/v1/market/usage-events" && (init?.method ?? "GET") === "POST") {
        const payload = init?.body ? JSON.parse(String(init.body)) as { events: UsageRecord[] } : { events: [] };
        const items = payload.events.map((event, index) => ({
          accepted: true,
          external_id: event.external_id,
          server_id: `use_demo_${String(index + 1).padStart(3, "0")}`,
          replayed: false,
          capability_key: event.capability_key,
          agent_id: event.agent_id ?? null,
          period_key: "202604",
        }));
        return jsonResponse({ items, count: items.length }, 202);
      }
      if (url.pathname === "/v1/market/usage" && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ items: storedEvents, next_cursor: null, limit: 50, offset: 0 });
      }
      throw new Error(`Unexpected request: ${String(init?.method ?? "GET")} ${url.pathname}`);
    },
  });
}

export async function runMeteringRecordExample(): Promise<string[]> {
  const harness = new AppTestHarness(new TranslationHubMeteredApp());
  const preview = await harness.simulate_metering({
    capability_key: "translation-hub",
    dimension: "tokens_in",
    units: 1523,
    external_id: "evt_usage_001",
    occurred_at_iso: "2026-04-19T10:00:00Z",
    agent_id: "agent_demo",
  });

  const client = buildMockMeterClient();
  const recorded = await client.record(preview.usage_record);
  const batched = await client.record_batch([
    {
      capability_key: "translation-hub",
      dimension: "tokens_out",
      units: 731,
      external_id: "evt_usage_002",
      occurred_at_iso: "2026-04-19T10:00:02Z",
      agent_id: "agent_demo",
    },
    {
      capability_key: "translation-hub",
      dimension: "calls",
      units: 1,
      external_id: "evt_usage_003",
      occurred_at_iso: "2026-04-19T10:00:03Z",
      agent_id: "agent_demo",
    },
  ]);
  const listed = await client.list_usage_events({ capability_key: "translation-hub", period_key: "202604" });
  const dimensions = listed.items.map((item) => item.dimension ?? "").join(",");

  return [
    `experimental_note: ${EXPERIMENTAL_NOTE}`,
    `record_status: accepted=${String(recorded.accepted)} replayed=${String(recorded.replayed)} external_id=${recorded.external_id}`,
    `batch_items: ${batched.length} last_period=${batched.at(-1)?.period_key ?? ""}`,
    `preview_subtotal_minor: ${preview.invoice_line_preview?.subtotal_minor ?? 0}`,
    `usage_dimensions: ${dimensions}`,
  ];
}

const directTarget = process.argv[1] ? new URL(process.argv[1], "file:///").href : "";

if (import.meta.url === directTarget || (process.argv[1] ?? "").endsWith("metering_record.ts")) {
  const lines = await runMeteringRecordExample();
  for (const line of lines) {
    console.log(line);
  }
}
