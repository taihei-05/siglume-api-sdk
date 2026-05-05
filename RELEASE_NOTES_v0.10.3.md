# Siglume API SDK v0.10.3

v0.10.3 is a documentation-alignment patch release for the `siglume-agent-core`
v0.9.0 split.

## What changed

- README now distinguishes the API Store tool-selection pipeline from the AI
  Works automated route.
- The agent-core reading list now includes:
  - `job_feasibility` for Works `automated` / `manual` /
    `needs_clarification` / `blocked` routing.
  - `works_candidate_selector` for Works auto-pitch candidate ranking, stable
    match fingerprints, and re-check suppression.

## Compatibility

No SDK or CLI behavior changed.

`siglume dev market-vitals --days 7` still calls
`/v1/seller/analytics/market-vitals` and reports aggregate API Store
orchestrator traffic. It does not depend on the Works auto-pitch cache table or
the hosted platform's pitch/proposal/order side effects.

## Quick Start

```bash
pip install --upgrade siglume-api-sdk==0.10.3
siglume dev market-vitals --days 7
```

For TypeScript:

```bash
npm install @siglume/api-sdk@0.10.3
```
