"""Check SCSP caller-relative output isolation against the real SDK dispatcher."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SDK = Path('third_party/tetorica-soundchip-native')


@unittest.skipUnless(os.name == 'posix' and shutil.which('sh') and shutil.which('node'),
                     'The shell compiler route requires POSIX sh and Node')
class ScspSdkBuildTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='scsp sdk route ')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name).resolve()
        self.root = self.work / 'checkout with spaces'
        self.caller = self.work / 'external caller'
        self.caller.mkdir()
        shutil.copytree(ROOT / SDK, self.root / SDK)
        scripts = self.root / 'scripts'
        scripts.mkdir()
        for name in ('import_soundchip_sdk.py', 'build_scsp_wasm.sh'):
            shutil.copyfile(ROOT / 'scripts' / name, scripts / name)
        shutil.copyfile(ROOT / 'third_party/soundchip-sdk.json', self.root / 'third_party/soundchip-sdk.json')
        (scripts / 'sync_runtime_artifacts.mjs').write_text('''
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
assert.deepEqual(process.argv.slice(2), ['--only', 'scsp']);
const root = resolve(import.meta.dirname, '..');
const receipt = JSON.parse(await readFile(resolve(root, 'web/generated/build-info.json')));
assert.equal(receipt.artifacts[0].id, 'scsp');
await readFile(resolve(root, 'web/generated/scsp_wasm.wasm'));
await writeFile(resolve(root, 'sync-ran'), 'scsp');
''')
        compiler = self.work / 'recording em++'
        self.log = self.work / 'compiler.jsonl'
        compiler.write_text('#!' + sys.executable + '\n' + '''
import json, os
from pathlib import Path
import sys
args = sys.argv[1:]
if args == ['--version']:
    print('Recording SCSP route fixture; no synthesis performed')
else:
    with open(os.environ['SCSP_COMPILER_LOG'], 'a') as log:
        log.write(json.dumps({'cwd': str(Path.cwd()), 'args': args}) + '\\n')
    target = Path(args[args.index('-o') + 1])
    target.write_text('// recording compiler output')
    target.with_suffix('.wasm').write_bytes(b'\\x00asm\\x01\\x00\\x00\\x00')
''')
        compiler.chmod(0o755)
        self.environment = {**os.environ, 'EMXX': str(compiler), 'SCSP_COMPILER_LOG': str(self.log)}

    def build(self, *args):
        return subprocess.run(['sh', str(self.root / 'scripts/build_scsp_wasm.sh'), *args],
                              cwd=self.caller, env=self.environment, text=True, capture_output=True)

    def assert_sdk_unchanged(self):
        result = subprocess.run(['python3', str(self.root / 'scripts/import_soundchip_sdk.py'), '--check'],
                                cwd=self.caller, env=self.environment, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_relative_custom_output_stays_with_caller_and_does_not_touch_sdk_or_mirrors(self):
        result = self.build('isolated relative output')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        output = self.caller / 'isolated relative output'
        self.assertTrue((output / 'scsp_wasm.js').is_file())
        self.assertTrue((output / 'scsp_wasm.wasm').is_file())
        record = json.loads(self.log.read_text().strip())
        self.assertEqual(record['args'][-2:], ['-o', str(output / 'scsp_wasm.js')])
        self.assertEqual(record['cwd'], str(self.root / SDK))
        self.assertIn(str(self.root / SDK / 'vendor/mame-scsp/scsp_instrument.cpp'), record['args'])
        self.assertFalse((self.root / 'sync-ran').exists())
        self.assertFalse((self.root / 'web').exists())
        self.assertFalse((self.root / 'docs').exists())
        self.assertFalse((self.root / SDK / 'isolated relative output').exists())
        self.assert_sdk_unchanged()

    def test_default_build_uses_canonical_path_and_publishes_after_receipt(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.root / 'web/generated/scsp_wasm.js').is_file())
        self.assertTrue((self.root / 'web/generated/scsp_wasm.wasm').is_file())
        self.assertEqual((self.root / 'sync-ran').read_text(), 'scsp')
        self.assert_sdk_unchanged()


if __name__ == '__main__':
    unittest.main()
