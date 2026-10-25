import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/import_soundchip_sdk.py'
spec = importlib.util.spec_from_file_location('soundchip_sdk', SCRIPT)
sdk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sdk)


class SoundchipSdkTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name)
        self.root = self.work / 'standalone app'
        self.root.mkdir()

    def archive(self, *, version='0.1.0', alter=None, alter_payload=None):
        payload = {name: ('pinned SDK source: ' + name).encode() for name in sdk.REQUIRED}
        payload['sdk.json'] = json.dumps({'name': sdk.NAME, 'version': version}).encode()
        # Preserve every release member, not only the minimum YM2612 inputs.
        payload['other-chip/core.cpp'] = b'additional SDK source\x00\xff\n'
        payload['catalog/extra-test.json'] = b'{}\n'
        if alter_payload:
            alter_payload(payload)
        manifest = {'schemaVersion': 1, 'kind': 'source', 'name': sdk.NAME, 'version': version,
                    'files': {name: {'sha256': sdk.digest(data), 'size': len(data)}
                              for name, data in payload.items()}}
        payload[sdk.MANIFEST] = json.dumps(manifest).encode()
        prefix = sdk.NAME + '-' + version + '/'
        entries = [(prefix + name, data, stat.S_IFREG | 0o644) for name, data in payload.items()]
        if alter:
            entries = alter(entries)
        path = self.work / 'sdk.zip'
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(path, 'w') as archive:
                for name, data, mode in entries:
                    info = zipfile.ZipInfo(name)
                    info.create_system = 3
                    info.external_attr = mode << 16
                    archive.writestr(info, data)
        return path, sdk.digest(path.read_bytes())

    def install(self, **options):
        path, checksum = self.archive(**options)
        return sdk.import_archive(path, checksum, 'a' * 40, self.root)

    def test_local_archive_import_check_idempotence_and_explicit_update(self):
        initial = self.install()
        self.assertEqual(sdk.check_installed(self.root), initial)
        self.assertEqual(initial['sourceCommit'], 'a' * 40)
        self.assertEqual(initial['fileCount'], len(sdk.REQUIRED) + 3)
        snapshot = self.root / sdk.SNAPSHOT
        self.assertEqual((snapshot / 'other-chip/core.cpp').read_bytes(),
                         b'additional SDK source\x00\xff\n')
        self.assertEqual(initial['manifestSha256'],
                         sdk.digest((snapshot / sdk.MANIFEST).read_bytes()))
        data = (self.root / sdk.SNAPSHOT / 'vendor/ymfm/ymfm_opn.cpp').read_bytes()
        self.assertEqual(self.install(), initial)
        updated = self.install(version='0.2.0')
        self.assertNotEqual(updated['archiveSha256'], initial['archiveSha256'])
        self.assertEqual(updated['version'], '0.2.0')
        self.assertEqual((self.root / sdk.SNAPSHOT / 'vendor/ymfm/ymfm_opn.cpp').read_bytes(), data)
        self.assertEqual(sdk.check_installed(self.root), updated)

    def test_every_required_wasm_input_is_required_even_with_valid_manifest(self):
        for missing in sorted(sdk.REQUIRED):
            with self.subTest(missing=missing):
                path, checksum = self.archive(alter_payload=lambda payload: payload.pop(missing))
                with self.assertRaisesRegex(ValueError, 'source release is incomplete'):
                    sdk.import_archive(path, checksum, 'a' * 40, self.root)
                self.assertFalse((self.root / sdk.SNAPSHOT).exists())

    def test_cli_checks_copy_without_original_archive_or_sdk_checkout(self):
        self.install()
        self.work.joinpath('sdk.zip').unlink()
        script = self.root / 'scripts/import_soundchip_sdk.py'
        script.parent.mkdir()
        shutil.copyfile(SCRIPT, script)
        result = subprocess.run([sys.executable, str(script), '--check'], cwd=self.root,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('verified offline', result.stdout)

    def test_archive_checksum_failure_does_not_install(self):
        path, _ = self.archive()
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            sdk.import_archive(path, '0' * 64, 'a' * 40, self.root)
        self.assertFalse((self.root / sdk.SNAPSHOT).exists())

    def test_invalid_revision_is_rejected_before_writing(self):
        path, checksum = self.archive()
        for revision in ('', 'a' * 39, 'A' * 40, '../not-a-commit'):
            with self.subTest(revision=revision), self.assertRaisesRegex(ValueError, 'source commit'):
                sdk.import_archive(path, checksum, revision, self.root)
        self.assertFalse((self.root / sdk.SNAPSHOT).exists())

    def test_metadata_mismatch_is_rejected_even_when_file_hashes_match(self):
        for metadata in ({'name': sdk.NAME, 'version': 'different'}, [], {'version': '0.1.0'}):
            with self.subTest(metadata=metadata):
                path, checksum = self.archive(alter_payload=lambda payload: payload.update({
                    'sdk.json': json.dumps(metadata).encode()}))
                with self.assertRaisesRegex(ValueError, 'metadata and release manifest differ'):
                    sdk.import_archive(path, checksum, 'a' * 40, self.root)
        self.assertFalse((self.root / sdk.SNAPSHOT).exists())

    def test_imports_exact_hashed_bytes_if_archive_path_changes_after_read(self):
        path, checksum = self.archive(version='0.1.0')
        original = path.read_bytes()
        self.archive(version='0.2.0')
        replacement = path.read_bytes()
        path.write_bytes(original)
        read = Path.read_bytes

        def replace_after_read(current):
            data = read(current)
            if current == path:
                current.write_bytes(replacement)
            return data

        with patch.object(Path, 'read_bytes', replace_after_read):
            pin = sdk.import_archive(path, checksum, 'a' * 40, self.root)
        self.assertEqual(pin['version'], '0.1.0')
        self.assertEqual(pin['archiveSha256'], checksum)
        self.assertEqual(sdk.check_installed(self.root), pin)

    def test_content_and_manifest_corruption_do_not_replace_current_sources(self):
        initial = self.install()
        for change in ('bytes', 'missing', 'duplicate', 'extra', 'symlink', 'escape', 'case'):
            with self.subTest(change=change):
                def alter(entries):
                    name, data, mode = entries[0]
                    if change == 'bytes':
                        return [(name, b'changed bytes', mode), *entries[1:]]
                    if change == 'missing':
                        return entries[1:]
                    if change == 'duplicate':
                        return [*entries, entries[0]]
                    if change == 'symlink':
                        return [(name, data, stat.S_IFLNK | 0o777), *entries[1:]]
                    if change == 'escape':
                        return [*entries, ('../escape.cpp', b'outside', mode)]
                    if change == 'case':
                        return [*entries, (name.upper(), data, mode)]
                    return [*entries, ('tetorica-soundchip-native-0.1.0/extra.cpp', b'extra', mode)]
                path, checksum = self.archive(alter=alter)
                with self.assertRaises(ValueError):
                    sdk.import_archive(path, checksum, 'a' * 40, self.root)
                self.assertEqual(sdk.check_installed(self.root), initial)
                self.assertFalse((self.root / 'escape.cpp').exists())

    def test_unsafe_zip_paths_and_special_entries_are_rejected(self):
        for name in ('/absolute.cpp', '../escape.cpp', 'root/../escape.cpp',
                     'root//file.cpp', 'root/./file.cpp', 'C:/file.cpp',
                     'root\\file.cpp'):
            with self.subTest(name=name):
                path, checksum = self.archive(alter=lambda entries: [
                    *entries, (name, b'unsafe', stat.S_IFREG | 0o644)])
                with self.assertRaisesRegex(ValueError, 'Unsafe SDK path'):
                    sdk.import_archive(path, checksum, 'a' * 40, self.root)
        for mode in (stat.S_IFDIR | 0o755, stat.S_IFIFO | 0o644):
            with self.subTest(mode=mode):
                path, checksum = self.archive(alter=lambda entries: [
                    *entries, ('special', b'', mode)])
                with self.assertRaisesRegex(ValueError, 'not a regular file'):
                    sdk.import_archive(path, checksum, 'a' * 40, self.root)
        self.assertFalse((self.root / sdk.SNAPSHOT).exists())

    def test_manifest_identity_and_duplicate_json_keys_are_rejected(self):
        for data in (b'[]', b'{"schemaVersion":1,"schemaVersion":1}',
                     b'{"schemaVersion":1,"kind":"binary","name":"wrong"}'):
            with self.subTest(data=data):
                def alter(entries):
                    return [(name, data if name.endswith('/' + sdk.MANIFEST) else content, mode)
                            for name, content, mode in entries]
                path, checksum = self.archive(alter=alter)
                with self.assertRaises(ValueError):
                    sdk.import_archive(path, checksum, 'a' * 40, self.root)

    def test_zip_root_must_match_release_identity(self):
        path, checksum = self.archive(alter=lambda entries: [
            (name.replace('tetorica-soundchip-native-0.1.0/', 'other-root/', 1), data, mode)
            for name, data, mode in entries])
        with self.assertRaisesRegex(ValueError, 'root differs from release identity'):
            sdk.import_archive(path, checksum, 'a' * 40, self.root)

    def test_local_edits_or_added_files_are_not_silently_overwritten(self):
        self.install()
        path = self.root / sdk.SNAPSHOT / 'vendor/ymfm/ymfm_opn.cpp'
        original = path.read_bytes()
        path.write_bytes(b'downstream edit')
        with self.assertRaisesRegex(ValueError, 'hash/size mismatch'):
            self.install(version='0.2.0')
        self.assertEqual(path.read_bytes(), b'downstream edit')
        path.write_bytes(original)
        extra = self.root / sdk.SNAPSHOT / 'unrecorded.cpp'
        extra.write_bytes(b'unrecorded')
        with self.assertRaises(ValueError):
            sdk.check_installed(self.root)

    def test_manifest_or_receipt_changes_are_detected(self):
        self.install()
        path = self.root / sdk.SNAPSHOT / sdk.MANIFEST
        original = path.read_bytes()
        path.write_bytes(original + b'\n')
        with self.assertRaisesRegex(ValueError, 'manifest differs'):
            sdk.check_installed(self.root)
        path.write_bytes(original)
        receipt = self.root / sdk.RECEIPT
        pin = json.loads(receipt.read_bytes())
        pin['version'] = 'wrong-version'
        receipt.write_text(json.dumps(pin))
        with self.assertRaisesRegex(ValueError, 'pin version/file count'):
            sdk.check_installed(self.root)

    def test_missing_pin_or_invalid_pin_cannot_be_replaced_by_reimport(self):
        initial = self.install()
        receipt = self.root / sdk.RECEIPT
        receipt.unlink()
        with self.assertRaises(OSError):
            self.install()
        for change in ({'sourceCommit': 123}, {'archiveSha256': 'bad'}, {'fileCount': 1}):
            with self.subTest(change=change):
                receipt.write_text(json.dumps({**initial, **change}))
                with self.assertRaises(ValueError):
                    self.install()

    def test_failed_snapshot_replacement_restores_previous_snapshot_and_pin(self):
        initial = self.install()
        path, checksum = self.archive(version='0.2.0')
        replace = Path.replace

        def fail_pin_replace(current, target):
            if current.name == 'pin.json':
                raise OSError('simulated receipt write failure')
            return replace(current, target)

        with patch.object(Path, 'replace', fail_pin_replace):
            with self.assertRaisesRegex(OSError, 'simulated receipt write failure'):
                sdk.import_archive(path, checksum, 'b' * 40, self.root)
        self.assertEqual(sdk.check_installed(self.root), initial)

    def test_rejects_symbolic_links_in_snapshot_or_vendor_parent(self):
        self.install()
        snapshot = self.root / sdk.SNAPSHOT
        link = snapshot / 'linked-source'
        try:
            link.symlink_to(self.root / sdk.RECEIPT)
        except OSError:
            self.skipTest('Symbolic links are unavailable on this runner')
        with self.assertRaisesRegex(ValueError, 'symbolic link'):
            sdk.check_installed(self.root)
        link.unlink()
        vendor = snapshot.parent
        moved = self.root / 'moved vendor'
        vendor.rename(moved)
        vendor.symlink_to(moved, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'parent must not be a symbolic link'):
            sdk.check_installed(self.root)
        with self.assertRaises(ValueError):
            self.install()
