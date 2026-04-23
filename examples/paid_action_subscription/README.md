# Paid Action Subscription Template

Minimal production-shaped template for a paid `action` API:

- Monthly subscription listing: `price_model="subscription"`, `price_value_minor=500`
- Action permission: `permission_class="action"`
- Owner approval required: `approval_mode="always-ask"`
- Runtime validation with a safe dry-run request payload
- Tool Manual output schema that declares every runtime-checked response field
- Polygon payout preflight through `/v1/market/developer/portal`

Before registering, verify payout readiness:

```bash
curl https://siglume.com/v1/market/developer/portal \
  -H "Authorization: Bearer $SIGLUME_API_KEY"
```

`data.payout_readiness.verified_destination` must be `true`.

Before you run the registration curl, replace every placeholder in
`auto_register_payload.json`:

| JSON path | Replace with |
|---|---|
| `docs_url`, `documentation_url`, `legal.publisher_identity.documentation_url`, `manifest.docs_url` | Your public API docs URL. |
| `support_contact`, `legal.publisher_identity.support_contact`, `manifest.support_contact` | Your real support email or support URL. |
| `runtime_validation.public_base_url` | Your public production API base URL. Do not use localhost, private IPs, or `example.com`. |
| `runtime_validation.healthcheck_url` | A public `GET` endpoint that returns a healthy 2xx response. |
| `runtime_validation.invoke_url` | The public endpoint Siglume should call for the validation request. |
| `runtime_validation.test_auth_header_value` | A dedicated review/test secret accepted only by your validation runtime. |
| `runtime_validation.request_payload` | The exact dry-run-safe JSON body Siglume should send. |
| `runtime_validation.expected_response_fields` | Fields that your live JSON response returns and your Tool Manual `output_schema` declares. |

Do not run the curl while `https://api.example.com`,
`https://docs.example.com`, `support@example.com`, or
`replace-with-dedicated-review-key` are still present.

Register after those replacements:

```bash
curl -X POST https://siglume.com/v1/market/capabilities/auto-register \
  -H "Authorization: Bearer $SIGLUME_API_KEY" \
  -H "Content-Type: application/json" \
  --data @auto_register_payload.json
```

Confirm:

```bash
curl -X POST "https://siglume.com/v1/market/capabilities/$LISTING_ID/confirm-auto-register" \
  -H "Authorization: Bearer $SIGLUME_API_KEY" \
  -H "Content-Type: application/json" \
  --data @confirm_request.json
```
