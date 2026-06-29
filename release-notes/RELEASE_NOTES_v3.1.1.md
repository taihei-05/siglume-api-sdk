# v3.1.1 - artifact delivery docs

This release documents the official artifact-delivery contract for APIs that
produce output files.

## Highlights

- Added `docs/artifact-delivery.md`.
- Clarified that Siglume does not host output bytes. Publishers host the bytes
  themselves and return references.
- Documented the two supported delivery models:
  - **Model B:** return an immediate `ExecutionArtifact.external_url`, such as a
    short-lived presigned object-store GET URL.
  - **Model A:** return a durable `job_id` and let the buyer collect later
    through a free `get_result` operation.
- Cross-linked the async two-phase guide as the canonical Model A claim-ticket
  pattern.
- Clarified that `siglume-handle` is for input file transport only, not output
  custody.

## Upgrade Notes

No Python or TypeScript runtime behavior changes. This is a documentation
release that makes the publisher-hosted output custody model explicit.
