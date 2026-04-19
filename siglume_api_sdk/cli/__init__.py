from __future__ import annotations

import click

from siglume_api_sdk.cli.commands.init_cmd import init_command
from siglume_api_sdk.cli.commands.register_cmd import register_command
from siglume_api_sdk.cli.commands.score_cmd import score_command
from siglume_api_sdk.cli.commands.support_cmd import support_command
from siglume_api_sdk.cli.commands.test_cmd import test_command
from siglume_api_sdk.cli.commands.usage_cmd import usage_command
from siglume_api_sdk.cli.commands.validate_cmd import validate_command


@click.group()
def main() -> None:
    """Siglume developer CLI."""


main.add_command(init_command)
main.add_command(validate_command)
main.add_command(test_command)
main.add_command(score_command)
main.add_command(register_command)
main.add_command(support_command)
main.add_command(usage_command)
