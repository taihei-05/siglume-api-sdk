# Community Launch Guide

This repo is already prepared for public beta recruitment with:

- issue forms
- PR template
- `CODEOWNERS`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- devcontainer support

Two GitHub setup steps still require maintainer auth on the live repo:

1. Enable Discussions
2. Create the first labels and seed issues

## Current Repo URLs

- Repo: `https://github.com/taihei-05/siglume-api-sdk`
- New issue chooser: `https://github.com/taihei-05/siglume-api-sdk/issues/new/choose`
- Labels: `https://github.com/taihei-05/siglume-api-sdk/labels`
- Settings: `https://github.com/taihei-05/siglume-api-sdk/settings`

## Enable Discussions

In the GitHub web UI:

1. Open `Settings`
2. Open the `Features` section
3. Enable `Discussions`

Suggested first discussion threads:

- `Welcome to the Siglume API Store beta`
- `What API should we build next?`

## Labels To Create

- `api-idea`
- `connector-request`
- `review-support`
- `community-api`
- `launch`
- `bug`

## Seed Issues To Create

1. `[Launch] Public beta launch checklist`
2. `[Example] X Publisher — post agent content to X/Twitter`
3. `[Example] Visual Publisher — generate and publish images`
4. `[Example] MetaMask Connector — wallet balance and transactions`
5. `[Docs] Report onboarding friction in GETTING_STARTED`

> **Note:** Seed issues are examples of what could be built, not assignments.
> Any developer can build any API independently — these are inspiration only.

## Optional CLI Bootstrap

If you are in the standalone SDK repo root and have an authenticated GitHub CLI, run:

```powershell
pwsh -File scripts/bootstrap-community-launch.ps1
```

That script is safe to rerun. It enables Discussions, creates the recommended
labels, and opens the five starter issues above if they are still missing.
