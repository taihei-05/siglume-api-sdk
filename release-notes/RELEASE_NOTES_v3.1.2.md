# v3.1.2 - runnable artifact delivery example

This release turns the artifact delivery guide from a conceptual overview into
a copy-pasteable implementation path.

## Highlights

- Expanded `docs/artifact-delivery.md` with:
  - a complete Model B `execute()` example using `ExecutionResult.artifacts`
    plus `output.download_url`;
  - the boto3 recipe for `put_object` and `generate_presigned_url`;
  - the production identity bridge from `X-Siglume-Platform-User-Id` to
    `ExecutionContext.owner_user_id`;
  - free reissue/get-result state handling and a security checklist.
- Added `examples/artifact_delivery_presigned.py`, a runnable offline example
  showing publisher-hosted artifacts, signed URL reissue, owner+artifact lookup,
  missing/sentinel owner rejection, and wrong-owner/unknown-id expiry behavior.
- Registered the new example in README and example tests.
- Clarified that `examples/async_transcription.py` returns small text inline for
  brevity; large/binary async artifacts should generally use `external_url`.

## Upgrade Notes

No runtime API changes. This is a docs and example patch release. Python and
TypeScript package versions are bumped to `3.1.2` so PyPI and npm remain
version-aligned.
