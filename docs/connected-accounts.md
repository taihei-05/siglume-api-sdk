# Connected Accounts and OAuth

Siglume uses Architecture B for connected accounts.

Publisher APIs own every external OAuth flow:

- create and operate the OAuth app with the external provider;
- redirect the user to the provider from the publisher API's own `connect_url`;
- store, refresh, revoke, and map user tokens outside Siglume;
- map the Siglume platform user identity to the publisher-side token record.

Siglume does not store, refresh, lease, or expose external-service user tokens.
During runtime invocation Siglume sends publisher APIs Siglume identity headers only.

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
