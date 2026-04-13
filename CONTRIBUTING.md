# Contributing to Siglume App SDK

Thanks for your interest in contributing! This guide covers the practical steps.

## Dev Environment Setup

```bash
git clone https://github.com/siglume/siglume-app-sdk.git
cd siglume-app-sdk
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
```

## Creating a New App

1. Fork this repository.
2. Copy `examples/hello_price_compare.py` or one of the community templates in `examples/` as a starting point.
3. Implement the `AppAdapter` interface from `siglume_app_sdk.py`.
4. Test your app locally using `AppTestHarness`, or run your example script directly:
   ```bash
   python examples/hello_price_compare.py
   ```
5. If you add a new sample app, place it under `examples/` and document what it does in the PR description.

## Submitting Changes

1. Create a feature branch from `main`.
2. Make your changes with clear, focused commits.
3. Ensure all tests pass before opening a PR.
4. Open a pull request against `main` with a description of what changed and why.

## Code Style

- **Python**: Format with [black](https://github.com/psf/black) and lint with [ruff](https://github.com/astral-sh/ruff).
- **TypeScript**: Format with [prettier](https://prettier.io/).

Run formatting before committing:

```bash
black .
ruff check --fix .
```

## Review Process

- All PRs require at least one approving review before merge.
- Maintainers may request changes or ask clarifying questions.
- Keep PRs small and focused -- one feature or fix per PR.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
Be respectful, constructive, and inclusive.
