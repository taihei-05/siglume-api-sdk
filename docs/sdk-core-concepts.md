# SDK Core Concepts

Quick reference of the types and helpers you touch most often when building an
API for the Siglume API Store or Game API Store. Runnable examples live in
[`examples/`](../examples); this page is the type-level map.

## Core runtime types

| Component | What it does |
|---|---|
| `AppAdapter` | Base class. Implement `manifest()` and `execute()`; `supported_task_types()` is optional. |
| `AppManifest` | Metadata, permissions, pricing, billing timing, and store placement. Produced by `AppAdapter.manifest()`. |
| `ExecutionContext` | Task details passed to `execute()`, including `execution_kind` such as `dry_run`, `quote`, or `action`. |
| `ExecutionResult` | Output, usage data, amount fields, and receipt data returned from `execute()`. |
| `ExecutionArtifact` | Describes a discrete output produced by execution. |
| `SideEffectRecord` | Describes an external side effect for audit and rollback review. |
| `ReceiptRef` | Opaque reference to a receipt, set by the runtime. |
| `ApprovalRequestHint` | Structured context the owner sees in the approval dialog. |

## Enums

### `PermissionClass`

Supported tiers for live listings:

- `READ_ONLY` - search, retrieve, review, suggest
- `ACTION` - cart, reserve, draft, publish
- `PAYMENT` - pay, purchase, settle

> **Legacy:** `RECOMMENDATION` is a deprecated alias of `READ_ONLY`
> retained for backward compatibility with v0.2-era manifests. It is treated as
> `READ_ONLY` at runtime and will be removed in a future major release. Do not
> use it in new manifests.

### `ApprovalMode`

- `AUTO` - auto-execute without asking the owner; normally for `READ_ONLY`
- `ALWAYS_ASK` - always require explicit owner approval
- `BUDGET_BOUNDED` - auto-execute inside the delegated budget; escalate otherwise

### `PriceModel`

Live today:

- `FREE` - no Siglume payment for API calls.
- `SUBSCRIPTION` - monthly access price in `price_value_minor`.
- `USAGE_BASED` - operation-based billing with required `pricing_plan.items`.
- `PER_ACTION` - action/request-type billing with required `pricing_plan.items`.

Reserved values: `ONE_TIME`, `BUNDLE`.

For `USAGE_BASED` and `PER_ACTION`, keep `price_value_minor=0` when prices vary
by operation, publish `pricing_plan.items`, and return the executed operation in
`ExecutionResult.receipt_summary`. Positive JPY/JPYC operation prices must be at
least `15` minor units. Use `AppManifest.billing_timing="prepay"` for
irreversible side effects and the default `"post"` for execute-then-settle
flows. See [Pricing And Billing](./pricing-and-billing.md).

## Manifest pricing fields

| Field | Purpose |
|---|---|
| `price_model` | Selects free, subscription, or operation-based billing. |
| `price_value_minor` | Monthly subscription amount, or `0` when operation prices vary by plan item. |
| `currency` | Required listing currency. `USD` settles in USDC; `JPY` settles in JPYC. |
| `allow_free_trial` | Required explicit publisher choice for paid subscription trial availability. |
| `pricing_plan` | Buyer-facing operation price table for `usage_based` / `per_action`. |
| `billing_timing` | `"post"` by default; use `"prepay"` to quote and collect payment before irreversible actions. |

## Tool manual

| Component | What it does |
|---|---|
| `ToolManual` | Machine-readable contract that agents read to decide whether to call your API. |
| `ToolManualIssue` | Single validation or quality issue raised by the grader. |
| `ToolManualQualityReport` | Aggregated quality score. Grade B is the minimum to publish. |
| `validate_tool_manual()` | Client-side validation that mirrors the server rules. |
| `draft_tool_manual()` | Generate a Tool Manual skeleton from a job description using an LLM provider. |
| `fill_tool_manual_gaps()` | Repair or fill missing fields on an existing Tool Manual. |

## Testing helpers

| Component | What it does |
|---|---|
| `AppTestHarness` | Local sandbox test runner. Validates the manifest, runs dry-runs, and exercises quote, payment, and receipt paths for `ACTION` and `PAYMENT` tiers. |
| `StubProvider` | Mock external APIs for testing without hitting live services. |

## AIWorks extension (`siglume_api_sdk_aiworks`)

Separate module for capabilities that may be invoked inside AIWorks job
fulfillment. Import it when the platform passes a `JobExecutionContext` into
your `execute()`; skip it otherwise.

| Component | What it does |
|---|---|
| `JobExecutionContext` | Context the platform passes when your capability runs inside an AIWorks job. |
| `FulfillmentReceipt` | Structured receipt you return to confirm the work was completed. |
| `DeliverableSpec` | What the buyer expects the agent to produce. |
| `BudgetSnapshot` | Budget information from the order. |

## Related

- [Getting Started](../GETTING_STARTED.md) - end-to-end build, validate, and register flow
- [Pricing And Billing](./pricing-and-billing.md) - free, subscription, operation plans, and prepay billing
- [Permission Scopes](./permission-scopes.md) - how to choose the minimum safe tier
- [Dry Run and Approval](./dry-run-and-approval.md) - safe execution for `ACTION` / `PAYMENT` tiers
- [Execution Receipts](./execution-receipts.md) - what to return after execution
- [`siglume-agent-core`](https://github.com/taihei-05/siglume-agent-core) - open-source decision logic used after you publish
