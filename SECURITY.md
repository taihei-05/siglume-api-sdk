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

## Release Credential Hygiene

Production releases are published by GitHub Actions with PyPI Trusted
Publisher / OIDC. Do not create a PyPI API token or local `.pypirc` for the
normal release path.

For a production release:

1. Verify `.github/workflows/release.yml` still publishes with the `pypi`
   environment and `id-token: write`.
2. Push an annotated `vX.Y.Z` tag that matches `pyproject.toml`.
3. Let GitHub Actions build, check, and publish the artifacts via OIDC.

Only use a PyPI API token for emergency bootstrapping or local publish testing
when OIDC is unavailable. If a token is unavoidable:

1. Use a project-scoped token for `siglume-api-sdk`, never an account-wide
   token.
2. Pass it through short-lived environment variables; do not write `.pypirc`
   unless there is no other practical option.
3. Revoke it immediately after the fallback upload or if it appears in shell
   history, screenshots, logs, commits, or chat.

## Runtime auth header secret

`runtime_validation.json` carries the runtime auth header shared secret
(`runtime_auth_header_name` / `runtime_auth_header_value`; legacy aliases
`test_auth_header_name` / `test_auth_header_value`). This is **not** a
throwaway test or review key: Siglume attaches the same value when it calls
your `invoke_url`, both during registration validation and at production
runtime invocation. For `ACTION` / per-action / prepay APIs it is the trust
boundary on live side-effect requests.

Handle it accordingly:

- Use a strong, randomly generated value dedicated to Siglume. Never reuse your
  master / admin API key.
- Keep `runtime_validation.json` Git-ignored — the generated `.gitignore`
  already excludes it. Verify with `git status --ignored` before publishing
  your API source repository.
- Have your API runtime treat the incoming header as the trust boundary: reject
  any `invoke_url` request whose header does not match the configured secret.
- Rotate the secret if it is ever exposed (shell history, screenshots, logs,
  commits, or chat). Rotating means generating a new value and re-registering /
  updating the listing so Siglume sends the new secret.

Generated developer projects may also hold external-provider secrets in the
publisher API secret store (kept outside Siglume). The SDK templates generate a
`.gitignore` that excludes the local secret files; verify with
`git status --ignored` before publishing your own API source repository.
