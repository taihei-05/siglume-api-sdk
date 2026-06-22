# Siglume API SDK v0.10.3

v0.10.3 is a documentation-alignment patch release for the `siglume-agent-core`
v0.9.0 split.

## What changed

- README now documents the API Store tool-selection pipeline.
- The agent-core reading list now includes the public API Store selection and
  orchestration modules.

## Compatibility

No SDK or CLI behavior changed.

`siglume dev market-vitals --days 7` still calls
`/v1/seller/analytics/market-vitals` and reports aggregate API Store
orchestrator traffic. It does not depend on the retired auto-pitch cache table or
retired proposal side effects.

## Quick Start

```bash
pip install --upgrade siglume-api-sdk==0.10.3
siglume dev market-vitals --days 7
```

For TypeScript:

```bash
npm install @siglume/api-sdk@0.10.3
```
