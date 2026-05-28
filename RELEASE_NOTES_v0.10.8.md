# v0.10.8 - UTF-8 documentation repair

This patch release restores the public SDK documentation and package metadata
after a Windows encoding regression committed mojibake into README, docs,
examples, comments, and docstrings.

## Fixed

- Restored UTF-8 arrows, em dashes, emoji, box-drawing characters, yen signs,
  and Japanese legal terms.
- Repaired README rendering on GitHub and in the PyPI long description.
- Added a tracked-text regression test for known mojibake marker sequences.

## Compatibility

- No runtime API behavior changes.
- Python and TypeScript package versions remain aligned.
- Existing `siglume` CLI behavior is unchanged.

## Validation

- `git grep` for the known mojibake marker set returns no matches.
- `py -3.11 -m pytest -q tests/test_docs_contract.py`
- `py -3.11 -m pytest -q`
