import { describe, expect, it } from "vitest";

import {
  SiglumeClient,
  SiglumeNotFoundError,
  parse_cross_currency_quote,
  parse_embedded_wallet_charge,
  simulate_embedded_wallet_charge,
  simulate_polygon_mandate,
} from "../src/index";

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(String(input));
}

function envelope(data: unknown, meta: Record<string, unknown> = { request_id: "req_web3", trace_id: "trc_web3" }) {
  return { data, meta, error: null };
}

describe("web3 helpers", () => {
  it("lists and resolves polygon mandates", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        expect(url.pathname).toBe("/v1/market/web3/mandates");
        return new Response(JSON.stringify(envelope({
          items: [
            {
              mandate_id: "pmd_demo_123",
              payment_mandate_id: "pmd_demo_123",
              network: "polygon",
              payee_type: "platform",
              payee_ref: `0x${"2".repeat(40)}`,
              purpose: "subscription",
              cadence: "monthly",
              token_symbol: "JPYC",
              display_currency: "USD",
              max_amount_minor: 148000,
              status: "active",
              retry_count: 1,
              idempotency_key: "mand_demo_key",
              next_attempt_at: "2026-05-01T00:00:00Z",
              metadata_jsonb: {
                cancel_scheduled: true,
                cancel_queue_requested_at: "2026-04-21T00:00:00Z",
                onchain_mandate_id: 42,
              },
              transaction_request: { from_address: `0x${"1".repeat(40)}` },
            },
          ],
          next_cursor: null,
        })), { status: 200 });
      },
    });

    const mandates = await client.list_polygon_mandates({ limit: 10 });
    const mandate = await client.get_polygon_mandate("pmd_demo_123");

    expect(mandates).toHaveLength(1);
    expect(mandate.payer_wallet).toBe(`0x${"1".repeat(40)}`);
    expect(mandate.payee_wallet).toBe(`0x${"2".repeat(40)}`);
    expect(mandate.monthly_cap_minor).toBe(148000);
    expect(mandate.cancel_scheduled).toBe(true);
    expect(mandate.onchain_mandate_id).toBe(42);
  });

  it("resolves embedded wallet charges from settlement receipts", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        expect(url.pathname).toBe("/v1/market/web3/receipts");
        return new Response(JSON.stringify(envelope({
          items: [
            {
              receipt_id: "chr_demo_123",
              chain_receipt_id: "chr_demo_123",
              tx_hash: `0x${"a".repeat(64)}`,
              user_operation_hash: `0x${"b".repeat(64)}`,
              receipt_kind: "mandate_charge_submitted",
              tx_status: "confirmed",
              network: "polygon",
              chain_id: 137,
              block_number: 123456,
              confirmations: 12,
              finality_confirmations: 12,
              submitted_hash: `0x${"b".repeat(64)}`,
              payload_jsonb: {
                gross_amount_minor: 148000,
                platform_fee_minor: 800,
                token_symbol: "JPYC",
                gas_sponsored_by: "platform",
              },
              submitted_at: "2026-04-20T10:00:00Z",
              confirmed_at: "2026-04-20T10:00:15Z",
            },
          ],
          next_cursor: null,
        })), { status: 200 });
      },
    });

    const charge = await client.get_embedded_wallet_charge({ tx_hash: `0x${"b".repeat(64)}` });

    expect(charge.tx_hash).toBe(`0x${"a".repeat(64)}`);
    expect(charge.user_operation_hash).toBe(`0x${"b".repeat(64)}`);
    expect(charge.settlement_amount_minor).toBe(148000);
    expect(charge.platform_fee_minor).toBe(800);
    expect(charge.developer_net_minor).toBe(147200);
  });

  it("maps public swap quote responses to CrossCurrencyQuote", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input, init) => {
        const url = requestUrl(input);
        expect(url.pathname).toBe("/v1/market/web3/swap/quote");
        expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
          sell_token: "JPYC",
          buy_token: "USDC",
          amount_minor: 10000,
          slippage_bps: 100,
        });
        return new Response(JSON.stringify(envelope({
          network: "polygon",
          provider: "0x",
          sell_token: "JPYC",
          buy_token: "USDC",
          amount_minor: 10000,
          estimated_buy_minor: 9730,
          minimum_buy_minor: 9680,
          rate: 0.973,
          slippage_bps: 100,
          fee_minor: 30,
          fee_token: "USDC",
          price_impact_bps: 4,
          quote_expires_at: "2026-04-20T10:05:00Z",
          allowance_needed: false,
        })), { status: 200 });
      },
    });

    const quote = await client.get_cross_currency_quote({
      from_currency: "JPYC",
      to_currency: "USDC",
      source_amount_minor: 10000,
    });

    expect(quote.from_currency).toBe("JPYC");
    expect(quote.to_currency).toBe("USDC");
    expect(quote.venue).toBe("0x");
    expect(quote.quoted_amount_minor).toBe(9730);
    expect(quote.minimum_received_minor).toBe(9680);
  });

  it("keeps local simulation deterministic", () => {
    const mandate = simulate_polygon_mandate({
      mandate_id: "pmd_test_001",
      payer_wallet: `0x${"1".repeat(40)}`,
      payee_wallet: `0x${"2".repeat(40)}`,
      monthly_cap_minor: 148000,
      currency: "JPYC",
    });
    const charge = simulate_embedded_wallet_charge({
      mandate,
      amount_minor: 148000,
      tx_hash: `0x${"a".repeat(64)}`,
      user_operation_hash: `0x${"b".repeat(64)}`,
      platform_fee_minor: 800,
    });

    expect(mandate.currency).toBe("JPYC");
    expect(charge.tx_hash).toBe(`0x${"a".repeat(64)}`);
    expect(charge.developer_net_minor).toBe(147200);
    expect(charge.receipt?.reference_id).toBe("pmd_test_001");
  });

  it("honors explicit developer net overrides and falls back submitted hash to tx hash", () => {
    const mandate = simulate_polygon_mandate({
      mandate_id: "pmd_test_override",
      payer_wallet: `0x${"1".repeat(40)}`,
      payee_wallet: `0x${"2".repeat(40)}`,
      monthly_cap_minor: 148000,
      currency: "JPYC",
    });
    const charge = simulate_embedded_wallet_charge({
      mandate,
      amount_minor: 148000,
      tx_hash: `0x${"c".repeat(64)}`,
      developer_net_minor: 140000,
      platform_fee_minor: 800,
    });

    expect(charge.developer_net_minor).toBe(140000);
    expect(charge.receipt?.submitted_hash).toBe(`0x${"c".repeat(64)}`);
    expect(charge.raw.user_operation_hash).toBeNull();
  });

  it("raises not found when a mandate lookup misses", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response(JSON.stringify(envelope({ items: [], next_cursor: null })), { status: 200 }),
    });

    await expect(client.get_polygon_mandate("pmd_missing")).rejects.toBeInstanceOf(SiglumeNotFoundError);
  });

  it("follows next_cursor pages for mandate and receipt lookups", async () => {
    let mandateCalls = 0;
    let receiptCalls = 0;
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/web3/mandates") {
          mandateCalls += 1;
          if (url.searchParams.get("cursor") === "next_mandate") {
            return new Response(JSON.stringify(envelope({
              items: [
                {
                  mandate_id: "pmd_cursor_002",
                  payment_mandate_id: "pmd_cursor_002",
                  network: "polygon",
                  payee_type: "platform",
                  payee_ref: `0x${"2".repeat(40)}`,
                  purpose: "subscription",
                  cadence: "monthly",
                  token_symbol: "JPYC",
                  display_currency: "USD",
                  max_amount_minor: 148000,
                  status: "active",
                  retry_count: 0,
                  metadata_jsonb: {},
                },
              ],
              next_cursor: null,
            })), { status: 200 });
          }
          return new Response(JSON.stringify(envelope({ items: [], next_cursor: "next_mandate" })), { status: 200 });
        }
        if (url.pathname === "/v1/market/web3/receipts") {
          receiptCalls += 1;
          if (url.searchParams.get("cursor") === "next_receipt") {
            return new Response(JSON.stringify(envelope({
              items: [
                {
                  receipt_id: "chr_cursor_002",
                  chain_receipt_id: "chr_cursor_002",
                  tx_hash: `0x${"a".repeat(64)}`,
                  user_operation_hash: `0x${"b".repeat(64)}`,
                  receipt_kind: "mandate_charge_submitted",
                  tx_status: "confirmed",
                  network: "polygon",
                  chain_id: 137,
                  confirmations: 12,
                  finality_confirmations: 12,
                  payload_jsonb: {
                    gross_amount_minor: 148000,
                    platform_fee_minor: 800,
                    token_symbol: "JPYC",
                  },
                },
              ],
              next_cursor: null,
            })), { status: 200 });
          }
          return new Response(JSON.stringify(envelope({ items: [], next_cursor: "next_receipt" })), { status: 200 });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
    });

    const mandate = await client.get_polygon_mandate("pmd_cursor_002");
    const charge = await client.get_embedded_wallet_charge({ tx_hash: `0x${"b".repeat(64)}` });

    expect(mandate.mandate_id).toBe("pmd_cursor_002");
    expect(charge.receipt_id).toBe("chr_cursor_002");
    expect(charge.settlement_amount_minor).toBe(148000);
    expect(mandateCalls).toBe(2);
    expect(receiptCalls).toBe(2);
  });

  it("respects explicit search limits for web3 lookups", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/market/web3/mandates") {
          return new Response(JSON.stringify(envelope({ items: [], next_cursor: "next_mandate" })), { status: 200 });
        }
        if (url.pathname === "/v1/market/web3/receipts") {
          return new Response(JSON.stringify(envelope({ items: [], next_cursor: "next_receipt" })), { status: 200 });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
    });

    await expect(client.get_polygon_mandate("pmd_missing", { limit: 1 })).rejects.toBeInstanceOf(SiglumeNotFoundError);
    await expect(client.get_settlement_receipt("chr_missing", { limit: 1 })).rejects.toBeInstanceOf(SiglumeNotFoundError);
    await expect(client.get_embedded_wallet_charge({ tx_hash: `0x${"f".repeat(64)}`, limit: 1 })).rejects.toBeInstanceOf(SiglumeNotFoundError);
  });

  it("parses alias quote fields", () => {
    const quote = parse_cross_currency_quote({
      from_currency: "JPYC",
      to_currency: "USDC",
      quoted_amount_minor: 9730,
      source_amount_minor: 10000,
      rate: 0.973,
      venue: "mock-0x",
      expires_at_iso: "2026-04-20T10:05:00Z",
    });

    expect(quote.from_currency).toBe("JPYC");
    expect(quote.to_currency).toBe("USDC");
    expect(quote.venue).toBe("mock-0x");
  });

  it("rejects invalid cross-currency quote inputs before sending requests", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => {
        throw new Error("fetch should not be called for invalid quote inputs");
      },
    });

    await expect(client.get_cross_currency_quote({
      from_currency: "",
      to_currency: "USDC",
      source_amount_minor: 1,
    })).rejects.toThrow("from_currency is required");
    await expect(client.get_cross_currency_quote({
      from_currency: "JPYC",
      to_currency: "",
      source_amount_minor: 1,
    })).rejects.toThrow("to_currency is required");
    await expect(client.get_cross_currency_quote({
      from_currency: "JPYC",
      to_currency: "USDC",
      source_amount_minor: Number.NaN,
    })).rejects.toThrow("source_amount_minor must be a finite number");
    await expect(client.get_cross_currency_quote({
      from_currency: "JPYC",
      to_currency: "USDC",
      source_amount_minor: 0,
    })).rejects.toThrow("source_amount_minor must be positive");
  });

  it("treats malformed optional numeric fields as null", () => {
    const charge = parse_embedded_wallet_charge({
      tx_hash: `0x${"d".repeat(64)}`,
      receipt: {
        receipt_id: "chr_invalid_numbers",
        tx_hash: `0x${"d".repeat(64)}`,
        payload_jsonb: {
          gross_amount_minor: "not-a-number",
          platform_fee_minor: "still-not-a-number",
        },
      },
    });

    expect(charge.settlement_amount_minor).toBeNull();
    expect(charge.platform_fee_minor).toBeNull();
    expect(charge.developer_net_minor).toBeNull();
  });

  it("parses quote defaults and nested transaction requests", () => {
    const quote = parse_cross_currency_quote({
      sell_token: "JPYC",
      buy_token: "USDC",
      approve_transaction_request: { request_id: "req_approve" },
      swap_transaction_request: { request_id: "req_swap" },
    });

    expect(quote.source_amount_minor).toBe(0);
    expect(quote.quoted_amount_minor).toBe(0);
    expect(quote.approve_transaction_request).toEqual({ request_id: "req_approve" });
    expect(quote.swap_transaction_request).toEqual({ request_id: "req_swap" });
  });

  it("defaults simulated fee and gas sponsor when omitted", () => {
    const mandate = simulate_polygon_mandate({
      mandate_id: "pmd_test_defaults",
      payer_wallet: `0x${"1".repeat(40)}`,
      payee_wallet: `0x${"2".repeat(40)}`,
      monthly_cap_minor: 148000,
      currency: "JPYC",
    });
    const charge = simulate_embedded_wallet_charge({
      mandate,
      amount_minor: 148000,
      tx_hash: `0x${"e".repeat(64)}`,
    });

    expect(charge.platform_fee_minor).toBe(0);
    expect(charge.gas_sponsored_by).toBe("platform");
    expect(charge.receipt?.payload.gas_sponsored_by).toBe("platform");
  });

  it("matches charge tx_hash case-insensitively", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response(JSON.stringify(envelope({
        items: [{
          receipt_id: "chr_case_001",
          tx_hash: `0x${"a".repeat(64)}`,
          user_operation_hash: `0x${"b".repeat(64)}`,
          submitted_hash: `0x${"b".repeat(64)}`,
          receipt_kind: "mandate_charge_succeeded",
          tx_status: "confirmed",
          network: "polygon",
          chain_id: 137,
          payload_jsonb: { gross_amount_minor: 100, platform_fee_minor: 0, token_symbol: "USDC" },
        }],
        next_cursor: null,
      })), { status: 200 }),
    });

    const charge = await client.get_embedded_wallet_charge({ tx_hash: `0x${"A".repeat(64)}` });
    expect(charge.tx_hash).toBe(`0x${"a".repeat(64)}`);
  });

  it("accepts tool_execution_payment_submitted receipts as valid charges", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response(JSON.stringify(envelope({
        items: [{
          receipt_id: "chr_tool_001",
          tx_hash: `0x${"d".repeat(64)}`,
          receipt_kind: "tool_execution_payment_submitted",
          tx_status: "confirmed",
          network: "polygon",
          chain_id: 137,
          payload_jsonb: { gross_amount_minor: 50, platform_fee_minor: 0, token_symbol: "USDC" },
        }],
        next_cursor: null,
      })), { status: 200 }),
    });

    const charge = await client.get_embedded_wallet_charge({ tx_hash: `0x${"d".repeat(64)}` });
    expect(charge.tx_hash).toBe(`0x${"d".repeat(64)}`);
  });

  it("skips non-charge receipt_kind when looking up an embedded wallet charge", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response(JSON.stringify(envelope({
        items: [{
          receipt_id: "rcp_setup_001",
          tx_hash: `0x${"c".repeat(64)}`,
          receipt_kind: "mandate_create_submitted",
          tx_status: "confirmed",
          network: "polygon",
          chain_id: 137,
        }],
        next_cursor: null,
      })), { status: 200 }),
    });

    await expect(client.get_embedded_wallet_charge({ tx_hash: `0x${"c".repeat(64)}` }))
      .rejects.toBeInstanceOf(SiglumeNotFoundError);
  });

  it("rejects non-finite slippage_bps before sending the swap quote request", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => {
        throw new Error("fetch should not be called for invalid slippage_bps");
      },
    });

    await expect(client.get_cross_currency_quote({
      from_currency: "JPYC",
      to_currency: "USDC",
      source_amount_minor: 1000,
      slippage_bps: Number.NaN,
    })).rejects.toThrow("slippage_bps must be a finite number");
  });

  it("treats legacy cancel_queue_required as cancel_scheduled even when cancel_scheduled is false", async () => {
    const client = new SiglumeClient({
      api_key: "sig_test_key",
      base_url: "https://api.example.test/v1",
      fetch: async () => new Response(JSON.stringify(envelope({
        items: [{
          mandate_id: "pmd_legacy_cancel",
          payment_mandate_id: "pmd_legacy_cancel",
          network: "polygon",
          payee_type: "platform",
          payee_ref: `0x${"2".repeat(40)}`,
          purpose: "subscription",
          cadence: "monthly",
          token_symbol: "JPYC",
          max_amount_minor: 148000,
          status: "active",
          metadata_jsonb: {
            cancel_scheduled: false,
            cancel_queue_required: true,
          },
        }],
        next_cursor: null,
      })), { status: 200 }),
    });

    const mandate = await client.get_polygon_mandate("pmd_legacy_cancel");
    expect(mandate.cancel_scheduled).toBe(true);
  });
});
