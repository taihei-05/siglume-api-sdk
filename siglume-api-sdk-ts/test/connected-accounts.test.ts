import { describe, expect, it } from "vitest";

import { SiglumeClient } from "../src/index";

function buildClient(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return new SiglumeClient({
    api_key: "sig_test",
    base_url: "https://api.example.test/v1",
    fetch: handler,
  });
}

function envelope(data: unknown) {
  return { data, meta: { request_id: "req", trace_id: "trc" }, error: null };
}

describe("Connected accounts SDK wrap (v0.7 track 3)", () => {
  it("lists providers from the registry endpoint", async () => {
    const calls: string[] = [];
    const client = buildClient(async (input) => {
      const url = new URL(String(typeof input === "string" ? input : input instanceof URL ? input : input.url));
      calls.push(url.pathname);
      return new Response(
        JSON.stringify(
          envelope({
            items: [
              {
                provider_key: "slack",
                display_name: "Slack",
                auth_type: "oauth2",
                refresh_supported: true,
                pkce_required: false,
                default_scopes: ["chat:write"],
                available_scopes: ["chat:write", "channels:read"],
                scope_separator: ",",
              },
            ],
          }),
        ),
        { status: 200 },
      );
    });
    const providers = await client.list_connected_account_providers();
    client.close();
    expect(calls[0]).toBe("/v1/me/connected-accounts/providers");
    expect(providers).toHaveLength(1);
    expect(providers[0].provider_key).toBe("slack");
    expect(providers[0].refresh_supported).toBe(true);
  });

  it("starts OAuth and never sends client_secret in the body", async () => {
    let capturedBody: Record<string, unknown> = {};
    const client = buildClient(async (input, init) => {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : {};
      return new Response(
        JSON.stringify(
          envelope({
            authorize_url: "https://slack.com/oauth/v2/authorize?...",
            state: "s-abc",
            provider_key: "slack",
            scopes: ["chat:write"],
            pkce_method: null,
          }),
        ),
        { status: 201 },
      );
    });
    const result = await client.start_connected_account_oauth({
      provider_key: "slack",
      redirect_uri: "https://siglume.example/cb",
      scopes: ["chat:write"],
    });
    client.close();
    expect(result.state).toBe("s-abc");
    expect(capturedBody.client_secret).toBeUndefined();
    expect(capturedBody.client_id).toBeUndefined();
  });

  it("completes OAuth with state + code", async () => {
    let path = "";
    let body: Record<string, unknown> = {};
    const client = buildClient(async (input, init) => {
      path = new URL(String(typeof input === "string" ? input : input instanceof URL ? input : input.url)).pathname;
      body = init?.body ? JSON.parse(String(init.body)) : {};
      return new Response(
        JSON.stringify(
          envelope({
            connected_account_id: "ca-001",
            provider_key: "slack",
            connection_status: "connected",
            scopes: ["chat:write"],
          }),
        ),
        { status: 200 },
      );
    });
    const result = await client.complete_connected_account_oauth({ state: "s", code: "c" });
    client.close();
    expect(path).toBe("/v1/me/connected-accounts/oauth/callback");
    expect(body).toEqual({ state: "s", code: "c" });
    expect(result.connected_account_id).toBe("ca-001");
  });

  it("refresh + revoke return typed lifecycle results", async () => {
    const paths: string[] = [];
    const client = buildClient(async (input) => {
      const url = new URL(String(typeof input === "string" ? input : input instanceof URL ? input : input.url));
      paths.push(url.pathname);
      if (url.pathname.endsWith("/refresh")) {
        return new Response(
          JSON.stringify(
            envelope({
              connected_account_id: "ca-001",
              provider_key: "slack",
              expires_at: "2026-04-21T01:00:00Z",
              scopes: ["chat:write"],
              refreshed_at: "2026-04-21T00:00:00Z",
            }),
          ),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify(
          envelope({
            connected_account_id: "ca-001",
            provider_key: "slack",
            connection_status: "revoked",
            provider_revoked: true,
            revoked_at: "2026-04-21T00:00:00Z",
          }),
        ),
        { status: 200 },
      );
    });
    const refreshed = await client.refresh_connected_account("ca-001");
    const revoked = await client.revoke_connected_account("ca-001");
    client.close();
    expect(paths).toEqual([
      "/v1/me/connected-accounts/ca-001/refresh",
      "/v1/me/connected-accounts/ca-001/revoke",
    ]);
    expect(refreshed.expires_at).toBe("2026-04-21T01:00:00Z");
    expect(revoked.connection_status).toBe("revoked");
    expect(revoked.provider_revoked).toBe(true);
  });

  it("does not expose resolve on the wire (regression)", () => {
    const client = new SiglumeClient({
      api_key: "x",
      base_url: "https://x/v1",
    });
    expect((client as unknown as Record<string, unknown>).resolve_connected_account).toBeUndefined();
    client.close();
  });
});
