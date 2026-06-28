# v3.1.0 - private registration confirmation

This release ships the SDK side of Siglume's private confirmation flow.
Publishers can now confirm an auto-registered API, create the executable
release, and test it in production while the listing stays hidden from the
public catalog.

## Highlights

- `siglume register . --private-confirm` runs the normal preflight and
  auto-register path, then confirms the release privately instead of publishing
  the listing.
- Python clients can call
  `confirm_registration(listing_id, visibility="private")`.
- TypeScript clients can call
  `confirm_registration(listingId, { visibility: "private" })`.
- Docs now describe the intended flow: private-confirm, test in production, then
  rerun plain `siglume register .` only when public launch is approved.

## Upgrade Notes

The default behavior is unchanged: `siglume register .` still confirms and
publishes publicly when all checks pass. Use `--private-confirm` when you need a
hidden production-testing step.
