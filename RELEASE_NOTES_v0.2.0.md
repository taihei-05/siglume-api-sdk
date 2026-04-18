# v0.2.0 — SettlementMode adds Polygon-aware values

**2026-04-18**

The Stripe Connect → Polygon on-chain migration's first SDK-visible release. `SettlementMode` now accepts two new values: `polygon_mandate` and `embedded_wallet_charge`.

> **What this is:** a metadata / contract expansion. Tool manuals declaring the new modes validate end-to-end through the resolver, dry-run preview, approval snapshot, `intent.plan_jsonb`, and the installed-tools API.
>
> **What this is not (yet):** the payment-permission tool execution itself actually settling on Web3. That is a subsequent phase. Declaring the new modes today is a metadata commitment, not a runtime change.

## The expanded enum

```python
class SettlementMode(str, Enum):
    STRIPE_CHECKOUT = "stripe_checkout"
    STRIPE_PAYMENT_INTENT = "stripe_payment_intent"
    POLYGON_MANDATE = "polygon_mandate"            # NEW in v0.2.0
    EMBEDDED_WALLET_CHARGE = "embedded_wallet_charge"  # NEW in v0.2.0
```

```ts
export type SettlementMode =
  | "stripe_checkout"
  | "stripe_payment_intent"
  | "polygon_mandate"
  | "embedded_wallet_charge";
```

JSON Schema and OpenAPI enums updated to match.

## Semantics

| Value | When to use |
|---|---|
| `polygon_mandate` | Subscription-style auto-debit against an on-chain mandate (Siglume's platform-sponsored ERC-4337 Safe + Pimlico paymaster stack). Recurring, session-key-scoped. |
| `embedded_wallet_charge` | One-shot charge against the user's embedded smart wallet. Discrete payment at tool-execution time. |
| `stripe_checkout` | Existing Stripe-hosted checkout flow. Unchanged. |
| `stripe_payment_intent` | Existing Stripe payment intent flow. Unchanged. |

## Migration

**If you do nothing:** your existing `stripe_checkout` / `stripe_payment_intent` tool manuals continue to validate and run exactly as before. No action required.

**If you want to opt into Web3 settlement:**

1. Set `settlement_mode="polygon_mandate"` (or `"embedded_wallet_charge"`) on your `ToolManual`.
2. Keep `currency="USD"`; the on-chain side resolves to USDC / JPYC via the user's smart wallet.
3. Re-run `validate_tool_manual()` — the new values are whitelisted.

That's the full SDK-side change. The tool manual stays the same shape; only the `settlement_mode` value is new. **Do not** add `accepted_payment_tokens` or `settlement_network` as tool-manual fields — those are server-side metadata that the platform derives from the seller's payout wallet configuration, and the ToolManual schema (`additionalProperties: false`) will reject them.

**TypeScript consumers:** exhaustive `switch` / `match` on `SettlementMode` will now surface a type error on the two new values. Extend cases or narrow the type at the boundary.

## Semver rationale

The enum expansion is technically a breaking change in semver — consumers that exhaustively pattern-match, or platforms expecting the old restricted set, will observe different behavior. In zerover, that justifies the minor bump to `0.2.0`.

## Context — the migration this is part of

v0.2.0 is the first SDK-visible output of the broader Stripe Connect → Polygon on-chain migration. The full phase log, including the real on-chain completion on 2026-04-18 (userOpHash `0xaa55cbae...`, tx_hash `0xa04699ff...` on Polygon Amoy block 36829663), lives in [PAYMENT_MIGRATION.md](https://github.com/taihei-05/siglume-api-sdk/blob/main/PAYMENT_MIGRATION.md).

The two-axis model this migration has been operating under:

- **Axis 1 — subscription purchase** (Plan / Partner / API Store / AIWorks escrow / Ads): migrated to Polygon server-side. Does not cross the SDK contract; no SDK change required.
- **Axis 2 — tool-execution settlement**: gated by `SettlementMode`. **This is the axis that moved in v0.2.0.** The enum expansion is the trigger.

## What remains reserved

- `PriceModel.USAGE_BASED` / `PER_ACTION` still reserved. Current platform accepts only `FREE` / `SUBSCRIPTION`.
- The Polygon-aware `SettlementMode` values are *accepted* by the platform but not yet *dispatched to Web3 settlement at execution time*. Follow-up phase.

## Feedback

If the migration guide or enum semantics are unclear, open a [Discussion](https://github.com/taihei-05/siglume-api-sdk/discussions) or [Issue](https://github.com/taihei-05/siglume-api-sdk/issues).

---

Full changelog: [CHANGELOG.md](https://github.com/taihei-05/siglume-api-sdk/blob/main/CHANGELOG.md)
