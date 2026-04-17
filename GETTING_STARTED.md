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
# Clone the SDK (PyPI package coming soon)
git clone https://github.com/taihei-05/siglume-api-sdk.git
cd siglume-api-sdk
pip install -e .

# Run the example API
python examples/hello_price_compare.py
```

> **Note:** `pip install siglume-api-sdk` will be available on PyPI in a future release. Use the local install for now.

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
- Grade C or above: your API proceeds to admin review
- Grade D or F: you must improve the tool manual before it can be published

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

If your API needs OAuth tokens or API keys from the agent owner (e.g., X/Twitter credentials, Stripe keys), declare them in `required_connected_accounts`. The owner will be prompted to connect these accounts during installation.

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
- **Subscription** (`price_model="subscription"`): Monthly billing. Fully operational. Developer receives 93.4% each month via Stripe Connect.

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
print(f"Listing created: {draft['listing_id']}")
print(f"Name: {draft['auto_manifest']['name']}")
print(f"Status: {draft['status']}")

# Confirm and submit for review — include your tool manual.
# Note: overrides are merged with auto-detected values.
# Fields like tool_name, permission_class, summary_for_model etc.
# are auto-detected from source code; you only need to override
# what the auto-detection cannot infer (e.g., trigger_conditions).
requests.post(
    f"https://siglume.com/v1/market/capabilities/{draft['listing_id']}/confirm-auto-register",
    headers={"Authorization": f"Bearer {YOUR_TOKEN}"},
    json={
        "approved": True,
        "overrides": {
            "tool_manual": {
                "trigger_conditions": [
                    "owner asks to summarize daily discussions",
                    "agent needs a discussion report for a Slack channel",
                    "owner wants automated daily summaries"
                ],
                "do_not_use_when": [
                    "the owner wants a one-off summary, not a recurring report",
                    "the request is about channels the agent cannot access"
                ],
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "channel": {"type": "string", "description": "Slack channel name"},
                        "period": {"type": "string", "description": "Time period to summarize", "default": "today"}
                    },
                    "required": ["channel"],
                    "additionalProperties": False
                },
                "output_schema": {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string"},
                        "highlights": {"type": "array", "items": {"type": "string"}},
                        "posted": {"type": "boolean"}
                    },
                    "required": ["summary"],
                    "additionalProperties": False
                },
                "usage_hints": ["Present the summary with key discussion highlights"],
                "result_hints": ["Show whether the report was posted successfully"],
                "error_hints": ["If channel not found, ask the owner to verify the channel name"]
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
- Currency: USD only
- Payments are processed by Stripe. Siglume never holds your funds.

Example for a $9.99/month subscription:

```
Buyer pays:           $9.99
Stripe fee:          -$0.59
Siglume fee (6.6%):  -$0.66
You receive:          $8.74/month → direct to your bank account
```

### Setting up payouts (subscription APIs only)

If you choose `price_model="subscription"`, you must register a Stripe Connect account before your API can be published.

**Step 1: Create your Stripe Connect account**

```bash
curl -X POST https://siglume.com/v1/market/developer/stripe-connect \
  -H "Authorization: Bearer YOUR_TOKEN"
```

This returns an `onboarding_url`. Open it in your browser and complete:
- Identity verification (name, address)
- Bank account for payouts

You only need to do this once.

**Step 2: Check your status**

```bash
curl https://siglume.com/v1/market/developer/stripe-connect/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

When `ready: true`, you can publish subscription APIs.

**Step 3: Submit your API**

Now when you call `confirm-auto-register`, it will pass the Stripe check and submit for review.

### Full flow for a subscription API

```
Your AI:
  1. Call auto-register with price_model="subscription", price_value_minor=999
  2. Call confirm → rejected: "Stripe Connect account required"

You (one time only):
  3. Call POST /v1/market/developer/stripe-connect
  4. Complete Stripe verification in browser

Your AI:
  5. Call confirm again → submitted for review
  6. Admin approves → published in store

After that:
  - Buyers subscribe → Stripe charges them monthly
  - 93.4% goes to your bank account automatically
  - You do nothing — Stripe handles everything
```

### Free APIs need no payment setup

If `price_model="free"`, skip all Stripe steps. Your API can be published immediately after admin review.

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

> **Note:** When using `confirm-auto-register`, fields like `tool_name`, `permission_class`,
> and `summary_for_model` are auto-detected from source code. You only need to provide
> overrides for what the auto-detection cannot infer (typically `trigger_conditions`,
> `do_not_use_when`, and schema details).

### Quality scoring

Your tool manual is automatically scored 0-100 with a letter grade:

| Grade | Score | Can publish? |
|---|---|---|
| A (90-100) | Excellent | Yes |
| B (70-89) | Good | Yes |
| C (50-69) | Acceptable | Yes |
| D (30-49) | Poor | **No — must improve** |
| F (0-29) | Failing | **No — must improve** |

**Grade D or F manuals cannot be published.** Fix the issues and resubmit.

### What gets penalized

- Vague trigger conditions: `"use when helpful"`, `"for many tasks"`, `"general purpose"`
- Marketing language in descriptions: `"ultimate"`, `"revolutionary"`, `"best-in-class"`
- Missing `description` on input schema fields
- Missing `summary` field in output schema
- Too few trigger conditions (fewer than 3)
- Trigger conditions written as imperatives instead of situations

### How to check your score before publishing

```bash
curl -X POST https://siglume.com/v1/capability-listings/{id}/releases/validate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool_manual": {...your manual...}}'
```

The response includes the quality score, grade, and specific issues to fix:

```json
{
  "ok": true,
  "quality": {
    "score": 82,
    "grade": "B",
    "publishable": true,
    "issues": [...],
    "improvement_suggestions": [...]
  }
}
```

### Local validation (Python SDK)

You can also validate your tool manual locally before hitting the server,
using the `validate_tool_manual()` function in the SDK:

```python
from siglume_api_sdk import validate_tool_manual

my_manual = {
    "api_name": "structural-calc",
    "version": "1.0.0",
    "permission_class": "action",
    "short_description": "Structural engineering calculations per Japanese Building Standards Act",
    "when_to_use": "When a job requires structural load analysis or seismic resistance checks",
    "capabilities": [{ "name": "calculate_load", "description": "...", "input_schema": {}, "output_schema": {} }],
    "limitations": ["Only supports Japanese building codes"],
    "approval_summary_template": "Structural calc: {building_type}, {floors} floors",
    "preview_schema": {},
    "idempotency_support": True,
    "side_effect_summary": "No external side effects"
}

ok, issues = validate_tool_manual(my_manual)
if ok:
    print("Tool manual is valid!")
else:
    for issue in issues:
        print(f"[{issue.severity}] {issue.field}: {issue.message}")
```

This catches structural errors instantly without a network round-trip.

### Sandbox testing

Test whether your API would be selected for specific requests:

```bash
curl -X POST https://siglume.com/v1/capability-listings/{id}/releases/{releaseId}/sandbox-test \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "test_cases": [
      {"request_text": "compare prices for headphones", "expected_selected": true},
      {"request_text": "send an email", "expected_selected": false}
    ]
  }'
```

Each test shows whether your API was selected, its rank, and why.

### Providing your tool manual

Include the tool manual when confirming your auto-registration:

```python
requests.post(
    f"https://siglume.com/v1/market/capabilities/{listing_id}/confirm-auto-register",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "approved": True,
        "overrides": {
            "tool_manual": {
                "trigger_conditions": [
                    "owner asks to compare product prices",
                    "agent needs price data before recommending a purchase",
                    "owner wants to find the cheapest option"
                ],
                "do_not_use_when": [
                    "the owner already chose a seller",
                    "the request is about placing an order, not comparing"
                ],
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Product name to search for"},
                        "max_results": {"type": "integer", "description": "Maximum offers to return", "default": 5}
                    },
                    "required": ["query"],
                    "additionalProperties": false
                },
                "output_schema": {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string"},
                        "offers": {"type": "array", "items": {"type": "object"}},
                        "best_offer": {"type": "object"}
                    },
                    "required": ["summary", "offers"],
                    "additionalProperties": false
                },
                "usage_hints": ["Present offers in a comparison format"],
                "result_hints": ["Highlight the best value option"],
                "error_hints": ["If no results, suggest a different search term"]
            }
        }
    }
)
```

### Updating your tool manual later

After your API is approved and live, publish updated tool manuals:

```bash
curl -X POST https://siglume.com/v1/capability-listings/{id}/releases \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"release_semver": "1.1.0", "tool_manual": {...}, "permission_class": "read_only", "dry_run_supported": true}'
```

This only works for APIs that have already been approved by admin.

---

## Next Steps

- Run the [example API](./examples/hello_price_compare.py)
- Read the [API reference](./openapi/developer-surface.yaml)
- Check the [TypeScript types](./siglume-api-types.ts) for frontend integration
- See the [API Ideas Board](./API_IDEAS.md) for inspiration
- Build your own API and submit it
