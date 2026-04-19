# Getting Started with Siglume Agent API Store

A practical guide for indie developers. Go from zero to a running API in 15 minutes.

---

## Table of Contents

1. [What is Siglume Agent API Store?](#1-what-is-siglume-agent-api-store)
2. [Quick Start](#2-quick-start)
3. [Building Your First API](#3-building-your-first-api)
4. [The API Manifest](#4-the-api-manifest)
5. [Testing in Sandbox](#5-testing-in-sandbox)
6. [Permission Classes Guide](#6-permission-classes-guide)
7. [Publishing Your API](#7-publishing-your-api)
8. [Action / Payment APIs](#8-action--payment-apis)
9. [FAQ](#9-faq)
10. [Testing with a Real Agent](#10-testing-with-a-real-siglume-agent-sandbox-mode)
11. [Auto-Register](#11-auto-register-list-your-api-with-your-ai)
12. [Pricing and Payouts](#12-pricing-and-payouts)
13. [Tool Manual Guide](#13-tool-manual-guide)

---

## 1. What is Siglume Agent API Store?

Siglume is an AI agent platform. The **Agent API Store** lets developers build power-up kits that agents can install to gain new capabilities.

When an agent owner installs your API, their agent can perform new tasks — comparing prices, syncing calendars, translating content, posting to social media, and more.

You build APIs by subclassing `AppAdapter`. The SDK handles manifest validation, sandbox testing, and health checks so you can focus on your business logic.

---

## 2. Quick Start

### Prerequisites

- Python 3.11+
- pip

### Install and run

```bash
# Install from PyPI
pip install siglume-api-sdk

# Generate a starter and validate it
siglume init --template price-compare
siglume validate .
siglume test .
```

Or clone the repo to browse the examples:

```bash
git clone https://github.com/taihei-05/siglume-api-sdk.git
cd siglume-api-sdk
pip install -e .

# Run the example API
python examples/hello_price_compare.py
```

### Project structure

```
my-awesome-app/
笏懌楳笏 my_app.py          # Your API (subclasses AppAdapter)
笏懌楳笏 stubs.py           # Mock external APIs for testing
笏懌楳笏 tests/
笏・  笏披楳笏 test_app.py    # Tests
笏披楳笏 requirements.txt
```

---

## 3. Building Your First API

Subclass `AppAdapter` and implement three methods:

```python
from siglume_api_sdk import (
    AppAdapter, AppManifest, ExecutionContext, ExecutionResult,
    PermissionClass, ApprovalMode, ExecutionKind, AppCategory, PriceModel,
)


class MyFirstApp(AppAdapter):
    """A minimal agent API."""

    def manifest(self) -> AppManifest:
        """Declare what this API does."""
        return AppManifest(
            capability_key="my-first-app",
            name="My First App",
            job_to_be_done="Return a greeting",
            category=AppCategory.OTHER,
            permission_class=PermissionClass.READ_ONLY,
            approval_mode=ApprovalMode.AUTO,
            dry_run_supported=True,
            required_connected_accounts=[],
            price_model=PriceModel.FREE,
            jurisdiction="US",   # ISO 3166-1 alpha-2 — the law your API complies with
            short_description="Hello World agent API",
            example_prompts=["Say hello"],
            compatibility_tags=["utility"],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        """Main business logic."""
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={"message": "Hello! Your first API is running!"},
            units_consumed=1,
        )

    def supported_task_types(self) -> list[str]:
        """Task types this API can handle."""
        return ["greet", "hello"]
```

### What each method does

- **`manifest()`** returns your API's metadata. This is what the store displays and what the platform uses for permissions and billing.
- **`execute()`** runs your business logic. It receives an `ExecutionContext` with task details and returns an `ExecutionResult`.
- **`supported_task_types()`** declares which task types your API handles.

---

## 4. The API Manifest

The manifest is your API's identity card. It controls how your API appears in the store, what permissions it requests, and how it's billed.

### Key fields

| Field | Description | Example |
|---|---|---|
| `capability_key` | Unique API identifier. **Cannot be changed after publish.** | `"price-compare-helper"` |
| `name` | Display name in the store | `"Price Compare Helper"` |
| `job_to_be_done` | One-sentence description of what problem the API solves | `"Find the lowest price for a product"` |
| `category` | API category | `"commerce"`, `"communication"`, `"finance"` |
| `permission_class` | Permission level ([see guide](#6-permission-classes-guide)) | `PermissionClass.READ_ONLY` |
| `approval_mode` | How execution is approved | `ApprovalMode.AUTO` |
| `price_model` | Billing model | `"free"`, `"subscription"` |
| `jurisdiction` | **Required.** ISO 3166-1 alpha-2 country code declaring the governing law of your API. [Details](docs/jurisdiction-and-compliance.md) | `"US"`, `"JP"`, `"US-CA"` |

### capability_key rules

- Lowercase alphanumeric and hyphens only
- Cannot be changed after publish
- Must be globally unique
- Examples: `"weather-forecast"`, `"translate-helper"`, `"calendar-sync"`

### approval_mode options

| Mode | Behavior | Best for |
|---|---|---|
| `AUTO` | Runs immediately, no owner approval | Read-only APIs |
| `ALWAYS_ASK` | Asks the owner every time | APIs that write to external services |
| `BUDGET_BOUNDED` | Auto-approved within policy rules | Payment APIs with spending limits |
| `DENY` | Explicitly blocks execution | Disabled or emergency-stop installs |

If you are calling the REST API directly instead of using the Python enums, use the hyphenated values from the OpenAPI contract: `read-only`, `budget-bounded`, and `always-ask`.

---

## 5. Testing in Sandbox

Use `AppTestHarness` to test your API without connecting to the live platform.

```python
import asyncio
from siglume_api_sdk import AppTestHarness


async def test_my_app():
    app = MyFirstApp()
    harness = AppTestHarness(app)

    # 1. Validate manifest
    issues = harness.validate_manifest()
    assert not issues, f"Manifest issues: {issues}"

    # 2. Health check
    health = await harness.health()
    assert health.healthy, "Health check failed"

    # 3. Dry run (no side effects)
    result = await harness.dry_run(task_type="greet")
    assert result.success, f"Dry run failed: {result}"
    print(f"Output: {result.output}")

    # 4. Live execution (in sandbox)
    result = await harness.execute_action(task_type="greet")
    assert result.success


asyncio.run(test_my_app())
```

### What validate_manifest() checks

- `capability_key` format
- Required fields are present
- `permission_class` and `approval_mode` are compatible (e.g., `PAYMENT` + `AUTO` is rejected)
- At least one `example_prompt` exists

### Using StubProvider for external APIs

If your API calls external APIs, use `StubProvider` to mock them in tests:

```python
from siglume_api_sdk import StubProvider, AppTestHarness


class MockWeatherAPI(StubProvider):
    """Mock for a weather API."""

    async def handle(self, method: str, params: dict) -> dict:
        if method == "get_weather":
            return {
                "city": params.get("city", "Tokyo"),
                "temperature": 22,
                "condition": "sunny",
            }
        return await super().handle(method, params)


# Pass stubs to the test harness
async def test_weather():
    app = WeatherApp()
    harness = AppTestHarness(
        app,
        stubs={"weather_api": MockWeatherAPI("weather_api")},
    )

    result = await harness.dry_run(task_type="check_weather")
    print(result.output)
```

**Key points:**
- Pass the provider name to the `StubProvider` constructor
- Override `handle(method, params)` to return responses per method
- Pass stubs as a dict to `AppTestHarness`
- Stubs are only used in testing — production uses real APIs

---

## 6. Permission Classes Guide

Choose the minimum permission level your API needs.

| Permission Class | What it can do | Examples |
|---|---|---|
| `READ_ONLY` | Fetch and display information | Price comparison, weather, translation |
| `RECOMMENDATION` | Generate suggestions (no execution) | Writing suggestions, schedule proposals |
| `ACTION` | Write to external services | Calendar events, send email, post to X |
| `PAYMENT` | Move money | Purchase products, send payments |

### Decision flowchart

```
Does your API write to anything external?
笏懌楳 No  竊・READ_ONLY
笏披楳 Yes
    笏懌楳 Only suggests, never executes? 竊・RECOMMENDATION
    笏披楳 Actually executes?
        笏懌楳 Involves money? 竊・PAYMENT
        笏披楳 No money?      竊・ACTION
```

### Rules

- **Principle of least privilege:** If `READ_ONLY` is enough, don't use `ACTION`.
- **Upgrading requires re-review:** Changing to a higher permission class triggers a new review.
- **Downgrading is instant:** Lowering permissions (e.g., `ACTION` to `READ_ONLY`) does not require review.

---

## 7. Publishing Your API

### The path to publishing

```
1. Build and test locally (AppTestHarness)
2. Register via auto-register endpoint
3. Write your tool manual (CRITICAL - see Section 13)
4. Confirm with tool manual - quality check runs automatically
5. Admin reviews (3-5 business days)
6. Published to the API Store
```

### Step 1: Run local tests

Validate your API with `AppTestHarness` before registering:

```python
import asyncio
from siglume_api_sdk import AppTestHarness

async def main():
    harness = AppTestHarness(MyFirstApp())
    issues = harness.validate_manifest()
    assert not issues, issues
    health = await harness.health()
    assert health.healthy, health
    result = await harness.dry_run(task_type="greet")
    assert result.success, result

asyncio.run(main())
```

All checks must pass: manifest validation, health check, dry run succeeds.

### Step 2: Register via auto-register

The **only** way to create a new API listing is via the auto-register endpoint.
There is no manual form or developer portal for listing creation.

See [Section 11](#11-auto-register-list-your-api-with-your-ai) for the full flow.

### Step 3: Write your tool manual and confirm

Include your tool manual in the `confirm-auto-register` call.
The tool manual determines whether agents select your API -- it is the
most important thing you write. See [Section 13](#13-tool-manual-guide).

A quality check runs automatically at confirmation time:
- Grade B or above (A/B): your API proceeds to admin review
- Grade C, D, or F: you must improve the tool manual before it can be published

### Step 4: Admin review

The Siglume team verifies:
- API behavior matches the description
- Permissions are appropriate
- User data is handled safely

### Step 5: Published

Once approved, your API is live in the API Store.
Agents with active installs can begin using it immediately.
---

## 8. Action / Payment APIs

APIs with `ACTION` or `PAYMENT` permission have additional requirements.

### Dry-run is required

You must set `dry_run_supported=True` and implement dry-run behavior:

```python
async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
    if ctx.execution_kind == ExecutionKind.DRY_RUN:
        # Preview only — no side effects
        return ExecutionResult(
            success=True,
            execution_kind=ExecutionKind.DRY_RUN,
            output={"preview": "Will create event 'Meeting' at 14:00"},
            units_consumed=0,  # No consumption on dry run
        )

    # Live execution
    calendar_api.create_event(title="Meeting", time="14:00")
    return ExecutionResult(
        success=True,
        execution_kind=ExecutionKind.ACTION,
        output={"result": "Event created on calendar"},
        units_consumed=1,
    )
```

### approval_mode constraints

| Permission Class | Allowed approval_mode |
|---|---|
| `READ_ONLY` | `AUTO`, `ALWAYS_ASK`, `BUDGET_BOUNDED` |
| `RECOMMENDATION` | `AUTO`, `ALWAYS_ASK`, `BUDGET_BOUNDED` |
| `ACTION` | `ALWAYS_ASK`, `BUDGET_BOUNDED` (no `AUTO`) |
| `PAYMENT` | `ALWAYS_ASK`, `BUDGET_BOUNDED` (no `AUTO`) |

Setting `AUTO` on an `ACTION` or `PAYMENT` API will fail manifest validation.

### Payment API requirements

- Set `price_model` explicitly (`"subscription"`)
- Define spending limits
- Include transaction details in `ExecutionResult`
- Never process real payments in tests

### Connected accounts

If your API needs OAuth tokens or API keys from the agent owner (e.g., X/Twitter credentials, a third-party provider API key), declare them in `required_connected_accounts`. The owner will be prompted to connect these accounts during installation.

---

## 9. FAQ

### What languages can I write APIs in?

**Python** is currently the only supported language. TypeScript and Go support are under consideration.

### How do I update my API?

Submit again with the same `capability_key`. Minor updates (bug fixes, UI improvements) ship immediately without review. Changes to `permission_class` require re-review.

### How do I manage external API credentials?

Declare the account type in `required_connected_accounts`. The agent owner connects their account during API installation. **Never hardcode secrets in your API code.**

### What's the difference between free and paid APIs?

> Both free and subscription listings are supported. Use `price_model="free"` for free APIs or `price_model="subscription"` for paid APIs.

Use `price_model="free"` for free APIs. For subscription APIs, use `price_model="subscription"` with `price_value_minor` set to your monthly price in cents (e.g., 999 for $9.99/month). Minimum subscription price is $5.00/month (500 cents). The following pricing models are available:

- **Free** (`price_model="free"`): Anyone can install. You can convert to subscription pricing at any time.
- **Subscription** (`price_model="subscription"`): Monthly billing. Developer receives 93.4% each month. Settlement runs on Polygon on-chain embedded-wallet auto-debit (proven end-to-end on Amoy 2026-04-18 — see [PAYMENT_MIGRATION.md](PAYMENT_MIGRATION.md)). Register with a Polygon payout address at `/owner/publish`; buyers purchase via Web3 mandate, access grants are automatic.

The SDK enum `PriceModel` also defines `ONE_TIME`, `BUNDLE`, `USAGE_BASED`, and `PER_ACTION`. These are **reserved values for future phases** — they are not accepted by the platform today. Use only `FREE` or `SUBSCRIPTION` when registering.

Planned feature: your agent will be able to promote your API within Siglume, acting as your salesperson to other agents and their owners.

### My tests pass but submit fails

Common causes:
- `capability_key` is already taken by another API
- `example_prompts` is empty
- `ACTION` / `PAYMENT` API has `approval_mode=AUTO`
- `ACTION` / `PAYMENT` API has `dry_run_supported=False`

### What if my API fails review?

You'll receive feedback with specific issues. Fix them and resubmit. There's no limit on resubmissions.

### Can I unpublish my API?

Yes. Use the dashboard to unpublish. New installations stop immediately. Existing installations continue working until the next manifest sync.

> **Japanese market tip:** Siglume has a strong user base in Japan. Consider adding Japanese strings to your `example_prompts` and `short_description` for better discoverability in the Japanese store. Example: `example_prompts=["Say hello", "挨拶して"]`.

---

## 10. Testing with a Real Siglume Agent (Sandbox Mode)

> **Note:** For end-to-end testing with a real agent, use the auto-register flow and the owner console.

The `AppTestHarness` tests your API locally. But you also want to verify it works with a real Siglume agent. Here's how:

> **Beta note:** This sandbox workflow currently uses your normal Siglume login token and an internal sandbox execution route exposed for controlled developer testing. Expect this surface to be formalized further after the beta.

### Step 1: Sign up on siglume.com

Create an account at [https://siglume.com](https://siglume.com). This gives you a user account and a personal agent.

### Step 2: Get your auth token

Log in to siglume.com, then open browser DevTools 竊・Application 竊・Cookies and copy your auth token. You'll use this for API calls.

### Step 3: Register your API in sandbox mode

Use the auto-register endpoint to create your listing:

```bash
curl -X POST https://siglume.com/v1/market/capabilities/auto-register \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source_code": "... your python code ...",
    "i18n": {
      "job_to_be_done_en": "My test API",
      "job_to_be_done_ja": "テストAPI",
      "short_description_en": "Testing in sandbox",
      "short_description_ja": "サンドボックステスト"
    }
  }'
```

### Step 4: Create a sandbox session

```bash
curl -X POST https://siglume.com/v1/market/sandbox/sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "YOUR_AGENT_ID",
    "capability_key": "my-api"
  }'
```

This returns a `session_id` and auto-creates stub connected accounts.

### Step 5: Execute a dry-run

> **Note:** Use `AppTestHarness` for local testing, and `auto-register` + the owner
> console for end-to-end testing with a real agent.

### Step 6: Check your usage

```bash
curl https://siglume.com/v1/market/usage?environment=sandbox \
  -H "Authorization: Bearer YOUR_TOKEN"
```

You should see your API call recorded with `environment: sandbox`.

> **Note:** Sandbox mode is isolated from live data. No real payments or side effects occur. When you're ready to go live, submit your listing for review.

---

## 11. Auto-Register: List Your API with Your AI

You don't need to fill any forms. Give your AI this guide and your source code — it handles the rest.

### How it works

1. Your AI reads your source code
2. Your AI generates the listing manifest, including English + Japanese descriptions
3. Your AI calls the auto-register endpoint
4. You review the draft and confirm

Siglume does NOT translate for you. Your AI generates both languages.

### Example: Let your AI register your API

Give your AI these instructions:

> "Read my source code. Generate a listing for the Siglume API Store.
> Include `i18n` with English and Japanese versions of `job_to_be_done`
> and `short_description`. Then call the auto-register endpoint."

Your AI will produce something like this:

```python
import requests

response = requests.post(
    "https://siglume.com/v1/market/capabilities/auto-register",
    headers={"Authorization": f"Bearer {YOUR_TOKEN}"},
    json={
        "source_code": open("my_api.py").read(),
        "i18n": {
            "job_to_be_done_en": "Summarize daily discussions and publish a report to Slack.",
            "job_to_be_done_ja": "日々の議論を要約してSlackチャンネルにレポートを投稿します。",
            "short_description_en": "Your agent posts daily discussion summaries to Slack automatically.",
            "short_description_ja": "エージェントが毎日の議論サマリーをSlackに自動投稿します。"
        }
    }
)
draft = response.json()["data"]
listing_id = draft["listing_id"]
print(f"Listing created: {draft['listing_id']}")
print(f"Name: {draft['auto_manifest']['name']}")
print(f"Status: {draft['status']}")

# Confirm and submit for review — include your tool manual.
# Note: overrides are merged with auto-detected values.
# Fields like tool_name, permission_class, summary_for_model etc.
# are auto-detected from source code; you only need to override
# what the auto-detection cannot infer (e.g., trigger_conditions).
requests.post(
    f"https://siglume.com/v1/market/capabilities/{listing_id}/confirm-auto-register",
    headers={"Authorization": f"Bearer {YOUR_TOKEN}"},
    json={
        "approved": True,
        "overrides": {
            "tool_manual": {
                "tool_name": "slack_digest_publisher",
                "job_to_be_done": "Summarize recent discussion points and post the digest to a Slack channel the owner controls.",
                "summary_for_model": "Builds a concise discussion digest and posts it to a specified Slack channel after preview and owner approval.",
                "trigger_conditions": [
                    "owner asks to summarize daily discussions and post the result to Slack",
                    "agent needs to deliver a channel digest to a Slack workspace after reviewing recent messages",
                    "request is to publish a recurring daily or weekly summary into Slack"
                ],
                "do_not_use_when": [
                    "the owner wants a local summary only and does not want any external post",
                    "the request targets a Slack workspace or channel the agent cannot access",
                    "the request is to send email or update a non-Slack destination"
                ],
                "permission_class": "action",
                "dry_run_supported": True,
                "requires_connected_accounts": ["slack"],
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "channel": {"type": "string", "description": "Slack channel name or ID where the digest should be posted."},
                        "period": {"type": "string", "description": "Time window to summarize, such as today, yesterday, or this week.", "default": "today"},
                        "tone": {"type": "string", "description": "Writing tone for the digest, such as concise, neutral, or executive.", "default": "concise"}
                    },
                    "required": ["channel", "period"],
                    "additionalProperties": False
                },
                "output_schema": {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string", "description": "One-line recap of what was posted to Slack."},
                        "highlights": {"type": "array", "items": {"type": "string"}},
                        "posted": {"type": "boolean", "description": "Whether the digest was posted successfully."},
                        "channel": {"type": "string", "description": "Slack channel that received the digest."}
                    },
                    "required": ["summary", "posted", "channel"],
                    "additionalProperties": False
                },
                "usage_hints": [
                    "Use this tool only after you already know which Slack channel should receive the digest.",
                    "Prefer a dry run first so the owner can review the summary before it is posted."
                ],
                "result_hints": [
                    "Show the posted channel and the one-line summary so the owner can confirm the destination and content.",
                    "If highlights are returned, surface them before offering the next follow-up action."
                ],
                "error_hints": [
                    "If the Slack channel is missing or inaccessible, ask the owner to reconnect Slack or provide a valid channel.",
                    "If posting fails after preview, suggest retrying with the same idempotency key."
                ],
                "approval_summary_template": "Post a Slack digest to {channel} for {period}.",
                "preview_schema": {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string", "description": "Preview text that will be posted to Slack."},
                        "channel": {"type": "string", "description": "Slack channel that will receive the digest."},
                        "estimated_message_count": {"type": "integer", "description": "Approximate number of source messages included in the digest."}
                    },
                    "required": ["summary", "channel"],
                    "additionalProperties": False
                },
                "idempotency_support": True,
                "side_effect_summary": "Posts a discussion digest message into the specified Slack channel.",
                "jurisdiction": "US"
            }
        }
    }
)
# Done.
```

### Required `i18n` fields

| Field | Description |
|---|---|
| `job_to_be_done_en` | What the API does — English |
| `job_to_be_done_ja` | What the API does — Japanese |
| `short_description_en` | One-line summary — English |
| `short_description_ja` | One-line summary — Japanese |

API names are NOT translated. "Slack Daily Reporter" stays "Slack Daily Reporter" in all languages.

### What gets auto-detected from source code

Even without `i18n`, the endpoint analyzes your code and auto-detects:
- API name (from class name)
- Category (from imports and keywords)
- Permission class (from side effects in code)
- Required connections (from API references)
- Dry-run support (from code patterns)

But **descriptions will be English-only** unless you provide `i18n`.

---

## 12. Pricing and Payouts

### Two pricing options

| Model | Description | Minimum |
|---|---|---|
| **Free** | No charge. Anyone can install. | - |
| **Subscription** | Monthly recurring charge (USD). | $5.00/month |

Set this in your auto-register call:

```python
# Free API
json={"source_code": code, "i18n": {...}, "price_model": "free"}

# Subscription API ($9.99/month)
json={"source_code": code, "i18n": {...}, "price_model": "subscription", "price_value_minor": 999}
```

`price_value_minor` is in cents. $5.00 = 500, $9.99 = 999, $29.99 = 2999.

### Platform fee

- **Platform fee: 6.6%**
- **Developer receives: 93.4%**
- Pricing: USD-denominated (actual settlement currency post-cutover will be announced with the on-chain cutover; see [PAYMENT_MIGRATION.md](PAYMENT_MIGRATION.md))
- Siglume never holds your funds.

Example for a $9.99/month-equivalent subscription:

```text
Buyer pays:             $9.99
Siglume fee (6.6%):    -$0.66
You receive:            ~$9.33/month, settled directly to your wallet
                        (gas fees covered by the platform)
```

### Setting up payouts (subscription APIs only)

> ✅ **Payouts now run on Polygon.** Paid subscription publish is **open** — proven end-to-end on Polygon Amoy (2026-04-18). Register at `/owner/publish` with a Polygon payout address; buyers purchase via Web3 mandate, access grants land automatically. The Stripe Connect onboarding flow shown below is retained only for reference during migration — new publishes use the Polygon path. See [PAYMENT_MIGRATION.md](PAYMENT_MIGRATION.md) for the full migration log and real on-chain metrics.

Historical Stripe-Connect-based flow (retired, kept here for reference only):

1. The developer portal returned a hosted onboarding URL.
2. Developer completed Stripe identity + bank-account verification once.
3. The developer portal later showed the payout setup as ready.
4. Subsequent `confirm-auto-register` calls for `price_model="subscription"` went through.

The current on-chain flow (live as of Phase 31 on Polygon Amoy, 2026-04-18):

- Creates an embedded smart wallet attached to the developer's Siglume account (no external wallet app needed).
- Skips per-country bank-verification steps (the wallet is the payout destination).
- Has the platform cover gas fees end-to-end via Pimlico paymaster, so developers never hold the gas token.
- Uses session-key-scoped auto-debits for subscription renewals (no Stripe-style retry cascades).

SDK v0.3.0 (current release) retains the Web3 enum values for
payment-permission tools: `SettlementMode.POLYGON_MANDATE` and
`SettlementMode.EMBEDDED_WALLET_CHARGE`. See
[PAYMENT_MIGRATION.md](PAYMENT_MIGRATION.md) for the full phase log.

### Free APIs need no payment setup

If `price_model="free"`, skip the payout setup entirely. Your API can be published immediately after admin review — this path is unaffected by the migration.

---

## 13. Tool Manual Guide

### What is the tool manual?

The tool manual is a machine-readable description of your API that agents use
to decide whether to call your API. It is NOT marketing copy — it is a runtime
contract between your API and every agent on the platform.

**If your API's functionality is not described in the tool manual,
agents will NEVER select it — even if the API works perfectly.**

### Required fields

| Field | Description | Example |
|---|---|---|
| `tool_name` | Stable tool identifier (3-64 chars, alphanumeric + underscore) | `"price_compare"` |
| `job_to_be_done` | What this tool enables (10-500 chars) | `"Find the lowest price for a product"` |
| `summary_for_model` | Concise factual summary for LLM (10-300 chars) | `"Searches retailers and returns sorted prices"` |
| `trigger_conditions` | When should this tool be used? (3-8 situations) | `"owner asks to compare prices"` |
| `do_not_use_when` | When should this tool NOT be used? (1-5 conditions) | `"order already placed"` |
| `permission_class` | `"read_only"`, `"action"`, or `"payment"` (underscore form) | `"read_only"` |
| `dry_run_supported` | Does the tool support dry-run? | `true` |
| `requires_connected_accounts` | Provider keys the agent must have connected | `["amazon"]` |
| `input_schema` | JSON Schema for input parameters | `{"type": "object", ...}` |
| `output_schema` | JSON Schema for output (must include `summary`) | `{"type": "object", ...}` |
| `usage_hints` | How to present results to the owner | `"Show comparison table"` |
| `result_hints` | How to interpret results | `"Highlight best offer"` |
| `error_hints` | How to handle errors | `"Ask for clearer query"` |

> **Note:** `confirm-auto-register` can merge your overrides with auto-detected fields, but the safest direct-API path is to send a complete `tool_manual` object that already passes `validate_tool_manual()`.

### Quality scoring

Your tool manual is automatically scored 0-100 with a letter grade:

| Grade | Score | Can publish? |
|---|---|---|
| A (90-100) | Excellent | Yes |
| B (70-89) | Good | Yes |
| C (50-69) | Below threshold | **No — must improve** |
| D (30-49) | Poor | **No — must improve** |
| F (0-29) | Failing | **No — must improve** |

**Grade C, D, or F manuals cannot be published — minimum grade B is required.** Fix the issues and resubmit.

### What gets penalized

- Vague trigger conditions: `"use when helpful"`, `"for many tasks"`, `"general purpose"`
- Marketing language in descriptions: `"ultimate"`, `"revolutionary"`, `"best-in-class"`
- Missing `description` on input schema fields
- Missing `summary` field in output schema
- Too few trigger conditions (fewer than 3)
- Trigger conditions written as imperatives instead of situations

### How quality scoring is returned today

The public OpenAPI now exposes a dedicated preview endpoint for ToolManual
quality scoring:

```bash
curl -X POST https://siglume.com/v1/market/tool-manuals/preview-quality \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d @tool-manual-preview.json
```

The same flow is available through the SDK:

```bash
siglume score . --remote
```

```python
from siglume_api_sdk import SiglumeClient

with SiglumeClient(api_key="YOUR_TOKEN") as client:
    report = client.preview_quality_score(tool_manual)
    print(report.grade, report.overall_score)
```

For end-to-end draft registration, the server still returns the quality score as
part of `confirm-auto-register`:

```bash
curl -X POST https://siglume.com/v1/market/capabilities/LISTING_ID/confirm-auto-register \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d @confirm-request.json
```

Example request payload:

```json
{
  "approved": true,
  "overrides": {
    "tool_manual": {
      "tool_name": "price_compare_helper",
      "job_to_be_done": "Search multiple retailers for a product and return a ranked price comparison the agent can cite.",
      "summary_for_model": "Looks up product offers across retailers and returns a structured comparison with the best current deal.",
      "trigger_conditions": [
        "owner asks to compare prices for a specific product before deciding where to buy",
        "agent needs current retailer offers to support a shopping recommendation",
        "request is to find the cheapest or best-value option for a product query"
      ],
      "do_not_use_when": [
        "the owner already chose a seller and wants to place an order immediately",
        "the request is to complete checkout or move money instead of comparing offers"
      ],
      "permission_class": "read_only",
      "dry_run_supported": true,
      "requires_connected_accounts": [],
      "input_schema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "Product name, model number, or search phrase to compare."
          },
          "max_results": {
            "type": "integer",
            "description": "Maximum number of offers to return in the comparison.",
            "default": 5
          }
        },
        "required": ["query"],
        "additionalProperties": false
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "summary": {
            "type": "string",
            "description": "One-line overview of the best available deal."
          },
          "offers": {
            "type": "array",
            "description": "Ranked offers returned by the comparison engine.",
            "items": {
              "type": "object"
            }
          },
          "best_offer": {
            "type": "object",
            "description": "Top-ranked offer chosen from the returned offers."
          }
        },
        "required": ["summary", "offers", "best_offer"],
        "additionalProperties": false
      },
      "usage_hints": [
        "Use this tool when the user has named a product and needs evidence-backed price comparison.",
        "Present the offers in ascending price order and call out important retailer differences."
      ],
      "result_hints": [
        "Highlight the best_offer first, then summarize notable trade-offs such as shipping or stock.",
        "If multiple offers are close, explain why one is better value instead of only naming the cheapest."
      ],
      "error_hints": [
        "If no offers are found, ask the owner for a clearer product name or model number.",
        "If retailer coverage is limited, say which sources were searched before suggesting a retry."
      ]
    }
  }
}
```

Example response:

```json
{
  "listing_id": "listing_123",
  "status": "pending_review",
  "quality": {
    "overall_score": 82,
    "grade": "B",
    "issues": [],
    "improvement_suggestions": [
      "Add one more trigger condition if you want tool selection to be narrower."
    ]
  }
}
```

### Local validation (Python SDK)

You can also validate your tool manual locally before hitting the server,
using the `validate_tool_manual()` function in the SDK:

```python
from siglume_api_sdk import validate_tool_manual

my_manual = {
    "tool_name": "structural_calc",
    "job_to_be_done": "Run structural load and seismic checks for building plans under Japanese compliance assumptions.",
    "summary_for_model": "Evaluates structural inputs and returns a concise engineering summary with key load and compliance outputs.",
    "trigger_conditions": [
        "owner asks for structural load calculations for a proposed building design",
        "agent needs seismic or code-related engineering estimates before a design review",
        "request is to assess structural feasibility using provided building parameters"
    ],
    "do_not_use_when": [
        "the request needs a licensed engineer's formal stamp or legally binding approval",
        "required building parameters are missing or unverifiable"
    ],
    "permission_class": "action",
    "dry_run_supported": True,
    "requires_connected_accounts": [],
    "input_schema": {
        "type": "object",
        "properties": {
            "building_type": {"type": "string", "description": "Primary structural system, such as steel or reinforced concrete."},
            "floors": {"type": "integer", "description": "Number of floors included in the calculation."},
            "site_region": {"type": "string", "description": "Jurisdiction or seismic region used for the compliance assumptions."}
        },
        "required": ["building_type", "floors", "site_region"],
        "additionalProperties": False
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "One-line engineering summary of the calculation outcome."},
            "max_load_kN": {"type": "number", "description": "Calculated maximum load in kilonewtons."},
            "risk_flags": {"type": "array", "items": {"type": "string"}, "description": "Structural concerns that require owner review."}
        },
        "required": ["summary", "max_load_kN"],
        "additionalProperties": False
    },
    "usage_hints": [
        "Use dry run first when the owner wants to inspect assumptions before any external submission.",
        "State clearly which building inputs were used in the calculation."
    ],
    "result_hints": [
        "Summarize the calculation outcome in plain language before listing numeric details.",
        "Call out risk_flags explicitly if the output includes structural concerns."
    ],
    "error_hints": [
        "If required building parameters are missing, ask for those exact fields before retrying.",
        "If the calculation falls outside supported building codes, tell the owner which jurisdiction is unsupported."
    ],
    "approval_summary_template": "Run structural calculation for a {building_type} building with {floors} floors in {site_region}.",
    "preview_schema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "Preview of the structural calculation request."},
            "assumptions": {"type": "array", "items": {"type": "string"}, "description": "Assumptions that will be used during the calculation."}
        },
        "required": ["summary", "assumptions"],
        "additionalProperties": False
    },
    "idempotency_support": True,
    "side_effect_summary": "Submits a structural calculation job to the engineering rules engine and records the request for audit review.",
    "jurisdiction": "JP"
}

ok, issues = validate_tool_manual(my_manual)
if ok:
    print("Tool manual is valid!")
else:
    for issue in issues:
        print(f"[{issue.severity}] {issue.field}: {issue.message}")
```

This catches structural errors instantly without a network round-trip.

### Sandbox testing with public endpoints

After confirmation, create a sandbox session for your capability key:

```bash
curl -X POST https://siglume.com/v1/market/sandbox/sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "YOUR_AGENT_ID",
    "capability_key": "price-compare-helper"
  }'
```

Then verify the sandbox run through usage data:

```bash
curl "https://siglume.com/v1/market/usage?environment=sandbox&capability_key=price-compare-helper" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

This is the currently documented public path for end-to-end validation. The older release-level `sandbox-test` and release-publish endpoints are not part of the public developer OpenAPI.

### Revising your tool manual after feedback

If your score is below grade B or admin review requests changes, update the
draft in `/owner/publish`, rerun `siglume score . --remote` (or
`client.preview_quality_score(...)`), and then repeat the
`auto-register` → `confirm-auto-register` flow with a corrected full tool
manual. Public release-publish endpoints are not yet exposed in
`openapi/developer-surface.yaml`.

---

## Next Steps

- Run the [example API](./examples/hello_price_compare.py)
- Read the [API reference](./openapi/developer-surface.yaml)
- Check the [TypeScript types](./siglume-api-types.ts) for frontend integration
- See the [API Ideas Board](./API_IDEAS.md) for inspiration
- Build your own API and submit it
