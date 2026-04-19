import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SiglumeAssistError } from "../src/errors";
import {
  AnthropicProvider,
  LLMProvider,
  OpenAIProvider,
  TOOL_MANUAL_DRAFT_PROMPT,
  draft_tool_manual,
  fill_tool_manual_gaps,
} from "../src/tool-manual-assist";

function goodManual() {
  return {
    tool_name: "price_compare_helper",
    job_to_be_done: "Search multiple retailers for a product and return a ranked price comparison the agent can cite.",
    summary_for_model: "Looks up current retailer offers and returns a structured comparison with the best deal first.",
    trigger_conditions: [
      "owner asks to compare prices for a product before deciding where to buy",
      "agent needs retailer offer data to support a shopping recommendation",
      "request is to find the cheapest or best-value option for a product query",
    ],
    do_not_use_when: [
      "the request is to complete checkout or place an order instead of comparing offers",
    ],
    permission_class: "read_only" as const,
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product name, model number, or search phrase." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line overview of the best available deal." },
        offers: { type: "array", items: { type: "object" }, description: "Ranked retailer offers." },
      },
      required: ["summary", "offers"],
      additionalProperties: false,
    },
    usage_hints: ["Use this tool after the owner has named a product and wants evidence-backed price comparison."],
    result_hints: ["Lead with the best offer and then summarize notable trade-offs."],
    error_hints: ["If no offers are found, ask for a clearer product name or model number."],
  };
}

function goodPaymentManual() {
  return {
    ...goodManual(),
    permission_class: "payment" as const,
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line overview of the quoted payment." },
        amount_usd: { type: "number", description: "Quoted USD amount." },
        currency: { type: "string", description: "Currency code for the quote." },
      },
      required: ["summary", "amount_usd", "currency"],
      additionalProperties: false,
    },
    approval_summary_template: "Charge USD {amount_usd}.",
    preview_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Preview of the payment attempt." },
      },
      required: ["summary"],
      additionalProperties: false,
    },
    idempotency_support: true,
    side_effect_summary: "Captures a USD payment if the owner approves.",
    quote_schema: {
      type: "object",
      properties: {
        amount_usd: { type: "number", description: "Quoted USD amount." },
        currency: { type: "string", description: "Currency code for the quote." },
      },
      required: ["amount_usd", "currency"],
      additionalProperties: false,
    },
    currency: "USD",
    settlement_mode: "embedded_wallet_charge" as const,
    refund_or_cancellation_note: "Refunds follow the merchant cancellation policy.",
    jurisdiction: "US",
  };
}

function weakManual() {
  return {
    ...goodManual(),
    summary_for_model: "Bad.",
    trigger_conditions: ["use when helpful", "for many tasks", "any request"],
    usage_hints: [],
    result_hints: [],
    error_hints: [],
  };
}

class StubProvider extends LLMProvider {
  private readonly payloads: Array<Record<string, unknown>>;
  calls = 0;
  lastOutputSchema: Record<string, unknown> | null = null;

  constructor(payloads: Array<Record<string, unknown>>) {
    super(
      { api_key: "stub-key" },
      {
        provider_name: "stub",
        default_model: "stub-model",
        api_key_env: "STUB_API_KEY",
        default_base_url: "https://stub.example.test",
        price_table: {},
      },
    );
    this.payloads = payloads;
  }

  async generateStructured(options: {
    system_prompt: string;
    user_prompt: string;
    output_schema: Record<string, unknown>;
  }): Promise<{ payload: Record<string, unknown>; usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number } }> {
    this.lastOutputSchema = options.output_schema;
    const payload = this.payloads[Math.min(this.calls, this.payloads.length - 1)]!;
    this.calls += 1;
    return {
      payload,
      usage: {
        input_tokens: 100 * this.calls,
        output_tokens: 20 * this.calls,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
  }
}

describe("tool-manual assist", () => {
  it("keeps the TS prompt in sync with the Python markdown prompt", async () => {
    const pythonPrompt = await readFile(join(process.cwd(), "..", "siglume_api_sdk", "prompts", "tool_manual_draft.md"), "utf8");
    expect(TOOL_MANUAL_DRAFT_PROMPT.replace(/\r\n/g, "\n").trim()).toBe(pythonPrompt.replace(/\r\n/g, "\n").trim());
  });

  it("creates a full draft and returns metadata", async () => {
    const result = await draft_tool_manual({
      capability_key: "price-compare-helper",
      job_to_be_done: "Compare retailer prices for a product and return the best current offer.",
      permission_class: "read_only",
      llm: new StubProvider([goodManual()]),
    });

    expect(result.tool_manual.tool_name).toBe("price_compare_helper");
    expect(result.quality_report.grade).toMatch(/[AB]/);
    expect(result.metadata.attempt_count).toBe(1);
    expect(result.metadata.total_input_tokens).toBe(100);
  });

  it("fills only missing fields while preserving existing valid fields", async () => {
    const partial = goodManual();
    delete (partial as Partial<typeof partial>).summary_for_model;
    partial.usage_hints = [];

    const result = await fill_tool_manual_gaps({
      partial_manual: partial,
      llm: new StubProvider([
        {
          summary_for_model: "Looks up current retailer offers and returns a structured comparison with the best deal first.",
          usage_hints: ["Use this tool after the owner has named a product and wants evidence-backed price comparison."],
        },
      ]),
    });

    expect(result.tool_manual.tool_name).toBe("price_compare_helper");
    expect(result.tool_manual.summary_for_model).toContain("structured comparison");
    expect(result.tool_manual.usage_hints.length).toBeGreaterThan(0);
  });

  it("returns immediately for a valid gap-fill manual with no missing fields", async () => {
    const provider = new StubProvider([goodManual()]);
    const partial = {
      ...goodManual(),
      input_schema: JSON.stringify(goodManual().input_schema),
      output_schema: JSON.stringify(goodManual().output_schema),
    };

    const result = await fill_tool_manual_gaps({
      partial_manual: partial,
      llm: provider,
    });

    expect(result.metadata.attempt_count).toBe(0);
    expect(provider.calls).toBe(0);
    expect(result.tool_manual.input_schema).toEqual(goodManual().input_schema);
  });

  it("recovers payment-only fields when permission_class is missing", async () => {
    const partial = goodPaymentManual();
    delete (partial as Partial<typeof partial>).permission_class;
    delete (partial as Partial<typeof partial>).refund_or_cancellation_note;
    const provider = new StubProvider([
      {
        permission_class: "payment",
        refund_or_cancellation_note: "Refunds follow the merchant cancellation policy.",
      },
    ]);

    const result = await fill_tool_manual_gaps({
      partial_manual: partial,
      llm: provider,
    });

    expect(provider.lastOutputSchema).not.toBeNull();
    expect((provider.lastOutputSchema?.properties as Record<string, unknown>).refund_or_cancellation_note).toBeDefined();
    expect(result.tool_manual.permission_class).toBe("payment");
    expect(result.tool_manual.refund_or_cancellation_note).toBe("Refunds follow the merchant cancellation policy.");
  });

  it("retries until the draft reaches grade B or better", async () => {
    const result = await draft_tool_manual({
      capability_key: "price-compare-helper",
      job_to_be_done: "Compare retailer prices for a product and return the best current offer.",
      permission_class: "read_only",
      llm: new StubProvider([weakManual(), goodManual()]),
    });

    expect(result.metadata.attempt_count).toBe(2);
    expect(result.metadata.attempts[0]?.grade).not.toMatch(/[AB]/);
    expect(result.metadata.attempts[1]?.grade).toMatch(/[AB]/);
  });

  it("raises after exhausting attempts", async () => {
    await expect(
      draft_tool_manual({
        capability_key: "price-compare-helper",
        job_to_be_done: "Compare retailer prices for a product and return the best current offer.",
        permission_class: "read_only",
        llm: new StubProvider([weakManual(), weakManual(), weakManual()]),
        max_attempts: 3,
      }),
    ).rejects.toBeInstanceOf(SiglumeAssistError);
  });

  it("uses prompt caching for Anthropic requests", async () => {
    const requests: Record<string, unknown>[] = [];
    const provider = new AnthropicProvider({
      api_key: "ant_test_key",
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            content: [{ type: "tool_use", name: "emit_tool_manual", input: goodManual() }],
            usage: {
              input_tokens: 120,
              output_tokens: 40,
              cache_creation_input_tokens: 80,
              cache_read_input_tokens: 0,
            },
          }),
          { status: 200 },
        );
      },
    });

    const result = await draft_tool_manual({
      capability_key: "price-compare-helper",
      job_to_be_done: "Compare retailer prices for a product and return the best current offer.",
      permission_class: "read_only",
      llm: provider,
    });

    expect(requests[0]?.tool_choice).toEqual({ type: "tool", name: "emit_tool_manual" });
    expect((requests[0]?.system as Array<Record<string, unknown>>)[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(result.metadata.attempts[0]?.estimated_cost_usd).not.toBeNull();
  });

  it("surfaces Anthropic transport and payload errors", async () => {
    const brokenProvider = new AnthropicProvider({
      api_key: "ant_test_key",
      fetch: async () => new Response(JSON.stringify({ content: [] }), { status: 200 }),
    });

    await expect(
      brokenProvider.generateStructured({
        system_prompt: TOOL_MANUAL_DRAFT_PROMPT,
        user_prompt: "return a tool manual",
        output_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
      }),
    ).rejects.toBeInstanceOf(SiglumeAssistError);

    const httpErrorProvider = new AnthropicProvider({
      api_key: "ant_test_key",
      fetch: async () => new Response("boom", { status: 503 }),
    });

    await expect(
      httpErrorProvider.generateStructured({
        system_prompt: TOOL_MANUAL_DRAFT_PROMPT,
        user_prompt: "return a tool manual",
        output_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
      }),
    ).rejects.toBeInstanceOf(SiglumeAssistError);
  });

  it("uses Responses text.format for OpenAI requests", async () => {
    const requests: Record<string, unknown>[] = [];
    const provider = new OpenAIProvider({
      api_key: "openai_test_key",
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify(goodManual()),
            usage: { input_tokens: 90, output_tokens: 30 },
          }),
          { status: 200 },
        );
      },
    });

    const result = await draft_tool_manual({
      capability_key: "price-compare-helper",
      job_to_be_done: "Compare retailer prices for a product and return the best current offer.",
      permission_class: "read_only",
      llm: provider,
    });

    expect(requests[0]?.store).toBe(false);
    expect((requests[0]?.text as { format?: { type?: string } }).format?.type).toBe("json_schema");
    expect(result.tool_manual.tool_name).toBe("price_compare_helper");
  });

  it("builds payment defaults into the draft prompt and can read env keys", async () => {
    const requests: Record<string, unknown>[] = [];
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "openai_test_key";
    try {
      const provider = new OpenAIProvider({
        fetch: async (_input, init) => {
          requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify(goodPaymentManual()),
              usage: { input_tokens: 90, output_tokens: 30 },
            }),
            { status: 200 },
          );
        },
      });

      const result = await draft_tool_manual({
        capability_key: "payment-quote",
        job_to_be_done: "Quote a USD payment amount and complete the payment after approval.",
        permission_class: "payment",
        llm: provider,
      });

      expect(String(requests[0]?.input)).toContain("\"currency\": \"USD\"");
      expect(String(requests[0]?.input)).toContain("\"jurisdiction\": \"US\"");
      expect(result.tool_manual.permission_class).toBe("payment");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });

  it("parses OpenAI fallback output blocks and rejects when no API key exists", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIProvider()).toThrow(SiglumeAssistError);
    if (previous !== undefined) {
      process.env.OPENAI_API_KEY = previous;
    }

    const provider = new OpenAIProvider({
      api_key: "openai_test_key",
      fetch: async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: JSON.stringify(goodManual()) }],
              },
            ],
            usage: { input_tokens: 44, output_tokens: 12 },
          }),
          { status: 200 },
        ),
    });

    const result = await provider.generateStructured({
      system_prompt: TOOL_MANUAL_DRAFT_PROMPT,
      user_prompt: "return a tool manual",
      output_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    });

    expect(result.payload.tool_name).toBe("price_compare_helper");
  });

  it("maps invalid OpenAI output_text JSON into a SiglumeAssistError", async () => {
    const provider = new OpenAIProvider({
      api_key: "openai_test_key",
      fetch: async () =>
        new Response(
          JSON.stringify({
            output_text: "{not-json",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200 },
        ),
    });

    await expect(
      provider.generateStructured({
        system_prompt: TOOL_MANUAL_DRAFT_PROMPT,
        user_prompt: "return a tool manual",
        output_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
      }),
    ).rejects.toBeInstanceOf(SiglumeAssistError);
  });
});
