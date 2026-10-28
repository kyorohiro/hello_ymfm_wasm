"""PS1 standalone category/provenance regressions; synthetic local input only."""
import argparse
import copy
import io
from contextlib import redirect_stdout
from unittest.mock import patch
import hashlib
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import sdk_common
import check_standalone_release as checker
import test_standalone_release as legacy
ROOT = Path(__file__).resolve().parents[1]

class Ps1InstrumentReleaseTests(unittest.TestCase):
    def setUp(self):
        self.helper = legacy.ReleaseAuditTests(methodName='runTest')
        self.helper.setUp(); self.addCleanup(self.helper.doCleanups)
        self.root = self.helper.root
        self.catalog, self.inventory = self.helper.fixture()
        self.native = json.loads((self.root/'catalog/native_inventory.json').read_text())
        self.helper.write('sdk.json', json.dumps({'name':'tetorica-soundchip-native','version':'0.1.6'}))
        for name, document in [('source_inventory',self.inventory),('native_inventory',self.native),('chips',self.catalog)]:
            document['instruments'] = json.loads((ROOT/f'catalog/{name}.json').read_text())['instruments']
        record = self.inventory['instruments'][0]; device = self.native['instruments'][0]
        for name in set(record['sourceFiles']+record['licenseFiles']+record['buildFiles']+device['sourceFiles']+device['licenseFiles']+device['buildFiles']+[device['publicHeader']]):
            self.helper.write(name, 'Fixture '+name+'\n')
        self.inventory['components'].append({'id':'fixture-ps1','sourceFiles':record['sourceFiles'],'licenseFiles':record['licenseFiles'],
            'files':[{'path':name,'originPath':name,'sha256':hashlib.sha256((self.root/name).read_bytes()).hexdigest()}
                     for name in record['sourceFiles']+record['licenseFiles']]})
        self.save()
    def save(self):
        for name, value in [('source_inventory',self.inventory),('native_inventory',self.native),('chips',self.catalog)]:
            self.helper.write('catalog/'+name+'.json',json.dumps(value))
    def rejected(self, message):
        self.save()
        with self.assertRaisesRegex(ValueError,message): sdk_common.check_collection(self.root)
        with self.assertRaisesRegex(checker.AuditError,message): checker.audit_catalog(self.root)
    def test_separate_ps1_instrument_retains_24_generic_chip_ids(self):
        self.assertEqual(sdk_common.check_collection(self.root)['instruments'],1)
        catalog,inventory=checker.audit_catalog(self.root)
        self.assertEqual({c['id'] for c in catalog['chips']},sdk_common.CHIP_IDS)
        self.assertEqual({a['id'] for a in inventory['artifacts']},checker.REQUIRED_ARTIFACTS)
        self.assertNotIn('ps1_spu',sdk_common.CHIP_IDS)
    def test_new_sdk_cannot_drop_the_instrument_from_all_catalogs(self):
        for doc in [self.inventory,self.native,self.catalog]: doc['instruments']=[]
        self.save()
        with self.assertRaisesRegex(ValueError,'inventory'): sdk_common.check_collection(self.root)
        with self.assertRaisesRegex(checker.AuditError,'inventory'): checker.audit_catalog(self.root)
    def test_duplicate_native_record_is_rejected(self):
        self.native['instruments'].append(copy.deepcopy(self.native['instruments'][0]));self.rejected('inventory')
    def test_ps1_cannot_claim_a_generic_chip_factory_id(self):
        self.inventory['instruments'][0]['chipIds']=['ym2612'];self.rejected('separate instrument API')
    def test_invalid_role_and_format_are_rejected(self):
        record=self.inventory['instruments'][0]
        for key,value in [('role','application-audio'),('format','standalone-audio-wasm')]:
            original=record[key];record[key]=value
            with self.subTest(field=key):self.rejected('separate instrument API')
            record[key]=original
    def test_native_target_and_header_cannot_be_substituted(self):
        for key,value in [('target','tetorica_native_snes'),('publicHeader','native/include/tetorica/cdda.h')]:
            original=self.native['instruments'][0][key];self.native['instruments'][0][key]=value
            self.catalog['instruments'][0]['native']=copy.deepcopy(self.native['instruments'][0])
            with self.subTest(field=key):self.rejected('Native target/header')
            self.native['instruments'][0][key]=original
            self.catalog['instruments'][0]['native']=copy.deepcopy(self.native['instruments'][0])
    def test_public_catalog_must_match_native_contract(self):
        self.catalog['instruments'][0]['native']['status']='source-only';self.rejected('catalogs differ')
    def test_unhashed_source_cannot_be_silently_included(self):
        component=self.inventory['components'][-1];component['files']=component['files'][1:]
        self.rejected('hash provenance')
    def test_source_hash_changes_are_detected(self):
        name=self.inventory['instruments'][0]['sourceFiles'][0];(self.root/name).write_bytes(b'changed')
        self.save()
        with self.assertRaisesRegex(ValueError,'checksum mismatch'): sdk_common.check_collection(self.root)
        with self.assertRaisesRegex(checker.AuditError,'hash mismatch'): checker.audit_catalog(self.root)
    def test_missing_license_is_rejected(self):
        (self.root/self.inventory['instruments'][0]['licenseFiles'][0]).unlink()
        self.save()
        with self.assertRaisesRegex(ValueError,'Missing collection file'): sdk_common.check_collection(self.root)
        with self.assertRaisesRegex(checker.AuditError,'reference|Missing imported source'): checker.audit_catalog(self.root)

    def test_ps1_parity_request_rejects_missing_or_unrelated_wasm(self):
        for index, selected in enumerate([[], ['ym2612']]):
            args=argparse.Namespace(source_zip=self.helper.work/'source.zip',wasm_zip=self.helper.work/'wasm.zip' if selected else None,
                work_dir=self.helper.work/f'parity-admission-{index}',audit_only=True,wasm_smoke=False,javascript_smoke=False,
                build_wasm=None,pokey_native_parity=False,application_audio_parity=False,ps1_native_parity=True)
            source=self.helper.work/'tetorica-soundchip-native-0.1.6'
            manifest={'name':'tetorica-soundchip-native','version':'0.1.6','artifacts':selected}
            with self.subTest(artifacts=selected), \
                 patch.object(checker.argparse.ArgumentParser,'parse_args',return_value=args), \
                 patch.object(checker,'unpack',side_effect=[source,self.helper.work/'wasm']), \
                 patch.object(checker,'audit_manifest',return_value=manifest), \
                 patch.object(checker,'audit_catalog',return_value=(self.catalog,self.inventory)), \
                 patch.object(checker,'audit_local_sources'),patch.object(checker,'audit_wasm'), \
                 self.assertRaisesRegex(checker.AuditError,'needs supplied or rebuilt PS1 SPU'):
                checker.main()
    def test_ps1_parity_fixture_uses_the_discovered_executable(self):
        fixture=self.helper.work/'native Release'/'tetorica_ps1_spu_fixture.exe'
        fixture.parent.mkdir();fixture.write_bytes(b'fixture executable')
        with patch.object(checker,'prepare_native_build',return_value={'tetorica_ps1_spu_fixture':fixture}), \
             patch.object(checker,'command') as commands:
            result=checker.build_ps1_fixture(self.root,self.helper.work/'build',{})
        self.assertEqual(result['tetorica_ps1_spu_fixture'],fixture)
        self.assertEqual(commands.call_args_list[0].args[0][-3:],['tetorica_ps1_spu_fixture','--parallel','2'])
        self.assertEqual(commands.call_args_list[1].args[0],[fixture,'--self-test'])
    def test_ps1_parity_fixture_must_actually_exist_after_build(self):
        fixture=self.helper.work/'missing.exe'
        with patch.object(checker,'prepare_native_build',return_value={'tetorica_ps1_spu_fixture':fixture}), \
             patch.object(checker,'command'),self.assertRaisesRegex(checker.AuditError,'was not built'):
            checker.build_ps1_fixture(self.root,self.helper.work/'build',{})

if __name__ == '__main__': unittest.main()
