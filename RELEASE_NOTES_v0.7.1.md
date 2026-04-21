# siglume-api-sdk v0.7.1 — Responsibility Correction

Released: 2026-04-21

## TL;DR

v0.7.1 fixes a responsibility-boundary bug in v0.7.0's OAuth
design. OAuth client credentials now live with the **seller**
(the API Store lister), not with the platform. SDK callers pass
a `listing_id` instead of `provider_key`.

## Breaking change

`start_connected_account_oauth` signature changed:

```diff
- c.start_connected_account_oauth(provider_key="slack", redirect_uri=..., scopes=...)
+ c.start_connected_account_oauth(listing_id="lst_abc", redirect_uri=..., scopes=...)
```

The platform resolves the provider and the seller's OAuth client
credentials from the listing. Any v0.7.0 call site needs updating.

## Why

In v0.7.0 Siglume was modeled as the OAuth client to every
third-party service (Slack / Google / etc). That is the wrong
responsibility boundary for a marketplace:

- If Slack wants to ship their API on Siglume, **Slack** is the
  OAuth client (they list their own API and register their own
  Slack app).
- If a third-party developer writes a capability that uses Slack,
  **that developer** is the OAuth client (they register their own
  Slack app to integrate with).

Siglume's role is marketplace + credential vault — it holds the
buyer's encrypted access token so the buyer has one central
place to revoke / audit — but Siglume is never the OAuth client.

## Added

```python
# Seller registers their OAuth app's client_id / client_secret
# against their listing. client_secret is stored encrypted and
# never returned on reads.
client.set_listing_oauth_credentials(
    listing_id="lst_abc",
    provider_key="slack",
    client_id="1234567890.9876543210",
    client_secret="sato-slack-app-secret",
    required_scopes=["chat:write"],
)

# Anyone can read whether a listing is OAuth-configured (never
# returns the actual secret values).
status = client.get_listing_oauth_credentials_status("lst_abc")
# {"listing_id": "lst_abc", "provider_key": "slack",
#  "configured": true, "required_scopes": ["chat:write"]}
```

TypeScript has the same methods with the same signatures.

## Known trade-off

Because OAuth tokens are issued to a specific app (the seller's
OAuth app), tokens from listing A cannot be reused for listing
B. If a buyer purchases capabilities from 5 different sellers
that each use Slack, they authorize Slack 5 times (once per
seller app). This is a spec-level constraint of OAuth, not a
Siglume decision.

Sellers who want "connect once" across many capabilities should
list a single "Slack API" listing that every downstream capability
depends on (pattern A — Slack-as-seller).

## Migration guide

1. Upgrade SDK: `pip install --upgrade siglume-api-sdk==0.7.1`
2. Update every `start_connected_account_oauth` call:
   `provider_key=...` → `listing_id=...`
3. For every listing that uses a third-party OAuth provider, call
   `set_listing_oauth_credentials` once after registering your
   OAuth app with the provider.
4. Reconnect any ConnectedAccount rows from v0.7.0 — they have
   no `source_listing_id` and cannot be refreshed under the new
   model.

## Platform requirement

Requires platform PR taihei-05/siglume#143 deployed.
