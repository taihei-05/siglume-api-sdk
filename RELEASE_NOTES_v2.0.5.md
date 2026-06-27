# v2.0.5 — documentation freshness pass

Documentation-only release. A full staleness audit of the SDK found several
current-state claims that were six releases behind. This release makes the docs
reflect the actual 2.0.x reality. No SDK runtime code changed.

## Highlights

- **Version/state freshness.** The README "Current release" and "Project status" blocks
  said **v1.2.2** and framed v1.0.0's OAuth-broker removal as the headline. Both now read
  **2.0.5** and lead with the real 2.0.x line: 2.0.0 removed the legacy advertising /
  partner-dashboard + Ads SDK surface (BREAKING), 2.0.1 removed the job-fulfillment
  extension, 2.0.2 added `ToolManual.supports`, and 2.0.3–2.0.5 added the async two-phase
  API guide + its failure/edge completeness. The release-notes links now point at the 2.0.x
  notes.
- **Retired Company-publishing path removed from the docs.** `README.md` and
  `GETTING_STARTED.md` no longer document `siglume companies`, `--company`/`--company-slug`,
  or `publisher_type: "company"`/`company_id` — the Company feature is retired platform-side,
  so the docs no longer present it as a working flow. (The vestigial CLI flags / manifest
  fields are non-functional against the platform and are slated for removal in a future major.)
- **`CONTRIBUTING.md`** corrected the false "listed after admin review" claim to the actual
  self-serve publish gate (automated checks + a fail-closed legal review; no human review).
- **`ROADMAP.md`** gained the missing 1.x/2.x **Shipped** history and dropped the retired
  `partner.keys.create` / `admin.source_credentials.issue` surface (removed in 2.0.0) from
  the external-ingest track.
- Fixed a dead `docs/sdk/v0.6-operation-inventory.md` link, a blank line splitting the
  README example-templates table, and annotated `RECOMMENDATION` as a deprecated alias of
  `READ_ONLY`.

## Upgrade Notes

No code changes are required. If you publish as an individual, omit `publisher_type`
(it defaults to `"user"`); the retired Company-publishing flow is no longer documented.
