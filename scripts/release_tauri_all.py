#!/usr/bin/env python3
"""Prepare nine local signed Mac builds; commit/tag only after verification."""
# SPDX-License-Identifier: BSD-3-Clause
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import getpass
import hashlib
import json
import os
from pathlib import Path
import plistlib
import signal
import shutil
import subprocess
import sys
import time

from tauri_release_metadata import (
    dependency_snapshot, read_metadata, update_metadata, validate_version,
    verify_metadata,
)

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS = (
    {"id": "2a03", "repo": "tetorica-2a03-synth-tauri"},
    {"id": "dmg", "repo": "tetorica-dmg-synth-tauri"},
    {"id": "playground", "repo": "tetorica-fm2612-playground-tauri"},
    {"id": "synth", "repo": "tetorica-fm2612-synth-tauri"},
    {"id": "vgm-analyzer", "repo": "tetorica-fm2612-vgm-analyzer-tauri"},
    {"id": "huc6280", "repo": "tetorica-huc6280-synth-tauri"},
    {"id": "snes", "repo": "tetorica-sdsp-synth-tauri"},
    {"id": "sid", "repo": "tetorica-sid-synth-tauri"},
    {"id": "spu", "repo": "tetorica-spu-synth-tauri"},
)
METADATA_FILES = {
    "package.json", "package-lock.json", "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json", "release.lock.json",
}
SECRET_ENV = {"APPLE_PASSWORD", "APPLE_APP_SPECIFIC_PASSWORD"}


class ReleaseError(RuntimeError):
    pass


def clean_env():
    return {k: v for k, v in os.environ.items() if k not in SECRET_ENV}


class Runner:
    def run(self, argv, *, cwd, env=None, log=None, secret=None):
        child_env = clean_env()
        if env:
            child_env.update(env)
        argv = [str(a) for a in argv]
        handle = None
        child = None
        try:
            if log:
                Path(log).parent.mkdir(parents=True, exist_ok=True)
                handle = Path(log).open("a", encoding="utf-8")
                handle.write("$ " + " ".join(argv) + "\n")
            child = subprocess.Popen(
                argv, cwd=cwd, env=child_env, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                encoding="utf-8", errors="replace", start_new_session=True,
            )
            output = []
            for line in child.stdout:
                line = line.replace(secret, "[REDACTED]") if secret else line
                output.append(line)
                if handle:
                    handle.write(line)
                    handle.flush()
            code = child.wait()
            if code:
                detail = f"; see {log}" if log else ": " + "".join(output)[-2000:]
                raise ReleaseError(f"{argv[0]} failed (exit {code}){detail}")
            return "".join(output)
        finally:
            if child:
                if child.poll() is None:
                    try:
                        os.killpg(child.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
                child.stdout.close()
            if handle:
                handle.close()


def git(repo, *args, runner):
    return runner.run(["git", *args], cwd=repo).strip()


def file_record(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ReleaseError(f"Expected a regular file: {path}")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"path": str(path.resolve()), "bytes": path.stat().st_size,
            "sha256": digest.hexdigest()}


def check_record(record):
    if file_record(record["path"]) != record:
        raise ReleaseError(f"File changed since preparation: {record['path']}")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_state(path, state):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n",
                         encoding="utf-8")
    temporary.replace(path)


def state_path(root, version):
    return Path(root) / "release" / f"tauri_{validate_version(version)}" / "release-plan.json"


@contextmanager
def release_lock(root):
    directory = Path(root) / "release"
    directory.mkdir(parents=True, exist_ok=True)
    if directory.is_symlink() or not directory.is_dir():
        raise ReleaseError(f"Release output must be a real directory: {directory}")
    lock = directory / ".tauri_release.lock"
    try:
        descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise ReleaseError(f"Another release is active, or an interrupted lock remains: {lock}")
    try:
        with os.fdopen(descriptor, "w") as handle:
            handle.write(f"pid={os.getpid()}\n")
        yield
    finally:
        lock.unlink()


def changed_paths(repo, runner):
    # NUL delimiters preserve paths with spaces; a rename includes its old path.
    output = runner.run(["git", "status", "--porcelain=v1", "-z",
                         "--untracked-files=all"], cwd=repo)
    fields = output.split("\0")
    paths = []
    index = 0
    while index < len(fields):
        field = fields[index]
        index += 1
        if not field:
            continue
        paths.append(field[3:])
        if field[0] in "RC" or field[1] in "RC":
            paths.append(fields[index])
            index += 1
    return sorted(set(paths))


def tag_exists(repo, version, runner):
    return bool(git(repo, "tag", "--list", f"v{version}", runner=runner))


def npm_dependencies(repo):
    lock = read_json(repo / "package-lock.json")
    lock.pop("version", None)
    lock["packages"][""].pop("version", None)
    return lock


def plan_release(root, version, web_dir, products=PRODUCTS, runner=None):
    """Read only. Web manifest's version is deliberately independent of VERSION."""
    root, web_dir = Path(root).resolve(), Path(web_dir).resolve()
    version = validate_version(version)
    runner = runner or Runner()
    manifest = read_json(web_dir / "manifest.json")
    if manifest.get("kind") != "itch-batch-collection" or manifest.get("variant") != "download":
        raise ReleaseError("Use the normal Web collection (manifest variant download), not _for_run.")
    artifacts = manifest.get("artifacts", [])
    if not isinstance(artifacts, list) or not all(isinstance(a, dict) for a in artifacts):
        raise ReleaseError("Web collection artifacts must be a list of objects.")
    plan = {"schemaVersion": 1, "kind": "tauri-local-release", "version": version,
            "webVersion": manifest.get("version"), "webDirectory": str(web_dir),
            "webManifest": file_record(web_dir / "manifest.json"),
            "createdAt": datetime.now(timezone.utc).isoformat(), "status": "planned",
            "products": []}
    errors = []
    for product in products:
        repo = root / "w" / product["repo"]
        try:
            if repo.resolve().parent != (root / "w").resolve() or repo.is_symlink():
                raise ReleaseError("Repository must be a direct real child of w/.")
            if git(repo, "rev-parse", "--show-toplevel", runner=runner) != str(repo.resolve()):
                raise ReleaseError("Not an independent Git repository.")
            dirty = changed_paths(repo, runner)
            if dirty or (repo / "local-changes.json").exists():
                raise ReleaseError("Uncommitted/local imported-asset edits: " + ", ".join(dirty or ["local-changes.json"]))
            if tag_exists(repo, version, runner):
                raise ReleaseError(f"Tag v{version} already exists.")
            for name in ("deploy_mac.sh", "scripts/import_release.py"):
                if not (repo / name).is_file():
                    raise ReleaseError(f"Missing {name}")
            metadata = read_metadata(repo)
            matches = [a for a in artifacts if a.get("product") == product["id"]]
            if len(matches) != 1:
                raise ReleaseError("Expected exactly one Web archive for " + product["id"])
            archive = matches[0]
            name = archive["name"]
            if not isinstance(name, str) or Path(name).name != name or not name.endswith(".zip"):
                raise ReleaseError("Unsafe Web archive name.")
            source = file_record(web_dir / name)
            if source["sha256"] != archive.get("sha256") or source["bytes"] != archive.get("bytes"):
                raise ReleaseError("Web ZIP does not match its collection manifest: " + name)
            plan["products"].append({
                **product, "source": source["path"], "sourceSha256": source["sha256"],
                "sourceRecord": source, "baseHead": git(repo, "rev-parse", "HEAD", runner=runner),
                "metadata": metadata, "dependencies": dependency_snapshot(repo),
                "npmDependencies": npm_dependencies(repo),
                "status": "pending",
            })
        except (ReleaseError, OSError, ValueError, KeyError) as error:
            errors.append(f"{product['repo']}: {error}")
    if errors:
        raise ReleaseError("Preflight failed; no app was changed:\n" + "\n".join(errors))
    return plan


def allowed_path(name):
    return name in METADATA_FILES or name.startswith("dist/")


def fingerprint(repo, runner, allowed_staged=()):
    files = {}
    for name in changed_paths(repo, runner):
        if not allowed_path(name):
            raise ReleaseError(f"Unexpected change in {repo.name}: {name}")
        path = repo / name
        files[name] = file_record(path)["sha256"] if path.exists() else None
    staged = runner.run(["git", "diff", "--cached", "--name-only", "-z"], cwd=repo)
    if set(filter(None, staged.split("\0"))) - set(allowed_staged):
        raise ReleaseError(f"Index must be empty before final commit: {repo}")
    return files


def verify_inputs(repo, product, version, runner):
    if git(repo, "rev-parse", "HEAD", runner=runner) != product["baseHead"]:
        raise ReleaseError(f"HEAD changed: {repo}")
    check_record(product["sourceRecord"])
    verify_metadata(repo, version)
    if dependency_snapshot(repo) != product["dependencies"]:
        raise ReleaseError(f"Cargo dependencies changed during build: {repo}")
    if npm_dependencies(repo) != product["npmDependencies"]:
        raise ReleaseError(f"npm dependencies changed during build: {repo}")


def prepare_native_resources(repo, runner, log):
    """Playground's Cargo tests need resources normally prepared by Tauri CLI."""
    prepare = repo / "scripts/prepare_audio_sidecar.mjs"
    if not prepare.is_file():
        return None
    arch = runner.run(["node", "-p", "process.arch"], cwd=repo, log=log).strip()
    targets = {"arm64": "aarch64-apple-darwin", "x64": "x86_64-apple-darwin"}
    if arch not in targets:
        raise ReleaseError(f"Unsupported local Node architecture: {arch}")
    assets = json.loads(runner.run(
        ["node", "scripts/mac_audio_assets.mjs", targets[arch]], cwd=repo, log=log))
    if not isinstance(assets, dict) or not all(
            name.startswith("TETORICA_") and isinstance(value, str)
            for name, value in assets.items()):
        raise ReleaseError("Invalid local Playground audio asset environment.")
    runner.run(["node", "scripts/prepare_audio_sidecar.mjs"],
               cwd=repo, env=assets, log=log)
    runner.run(["node", "scripts/check_audio_sidecar_bundle.mjs"],
               cwd=repo, env=assets, log=log)
    return assets


def collect_artifacts(repo, product, version, output, runner, password):
    """Check the freshly built, signed/stapled app and collect both architectures."""
    records = []
    title = product["metadata"]["product"]
    for target, arch in (("x86_64-apple-darwin", "x86_64"),
                         ("aarch64-apple-darwin", "arm64")):
        bundle = repo / "src-tauri" / "target" / target / "release" / "bundle"
        app = bundle / "macos" / f"{title}.app"
        info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
        if info.get("CFBundleShortVersionString") != version:
            raise ReleaseError(f"Built app version mismatch: {app}")
        executable = app / "Contents/MacOS" / info["CFBundleExecutable"]
        log = output / "logs" / f"{product['id']}.log"
        for command in (
            ["codesign", "--verify", "--deep", "--strict", str(app)],
            ["xcrun", "stapler", "validate", str(app)],
            ["lipo", "-verify_arch", arch, str(executable)],
        ):
            runner.run(command, cwd=repo, log=log, secret=password)
        # Exact version/architecture matching avoids collecting an older DMG.
        suffix = "x64" if arch == "x86_64" else "aarch64"
        dmgs = list((bundle / "dmg").glob(f"*_{version}_{suffix}.dmg"))
        if len(dmgs) != 1 or dmgs[0].stat().st_mtime < product["buildStarted"]:
            raise ReleaseError(f"Expected one newly built {version}/{arch} DMG in {bundle}")
        folder = output / "artifacts" / product["id"]
        folder.mkdir(parents=True, exist_ok=True)
        app_zip = folder / f"{product['id']}_{version}_{arch}.app.zip"
        dmg = folder / f"{product['id']}_{version}_{arch}.dmg"
        if app_zip.exists() or dmg.exists():
            raise ReleaseError(f"Artifact output already exists: {folder}")
        runner.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent",
                    str(app), str(app_zip)], cwd=repo, log=log, secret=password)
        shutil.copy2(dmgs[0], dmg)
        records.extend([file_record(app_zip), file_record(dmg)])
    return records


def prepare_release(root, version, web_dir, products=PRODUCTS, runner=None, password=None):
    runner = runner or Runner()
    root = Path(root).resolve()
    # Complete all read-only preflight before writing state or importing an app.
    plan = plan_release(root, version, web_dir, products, runner)
    path = state_path(root, version)
    if path.parent.exists():
        raise ReleaseError(f"Output already exists: {path.parent}. Inspect the saved state before retrying.")
    if not password:
        raise ReleaseError("APPLE_PASSWORD is required for the local signed/notarized build.")
    with release_lock(root):
        # Repeat preflight under the global lock.
        plan = plan_release(root, version, web_dir, products, runner)
        path.parent.mkdir()
        plan["status"] = "building"
        write_state(path, plan)
        current = None
        try:
            for product in plan["products"]:
                current = product
                repo = root / "w" / product["repo"]
                log = path.parent / "logs" / f"{product['id']}.log"
                print(f"[{product['id']}] Import → version {version} → checks → deploy_mac.sh", flush=True)
                runner.run(["python3", "scripts/import_release.py", product["source"]],
                           cwd=repo, log=log)
                update_metadata(repo, version)
                commands = [
                    ["npm", "ci"], ["npm", "test"],
                    ["python3", "scripts/import_release.py", "--check"],
                ]
                for command in commands:
                    runner.run(command, cwd=repo, log=log)
                resource_env = prepare_native_resources(repo, runner, log)
                runner.run(["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked"],
                           cwd=repo, env=resource_env, log=log)
                verify_inputs(repo, product, version, runner)
                fingerprint(repo, runner)
                product["buildStarted"] = time.time()
                runner.run(["sh", "deploy_mac.sh"], cwd=repo,
                           env={"CI": "true", "APPLE_PASSWORD": password},
                           log=log, secret=password)
                runner.run(["python3", "scripts/import_release.py", "--check"],
                           cwd=repo, log=log)
                verify_inputs(repo, product, version, runner)
                product["artifacts"] = collect_artifacts(
                    repo, product, version, path.parent, runner, password)
                product["fingerprint"] = fingerprint(repo, runner)
                product["status"] = "built"
                write_state(path, plan)
            check_record(plan["webManifest"])
            plan["status"] = "built"
            write_state(path, plan)
            checksums = [f"{a['sha256']}  {Path(a['path']).relative_to(path.parent)}\n"
                         for p in plan["products"] for a in p["artifacts"]]
            (path.parent / "SHA256SUMS").write_text("".join(checksums), encoding="utf-8")
        except BaseException as error:
            plan["status"] = "failed"
            plan["failedProduct"] = current["id"] if current else None
            plan["error"] = str(error).replace(password, "[REDACTED]")
            write_state(path, plan)
            raise
    return plan


def commit_release(root, version, products=PRODUCTS, runner=None):
    root, version = Path(root).resolve(), validate_version(version)
    runner = runner or Runner()
    path = state_path(root, version)
    with release_lock(root):
        plan = read_json(path)
        if (plan.get("kind") != "tauri-local-release" or plan.get("version") != version
                or plan.get("status") not in ("built", "committing", "tagged")
                or [(p["id"], p["repo"]) for p in plan["products"]] !=
                   [(p["id"], p["repo"]) for p in products]):
            raise ReleaseError("A complete matching local build is required before commit/tag.")
        check_record(plan["webManifest"])
        # Validate the whole batch before creating the first commit.
        for product in plan["products"]:
            repo = root / "w" / product["repo"]
            for artifact in product["artifacts"]:
                check_record(artifact)
            check_record(product["sourceRecord"])
            verify_metadata(repo, version)
            if product.get("commit"):
                if git(repo, "rev-parse", "HEAD", runner=runner) != product["commit"]:
                    raise ReleaseError(f"Committed HEAD changed: {repo}")
                if changed_paths(repo, runner):
                    raise ReleaseError(f"Committed app has local edits: {repo}")
                if product.get("tagged"):
                    if git(repo, "rev-list", "-n", "1", f"v{version}", runner=runner) != product["commit"]:
                        raise ReleaseError(f"Tag changed: {repo}")
                elif tag_exists(repo, version, runner):
                    raise ReleaseError(f"Tag v{version} already exists: {repo}")
            else:
                verify_inputs(repo, product, version, runner)
                allowed_staged = product["fingerprint"] if product.get("staging") else ()
                if fingerprint(repo, runner, allowed_staged) != product["fingerprint"]:
                    raise ReleaseError(f"Working files changed after build: {repo}")
                if not product["fingerprint"]:
                    raise ReleaseError(f"No release changes to commit: {repo}")
                if tag_exists(repo, version, runner):
                    raise ReleaseError(f"Tag v{version} already exists: {repo}")
        plan["status"] = "committing"
        write_state(path, plan)
        for product in plan["products"]:
            repo = root / "w" / product["repo"]
            if not product.get("commit"):
                # Explicit verified paths, including deletions. Never git add .
                product["staging"] = True
                write_state(path, plan)
                git(repo, "add", "--", *product["fingerprint"], runner=runner)
                git(repo, "commit", "-m", f"Release v{version}", runner=runner)
                product["commit"] = git(repo, "rev-parse", "HEAD", runner=runner)
                write_state(path, plan)
            if not product.get("tagged"):
                git(repo, "tag", "-a", f"v{version}", "-m", f"Release v{version}",
                    product["commit"], runner=runner)
                product["tagged"] = True
                write_state(path, plan)
        plan["status"] = "tagged"
        write_state(path, plan)
    return plan


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--plan", action="store_true", help="Read-only preflight")
    modes.add_argument("--prepare", action="store_true", help="Import, set app version, validate and build locally")
    modes.add_argument("--commit", action="store_true", help="Create final local commits and vVERSION tags after verified builds")
    parser.add_argument("version", metavar="VERSION", help="App version written to metadata; independent of Web ZIP versions")
    parser.add_argument("--web-dir", type=Path, help="Existing normal itch_all_* collection; its version can differ from VERSION")
    args = parser.parse_args(argv)
    try:
        validate_version(args.version)
        if not args.commit and not args.web_dir:
            parser.error("--web-dir is required for --plan/--prepare (source selection is independent of app VERSION)")
        if args.plan:
            plan = plan_release(ROOT, args.version, args.web_dir)
            print(f"App version: {plan['version']}; source Web collection: {plan['webVersion']}")
            for product in plan["products"]:
                print(f"{product['repo']}: {product['metadata']['version']} → {args.version}; {Path(product['source']).name}")
        elif args.prepare:
            if sys.platform != "darwin":
                raise ReleaseError("--prepare uses the local macOS keychain and deploy_mac.sh; run it on your Mac.")
            missing = [name for name in ("git", "python3", "node", "npm", "cargo",
                                         "sh", "codesign", "xcrun", "lipo", "ditto")
                       if shutil.which(name) is None]
            if missing:
                raise ReleaseError("Missing local build tools: " + ", ".join(missing))
            # Preflight before asking for local credentials.
            plan_release(ROOT, args.version, args.web_dir)
            if not os.environ.get("APPLE_PASSWORD") and not sys.stdin.isatty():
                raise ReleaseError("Set APPLE_PASSWORD locally, or run interactively for hidden password entry.")
            password = os.environ.get("APPLE_PASSWORD") or getpass.getpass("APPLE_PASSWORD (local notarization only): ")
            prepare_release(ROOT, args.version, args.web_dir, password=password)
            print(f"Built and verified. Review {state_path(ROOT, args.version).parent}")
            print(f"Then: sh scripts/release_tauri_all.sh --commit {args.version}")
        else:
            commit_release(ROOT, args.version)
            print(f"Created local commits/tags v{args.version}. No push or GitHub publication performed.")
        return 0
    except (ReleaseError, OSError, ValueError, KeyError) as error:
        print(f"Release stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
