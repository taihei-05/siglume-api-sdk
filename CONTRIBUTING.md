# Contributing to Siglume API Store SDK

Thanks for your interest in contributing!

## Two types of contribution

### 1. Publishing your own API to the API Store

This is the most common contribution. You build an API, register it on
the platform, and it gets listed in the store after admin review.

**You do NOT submit a PR to this repo to publish an API.**

The registration flow is:

1. Build your API with `AppAdapter`
2. Test locally with `AppTestHarness`
3. Register via `POST /v1/market/capabilities/auto-register`
4. Confirm with your [tool manual](GETTING_STARTED.md#13-tool-manual-guide) → quality check runs automatically
5. Admin reviews → published to the API Store

See [GETTING_STARTED.md](GETTING_STARTED.md) for the full guide.

### 2. Improving the SDK itself

If you want to fix bugs, improve documentation, or add new examples
to this SDK repository, follow the steps below.

## Dev Environment Setup

```bash
git clone https://github.com/taihei-05/siglume-api-sdk.git
cd siglume-api-sdk
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
```

## Dev Container (optional)

This repository includes a `.devcontainer/` configuration.
Opening this project in VS Code or GitHub Codespaces
automatically detects the configuration and sets up a
ready-to-use development environment.

The container uses Python 3.11 and installs the SDK
in editable mode automatically. Recommended VS Code
extensions such as Python, Pylance, and YAML support
are also included.

Use the Dev Container if you want a quick, zero-setup
environment. You can still use the local virtual
environment setup above if you prefer manual setup.

## Making SDK Changes

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
- Keep PRs small and focused — one feature or fix per PR.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
Be respectful, constructive, and inclusive.
