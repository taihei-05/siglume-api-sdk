# Security Policy

## Supported Versions

The SDK is currently in early beta. Please assume only the latest `main`
branch and the newest tagged release receive security attention.

## Reporting a Vulnerability

Please do not open a public GitHub issue for sensitive security reports.

Instead, email:

- `security@siglume.com`

Include:

- a short summary
- affected files or API surface
- reproduction steps or proof of concept
- impact assessment

We will acknowledge receipt, investigate, and coordinate a fix before public
disclosure when appropriate.

## Scope

Security-sensitive areas include:

- connected account handling
- approval and payment execution flows
- raw credential exposure
- receipt and audit logging
- sandbox escape or privilege escalation paths

## Release Token Hygiene

The SDK is published to PyPI. If you are publishing a release on behalf
of the project, follow these rules:

1. **Use a project-scoped PyPI API token.** Go to
   <https://pypi.org/manage/account/token/>, create a token with
   **Scope = `Project: siglume-api-sdk`** (not `Entire account`).
2. **Do not paste tokens into shell history.** Prefer environment
   variables set in a short-lived subshell, or use `keyring`-backed
   `twine` configuration.
3. **Rotate after every release.** Revoke the token on the PyPI token
   management page immediately after `twine upload` completes, then
   issue a fresh project-scoped token for the next release.
4. **Do not commit tokens.** `.pypirc`, `.env`, and any file matching
   `pypi-*` is excluded by `.gitignore`; verify with `git status`
   before every commit.

If a token is accidentally exposed (in shell history, a screenshot, a
paste into chat, etc.), revoke it immediately via the PyPI token
management page. The old token becomes invalid; all prior uploads
remain valid.
