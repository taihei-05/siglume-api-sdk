# Releasing siglume-api-sdk

This project publishes to **PyPI** as [`siglume-api-sdk`](https://pypi.org/project/siglume-api-sdk/) and mirrors each release as a **GitHub Release** with attached wheel + sdist.

The sections below are the full checklist. Follow them top-to-bottom for every release.

---

## Pre-release checklist

Before cutting a version tag:

- [ ] `main` is green (CI passing on Python 3.11 and 3.12)
- [ ] `CHANGELOG.md` has a new section `## [X.Y.Z] -- YYYY-MM-DD` with **Added / Changed / Deprecated / Removed / Fixed / Security** sub-sections as appropriate
- [ ] Version in `pyproject.toml` (`[project].version`) matches the tag you're about to cut
- [ ] `RELEASE_NOTES_vX.Y.Z.md` exists at the repo root, written as the GitHub Release body (highlights, revenue model, quick start, what's next, honest note)
- [ ] `examples/hello_price_compare.py` and `examples/x_publisher.py` still run end-to-end against `AppTestHarness`
- [ ] `docs/` and `README.md` are coherent with the shipped `siglume_api_sdk.py` surface (no references to removed symbols)
- [ ] There is **no** stale `siglume_app_sdk` / `siglume-app-sdk` / `siglume-app-types` reference (`grep -rn` expects zero matches)

## Build artifacts

From the repo root on `main`:

```bash
# Clean previous build output
rm -rf dist/ build/ siglume_api_sdk.egg-info/

# Build sdist + wheel
py -3.11 -m pip install --upgrade build
py -3.11 -m build
```

This produces two files in `dist/`:

- `siglume_api_sdk-X.Y.Z-py3-none-any.whl`
- `siglume_api_sdk-X.Y.Z.tar.gz`

Inspect the sdist manifest (`tar -tzf dist/*.tar.gz`) — it should contain `LICENSE`, `README.md`, `pyproject.toml`, `PKG-INFO`, and the two `siglume_api_sdk*.py` modules. Nothing else.

## Publish to PyPI

Get a project-scoped API token from <https://pypi.org/manage/account/token/> (see [SECURITY.md](./SECURITY.md#release-token-hygiene)).

**Two ways to pass the token** — pick one:

### Option A: Persistent `.pypirc` (recommended, set up once)

Create `~/.pypirc` (on Windows: `%USERPROFILE%\.pypirc`, e.g. `D:\Users\<you>\.pypirc`).

**Important**: do not put an inline `# comment` on the `password` line — `configparser` reads the whole line (including `#`) as the value, so twine would submit a bogus token and uploads would fail with auth errors. Put any comment on its own line above the password.

```ini
[distutils]
index-servers =
    pypi

[pypi]
username = __token__
# paste the full pypi-... token on the line below, nothing else on that line
password = pypi-AgENdGVzdC5weXBpLm9yZwIk...
```

After this, every release is just:

```bash
# bash / WSL / macOS
py -3.11 -m twine upload dist/*
```

```powershell
# PowerShell (Windows)
py -3.11 -m twine upload dist\*
```

No token prompts, no env var dance on subsequent releases.

**Security tradeoff — read before choosing Option A:** [SECURITY.md](./SECURITY.md#release-token-hygiene) rule 3 recommends rotating the token after every release. Persistent `.pypirc` trades that per-release rotation for convenience; the token stays valid on disk between releases. Choose Option A only if you accept the longer-lived token and keep the file on a trusted disk (no shared machine, no cloud sync of your user profile). For strict compliance with the rotate-every-release policy, use **Option B** below. In either case, rotate immediately if you suspect compromise, change machines, or see unexpected releases.

### Option B: Per-release env vars

```powershell
$env:TWINE_USERNAME = "__token__"
$env:TWINE_PASSWORD = "pypi-..."   # paste the token
py -3.11 -m twine upload dist\*
Remove-Item env:TWINE_USERNAME
Remove-Item env:TWINE_PASSWORD
```

Use this if you don't want credentials on disk. Revoke the token after each release.

### Windows terminal encoding workaround

On Windows PowerShell, `twine upload` can abort with `UnicodeEncodeError: 'cp932' codec` when rendering the progress bar. Prefix the command with UTF-8 env vars:

```powershell
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"
py -3.11 -m twine upload dist\*
```

The upload **fails silently** if the encoding error fires before the HTTP request completes — always verify with the PyPI project page afterward (see sanity check below).

### Token recovery if you lose it

PyPI shows a token only at creation. If you've lost it:

1. Check password managers (1Password / Bitwarden / Chrome) for `pypi` or the project name
2. Check Gmail for `from:noreply@pypi.org` (recovery codes were emailed at 2FA setup)
3. Check mobile Authenticator apps (Google Authenticator / Authy / 1Password) for a `pypi.org` entry
4. Last resort: email `admin@pypi.org` with account proof (takes 1-3 days)

Once logged in, delete the old token entry and create a fresh one — old and new can coexist, so no harm in generating a replacement.

## Tag and create the GitHub Release

Use **annotated tags** (with `-a -m`) so `git log` shows the release info clearly:

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z — <headline>"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z — <headline>" --notes-file RELEASE_NOTES_vX.Y.Z.md dist/*.whl dist/*.tar.gz
```

(The `gh release create` form above attaches artifacts in one call — no separate `gh release upload` needed.)

Post-release sanity check:

- `curl -s https://pypi.org/simple/siglume-api-sdk/ | grep X.Y.Z` returns multiple matches (whl + sdist registered)
- `pip install siglume-api-sdk==X.Y.Z` in a clean venv succeeds
- `python -c "import siglume_api_sdk; print(siglume_api_sdk.__name__)"` prints `siglume_api_sdk`
- The GitHub Release page shows the two asset files with the correct SHAs

The PyPI JSON API (`https://pypi.org/pypi/siglume-api-sdk/json`) can lag a few minutes for `info.version` to reflect the latest. The `simple/` index updates immediately.

## Patch releases (X.Y.Z+1)

For bug fixes, repeat the full flow with the next patch version. Update:

1. `pyproject.toml` → bump patch version
2. `CHANGELOG.md` → add a new `[X.Y.Z+1]` section
3. Create `RELEASE_NOTES_vX.Y.Z+1.md` (can be terse for patch releases)
4. Rebuild + upload + tag + Release

## Post-release patches (`.post` releases)

Use **`.post`** when you need to ship a metadata-only change (typos in `README.md`, broken URL in `pyproject.toml`, etc.) **without** a code change:

```
siglume-api-sdk 0.1.0      # original release
siglume-api-sdk 0.1.0.post1  # docs-only fix
```

A `.post` release still increments the PyPI version, so users `pip install -U` can pick it up. Bump `[project].version = "0.1.0.post1"` and follow the same build/upload flow. **Do not** use `.post` for code changes — those go to the next patch release.

## Yanking a bad release

If a release is broken enough that it must be withdrawn, **yank** (don't delete — PyPI forbids deletion of a version once uploaded):

```bash
py -3.11 -m twine yank --reason "broken: <one-line explanation>" siglume-api-sdk==X.Y.Z
```

Yanking makes the version invisible to `pip install siglume-api-sdk` resolution (it will skip the yanked version unless explicitly pinned), but anyone who already installed it keeps working. Follow up with a fixed release (`X.Y.Z+1` or `X.Y.Z.post1`) ASAP.

**Also**: mark the yanked GitHub Release as "pre-release" and edit the body to start with `⚠️ YANKED -- see vA.B.C`.

## Hotfix flow (critical security / data-loss bug)

1. Cut a branch off the broken tag: `git checkout -b hotfix/vX.Y.Z+1 vX.Y.Z`
2. Apply the minimal fix + a regression test
3. Yank the broken version first (above), then run the full release flow for `vX.Y.Z+1`
4. Merge the hotfix branch back to `main`

## Version numbering

Semantic versioning (<https://semver.org>):

- **Major (X)** — breaking API changes (rename, remove, signature change)
- **Minor (Y)** — additive (new modules, new manifest fields, new example)
- **Patch (Z)** — bug fix, no API surface change
- **`.postN`** — docs / packaging metadata only

The project is `0.Y.Z` (alpha) until the public surface stabilises. While under `0.`, minor bumps may include breaking changes; we'll call them out explicitly in `CHANGELOG.md`.
