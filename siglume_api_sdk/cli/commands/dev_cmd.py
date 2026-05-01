"""Publisher developer tools — observability subcommands.

Wraps the /v1/seller/analytics/* and /v1/capability-execution-receipts endpoints
so publishers can inspect their API's marketplace performance from the CLI.

Subcommands:
- ``siglume dev gap-report``      : cross-publisher unmet-demand shapes
- ``siglume dev stats``           : per-listing install / revenue / execution stats
- ``siglume dev miss-analysis``   : why your listing was candidate-but-not-selected
- ``siglume dev keywords``        : keyword suggestions for the tool manual
- ``siglume dev tail``            : tail recent execution receipts (your scope)
"""
from __future__ import annotations

import time
from typing import Any

import click
from siglume_api_sdk.cli.project import render_json, resolve_api_key
from siglume_api_sdk.client import SiglumeAPIError, SiglumeClient


@click.group("dev")
def dev_command() -> None:
    """Publisher developer tools — observability into your API's marketplace performance.

    Subcommands wrap the seller-analytics and execution-receipts endpoints so
    you can inspect why your listing is (or isn't) being selected, what
    capability shapes the planner is asking for but no tool serves, and live
    execution traces.
    """


# ---------------------------------------------------------------------------
# gap-report
# ---------------------------------------------------------------------------


@dev_command.command("gap-report")
@click.option("--days", default=30, show_default=True, type=click.IntRange(1, 365))
@click.option(
    "--min-occurrences",
    "min_occ",
    default=3,
    show_default=True,
    type=click.IntRange(3, 1000),
    help="Floor of 3 enforced server-side as singleton-fingerprinting privacy guardrail.",
)
@click.option("--limit", default=50, show_default=True, type=click.IntRange(1, 200))
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
def gap_report_command(
    days: int, min_occ: int, limit: int, json_output: bool,
) -> None:
    """Cross-publisher gap report: capability shapes the planner asked for but no tool matched.

    Anonymized aggregate. Never returns buyer prompts, agent IDs, or owner IDs.
    Use this to see what publishers should build next — high-occurrence shapes
    are unmet demand.
    """
    api_key = resolve_api_key()
    with SiglumeClient(api_key=api_key) as client:
        data, _ = client.get_gap_report(days=days, min_occurrences=min_occ, limit=limit)

    if json_output:
        click.echo(render_json(data))
        return

    shape_count = data.get("shape_count", 0) if isinstance(data, dict) else 0
    since = data.get("since", "?") if isinstance(data, dict) else "?"
    until = data.get("until", "?") if isinstance(data, dict) else "?"
    floor = data.get("min_occurrences", "?") if isinstance(data, dict) else "?"
    click.secho(f"Gap report: {shape_count} unmet shapes ({since} → {until})", fg="green")
    click.echo(f"min_occurrences floor: {floor}")
    if shape_count == 0:
        click.echo("")
        click.echo(
            "(No shapes met the threshold yet — "
            "instrumentation may need more traffic to accumulate.)"
        )
        return
    click.echo("")
    for shape in (data.get("shapes", []) if isinstance(data, dict) else []):
        if not isinstance(shape, dict):
            continue
        words = ", ".join(str(w) for w in (shape.get("sample_words") or []))
        shape_hash = str(shape.get("shape_hash", "?"))
        click.echo(
            f"- [{int(shape.get('occurrences', 0)):>4}×] "
            f"miss={str(shape.get('top_miss_kind', '?')):<25} "
            f"hash={shape_hash[:12]}…  "
            f"words=[{words}]"
        )


# ---------------------------------------------------------------------------
# stats
# ---------------------------------------------------------------------------


@dev_command.command("stats")
@click.argument("listing_id")
@click.option("--days", default=30, show_default=True, type=click.IntRange(0, 3650))
@click.option("--json", "json_output", is_flag=True)
def stats_command(listing_id: str, days: int, json_output: bool) -> None:
    """Per-listing stats: installs, revenue, executions, success and selection rates."""
    api_key = resolve_api_key()
    with SiglumeClient(api_key=api_key) as client:
        data, _ = client.get_seller_listing_stats(listing_id, days=days)

    if json_output:
        click.echo(render_json(data))
        return

    if not isinstance(data, dict):
        click.secho("Unexpected response shape.", fg="red", err=True)
        return

    click.secho(f"Listing {listing_id} ({data.get('period_days', days)} days)", fg="green")
    click.echo(
        f"  Installs:    total={data.get('total_bindings', 0)}, "
        f"active={data.get('active_bindings', 0)}"
    )
    click.echo(
        f"  Revenue:     period={data.get('period_revenue_minor', 0)} "
        f"{data.get('revenue_currency', '?')} (minor units)"
    )
    click.echo(
        f"  Executions:  total={data.get('total_executions', 0)}, "
        f"success_rate={data.get('success_rate_pct', 0)}%"
    )
    click.echo(
        f"  Selection:   candidate={data.get('times_candidate', 0)}, "
        f"selected={data.get('times_selected', 0)}, "
        f"rate={data.get('selection_rate_pct', 0)}%"
    )
    click.echo(
        f"  Latency:     avg={data.get('avg_latency_ms')}ms "
        f"p95={data.get('p95_latency_ms')}ms"
    )


# ---------------------------------------------------------------------------
# miss-analysis
# ---------------------------------------------------------------------------


@dev_command.command("miss-analysis")
@click.argument("listing_id")
@click.option("--days", default=30, show_default=True, type=click.IntRange(1, 365))
@click.option("--json", "json_output", is_flag=True)
def miss_analysis_command(listing_id: str, days: int, json_output: bool) -> None:
    """Why your listing was a CANDIDATE but NOT selected — improvement suggestions."""
    api_key = resolve_api_key()
    with SiglumeClient(api_key=api_key) as client:
        data, _ = client.get_seller_selection_analysis(listing_id, days=days)

    if json_output:
        click.echo(render_json(data))
        return

    if not isinstance(data, dict):
        click.secho("Unexpected response shape.", fg="red", err=True)
        return

    total = data.get("total_missed", 0)
    click.secho(
        f"Listing {listing_id}: {total} candidate-but-not-selected events ({days} days)",
        fg="green",
    )
    reasons = data.get("reasons") or []
    for reason in reasons:
        if not isinstance(reason, dict):
            continue
        click.echo(
            f"- {reason.get('reason', '?')}: "
            f"{reason.get('count', 0)} ({reason.get('percentage', 0)}%) — "
            f"{reason.get('suggestion', '')}"
        )
    competing = data.get("top_competing_tools") or []
    if competing:
        click.echo("")
        click.echo("Top competing tools (winners):")
        for c in competing[:5]:
            click.echo(f"  - {c}")
    suggested = data.get("suggested_trigger_keywords") or []
    if suggested:
        click.echo("")
        click.echo(f"Suggested trigger keywords to add: {', '.join(str(s) for s in suggested)}")


# ---------------------------------------------------------------------------
# keywords
# ---------------------------------------------------------------------------


@dev_command.command("keywords")
@click.argument("listing_id")
@click.option("--json", "json_output", is_flag=True)
def keywords_command(listing_id: str, json_output: bool) -> None:
    """Keyword suggestions to add to your tool manual to improve discoverability."""
    api_key = resolve_api_key()
    with SiglumeClient(api_key=api_key) as client:
        data, _ = client.get_seller_keyword_suggestions(listing_id)

    if json_output:
        click.echo(render_json(data))
        return

    if not isinstance(data, dict):
        click.secho("Unexpected response shape.", fg="red", err=True)
        return

    click.secho(f"Keyword suggestions for {listing_id}", fg="green")
    current = data.get("current_keywords") or []
    missing = data.get("missing_keywords") or []
    high_freq = data.get("high_frequency_request_words") or []
    suggestions = data.get("suggestions") or []
    click.echo(f"Current ({len(current)}): {', '.join(str(w) for w in current)}")
    click.echo(f"Missing from manual ({len(missing)}): {', '.join(str(w) for w in missing)}")
    click.echo(
        f"High-frequency request words ({len(high_freq)}): "
        f"{', '.join(str(w) for w in high_freq)}"
    )
    click.echo(f"Suggested additions: {', '.join(str(w) for w in suggestions)}")


# ---------------------------------------------------------------------------
# tail
# ---------------------------------------------------------------------------


def _format_receipt_line(r: dict[str, Any]) -> str:
    """Render one receipt line. Handles both shapes:
    - own-agent (has ``id`` + ``agent_id``)
    - listing-scoped (has ``receipt_id``, NO agent_id by design)
    """
    rid = str(r.get("receipt_id") or r.get("id") or "?")
    agent = r.get("agent_id")
    agent_part = f"agent={(str(agent))[:8]} " if agent is not None else ""
    return (
        f"{r.get('created_at', '?')} "
        f"{agent_part}"
        f"status={str(r.get('status', '?')):<10} "
        f"steps={r.get('step_count', 0)} "
        f"latency={r.get('total_latency_ms', '?')}ms "
        f"id={rid[:8]}"
    )


@dev_command.command("tail")
@click.option(
    "--listing-id",
    default=None,
    help=(
        "Tail receipts that touched this publisher-owned listing "
        "(Q3-scoped to listings you own). Without this flag, tails YOUR "
        "OWN agent's recent receipts (debugging-your-own-agent view)."
    ),
)
@click.option("--agent-id", default=None, help="Filter by agent_id (own-agent mode only).")
@click.option(
    "--status",
    default=None,
    help="Filter by status (pending / running / completed / failed). Own-agent mode only.",
)
@click.option(
    "--limit",
    default=20,
    show_default=True,
    type=click.IntRange(1, 100),
    help="Receipts to fetch per poll.",
)
@click.option(
    "--follow",
    "-f",
    is_flag=True,
    help="Continuously poll for new receipts (Ctrl-C to stop).",
)
@click.option(
    "--interval",
    default=5,
    show_default=True,
    type=click.IntRange(1, 600),
    help="Poll interval in seconds when --follow is set.",
)
@click.option("--json", "json_output", is_flag=True)
def tail_command(
    listing_id: str | None,
    agent_id: str | None,
    status: str | None,
    limit: int,
    follow: bool,
    interval: int,
    json_output: bool,
) -> None:
    """Tail recent execution receipts.

    Two modes:
      - default (no --listing-id): tails YOUR OWN agent's recent receipts
        (Q3-scoped to current_user.id). Useful for debugging your own
        agent's tool usage. Filters: --agent-id, --status.
      - --listing-id <id>: tails receipts that touched a publisher-owned
        listing you own. Returns structural metadata only (no agent IDs,
        no summaries, no failure reasons) — privacy-safe across the
        publisher boundary.

    With --follow, polls every --interval seconds and prints new receipts
    as they appear. Without --follow, prints the most recent --limit and
    exits.
    """
    if listing_id and (agent_id or status):
        click.secho(
            "Note: --agent-id and --status are ignored in listing-scoped mode.",
            fg="yellow", err=True,
        )
    api_key = resolve_api_key()
    seen_ids: set[str] = set()

    def _coerce_receipts(data: Any) -> list[Any]:
        if isinstance(data, list):
            return data
        click.secho(
            "Unexpected response shape (expected list of receipts).",
            fg="red", err=True,
        )
        return []

    def _emit(receipts: list[Any]) -> None:
        # Reverse so the oldest in the page prints first; new receipts appear
        # at the bottom (typical tail behavior). Within a single --follow loop
        # we dedup by ID across polls; ordering across polls is best-effort.
        for r in reversed(receipts):
            if not isinstance(r, dict):
                continue
            # Listing-scoped responses use 'receipt_id'; owner-scoped use 'id'
            rid = str(r.get("receipt_id") or r.get("id") or "")
            if not rid or rid in seen_ids:
                continue
            seen_ids.add(rid)
            if json_output:
                click.echo(render_json(r))
            else:
                click.echo(_format_receipt_line(r))

    def _fetch(client: SiglumeClient) -> Any:
        if listing_id:
            data, _ = client.list_listing_recent_receipts(listing_id, limit=limit)
        else:
            data, _ = client.list_execution_receipts(
                agent_id=agent_id, status=status, limit=limit,
            )
        return data

    try:
        with SiglumeClient(api_key=api_key) as client:
            try:
                data = _fetch(client)
            except SiglumeAPIError as exc:
                click.secho(f"API error: {exc}", fg="red", err=True)
                raise click.Abort() from exc
            _emit(_coerce_receipts(data))

            if not follow:
                return

            click.secho(
                f"\n[follow mode, polling every {interval}s, Ctrl-C to stop]",
                fg="cyan", err=True,
            )
            while True:
                time.sleep(interval)
                try:
                    data = _fetch(client)
                except SiglumeAPIError as exc:
                    click.secho(f"poll error: {exc}", fg="yellow", err=True)
                    continue
                _emit(_coerce_receipts(data))
    except KeyboardInterrupt:
        # Catches Ctrl-C during initial fetch AND during follow-loop sleep/poll.
        click.echo("", err=True)
        click.secho("[interrupted]", fg="cyan", err=True)


# ---------------------------------------------------------------------------
# simulate
# ---------------------------------------------------------------------------


@dev_command.command("simulate")
@click.argument("offer_text")
@click.option(
    "--max-candidates",
    default=10,
    show_default=True,
    type=click.IntRange(1, 20),
    help="Cap on how many catalog tools to send to the LLM as candidates.",
)
@click.option("--json", "json_output", is_flag=True)
def simulate_command(
    offer_text: str, max_candidates: int, json_output: bool,
) -> None:
    """Predict the orchestrator's tool chain for an offer text WITHOUT executing it.

    Useful for testing "would my next API be picked for offers like this?"
    before publishing. Rate-limited server-side at 10 calls / publisher /
    UTC day; the response includes ``quota_used_today`` so you can pace
    yourself.

    Example:

        siglume dev simulate "translate english doc to japanese, post to notion"
    """
    api_key = resolve_api_key()
    with SiglumeClient(api_key=api_key) as client:
        try:
            data, _ = client.simulate_planner(
                offer_text=offer_text, max_candidates=max_candidates,
            )
        except SiglumeAPIError as exc:
            # 429 quota → friendly message
            if getattr(exc, "status_code", None) == 429:
                details = getattr(exc, "details", None) or {}
                quota_used = details.get("quota_used_today", "?")
                quota_limit = details.get("quota_limit", "?")
                reset_at = details.get("reset_at", "?")
                click.secho(
                    f"Daily simulate quota exceeded ({quota_used}/{quota_limit}). "
                    f"Resets at {reset_at}.",
                    fg="yellow", err=True,
                )
                raise click.Abort() from exc
            click.secho(f"API error: {exc}", fg="red", err=True)
            raise click.Abort() from exc

    if json_output:
        click.echo(render_json(data))
        return

    if not isinstance(data, dict):
        click.secho("Unexpected response shape.", fg="red", err=True)
        return

    catalog_size = data.get("catalog_size", 0)
    candidates = data.get("candidates_considered", 0)
    chain = data.get("predicted_chain") or []
    quota_used = data.get("quota_used_today", 0)
    quota_limit = data.get("quota_limit", 0)
    note = data.get("note")
    model = data.get("model", "?")

    click.secho(
        f"Simulated against {catalog_size} catalog listings "
        f"({candidates} considered) — model={model}",
        fg="green",
    )
    if not chain:
        click.echo("")
        click.secho(
            "Predicted chain: (empty)",
            fg="yellow",
        )
        if note:
            click.echo(f"  reason: {note}")
    else:
        click.echo("")
        click.echo("Predicted chain:")
        for i, call in enumerate(chain, 1):
            if not isinstance(call, dict):
                continue
            click.echo(
                f"  {i}. {call.get('tool_name', '?')} "
                f"(listing={call.get('listing_id', '?')[:8]}…, "
                f"title='{call.get('listing_title', '?')}')"
            )
            args = call.get("args") or {}
            if args:
                arg_summary = ", ".join(f"{k}={v!r}" for k, v in list(args.items())[:3])
                click.echo(f"     args: {arg_summary}")
        if note:
            click.echo("")
            click.echo(f"note: {note}")

    click.echo("")
    click.echo(f"Quota: {quota_used}/{quota_limit} used today")
