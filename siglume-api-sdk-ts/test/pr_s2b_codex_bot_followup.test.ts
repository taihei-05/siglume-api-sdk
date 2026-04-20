import { describe, expect, it } from "vitest";

import type { OperationExecution } from "../src/index";

describe("PR-S2b codex bot follow-up", () => {
  // ----- Q1: approval_required logical-OR (not ??) ----------------------

  it("honors approval_required when server returns false but status='approval_required'", async () => {
    // Simulate a server that partially rolled out the envelope: it
    // explicitly sends `approval_required: false` even when
    // `status === "approval_required"`. The SDK must still resolve
    // approval_required to true (matching Python's `bool(x or y)`).
    //
    // Build a minimal mock that exercises just the envelope parser
    // path via the public SDK surface.
    const { SiglumeClient } = await import("../src/index");
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
        if (url.endsWith("/me/agent")) {
          return new Response(
            JSON.stringify({
              data: { agent_id: "agt_x" },
              meta: { request_id: "req", trace_id: "trc" },
              error: null,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              agent_id: "agt_x",
              status: "approval_required",
              // Server explicitly says false even though status is
              // approval_required — SDK must promote to true.
              approval_required: false,
              intent_id: "cpi_abc",
              message: "pending approval",
              action: { operation: "market.proposals.create" },
              result: {},
            },
            meta: { request_id: "req", trace_id: "trc" },
            error: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const exec = await client.create_market_proposal({
      opportunity_id: "opp_1",
    });

    expect(exec.status).toBe("approval_required");
    expect(exec.approval_required).toBe(true);
    expect(exec.intent_id).toBe("cpi_abc");
  });

  // ----- Q3: OperationExecution new fields are optional ------------------

  it("accepts pre-v0.6 object literals as OperationExecution (new fields optional)", () => {
    // Type-level check: a consumer that only provides the original
    // fields must still type-check. If the new v0.6 fields were
    // required, this literal would fail `tsc --noEmit`.
    const legacy: OperationExecution = {
      agent_id: "agt_x",
      operation_key: "owner.charter.get",
      message: "Loaded charter.",
      action: "operation",
      result: { role: "hybrid" },
      raw: { ok: true },
    };
    expect(legacy.agent_id).toBe("agt_x");
    expect(legacy.status).toBeUndefined();
    expect(legacy.approval_required).toBeUndefined();
    expect(legacy.trace_id).toBeUndefined();
  });

  it("still accepts full v0.6 object literals as OperationExecution", () => {
    const full: OperationExecution = {
      agent_id: "agt_x",
      operation_key: "market.proposals.create",
      message: "pending",
      action: "operation",
      result: {},
      status: "approval_required",
      approval_required: true,
      intent_id: "cpi_abc",
      approval_status: null,
      approval_snapshot_hash: "abc123",
      action_payload: {},
      safety: {},
      trace_id: "trc",
      request_id: "req",
      raw: {},
    };
    expect(full.approval_required).toBe(true);
    expect(full.intent_id).toBe("cpi_abc");
  });
});
