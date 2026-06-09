# Siglume API SDK v1.2.2

This patch release tightens developer documentation for the current production
pricing and observability surface.

## What changed

- Added `docs/developer-observability.md`, the canonical guide for viewing
  execution logs, receipts, listing activity, support identifiers, and analytics.
- Documented `siglume dev tail`, `siglume dev tail --listing-id`, seller
  receipt helpers, owner installed-tool receipt helpers, and privacy-redacted
  publisher views.
- Cross-linked observability from Pricing and Billing, Metering, Publish Flow,
  Getting Started, Execution Receipts, Installed Tools, README, and the
  TypeScript README.
- Updated jurisdiction docs to reflect the live Polygon settlement stack and
  current `currency="JPY"` / JPYC support.
- Clarified reward-payout documentation so publisher APIs do not confuse
  Developer Surface `SIGLUME_API_KEY` / `cli_...` credentials with MCP Gateway
  `mcpsk_...` bearer tokens.
- Clarified session-only owner, buyer, webhook, metering, and Web3 helper
  routes so docs no longer imply that CLI/API keys can call those surfaces.
- Corrected owner-operation wrapper and roadmap wording: generated SDK
  wrappers depend on the target API exposing
  `/v1/owner/agents/{agent_id}/operations/execute`, while
  `usage_based` / `per_action` billing is already live.

No runtime API contract changed from v1.2.1.
