export const DEFAULT_OPERATION_AGENT_ID = "agt_owner_demo";

export interface OperationMetadata {
  operation_key: string;
  summary: string;
  params_summary: string;
  page_href?: string | null;
  allowed_params: string[];
  required_params: string[];
  requires_params: boolean;
  param_types: Record<string, string>;
  permission_class: string;
  approval_mode: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  agent_id?: string | null;
  source: string;
  raw: Record<string, unknown>;
}

export interface OperationExecution {
  agent_id: string;
  operation_key: string;
  message: string;
  action: string;
  result: Record<string, unknown>;
  // Fields below are v0.6 additions for the owner-operation execute
  // envelope. They are declared optional so that downstream consumers
  // with existing object literals or mocks (conforming to the pre-v0.6
  // shape) continue to type-check without having to pre-populate every
  // new field. SDK-internal factories still always set them; optional
  // is for external surface compatibility only.
  status?: string;
  approval_required?: boolean;
  intent_id?: string | null;
  approval_status?: string | null;
  approval_snapshot_hash?: string | null;
  action_payload?: Record<string, unknown>;
  safety?: Record<string, unknown>;
  trace_id?: string | null;
  request_id?: string | null;
  raw: Record<string, unknown>;
}

export function defaultOperationOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One-line summary of the first-party operation result.",
      },
      action: {
        type: "string",
        description: "Structured action label returned by Siglume.",
      },
      result: {
        type: "object",
        description: "Raw first-party operation payload returned by Siglume.",
      },
    },
    required: ["summary", "action", "result"],
    additionalProperties: false,
  };
}

const KNOWN_OPERATION_OVERRIDES: Record<string, Record<string, unknown>> = {
  "owner.charter.get": {
    summary: "Read the current owner charter.",
    params_summary: "No parameters.",
    page_href: "/owner/charters",
    allowed_params: [],
    required_params: [],
    requires_params: false,
    permission_class: "read-only",
    approval_mode: "auto",
    input_schema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Owned agent to target. Defaults to the agent used during template generation.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  "owner.charter.update": {
    summary: "Update the owner charter.",
    params_summary:
      "Supports partial updates for role, goals, target_profile, qualification_criteria, success_metrics, and constraints.",
    page_href: "/owner/charters",
    allowed_params: ["role", "goals", "target_profile", "qualification_criteria", "success_metrics", "constraints"],
    required_params: ["goals"],
    requires_params: true,
    param_types: {
      role: "string",
      goals: "dict",
      target_profile: "dict",
      qualification_criteria: "dict",
      success_metrics: "dict",
      constraints: "dict",
    },
    permission_class: "action",
    approval_mode: "always-ask",
    input_schema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Owned agent to target. Defaults to the agent used during template generation.",
        },
        role: {
          type: "string",
          description: "Updated owner role label, such as buyer or researcher.",
          default: "buyer",
        },
        goals: {
          type: "object",
          description: "Updated charter goals payload.",
          properties: {
            charter_text: {
              type: "string",
              description: "Human-readable charter text to store in the owner charter.",
              default: "Prefer explicit approvals for unusual purchases.",
            },
          },
          required: ["charter_text"],
          additionalProperties: true,
        },
        target_profile: {
          type: "object",
          description: "Optional target-profile constraints for the agent.",
          default: {},
        },
        qualification_criteria: {
          type: "object",
          description: "Optional qualification criteria for tasks the agent may accept.",
          default: {},
        },
        success_metrics: {
          type: "object",
          description: "Optional success metrics, such as approval_rate_floor.",
          default: { approval_rate_floor: 0.8 },
        },
        constraints: {
          type: "object",
          description: "Optional constraint payload applied to the charter.",
          default: {},
        },
      },
      required: ["goals"],
      additionalProperties: false,
    },
  },
  "owner.approval_policy.get": {
    summary: "Read the current owner approval policy.",
    params_summary: "No parameters.",
    page_href: "/owner/policies",
    allowed_params: [],
    required_params: [],
    requires_params: false,
    permission_class: "read-only",
    approval_mode: "auto",
    input_schema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Owned agent to target. Defaults to the agent used during template generation.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  "owner.approval_policy.update": {
    summary: "Update the owner approval policy.",
    params_summary:
      "Supports partial updates for auto_approve_below, always_require_approval_for, deny_if, approval_ttl_minutes, structured_only, merchant_allowlist, merchant_denylist, category_allowlist, category_denylist, and risk_policy.",
    page_href: "/owner/policies",
    allowed_params: [
      "auto_approve_below",
      "always_require_approval_for",
      "deny_if",
      "approval_ttl_minutes",
      "structured_only",
      "merchant_allowlist",
      "merchant_denylist",
      "category_allowlist",
      "category_denylist",
      "risk_policy",
    ],
    required_params: ["auto_approve_below"],
    requires_params: true,
    param_types: {
      auto_approve_below: "dict_int",
      always_require_approval_for: "list_str",
      deny_if: "dict",
      approval_ttl_minutes: "int",
      structured_only: "bool",
      merchant_allowlist: "list_str",
      merchant_denylist: "list_str",
      category_allowlist: "list_str",
      category_denylist: "list_str",
      risk_policy: "dict",
    },
    permission_class: "action",
    approval_mode: "always-ask",
    input_schema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Owned agent to target. Defaults to the agent used during template generation.",
        },
        auto_approve_below: {
          type: "object",
          description: "Currency-to-threshold map for auto-approved actions in minor units.",
          default: { JPY: 3000 },
          additionalProperties: { type: "integer" },
        },
        always_require_approval_for: {
          type: "array",
          description: "Scopes that should always require approval.",
          items: { type: "string" },
          default: ["travel.booking"],
        },
        deny_if: {
          type: "object",
          description: "Risk filters that should deny execution.",
          default: {},
        },
        approval_ttl_minutes: {
          type: "integer",
          description: "Approval request time-to-live in minutes.",
          default: 720,
        },
        structured_only: {
          type: "boolean",
          description: "Require machine-structured action requests before approval.",
          default: true,
        },
        merchant_allowlist: {
          type: "array",
          items: { type: "string" },
          default: [],
        },
        merchant_denylist: {
          type: "array",
          items: { type: "string" },
          default: [],
        },
        category_allowlist: {
          type: "array",
          items: { type: "string" },
          default: [],
        },
        category_denylist: {
          type: "array",
          items: { type: "string" },
          default: [],
        },
        risk_policy: {
          type: "object",
          description: "Structured risk-policy payload.",
          default: {},
        },
      },
      required: ["auto_approve_below"],
      additionalProperties: false,
    },
  },
  "owner.budget.get": {
    summary: "Read the current delegated budget.",
    params_summary: "Optional currency parameter.",
    page_href: "/owner/budgets",
    allowed_params: ["currency"],
    required_params: [],
    requires_params: false,
    param_types: { currency: "string" },
    permission_class: "read-only",
    approval_mode: "auto",
    input_schema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Owned agent to target. Defaults to the agent used during template generation.",
        },
        currency: {
          type: "string",
          description: "Optional currency filter for the delegated-budget snapshot.",
          default: "JPY",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  "owner.budget.update": {
    summary: "Update the delegated budget.",
    params_summary:
      "Supports partial updates for currency, period_limit_minor, per_order_limit_minor, auto_approve_below_minor, period_start, period_end, limits, and metadata.",
    page_href: "/owner/budgets",
    allowed_params: [
      "currency",
      "period_start",
      "period_end",
      "period_limit_minor",
      "per_order_limit_minor",
      "auto_approve_below_minor",
      "limits",
      "metadata",
    ],
    required_params: ["period_limit_minor"],
    requires_params: true,
    param_types: {
      currency: "string",
      period_start: "string",
      period_end: "string",
      period_limit_minor: "int",
      per_order_limit_minor: "int",
      auto_approve_below_minor: "int",
      limits: "dict",
      metadata: "dict",
    },
    permission_class: "action",
    approval_mode: "always-ask",
    input_schema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Owned agent to target. Defaults to the agent used during template generation.",
        },
        currency: {
          type: "string",
          description: "Budget currency code.",
          default: "JPY",
        },
        period_start: {
          type: "string",
          description: "Optional RFC3339 start time for the budget window.",
          default: "2026-04-01T00:00:00Z",
        },
        period_end: {
          type: "string",
          description: "Optional RFC3339 end time for the budget window.",
          default: "2026-05-01T00:00:00Z",
        },
        period_limit_minor: {
          type: "integer",
          description: "Maximum delegated spend for the budget period in minor units.",
          default: 50000,
        },
        per_order_limit_minor: {
          type: "integer",
          description: "Maximum delegated spend per order in minor units.",
          default: 12000,
        },
        auto_approve_below_minor: {
          type: "integer",
          description: "Auto-approve threshold in minor units.",
          default: 3000,
        },
        limits: {
          type: "object",
          description: "Optional nested budget limits payload.",
          default: {},
        },
        metadata: {
          type: "object",
          description: "Optional metadata persisted with the delegated budget.",
          default: { source: "siglume_init" },
        },
      },
      required: ["period_limit_minor"],
      additionalProperties: false,
    },
  },
  "market.proposals.list": {
    summary: "List market proposals visible to the owner.",
    params_summary:
      "Supports filtering by status, opportunity_id, listing_id, need_id, seller_agent_id, buyer_agent_id, cursor, and limit.",
    page_href: "/owner/market/proposals",
    allowed_params: [
      "status",
      "opportunity_id",
      "listing_id",
      "need_id",
      "seller_agent_id",
      "buyer_agent_id",
      "cursor",
      "limit",
    ],
    required_params: [],
    requires_params: false,
    param_types: {
      status: "string",
      opportunity_id: "string",
      listing_id: "string",
      need_id: "string",
      seller_agent_id: "string",
      buyer_agent_id: "string",
      cursor: "string",
      limit: "int",
    },
    permission_class: "read-only",
    approval_mode: "auto",
  },
  "market.proposals.get": {
    summary: "Load one market proposal by id.",
    params_summary: "Requires proposal_id.",
    page_href: "/owner/market/proposals",
    allowed_params: ["proposal_id"],
    required_params: ["proposal_id"],
    requires_params: true,
    param_types: { proposal_id: "string" },
    permission_class: "read-only",
    approval_mode: "auto",
  },
  "market.proposals.create": {
    summary: "Stage a new market proposal for owner approval.",
    params_summary:
      "Requires opportunity_id and accepts optional proposal_kind, currency, amount_minor, proposed_terms_jsonb, publish_to_thread, thread_content_id, reply_to_content_id, note_title, note_summary, note_body, note_visibility, note_content_kind, and expires_at.",
    page_href: "/owner/market/proposals",
    allowed_params: [
      "opportunity_id",
      "proposal_kind",
      "currency",
      "amount_minor",
      "proposed_terms_jsonb",
      "publish_to_thread",
      "thread_content_id",
      "reply_to_content_id",
      "note_title",
      "note_summary",
      "note_body",
      "note_visibility",
      "note_content_kind",
      "expires_at",
    ],
    required_params: ["opportunity_id"],
    requires_params: true,
    param_types: {
      opportunity_id: "string",
      proposal_kind: "string",
      currency: "string",
      amount_minor: "int",
      proposed_terms_jsonb: "dict",
      publish_to_thread: "bool",
      thread_content_id: "string",
      reply_to_content_id: "string",
      note_title: "string",
      note_summary: "string",
      note_body: "string",
      note_visibility: "string",
      note_content_kind: "string",
      expires_at: "string",
    },
    permission_class: "action",
    approval_mode: "always-ask",
  },
  "market.proposals.counter": {
    summary: "Stage a counter proposal for owner approval.",
    params_summary:
      "Requires proposal_id and accepts optional proposal_kind, proposed_terms_jsonb, publish_to_thread, thread_content_id, reply_to_content_id, note_title, note_summary, note_body, note_visibility, note_content_kind, and expires_at.",
    page_href: "/owner/market/proposals",
    allowed_params: [
      "proposal_id",
      "proposal_kind",
      "proposed_terms_jsonb",
      "publish_to_thread",
      "thread_content_id",
      "reply_to_content_id",
      "note_title",
      "note_summary",
      "note_body",
      "note_visibility",
      "note_content_kind",
      "expires_at",
    ],
    required_params: ["proposal_id"],
    requires_params: true,
    param_types: {
      proposal_id: "string",
      proposal_kind: "string",
      proposed_terms_jsonb: "dict",
      publish_to_thread: "bool",
      thread_content_id: "string",
      reply_to_content_id: "string",
      note_title: "string",
      note_summary: "string",
      note_body: "string",
      note_visibility: "string",
      note_content_kind: "string",
      expires_at: "string",
    },
    permission_class: "action",
    approval_mode: "always-ask",
  },
  "market.proposals.accept": {
    summary: "Stage proposal acceptance for owner approval.",
    params_summary:
      "Requires proposal_id and accepts optional comment, publish_to_thread, thread_content_id, reply_to_content_id, note_title, note_summary, note_visibility, and note_content_kind.",
    page_href: "/owner/market/proposals",
    allowed_params: [
      "proposal_id",
      "comment",
      "publish_to_thread",
      "thread_content_id",
      "reply_to_content_id",
      "note_title",
      "note_summary",
      "note_visibility",
      "note_content_kind",
    ],
    required_params: ["proposal_id"],
    requires_params: true,
    param_types: {
      proposal_id: "string",
      comment: "string",
      publish_to_thread: "bool",
      thread_content_id: "string",
      reply_to_content_id: "string",
      note_title: "string",
      note_summary: "string",
      note_visibility: "string",
      note_content_kind: "string",
    },
    permission_class: "action",
    approval_mode: "always-ask",
  },
  "market.proposals.reject": {
    summary: "Stage proposal rejection for owner approval.",
    params_summary: "Requires proposal_id and accepts optional comment.",
    page_href: "/owner/market/proposals",
    allowed_params: ["proposal_id", "comment"],
    required_params: ["proposal_id"],
    requires_params: true,
    param_types: {
      proposal_id: "string",
      comment: "string",
    },
    permission_class: "action",
    approval_mode: "always-ask",
  },
};

function stringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter((item) => item.length > 0) : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value as Record<string, unknown>)
    : {};
}

function inferPermissionClass(operation_key: string): string {
  const lowered = stringValue(operation_key).toLowerCase();
  if ([
    ".update",
    ".create",
    ".delete",
    ".execute",
    ".issue",
    ".respond",
    ".bind",
    ".pause",
    ".resume",
    ".cancel",
    ".counter",
    ".accept",
    ".reject",
    ".publish",
    ".delist",
  ].some((token) => lowered.includes(token))) {
    return "action";
  }
  if (["payment", "mandate", "charge", "swap", "refund"].some((token) => lowered.includes(token))) {
    return "payment";
  }
  return "read-only";
}

function approvalModeFor(permission_class: string): string {
  return permission_class === "action" || permission_class === "payment" ? "always-ask" : "auto";
}

function inferParamType(name: string): string {
  const normalized = stringValue(name).toLowerCase();
  if (normalized === "structured_only") {
    return "bool";
  }
  if (["limit", "approval_ttl_minutes", "period_limit_minor", "per_order_limit_minor", "auto_approve_below_minor"].includes(normalized)) {
    return "int";
  }
  if (normalized.endsWith("_minor") || normalized.endsWith("_minutes") || normalized.endsWith("_seconds")) {
    return "int";
  }
  if ([
    "goals",
    "target_profile",
    "qualification_criteria",
    "success_metrics",
    "constraints",
    "deny_if",
    "risk_policy",
    "limits",
    "metadata",
    "payload",
    "projection",
  ].includes(normalized)) {
    return "dict";
  }
  if ([
    "always_require_approval_for",
    "merchant_allowlist",
    "merchant_denylist",
    "category_allowlist",
    "category_denylist",
    "required_connected_accounts",
  ].includes(normalized)) {
    return "list_str";
  }
  if (normalized.startsWith("include_")) {
    return "bool";
  }
  if (normalized === "auto_approve_below") {
    return "dict_int";
  }
  return "string";
}

function propertySchemaFor(name: string, paramType: string): Record<string, unknown> {
  const title = name.replaceAll("_", " ");
  if (paramType === "int") {
    return { type: "integer", description: `Operation parameter ${title}.` };
  }
  if (paramType === "bool") {
    return { type: "boolean", description: `Operation parameter ${title}.` };
  }
  if (paramType === "dict") {
    return { type: "object", description: `Operation parameter ${title}.`, default: {} };
  }
  if (paramType === "dict_int") {
    return {
      type: "object",
      description: `Operation parameter ${title}.`,
      default: {},
      additionalProperties: { type: "integer" },
    };
  }
  if (paramType === "list_str") {
    return {
      type: "array",
      description: `Operation parameter ${title}.`,
      items: { type: "string" },
      default: [],
    };
  }
  return { type: "string", description: `Operation parameter ${title}.` };
}

function buildInputSchema(
  agent_id: string | null,
  allowed_params: string[],
  required_params: string[],
  requires_params: boolean,
  param_types: Record<string, string>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    agent_id: {
      type: "string",
      description: "Owned agent to target. Defaults to the agent used during template generation.",
      ...(agent_id ? { default: agent_id } : {}),
    },
  };
  for (const name of allowed_params) {
    properties[name] = propertySchemaFor(name, param_types[name] ?? inferParamType(name));
  }
  let normalizedRequired = required_params.filter((name) => name in properties && name !== "agent_id");
  if (requires_params && normalizedRequired.length === 0) {
    const firstParam = allowed_params.find((name) => name in properties);
    if (firstParam) {
      normalizedRequired = [firstParam];
    }
  }
  return {
    type: "object",
    properties,
    required: normalizedRequired,
    additionalProperties: false,
  };
}

function defaultSummaryFor(operation_key: string): string {
  const normalized = stringValue(operation_key);
  if (normalized.endsWith(".get")) {
    return `Read ${normalized}.`;
  }
  if (normalized.endsWith(".list")) {
    return `List ${normalized}.`;
  }
  return `Run the ${normalized} first-party owner operation.`;
}

export function defaultCapabilityKeyForOperation(operation_key: string): string {
  return `my-${stringValue(operation_key).replaceAll(".", "-").replaceAll("_", "-")}-wrapper`;
}

export function fallbackOperationCatalog(agent_id?: string | null): OperationMetadata[] {
  const resolvedAgentId = stringValue(agent_id) || DEFAULT_OPERATION_AGENT_ID;
  return Object.keys(KNOWN_OPERATION_OVERRIDES)
    .sort()
    .map((operation_key) => buildOperationMetadata({ name: operation_key }, { agent_id: resolvedAgentId, source: "fallback" }));
}

export function buildOperationMetadata(
  payload: Record<string, unknown>,
  options: { agent_id?: string | null; source?: string } = {},
): OperationMetadata {
  const raw = { ...payload };
  const operation_key = stringValue(raw.operation_key ?? raw.name);
  if (!operation_key) {
    throw new Error("operation_key is required");
  }
  const override = KNOWN_OPERATION_OVERRIDES[operation_key] ?? {};
  const summary = stringValue(raw.summary) || stringValue(override.summary) || defaultSummaryFor(operation_key);
  const params_summary = stringValue(raw.params_summary ?? raw.params) || stringValue(override.params_summary);
  const allowed_params = stringList(raw.allowed_params).length > 0 ? stringList(raw.allowed_params) : stringList(override.allowed_params);
  const required_params = stringList(raw.required_params).length > 0 ? stringList(raw.required_params) : stringList(override.required_params);
  const requires_params = Boolean(raw.requires_params ?? override.requires_params);
  const param_types_source = Object.keys(recordValue(raw.param_types)).length > 0 ? recordValue(raw.param_types) : recordValue(override.param_types);
  const param_types: Record<string, string> = {};
  for (const [key, value] of Object.entries(param_types_source)) {
    const normalizedKey = String(key);
    const normalizedValue = stringValue(value);
    if (normalizedKey.length > 0 && normalizedValue.length > 0) {
      param_types[normalizedKey] = normalizedValue;
    }
  }
  const resolvedAgentId = stringValue(options.agent_id ?? raw.agent_id) || null;
  const permission_class = stringValue(raw.permission_class) || stringValue(override.permission_class) || inferPermissionClass(operation_key);
  const approval_mode = stringValue(raw.approval_mode) || stringValue(override.approval_mode) || approvalModeFor(permission_class);
  const input_schema = Object.keys(recordValue(raw.input_schema)).length > 0
    ? recordValue(raw.input_schema)
    : Object.keys(recordValue(override.input_schema)).length > 0
      ? recordValue(override.input_schema)
      : buildInputSchema(resolvedAgentId, allowed_params, required_params, requires_params, param_types);
  if (input_schema.properties && typeof input_schema.properties === "object" && !Array.isArray(input_schema.properties)) {
    const properties = input_schema.properties as Record<string, unknown>;
    const agentSchema = properties.agent_id;
    if (resolvedAgentId && agentSchema && typeof agentSchema === "object" && !Array.isArray(agentSchema)) {
      (agentSchema as Record<string, unknown>).default ??= resolvedAgentId;
    }
  }
  const output_schema = Object.keys(recordValue(raw.output_schema)).length > 0
    ? recordValue(raw.output_schema)
    : Object.keys(recordValue(override.output_schema)).length > 0
      ? recordValue(override.output_schema)
      : defaultOperationOutputSchema();
  return {
    operation_key,
    summary,
    params_summary,
    page_href: stringValue(raw.page_href) || stringValue(override.page_href) || null,
    allowed_params,
    required_params,
    requires_params,
    param_types,
    permission_class,
    approval_mode,
    input_schema,
    output_schema,
    agent_id: resolvedAgentId,
    source: options.source ?? "live",
    raw,
  };
}
