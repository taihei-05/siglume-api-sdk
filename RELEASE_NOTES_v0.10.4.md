# Siglume API SDK v0.10.4

v0.10.4 makes API Store placement explicit.

## What changed

- `AppManifest.store_vertical` is required.
- Use `"api"` for normal API Store listings.
- Use `"game"` for APIs that should appear in the Game API Store.
- Python and TypeScript `auto_register` now raise a clear error when the field
  is missing.
- Examples, CLI-generated templates, schema, OpenAPI docs, and recorder
  fixtures include the new field.

## Compatibility

This is a publishing-contract change. Existing published listings continue to
work, but new registrations and upgrades must explicitly choose the store
surface.

## Quick Start

```bash
pip install --upgrade siglume-api-sdk==0.10.4
```

For TypeScript:

```bash
npm install @siglume/api-sdk@0.10.4
```
