"""SCSP catalog guards, preserving historical PS1-only releases."""
import copy
import hashlib
import json
from pathlib import Path
import unittest
import argparse
from unittest.mock import patch
import test_ps1_instrument_release as ps1

ROOT = Path(__file__).resolve().parents[1]


class ScspInstrumentReleaseTests(unittest.TestCase):
    def setUp(self):
        self.helper = ps1.Ps1InstrumentReleaseTests(methodName='runTest')
        self.helper.setUp()
        self.addCleanup(self.helper.doCleanups)
        h = self.helper
        for name, document in [('source_inventory', h.inventory), ('native_inventory', h.native), ('chips', h.catalog)]:
            record = next(item for item in json.loads((ROOT/f'catalog/{name}.json').read_text())['instruments'] if item['id'] == 'scsp')
            document['instruments'].append(copy.deepcopy(record))
        record, device = h.inventory['instruments'][1], h.native['instruments'][1]
        paths = set(record['sourceFiles']+record['licenseFiles']+record['buildFiles']+device['sourceFiles']+device['buildFiles'])
        for name in paths:
            h.helper.write(name, 'Fixture '+name+'\n')
        # Shared build paths are not component hashes; original PS1 records stay valid.
        h.inventory['components'].append({'id': 'fixture-scsp', 'sourceFiles': record['sourceFiles'], 'licenseFiles': record['licenseFiles'],
            'files': [{'path': name, 'originPath': name, 'sha256': hashlib.sha256((h.root/name).read_bytes()).hexdigest()}
                      for name in record['sourceFiles']+record['licenseFiles']]})
        h.save()

    def test_scsp_does_not_change_generic_chip_ids(self):
        h = self.helper
        result = ps1.sdk_common.check_collection(h.root)
        self.assertEqual(result['chips'], 24)
        self.assertEqual(result['instruments'], 2)
        ps1.checker.audit_catalog(h.root)

    def test_duplicate_or_missing_scsp_record_is_rejected(self):
        h = self.helper
        h.native['instruments'].append(copy.deepcopy(h.native['instruments'][1]))
        h.rejected('inventory')
        h.native['instruments'] = h.native['instruments'][:1]
        h.rejected('inventory')

    def test_scsp_sources_require_hash_provenance(self):
        self.helper.inventory['components'][-1]['files'].pop()
        self.helper.rejected('hash provenance')

    def test_scsp_cannot_substitute_an_unrelated_native_target(self):
        h = self.helper
        h.native['instruments'][1]['target'] = 'tetorica_native_ps1_spu'
        h.catalog['instruments'][1]['native'] = copy.deepcopy(h.native['instruments'][1])
        h.rejected('Native target/header')

    def test_scsp_parity_rejects_missing_or_unrelated_wasm(self):
        h = self.helper
        for selected in [[], ['ps1_spu']]:
            args = argparse.Namespace(source_zip=h.helper.work/'source.zip', wasm_zip=h.helper.work/'wasm.zip' if selected else None,
                work_dir=h.helper.work/('scsp-admission-'+str(len(selected))), audit_only=True, wasm_smoke=False,
                javascript_smoke=False, build_wasm=None, pokey_native_parity=False, ps1_native_parity=False,
                application_audio_parity=False, scsp_native_parity=True)
            source = h.helper.work/'tetorica-soundchip-native-0.1.6'
            manifest = {'name': 'tetorica-soundchip-native', 'version': '0.1.6', 'artifacts': selected}
            with self.subTest(selected=selected), patch.object(ps1.checker.argparse.ArgumentParser, 'parse_args', return_value=args), \
                 patch.object(ps1.checker, 'unpack', side_effect=[source, h.helper.work/'wasm']), \
                 patch.object(ps1.checker, 'audit_manifest', return_value=manifest), \
                 patch.object(ps1.checker, 'audit_catalog', return_value=(h.catalog, h.inventory)), \
                 patch.object(ps1.checker, 'audit_local_sources'), patch.object(ps1.checker, 'audit_wasm'), \
                 self.assertRaisesRegex(ps1.checker.AuditError, 'needs supplied or rebuilt SCSP'):
                ps1.checker.main()

    def test_scsp_fixture_uses_resolved_cmake_artifact_and_checks_existence(self):
        h = self.helper
        fixture = h.helper.work/'native Release/tetorica_scsp_fixture.exe'
        fixture.parent.mkdir();fixture.write_bytes(b'fixture')
        with patch.object(ps1.checker, 'prepare_native_build', return_value={'tetorica_scsp_fixture': fixture}), \
             patch.object(ps1.checker, 'command') as commands:
            ps1.checker.build_scsp_fixture(h.root, h.helper.work/'build', {})
        self.assertEqual(commands.call_args_list[-1].args[0], [fixture, '--self-test'])
        fixture.unlink()
        with patch.object(ps1.checker, 'prepare_native_build', return_value={'tetorica_scsp_fixture': fixture}), \
             patch.object(ps1.checker, 'command'), self.assertRaisesRegex(ps1.checker.AuditError, 'was not built'):
            ps1.checker.build_scsp_fixture(h.root, h.helper.work/'build', {})


if __name__ == '__main__':
    unittest.main()
