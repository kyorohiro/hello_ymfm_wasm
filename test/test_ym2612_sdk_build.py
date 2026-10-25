"""Check the offline build route with a recording compiler, not audio synthesis."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SDK_PATH = Path('third_party/tetorica-soundchip-native')
ARTIFACTS = ('ym2612', 'ym2203')
IMPORT_SCRIPT = Path('scripts/import_soundchip_sdk.py')
RECEIPT = Path('third_party/soundchip-sdk.json')
YM2612_EXPORTS = [
    '_ym2612_create', '_ym2612_destroy', '_ym2612_reset', '_ym2612_write',
    '_ym2612_read', '_ym2612_read_status', '_ym2612_get_irq',
    '_ym2612_sample_rate', '_ym2612_generate',
    '_ym2612_generate_with_internal_envelope', '_ym2612_save_state',
    '_ym2612_load_state', '_malloc', '_free',
]
YM2203_EXPORTS = [
    '_ym2203_create', '_ym2203_destroy', '_ym2203_reset', '_ym2203_write',
    '_ym2203_read', '_ym2203_read_status', '_ym2203_get_irq',
    '_ym2203_sample_rate', '_ym2203_generate', '_ym2203_set_mute_mask',
    '_ym2203_set_source_mute_mask', '_ym2203_save_state', '_ym2203_load_state',
    '_malloc', '_free',
]
YMFM_SOURCES = [
    'vendor/ymfm/ymfm_' + chip + '.cpp'
    for chip in ('adpcm', 'misc', 'opl', 'opm', 'opn', 'opq', 'opz', 'pcm', 'ssg')
]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


@unittest.skipUnless(os.name == 'posix' and shutil.which('sh') and shutil.which('node'),
                     'These shell-route integration tests require POSIX sh and Node')
class SdkBuildRouteMixin:
    @property
    def build_script(self):
        return Path('scripts/build_' + self.artifact + '_wasm.sh')

    @property
    def sources(self):
        return ['wasm/' + self.artifact + '_wasm.cpp', *YMFM_SOURCES]

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='tetorica sdk build ')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name).resolve()
        self.checkout = self.work / 'fresh checkout'
        self.caller = self.work / 'external caller'
        self.caller.mkdir()
        build_scripts = [Path('scripts/build_' + artifact + '_wasm.sh') for artifact in ARTIFACTS]
        for name in (*build_scripts, IMPORT_SCRIPT, RECEIPT):
            target = self.checkout / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        shutil.copytree(ROOT / SDK_PATH, self.checkout / SDK_PATH)
        self.sdk = self.checkout / SDK_PATH

        # The build gets only its actual host tools. Git, npm, downloaders and
        # an installed Emscripten compiler cannot accidentally satisfy a test.
        tools = self.work / 'host tools'
        tools.mkdir()
        for name in ('sh', 'python3', 'node', 'dirname', 'mkdir', 'perl'):
            command = shutil.which(name)
            self.assertIsNotNone(command, 'Missing host tool: ' + name)
            (tools / name).symlink_to(command)
        compiler = self.work / 'compiler with spaces' / 'fake em++'
        compiler.parent.mkdir()
        compiler.write_text('''#!/usr/bin/env python3
import json, os
from pathlib import Path
import sys
args = sys.argv[1:]
with open(os.environ['SDK_FAKE_COMPILER_LOG'], 'a') as log:
    log.write(json.dumps({'cwd': os.getcwd(), 'args': args}) + '\\n')
if args == ['--version']:
    print('Fake Emscripten SDK build-route test 1.0')
else:
    output = Path(args[args.index('-o') + 1])
    output.write_text('// fake compiler output; not a synthesis test \\t  \\n')
    output.with_suffix('.wasm').write_bytes(b'\\x00asm\\x01\\x00\\x00\\x00')
''')
        compiler.chmod(0o755)
        self.log = self.work / 'compiler calls.jsonl'
        self.environment = {**os.environ, 'PATH': str(tools), 'EMXX': str(compiler),
                            'SDK_FAKE_COMPILER_LOG': str(self.log),
                            'PYTHONDONTWRITEBYTECODE': '1'}
        self.assertIsNone(shutil.which('git', path=self.environment['PATH']))
        self.assertIsNone(shutil.which('em++', path=self.environment['PATH']))
        self.assertEqual({path.name for path in self.checkout.iterdir()},
                         {'scripts', 'third_party'})
        for old_source in ('src', 'wasm', 'w', '.git', 'node_modules'):
            self.assertFalse((self.checkout / old_source).exists())

    def build(self, *arguments):
        return self.build_artifact(self.artifact, *arguments)

    def build_artifact(self, artifact, *arguments):
        script = Path('scripts/build_' + artifact + '_wasm.sh')
        return subprocess.run(['sh', str(self.checkout / script), *arguments],
                              cwd=self.caller, env=self.environment,
                              capture_output=True, text=True)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_external_caller_relative_output_uses_only_sdk_and_records_real_hashes(self):
        result = self.build('relative output')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        pin = json.loads((self.checkout / RECEIPT).read_text())
        self.assertIn(str(pin['fileCount']) + ' pinned files verified offline', result.stdout)
        output = self.caller / 'relative output'
        self.assertFalse((self.checkout / 'relative output').exists())
        compile_call, version_call = self.calls()
        self.assertEqual(compile_call['cwd'], str(self.sdk))
        self.assertEqual(version_call['cwd'], str(self.sdk))
        self.assertEqual(version_call['args'], ['--version'])
        arguments = compile_call['args']
        self.assertEqual([value for value in arguments if value.endswith('.cpp')], self.sources)
        self.assertEqual([value for value in arguments if value.startswith('-I')],
                         ['-Ivendor/ymfm'])
        for name in self.sources:
            self.assertTrue((self.sdk / name).is_file())
        for flag in ('-std=c++14', '-O2', '-sASSERTIONS=1', '-sMODULARIZE=1',
                     '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker,node,shell',
                     '-sALLOW_MEMORY_GROWTH=1', '-sEXPORT_ALL=1'):
            self.assertIn(flag, arguments)
        for flag, expected in (('-sEXPORTED_FUNCTIONS=', self.exports),
                               ('-sEXPORTED_RUNTIME_METHODS=', ['cwrap', 'HEAPF32']),
                               ('-sINCOMING_MODULE_JS_API=', ['wasmBinary'])):
            actual = next(value[len(flag):] for value in arguments if value.startswith(flag))
            self.assertEqual(json.loads(actual), expected)
        javascript = self.artifact + '_wasm.js'
        binary = self.artifact + '_wasm.wasm'
        self.assertEqual(arguments[-2:], ['-o', str(output / javascript)])
        self.assertTrue(Path(arguments[-1]).is_absolute())
        generated = (output / javascript).read_bytes()
        # Only the YM2203 recipe applies the retained Perl whitespace cleanup.
        expected_glue = (b'// fake compiler output; not a synthesis test\n'
                         if self.artifact == 'ym2203'
                         else b'// fake compiler output; not a synthesis test \t  \n')
        self.assertEqual(generated, expected_glue)

        info = json.loads((output / 'build-info.json').read_text())
        self.assertEqual(info['schemaVersion'], 1)
        self.assertEqual(len(info['artifacts']), 1)
        artifact = info['artifacts'][0]
        self.assertEqual(artifact['id'], self.artifact)
        self.assertEqual(artifact['format'], 'emscripten-es-module')
        self.assertEqual(artifact['compiler'], {
            'command': self.environment['EMXX'],
            'version': 'Fake Emscripten SDK build-route test 1.0'})
        inventory = json.loads((self.sdk / 'catalog/source_inventory.json').read_text())
        recipe = next(entry for entry in inventory['artifacts'] if entry['id'] == self.artifact)
        expected_inputs = sorted(set(recipe['sourceFiles'] + recipe['buildFiles']))
        self.assertEqual([entry['path'] for entry in artifact['sourceFiles']], expected_inputs)
        for essential in [*self.sources, 'wasm/ymfm_wasm_interface.h',
                          'vendor/ymfm/chip_state.h', 'vendor/ymfm/ymfm_fm.ipp',
                          'vendor/ymfm/ymfm_opn.h', 'scripts/build-wasm.sh',
                          self.build_script.as_posix(), 'scripts/record_wasm_build.mjs']:
            self.assertIn(essential, expected_inputs)
        for entry in artifact['sourceFiles']:
            data = (self.sdk / entry['path']).read_bytes()
            self.assertEqual(entry['sha256'], sha256(data))
            self.assertEqual(entry['size'], len(data))
        # Match JSON.stringify's compact format used by the actual SDK recorder.
        fingerprint = sha256(json.dumps(artifact['sourceFiles'], separators=(',', ':')).encode())
        self.assertEqual(artifact['sourceFingerprint'], fingerprint)
        self.assertEqual({entry['path'] for entry in artifact['outputs']},
                         {javascript, binary})
        for entry in artifact['outputs']:
            data = (output / entry['path']).read_bytes()
            self.assertEqual(entry['sha256'], sha256(data))
            self.assertEqual(entry['size'], len(data))

    def test_default_output_is_in_fresh_checkout_and_does_not_modify_pinned_sdk(self):
        for _ in range(2):
            result = self.build()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        output = self.checkout / 'docs/generated'
        self.assertTrue((output / (self.artifact + '_wasm.js')).is_file())
        self.assertTrue((output / (self.artifact + '_wasm.wasm')).is_file())
        info = json.loads((output / 'build-info.json').read_text())
        self.assertEqual([entry['id'] for entry in info['artifacts']], [self.artifact])
        self.assertFalse((self.caller / 'docs').exists())
        self.assertEqual(len(self.calls()), 4)
        result = subprocess.run(['python3', str(self.checkout / IMPORT_SCRIPT), '--check'],
                                cwd=self.caller, env=self.environment,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(self.calls()), 4)

    def test_tampered_sdk_is_rejected_before_compiler_or_output_creation(self):
        for name in ('vendor/ymfm/ymfm_opn.h', 'scripts/record_wasm_build.mjs',
                     'wasm/' + self.artifact + '_wasm.cpp', self.build_script.as_posix()):
            with self.subTest(name=name):
                path = self.sdk / name
                original = path.read_bytes()
                try:
                    path.write_bytes(original + b'\n// unpinned downstream edit\n')
                    result = self.build('rejected output')
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('hash/size mismatch: ' + name, result.stdout + result.stderr)
                    self.assertFalse(self.log.exists())
                    self.assertFalse((self.caller / 'rejected output').exists())
                finally:
                    path.write_bytes(original)


class Ym2612SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ym2612'
    exports = YM2612_EXPORTS


class Ym2203SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ym2203'
    exports = YM2203_EXPORTS

    def test_shared_output_preserves_existing_ym2612_build_info(self):
        result = self.build_artifact('ym2612')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        output = self.checkout / 'docs/generated'
        initial = json.loads((output / 'build-info.json').read_text())['artifacts'][0]
        original_glue = (output / 'ym2612_wasm.js').read_bytes()
        original_wasm = (output / 'ym2612_wasm.wasm').read_bytes()
        # The second YM2203 build replaces only its own entry, without adding
        # duplicate records or changing the previously built YM2612 artifact.
        for _ in range(2):
            result = self.build()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            info = json.loads((output / 'build-info.json').read_text())
            self.assertEqual([entry['id'] for entry in info['artifacts']], ['ym2203', 'ym2612'])
            self.assertEqual(next(entry for entry in info['artifacts']
                                  if entry['id'] == 'ym2612'), initial)
            self.assertEqual((output / 'ym2612_wasm.js').read_bytes(), original_glue)
            self.assertEqual((output / 'ym2612_wasm.wasm').read_bytes(), original_wasm)


if __name__ == '__main__':
    unittest.main()
