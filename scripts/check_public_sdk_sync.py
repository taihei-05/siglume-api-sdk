from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath


SDK_ROOT = Path(__file__).resolve().parents[1]
IGNORE_FILE = SDK_ROOT / "public-sync-ignore.txt"
PRIVATE_REPO = "https://github.com/taihei-05/siglume.git"
PUBLIC_REPO = "https://github.com/taihei-05/siglume-api-sdk.git"
PRIVATE_MIRROR_PREFIX = "packages/contracts/sdk"


def _run(*args: str, cwd: Path | None = None) -> str:
    result = subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def _git_repo_root(path: Path) -> Path:
    return Path(_run("git", "-C", str(path), "rev-parse", "--show-toplevel").strip())


REPO_ROOT = _git_repo_root(SDK_ROOT)
LOCAL_MIRROR_PREFIX = "" if SDK_ROOT == REPO_ROOT else SDK_ROOT.relative_to(REPO_ROOT).as_posix()
DEFAULT_PEER_REPO = PRIVATE_REPO if not LOCAL_MIRROR_PREFIX else PUBLIC_REPO


def _tracked_files(repo_root: Path, prefix: str) -> set[str]:
    args = ["git", "-C", str(repo_root), "ls-files"]
    if prefix:
        args.append(prefix)
    output = _run(*args)
    files: set[str] = set()
    prefix_with_sep = f"{prefix}/" if prefix else ""
    for line in output.splitlines():
        if not line:
            continue
        if prefix:
            if line.startswith(prefix_with_sep):
                files.add(line[len(prefix_with_sep):])
        else:
            files.add(line)
    return files


def _detect_mirror_prefix(repo_root: Path) -> str:
    candidate = repo_root / PRIVATE_MIRROR_PREFIX
    if candidate.is_dir():
        return PRIVATE_MIRROR_PREFIX
    return ""


def _load_ignore_patterns() -> list[str]:
    patterns: list[str] = []
    for raw_line in IGNORE_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        patterns.append(line)
    return patterns


def _is_ignored(path: str, patterns: list[str]) -> bool:
    pure = PurePosixPath(path)
    return any(pure.match(pattern) for pattern in patterns)


def _clone_public_repo(repo_url: str, ref: str) -> Path:
    temp_dir = Path(tempfile.mkdtemp(prefix="siglume-public-sdk-"))
    try:
        _run("git", "clone", "--depth", "1", "--branch", ref, repo_url, str(temp_dir))
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    return temp_dir


def _mirror_path(repo_root: Path, prefix: str, relative_path: str) -> Path:
    root = repo_root / prefix if prefix else repo_root
    return root / relative_path


def _compare_files(peer_dir: Path, patterns: list[str], *, peer_prefix: str) -> list[str]:
    local_files = {path for path in _tracked_files(REPO_ROOT, LOCAL_MIRROR_PREFIX) if not _is_ignored(path, patterns)}
    peer_files = {path for path in _tracked_files(peer_dir, peer_prefix) if not _is_ignored(path, patterns)}

    issues: list[str] = []

    only_local = sorted(local_files - peer_files)
    only_peer = sorted(peer_files - local_files)
    if only_local:
        issues.append("Files only in the local SDK mirror:")
        issues.extend(f"  - {path}" for path in only_local)
    if only_peer:
        issues.append("Files only in the peer SDK mirror:")
        issues.extend(f"  - {path}" for path in only_peer)

    for rel_path in sorted(local_files & peer_files):
        local_bytes = _mirror_path(REPO_ROOT, LOCAL_MIRROR_PREFIX, rel_path).read_bytes()
        peer_bytes = _mirror_path(peer_dir, peer_prefix, rel_path).read_bytes()
        if local_bytes != peer_bytes:
            issues.append(f"  - content differs: {rel_path}")

    return issues


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fail if this SDK mirror drifts from its peer repository.",
    )
    parser.add_argument("--peer-repo", default=None)
    parser.add_argument("--peer-ref", default="main")
    parser.add_argument(
        "--peer-dir",
        help="Use an existing checkout instead of cloning the peer repo.",
    )
    parser.add_argument("--public-repo", dest="legacy_peer_repo", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--public-ref", dest="legacy_peer_ref", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--public-dir", dest="legacy_peer_dir", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()

    patterns = _load_ignore_patterns()
    peer_repo = args.peer_repo or args.legacy_peer_repo or DEFAULT_PEER_REPO
    peer_ref = args.legacy_peer_ref or args.peer_ref
    peer_dir_arg = args.peer_dir or args.legacy_peer_dir
    peer_dir: Path | None = Path(peer_dir_arg).resolve() if peer_dir_arg else None
    cleanup = False
    if peer_dir is None:
        peer_dir = _clone_public_repo(peer_repo, peer_ref)
        cleanup = True

    try:
        peer_prefix = _detect_mirror_prefix(peer_dir)
        issues = _compare_files(peer_dir, patterns, peer_prefix=peer_prefix)
    finally:
        if cleanup:
            shutil.rmtree(peer_dir, ignore_errors=True)

    if issues:
        print("SDK mirror drift detected:", file=sys.stderr)
        for issue in issues:
            print(issue, file=sys.stderr)
        return 1

    print("SDK mirrors are in sync.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
