"""Local orchestration regressions; no real Tauri build, network or secrets."""
# SPDX-License-Identifier: BSD-3-Clause
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
import zipfile


MODULE_PATH = Path(__file__).with_name("release_tauri_all.py")


def load_module():
    spec = importlib.util.spec_from_file_location("tetorica_release_regression", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def git(path, *args):
    return subprocess.run(
        ["git", "-C", str(path), *args], check=True, capture_output=True,
        text=True, env={**os.environ, "GIT_AUTHOR_NAME": "Release fixture",
                        "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
                        "GIT_COMMITTER_NAME": "Release fixture",
                        "GIT_COMMITTER_EMAIL": "fixture@example.invalid"},
    ).stdout.strip()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def tree_bytes(path):
    return {str(p.relative_to(path)): p.read_bytes() for p in path.rglob("*")
            if p.is_file() and ".git" not in p.relative_to(path).parts}


def create_app(root, name, version="0.1.0"):
    app = root / "w" / name
    app.mkdir(parents=True)
    git(app, "init", "--quiet", "--initial-branch=main")
    git(app, "remote", "add", "origin", f"git@github.com:fixture/{name}.git")
    write_json(app / "package.json", {"name": name, "version": version,
                                     "private": True, "scripts": {"test": "fixture"}})
    write_json(app / "package-lock.json", {
        "name": name, "version": version, "lockfileVersion": 3,
        "packages": {"": {"name": name, "version": version},
                     "node_modules/fixture": {"version": "1.2.3", "integrity": "fixed-fixture"}},
    })
    write_json(app / "src-tauri/tauri.conf.json", {
        "productName": "Tetorica Fixture", "version": version,
        "identifier": "invalid.example.release-fixture", "bundle": {"active": True},
    })
    (app / "src-tauri/Cargo.toml").write_text(
        f'[package]\nname = "{name}"\nversion = "{version}"\nedition = "2021"\n'
        '\n[dependencies]\nserde = "1"\n')
    (app / "src-tauri/Cargo.lock").write_text(
        '# Synthetic fixed dependency lock\nversion = 4\n\n[[package]]\n'
        f'name = "{name}"\nversion = "{version}"\ndependencies = ["serde"]\n'
        '\n[[package]]\nname = "serde"\nversion = "1.0.0"\n'
        'source = "registry+https://github.com/rust-lang/crates.io-index"\n'
        'checksum = "' + '1' * 64 + '"\n')
    (app / "scripts").mkdir()
    (app / "scripts/import_release.py").write_text("# Mock runner handles import in this fixture.\n")
    (app / "deploy_mac.sh").write_text("#!/bin/sh\nset -eu\n# Mocked release build.\n")
    (app / "dist").mkdir()
    (app / "dist/index.html").write_text("Original authored Web assets\n")
    write_json(app / "release.lock.json", {"version": "previous", "files": {"index.html": "old"}})
    (app / ".gitignore").write_text("src-tauri/target/\nnode_modules/\nartifacts/\n")
    git(app, "add", ".")
    git(app, "commit", "--quiet", "-m", "Original fixture")
    return app


class FixtureRunner:
    """Run only local fixture Git; replace imports, checks and builds."""

    def __init__(self, module):
        self.module = module
        self.calls = []
        self.fail = None

    def run(self, argv, *, cwd, env=None, log=None, secret=None):
        argv, cwd = [str(a) for a in argv], Path(cwd)
        call = {"argv": argv, "cwd": cwd, "env": env, "log": log,
                "secret": secret}
        self.calls.append(call)
        if self.fail and self.fail(call):
            raise self.module.ReleaseError("Injected fixture failure")
        if argv[0] == "git":
            if argv[1] in {"fetch", "push", "pull", "clone", "ls-remote"}:
                raise AssertionError("Network Git is forbidden in a local release")
            # Preserve NUL-delimited porcelain, including its trailing NUL.
            return subprocess.run(
                argv, cwd=cwd, check=True, capture_output=True, text=True,
                env={**os.environ, "GIT_AUTHOR_NAME": "Release fixture",
                     "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
                     "GIT_COMMITTER_NAME": "Release fixture",
                     "GIT_COMMITTER_EMAIL": "fixture@example.invalid"},
            ).stdout
        if log:
            Path(log).parent.mkdir(parents=True, exist_ok=True)
            with Path(log).open("a") as handle:
                handle.write("Mocked local check/build\n")
        if argv[:2] == ["python3", "scripts/import_release.py"]:
            if argv[2:] == ["--check"]:
                return "Pinned Web assets match.\n"
            if len(argv) != 3:
                raise AssertionError(f"Unexpected import arguments: {argv}")
            source = Path(argv[2])
            # Fixture ZIP entries have only ordinary relative filenames.
            with zipfile.ZipFile(source) as archive:
                for entry in archive.infolist():
                    destination = cwd / "dist" / entry.filename
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(archive.read(entry))
            write_json(cwd / "release.lock.json", {
                "version": "web-0.99.99", "source": source.name,
                "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            })
            return "Imported Web fixture.\n"
        if argv in (["npm", "ci"], ["npm", "test"]):
            self.module.verify_metadata(cwd, "1.2.3")
            return "Mocked npm check passed.\n"
        if argv == ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked"]:
            self.module.verify_metadata(cwd, "1.2.3")
            return "Mocked locked Rust tests passed.\n"
        if argv == ["sh", "deploy_mac.sh"]:
            self.module.verify_metadata(cwd, "1.2.3")
            return "Mocked local signed build passed.\n"
        raise AssertionError(f"Unexpected external command: {argv}")


class LocalReleaseTests(unittest.TestCase):
    VERSION = "1.2.3"
    PASSWORD = "fixture-not-a-real-password-012345"

    @classmethod
    def setUpClass(cls):
        cls.release = load_module()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="tauri release fixture ")
        self.addCleanup(self.temporary.cleanup)
        # macOS exposes this temporary directory through /var and /private/var.
        self.root = Path(self.temporary.name).resolve()
        self.products = tuple({"id": product, "repo": f"tetorica-{product}-synth-tauri"}
                              for product in ("sid", "spu"))
        self.apps = [create_app(self.root, p["repo"]) for p in self.products]
        self.heads = [git(app, "rev-parse", "HEAD") for app in self.apps]
        self.web = self.root / "web inputs"
        self.web.mkdir()
        artifacts = []
        for product in self.products:
            archive = self.web / f"tetorica_{product['id']}_synth_0.99.99_itch.zip"
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr("index.html", f"Readable {product['id']} Web fixture\n")
                output.writestr("source.js", "// Readable authored JavaScript\n")
            record = self.release.file_record(archive)
            artifacts.append({"product": product["id"], "name": archive.name,
                              "sha256": record["sha256"], "bytes": record["bytes"]})
        write_json(self.web / "manifest.json", {
            "schemaVersion": 1, "kind": "itch-batch-collection",
            "variant": "download", "version": "0.99.99", "artifacts": artifacts,
        })
        self.runner = FixtureRunner(self.release)

    def plan(self):
        return self.release.plan_release(self.root, self.VERSION, self.web,
                                         products=self.products, runner=self.runner)

    def artifact_fixture(self, repo, product, version, output, runner, password):
        self.assertEqual(password, self.PASSWORD)
        folder = output / "artifacts" / product["id"]
        folder.mkdir(parents=True)
        records = []
        for arch in ("x86_64", "arm64"):
            artifact = folder / f"{product['id']}_{version}_{arch}.dmg"
            artifact.write_text(f"Synthetic {arch} signed artifact for {version}\n")
            records.append(self.release.file_record(artifact))
        return records

    def prepare(self):
        with mock.patch.object(self.release, "collect_artifacts",
                               side_effect=self.artifact_fixture):
            return self.release.prepare_release(
                self.root, self.VERSION, self.web, products=self.products,
                runner=self.runner, password=self.PASSWORD)

    def commit(self):
        return self.release.commit_release(self.root, self.VERSION,
                                          products=self.products, runner=self.runner)

    def assert_original_history(self):
        for app, head in zip(self.apps, self.heads):
            self.assertEqual(git(app, "rev-parse", "HEAD"), head)
            self.assertEqual(git(app, "tag", "--list"), "")

    def test_plan_uses_independent_app_version_and_changes_no_files(self):
        before = tree_bytes(self.root)
        plan = self.plan()
        self.assertEqual(plan["version"], "1.2.3")
        self.assertEqual(plan["webVersion"], "0.99.99")
        self.assertEqual([p["id"] for p in plan["products"]], ["sid", "spu"])
        for product, app, head in zip(plan["products"], self.apps, self.heads):
            self.assertEqual(product["metadata"]["version"], "0.1.0")
            self.assertEqual(product["baseHead"], head)
            self.assertIn("0.99.99", Path(product["source"]).name)
            self.assertEqual(Path(product["source"]).parent, self.web)
        self.assertEqual(tree_bytes(self.root), before)
        self.assertFalse((self.root / "release").exists())
        self.assertTrue(all(c["argv"][0] == "git" for c in self.runner.calls))

    def test_batch_preflight_rejects_dirty_repo_or_existing_tag_before_import(self):
        for issue in ("dirty", "tag"):
            with self.subTest(issue=issue):
                if issue == "dirty":
                    (self.apps[-1] / "dist/index.html").write_text("Unrelated user's edit\n")
                else:
                    git(self.apps[-1], "tag", f"v{self.VERSION}")
                before = tree_bytes(self.root)
                with self.assertRaises(self.release.ReleaseError):
                    self.prepare()
                self.assertEqual(tree_bytes(self.root), before)
                self.assertFalse((self.root / "release").exists())
                self.assertTrue(all(c["argv"][0] == "git" for c in self.runner.calls))
                if issue == "dirty":
                    git(self.apps[-1], "restore", "--", "dist/index.html")
                else:
                    git(self.apps[-1], "tag", "-d", f"v{self.VERSION}")

    def test_plan_rejects_stale_or_browser_manifest_and_unsafe_archive(self):
        path = self.web / "manifest.json"
        original = json.loads(path.read_text())
        for issue in ("checksum", "variant", "path"):
            with self.subTest(issue=issue):
                manifest = json.loads(json.dumps(original))
                if issue == "checksum":
                    manifest["artifacts"][-1]["sha256"] = "0" * 64
                elif issue == "variant":
                    manifest["variant"] = "for_run"
                else:
                    manifest["artifacts"][-1]["name"] = "../outside.zip"
                write_json(path, manifest)
                before = tree_bytes(self.root)
                with self.assertRaises(self.release.ReleaseError):
                    self.plan()
                self.assertEqual(tree_bytes(self.root), before)
        write_json(path, original)

    def test_prepare_syncs_all_versions_preserves_dependencies_and_limits_secret(self):
        dependencies = [self.release.dependency_snapshot(app) for app in self.apps]
        npm_dependencies = [json.loads((app / "package-lock.json").read_text())[
            "packages"]["node_modules/fixture"] for app in self.apps]
        plan = self.prepare()
        self.assertEqual(plan["status"], "built")
        self.assertTrue(all(p["status"] == "built" for p in plan["products"]))
        for index, (product, app) in enumerate(zip(plan["products"], self.apps)):
            self.release.verify_metadata(app, self.VERSION)
            self.assertEqual(self.release.dependency_snapshot(app), dependencies[index])
            self.assertEqual(json.loads((app / "package-lock.json").read_text())[
                "packages"]["node_modules/fixture"], npm_dependencies[index])
            self.assertIn("Readable", (app / "dist/index.html").read_text())
            self.assertIn("src-tauri/Cargo.lock", product["fingerprint"])
            calls = [c for c in self.runner.calls if c["cwd"] == app and c["argv"][0] != "git"]
            self.assertEqual([c["argv"] for c in calls], [
                ["python3", "scripts/import_release.py", product["source"]],
                ["npm", "ci"], ["npm", "test"],
                ["python3", "scripts/import_release.py", "--check"],
                ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked"],
                ["sh", "deploy_mac.sh"],
                ["python3", "scripts/import_release.py", "--check"],
            ])
        for call in self.runner.calls:
            self.assertNotIn(self.PASSWORD, " ".join(call["argv"]))
            if call["argv"] == ["sh", "deploy_mac.sh"]:
                self.assertEqual(call["env"], {"CI": "true", "APPLE_PASSWORD": self.PASSWORD})
                self.assertEqual(call["secret"], self.PASSWORD)
            else:
                self.assertIsNone(call["env"])
                self.assertIsNone(call["secret"])
        output = self.release.state_path(self.root, self.VERSION).parent
        for path in output.rglob("*"):
            if path.is_file():
                self.assertNotIn(self.PASSWORD.encode(), path.read_bytes())
        self.assertEqual(len((output / "SHA256SUMS").read_text().splitlines()), 4)
        self.assert_original_history()
        before = tree_bytes(self.root)
        with self.assertRaises(self.release.ReleaseError):
            self.prepare()
        self.assertEqual(tree_bytes(self.root), before)

    def test_failed_build_never_commits_or_tags_and_rejects_finalization(self):
        self.runner.fail = lambda c: (c["cwd"] == self.apps[-1]
                                      and c["argv"] == ["sh", "deploy_mac.sh"])
        with self.assertRaisesRegex(self.release.ReleaseError, "Injected fixture failure"):
            self.prepare()
        saved = json.loads(self.release.state_path(self.root, self.VERSION).read_text())
        self.assertEqual(saved["status"], "failed")
        self.assertEqual(saved["failedProduct"], "spu")
        self.assertEqual(saved["products"][0]["status"], "built")
        self.assert_original_history()
        with self.assertRaises(self.release.ReleaseError):
            self.commit()
        self.assert_original_history()
        self.assertFalse((self.root / "release/.tauri_release.lock").exists())

    def test_npm_dependency_changes_during_build_are_blocked(self):
        def mutate_dependency(call):
            if call["cwd"] == self.apps[0] and call["argv"] == ["sh", "deploy_mac.sh"]:
                path = self.apps[0] / "package-lock.json"
                data = json.loads(path.read_text())
                data["packages"]["node_modules/fixture"]["version"] = "9.9.9"
                write_json(path, data)
            return False

        # Simulate a build tool changing a dependency, rather than failing itself.
        self.runner.fail = mutate_dependency
        with self.assertRaisesRegex(self.release.ReleaseError, "npm dependencies changed"):
            self.prepare()
        saved = json.loads(self.release.state_path(self.root, self.VERSION).read_text())
        self.assertEqual(saved["status"], "failed")
        self.assertEqual(saved["failedProduct"], "sid")
        self.assertFalse(any(c["cwd"] == self.apps[-1] and c["argv"][0] != "git"
                             for c in self.runner.calls))
        self.assert_original_history()
        with self.assertRaises(self.release.ReleaseError):
            self.commit()

    def test_commit_failure_after_staging_can_retry_verified_release(self):
        self.prepare()
        self.runner.fail = lambda c: (c["cwd"] == self.apps[0]
                                      and c["argv"][:2] == ["git", "commit"])
        with self.assertRaisesRegex(self.release.ReleaseError, "Injected fixture failure"):
            self.commit()
        self.assert_original_history()
        saved = json.loads(self.release.state_path(self.root, self.VERSION).read_text())
        product = saved["products"][0]
        self.assertTrue(product["staging"])
        staged = git(self.apps[0], "diff", "--cached", "--name-only").splitlines()
        self.assertEqual(set(staged), set(product["fingerprint"]))
        self.runner.fail = None
        self.assertEqual(self.commit()["status"], "tagged")
        for app in self.apps:
            self.assertEqual(git(app, "rev-list", "--count", "HEAD"), "2")
            self.assertEqual(git(app, "cat-file", "-t", f"v{self.VERSION}"), "tag")
            self.assertEqual(git(app, "status", "--porcelain"), "")

    def test_commit_rejects_any_stale_input_before_first_commit(self):
        plan = self.prepare()
        paths = [self.web / "manifest.json", Path(plan["products"][-1]["source"]),
                 Path(plan["products"][-1]["artifacts"][0]["path"]),
                 self.apps[-1] / "dist/source.js"]
        for path in paths:
            with self.subTest(path=str(path.relative_to(self.root))):
                original = path.read_bytes()
                path.write_bytes(original + b"\nchanged after build\n")
                with self.assertRaises((self.release.ReleaseError, ValueError)):
                    self.commit()
                self.assert_original_history()
                path.write_bytes(original)

    def test_commit_then_tag_retries_without_duplicate_commits_or_publication(self):
        self.prepare()
        self.runner.fail = lambda c: (c["cwd"] == self.apps[-1]
                                      and c["argv"][:3] == ["git", "tag", "-a"])
        with self.assertRaises(self.release.ReleaseError):
            self.commit()
        commits = [git(app, "rev-parse", "HEAD") for app in self.apps]
        self.assertNotEqual(commits, self.heads)
        self.assertEqual(git(self.apps[0], "rev-list", "-n", "1", f"v{self.VERSION}"), commits[0])
        self.assertEqual(git(self.apps[-1], "tag", "--list"), "")
        self.runner.fail = None
        plan = self.commit()
        self.assertEqual(plan["status"], "tagged")
        for app, head, product in zip(self.apps, commits, plan["products"]):
            self.assertEqual(git(app, "rev-parse", "HEAD"), head)
            self.assertEqual(git(app, "rev-list", "--count", "HEAD"), "2")
            self.assertEqual(git(app, "rev-list", "-n", "1", f"v{self.VERSION}"), head)
            self.assertEqual(git(app, "cat-file", "-t", f"v{self.VERSION}"), "tag")
            self.assertEqual(git(app, "status", "--porcelain"), "")
            self.assertEqual(product["commit"], head)
            committed_paths = git(app, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").splitlines()
            self.assertIn("src-tauri/Cargo.lock", committed_paths)
            self.assertTrue(all(self.release.allowed_path(p) for p in committed_paths))
        self.assertEqual(self.commit()["status"], "tagged")
        self.assertFalse(any(c["argv"][:2] == ["git", "push"] for c in self.runner.calls))

    def test_collect_artifacts_verifies_both_architectures_and_rejects_stale_output(self):
        repo = self.apps[0]
        title = "Tetorica Fixture"
        product = {"id": "sid", "metadata": {"product": title},
                   "buildStarted": time.time() - 10}
        bundles = []
        for target, suffix in (("x86_64-apple-darwin", "x64"),
                               ("aarch64-apple-darwin", "aarch64")):
            bundle = repo / "src-tauri/target" / target / "release/bundle"
            contents = bundle / "macos" / f"{title}.app" / "Contents"
            (contents / "MacOS").mkdir(parents=True)
            info = contents / "Info.plist"
            info.write_bytes(plistlib.dumps({"CFBundleShortVersionString": self.VERSION,
                                             "CFBundleExecutable": "fixture"}))
            (contents / "MacOS/fixture").write_bytes(b"Synthetic executable")
            (bundle / "dmg").mkdir()
            dmg = bundle / "dmg" / f"{title}_{self.VERSION}_{suffix}.dmg"
            dmg.write_bytes(f"Synthetic {suffix} DMG".encode())
            bundles.append((info, dmg))

        calls = []

        def verify_or_archive(argv, *, cwd, env=None, log=None, secret=None):
            self.assertEqual(Path(cwd), repo)
            self.assertIsNone(env)
            self.assertEqual(secret, self.PASSWORD)
            calls.append(argv)
            if argv[0] == "ditto":
                Path(argv[-1]).write_bytes(b"Synthetic app ZIP")
            elif argv[0] not in ("codesign", "xcrun", "lipo"):
                self.fail(f"Unexpected artifact command: {argv}")
            return "Mocked artifact verification passed.\n"

        runner = mock.Mock()
        runner.run.side_effect = verify_or_archive
        output = self.root / "collected artifacts"
        records = self.release.collect_artifacts(
            repo, product, self.VERSION, output, runner, self.PASSWORD)
        self.assertEqual(len(records), 4)
        self.assertEqual({Path(r["path"]).name for r in records}, {
            f"sid_{self.VERSION}_{arch}{suffix}"
            for arch in ("x86_64", "arm64") for suffix in (".app.zip", ".dmg")})
        for record in records:
            self.assertEqual(self.release.file_record(record["path"]), record)
        self.assertEqual([c[2] for c in calls if c[0] == "lipo"], ["x86_64", "arm64"])
        self.assertEqual(sum(c[:2] == ["codesign", "--verify"] for c in calls), 2)
        self.assertEqual(sum(c[:3] == ["xcrun", "stapler", "validate"] for c in calls), 2)
        self.assertEqual(sum(c[0] == "ditto" for c in calls), 2)

        info, dmg = bundles[0]
        original_info = info.read_bytes()
        for issue in ("wrong-version", "old-dmg"):
            with self.subTest(issue=issue):
                if issue == "wrong-version":
                    info.write_bytes(plistlib.dumps({"CFBundleShortVersionString": "0.1.0",
                                                     "CFBundleExecutable": "fixture"}))
                else:
                    old = product["buildStarted"] - 1
                    os.utime(dmg, (old, old))
                with self.assertRaises(self.release.ReleaseError):
                    self.release.collect_artifacts(
                        repo, product, self.VERSION, self.root / issue,
                        runner, self.PASSWORD)
                info.write_bytes(original_info)

    def test_runner_strips_inherited_password_and_redacts_build_output(self):
        log = self.root / "redacted.log"
        runner = self.release.Runner()
        env = {"APPLE_PASSWORD": self.PASSWORD,
               "APPLE_APP_SPECIFIC_PASSWORD": "fixture-secondary-password"}
        with mock.patch.dict(os.environ, env):
            output = runner.run(
                [sys.executable, "-c", "import os; print('APPLE_PASSWORD' in os.environ); "
                 "print('APPLE_APP_SPECIFIC_PASSWORD' in os.environ)"], cwd=self.root)
            self.assertEqual(output, "False\nFalse\n")
            output = runner.run(
                [sys.executable, "-c", "import os; print(os.environ['APPLE_PASSWORD'])"],
                cwd=self.root, env={"APPLE_PASSWORD": self.PASSWORD},
                secret=self.PASSWORD, log=log)
            self.assertEqual(output, "[REDACTED]\n")
        self.assertNotIn(self.PASSWORD, log.read_text())


class NativeResourcesTests(unittest.TestCase):
    def test_native_resources_choose_host_assets_prepare_then_check_without_secrets(self):
        release = load_module()
        with tempfile.TemporaryDirectory(prefix="tauri native resources ") as temporary:
            repo = Path(temporary).resolve()
            (repo / "scripts").mkdir()
            log = repo / "build.log"
            runner = mock.Mock()
            self.assertIsNone(release.prepare_native_resources(repo, runner, log))
            runner.run.assert_not_called()
            (repo / "scripts/prepare_audio_sidecar.mjs").write_text("// Mocked fixture\n")
            for arch, target in (("arm64", "aarch64-apple-darwin"),
                                 ("x64", "x86_64-apple-darwin")):
                with self.subTest(arch=arch):
                    assets = {"TETORICA_AUDIO_TARGET": target,
                              "TETORICA_NODE_BINARY": str(repo / "official node")}
                    runner = mock.Mock()
                    runner.run.side_effect = [arch + "\n", json.dumps(assets), "", ""]
                    result = release.prepare_native_resources(repo, runner, log)
                    self.assertEqual(result, assets)
                    self.assertEqual(runner.run.call_args_list, [
                        mock.call(["node", "-p", "process.arch"], cwd=repo, log=log),
                        mock.call(["node", "scripts/mac_audio_assets.mjs", target],
                                  cwd=repo, log=log),
                        mock.call(["node", "scripts/prepare_audio_sidecar.mjs"],
                                  cwd=repo, env=assets, log=log),
                        mock.call(["node", "scripts/check_audio_sidecar_bundle.mjs"],
                                  cwd=repo, env=assets, log=log),
                    ])
                    self.assertNotIn("APPLE_PASSWORD", result)
                    self.assertNotIn("APPLE_APP_SPECIFIC_PASSWORD", result)

            runner = mock.Mock()
            runner.run.side_effect = ["arm64\n", json.dumps({"APPLE_PASSWORD": "rejected"})]
            with self.assertRaisesRegex(release.ReleaseError, "asset environment"):
                release.prepare_native_resources(repo, runner, log)
            self.assertEqual(runner.run.call_count, 2)


if __name__ == "__main__":
    unittest.main()

