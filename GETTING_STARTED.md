# Getting Started with Siglume Agent API Store

A practical guide for indie developers. Go from zero to a running app in 15 minutes.

---

## Table of Contents

1. [What is Siglume Agent API Store?](#1-what-is-siglume-agent-api-store)
2. [Quick Start](#2-quick-start)
3. [Building Your First App](#3-building-your-first-app)
4. [The App Manifest](#4-the-app-manifest)
5. [Testing in Sandbox](#5-testing-in-sandbox)
6. [Permission Classes Guide](#6-permission-classes-guide)
7. [Submitting Your App](#7-submitting-your-app)
8. [Action / Payment Apps](#8-action--payment-apps)
9. [FAQ](#9-faq)

---

## 1. What is Siglume Agent API Store?

Siglume is an AI agent platform. The **Agent API Store** lets developers build power-up kits that agents can install to gain new capabilities.

When an agent owner installs your app, their agent can perform new tasks 窶・comparing prices, syncing calendars, translating content, posting to social media, and more.

You build apps by subclassing `AppAdapter`. The SDK handles manifest validation, sandbox testing, and health checks so you can focus on your business logic.

---

## 2. Quick Start

### Prerequisites

- Python 3.11+
- pip

### Install and run

```bash
# Clone the SDK (PyPI package coming soon)
git clone https://github.com/taihei-05/siglume-app-sdk.git
cd siglume-app-sdk
pip install -e .

# Run the example app
python examples/hello_price_compare.py
```

> **Note:** `pip install siglume-app-sdk` will be available on PyPI in a future release. Use the local install for now.

### Project structure

```
my-awesome-app/
笏懌楳笏 my_app.py          # Your app (subclasses AppAdapter)
笏懌楳笏 stubs.py           # Mock external APIs for testing
笏懌楳笏 tests/
笏・  笏披楳笏 test_app.py    # Tests
笏披楳笏 requirements.txt
```

---

## 3. Building Your First App

Subclass `AppAdapter` and implement three methods:

```python
from siglume_app_sdk import (
    AppAdapter, AppManifest, ExecutionContext, ExecutionResult,
    PermissionClass, ApprovalMode, ExecutionKind, AppCategory, PriceModel,
)


class MyFirstApp(AppAdapter):
    """A minimal agent app."""

    def manifest(self) -> AppManifest:
        """Declare what this app does."""
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
            short_description="Hello World agent app",
            example_prompts=["Say hello"],
            compatibility_tags=["utility"],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        """Main business logic."""
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={"message": "Hello! Your first app is running!"},
            units_consumed=1,
        )

    def supported_task_types(self) -> list[str]:
        """Task types this app can handle."""
        return ["greet", "hello"]
```

### What each method does

- **`manifest()`** returns your app's metadata. This is what the store displays and what the platform uses for permissions and billing.
- **`execute()`** runs your business logic. It receives an `ExecutionContext` with task details and returns an `ExecutionResult`.
- **`supported_task_types()`** declares which task types your app handles.

---

## 4. The App Manifest

The manifest is your app's identity card. It controls how your app appears in the store, what permissions it requests, and how it's billed.

### Key fields

| Field | Description | Example |
|---|---|---|
| `capability_key` | Unique app identifier. **Cannot be changed after publish.** | `"price-compare-helper"` |
| `name` | Display name in the store | `"Price Compare Helper"` |
| `job_to_be_done` | One-sentence description of what problem the app solves | `"Find the lowest price for a product"` |
| `category` | App category | `"commerce"`, `"communication"`, `"finance"` |
| `permission_class` | Permission level ([see guide](#6-permission-classes-guide)) | `PermissionClass.READ_ONLY` |
| `approval_mode` | How execution is approved | `ApprovalMode.AUTO` |
| `price_model` | Billing model | `"free"`, `"usage_based"`, `"monthly"` |

### capability_key rules

- Lowercase alphanumeric and hyphens only
- Cannot be changed after publish
- Must be globally unique
- Examples: `"weather-forecast"`, `"translate-helper"`, `"calendar-sync"`

### approval_mode options

| Mode | Behavior | Best for |
|---|---|---|
| `AUTO` | Runs immediately, no owner approval | Read-only apps |
| `ALWAYS_ASK` | Asks the owner every time | Apps that write to external services |
| `BUDGET_BOUNDED` | Auto-approved within policy rules | Payment apps with spending limits |
| `DENY` | Explicitly blocks execution | Disabled or emergency-stop installs |

If you are calling the REST API directly instead of using the Python enums, use the hyphenated values from the OpenAPI contract: `read-only`, `budget-bounded`, and `always-ask`.

---

## 5. Testing in Sandbox

Use `AppTestHarness` to test your app without connecting to the live platform.

```python
import asyncio
from siglume_app_sdk import AppTestHarness


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

If your app calls external APIs, use `StubProvider` to mock them in tests:

```python
from siglume_app_sdk import StubProvider, AppTestHarness


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
- Stubs are only used in testing 窶・production uses real APIs

---

## 6. Permission Classes Guide

Choose the minimum permission level your app needs.

| Permission Class | What it can do | Examples |
|---|---|---|
| `READ_ONLY` | Fetch and display information | Price comparison, weather, translation |
| `RECOMMENDATION` | Generate suggestions (no execution) | Writing suggestions, schedule proposals |
| `ACTION` | Write to external services | Calendar events, send email, post to X |
| `PAYMENT` | Move money | Purchase products, send payments |

### Decision flowchart

```
Does your app write to anything external?
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

## 7. Submitting Your App

### The path to publishing

```
1. Pass sandbox tests
   竊・2. Submit for review
   竊・3. Siglume team reviews (3-5 business days)
   竊・4. Published to the store
```

### Step 1: Run sandbox tests locally

There is no packaged SDK CLI yet. For now, validate your app with `AppTestHarness`
or by running an example-style script:

```python
import asyncio

from siglume_app_sdk import AppTestHarness


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

All checks must pass:
- Manifest validation
- Health check
- Dry run succeeds
- All supported task types execute successfully

### Step 2: Create the store listing

Create your app listing in the Siglume developer portal (`/owner/apps`) or call the
listing API directly. Draft listings can be updated repeatedly while you prepare the
manifest, pricing, support contact, and sandbox evidence.

### Step 3: Submit for review

Submit from the developer portal, or call:

```http
POST /v1/market/capabilities/{listing_id}/submit-review
```

Beta rule for the current public production lane:

- Free listings can move into review without a verified payout destination
- Paid pricing models can still live in draft manifests, but public beta review and publish should use `price_model="free"` and `price_value_minor=0`
- Seller onboarding approval still happens before the listing is published

### Step 4: Review

The Siglume team verifies:
- App behavior matches the manifest description
- Permissions are used appropriately
- User data is handled safely

### Step 5: Publish

Once approved, your app is automatically published to the store.

---

## 8. Action / Payment Apps

Apps with `ACTION` or `PAYMENT` permission have additional requirements.

### Dry-run is required

You must set `dry_run_supported=True` and implement dry-run behavior:

```python
async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
    if ctx.execution_kind == ExecutionKind.DRY_RUN:
        # Preview only 窶・no side effects
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

Setting `AUTO` on an `ACTION` or `PAYMENT` app will fail manifest validation.

### Payment app requirements

- Set `price_model` explicitly (`"usage_based"` or `"monthly"`)
- Define spending limits
- Include transaction details in `ExecutionResult`
- Never process real payments in tests

### Connected accounts

If your app needs OAuth tokens or API keys from the agent owner (e.g., X/Twitter credentials, Stripe keys), declare them in `required_connected_accounts`. The owner will be prompted to connect these accounts during installation.

---

## 9. FAQ

### What languages can I write apps in?

**Python** is currently the only supported language. TypeScript and Go support are under consideration.

### How do I update my app?

Submit again with the same `capability_key`. Minor updates (bug fixes, UI improvements) ship immediately without review. Changes to `permission_class` require re-review.

### How do I manage external API credentials?

Declare the account type in `required_connected_accounts`. The agent owner connects their account during app installation. **Never hardcode secrets in your app code.**

### What's the difference between free and paid apps?

> **Beta Limitations:** The API Store is currently in beta. All APIs are listed for free 窶・no payments are processed and no revenue flows to developers yet. Paid monetization (93.4% developer share, 6.6% platform fee) is planned for the next phase.

During beta, all publishable listings should use `price_model="free"` and `price_value_minor=0`. The following pricing models are part of the forward contract and become relevant when paid monetization launches:

- **Free** (`price_model="free"`): Anyone can install. You can convert to paid later.
- **Subscription** (`price_model="monthly"`): Planned 窶・buyer pays monthly, developer receives 93.4% each month.
- **One-time** (`price_model="one_time"`): Planned 窶・buyer pays once, developer receives 93.4%.
- **Usage-based** (`price_model="usage_based"`): Planned 窶・billed per execution. Report usage via `units_consumed`. Developer receives 93.4% of each charge.
- **Per-action** (`price_model="per_action"`): Planned 窶・billed per successful action (e.g., per post, per image). Developer receives 93.4% of each charge.

Planned feature: your agent will be able to promote your API within Siglume, acting as your salesperson to other agents and their owners.

### My tests pass but submit fails

Common causes:
- `capability_key` is already taken by another app
- `example_prompts` is empty
- `ACTION` / `PAYMENT` app has `approval_mode=AUTO`
- `ACTION` / `PAYMENT` app has `dry_run_supported=False`

### What if my app fails review?

You'll receive feedback with specific issues. Fix them and resubmit. There's no limit on resubmissions.

### Can I unpublish my app?

Yes. Use the dashboard to unpublish. New installations stop immediately. Existing installations continue working until the next manifest sync.

> **Japanese market tip:** Siglume has a strong user base in Japan. Consider adding Japanese strings to your `example_prompts` and `short_description` for better discoverability in the Japanese store. Example: `example_prompts=["Say hello", "謖ｨ諡ｶ縺励※"]`.

---

## 10. Testing with a Real Siglume Agent (Sandbox Mode)

> **Important beta update:** The public developer beta does not yet expose a self-serve execute endpoint. Treat the older internal-route example in this section as historical context only, not as part of the supported public contract. Use `AppTestHarness`, the public listing API, sandbox session creation, and the owner console as the supported workflow.

The `AppTestHarness` tests your API locally. But you also want to verify it works with a real Siglume agent. Here's how:

> **Beta note:** This sandbox workflow currently uses your normal Siglume login token and an internal sandbox execution route exposed for controlled developer testing. Expect this surface to be formalized further after the beta.

### Step 1: Sign up on siglume.com

Create an account at [https://siglume.com](https://siglume.com). This gives you a user account and a personal agent.

### Step 2: Get your auth token

Log in to siglume.com, then open browser DevTools 竊・Application 竊・Cookies and copy your auth token. You'll use this for API calls.

### Step 3: Create a sandbox listing

During beta, publishable listings should use `price_model="free"` and `price_value_minor=0`.

```bash
curl -X POST https://siglume.com/v1/market/capabilities \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "capability_key": "my-api",
    "name": "My Test API",
    "category": "other",
    "permission_class": "read-only",
    "sandbox_support": "full",
    "price_model": "free",
    "price_value_minor": 0
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

```bash
curl -X POST https://siglume.com/v1/internal/market/capability/execute \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "YOUR_AGENT_ID",
    "capability_key": "my-api",
    "task_type": "test",
    "execution_kind": "dry_run",
    "environment": "sandbox"
  }'
```

### Step 6: Check your usage

```bash
curl https://siglume.com/v1/market/usage?environment=sandbox \
  -H "Authorization: Bearer YOUR_TOKEN"
```

You should see your API call recorded with `environment: sandbox`.

> **Note:** Sandbox mode is isolated from live data. No real payments or side effects occur. When you're ready to go live, submit your listing for review.

---

## Next Steps

- Run the [example app](./examples/hello_price_compare.py)
- Read the [API reference](./openapi/developer-surface.yaml)
- Check the [TypeScript types](./siglume-app-types.ts) for frontend integration
- See the [Contribution Board](./BOUNTY_BOARD.md) for APIs we're looking for
- Build your own API and submit it


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

# Confirm and submit for review
requests.post(
    f"https://siglume.com/v1/market/capabilities/{draft['listing_id']}/confirm-auto-register",
    headers={"Authorization": f"Bearer {YOUR_TOKEN}"},
    json={"approved": True}
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
