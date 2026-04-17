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

Get a project-scoped API token (see [SECURITY.md](./SECURITY.md#release-token-hygiene)), then upload via environment variables — the prompt-based flow mangles paste on some shells:

```powershell
$env:TWINE_USERNAME = "__token__"
$env:TWINE_PASSWORD = "pypi-..."   # paste the token
py -3.11 -m twine upload dist\*
Remove-Item env:TWINE_USERNAME
Remove-Item env:TWINE_PASSWORD
```

After upload, **revoke the token immediately** from <https://pypi.org/manage/account/token/> and issue a fresh project-scoped token for the next release. Rotate every release, no exceptions.

## Tag and create the GitHub Release

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
gh release create vX.Y.Z -F RELEASE_NOTES_vX.Y.Z.md --title "vX.Y.Z -- <headline>"
gh release upload vX.Y.Z dist/*.whl dist/*.tar.gz --clobber
```

Post-release sanity check:

- `pip install siglume-api-sdk==X.Y.Z` in a clean venv succeeds
- `python -c "import siglume_api_sdk; print(siglume_api_sdk.__name__)"` prints `siglume_api_sdk`
- The GitHub Release page shows the two asset files with the correct SHAs

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
