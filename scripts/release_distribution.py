#!/usr/bin/env python3
"""Prepare Web releases, collect desktop CI builds, and publish verified assets."""
# SPDX-License-Identifier: BSD-3-Clause
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from release_tauri_all import (
    PRODUCTS, ROOT, ReleaseError, check_record, clean_env, file_record,
    read_json, release_lock, select_products, state_path, validate_batch, validate_version, write_state,
)

GITHUB_OWNER = "kyorohiro"
WEB_REPO = f"{GITHUB_OWNER}/hello_ymfm_wasm"
ITCH_SLUG = {
    "2a03": "tetorica-2a03-synth", "aswan": "tetorica-aswan-synth",
    "dmg": "tetorica-dmg-synth", "fm2608": "tetorica-fm2608-synth",
    "huc6280": "tetorica-huc6280-synth", "nitro-ds": "tetorica-nitro-ds-synth",
    "playground": "tetorica-fm2612-playground", "scsp": "tetorica-scsp-synth",
    "sid": "tetorica-sid-synth", "snes": "tetorica-sdsp-synth",
    "smsgear": "tetorica-smsgear-ym2413-synth", "spu": "tetorica-spu-synth",
    "synth": "tetorica-fm2612", "vgm-analyzer": "tetorica-fm2612-analyzer",
    "ym2149-st": "tetorica-st-ym2149-synth",
}
CI_PLATFORMS = {
    "windows-x86_64": {".exe": "win-x64"},
    "linux-x86_64": {".deb": "linux-x64-deb", ".AppImage": "linux-x64"},
    "linux-arm64": {".deb": "linux-arm64-deb", ".AppImage": "linux-arm64"},
}
WEB_WORKFLOWS = ("itch-web.yml", "vgm-mock.yml", "sbi.yml")
MAC_DMG_CHANNELS = (("arm64", "mac-arm64"), ("x86_64", "mac-x64"))


def run(*argv, cwd=ROOT, capture=True):
    process = subprocess.run(
        [str(arg) for arg in argv], cwd=cwd, env=clean_env(),
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None, text=True,
    )
    if process.returncode:
        raise ReleaseError((process.stderr or f"{argv[0]} exited {process.returncode}").strip())
    return process.stdout.strip() if capture else None


def gh_json(*argv):
    return json.loads(run("gh", *argv))


def web_state(version):
    return ROOT / "release" / f"distribution_{validate_version(version)}" / "web.json"


def prepare_web(version):
    commit = run("git", "rev-parse", "HEAD")
    if run("git", "status", "--porcelain"):
        raise ReleaseError("Prepare Web ZIPs from a clean commit.")
    state = web_state(version)
    release = ROOT / "release"
    if state.exists():
        saved = read_json(state)
        if (saved["version"], saved["commit"]) != (version, commit):
            raise ReleaseError("This Web version is already tied to another commit.")
        if "normal" in saved:
            return verified_web(version)
    else:
        receipt = release / f"itch_all_{version}.json"
        if receipt.exists():
            raise ReleaseError("This batch predates the source record. Choose a new Web version.")
        state.parent.mkdir(parents=True, exist_ok=True)
        write_state(state, {"version": version, "commit": commit})
    run("sh", "scripts/package_itch_all.sh", version, capture=False)
    run("sh", "scripts/package_itch_all_for_run.sh", version, capture=False)
    if run("git", "rev-parse", "HEAD") != commit or run("git", "status", "--porcelain"):
        raise ReleaseError("The source changed during packaging.")
    result = {
        "version": version,
        "commit": commit,
        "normal": collection(release / f"itch_all_{version}", version, "download"),
        "browser": collection(release / f"itch_all_{version}_for_run", version, "for_run"),
    }
    write_state(state, result)
    return result


def collection(folder, version, variant):
    manifest = read_json(folder / "manifest.json")
    if (manifest.get("kind"), manifest.get("version"), manifest.get("variant")) != (
        "itch-batch-collection", version, variant,
    ):
        raise ReleaseError(f"Wrong Web collection: {folder}")
    records = {}
    for item in manifest["artifacts"]:
        name, product = item["name"], item["product"]
        if Path(name).name != name or not name.endswith(".zip") or product in records:
            raise ReleaseError(f"Invalid Web ZIP record: {name}")
        record = file_record(folder / name)
        if (record["bytes"], record["sha256"]) != (item["bytes"], item["sha256"]):
            raise ReleaseError(f"Web ZIP changed: {name}")
        records[product] = record
    if set(records) != set(ITCH_SLUG):
        raise ReleaseError(f"Web collection is incomplete: {folder}")
    return records


def verified_web(version):
    result = read_json(web_state(version))
    if result["version"] != version or "normal" not in result or "browser" not in result:
        raise ReleaseError("Finish preparing the Web ZIPs for this version first.")
    for variant in ("normal", "browser"):
        if set(result[variant]) != set(ITCH_SLUG):
            raise ReleaseError("Web state is incomplete.")
        for record in result[variant].values():
            check_record(record)
    return result


def remote_tag(repo, tag):
    try:
        ref = gh_json("api", f"repos/{repo}/git/ref/tags/{tag}")["object"]
    except ReleaseError as error:
        if "HTTP 404" in str(error):
            return None
        raise
    if ref["type"] == "tag":
        ref = gh_json("api", f"repos/{repo}/git/tags/{ref['sha']}")["object"]
    if ref["type"] != "commit":
        raise ReleaseError(f"{repo} {tag} does not identify a commit.")
    return ref["sha"]


def push_tag(repo, local, tag, commit):
    previous = remote_tag(repo, tag)
    if previous is not None:
        if previous != commit:
            raise ReleaseError(f"{repo} already has {tag} at another commit.")
        return
    # Verify the exact commit of a local tag before pushing it. Existing tags
    # are never moved, and no unrelated branches or tags are sent.
    tags = run("git", "tag", "--list", tag, cwd=local)
    if not tags:
        run("git", "tag", "-a", tag, commit, "-m", f"Release {tag}", cwd=local)
    if run("git", "rev-parse", f"{tag}^{{commit}}", cwd=local) != commit:
        raise ReleaseError(f"Local tag {tag} points at another commit.")
    run("git", "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential",
        "push", f"https://github.com/{repo}.git", f"refs/tags/{tag}", cwd=local)
    if remote_tag(repo, tag) != commit:
        raise ReleaseError(f"Could not verify the pushed {repo} tag {tag}.")


def matching_run(repo, workflow, tag, commit):
    rows = gh_json("run", "list", "-R", repo, "-w", workflow, "--event", "push",
                   "--branch", tag, "--commit", commit, "--limit", "10",
                   "--json", "databaseId,status,conclusion,headBranch,headSha,url")
    return next((row for row in rows if row["headBranch"] == tag and row["headSha"] == commit), None)


def wait_for_run(repo, workflow, tag, commit, timeout):
    deadline = time.monotonic() + timeout
    while True:
        row = matching_run(repo, workflow, tag, commit)
        if row and row["status"] == "completed":
            return row
        if time.monotonic() >= deadline:
            raise ReleaseError(f"Waiting for {repo} {workflow} at {tag}. Run the same stage again.")
        time.sleep(10)


def github_web(version, notes, push, publish, wait):
    web = verified_web(version)
    tag, commit = f"v{version}", web["commit"]
    if push:
        push_tag(WEB_REPO, ROOT, tag, commit)
    if remote_tag(WEB_REPO, tag) != commit:
        raise ReleaseError(f"Push {tag} at the recorded commit with --push first.")
    if publish:
        for workflow in WEB_WORKFLOWS:
            row = wait_for_run(WEB_REPO, workflow, tag, commit, wait)
            if row["conclusion"] != "success":
                raise ReleaseError(f"Release checks failed: {row['url']}")
    records = [*web["normal"].values(), web["browser"]["playground"]]
    records.append(release_checksum(records, web_state(version).with_name("SHA256SUMS")))
    upload_github_release(WEB_REPO, tag, f"Tetorica {tag} — Browser builds", notes, records, publish)


def release_checksum(records, path):
    path.write_text("".join(
        f"{record['sha256']}  {Path(record['path']).name}\n" for record in records
    ), encoding="utf-8")
    return file_record(path)


def upload_github_release(repo, tag, title, notes, records, publish):
    try:
        release = gh_json("release", "view", tag, "-R", repo, "--json", "databaseId,isDraft,url")
    except ReleaseError as error:
        if "release not found" not in str(error).lower():
            raise
        run("gh", "release", "create", tag, "-R", repo, "--verify-tag", "--draft",
            "--title", title, "--notes-file", notes)
        release = gh_json("release", "view", tag, "-R", repo, "--json", "databaseId,isDraft,url")
    endpoint = f"repos/{repo}/releases/{release['databaseId']}"
    missing = missing_github_assets(records, gh_json("api", endpoint)["assets"])
    if missing and not release["isDraft"]:
        raise ReleaseError("Published release is missing expected assets.")
    if missing:
        run("gh", "release", "upload", tag, "-R", repo, *missing, capture=False)
    if missing_github_assets(records, gh_json("api", endpoint)["assets"]):
        raise ReleaseError("GitHub did not receive all verified release assets.")
    if publish and release["isDraft"]:
        run("gh", "release", "edit", tag, "-R", repo, "--verify-tag", "--draft=false", capture=False)
    print(gh_json("api", endpoint)["html_url"])


def missing_github_assets(records, assets):
    by_name = {Path(record["path"]).name: record for record in records}
    for asset in assets:
        record = by_name.pop(asset["name"], None)
        if (not record or asset["state"] != "uploaded" or asset["size"] != record["bytes"]
                or asset["digest"] != f"sha256:{record['sha256']}"):
            raise ReleaseError(f"Unexpected or changed GitHub release asset: {asset['name']}")
    return [record["path"] for record in by_name.values()]


def committed_desktop(version, selection=None, *, batch=None):
    plan = read_json(state_path(ROOT, version, batch))
    repos = {entry["id"]: entry["repo"] for entry in PRODUCTS}
    if plan.get("kind") != "tauri-local-release" or plan.get("status") != "tagged" or plan["version"] != version:
        raise ReleaseError("Run the desktop --prepare and --commit stages first.")
    planned = {product["id"]: product for product in plan["products"]}
    if not planned or len(planned) != len(plan["products"]):
        raise ReleaseError("Invalid product selection in the desktop release plan.")
    selected = set(planned) if selection is None else {product["id"] for product in select_products(selection)}
    if missing := selected - planned.keys():
        raise ReleaseError("Products missing from the desktop release plan: " + ", ".join(sorted(missing)))
    products = [product for identifier, product in planned.items() if identifier in selected]
    for product in products:
        if repos.get(product["id"]) != product["repo"] or not product.get("tagged"):
            raise ReleaseError("Unexpected desktop target in the release plan.")
        for record in product["artifacts"]:
            check_record(record)
    return {**plan, "products": products}


def desktop_jobs_ready(jobs):
    # The Mac installers are built and notarized locally. Hosted Mac builds
    # are independent checks, while the other jobs gate artifact collection.
    hosted_mac = ("build (macos-arm64,", "build (macos-x86_64,")
    required = [job for job in jobs if not job["name"].startswith(hosted_mac)]
    if any(job["status"] != "completed" or job["conclusion"] not in ("success", "skipped")
           for job in required):
        return False
    return all(any(job["name"].startswith(f"build ({platform},") and job["conclusion"] == "success"
                   for job in required) for platform in CI_PLATFORMS)


def wait_for_desktop_artifacts(repo, tag, commit, timeout):
    deadline = time.monotonic() + timeout
    while True:
        row = matching_run(repo, "build-desktop.yml", tag, commit)
        if row:
            if row["conclusion"] == "success":
                return row
            jobs = gh_json("run", "view", str(row["databaseId"]), "-R", repo, "--json", "jobs")["jobs"]
            if desktop_jobs_ready(jobs):
                return row
            if row["status"] == "completed":
                raise ReleaseError(f"Desktop CI failed: {row['url']}")
        if time.monotonic() >= deadline:
            raise ReleaseError(f"Waiting for Windows/Linux artifacts for {repo} at {tag}. Run the same stage again.")
        time.sleep(10)


def desktop_ci(version, push, wait, *, batch=None):
    plan = committed_desktop(version, batch=batch)
    tag = f"v{version}"
    directory = state_path(ROOT, version, batch).parent
    # Start every selected repository before waiting for any runner.
    for product in plan["products"]:
        repo = f"{GITHUB_OWNER}/{product['repo']}"
        if push:
            push_tag(repo, ROOT / "w" / product["repo"], tag, product["commit"])
        if remote_tag(repo, tag) != product["commit"]:
            raise ReleaseError(f"Push the recorded tag for {repo} with --push first.")
    for product in plan["products"]:
        repo = f"{GITHUB_OWNER}/{product['repo']}"
        target = directory / "ci" / product["id"]
        if (target / "artifacts.json").exists():
            ci_records(target, product, version)
            continue
        row = wait_for_desktop_artifacts(repo, tag, product["commit"], wait)
        print(f"{product['id']} · {row['url']}", flush=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=target.parent, prefix=f".{product['id']}-") as stage:
            directory_arg = Path(stage) / "download"
            command = ["gh", "run", "download", str(row["databaseId"]), "-R", repo, "-D", directory_arg]
            for platform in CI_PLATFORMS:
                command.extend(("-p", f"tetorica-*-{platform}"))
            run(*command, capture=False)
            install = Path(stage) / "verified"
            install.mkdir()
            records = gather_installers(directory_arg, install, version)
            write_state(install / "artifacts.json", {
                "commit": product["commit"], "version": version, "run": row["url"], "files": records,
            })
            install.rename(target)


def gather_installers(download, destination, version):
    records = {}
    for platform, suffixes in CI_PLATFORMS.items():
        sources = [path for path in download.iterdir()
                   if path.name.startswith("tetorica-") and path.name.endswith("-" + platform)]
        if len(sources) != 1:
            raise ReleaseError(f"Expected one CI artifact for {platform}")
        for suffix, channel in suffixes.items():
            files = [path for path in sources[0].rglob(f"*{suffix}") if f"_{version}_" in path.name]
            if len(files) != 1:
                raise ReleaseError(f"Expected one {suffix} installer for {platform} and {version}")
            source = files[0]
            record = file_record(source)
            name = f"{channel}{suffix}"
            shutil.copyfile(source, destination / name)
            records[channel] = {"name": name, "originalName": source.name,
                                "bytes": record["bytes"], "sha256": record["sha256"]}
    return records


def ci_records(target, product, version):
    evidence = read_json(target / "artifacts.json")
    expected = {channel: f"{channel}{suffix}" for files in CI_PLATFORMS.values()
                for suffix, channel in files.items()}
    if (evidence["commit"], evidence["version"]) != (product["commit"], version) or set(evidence["files"]) != set(expected):
        raise ReleaseError(f"CI artifacts do not match {product['id']} {version}.")
    records = {}
    for channel, file in evidence["files"].items():
        if file["name"] != expected[channel] or Path(file["originalName"]).name != file["originalName"]:
            raise ReleaseError(f"Unexpected installer name for {channel}.")
        record = file_record(target / file["name"])
        if (record["bytes"], record["sha256"]) != (file["bytes"], file["sha256"]):
            raise ReleaseError(f"Updated CI installer: {file['name']}")
        records[channel] = {**record, "originalName": file["originalName"]}
    return records


def mac_dmgs(product, version):
    dmgs = {}
    for arch, channel in MAC_DMG_CHANNELS:
        matches = [file for file in product["artifacts"] if file["path"].endswith(f"_{version}_{arch}.dmg")]
        if len(matches) != 1:
            raise ReleaseError(f"Expected signed DMG for {product['id']} {arch}")
        dmgs[channel] = matches[0]
    return dmgs


def desktop_installer_name(product, version, channel, suffix):
    return f"{product['repo'].removesuffix('-tauri')}_{version}_{channel}{suffix}"


def github_desktop(version, notes, publish, selection=None, *, batch=None):
    import fcntl

    plan = committed_desktop(version, selection, batch=batch)
    tag = f"v{version}"
    ci = state_path(ROOT, version, batch).parent / "ci"
    releases = []
    for product in plan["products"]:
        repo = f"{GITHUB_OWNER}/{product['repo']}"
        if remote_tag(repo, tag) != product["commit"]:
            raise ReleaseError(f"Push the recorded tag for {repo} with desktop-ci --push first.")
        installers = {**mac_dmgs(product, version), **ci_records(ci / product["id"], product, version)}
        releases.append((product, repo, f"{product['metadata']['product']} {tag}", installers))
    # Check each selected product's tag and packages before the first upload.
    for product, repo, title, installers in releases:
        lock_path = ci.parent / f".github-desktop-{product['id']}.lock"
        with lock_path.open("a") as lock, tempfile.TemporaryDirectory(prefix=f"{product['repo']}-desktop-") as output:
            fcntl.flock(lock, fcntl.LOCK_EX)
            folder = Path(output)
            records = []
            for channel, original in installers.items():
                source = Path(original["path"])
                destination = folder / desktop_installer_name(product, version, channel, source.suffix)
                shutil.copyfile(source, destination)
                record = file_record(destination)
                if (record["bytes"], record["sha256"]) != (original["bytes"], original["sha256"]):
                    raise ReleaseError(f"Installer changed while staging: {source}")
                records.append(record)
            records.append(release_checksum(records, folder / "SHA256SUMS"))
            upload_github_release(repo, tag, title, notes, records, publish)


def itch_targets(web_version, desktop_version=None, products=None, *, batch=None):
    web = verified_web(web_version)
    selected = set(products or ITCH_SLUG)
    if not selected <= set(ITCH_SLUG):
        raise ReleaseError("Unknown itch.io product.")
    targets = {}
    for product, slug in ITCH_SLUG.items():
        if product in selected:
            targets[f"{GITHUB_OWNER}/{slug}:html"] = (web_version, web["browser"][product])
            targets[f"{GITHUB_OWNER}/{slug}:source"] = (web_version, web["normal"][product])
    if desktop_version:
        plan = committed_desktop(desktop_version, batch=batch)
        if plan["webVersion"] != web_version:
            raise ReleaseError("Desktop installers were built from another Web version.")
        for product in plan["products"]:
            identifier = product["id"]
            if identifier not in selected:
                continue
            if product["sourceSha256"] != web["normal"][identifier]["sha256"]:
                raise ReleaseError(f"Desktop installers for {identifier} used a different Web ZIP.")
            site = f"{GITHUB_OWNER}/{ITCH_SLUG[identifier]}"
            for channel, dmg in mac_dmgs(product, desktop_version).items():
                targets[f"{site}:{channel}"] = (desktop_version, dmg)
            target = state_path(ROOT, desktop_version, batch).parent / "ci" / identifier
            for channel, record in ci_records(target, product, desktop_version).items():
                targets[f"{site}:{channel}"] = (desktop_version, record)
    return targets


def itch(web_version, desktop_version, products, publish, butler, *, batch=None):
    targets = itch_targets(web_version, desktop_version, products, batch=batch)
    ledger = web_state(web_version).with_name("itch-uploads.json")
    upload_itch_targets(targets, ledger, publish, butler)


def github_itch_installers(product, version, folder):
    repo, tag = f"{GITHUB_OWNER}/{product['repo']}", f"v{version}"
    release = gh_json("release", "view", tag, "-R", repo, "--json", "databaseId,isDraft")
    if release["isDraft"]:
        raise ReleaseError(f"Publish {repo} {tag} on GitHub first.")
    assets = gh_json("api", f"repos/{repo}/releases/{release['databaseId']}")["assets"]
    suffixes = {channel: ".dmg" for _, channel in MAC_DMG_CHANNELS}
    suffixes.update({channel: suffix for files in CI_PLATFORMS.values() for suffix, channel in files.items()})
    names = {channel: desktop_installer_name(product, version, channel, suffix)
             for channel, suffix in suffixes.items()}
    if sorted(asset["name"] for asset in assets) != sorted([*names.values(), "SHA256SUMS"]):
        raise ReleaseError(f"Expected verified desktop release attachments for {repo} {tag}.")
    command = ["gh", "release", "download", tag, "-R", repo, "--dir", folder]
    for name in (*names.values(), "SHA256SUMS"):
        command.extend(("--pattern", name))
    run(*command, capture=False)
    records = {channel: file_record(folder / name) for channel, name in names.items()}
    checksums = folder / "SHA256SUMS"
    if missing_github_assets([*records.values(), file_record(checksums)], assets):
        raise ReleaseError(f"GitHub release downloads are incomplete for {repo} {tag}.")
    expected = sorted(f"{record['sha256']}  {names[channel]}" for channel, record in records.items())
    if sorted(checksums.read_text(encoding="utf-8").splitlines()) != expected:
        raise ReleaseError(f"Release checksums differ for {repo} {tag}.")
    return records


def itch_desktop(version, products, publish, butler):
    ledger = web_state(version).with_name("itch-uploads.json")
    with tempfile.TemporaryDirectory(prefix="tetorica-itch-desktop-") as output:
        targets = {}
        for product in select_products(products):
            identifier = product["id"]
            folder = Path(output) / identifier
            folder.mkdir()
            project = f"{GITHUB_OWNER}/{ITCH_SLUG[identifier]}"
            for channel, record in github_itch_installers(product, version, folder).items():
                targets[f"{project}:{channel}"] = (version, record)
        upload_itch_targets(targets, ledger, publish, butler)


def upload_itch_targets(targets, ledger, publish, butler):
    completed = read_json(ledger) if ledger.exists() else {}
    for target, (version, record) in targets.items():
        check_record({key: record[key] for key in ("path", "bytes", "sha256")})
        print(f"{version} · {Path(record['path']).name} → {target}", flush=True)
        if not publish:
            continue
        receipt = {"version": version, "sha256": record["sha256"]}
        if completed.get(target) == receipt:
            print("  Already uploaded")
            continue
        if completed.get(target, {}).get("version") == version:
            raise ReleaseError(f"Different bytes were already uploaded to {target} as {version}.")
        ledger.parent.mkdir(parents=True, exist_ok=True)
        path = Path(record["path"])
        if target.endswith(":html"):
            run(butler, "push", path, target, "--userversion", version, capture=False)
        else:
            with tempfile.TemporaryDirectory(prefix="tetorica-itch-upload-") as directory:
                directory = Path(directory)
                name = record.get("originalName", path.name)
                shutil.copyfile(path, directory / name)
                if target.endswith(":source"):
                    # Preserve the editable ZIP as a file with its own checksum.
                    (directory / "SHA256SUMS").write_text(f"{record['sha256']}  {name}\n")
                if name.endswith(".AppImage"):
                    (directory / name).chmod(0o755)
                run(butler, "push", directory, target, "--userversion", version, capture=False)
        completed[target] = receipt
        write_state(ledger, completed)
    if not publish:
        print(f"Preview · {len(targets)} files. Add --publish to upload to itch.io.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)
    web = sub.add_parser("prepare-web", help="Build and checksum both Web ZIP collections")
    github = sub.add_parser("github-web", help="Verify the tag and upload the browser release assets")
    desktop = sub.add_parser("desktop-ci", help="Wait for tagged desktop runs and collect Windows/Linux")
    desktop_release = sub.add_parser("github-desktop", help="Attach or publish verified desktop installers")
    desktop_release.add_argument("--products", help="Comma-separated product IDs from the committed plan (default: all)")
    upload = sub.add_parser("itch", help="Print the planned uploads or update itch.io")
    upload_desktop = sub.add_parser("itch-desktop", help="Distribute installers from published GitHub releases")
    for stage in (web, github, desktop, desktop_release, upload, upload_desktop):
        stage.add_argument("version", type=validate_version)
    for stage in (github, desktop_release):
        stage.add_argument("--notes-file", type=Path, required=True)
    for stage in (github, desktop):
        stage.add_argument("--push", action="store_true", help="Push the exact release tag")
        stage.add_argument("--wait", type=int, default=3600, help="Seconds to wait for each Actions run")
    for stage in (github, desktop_release, upload, upload_desktop):
        stage.add_argument("--publish", action="store_true")
    for stage in (desktop, desktop_release, upload):
        stage.add_argument("--batch", type=validate_batch, help="Use the named local Tauri release batch")
    upload.add_argument("--desktop-version", type=validate_version)
    for stage in (upload, upload_desktop):
        stage.add_argument("--products", help="Comma-separated product IDs")
        stage.add_argument("--butler", type=Path, default=Path.home() / "bin" / "butler")
    args = parser.parse_args()
    if args.stage == "itch" and args.batch and not args.desktop_version:
        parser.error("--batch requires --desktop-version for itch")
    try:
        if args.stage == "prepare-web":
            with release_lock(ROOT):
                prepare_web(args.version)
            print(web_state(args.version))
        elif args.stage == "github-web":
            github_web(args.version, args.notes_file.resolve(strict=True), args.push, args.publish, args.wait)
        elif args.stage == "desktop-ci":
            desktop_ci(args.version, args.push, args.wait, batch=args.batch)
        elif args.stage == "github-desktop":
            with release_lock(ROOT):
                github_desktop(args.version, args.notes_file.resolve(strict=True), args.publish, args.products,
                               batch=args.batch)
        elif args.stage == "itch-desktop":
            if args.publish:
                with release_lock(ROOT):
                    itch_desktop(args.version, args.products, True, args.butler)
            else:
                itch_desktop(args.version, args.products, False, args.butler)
        else:
            selected = args.products.split(",") if args.products else None
            if args.publish:
                with release_lock(ROOT):
                    itch(args.version, args.desktop_version, selected, True, args.butler, batch=args.batch)
            else:
                itch(args.version, args.desktop_version, selected, False, args.butler, batch=args.batch)
    except (ReleaseError, OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Release stopped: {error}\n")


if __name__ == "__main__":
    main()
