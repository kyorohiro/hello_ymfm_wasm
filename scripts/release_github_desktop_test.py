"""Multi-product desktop release tests with a local plan and mocked GitHub."""
# SPDX-License-Identifier: BSD-3-Clause
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import release_distribution as release


VERSION = "0.100.1"
BATCH = "desktop-test"
INSTALLERS = {
    "win-x64": ".exe", "linux-x64": ".AppImage", "linux-x64-deb": ".deb",
    "linux-arm64": ".AppImage", "linux-arm64-deb": ".deb",
}


class GitHubDesktopTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.enterContext(patch.object(release, "ROOT", self.root))
        self.remote_tag = self.enterContext(patch.object(release, "remote_tag"))
        self.upload = self.enterContext(patch.object(release, "upload_github_release"))
        self.state = release.state_path(self.root, VERSION, BATCH)
        self.notes = self.root / "notes.md"
        self.notes.write_text("Release notes\n")
        self.products = [
            self.release_product("2a03", "tetorica-2a03-synth-tauri", "Tetorica 2A03 Synth", "a" * 40),
            self.release_product("spu", "tetorica-spu-synth-tauri", "Tetorica SPU Synth", "b" * 40),
        ]
        release.write_state(self.state, {
            "kind": "tauri-local-release", "status": "tagged", "version": VERSION,
            "products": self.products,
        })
        self.commits = {f"{release.GITHUB_OWNER}/{product['repo']}": product["commit"]
                        for product in self.products}
        self.remote_tag.side_effect = lambda repository, tag: self.commits[repository]

    def artifact(self, path, payload):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload.encode())
        return release.file_record(path)

    def release_product(self, identifier, repo, name, commit):
        product = {"id": identifier, "repo": repo, "commit": commit, "tagged": True,
                   "metadata": {"product": name}, "artifacts": []}
        for arch in ("arm64", "x86_64"):
            path = self.state.parent / "artifacts" / identifier / f"{identifier}_{VERSION}_{arch}.dmg"
            product["artifacts"].append(self.artifact(path, f"{identifier} {arch}"))
        target = self.state.parent / "ci" / identifier
        ci = {}
        for channel, suffix in INSTALLERS.items():
            filename = f"{channel}{suffix}"
            record = self.artifact(target / filename, f"{identifier} {channel}")
            ci[channel] = {"name": filename, "originalName": f"{name}_{VERSION}{suffix}",
                           "sha256": record["sha256"], "bytes": record["bytes"]}
        release.write_state(target / "artifacts.json", {"commit": commit, "version": VERSION, "files": ci})
        return product

    def test_named_batch_publishes_all_products_with_distinct_asset_names(self):
        def verify_upload(repo, tag, title, notes, records, publish):
            product = next(item for item in self.products if repo.endswith("/" + item["repo"]))
            self.assertEqual((tag, title, notes, publish),
                             (f"v{VERSION}", f"{product['metadata']['product']} v{VERSION}", self.notes, False))
            prefix = product["repo"].removesuffix("-tauri") + "_" + VERSION + "_"
            installers = {Path(record["path"]).name: record for record in records[:-1]}
            expected = {prefix + channel + suffix for channel, suffix in INSTALLERS.items()}
            expected |= {prefix + "mac-arm64.dmg", prefix + "mac-x64.dmg"}
            self.assertEqual(set(installers), expected)
            checksum = Path(records[-1]["path"])
            self.assertEqual(checksum.name, "SHA256SUMS")
            self.assertEqual(set(checksum.read_text().splitlines()),
                             {f"{record['sha256']}  {name}" for name, record in installers.items()})
            self.assertEqual(self.remote_tag.call_count, 2)

        self.upload.side_effect = verify_upload
        release.github_desktop(VERSION, self.notes, False, batch=BATCH)
        self.assertEqual(self.upload.call_count, 2)

    def test_later_tag_mismatch_or_corrupt_artifact_blocks_first_upload(self):
        repo = f"{release.GITHUB_OWNER}/{self.products[1]['repo']}"
        self.commits[repo] = "c" * 40
        with self.assertRaisesRegex(release.ReleaseError, "recorded tag"):
            release.github_desktop(VERSION, self.notes, True, batch=BATCH)
        self.commits[repo] = self.products[1]["commit"]
        (self.state.parent / "ci" / "spu" / "win-x64.exe").write_bytes(b"edited")
        with self.assertRaisesRegex(release.ReleaseError, "Updated CI installer"):
            release.github_desktop(VERSION, self.notes, True, batch=BATCH)
        self.upload.assert_not_called()

    def test_product_selection_only_needs_selected_packages_and_rejects_missing_ids(self):
        Path(self.products[0]["artifacts"][0]["path"]).unlink()
        release.github_desktop(VERSION, self.notes, False, "spu", batch=BATCH)
        self.assertEqual(self.upload.call_args.args[0], f"{release.GITHUB_OWNER}/tetorica-spu-synth-tauri")
        self.upload.reset_mock()
        with self.assertRaisesRegex(release.ReleaseError, "Products missing.*dmg"):
            release.github_desktop(VERSION, self.notes, True, "dmg", batch=BATCH)
        self.upload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
