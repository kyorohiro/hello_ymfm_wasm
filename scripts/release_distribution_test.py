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

    def fm2612_desktop_release(self):
        self.desktop_artifacts()
        state = release.state_path(self.root, VERSION)
        target = state.parent / "ci" / "synth"
        target.mkdir(parents=True)
        product = {
            "id": "synth", "repo": "tetorica-fm2612-synth-tauri", "tagged": True, "commit": COMMIT,
            "metadata": {"product": "Tetorica FM2612 Synth"},
            "artifacts": [self.artifact(f"mac/synth_{VERSION}_{arch}.dmg", arch.encode())
                          for arch in ("x86_64", "arm64")],
        }
        release.write_state(state, {"kind": "tauri-local-release", "status": "tagged",
                                    "version": VERSION, "products": [product]})
        files = release.gather_installers(self.root / "download", target, VERSION)
        release.write_state(target / "artifacts.json", {"commit": COMMIT, "version": VERSION, "files": files})
        self.gh.return_value = {"object": {"type": "commit", "sha": COMMIT}}
        return product, target

    def test_fm2612_desktop_stages_seven_installers_and_checksum(self):
        self.fm2612_desktop_release()
        expected = {"mac-arm64.dmg", "mac-x64.dmg", "win-x64.exe", "linux-x64-deb.deb",
                    "linux-arm64-deb.deb", "linux-x64.AppImage", "linux-arm64.AppImage"}
        notes = self.root / "notes.md"

        def upload(repo, tag, title, actual_notes, records, publish):
            self.assertEqual((repo, tag, title, actual_notes, publish), (
                f"{release.GITHUB_OWNER}/tetorica-fm2612-synth-tauri", TAG,
                f"Tetorica FM2612 Synth {TAG}", notes, True,
            ))
            paths = {Path(record["path"]).name: record for record in records}
            names = {f"tetorica-fm2612-synth_{VERSION}_{name}" for name in expected}
            self.assertEqual(set(paths), names | {"SHA256SUMS"})
            checksum = Path(paths["SHA256SUMS"]["path"]).read_text().splitlines()
            self.assertEqual(set(checksum), {f"{paths[name]['sha256']}  {name}" for name in names})
            self.assertEqual(Path(paths[f"tetorica-fm2612-synth_{VERSION}_mac-arm64.dmg"]["path"]).read_bytes(), b"arm64")

        with patch.object(release, "upload_github_release", side_effect=upload) as upload_mock:
            release.github_desktop(VERSION, notes, True)
        upload_mock.assert_called_once()

    def test_fm2612_desktop_rejects_wrong_tag_and_tampered_ci(self):
        _, target = self.fm2612_desktop_release()
        self.gh.return_value = {"object": {"type": "commit", "sha": OTHER_COMMIT}}
        with self.assertRaisesRegex(release.ReleaseError, "recorded tag"):
            release.github_desktop(VERSION, self.root / "notes.md", True)
        self.gh.return_value = {"object": {"type": "commit", "sha": COMMIT}}
        (target / "win-x64.exe").write_bytes(b"tampered installer")
        with self.assertRaisesRegex(release.ReleaseError, "Updated CI installer"):
            release.github_desktop(VERSION, self.root / "notes.md", True)
        self.run.assert_not_called()

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

    def test_desktop_recovery_requires_windows_linux_and_other_validation_jobs(self):
        repo = 'kyorohiro/tetorica-2a03-synth-tauri'
        row = {'databaseId': 42, 'status': 'completed', 'conclusion': 'cancelled',
               'url': 'https://example.invalid/cancelled-mac'}
        jobs = [{'name': f'build ({platform}, runner, installer)', 'status': 'completed', 'conclusion': 'success'}
                for platform in release.CI_PLATFORMS]
        jobs += [{'name': 'browser', 'status': 'completed', 'conclusion': 'success'},
                 {'name': 'build (macos-arm64, macos-14, dmg)', 'status': 'completed', 'conclusion': 'cancelled'}]
        self.gh.return_value = {'jobs': jobs}
        with patch.object(release, 'matching_run', return_value=row) as match:
            self.assertEqual(release.wait_for_desktop_artifacts(repo, TAG, COMMIT, 0), row)
            match.assert_called_with(repo, 'build-desktop.yml', TAG, COMMIT)
            for failed in (jobs[0], jobs[-2]):
                with self.subTest(failed=failed['name']):
                    failed['conclusion'] = 'failure'
                    with self.assertRaisesRegex(release.ReleaseError, 'Desktop CI failed'):
                        release.wait_for_desktop_artifacts(repo, TAG, COMMIT, 0)
                    failed['conclusion'] = 'success'

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
