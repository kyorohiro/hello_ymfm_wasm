"""Fixture-only checks; never touch the actual Tauri app repositories."""

import json
import tempfile
import tomllib
import unittest
from pathlib import Path

from tauri_release_metadata import (
    FILES,
    dependency_snapshot,
    read_metadata,
    update_metadata,
    validate_version,
    verify_metadata,
)


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        (self.repo / "src-tauri").mkdir()
        fixtures = {
            "package.json": {"name": "test-app", "version": "1.2.3", "scripts": {"build": "tauri build"}},
            "package-lock.json": {
                "name": "test-app", "version": "0.8.0", "lockfileVersion": 3,
                "packages": {"": {"name": "test-app", "version": "0.8.0"}, "node_modules/example": {"version": "4.5.6"}},
            },
            "src-tauri/tauri.conf.json": {"productName": "Test App", "version": "1.2.3", "identifier": "example.test"},
        }
        for filename, data in fixtures.items():
            (self.repo / filename).write_text(json.dumps(data, indent=2) + "\n")
        (self.repo / "src-tauri/Cargo.toml").write_text(
            '[package]\nname = "test-app"\nversion = "1.2.3" # app version\nedition = "2021"\n'
            '\n[dependencies]\nexample = { version = "4.5.6" }\n'
        )
        (self.repo / "src-tauri/Cargo.lock").write_text(
            '# generated fixture\nversion = 4\n\n'
            '[[package]]\nname = "test-app"\nversion = "1.2.3"\ndependencies = ["example"]\n\n'
            '[[package]]\nname = "example"\nversion = "4.5.6"\nsource = "registry+https://example.invalid/index"\n'
            'checksum = "abc123"\ndependencies = ["test-app 9.0.0"]\n\n'
            '[[package]]\nname = "test-app"\nversion = "9.0.0"\nsource = "registry+https://example.invalid/index"\nchecksum = "def456"\n'
        )

    def bytes_snapshot(self):
        return {filename: (self.repo / filename).read_bytes() for filename in FILES}

    def test_numeric_semver_is_path_safe(self):
        for value in ("0.0.0", "1.2.3", "123.45.6"):
            self.assertEqual(validate_version(value), value)
        for value in ("01.2.3", "1.02.3", "1.2.03", "1.2", "v1.2.3", "1.2.3-beta", "1.2.3+build", "../1.2.3", "1.2.3\n", "١.2.3", None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_version(value)

    def test_read_accepts_stale_npm_lock_and_verify_reports_it(self):
        metadata = read_metadata(self.repo)
        self.assertEqual(metadata["name"], "test-app")
        self.assertEqual(metadata["version"], "1.2.3")
        self.assertEqual(metadata["product"], "Test App")
        self.assertEqual(metadata["packageLockRootVersion"], "0.8.0")
        with self.assertRaisesRegex(ValueError, "packageLockVersion"):
            verify_metadata(self.repo, "1.2.3")

    def test_update_syncs_all_versions_without_changing_dependencies(self):
        before = dependency_snapshot(self.repo)
        update_metadata(self.repo, "2.0.4")
        verify_metadata(self.repo, "2.0.4")
        self.assertEqual(dependency_snapshot(self.repo), before)
        self.assertEqual(before[-1]["version"], "9.0.0")
        manifest = (self.repo / "src-tauri/Cargo.toml").read_text()
        self.assertIn('version = "2.0.4" # app version', manifest)
        self.assertEqual(tomllib.loads(manifest)["dependencies"]["example"]["version"], "4.5.6")
        npm_lock = json.loads((self.repo / "package-lock.json").read_text())
        self.assertEqual(npm_lock["packages"]["node_modules/example"]["version"], "4.5.6")
        after = self.bytes_snapshot()
        update_metadata(self.repo, "2.0.4")
        self.assertEqual(self.bytes_snapshot(), after)

    def test_sparse_metadata_fails_before_any_write(self):
        lock_path = self.repo / "package-lock.json"
        lock = json.loads(lock_path.read_text())
        del lock["packages"][""]["version"]
        lock_path.write_text(json.dumps(lock))
        before = self.bytes_snapshot()
        with self.assertRaisesRegex(ValueError, "Missing"):
            update_metadata(self.repo, "2.0.0")
        self.assertEqual(self.bytes_snapshot(), before)

    def test_main_version_mismatch_fails_before_any_write(self):
        path = self.repo / "src-tauri/tauri.conf.json"
        config = json.loads(path.read_text())
        config["version"] = "1.2.4"
        path.write_text(json.dumps(config))
        before = self.bytes_snapshot()
        with self.assertRaisesRegex(ValueError, "must agree"):
            update_metadata(self.repo, "2.0.0")
        self.assertEqual(self.bytes_snapshot(), before)

    def test_nonliteral_cargo_version_fails_before_any_write(self):
        path = self.repo / "src-tauri/Cargo.toml"
        # Valid TOML, but a multiline literal is deliberately unsupported by the
        # narrow editor. This failure happens after preparing the JSON updates.
        path.write_text(path.read_text().replace('version = "1.2.3"', 'version = """1.2.3"""'))
        before = self.bytes_snapshot()
        with self.assertRaisesRegex(ValueError, "one literal version"):
            update_metadata(self.repo, "2.0.0")
        self.assertEqual(self.bytes_snapshot(), before)


if __name__ == "__main__":
    unittest.main()
