# Demo Capture Guide

Use this guide to record the SDK story in a way that matches the current beta
surfaces and the actual route split in the web app.

## What to show

The current beta separates buyer and seller flows:

- `/owner/publish` is the seller-facing developer portal
- `/owner/apps` is the buyer-facing API Store catalog
- `/owner/installed-tools` is the installed-tool execution surface
- `/owner/receipts` is the execution audit trail

For the current beta, do not present live payout settlement as already
available. Show Stripe Connect payout setup or connected state instead. Paid
monetization is still documented as a later phase.

## Recommended demo flow

Use `examples/x_publisher.py` as the featured app. It is the clearest example
because viewers can understand the job-to-be-done in a single glance.

1. Start on `/owner/publish` with the API already auto-registered.
2. Show the listing overview, permission class, approval mode, and billing
   model.
3. Switch to the `Quality` tab and run a quality check.
4. Switch to the `Sandbox` tab and run a test request so the viewer sees
   `Selected`, `Rank`, `Score`, and `Diagnosis`.
5. Open `/owner/installed-tools` and create an execution intent for the app.
6. Open `/owner/receipts` and show the receipt summary, approval state, and
   step details if available.
7. Return to `/owner/publish`, open the `Settings` tab, and show the Stripe
   Connect setup or connected state.

Optional: if you want a public-store establishing shot, prepend a 2-3 second
cut of `/owner/apps` before the seller flow. Do not use `/owner/apps` as the
registration surface in the narration.

## 90-second script

### 0s-8s

Screen:
`/owner/publish` with the selected API visible.

On-screen text:
`Turn your API into an agent capability`

Voiceover:
`This is how a developer turns an API into something Siglume agents can discover, test, and use.`

### 8s-24s

Screen:
Stay on `/owner/publish` and focus on the API overview card. Show the listing
name, capability key, permission class, approval mode, and billing model.

On-screen text:
`1. Auto-register, then review in the developer portal`

Voiceover:
`You build with the SDK, auto-register with the listing API, and then confirm the result in the developer portal.`

### 24s-38s

Screen:
Open the `Quality` tab and run a quality check. Let the grade and issues settle
on screen.

On-screen text:
`2. Validate the listing before review`

Voiceover:
`Before submission, you can run a quality check to verify the tool manual, metadata, and release quality.`

### 38s-56s

Screen:
Open the `Sandbox` tab. Enter a clear prompt such as `Post this launch note to
X with an approval step.` Run the test and wait for `Selected`, `Rank`, `Score`,
and `Diagnosis`.

On-screen text:
`3. Check whether the agent would select it`

Voiceover:
`The sandbox test shows whether your app would be selected for a real request, plus why it ranked where it did.`

### 56s-70s

Screen:
Open `/owner/installed-tools`. Select the agent and click `Execute` for the
installed tool.

On-screen text:
`4. Create an execution intent`

Voiceover:
`Once installed on an agent, the owner can create an execution intent from the installed tools surface.`

### 70s-82s

Screen:
Open `/owner/receipts`. Show the latest execution receipt. If step details are
available, expand one row so the dry-run or approval information is visible.

On-screen text:
`5. Review receipts and approvals`

Voiceover:
`Execution receipts make the run auditable, including approval status, latency, and step-by-step details.`

### 82s-90s

Screen:
Return to `/owner/publish`, switch to `Settings`, and show the Stripe Connect
section.

On-screen text:
`6. Verify payout setup`

Voiceover:
`When paid monetization is enabled, this is where payout readiness connects through Stripe Connect.`

## Short README GIF

Do not use the full 90-second video as a GIF. Cut an 8-10 second loop with
three beats:

1. `/owner/publish` overview
2. `Sandbox` result or `/owner/installed-tools` execute click
3. `/owner/receipts` or Stripe Connect setup state

This keeps the README lightweight while still proving the flow.

## Recording settings

- Use OBS if you want the cleanest crop and easiest retakes.
- Use Loom if you need the hosted MP4 quickly.
- Use Windows Game Bar only for the fastest rough capture.
- Record at `1920x1080`, `30fps`.
- Set the browser width to around `1440-1600px`.
- Use `125%-150%` browser zoom so text stays readable.
- Move the cursor slowly and disable notifications.
- Blur personal data, external account identifiers, and anything tied to a
  real Stripe destination.

## Export the README GIF

From the SDK root:

```powershell
powershell -File .\scripts\make-demo-gif.ps1 `
  -InputFile .\siglume-demo-90s.mp4 `
  -Start 00:00:08 `
  -DurationSeconds 9
```

That writes the README asset to:

```text
docs/assets/demo/siglume-owner-publish-demo.gif
```

## README embed snippet

```md
[![🚀 Quick Start](https://img.shields.io/badge/%F0%9F%9A%80-Quick%20Start-111827?style=flat-square)](./GETTING_STARTED.md)
[![Examples](https://img.shields.io/badge/examples-starter%20apps-0ea5e9?style=flat-square)](#examples)
[![License](https://img.shields.io/badge/license-MIT-16a34a?style=flat-square)](./LICENSE)

<p align="left">
  <a href="https://www.loom.com/share/REPLACE_WITH_YOUR_90S_VIDEO_URL">
    <img
      src="./docs/assets/demo/siglume-owner-publish-demo.gif"
      alt="Demo: auto-register an API, review it in the developer portal, let an agent select it, and verify Stripe Connect payout setup"
      width="960"
    />
  </a>
</p>
```
