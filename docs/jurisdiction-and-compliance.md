# Jurisdiction & Compliance Declaration

APIs listed in the Siglume API Store **must** declare which country's
law they are designed to comply with — there is no default. Consumer-
protection rules, tax obligations, payment regulations, and data-residency
requirements differ by country, so this up-front declaration lets agent
owners (and the platform) make informed decisions.

The `jurisdiction` field is also the basis for the country-flag icon the
API Store renders next to each listing — an instant visual cue of
where the API is "from".

> **Payment stack status.** On-chain embedded-wallet settlement is live on
> Polygon mainnet, and Stripe Connect is retired. See
> [PAYMENT_MIGRATION.md](../PAYMENT_MIGRATION.md) for the migration history.
> The **jurisdiction declaration requirement itself is unchanged**:
> consumer-protection, tax, and data-residency obligations continue to apply
> regardless of the settlement mechanism.

## Why this is required

- **Payments**: the legacy Stripe Connect payout rails had per-country
  destination-charge and refund rules (a US-jurisdiction API settled
  under US Card-Act-style rules, a JP-jurisdiction API under 資金決済法).
  On-chain settlement shifts the mechanics, but cross-border consumer
  protection, chargeback equivalents, and refund-note obligations still
  track the declared jurisdiction.
- **Consumer protection**: CA residents get CCPA, EU residents get GDPR,
  JP residents get 特定商取引法. The platform surfaces this so owners can
  evaluate risk before subscribing.
- **Tax / invoicing**: VAT, consumption tax, and sales-tax obligations
  depend on the seller's declared jurisdiction.
- **Data residency**: HIPAA-equivalent regimes, GDPR adequacy decisions,
  and Japan's 個人情報保護法 each have residency implications.

## Why only origin, not buyer-country enforcement

The platform deliberately does **not** model a "served countries" allowlist
or "excluded countries" blocklist on the API itself. Whether an API is
**fit for a buyer's country and use case** is the buyer's judgment — the
platform cannot adjudicate this in general.

Example: a seismic-calculation API built to US building codes (IBC) is
probably not valid for a Japanese structural engineer filing under
建築基準法, but it may still be useful as a reference or for a comparative
study. Whether it's appropriate is context-dependent and the buyer is
the only party with enough information to decide.

What the platform does:

- **Forces sellers to declare `jurisdiction`** so the buyer sees an
  unambiguous flag on every listing.
- **Renders the ISO country code as a flag icon** on the API Store card
  and detail page so the country of origin is visible at a glance.

What the platform does NOT do:

- Block subscriptions based on the buyer's country.
- Claim the API is valid for any particular regulatory regime.
- Validate `applicable_regulations` claims — those are advisory.

The buyer, not the platform, is responsible for determining regulatory
fitness in their jurisdiction of use.

## Flag icon rendering

The platform converts `jurisdiction` to a flag emoji using the Regional
Indicator Symbols for the first two letters of the code:

- `"US"` → 🇺🇸
- `"JP"` → 🇯🇵
- `"US-CA"` → 🇺🇸 (sub-regions collapse to the parent country flag;
  the text label still shows the full `"US-CA"`)

If `jurisdiction` is missing or malformed, no flag is shown — which is
why the SDK and the platform both require a valid value at registration.

## Where to declare it

### AppManifest (required, app-level)

```python
from siglume_api_sdk import AppManifest, PermissionClass, PriceModel, AppCategory

manifest = AppManifest(
    capability_key="acme-translator",
    name="Acme Translator",
    job_to_be_done="Translate short text between EN/JA",
    category=AppCategory.OTHER,
    store_vertical="api",
    permission_class=PermissionClass.READ_ONLY,
    price_model=PriceModel.SUBSCRIPTION,
    price_value_minor=500,          # $5.00
    currency="USD",
    allow_free_trial=False,
    jurisdiction="US",              # required — ISO 3166-1 alpha-2
    applicable_regulations=["CCPA"],
    data_residency="US",            # optional; defaults to jurisdiction
)
```

Accepted formats:

- Two uppercase letters (ISO 3166-1 alpha-2): `"US"`, `"JP"`, `"GB"`, `"DE"`,
  `"SG"`, `"AU"`, `"CA"`, `"FR"`, `"KR"`, etc.
- With sub-region (optional): `"US-CA"` (California), `"US-NY"` (New York),
  `"CA-ON"` (Ontario).

### ToolManual (required for `action` and `payment` tiers)

Payment tools and state-changing action tools must also declare jurisdiction
at the tool level. This allows different tools in the same app to opt into
different legal scopes (e.g. an action tool that's US-only plus a read-only
tool usable worldwide).

```python
from siglume_api_sdk import ToolManual, ToolManualPermissionClass, SettlementMode

manual = ToolManual(
    tool_name="charge_subscription",
    # ... required fields ...
    permission_class=ToolManualPermissionClass.PAYMENT,
    approval_summary_template="Charge ${amount} through the owner's embedded wallet?",
    preview_schema={...},
    idempotency_support=True,
    side_effect_summary="Debits the owner's connected wallet via the platform's payment adapter.",
    quote_schema={...},
    currency="USD",
    settlement_mode=SettlementMode.EMBEDDED_WALLET_CHARGE,
    refund_or_cancellation_note="Full refund within 7 days per platform policy.",
    jurisdiction="US",  # required for action/payment
    legal_notes="Refunds follow US FTC Rule 16 CFR 429. Not offered to EU users.",
)
```

The tool-level `jurisdiction` must not contradict the app-level declaration.
If `AppManifest.jurisdiction = "US"`, a payment tool cannot set
`jurisdiction = "JP"` — the app is still the legal seller.

## Validation

- **SDK dataclasses** (`AppManifest.__post_init__`, `ToolManual.to_dict`)
  validate the format and reject malformed codes at construction / serialize
  time.
- **JSON schemas** (`schemas/app-manifest.schema.json`,
  `schemas/tool-manual.schema.json`) enforce `pattern: ^[A-Z]{2}(-[A-Z0-9]{1,3})?$`.
- **Platform-side**: the review step checks the declared jurisdiction for
  consistency with the listing, runtime sample, payout readiness, and legal
  review result. Mismatches surface as a quality-report warning or a blocking
  publish error depending on severity.

## Applicable regulations

`applicable_regulations` is advisory only — the platform does **not** audit
compliance claims. Use it to signal intent. Common values:

| Region | Tag |
| --- | --- |
| US federal | `CCPA`, `COPPA`, `HIPAA`, `GLBA` |
| EU / EEA | `GDPR`, `DSA`, `DMA` |
| UK | `UK-GDPR`, `DPA-2018` |
| Japan | `資金決済法`, `特定商取引法`, `個人情報保護法` |
| Global / industry | `PCI-DSS`, `SOC2`, `ISO27001`, `ISO27701` |

## Currency is explicit and separate from jurisdiction

The API Store requires every SDK listing to declare AppManifest.currency
explicitly. Use "USD" when the listing price is in USD cents and should
settle in USDC. Use "JPY" when the listing price is in yen and should
settle in JPYC.

This is independent from jurisdiction. For example, a "JP" listing may
choose currency="USD" or currency="JPY" depending on the publisher's
commercial offer. price_value_minor always follows the selected listing
currency: cents for USD, yen for JPY.

ToolManual.currency for a payment tool still describes that tool's own
payment payload. It is not a substitute for the listing-level
AppManifest.currency used by Store subscriptions.

Your jurisdiction controls governing law, tax, consumer-protection
framework, and data residency. It does not implicitly choose the Store
listing currency.

## FAQ

**Q: We're US-based but sell to global customers. What do I set?**
A: Set `jurisdiction = "US"`. That's the law governing *your* offering.
Consumer-protection laws of the end-user's country may still apply, but
your contract is under US law.

**Q: We're based in Japan and sell mostly to JP customers. Can we price in JPY?**
A: Yes. Set `jurisdiction = "JP"` for the governing law and choose
`currency="JPY"` when the Store price should be in yen and settle in JPYC.
You may also choose `currency="USD"` for a USDC-priced offer. In both cases,
`price_value_minor` follows the selected currency: yen for JPY, cents for USD.

**Q: We operate in multiple countries with separate legal entities.**
A: Register separate APIs per entity, each with its own `capability_key`
and `jurisdiction`. One manifest = one legal seller.

**Q: Can I change jurisdiction after listing?**
A: Changing it is a breaking change to your terms of service. Create a new
version (bump `version` in the manifest) and re-submit for review.

**Q: What if I don't know what to put?**
A: Use the country where you are a legal resident for tax and invoicing
purposes. That's your jurisdiction. (Historically the answer was tied to
your Stripe Connect onboarding country; with the on-chain migration this
becomes a direct self-declaration rather than inferred from payout rails.)
