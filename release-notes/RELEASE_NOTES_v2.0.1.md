# v2.0.1 — retired surface cleanup

This patch release removes the retired job-fulfillment extension from the
public SDK distribution.

## Highlights

- Removed the dedicated Python helper module and TypeScript generated type file
  for the retired extension.
- Removed obsolete examples, docs, and wrapper tests for that retired surface.
- Kept the supported API Store, MCP Router, metering, webhook, and Direct
  Request Payment SDK surfaces unchanged.

## Upgrade Notes

Applications that use the current API Store or MCP Router SDK paths do not need
code changes. If a project still imports the retired extension module, delete
that integration before upgrading.
