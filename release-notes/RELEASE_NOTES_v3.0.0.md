# v3.0.0 — remove the retired company-name publishing surface (BREAKING)

The Company (joint API-revenue workspace) feature was retired platform-side: the
`/v1/market/company-publishers` endpoint and the company publish-approval routes no
longer exist, and every live listing publishes as an individual (`user`). The SDK had
kept a now-dead company publishing surface for backward compatibility. v2.0.5 removed it
from the docs; this release removes the **code**, which is a breaking change to the
public CLI and `AppManifest`, hence the major bump.

There is **no behavior change for individual publishers** — that has always been the
default and only working path.

## Removed (BREAKING)

- **`AppManifest.publisher_type` and `AppManifest.company_id` / `publisher_company_id`**
  (Python dataclass + TypeScript `AppManifest`) and the `__post_init__` / `auto_register`
  validation that enforced the `user` vs `company` rules. Passing these now raises a
  `TypeError` (Python) or fails the type checker (TypeScript).
- **`siglume companies` CLI command** (Python + TypeScript) and the **`--company` /
  `--company-slug`** flags on `siglume register`.
- **Client methods** `SiglumeClient.list_company_publishers()`,
  `request_company_publish_approval()`, and `decide_company_publish_approval()` (Python +
  TypeScript), the **`CompanyPublisherRecord`** type, and the company read-side fields on
  **`AppListingRecord`** (`publisher_type`, `publisher_company_id`, `company_id`,
  `company_name`, `company_publish_status`, `company_terms_version`).
- The `/market/company-publishers` and
  `/market/capabilities/{listingId}/company-publish-approval[/decision]` routes, the
  `publisher_type` / `company_id` / `publisher_company_id` properties, and the
  `CompanyPublisher*` schemas in `openapi/developer-surface.yaml` and
  `schemas/app-manifest.schema.json`.

## Migration

Individual publishing is unaffected — you were already publishing as `user`. If your
manifest, CLI invocation, or client code still references the company surface, remove it:

- **Manifest** (`app_manifest.yaml` / `manifest.json`): delete any `publisher_type`,
  `company_id`, or `publisher_company_id` keys. Omitting them was already the
  individual-publishing default, so nothing replaces them.
- **CLI**: drop `siglume companies` and the `--company` / `--company-slug` flags from
  `siglume register`. Plain `siglume register .` publishes as an individual.
- **SDK code**: remove calls to `list_company_publishers()`,
  `request_company_publish_approval()`, `decide_company_publish_approval()`, and any reads
  of the removed `CompanyPublisherRecord` / `AppListingRecord` company fields.

Company-name publishing is retired and is not coming back; there is no replacement surface
to migrate onto.
