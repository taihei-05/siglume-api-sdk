# Release notes v0.11.0

Breaking release for Siglume connected-account OAuth Architecture B.

## Breaking changes

- Removed platform-managed connected-account OAuth client methods from Python and TypeScript SDKs.
- Removed listing OAuth credential registration helpers from Python and TypeScript SDKs.
- Removed auto-register support for OAuth credential seed payloads.
- Removed public OpenAPI paths for platform OAuth authorize/callback/refresh/revoke and listing OAuth credential mutation.
- Project CLI preflight now rejects `platform_managed` connected-account requirements. Publisher APIs must declare `managed_by="api"` with an absolute `connect_url` and manage OAuth/token storage themselves.

## Publisher migration

Publisher APIs must run OAuth directly, store external-service user tokens outside Siglume, and use the Siglume platform user identity sent at runtime to resolve the publisher-side token record.