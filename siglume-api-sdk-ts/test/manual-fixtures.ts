export const EXPECTED_PARITY: Record<string, { overall_score: number; keyword_coverage_estimate: number }> = {
  baseline_read_only: { overall_score: 100, keyword_coverage_estimate: 40 },
  action_good: { overall_score: 100, keyword_coverage_estimate: 40 },
  payment_good: { overall_score: 100, keyword_coverage_estimate: 40 },
  short_triggers: { overall_score: 85, keyword_coverage_estimate: 30 },
  vague_triggers: { overall_score: 83, keyword_coverage_estimate: 34 },
  marketing_triggers: { overall_score: 91, keyword_coverage_estimate: 41 },
  imperative_triggers: { overall_score: 89, keyword_coverage_estimate: 37 },
  too_few_triggers: { overall_score: 95, keyword_coverage_estimate: 34 },
  overlapping_do_not_use: { overall_score: 97, keyword_coverage_estimate: 40 },
  short_do_not_use: { overall_score: 98, keyword_coverage_estimate: 40 },
  short_summary: { overall_score: 97, keyword_coverage_estimate: 35 },
  marketing_summary: { overall_score: 97, keyword_coverage_estimate: 40 },
  missing_input_descriptions: { overall_score: 90, keyword_coverage_estimate: 40 },
  short_input_descriptions: { overall_score: 96, keyword_coverage_estimate: 40 },
  trivial_enum_values: { overall_score: 95, keyword_coverage_estimate: 40 },
  missing_output_descriptions: { overall_score: 96, keyword_coverage_estimate: 40 },
  empty_hints: { overall_score: 94, keyword_coverage_estimate: 33 },
  short_hints: { overall_score: 98, keyword_coverage_estimate: 34 },
  low_keyword_coverage: { overall_score: 60, keyword_coverage_estimate: 6 },
  invalid_root: { overall_score: 0, keyword_coverage_estimate: 0 },
};

export function baseManual(): Record<string, unknown> {
  return {
    tool_name: "price_compare_helper",
    job_to_be_done: "Compare retailer prices for a product and return the best current offer with supporting details.",
    summary_for_model: "Looks up current retailer offers and returns a structured comparison with the best deal first.",
    trigger_conditions: [
      "owner asks to compare prices for a product before deciding where to buy",
      "agent needs retailer offer data to support a shopping recommendation",
      "request is to find the cheapest or best-value option for a product query",
    ],
    do_not_use_when: [
      "the request is to complete checkout or place an order instead of comparing offers",
    ],
    permission_class: "read_only",
    dry_run_supported: true,
    requires_connected_accounts: [],
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product name, model number, or search phrase." },
        max_price_usd: { type: "number", description: "Optional maximum budget in USD for filtering offers." },
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
    usage_hints: [
      "Use this tool after the owner has named a product and wants evidence-backed price comparison.",
    ],
    result_hints: [
      "Lead with the best offer and then summarize notable trade-offs.",
    ],
    error_hints: [
      "If no offers are found, ask for a clearer product name or model number.",
    ],
  };
}

export function cloneBase(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(baseManual())) as Record<string, unknown>;
}

export function buildParityCases(): Array<[string, unknown]> {
  const cases: Array<[string, unknown]> = [];

  let manual = cloneBase();
  cases.push(["baseline_read_only", manual]);

  manual = cloneBase();
  manual.permission_class = "action";
  manual.tool_name = "draft_creator";
  manual.approval_summary_template = "Create draft for {query}";
  manual.preview_schema = {
    type: "object",
    properties: { summary: { type: "string", description: "Preview of the action to perform." } },
    required: ["summary"],
    additionalProperties: false,
  };
  manual.idempotency_support = true;
  manual.side_effect_summary = "Creates or updates an external draft resource.";
  manual.jurisdiction = "US";
  cases.push(["action_good", manual]);

  manual = cloneBase();
  manual.permission_class = "payment";
  manual.tool_name = "payment_quote";
  manual.approval_summary_template = "Charge USD {amount_usd} for {query}";
  manual.preview_schema = {
    type: "object",
    properties: { summary: { type: "string", description: "Preview of the payment attempt." } },
    required: ["summary"],
    additionalProperties: false,
  };
  manual.idempotency_support = true;
  manual.side_effect_summary = "Captures a USD payment if the owner approves.";
  manual.jurisdiction = "US";
  manual.quote_schema = {
    type: "object",
    properties: {
      amount_usd: { type: "number", description: "Quoted USD amount." },
      currency: { type: "string", description: "Currency code for the quote." },
    },
    required: ["amount_usd", "currency"],
    additionalProperties: false,
  };
  manual.currency = "USD";
  manual.settlement_mode = "embedded_wallet_charge";
  manual.refund_or_cancellation_note = "Refunds follow the merchant cancellation policy.";
  ((manual.output_schema as Record<string, unknown>).properties as Record<string, unknown>).amount_usd = {
    type: "number",
    description: "USD amount that was quoted or charged.",
  };
  ((manual.output_schema as Record<string, unknown>).properties as Record<string, unknown>).currency = {
    type: "string",
    description: "Currency code for the quote or charge.",
  };
  (manual.output_schema as Record<string, unknown>).required = ["summary", "offers", "amount_usd", "currency"];
  cases.push(["payment_good", manual]);

  manual = cloneBase();
  manual.trigger_conditions = ["short one", "tiny trigger", "brief"];
  cases.push(["short_triggers", manual]);

  manual = cloneBase();
  manual.trigger_conditions = [
    "Use when helpful for shopping tasks",
    "Use this tool as needed for many tasks",
    "If appropriate, use for productivity shopping support",
  ];
  cases.push(["vague_triggers", manual]);

  manual = cloneBase();
  manual.trigger_conditions = [
    "Ultimate price comparison for amazing shopping decisions",
    "Game-changing offer search for world-class bargain hunting",
    "Next-generation retailer scan for unbeatable deals",
  ];
  cases.push(["marketing_triggers", manual]);

  manual = cloneBase();
  manual.trigger_conditions = [
    "Use this tool to compare the latest retailer offers for the requested product",
    "Call this tool to gather seller price information for a named item",
    "Execute this tool to identify the best-value option for a purchase",
  ];
  cases.push(["imperative_triggers", manual]);

  manual = cloneBase();
  manual.trigger_conditions = (manual.trigger_conditions as unknown[]).slice(0, 2);
  cases.push(["too_few_triggers", manual]);

  manual = cloneBase();
  manual.do_not_use_when = ["compare prices for a product before deciding where to buy"];
  cases.push(["overlapping_do_not_use", manual]);

  manual = cloneBase();
  manual.do_not_use_when = ["skip"];
  cases.push(["short_do_not_use", manual]);

  manual = cloneBase();
  manual.summary_for_model = "Compares prices.";
  cases.push(["short_summary", manual]);

  manual = cloneBase();
  manual.summary_for_model = "Amazing revolutionary world-class price comparison assistant for unbeatable shopping.";
  cases.push(["marketing_summary", manual]);

  manual = cloneBase();
  const missingInputDescriptions = (manual.input_schema as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
  delete missingInputDescriptions.query!.description;
  delete missingInputDescriptions.max_price_usd!.description;
  cases.push(["missing_input_descriptions", manual]);

  manual = cloneBase();
  const shortInputDescriptions = (manual.input_schema as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
  shortInputDescriptions.query!.description = "Name";
  shortInputDescriptions.max_price_usd!.description = "Cap";
  cases.push(["short_input_descriptions", manual]);

  manual = cloneBase();
  ((manual.input_schema as Record<string, unknown>).properties as Record<string, unknown>).unit = {
    type: "string",
    description: "Preferred unit system for the returned offer metrics.",
    enum: ["a", "b", "c"],
  };
  cases.push(["trivial_enum_values", manual]);

  manual = cloneBase();
  const missingOutputDescriptions = (manual.output_schema as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
  delete missingOutputDescriptions.summary!.description;
  delete missingOutputDescriptions.offers!.description;
  cases.push(["missing_output_descriptions", manual]);

  manual = cloneBase();
  manual.usage_hints = [];
  manual.result_hints = [];
  cases.push(["empty_hints", manual]);

  manual = cloneBase();
  manual.usage_hints = ["brief"];
  manual.result_hints = ["tiny"];
  cases.push(["short_hints", manual]);

  manual = cloneBase();
  manual.job_to_be_done = "Do task";
  manual.summary_for_model = "Do thing";
  manual.trigger_conditions = ["when needed", "as needed", "if appropriate"];
  manual.usage_hints = ["use"];
  cases.push(["low_keyword_coverage", manual]);

  cases.push(["invalid_root", "not a dict"]);
  return cases;
}
