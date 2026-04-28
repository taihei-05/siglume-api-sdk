# `input_form_spec` — Client-Facing Form Specification

`input_form_spec` is the optional client-facing form specification you can
attach to a listing during `auto-register`. It defines the form an agent or
buyer fills in when invoking your API.

You may write buyer-facing text as plain one-language strings. The platform
normalizes those strings into stored Japanese / English text during
`auto-register`. If you already have both languages, you may also send the
stored `{ "ja": "...", "en": "..." }` shape directly.

It is distinct from `input_schema` (the JSON Schema the runtime uses to
validate the actual tool-call parameters at runtime). Both can coexist; they
are not redundant. See [§ `input_form_spec` vs `input_schema`](#input_form_spec-vs-input_schema).

The machine-checkable schema lives at
[`schemas/input-form-spec.schema.json`](../schemas/input-form-spec.schema.json).

---

## Minimal valid example

```json
{
  "version": "1.0",
  "title": "Wallet lookup",
  "fields": [
    {
      "key": "address",
      "type": "text",
      "label": "Wallet address",
      "description": "0x-prefixed EVM address",
      "placeholder": "0x...",
      "required": true
    }
  ]
}
```

---

## Top-level structure

| Field | Required | Type | Notes |
|---|---|---|---|
| `version` | yes | string | Must be exactly `"1.0"` |
| `title` | yes | localized text | Plain string accepted; platform stores `ja` / `en` |
| `description` | no | localized text | Plain string accepted; platform stores `ja` / `en` |
| `fields` | yes | array | 1–20 items. Single-API `auto-register` accepts all-optional forms; multi-capability / Works composition requires at least one `required: true` field. |
| `sections` | no | array | Optional grouping of fields into ordered titled sections (multi-capability composition only) |

A *localized text* value may be either a plain string or a bilingual object
`{ "ja": "...", "en": "..." }`. Plain strings are the recommended seller input
for `auto-register`; bilingual objects are the stored shape and are accepted
for automation that already owns both translations.

---

## Field types

All fields share these base properties:

| Property | Required | Notes |
|---|---|---|
| `key` | yes | Lowercase + underscores. Must match `^[a-z][a-z0-9_]*$`. Unique within `fields[]`. |
| `type` | yes | One of the 9 types listed below |
| `label` | yes | Localized text |
| `description` | no | Localized text |
| `placeholder` | no (per type) | Localized text. Required for `text` / `textarea` / `url` under multi-capability composition |
| `required` | no | Boolean. Single-API `auto-register` may use all-optional filters; multi-capability / Works composition requires at least one required field. |
| `default` | no | Optional default value. Type must match the field's input type. |
| `tool_bindings` | no | Multi-capability composition only. See [Multi-capability composition](#multi-capability-composition). |

### `text`

Single-line free text.

```json
{
  "key": "address",
  "type": "text",
  "label": { "ja": "Wallet address", "en": "Wallet address" },
  "placeholder": { "ja": "0x...", "en": "0x..." },
  "max_length": 64,
  "required": true
}
```

| Extra | Notes |
|---|---|
| `max_length` | Optional positive integer. |

### `textarea`

Multi-line free text.

```json
{
  "key": "memo",
  "type": "textarea",
  "label": { "ja": "Memo", "en": "Memo" },
  "rows": 5,
  "max_length": 2000
}
```

| Extra | Notes |
|---|---|
| `rows` | Optional positive integer (UI hint). |
| `max_length` | Optional positive integer. |

### `number`

Numeric value.

```json
{
  "key": "amount",
  "type": "number",
  "label": { "ja": "Amount", "en": "Amount" },
  "min": 0,
  "max": 100000,
  "step": 0.01,
  "unit": "USD"
}
```

| Extra | Notes |
|---|---|
| `min`, `max` | Optional bounds. |
| `step` | Optional, must be > 0. |
| `unit` | Informational unit string (not validated). |

Booleans are rejected for number fields.

### `select`

Single-choice dropdown.

```json
{
  "key": "chain",
  "type": "select",
  "label": { "ja": "Chain", "en": "Chain" },
  "options": [
    { "value": "ethereum",  "label": { "ja": "Ethereum",  "en": "Ethereum" } },
    { "value": "polygon",   "label": { "ja": "Polygon",   "en": "Polygon" } }
  ],
  "required": true
}
```

| Extra | Notes |
|---|---|
| `options` | Required, 1–100 items. Each `{ value, label }`. `label` is localized text. |

Submitted value must equal one of the option `value`s. Option labels follow the
same localized text rule as field labels: a plain string is accepted during
`auto-register` and normalized by the platform.

### `multiselect`

Multi-choice list.

```json
{
  "key": "tags",
  "type": "multiselect",
  "label": { "ja": "Tags", "en": "Tags" },
  "options": [
    { "value": "defi",   "label": { "ja": "DeFi",   "en": "DeFi" } },
    { "value": "nft",    "label": { "ja": "NFT",    "en": "NFT" } },
    { "value": "social", "label": { "ja": "Social", "en": "Social" } }
  ],
  "max_selections": 3
}
```

Same `options` rules as `select`. Submitted value must be an array of valid
option `value`s; length capped by `max_selections` if set.

### `file`

File upload. This field type is for AI Works / client-upload flows. API Store
single-listing `auto-register` currently rejects `file` fields until the
uploaded-files transport is exposed for API listings; use a `text` / `url`
field carrying a file reference or URL for now.

```json
{
  "key": "document",
  "type": "file",
  "label": { "ja": "Document", "en": "Document" },
  "accept": [".pdf", ".docx"],
  "max_size_mb": 50,
  "max_files": 1,
  "required": true
}
```

| Extra | Notes |
|---|---|
| `accept` | Optional array of dot-prefixed extensions (`".pdf"`, not `"pdf"`). |
| `max_size_mb` | Optional, must be ≤ 200. |
| `max_files` | Optional positive integer; default 1. |

### `url`

URL string.

```json
{
  "key": "homepage",
  "type": "url",
  "label": { "ja": "Homepage", "en": "Homepage" },
  "placeholder": { "ja": "https://...", "en": "https://..." }
}
```

Submitted value must start with `http://` or `https://`.

### `date`

ISO-8601 calendar date (`YYYY-MM-DD`).

```json
{
  "key": "departure",
  "type": "date",
  "label": { "ja": "Departure", "en": "Departure" },
  "min_date": "2026-01-01",
  "max_date": "2026-12-31"
}
```

### `boolean`

Toggle / checkbox.

```json
{
  "key": "include_history",
  "type": "boolean",
  "label": { "ja": "Include history", "en": "Include history" },
  "default": false
}
```

---

## `input_form_spec` vs `input_schema`

Both are required for a complete listing; they describe two different layers
and the platform validates both.

| | `input_form_spec` | `input_schema` |
|---|---|---|
| Purpose | Client-facing UI form | Runtime parameter validation |
| Audience | Human / agent filling in the form | The platform runtime + LLM tool-use |
| Granularity | "Pick a chain", "Upload a file" | `{ "chain": "ethereum", "file_url": "https://..." }` |
| Format | This spec | JSON Schema (Draft-07 compatible) |
| Required when | You want a buyer / agent to fill in inputs | Always (the runtime needs it to validate calls) |

A single form field maps to one or more parameters in `input_schema`. For
example a `text` field with `key: "address"` typically maps to a property
`{ "address": { "type": "string" } }` in `input_schema`. The platform
enforces type-compatibility between the two — for example, a `number` form
field cannot bind to a `string` schema property.

---

## Common validator errors

| Message | Cause | Fix |
|---|---|---|
| `version must be '1.0'` | Wrong or missing `version` | Set `"version": "1.0"` |
| `title must have both 'ja' and 'en' keys` | Stored form spec was not normalized | Send a plain string through `auto-register`, or provide both stored keys |
| `fields must be a non-empty array` | `fields: []` or missing | Provide at least one field |
| `fields must have at most 20 items` | More than 20 fields | Split or simplify the form |
| `key '...' must match [a-z][a-z0-9_]*` | Uppercase or special chars in key | Use lowercase + underscore only |
| `duplicate key '...'` | Two fields share a key | Each field's `key` must be unique |
| `unsupported type '...'` | Unknown field type | Use one of the 9 types above |
| `label must have both 'ja' and 'en'` | Stored form spec was not normalized | Send a plain string through `auto-register`, or provide both stored keys |
| `at least one field must be required` | All fields are optional in a multi-capability / Works composition form | Mark at least one field as `required: true`, or use single-API `auto-register` where optional-only filter forms are allowed |
| `uploaded_files transport` | `file` field used in API Store `auto-register` | Use a `text` / `url` field for a file reference until API listings expose uploaded-files transport |
| `accept entries must be dot-prefixed extensions like '.pdf' (got '...')` | Missing leading dot | Prefix all extensions with `.` |
| `max_size_mb cannot exceed 200` | File limit too high | Cap at 200 |
| `<type> must have at least 1 option` | Empty `options` on a `select` / `multiselect` | Provide at least 1 option |
| `options cannot exceed 100` | Too many options | Limit to ≤ 100 items |

---

## Multi-capability composition

When a single form drives multiple underlying capabilities, each field can
declare `tool_bindings`:

```json
{
  "key": "target_language",
  "type": "select",
  "label": { "ja": "Target Language", "en": "Target Language" },
  "options": [
    { "value": "ja", "label": { "ja": "Japanese", "en": "Japanese" } },
    { "value": "en", "label": { "ja": "English",  "en": "English"  } }
  ],
  "required": true,
  "tool_bindings": [
    { "capability_release_id": "rel_translate", "param": "target_language" },
    { "capability_release_id": "rel_proofread", "param": "language" }
  ]
}
```

The same field is bound to a different parameter in each downstream
capability. Each `(capability_release_id, param)` pair must appear at most
once across all fields. For most single-capability listings you do not need
`tool_bindings`.

`sections` group field keys into ordered, titled UI sections:

```json
"sections": [
  {
    "key": "source",
    "title": { "ja": "Source", "en": "Source" },
    "field_keys": ["source_file", "source_lang"]
  },
  {
    "key": "target",
    "title": { "ja": "Target", "en": "Target" },
    "field_keys": ["target_lang", "tone"]
  }
]
```

---

## Where `input_form_spec` is used in the publish flow

- `POST /v1/market/capabilities/auto-register` — pass it alongside
  `tool_manual` and other manifest fields. The validator runs before the
  draft listing is created.
- `POST /v1/market/capabilities/{listing_id}/confirm-auto-register` —
  confirmation reuses the form spec submitted at auto-register; it does not
  edit it.

For a CLI flow walkthrough see [`publish-flow.md`](publish-flow.md).
