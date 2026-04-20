# GitHub Issue And Discussion Content

Copy from these sections into the public SDK repo's seeded issues and discussions.

---

## Issue #2: X Publisher

`[Example] X Publisher for Siglume`

Build a reviewable beta-ready API that lets a Siglume agent prepare and publish content to X or Twitter safely.

### Why this matters

This is one of the clearest examples of the Siglume API Store value proposition:

- an agent produces useful analysis inside Siglume
- the owner installs an API
- the agent can now distribute that work outside Siglume

For developers, it is also a strong first community API because the user value is obvious and the risk is manageable compared with money-moving APIs.

### Current beta constraints

- Both free and paid subscription APIs are supported.
- Free APIs: use `price_model="free"`.
- Subscription APIs: use `price_model="subscription"` with `price_value_minor` in cents (minimum $5.00/month = 500).
- Developers earn 93.4% of subscription revenue via Stripe Connect.

### Target capabilities

- create a post draft from agent-generated content
- enforce X-friendly formatting
- support dry-run preview before any side effect
- require owner approval before live posting
- return a clear execution receipt after a successful post

### Suggested feature scope

1. Input shaping
   - plain post
   - thread candidate
   - scheduled post request
2. Formatting
   - 280-character handling
   - hashtag extraction
   - thread splitting rules
3. Connected account
   - X OAuth integration
   - scoped account reference only, never raw credentials in API code
4. Safety
   - dry-run preview
   - approval prompt
   - idempotent publish path
5. Receipts
   - tweet id
   - canonical URL
   - summary of what was posted

### Recommended manifest shape

- `permission_class="action"`
- `approval_mode="always_ask"`
- `dry_run_supported=true`
- `required_connected_accounts=["x-twitter"]`

### Acceptance bar

- passes `AppTestHarness`
- has stub coverage for the X API path
- implements dry-run and action behavior separately
- returns useful receipt data
- documents any remaining TODOs for analytics or scheduling

### Starter code

- `examples/x_publisher.py`
- `API_IDEAS.md`
- `GETTING_STARTED.md`

If you want to build this, comment with:

- your implementation approach
- whether you want to own the full API or a smaller slice
- any blocker you need help with

---

## Issue #3: Visual Publisher

`[Example] Visual Publisher`

Build a community API that lets agents generate an image, compose a caption, and publish the result safely to X or another social channel.

### Why this matters

This API makes the "my agent can do more now" value instantly visible:

- the agent becomes not just a writer, but also a lightweight creative operator
- the output is easy to demo
- the store benefit is obvious to both developers and end users

### Current beta constraints

- Both free and paid subscription APIs are supported.
- Free APIs: use `price_model="free"`.
- Subscription APIs: use `price_model="subscription"` with `price_value_minor` in cents (minimum $5.00/month = 500).
- Developers earn 93.4% of subscription revenue via Stripe Connect.

### Target workflow

1. receive a prompt or structured content from the agent
2. generate an image preview
3. generate caption and alt text
4. present a dry-run preview
5. ask for owner approval
6. publish through the connected account path
7. return an execution receipt

### Suggested feature scope

- image generation provider abstraction
- caption generation
- accessible alt text generation
- media upload and publish flow
- template or style presets
- clean receipt output with image URL and post URL

### Recommended manifest shape

- `permission_class="action"`
- `approval_mode="always_ask"`
- `dry_run_supported=true`
- `required_connected_accounts=["x-twitter", "openai"]`

### Acceptance bar

- passes `AppTestHarness`
- includes stub providers for image generation and social publishing
- dry-run returns preview metadata without side effects
- live action returns a receipt summary
- clearly marks provider-specific TODOs

### Starter code

- `examples/visual_publisher.py`
- `docs/dry-run-and-approval.md`
- `docs/execution-receipts.md`

Comment if you want to build this with:

- provider choice
- expected MVP scope
- any extra connected-account support you need

---

## Issue #4: MetaMask Connector

`[Example] MetaMask Connector`

Build a high-safety wallet API for Siglume agents. This is the most sensitive community API in the first wave, so the rollout should be intentionally staged.

### Why this matters

Wallet-connected agent workflows are strategically important, but they are also the easiest place to create expensive mistakes. We want contributors who are comfortable designing for safety first.

### Current beta constraints

- Both free and paid subscription APIs are supported.
- Free APIs: use `price_model="free"`.
- Subscription APIs: use `price_model="subscription"` with `price_value_minor` in cents (minimum $5.00/month = 500).
- Developers earn 93.4% of subscription revenue via Stripe Connect.
- For now, treat this as a safety-first technical contribution, not a monetized listing.

### Recommended rollout phases

#### Phase 1: Read-only

- wallet balance lookup
- network metadata
- transaction status lookup

#### Phase 2: Quote and preparation

- build transfer quotes
- estimate gas
- prepare unsigned transaction payloads
- generate approval-friendly summaries

#### Phase 3: Submission

- explicit approval flow
- signature request
- transaction broadcast
- execution receipt and audit trail

### Required safety properties

- strict dry-run behavior
- explicit approval requirement
- idempotency protection
- no raw credentials in API code
- clear receipts for quote, prepared transaction, and submitted transaction
- conservative failure behavior

### Recommended manifest shape

- `permission_class="payment"`
- `approval_mode="always_ask"`
- `dry_run_supported=true`
- `required_connected_accounts=["metamask"]`

### Acceptance bar

- read-only and quote modes are solid before live submission is attempted
- clear separation between quote, action, and payment execution kinds
- stubbed tests cover error paths
- documentation explains safety boundaries and unsupported cases

### Starter code

- `examples/metamask_connector.py`
- `docs/connected-accounts.md`
- `docs/dry-run-and-approval.md`

If you want to work on this, please comment with:

- which rollout phase you want to own
- wallet stack or provider assumptions
- how you plan to handle idempotency and approvals

---

## Discussion #6: Welcome To The Siglume API Store Beta

Welcome to the public developer beta for the Siglume API Store.

Siglume is an AI agent platform. The API Store is the extension layer where developers can give agents new capabilities through installable APIs and power-up kits.

### Where the beta stands today

- Both free and subscription listings are live
- API listings can be created, reviewed, published, licensed, and installed
- Payments and payouts are live via Stripe Connect
- economics: 93.4 percent to developers and 6.6 percent platform fee

### Good first steps

1. run `examples/hello_price_compare.py`
2. read `GETTING_STARTED.md`
3. browse `API_IDEAS.md`
4. pick one starter API or propose your own

### Introduce yourself

Reply with:

- what kind of API you want to build
- which external system you want to connect
- where setup felt rough or unclear

If you are looking for a place to start, the first three recommended APIs are:

- X Publisher
- Visual Publisher
- MetaMask Connector

We are keeping the beta honest on purpose. If something feels incomplete, confusing, or too implicit, please tell us directly.

---

## Discussion #7: What API Should We Build Next?

What API would make a Siglume agent meaningfully more useful?

We are especially interested in job-to-be-done API ideas where the value is instantly clear to a developer or end user.

### Strong proposal pattern

Please post using this format:

- API name
- one-line job to be done
- required connected accounts
- permission class
- why an agent would want this capability
- whether it should start as read-only, recommendation, action, or payment

### Example ideas

#### Shopping Scout

- compares products across multiple stores
- summarizes tradeoffs
- prepares an approval-safe purchase recommendation

#### Calendar Sync

- checks availability
- prepares meeting suggestions
- creates events after approval

#### Translation Hub

- translates content for multilingual communities
- prepares channel-ready output
- supports glossary or style preferences

We also want to hear about APIs outside these examples, especially if they make the "install this and your agent can suddenly do X" story very obvious.
