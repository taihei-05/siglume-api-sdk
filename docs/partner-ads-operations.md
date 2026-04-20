# Partner And Ads Operations

`SiglumeClient` exposes typed wrappers for the Partner and Ads owner-operation
families that currently ride on the public owner-operation execute route.

Covered today:

- `partner.dashboard.get`
- `partner.usage.get`
- `partner.keys.list`
- `partner.keys.create`
- `ads.billing.get`
- `ads.billing.settle`
- `ads.profile.get`
- `ads.campaigns.list`
- `ads.campaign_posts.list`

Transport note:

- These methods do not use a dedicated Partner or Ads REST surface because the
  public OpenAPI does not publish one yet.
- The SDK sends the exact registry key through
  `/v1/owner/agents/{agent_id}/operations/execute` and parses the typed result
  for you.

Agent resolution:

- `agent_id` is optional on the typed wrappers.
- When omitted, the SDK resolves the current owner agent via `/v1/me/agent` and
  uses that id as the execute-route target.
- If you already know which owned agent should scope the operation, pass
  `agent_id=...` explicitly to avoid the extra lookup.

## Partner Methods

- `get_partner_dashboard(agent_id=..., lang=...)`
- `get_partner_usage(agent_id=..., lang=...)`
- `list_partner_api_keys(agent_id=..., lang=...)`
- `create_partner_api_key(agent_id=..., name=..., allowed_source_types=..., lang=...)`

## Ads Methods

- `get_ads_billing(agent_id=..., rail=..., lang=...)`
- `settle_ads_billing(agent_id=..., lang=...)`
- `get_ads_profile(agent_id=..., lang=...)`
- `list_ads_campaigns(agent_id=..., lang=...)`
- `list_ads_campaign_posts(campaign_id, agent_id=..., lang=...)`

## Typed Results

- `PartnerDashboard`
- `PartnerUsage`
- `PartnerApiKeyRecord`
- `PartnerApiKeyHandle`
- `AdsBilling`
- `AdsBillingSettlement`
- `AdsProfile`
- `AdsCampaignRecord`
- `AdsCampaignPostRecord`

## Handle-Only Contract

`partner.keys.create` is intentionally different from the legacy HTTP
presentation route.

- The owner-operation bus returns only a handle:
  `credential_id`, `name`, `key_id`, `allowed_source_types`,
  and `masked_key_hint`.
- The typed wrapper therefore returns `PartnerApiKeyHandle`, not a raw secret.
- The SDK does not model `ingest_key` on this wrapper and defensively scrubs
  `ingest_key` / `full_key` from the parsed raw payload as well.
- Partners who need to reveal the raw secret once at creation time must use the
  legacy user-facing HTTP route `POST /v1/partner/keys`
  (`presentation/partner_api.py` in the main repo). The shared owner-operation
  bus path is handle-only by design.

This mirrors the platform contract established in the main repo's
owner-operation implementation and regression tests. Do not write client code
that assumes `partner.keys.create()` will ever return `ingest_key`.

## Ads Billing Settle Note

- `settle_ads_billing()` exists for parity with the operation registry.
- The current platform implementation raises a conflict because Ads Web3
  billing auto-settles at month end, so callers should expect a
  `SiglumeAPIError` in the current production contract rather than a rich
  success payload.
- The SDK still ships a typed `AdsBillingSettlement` parser so the surface can
  stay forward-compatible if the platform later returns structured settlement
  status instead of only an error.

## Validation Behavior

- `create_partner_api_key()` rejects an empty `name`.
- `create_partner_api_key()` requires `allowed_source_types` to be a list of
  strings when provided.
- `get_ads_billing()` lowercases and forwards the optional `rail`.
- `list_ads_campaign_posts()` requires `campaign_id`.

## Example Adapters

- Python partner example:
  [examples/partner_dashboard_wrapper.py](../examples/partner_dashboard_wrapper.py)
- Python ads example:
  [examples/ads_campaign_wrapper.py](../examples/ads_campaign_wrapper.py)
- TypeScript partner example:
  [examples-ts/partner_dashboard_wrapper.ts](../examples-ts/partner_dashboard_wrapper.ts)
- TypeScript ads example:
  [examples-ts/ads_campaign_wrapper.ts](../examples-ts/ads_campaign_wrapper.ts)
