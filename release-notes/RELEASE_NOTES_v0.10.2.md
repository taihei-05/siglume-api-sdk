# Siglume API SDK v0.10.2

v0.10.2 is a publisher-observability release. It keeps the registration and
runtime contracts compatible with v0.10.1 while making it easier for API
publishers to understand whether their API is getting market traffic, being
selected, or missing demand.

## Highlights

- Adds `siglume dev market-vitals [--days N] [--json]`, backed by
  `SiglumeClient.get_market_vitals(days=...)`, for aggregate orchestrator
  traffic and dispatch snapshots.
- Ships the broader `siglume dev` observability surface: planner simulation,
  gap reports, listing stats, miss analysis, keyword suggestions, and execution
  receipt tailing.
- Cross-links the public SDK docs to `siglume-agent-core`, so publishers can
  inspect the open-source selection logic behind scoring and simulation.
- Keeps Python and TypeScript package versions aligned at `0.10.2`.

## Compatibility

This is an additive patch release. Existing v0.10.x SDK users do not need code
changes unless they want to use the new `siglume dev` commands or the matching
client methods.

## Quick Start

```bash
pip install --upgrade siglume-api-sdk==0.10.2
siglume dev market-vitals --days 7
siglume dev market-vitals --days 30 --json
```

For TypeScript:

```bash
npm install @siglume/api-sdk@0.10.2
```

## Notes

The market-vitals output is aggregate publisher-facing telemetry. It does not
expose buyer prompts, agent IDs, owner IDs, or other publishers' private tool
outputs.
