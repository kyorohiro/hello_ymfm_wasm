"""Check itch.io staging from published desktop GitHub releases."""
# SPDX-License-Identifier: BSD-3-Clause
import hashlib
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

import release_distribution as release


class ItchDesktopTests(unittest.TestCase):
    VERSION = "0.100.1"
    REPO = "kyorohiro/tetorica-fm2608-synth-tauri"
    PROJECT = "kyorohiro/tetorica-fm2608-synth"

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.enterContext(patch.object(release, "ROOT", self.root))
        self.print = self.enterContext(patch("builtins.print"))
        self.gh = self.enterContext(patch.object(release, "gh_json", side_effect=self.github))
        self.run = self.enterContext(patch.object(release, "run", side_effect=self.command))
        self.draft = False
        self.corrupt_download = False
        self.uploaded = {}
        self.channels = {
            "mac-arm64": ".dmg", "mac-x64": ".dmg", "win-x64": ".exe",
            "linux-x64": ".AppImage", "linux-x64-deb": ".deb",
            "linux-arm64": ".AppImage", "linux-arm64-deb": ".deb",
        }
        self.files = {
            f"tetorica-fm2608-synth_{self.VERSION}_{channel}{suffix}": channel.encode()
            for channel, suffix in self.channels.items()
        }
        self.files["SHA256SUMS"] = "".join(
            f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in self.files.items()
        ).encode()

    def github(self, *args):
        if args == ("release", "view", f"v{self.VERSION}", "-R", self.REPO, "--json", "databaseId,isDraft"):
            return {"databaseId": 42, "isDraft": self.draft}
        if args == ("api", f"repos/{self.REPO}/releases/42"):
            return {"assets": [{"name": name, "state": "uploaded", "size": len(data),
                                "digest": f"sha256:{hashlib.sha256(data).hexdigest()}"}
                               for name, data in self.files.items()]}
        self.fail(f"Unexpected GitHub command: {args}")

    def command(self, *args, capture=False):
        if args[:3] == ("gh", "release", "download"):
            self.assertEqual(args[3:7], (f"v{self.VERSION}", "-R", self.REPO, "--dir"))
            self.assertEqual(set(args[9::2]), set(self.files))
            for name, data in self.files.items():
                (args[7] / name).write_bytes(data)
            if self.corrupt_download:
                (args[7] / "SHA256SUMS").write_bytes(b"tampered checksum file")
            return
        binary, action, folder, target, option, version = args
        self.assertEqual((binary, action, option, version, capture), (
            "butler", "push", "--userversion", self.VERSION, False,
        ))
        project, channel = target.split(":")
        self.assertEqual(project, self.PROJECT)
        artifact, = Path(folder).iterdir()
        self.assertEqual(artifact.suffix, self.channels[channel])
        self.assertEqual(artifact.read_bytes(), channel.encode())
        if artifact.suffix == ".AppImage":
            self.assertTrue(artifact.stat().st_mode & stat.S_IXUSR)
        self.uploaded[channel] = self.uploaded.get(channel, 0) + 1

    def test_preview_does_not_push_and_retry_reuses_verified_uploads(self):
        ledger = release.web_state(self.VERSION).with_name("itch-uploads.json")
        release.itch_desktop(self.VERSION, "fm2608", False, "butler")
        self.assertFalse(ledger.exists())
        self.assertFalse(self.uploaded)
        self.print.assert_any_call("Preview · 7 files. Add --publish to upload to itch.io.")

        release.itch_desktop(self.VERSION, "fm2608", True, "butler")
        release.itch_desktop(self.VERSION, "fm2608", True, "butler")
        self.assertEqual(self.uploaded, dict.fromkeys(self.channels, 1))
        self.assertEqual(len(release.read_json(ledger)), 7)

    def test_draft_and_corrupted_download_are_rejected_before_upload(self):
        self.draft = True
        with self.assertRaisesRegex(release.ReleaseError, "on GitHub first"):
            release.itch_desktop(self.VERSION, "fm2608", True, "butler")
        self.run.assert_not_called()
        self.draft = False
        self.corrupt_download = True
        with self.assertRaisesRegex(release.ReleaseError, "Unexpected or changed GitHub release asset"):
            release.itch_desktop(self.VERSION, "fm2608", True, "butler")
        self.assertFalse(self.uploaded)

    def test_hash_file_must_describe_the_downloaded_installers(self):
        self.files["SHA256SUMS"] = b"valid GitHub attachment with invalid installer checksums\n"
        with self.assertRaisesRegex(release.ReleaseError, "Release checksums differ"):
            release.itch_desktop(self.VERSION, "fm2608", True, "butler")
        self.assertFalse(self.uploaded)


if __name__ == "__main__":
    unittest.main()
