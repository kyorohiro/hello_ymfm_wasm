#!/usr/bin/env python3
"""Set the same repository APPLE_PASSWORD secret for local Tetorica Tauri apps."""
# SPDX-License-Identifier: BSD-3-Clause
import argparse
import getpass
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import urlsplit

SECRET = "APPLE_PASSWORD"
DEFAULT_WORKSPACE = Path(__file__).resolve().parents[1] / "w"


def github_repository(origin):
    if origin.startswith("git@github.com:"):
        path = origin.removeprefix("git@github.com:")
    else:
        parsed = urlsplit(origin)
        if parsed.scheme not in ("https", "ssh") or parsed.hostname != "github.com":
            raise ValueError("Unsupported GitHub origin")
        path = parsed.path.lstrip("/")
    path = path.removesuffix(".git")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/tetorica-[A-Za-z0-9_.-]+-tauri", path):
        raise ValueError("Expected a Tetorica Tauri GitHub repository")
    return path


def find_repositories(workspace):
    repositories = set()
    if not workspace.is_dir():
        raise ValueError("Tauri workspace directory not found")
    for folder in sorted(workspace.glob("tetorica-*-tauri")):
        if not folder.is_dir() or not (folder / ".git").exists():
            continue
        result = subprocess.run(
            ["git", "-C", str(folder), "config", "--get", "remote.origin.url"],
            capture_output=True, text=True, env=clean_environment(), check=False,
        )
        if result.returncode:
            raise ValueError("Could not read GitHub origin for " + folder.name)
        try:
            repositories.add(github_repository(result.stdout.strip()))
        except ValueError:
            # Never include the raw remote URL: it could contain credentials.
            raise ValueError("Unsupported GitHub origin for " + folder.name) from None
    if not repositories:
        raise ValueError("No local Tetorica Tauri repositories found")
    return sorted(repositories)


def clean_environment():
    # Keep GitHub CLI authentication, but do not pass Apple passwords in the
    # child environment. The value reaches gh only through its standard input.
    return {key: value for key, value in os.environ.items()
            if key not in ("APPLE_PASSWORD", "APPLE_APP_SPECIFIC_PASSWORD")}


def register_password(repositories, password, gh="gh"):
    if not password or any(character in password for character in "\r\n\0"):
        raise ValueError("Apple app-specific password is empty or contains a line break")
    failed = []
    for repository in repositories:
        result = subprocess.run(
            [gh, "secret", "set", SECRET, "--repo", "github.com/" + repository, "--app", "actions"],
            input=password.encode("utf-8"), stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, env=clean_environment(), check=False,
        )
        if result.returncode:
            failed.append(repository)
            print("Failed: " + repository)
        else:
            print("Updated: " + repository)
    return failed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="List targets without reading or uploading a password")
    parser.add_argument("--workspace", type=Path, default=DEFAULT_WORKSPACE, help="Directory containing the Tauri checkouts (default: repository w/)")
    args = parser.parse_args(argv)
    repositories = find_repositories(args.workspace)
    print("Repository secret APPLE_PASSWORD targets:")
    for repository in repositories:
        print("  " + repository)
    if args.dry_run:
        print(f"Preview only: {len(repositories)} repositories; no secrets changed.")
        return 0
    gh = shutil.which("gh")
    if not gh:
        raise ValueError("GitHub CLI is required: install gh and run gh auth login")
    auth = subprocess.run([gh, "auth", "status"], stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, env=clean_environment(), check=False)
    if auth.returncode:
        raise ValueError("GitHub CLI authentication failed; run gh auth login first")
    password = os.environ.get(SECRET)
    if password is None:
        if not sys.stdin.isatty():
            raise ValueError("Run interactively for a hidden password prompt, or provide APPLE_PASSWORD in the environment")
        password = getpass.getpass("Apple app-specific password (hidden): ")
    failed = register_password(repositories, password, gh)
    password = None
    if failed:
        print(f"Updated {len(repositories)-len(failed)}/{len(repositories)} repositories. Check access/network and rerun to retry.")
        return 1
    print(f"Updated {len(repositories)} repository secrets. Workflows were not triggered.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError):
        # Avoid printing subprocess exceptions, which could include stdin data.
        print("Setup failed. Check gh authentication, local Tauri origins and terminal input. Use --dry-run to inspect targets.", file=sys.stderr)
        raise SystemExit(1) from None
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled; no further secrets were changed.", file=sys.stderr)
        raise SystemExit(130) from None
