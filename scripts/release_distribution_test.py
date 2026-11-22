"""Release distribution checks using local artifacts and fake GitHub and Butler calls."""
# SPDX-License-Identifier: BSD-3-Clause
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import release_distribution as release


VERSION = "0.100.1"
TAG = f"v{VERSION}"
COMMIT = "a" * 40
OTHER_COMMIT = "b" * 40


class ReleaseDistributionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.enterContext(patch.object(release, "ROOT", self.root))
        self.enterContext(patch("builtins.print"))
        self.run = self.enterContext(patch.object(release, "run"))
        self.gh = self.enterContext(patch.object(release, "gh_json"))

    def artifact(self, name, contents):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(contents)
        return release.file_record(path)

    def web_artifacts(self):
        normal = self.artifact("tetorica_playground.zip", b"editable ZIP")
        browser = self.artifact("tetorica_playground_for_run.zip", b"browser ZIP")
        self.enterContext(patch.object(release, "verified_web", return_value={
            "version": VERSION, "commit": COMMIT,
            "normal": {"playground": normal},
            "browser": {"playground": browser},
        }))
        release.web_state(VERSION).parent.mkdir(parents=True)
        return normal, browser

    @staticmethod
    def github_asset(record):
        return {"name": Path(record["path"]).name, "state": "uploaded",
                "size": record["bytes"], "digest": f"sha256:{record['sha256']}"}

    def test_itch_rejects_desktop_built_from_another_web_zip(self):
        self.web_artifacts()
        with patch.object(release, "committed_desktop", return_value={
            "webVersion": VERSION, "products": [{"id": "playground", "sourceSha256": "other"}],
        }):
            with self.assertRaisesRegex(release.ReleaseError, "different Web ZIP"):
                release.itch_targets(VERSION, "1.2.3", ["playground"])

    def test_push_tag_resolves_annotated_ref_and_pushes_only_recorded_tag(self):
        tag_object = "c" * 40
        self.gh.side_effect = [
            release.ReleaseError("HTTP 404"),
            {"object": {"type": "tag", "sha": tag_object}},
            {"object": {"type": "commit", "sha": COMMIT}},
        ]
        self.run.side_effect = ["", "", COMMIT, ""]

        release.push_tag(release.WEB_REPO, self.root, TAG, COMMIT)

        self.run.assert_any_call("git", "tag", "-a", TAG, COMMIT, "-m", f"Release {TAG}", cwd=self.root)
        args, kwargs = self.run.call_args
        self.assertEqual(args[-3:], ("push", f"https://github.com/{release.WEB_REPO}.git", f"refs/tags/{TAG}"))
        self.assertEqual(kwargs["cwd"], self.root)
        self.gh.assert_called_with("api", f"repos/{release.WEB_REPO}/git/tags/{tag_object}")

    def test_push_tag_keeps_remote_tag_at_other_commit(self):
        self.gh.return_value = {"object": {"type": "commit", "sha": OTHER_COMMIT}}
        with self.assertRaisesRegex(release.ReleaseError, "at another commit"):
            release.push_tag(release.WEB_REPO, self.root, TAG, COMMIT)
        self.run.assert_not_called()

    def test_matching_run_requires_both_tag_and_commit(self):
        same_commit = {"headBranch": "main", "headSha": COMMIT, "databaseId": 20}
        same_tag = {"headBranch": TAG, "headSha": OTHER_COMMIT, "databaseId": 21}
        expected = {"headBranch": TAG, "headSha": COMMIT, "databaseId": 22}
        self.gh.return_value = [same_commit, same_tag, expected]
        self.assertEqual(release.matching_run(release.WEB_REPO, "itch-web.yml", TAG, COMMIT), expected)
        args = self.gh.call_args.args
        self.assertEqual(args[args.index("--branch") + 1], TAG)
        self.assertEqual(args[args.index("--commit") + 1], COMMIT)
        self.gh.return_value = [same_commit, same_tag]
        self.assertIsNone(release.matching_run(release.WEB_REPO, "itch-web.yml", TAG, COMMIT))

    def test_draft_retry_uploads_only_missing_assets(self):
        normal, browser = self.web_artifacts()
        notes = self.root / "notes.md"
        notes.write_text("Release notes\n")
        endpoint = f"repos/{release.WEB_REPO}/releases/42"
        remote_assets = [self.github_asset(normal)]

        def github(*args):
            if args[:2] == ("release", "view"):
                return {"databaseId": 42, "isDraft": True}
            if args == ("api", endpoint):
                return {"assets": remote_assets, "html_url": "https://example.invalid/release"}
            if args == ("api", f"repos/{release.WEB_REPO}/git/ref/tags/{TAG}"):
                return {"object": {"type": "commit", "sha": COMMIT}}
            self.fail(f"Unexpected GitHub command {args}")

        def upload(*args, capture):
            self.assertEqual(args[:6], ("gh", "release", "upload", TAG, "-R", release.WEB_REPO))
            self.assertFalse(capture)
            self.assertEqual(args[6:], (browser["path"], str(release.web_state(VERSION).with_name("SHA256SUMS"))))
            remote_assets.extend(self.github_asset(release.file_record(path)) for path in args[6:])

        self.gh.side_effect = github
        self.run.side_effect = upload
        release.github_web(VERSION, notes, False, False, 0)
        self.run.assert_called_once()
        checksum = release.web_state(VERSION).with_name("SHA256SUMS").read_text()
        for record in (normal, browser):
            self.assertIn(f"{record['sha256']}  {Path(record['path']).name}\n", checksum)

        self.run.reset_mock()
        release.github_web(VERSION, notes, False, False, 0)
        self.run.assert_not_called()

    def test_unexpected_or_changed_github_assets_are_rejected(self):
        normal, _ = self.web_artifacts()
        asset = self.github_asset(normal)
        for change in ({"name": "other.zip"}, {"size": 999}, {"digest": "sha256:wrong"}, {"state": "new"}):
            with self.subTest(change=change), self.assertRaisesRegex(release.ReleaseError, "Unexpected or changed"):
                release.missing_github_assets([normal], [{**asset, **change}])

    def test_failed_tagged_workflow_blocks_publish(self):
        self.web_artifacts()
        self.gh.return_value = {"object": {"type": "commit", "sha": COMMIT}}
        with patch.object(release, "wait_for_run", return_value={
            "conclusion": "failure", "url": "https://example.invalid/run",
        }) as wait:
            with self.assertRaisesRegex(release.ReleaseError, "Release checks failed"):
                release.github_web(VERSION, self.root / "notes.md", False, True, 22)
        wait.assert_called_once_with(release.WEB_REPO, release.WEB_WORKFLOWS[0], TAG, COMMIT, 22)
        self.run.assert_not_called()
        self.gh.assert_called_once()

    def desktop_artifacts(self):
        sources = {}
        for platform, suffix, channel, arch in (
            ("windows-x86_64", ".exe", "win-x64", "x64"),
            ("linux-x86_64", ".deb", "linux-x64-deb", "amd64"),
            ("linux-x86_64", ".AppImage", "linux-x64", "amd64"),
            ("linux-arm64", ".deb", "linux-arm64-deb", "arm64"),
            ("linux-arm64", ".AppImage", "linux-arm64", "aarch64"),
        ):
            sources[channel] = self.artifact(
                f"download/tetorica-sid-synth-{platform}/bundle/Test_{VERSION}_{arch}{suffix}",
                channel.encode(),
            )
        destination = self.root / "verified"
        destination.mkdir()
        return sources, destination

    def test_gather_preserves_both_linux_architectures_and_original_names(self):
        sources, destination = self.desktop_artifacts()
        records = release.gather_installers(self.root / "download", destination, VERSION)
        self.assertEqual(set(records), set(sources))
        for channel, record in records.items():
            original = Path(sources[channel]["path"])
            self.assertEqual(record["originalName"], original.name)
            self.assertEqual(record["name"], channel + original.suffix)
            self.assertEqual((destination / record["name"]).read_bytes(), channel.encode())

        commit = {"id": "sid", "commit": COMMIT}
        release.write_state(destination / "artifacts.json", {"commit": COMMIT, "version": VERSION, "files": records})
        self.assertEqual(release.ci_records(destination, commit, VERSION)["linux-arm64"]["originalName"],
                         Path(sources["linux-arm64"]["path"]).name)
        with self.assertRaisesRegex(release.ReleaseError, "do not match"):
            release.ci_records(destination, {**commit, "commit": OTHER_COMMIT}, VERSION)

    def test_gather_rejects_installer_from_another_version(self):
        sources, destination = self.desktop_artifacts()
        original = Path(sources["linux-arm64"]["path"])
        original.rename(original.with_name(original.name.replace(VERSION, "0.99.99")))
        with self.assertRaisesRegex(release.ReleaseError, r"\.AppImage installer for linux-arm64"):
            release.gather_installers(self.root / "download", destination, VERSION)

    def test_itch_dry_run_and_retry_after_partial_upload(self):
        normal, browser = self.web_artifacts()
        html = f"{release.GITHUB_OWNER}/{release.ITCH_SLUG['playground']}:html"
        source = f"{release.GITHUB_OWNER}/{release.ITCH_SLUG['playground']}:source"
        ledger = release.web_state(VERSION).with_name("itch-uploads.json")
        butler = self.root / "butler"
        selected = ["playground"]

        release.itch(VERSION, None, selected, False, butler)
        self.run.assert_not_called()
        self.assertFalse(ledger.exists())

        def upload(binary, action, path, target, option, version, capture):
            self.assertEqual((binary, action, option, version, capture), (butler, "push", "--userversion", VERSION, False))
            if target == html:
                self.assertEqual(path, Path(browser["path"]))
            else:
                self.assertEqual(target, source)
                filename = Path(normal["path"]).name
                self.assertEqual((path / filename).read_bytes(), b"editable ZIP")
                self.assertEqual((path / "SHA256SUMS").read_text(), f"{normal['sha256']}  {filename}\n")
                if self.run.call_count == 2:
                    raise release.ReleaseError("Butler disconnected")

        self.run.side_effect = upload
        with self.assertRaisesRegex(release.ReleaseError, "Butler disconnected"):
            release.itch(VERSION, None, selected, True, butler)
        self.assertEqual(release.read_json(ledger), {html: {"version": VERSION, "sha256": browser["sha256"]}})

        release.itch(VERSION, None, selected, True, butler)
        self.assertEqual([call.args[3] for call in self.run.call_args_list], [html, source, source])
        self.assertEqual(release.read_json(ledger)[source], {"version": VERSION, "sha256": normal["sha256"]})

        self.run.reset_mock()
        release.itch(VERSION, None, selected, True, butler)
        self.run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
