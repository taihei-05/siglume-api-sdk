"""Tests for `siglume dev <subcommand>` publisher dev tools.

Covers all 5 subcommands (gap-report / stats / miss-analysis / keywords / tail)
plus the registration of `dev` as a CLI group on `main`. SiglumeClient is
replaced with a FakeClient so tests don't hit the network.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from click.testing import CliRunner

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from siglume_api_sdk.cli import main  # noqa: E402
from siglume_api_sdk.cli.commands import dev_cmd as dev_cmd_module  # noqa: E402

# ---------------------------------------------------------------------------
# FakeClient — captures call args, returns configurable payloads
# ---------------------------------------------------------------------------


class FakeClient:
    """Drop-in replacement for SiglumeClient in dev_cmd tests."""

    last_call: tuple[str, dict[str, Any]] | None = None

    def __init__(self, api_key: str | None = None, **kwargs: Any) -> None:
        self.api_key = api_key

    def __enter__(self) -> "FakeClient":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        return None

    def get_gap_report(
        self, *, days: int, min_occurrences: int, limit: int,
    ) -> tuple[dict[str, Any], Any]:
        FakeClient.last_call = (
            "get_gap_report",
            {"days": days, "min_occurrences": min_occurrences, "limit": limit},
        )
        return (
            {
                "since": "2026-04-01T00:00:00+00:00",
                "until": "2026-05-01T00:00:00+00:00",
                "min_occurrences": min_occurrences,
                "shape_count": 2,
                "shapes": [
                    {
                        "shape_hash": "abcdef0123456789" * 4,
                        "sample_words": ["translate", "japanese", "deepl"],
                        "occurrences": 47,
                        "top_miss_kind": "no_keyword_match",
                        "latest_seen_at": "2026-04-30T12:00:00+00:00",
                    },
                    {
                        "shape_hash": "9999999999999999" * 4,
                        "sample_words": ["notion", "append", "page"],
                        "occurrences": 12,
                        "top_miss_kind": "no_keyword_match",
                        "latest_seen_at": "2026-04-29T08:30:00+00:00",
                    },
                ],
            },
            None,
        )

    def get_seller_listing_stats(
        self, listing_id: str, *, days: int,
    ) -> tuple[dict[str, Any], Any]:
        FakeClient.last_call = (
            "get_seller_listing_stats",
            {"listing_id": listing_id, "days": days},
        )
        return (
            {
                "listing_id": listing_id,
                "period_days": days,
                "total_bindings": 14,
                "active_bindings": 11,
                "period_revenue_minor": 3300,
                "revenue_currency": "USD",
                "total_executions": 240,
                "success_rate_pct": 96.7,
                "times_candidate": 380,
                "times_selected": 250,
                "selection_rate_pct": 65.8,
                "avg_latency_ms": 380.5,
                "p95_latency_ms": 920,
            },
            None,
        )

    def get_seller_selection_analysis(
        self, listing_id: str, *, days: int,
    ) -> tuple[dict[str, Any], Any]:
        FakeClient.last_call = (
            "get_seller_selection_analysis",
            {"listing_id": listing_id, "days": days},
        )
        return (
            {
                "listing_id": listing_id,
                "total_missed": 130,
                "reasons": [
                    {
                        "reason": "missing_trigger_keyword",
                        "count": 80,
                        "percentage": 61.5,
                        "suggestion": "Add 'translate' to usage_hints.",
                    },
                ],
                "top_competing_tools": ["t_translate_winner_a", "t_translate_winner_b"],
                "suggested_trigger_keywords": ["translate", "english", "japanese"],
            },
            None,
        )

    def get_seller_keyword_suggestions(
        self, listing_id: str,
    ) -> tuple[dict[str, Any], Any]:
        FakeClient.last_call = (
            "get_seller_keyword_suggestions",
            {"listing_id": listing_id},
        )
        return (
            {
                "listing_id": listing_id,
                "current_keywords": ["alpha", "beta"],
                "missing_keywords": ["gamma"],
                "high_frequency_request_words": ["translate", "japanese"],
                "suggestions": ["gamma", "translate"],
            },
            None,
        )

    def list_execution_receipts(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], Any]:
        FakeClient.last_call = (
            "list_execution_receipts",
            {"agent_id": agent_id, "status": status, "limit": limit, "offset": offset},
        )
        return (
            [
                {
                    "id": "receipt_a_0001",
                    "agent_id": "agent_xyz_0001",
                    "status": "completed",
                    "step_count": 3,
                    "total_latency_ms": 410,
                    "created_at": "2026-05-01T05:30:00+00:00",
                },
                {
                    "id": "receipt_b_0002",
                    "agent_id": "agent_xyz_0002",
                    "status": "failed",
                    "step_count": 1,
                    "total_latency_ms": 80,
                    "created_at": "2026-05-01T05:29:30+00:00",
                },
            ],
            None,
        )

    def list_listing_recent_receipts(
        self,
        listing_id: str,
        *,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], Any]:
        FakeClient.last_call = (
            "list_listing_recent_receipts",
            {"listing_id": listing_id, "limit": limit, "offset": offset},
        )
        return (
            [
                {
                    "receipt_id": "rcpt_listing_0001",
                    "status": "completed",
                    "step_count": 2,
                    "total_latency_ms": 240,
                    "created_at": "2026-05-01T06:00:00+00:00",
                    "completed_at": "2026-05-01T06:00:01+00:00",
                },
            ],
            None,
        )

    def simulate_planner(
        self,
        *,
        offer_text: str,
        max_candidates: int = 10,
    ) -> tuple[dict[str, Any], Any]:
        FakeClient.last_call = (
            "simulate_planner",
            {"offer_text": offer_text, "max_candidates": max_candidates},
        )
        return (
            {
                "offer_text": offer_text,
                "catalog_size": 50,
                "candidates_considered": 4,
                "predicted_chain": [
                    {
                        "tool_name": "translate_text",
                        "capability_key": "translate_text",
                        "listing_id": "lst_translate",
                        "listing_title": "DeepL Translator",
                        "args": {"target_lang": "ja", "text": "<offer text>"},
                    },
                    {
                        "tool_name": "notion_append_page",
                        "capability_key": "notion_append_page",
                        "listing_id": "lst_notion",
                        "listing_title": "Notion Page Appender",
                        "args": {"page_id": "p_x", "content": "<translated>"},
                    },
                ],
                "model": "claude-haiku-4-5-20251001",
                "quota_used_today": 3,
                "quota_limit": 10,
                "note": None,
            },
            None,
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _patch_client(monkeypatch) -> None:
    """Swap SiglumeClient + resolve_api_key in the dev_cmd namespace."""
    monkeypatch.setattr(dev_cmd_module, "SiglumeClient", FakeClient)
    monkeypatch.setattr(dev_cmd_module, "resolve_api_key", lambda: "sig_test_key")
    FakeClient.last_call = None


# ---------------------------------------------------------------------------
# Group registration
# ---------------------------------------------------------------------------


def test_dev_command_is_registered_on_main():
    runner = CliRunner()
    result = runner.invoke(main, ["dev", "--help"])
    assert result.exit_code == 0
    # All 6 subcommands listed (Phase 1: 5 + Phase 2: simulate)
    for sub in ("gap-report", "stats", "miss-analysis", "keywords", "tail", "simulate"):
        assert sub in result.output, f"subcommand {sub!r} missing from `siglume dev --help`"


# ---------------------------------------------------------------------------
# gap-report
# ---------------------------------------------------------------------------


def test_dev_gap_report_default_flags(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(main, ["dev", "gap-report"])
    assert result.exit_code == 0
    assert FakeClient.last_call == (
        "get_gap_report",
        {"days": 30, "min_occurrences": 3, "limit": 50},
    )
    # Human-readable output renders shape lines
    assert "2 unmet shapes" in result.output
    assert "translate" in result.output
    assert "47" in result.output


def test_dev_gap_report_json_flag(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(
        main, ["dev", "gap-report", "--days", "7", "--limit", "10", "--json"],
    )
    assert result.exit_code == 0
    assert FakeClient.last_call == (
        "get_gap_report",
        {"days": 7, "min_occurrences": 3, "limit": 10},
    )
    payload = json.loads(result.output)
    assert payload["shape_count"] == 2
    assert payload["shapes"][0]["sample_words"] == ["translate", "japanese", "deepl"]


def test_dev_gap_report_min_occurrences_below_3_rejected(monkeypatch):
    """Click IntRange(3, 1000) on --min-occurrences enforces the privacy floor at the CLI layer."""
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(main, ["dev", "gap-report", "--min-occurrences", "1"])
    assert result.exit_code != 0
    assert "Invalid value for '--min-occurrences'" in result.output or "is not in" in result.output


# ---------------------------------------------------------------------------
# stats
# ---------------------------------------------------------------------------


def test_dev_stats_renders_core_fields(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(main, ["dev", "stats", "listing_abc_123"])
    assert result.exit_code == 0
    assert FakeClient.last_call == (
        "get_seller_listing_stats",
        {"listing_id": "listing_abc_123", "days": 30},
    )
    assert "listing_abc_123" in result.output
    assert "Installs:" in result.output
    assert "Selection:" in result.output
    assert "65.8" in result.output  # selection_rate_pct


def test_dev_stats_json(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(
        main, ["dev", "stats", "listing_abc_123", "--days", "90", "--json"],
    )
    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["listing_id"] == "listing_abc_123"
    assert payload["period_days"] == 90
    assert FakeClient.last_call == (
        "get_seller_listing_stats",
        {"listing_id": "listing_abc_123", "days": 90},
    )


# ---------------------------------------------------------------------------
# miss-analysis
# ---------------------------------------------------------------------------


def test_dev_miss_analysis_shows_reasons_and_suggestions(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(main, ["dev", "miss-analysis", "listing_abc_123"])
    assert result.exit_code == 0
    assert FakeClient.last_call == (
        "get_seller_selection_analysis",
        {"listing_id": "listing_abc_123", "days": 30},
    )
    assert "130 candidate-but-not-selected" in result.output
    assert "missing_trigger_keyword" in result.output
    assert "Suggested trigger keywords" in result.output
    assert "translate" in result.output


# ---------------------------------------------------------------------------
# keywords
# ---------------------------------------------------------------------------


def test_dev_keywords_lists_buckets(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(main, ["dev", "keywords", "listing_xyz_777"])
    assert result.exit_code == 0
    assert FakeClient.last_call == (
        "get_seller_keyword_suggestions",
        {"listing_id": "listing_xyz_777"},
    )
    assert "Current (2)" in result.output
    assert "Missing from manual (1)" in result.output
    assert "gamma" in result.output


# ---------------------------------------------------------------------------
# tail
# ---------------------------------------------------------------------------


def test_dev_tail_default_one_shot(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(main, ["dev", "tail"])
    assert result.exit_code == 0
    assert FakeClient.last_call == (
        "list_execution_receipts",
        {"agent_id": None, "status": None, "limit": 20, "offset": 0},
    )
    # Two receipt lines, oldest-first (ID prefixes shown)
    assert "receipt_" in result.output
    assert "completed" in result.output
    assert "failed" in result.output


def test_dev_tail_passes_filters(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(
        main,
        ["dev", "tail", "--agent-id", "agent_x", "--status", "completed", "--limit", "5"],
    )
    assert result.exit_code == 0
    assert FakeClient.last_call == (
        "list_execution_receipts",
        {"agent_id": "agent_x", "status": "completed", "limit": 5, "offset": 0},
    )


def test_dev_tail_json_emits_per_receipt(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(main, ["dev", "tail", "--json"])
    assert result.exit_code == 0
    # Each receipt renders as its own JSON object (one per --json invocation per id);
    # we assert presence by ID rather than reparsing the full stream.
    assert "receipt_a_0001" in result.output
    assert "receipt_b_0002" in result.output


def test_dev_tail_dedups_within_a_page(monkeypatch):
    """If a page contains the same receipt twice, dedup suppresses the second."""
    _patch_client(monkeypatch)

    duplicated_payload = (
        [
            {
                "id": "receipt_dup_0001",
                "agent_id": "agent_z_0001",
                "status": "completed",
                "step_count": 1,
                "total_latency_ms": 50,
                "created_at": "2026-05-01T06:00:00+00:00",
            },
            {
                "id": "receipt_dup_0001",  # duplicate ID
                "agent_id": "agent_z_0001",
                "status": "completed",
                "step_count": 1,
                "total_latency_ms": 50,
                "created_at": "2026-05-01T06:00:00+00:00",
            },
        ],
        None,
    )

    def _list_receipts(self, **_kwargs):
        return duplicated_payload

    monkeypatch.setattr(
        FakeClient, "list_execution_receipts", _list_receipts,
    )

    runner = CliRunner()
    result = runner.invoke(main, ["dev", "tail"])
    assert result.exit_code == 0
    # ID appears only once in the rendered output despite duplicate in page
    assert result.output.count("receipt_") == 1


def test_dev_tail_dedups_across_follow_polls(monkeypatch):
    """Across multiple --follow polls, the same receipt seen twice is printed only once."""
    _patch_client(monkeypatch)

    base_receipt = {
        "id": "receipt_follow_0001",
        "agent_id": "agent_y",
        "status": "completed",
        "step_count": 2,
        "total_latency_ms": 200,
        "created_at": "2026-05-01T07:00:00+00:00",
    }

    poll_count = {"n": 0}

    def _list_receipts(self, **_kwargs):
        poll_count["n"] += 1
        # Every poll returns the SAME receipt — dedup must suppress repeats
        return ([dict(base_receipt)], None)

    monkeypatch.setattr(
        FakeClient, "list_execution_receipts", _list_receipts,
    )

    # Break the follow loop after 3 polls by raising KeyboardInterrupt from sleep
    sleep_calls = {"n": 0}

    def _fake_sleep(_seconds):
        sleep_calls["n"] += 1
        if sleep_calls["n"] >= 2:
            raise KeyboardInterrupt()

    monkeypatch.setattr(dev_cmd_module.time, "sleep", _fake_sleep)

    runner = CliRunner()
    # Use --json mode so the full ID is in the output (line-renderer truncates IDs to 8 chars)
    result = runner.invoke(
        main, ["dev", "tail", "--follow", "--interval", "1", "--json"],
    )
    assert result.exit_code == 0
    # The receipt ID should appear exactly once in stdout despite N polls returning it
    assert result.output.count("receipt_follow_0001") == 1
    # And we did poll multiple times (proving the dedup test was meaningful)
    assert poll_count["n"] >= 2


def test_dev_tail_unexpected_response_shape_emits_warning(monkeypatch):
    """If the API returns a dict instead of a list, the user sees a clear warning."""
    _patch_client(monkeypatch)

    def _list_receipts(self, **_kwargs):
        return ({"unexpected": "dict-not-list"}, None)

    monkeypatch.setattr(
        FakeClient, "list_execution_receipts", _list_receipts,
    )

    runner = CliRunner()
    result = runner.invoke(main, ["dev", "tail"])
    assert result.exit_code == 0
    assert "Unexpected response shape" in result.output


# ---------------------------------------------------------------------------
# Help text sanity (no traceback, helpful)
# ---------------------------------------------------------------------------


def test_dev_subcommand_help_renders():
    runner = CliRunner()
    for sub in ("gap-report", "stats", "miss-analysis", "keywords", "tail", "simulate"):
        result = runner.invoke(main, ["dev", sub, "--help"])
        assert result.exit_code == 0, f"`siglume dev {sub} --help` exited {result.exit_code}"
        assert sub.replace("-", "") in result.output.lower() or "Usage:" in result.output


# ─────────────────────────────────────────────────────────────────────
# Phase 2 — simulate command


def test_dev_simulate_renders_predicted_chain(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(main, ["dev", "simulate", "translate english to japanese"])
    assert result.exit_code == 0
    assert FakeClient.last_call == (
        "simulate_planner",
        {"offer_text": "translate english to japanese", "max_candidates": 10},
    )
    assert "Simulated against 50 catalog listings" in result.output
    assert "translate_text" in result.output
    assert "notion_append_page" in result.output
    assert "Quota: 3/10 used today" in result.output


def test_dev_simulate_json(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(
        main,
        ["dev", "simulate", "do something", "--max-candidates", "5", "--json"],
    )
    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["catalog_size"] == 50
    assert len(payload["predicted_chain"]) == 2
    assert FakeClient.last_call == (
        "simulate_planner",
        {"offer_text": "do something", "max_candidates": 5},
    )


def test_dev_simulate_max_candidates_above_20_rejected(monkeypatch):
    """Click IntRange(1, 20) on --max-candidates."""
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(
        main, ["dev", "simulate", "x", "--max-candidates", "999"],
    )
    assert result.exit_code != 0
    assert "Invalid value for '--max-candidates'" in result.output or "is not in" in result.output


def test_dev_simulate_429_quota_exceeded_friendly_message(monkeypatch):
    """429 with details emits a tidy quota message, not a stack trace."""
    _patch_client(monkeypatch)
    from siglume_api_sdk.client import SiglumeAPIError

    def _raise_429(self, **_kwargs):
        raise SiglumeAPIError(
            "Daily simulate quota of 10 reached. Resets at 00:00 UTC.",
            status_code=429,
            error_code="SIMULATE_QUOTA_EXCEEDED",
            details={
                "quota_used_today": 10,
                "quota_limit": 10,
                "reset_at": "2026-05-02T00:00:00+00:00",
            },
        )

    monkeypatch.setattr(FakeClient, "simulate_planner", _raise_429)

    runner = CliRunner()
    result = runner.invoke(main, ["dev", "simulate", "anything"])
    assert result.exit_code != 0
    assert "Daily simulate quota exceeded" in result.output
    assert "Resets at 2026-05-02" in result.output


def test_dev_simulate_empty_chain_shows_note(monkeypatch):
    _patch_client(monkeypatch)

    def _empty(self, **_kwargs):
        return (
            {
                "offer_text": "weird offer",
                "catalog_size": 50,
                "candidates_considered": 4,
                "predicted_chain": [],
                "model": "claude-haiku-4-5-20251001",
                "quota_used_today": 4,
                "quota_limit": 10,
                "note": "LLM picked no tools (offer may not match any catalog entry)",
            },
            None,
        )

    monkeypatch.setattr(FakeClient, "simulate_planner", _empty)

    runner = CliRunner()
    result = runner.invoke(main, ["dev", "simulate", "weird offer"])
    assert result.exit_code == 0
    assert "Predicted chain: (empty)" in result.output
    assert "LLM picked no tools" in result.output


# ─────────────────────────────────────────────────────────────────────
# Phase 2 — tail --listing-id (publisher-scoped feed)


def test_dev_tail_listing_id_routes_to_listing_endpoint(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(main, ["dev", "tail", "--listing-id", "lst_xyz"])
    assert result.exit_code == 0
    # Routes to list_listing_recent_receipts, not list_execution_receipts
    assert FakeClient.last_call == (
        "list_listing_recent_receipts",
        {"listing_id": "lst_xyz", "limit": 20, "offset": 0},
    )
    assert "rcpt_lis" in result.output  # truncated id from _format_receipt_line


def test_dev_tail_listing_id_warns_when_irrelevant_filters_passed(monkeypatch):
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(
        main,
        [
            "dev", "tail",
            "--listing-id", "lst_xyz",
            "--agent-id", "agent_x",
        ],
    )
    assert result.exit_code == 0
    assert "Note: --agent-id and --status are ignored" in result.output


def test_dev_tail_listing_id_response_has_no_agent_field(monkeypatch):
    """Listing-scoped responses omit agent_id by design — output line lacks 'agent='."""
    _patch_client(monkeypatch)
    runner = CliRunner()
    result = runner.invoke(main, ["dev", "tail", "--listing-id", "lst_xyz"])
    assert result.exit_code == 0
    assert "agent=" not in result.output
