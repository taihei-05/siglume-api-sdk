# Writing listings agents read correctly

A Siglume listing has two audiences, and they read different things at different
moments:

- **A human** browsing the API Store reads the rendered listing page.
- **An AI agent** — usually the *first* and often the *only* reader at the
  moment that matters — reads the listing's machine-returned metadata to decide
  **"can this API do what the user asked, and what will it cost?"** *before it
  ever binds the tool.*

The catch: at that decision moment the agent can see **only the listing
metadata** — `name`, `short_description`, `description`, `job_to_be_done`,
`example_prompts`, `compatibility_tags`, `pricing_plan`, `price_posture`. It
**cannot** see your Tool Manual (`input_schema`, `op` enums, `usage_hints`,
`trigger_conditions`). Those become visible only after the tool is **bound**,
and binding requires a purchase/install that the agent's own safety layer will
not perform without explicit user intent. So the rich, accurate contract you
wrote is invisible exactly when the agent decides whether your API is worth
using.

**A perfect Tool Manual does not fix this.** The quality scorer (see
[publish-flow.md](./publish-flow.md)) grades the *Tool Manual*, not the
discovery copy. A listing can score **A (100/100)** and still lead agents to
conclude your API can't do something it does, or is free when it charges —
because that judgment is formed from the human-facing copy, not the contract.

This page is the checklist for writing that copy so agents judge your API
correctly. Run it before every `siglume register`.

## Checklist

### 1. Lead with capability, not reassurance

Agents read top-down and treat the opening lines as the capability ceiling. If
your `description` opens with what the API *won't* do ("never posts on its own",
"always asks for approval", safety disclaimers), an agent reads that as *the
limit of what it can do*.

Put capabilities first — **including the non-obvious ones** (scheduling, batch,
modes, one-time vs recurring). Move safety, approval, and non-custodial
statements *below* the capability lead. Keep every legally required statement
(e.g. a non-custodial declaration) — just not as the opening line.

> ❌ `■ We never post on our own. Approval is always required. …`
>
> ✅ `■ What it does: post to your X now, schedule a one-time post (e.g. 11:30
> today), or run unattended daily posts within a budget. … ■ Approval: normal
> posts need your OK each time; scheduled posts run within your budget cap.`

### 2. Make price legible in the copy

Do not rely on the structured price fields to communicate cost. A `per_action`
listing with `price_value_minor: 0` and `free_upfront_invocation: true`
surfaces as `price_posture: "free"` with a top-level price of `0`, even though
its `pricing_plan.items` charge per call. An agent skimming the price fields
concludes "free", then contradicts itself after reading the plan.

If your API charges, say so in `short_description` and near the top of
`description` in plain words — e.g. `from ¥15/post, prepay`. State what *is* free
(preview/dry-run, connection, idempotent retries) explicitly.

### 3. `example_prompts` must cover the real surface

Agents pattern-match capability from `example_prompts` as much as from prose. A
single happy-path example teaches the agent your API does *only* that.

Include a prompt for:

- the **mandatory setup step** (e.g. "connect my LINE account", "register the
  webhook") — agents otherwise skip it and hit a wall;
- **every advanced mode** (broadcast vs individual send; a specific sheet/tab;
  image + URL; one-time vs recurring schedule);
- anything that maps to an `op` / mode in your `input_schema`.

Aim for 4–6 prompts that span setup → basic → advanced, not three variants of
the same call.

### 4. Declare what it does *not* do

If users will reasonably assume a capability you don't have (reply-chain
threads, editing or deleting after the fact, a recurring schedule vs one-shot),
say so — in `description` and in the Tool Manual's `do_not_use_when`. Otherwise
the agent guesses, and guesses wrong in both directions.

## Good models

Two listings in the Siglume ecosystem already follow this:

- a shopping price-comparison API that leads capability-first, explicitly
  pre-empts the "reads as free" trap (`no-payment-required` / `free-api` tags
  plus a line stating there is no per-call charge), and ships prompts spanning
  recommend / budget / cheapest-total / cross-store;
- a paid per-request company-data lookup whose name and copy make the
  per-request cost unmistakable and whose prompts exercise every query mode.

## Why this isn't caught automatically

The Tool Manual quality scorer validates your machine contract; it does not (yet)
lint the discovery copy for negation-first framing, thin examples, or a
paid-but-reads-free price posture. Until it does, this is a human review step —
walk the checklist above before you publish.
