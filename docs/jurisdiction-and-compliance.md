# Jurisdiction & Compliance Declaration

APIs listed in the Siglume Agent API Store **must** declare which country's
law they are designed to comply with — there is no default. Consumer-
protection rules, tax obligations, payment regulations, and data-residency
requirements differ by country, so this up-front declaration lets agent
owners (and the platform) make informed decisions.

The `jurisdiction` field is also the basis for the country-flag icon the
Agent API Store renders next to each listing — an instant visual cue of
where the API is "from".

## Why this is required

- **Payments**: Stripe Connect destination charges and refund rules vary by
  country; a US-jurisdiction API settles under US Card-Act-style rules, a
  JP-jurisdiction API under 資金決済法.
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
    permission_class=PermissionClass.READ_ONLY,
    price_model=PriceModel.SUBSCRIPTION,
    price_value_minor=500,          # $5.00
    currency="USD",
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
    approval_summary_template="Charge ${amount} to {card}?",
    preview_schema={...},
    idempotency_support=True,
    side_effect_summary="Creates a Stripe payment intent for the owner.",
    quote_schema={...},
    currency="USD",
    settlement_mode=SettlementMode.STRIPE_PAYMENT_INTENT,
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
- **Platform-side**: the review step checks the declared jurisdiction against
  the developer's Stripe Connect onboarding country. Mismatches surface as a
  quality-report warning.

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

## Currency is USD regardless of jurisdiction

The Agent API Store is **USD-unified**. Even if your `jurisdiction` is
`"JP"`, `"GB"`, `"DE"`, or anything else, your listing price is in US
dollars. This is enforced:

- `AppManifest.currency` is typed as `"USD"` (literal in TS, validated in Python `__post_init__`, `const` in JSON Schema).
- `ToolManual.currency` (payment tier) is `const "USD"`.
- The platform's registration endpoint rejects non-USD payloads with a 422
  (`CURRENCY_NOT_SUPPORTED`).

Why: Stripe Connect destination charges, platform-fee accounting, the 93.4% /
6.6% revenue split, and the $5.00/month minimum for subscription APIs all
operate in USD. Mixing currencies would fragment payouts and break the fee
model.

Your jurisdiction still controls governing law, tax, consumer-protection
framework, and data residency — just not the currency.

## FAQ

**Q: We're US-based but sell to global customers. What do I set?**
A: Set `jurisdiction = "US"`. That's the law governing *your* offering.
Consumer-protection laws of the end-user's country may still apply, but
your contract is under US law.

**Q: We're based in Japan and sell mostly to JP customers. Can we price in JPY?**
A: No. `jurisdiction = "JP"` is fine — that's your governing law — but
pricing is USD. Convert at your current FX and set a round USD number
(e.g. ¥2,980/mo → $19.99/mo).

**Q: We operate in multiple countries with separate legal entities.**
A: Register separate APIs per entity, each with its own `capability_key`
and `jurisdiction`. One manifest = one legal seller.

**Q: Can I change jurisdiction after listing?**
A: Changing it is a breaking change to your terms of service. Create a new
version (bump `version` in the manifest) and re-submit for review.

**Q: What if I don't know what to put?**
A: Use the country where your Stripe Connect account is registered. That's
where you're invoicing from, so that's your jurisdiction.
