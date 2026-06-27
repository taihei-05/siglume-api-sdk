# siglume-api-sdk v0.8.0

Released: 2026-04-24

## Summary

One buyer-UX-driven tightening: `example_prompts` now requires at least **2 distinct non-empty entries** on `auto_register` and `confirm_auto_register`. Platform rejects submissions with fewer than 2 (HTTP 422).

Reason: the API detail page in the Siglume API Store ([siglume.com/owner/apis](https://siglume.com/owner/apis)) renders an "Example prompts" section. With only one prompt (or zero) the section either disappears or looks empty, which hurts buyer conversion. Two prompts give buyers a sense of the API's usage pattern at a glance.

## Breaking

- `example_prompts` minimum count raised from 0 → 2 on submission. Duplicate prompts (after strip) collapse to one before the count check, and each prompt is silently truncated to 500 characters.

## Additive

- `Manifest.preflight()` mirrors the server rule so failures are caught locally before the network round-trip.
- `minItems: 2` added to `example_prompts` in both the OpenAPI spec (`openapi/developer-surface.yaml`) and the JSON schema (`schemas/app-manifest.schema.json`).

## Examples updated

All single-prompt examples in `examples/` (22 Python files) and `examples-ts/` (14 TypeScript files) now ship with a thematically-matching 2nd prompt. `GETTING_STARTED.md`'s canonical "Say hello" snippet likewise gains a 2nd prompt so developers copying from the tutorial meet the new rule out of the box.

## Migration

If your adapter has only one prompt today, add a natural rephrasing:

```python
example_prompts=[
    "Send a follow-up email to the customer",
    "Email the team a recap of today's release",
]
```

Existing deployed listings with `<2` prompts are not invalidated — the check only fires on fresh submissions.

## Install

```bash
pip install --upgrade siglume-api-sdk==0.8.0
```
