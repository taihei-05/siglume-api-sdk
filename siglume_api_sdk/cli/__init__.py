from __future__ import annotations

from typing import Any

import click

from siglume_api_sdk.cli.commands.dev_cmd import dev_command
from siglume_api_sdk.cli.commands.diff_cmd import diff_command
from siglume_api_sdk.cli.commands.init_cmd import init_command
from siglume_api_sdk.cli.commands.preflight_cmd import preflight_command
from siglume_api_sdk.cli.commands.register_cmd import register_command
from siglume_api_sdk.cli.commands.scan_cmd import scan_command
from siglume_api_sdk.cli.commands.score_cmd import score_command
from siglume_api_sdk.cli.commands.support_cmd import support_command
from siglume_api_sdk.cli.commands.test_cmd import test_command
from siglume_api_sdk.cli.commands.usage_cmd import usage_command
from siglume_api_sdk.cli.commands.validate_cmd import validate_command
from siglume_api_sdk.cli.project import list_company_publishers_report, render_json


@click.group()
def main() -> None:
    """Siglume developer CLI."""


def _render_company_table(companies: list[dict[str, Any]]) -> list[str]:
    rows = [
        [
            str(item.get("company_id") or item.get("id") or ""),
            str(item.get("name") or ""),
            str(item.get("membership_role") or ("founder" if item.get("is_founder") else "")),
            "ready" if item.get("settlement_wallet_ready") is True else "not_ready",
            str(item.get("pending_approval_count") or 0),
        ]
        for item in companies
    ]
    headers = ["company_id", "name", "role", "settlement", "pending"]
    widths = [
        max([len(header), *(len(row[index]) for row in rows)])
        for index, header in enumerate(headers)
    ]
    return [
        "  ".join(header.ljust(widths[index]) for index, header in enumerate(headers)),
        "  ".join("-" * width for width in widths),
        *["  ".join(cell.ljust(widths[index]) for index, cell in enumerate(row)) for row in rows],
    ]


@click.command("companies")
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON.")
def companies_command(json_output: bool) -> None:
    """List Siglume companies available for company-name publishing."""
    report = list_company_publishers_report()
    if json_output:
        click.echo(render_json(report))
        return
    companies = [
        item for item in report.get("companies", [])
        if isinstance(item, dict)
    ]
    if not companies:
        click.echo("No company publishers available for this API key.")
        return
    click.echo("Company publishers")
    for line in _render_company_table(companies):
        click.echo(line)


main.add_command(init_command)
main.add_command(diff_command)
main.add_command(validate_command)
main.add_command(test_command)
main.add_command(score_command)
main.add_command(preflight_command)
main.add_command(companies_command)
main.add_command(register_command)
main.add_command(scan_command)
main.add_command(support_command)
main.add_command(usage_command)
main.add_command(dev_command)
