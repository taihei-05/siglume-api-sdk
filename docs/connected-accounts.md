# Connected Accounts Guide

Siglume APIs can depend on user-linked external accounts such as
Slack, X/Twitter, Google, GitHub, Linear, or Notion.

The SDK exposes three distinct concerns:

1. API-managed connected-account requirements
2. Platform-managed seller-side OAuth setup on the listing
3. Buyer-side OAuth authorization for that listing

Your API runtime never receives raw long-lived credentials.

```text
Seller / developer, before publish
  creates the upstream OAuth app
  provides X_CLIENT_ID / X_CLIENT_SECRET in local oauth_credentials.json
  runs siglume preflight . and siglume register .

Buyer / agent owner, after install
  connects their own provider account for this listing
  grants scopes to their agent
  can refresh or revoke that connected account later

Runtime
  receives only Siglume-managed connected-account context
  never receives the seller client secret or a raw long-lived buyer token
```

## Design Rule

OAuth client credentials belong to the seller's listing, not to
the platform. In v0.7.1 the buyer starts OAuth with a
`listing_id`, and the platform resolves the provider plus the
seller-registered `client_id` / `client_secret` from that
listing.

## Seller Setup

After registering your OAuth app with the upstream provider,
store those credentials against your listing:

```python
client.set_listing_oauth_credentials(
    "lst_abc",
    provider_key="slack",
    client_id="1234567890.9876543210",
    client_secret="sato-slack-app-secret",
    required_scopes=["chat:write"],
)

status = client.get_listing_oauth_credentials_status("lst_abc")
assert status["configured"] is True
```

`client_secret` is encrypted server-side and is never returned by
the read path.

## Buyer OAuth Flow

The buyer starts OAuth for a specific listing:

```python
start = client.start_connected_account_oauth(
    listing_id="lst_abc",
    redirect_uri="https://siglume.example/owner/connected-accounts/callback",
    scopes=["chat:write"],
    account_role="bot",
)
# redirect the browser to start.authorize_url
```

When the provider redirects back with `code` + `state`, complete
the connection:

```python
client.complete_connected_account_oauth(
    state=start.state,
    code=code_from_provider,
)
```

Later, the owner surface can refresh or revoke the connected
account without exposing the provider token:

```python
client.refresh_connected_account("ca_123")
client.revoke_connected_account("ca_123")
```

## What To Declare In Your App

If your API manages the provider-specific auth path itself, list required
providers as plain strings:

```python
required_connected_accounts=["slack", "github"]
```

If Siglume should run the OAuth flow with the seller-owned OAuth app, mark the
provider as platform-managed and include `oauth_credentials.json` during
registration:

```python
required_connected_accounts=[
    {"provider_key": "slack", "platform_managed": True, "required_scopes": ["chat:write"]}
]
```

## What Your Runtime Receives

At execution time, Siglume provides an opaque `ConnectedAccountRef`:

```python
ConnectedAccountRef(
    provider_key="twitter",
    session_token="short-lived-scoped-token",
    scopes=["tweet.write"],
    environment=Environment.LIVE,
)
```

- `provider_key` identifies the provider family
- `session_token` is short-lived and Siglume-managed
- `scopes` describe what the owner granted
- `environment` tells you whether the execution is sandbox or live

## Sandbox vs Live

- `sandbox`: use stub providers or fake destinations
- `live`: only perform side effects after policy and approval checks succeed

## Good Practices

- Fail closed when a required provider is missing
- Return a clear error message such as `"Slack account not connected"`
- Keep provider-specific logic behind small helper methods
- Do not log session tokens
- Expect OAuth to be listing-scoped: buyers may authorize the same provider separately for different sellers
