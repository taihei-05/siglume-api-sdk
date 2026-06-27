# Connected Accounts and OAuth

Siglume uses Architecture B for connected accounts.

Publisher APIs own every external OAuth flow:

- create and operate the OAuth app with the external provider;
- redirect the user to the provider from the publisher API's own `connect_url`;
- store, refresh, revoke, and map user tokens outside Siglume;
- map the Siglume platform user identity to the publisher-side token record.

Siglume does not store, refresh, lease, or expose external-service user tokens.
During runtime invocation Siglume sends publisher APIs Siglume identity headers
only.

## Runtime identity headers

When Siglume calls your `invoke_url` or action endpoint, authenticate the call
with your configured runtime auth header first:

- `runtime_auth_header_name` / `runtime_auth_header_value`, commonly
  `X-Siglume-Auth: <your-runtime-secret>`

After that shared-secret check passes, use these Siglume-provided identity
headers to map the call to your own tenant or OAuth token record:

| Header | Meaning |
|---|---|
| `X-Siglume-Platform-User-Id` | Stable Siglume platform user id for the buyer / agent owner on whose behalf the tool is running. This is the id to map to your publisher-side account or token record. |
| `X-Siglume-Agent-Id` | Siglume agent id executing the call. |
| `X-Siglume-Intent-Id` | Platform execution intent id for audit and idempotency correlation. |
| `X-Siglume-Binding-Id` | Installed-tool binding id. |
| `X-Siglume-Listing-Id` | Product listing id being invoked. |

`X-Siglume-Owner-Id` is not a supported runtime header. Do not fall back to a
shared default owner when `X-Siglume-Platform-User-Id` is missing. For
per-user state, external OAuth, or paid side effects, fail closed and return an
auth/identity error instead.

Siglume may also attach `X-Siglume-Identity-Token`. On the API Store runtime
path this is an opaque Siglume context token, not a public JWT/JWKS
verification contract. Publisher runtimes should treat `X-Siglume-Auth` as the
required channel authentication and then trust `X-Siglume-Platform-User-Id` as
PF-provided identity for that authenticated request. If Siglume later makes
JWT/JWKS verification mandatory, this SDK will document the issuer, audience,
JWKS URL, and rotation contract explicitly.

Declare external authorization requirements with API-managed metadata:

```python
required_connected_accounts=[
    {
        "provider_key": "slack",
        "managed_by": "api",
        "connect_url": "https://api.example.com/oauth/slack/start",
        "required_scopes": ["chat:write"],
    }
]
```

The public SDK exposes no platform OAuth broker, credential seed, token lease,
refresh, or revoke API. Any external account authorization must happen in the
publisher API behind its `connect_url`.
