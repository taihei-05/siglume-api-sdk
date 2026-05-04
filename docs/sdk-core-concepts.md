# SDK Core Concepts

Quick reference of the types and helpers you touch most often when
building an API for the Siglume API Store. Runnable examples live in
[`examples/`](../examples); this page is the type-level map.

## Core runtime types

| Component | What it does |
|---|---|
| `AppAdapter` | Base class. Implement `manifest()` and `execute()` (required); `supported_task_types()` is optional. |
| `AppManifest` | Metadata, permissions, pricing. Produced by `AppAdapter.manifest()`. |
| `ExecutionContext` | Task details passed to `execute()`. |
| `ExecutionResult` | Output and usage data returned from `execute()`. |
| `ExecutionArtifact` | Describes a discrete output produced by execution. |
| `SideEffectRecord` | Describes an external side effect for audit and rollback review. |
| `ReceiptRef` | Opaque reference to a receipt (set by runtime). |
| `ApprovalRequestHint` | Structured context the owner sees in the approval dialog. |

## Enums

### `PermissionClass`

Supported tiers for live listings:

- `READ_ONLY` — search, retrieve, review, suggest
- `ACTION` — cart, reserve, draft, publish
- `PAYMENT` — pay, purchase, settle

> **Legacy:** `RECOMMENDATION` is a deprecated alias of `READ_ONLY`
> retained for backward compatibility with v0.2-era manifests. It is
> treated as `READ_ONLY` at runtime and will be removed in a future
> major release. **Do not use it in new manifests.** The parallel
> `ToolManualPermissionClass` enum has never accepted
> `RECOMMENDATION`.

### `ApprovalMode`

- `AUTO` — auto-execute without asking the owner (allowed for `READ_ONLY`)
- `ALWAYS_ASK` — always require an explicit owner approval
- `BUDGET_BOUNDED` — auto-execute while inside the delegated budget; escalate otherwise

### `PriceModel`

Live today: `FREE`, `SUBSCRIPTION`.

Reserved for future phases (not accepted by the platform at registration
time): `ONE_TIME`, `BUNDLE`, `USAGE_BASED`, `PER_ACTION`.

## Tool manual

| Component | What it does |
|---|---|
| `ToolManual` | Machine-readable contract that agents read to decide whether to call your API. |
| `ToolManualIssue` | Single validation or quality issue (raised by the grader). |
| `ToolManualQualityReport` | Aggregated quality score (0–100 / grade A–F). Grade B is the minimum to publish. The same scorer is also published as the open-source [`siglume-agent-core.tool_manual_validator`](https://github.com/taihei-05/siglume-agent-core#1-tool_manual_validator-v01) — install it locally to predict your grade before submission. |
| `validate_tool_manual()` | Client-side validation that mirrors the server rules. |
| `draft_tool_manual()` | Generate a ToolManual skeleton from a job description using an LLM provider. |
| `fill_tool_manual_gaps()` | Repair / fill missing fields on an existing ToolManual. |

## Testing helpers

| Component | What it does |
|---|---|
| `AppTestHarness` | Local sandbox test runner. Validates the manifest, runs dry-runs, exercises quote / payment / receipt paths for `ACTION` and `PAYMENT` tiers. |
| `StubProvider` | Mock external APIs for testing without hitting live services. |

## AIWorks extension (`siglume_api_sdk_aiworks`)

Separate module for capabilities that may be invoked inside AIWorks job
fulfillment. Import it when the platform passes a `JobExecutionContext`
into your `execute()`; skip it otherwise.

| Component | What it does |
|---|---|
| `JobExecutionContext` | Context the platform passes when your capability runs inside an AIWorks job. |
| `FulfillmentReceipt` | Structured receipt you return to confirm the work was completed. |
| `DeliverableSpec` | What the buyer expects the agent to produce. |
| `BudgetSnapshot` | Budget information from the order. |

## Related

- [Getting Started](../GETTING_STARTED.md) — end-to-end build / validate / register flow
- [Permission Scopes](./permission-scopes.md) — how to choose the minimum safe tier
- [Dry Run and Approval](./dry-run-and-approval.md) — safe execution for `ACTION` / `PAYMENT` tiers
- [Execution Receipts](./execution-receipts.md) — what to return after execution
- **[`siglume-agent-core`](https://github.com/taihei-05/siglume-agent-core)** — the open-source decision logic that runs *after* you publish: the same Tool Manual scorer, the tool-selection function (`tool_selector`), the LLM tool-use orchestrate loop, the per-tool failure-learning rules, and the publisher dev simulator (`dev_simulator`) for pre-publish dry runs. AGPL-3.0; same code path as production.
