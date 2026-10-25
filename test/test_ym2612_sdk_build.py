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
ARTIFACTS = ('ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812')
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
YM2608_EXPORTS = [
    '_ym2608_create', '_ym2608_destroy', '_ym2608_reset', '_ym2608_write',
    '_ym2608_read', '_ym2608_read_status', '_ym2608_read_status_hi',
    '_ym2608_get_irq', '_ym2608_sample_rate', '_ym2608_load_adpcm_a_rom',
    '_ym2608_load_adpcm_b_memory', '_ym2608_clear_adpcm_b_memory',
    '_ym2608_generate', '_ym2608_set_source_mute_mask', '_ym2608_save_state',
    '_ym2608_load_state', '_malloc', '_free',
]
YM2610B_EXPORTS = [
    '_ym2610b_create', '_ym2610b_create_variant', '_ym2610b_load_rom',
    '_ym2610b_clear_roms', '_ym2610b_set_source_mute_mask', '_ym2610b_destroy',
    '_ym2610b_reset', '_ym2610b_write', '_ym2610b_read', '_ym2610b_read_status',
    '_ym2610b_read_status_hi', '_ym2610b_get_irq', '_ym2610b_sample_rate',
    '_ym2610b_generate', '_ym2610b_save_state', '_ym2610b_load_state',
    '_malloc', '_free',
]
YM2151_EXPORTS = [
    '_ym2151_create', '_ym2164_create', '_ym2151_destroy', '_ym2151_reset',
    '_ym2151_write', '_ym2151_read', '_ym2151_read_status', '_ym2151_get_irq',
    '_ym2151_sample_rate', '_ym2151_generate', '_ym2151_set_mute_mask',
    '_ym2151_save_state', '_ym2151_load_state', '_malloc', '_free',
]
OKIM6258_EXPORTS = [
    '_okim6258_create', '_okim6258_destroy', '_okim6258_reset',
    '_okim6258_write', '_okim6258_generate', '_okim6258_save_state',
    '_okim6258_load_state', '_malloc', '_free',
]
YM2413_EXPORTS = [
    '_ym2413_create', '_ym2413_destroy', '_ym2413_reset', '_ym2413_write',
    '_ym2413_read', '_ym2413_read_status', '_ym2413_get_irq',
    '_ym2413_sample_rate', '_ym2413_generate', '_ym2413_set_mute_mask',
    '_malloc', '_free',
]
YM3526_EXPORTS = [
    '_ym3526_create', '_ym3526_destroy', '_ym3526_reset', '_ym3526_write',
    '_ym3526_read', '_ym3526_read_status', '_ym3526_get_irq',
    '_ym3526_sample_rate', '_ym3526_set_mute_mask', '_ym3526_generate',
    '_malloc', '_free',
]
YM3812_EXPORTS = [
    '_ym3812_create', '_ym3812_destroy', '_ym3812_reset', '_ym3812_write',
    '_ym3812_read', '_ym3812_read_status', '_ym3812_get_irq',
    '_ym3812_sample_rate', '_ym3812_set_mute_mask', '_ym3812_generate',
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
    runtime_methods = ['cwrap', 'HEAPF32']
    trim_glue = False
    assertions = True
    vendor_sources = YMFM_SOURCES
    core_header = 'vendor/ymfm/ymfm_opn.h'
    include_directories = ['vendor/ymfm']
    support_sources = ['wasm/ymfm_wasm_interface.h', 'vendor/ymfm/ymfm_fm.ipp',
                       'vendor/ymfm/chip_state.h']
    extra_tamper_dependencies = ()

    @property
    def build_script(self):
        return Path('scripts/build_' + self.artifact + '_wasm.sh')

    @property
    def sources(self):
        return ['wasm/' + self.artifact + '_wasm.cpp', *self.vendor_sources]

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
                         ['-I' + name for name in self.include_directories])
        for name in self.sources:
            self.assertTrue((self.sdk / name).is_file())
        # The wrapper/core headers must resolve with the actual SDK include
        # search path, including the separate MAME adaptation when selected.
        manifest = json.loads((self.sdk / 'RELEASE-MANIFEST.json').read_text())
        for header in (self.core_header, 'vendor/ymfm/chip_state.h'):
            self.assertTrue(any((self.sdk / directory / Path(header).name).is_file()
                                for directory in self.include_directories), header)
            # Full snapshot integrity also covers dependencies omitted by a
            # recipe's historical catalog-based build-info input list.
            self.assertEqual(manifest['files'][header]['sha256'],
                             sha256((self.sdk / header).read_bytes()))
        for flag in ('-std=c++14', '-O2', '-sMODULARIZE=1',
                     '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker,node,shell',
                     '-sALLOW_MEMORY_GROWTH=1', '-sEXPORT_ALL=1'):
            self.assertIn(flag, arguments)
        self.assertEqual([value for value in arguments if value.startswith('-sASSERTIONS=')],
                         ['-sASSERTIONS=1'] if self.assertions else [])
        for flag, expected in (('-sEXPORTED_FUNCTIONS=', self.exports),
                               ('-sEXPORTED_RUNTIME_METHODS=', self.runtime_methods),
                               ('-sINCOMING_MODULE_JS_API=', ['wasmBinary'])):
            actual = next(value[len(flag):] for value in arguments if value.startswith(flag))
            self.assertEqual(json.loads(actual), expected)
        javascript = self.artifact + '_wasm.js'
        binary = self.artifact + '_wasm.wasm'
        self.assertEqual(arguments[-2:], ['-o', str(output / javascript)])
        self.assertTrue(Path(arguments[-1]).is_absolute())
        generated = (output / javascript).read_bytes()
        # Selected recipes retain the Perl whitespace cleanup before recording.
        expected_glue = (b'// fake compiler output; not a synthesis test\n'
                         if self.trim_glue
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
        for essential in [*self.sources, *self.support_sources,
                          self.core_header, 'scripts/build-wasm.sh',
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
        for name in (self.core_header, *self.extra_tamper_dependencies,
                     'scripts/record_wasm_build.mjs',
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

    def assert_shared_output_preserves(self, previous_artifacts):
        for artifact in previous_artifacts:
            result = self.build_artifact(artifact)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        output = self.checkout / 'docs/generated'
        previous_records = json.loads((output / 'build-info.json').read_text())['artifacts']
        previous_outputs = {
            name: (output / name).read_bytes()
            for artifact in previous_artifacts
            for name in (artifact + '_wasm.js', artifact + '_wasm.wasm')
        }
        # Rebuilding one chip replaces only its own entry and cannot alter
        # other chips' records or outputs in the shared default directory.
        for _ in range(2):
            result = self.build()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            info = json.loads((output / 'build-info.json').read_text())
            self.assertEqual([entry['id'] for entry in info['artifacts']],
                             sorted([*previous_artifacts, self.artifact]))
            for previous in previous_records:
                self.assertEqual(next(entry for entry in info['artifacts']
                                      if entry['id'] == previous['id']), previous)
            for name, data in previous_outputs.items():
                self.assertEqual((output / name).read_bytes(), data)


class Ym2612SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ym2612'
    exports = YM2612_EXPORTS


class Ym2203SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ym2203'
    exports = YM2203_EXPORTS
    trim_glue = True

    def test_shared_output_preserves_existing_ym2612_build_info(self):
        self.assert_shared_output_preserves(['ym2612'])


class Ym2608SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ym2608'
    exports = YM2608_EXPORTS
    runtime_methods = ['cwrap', 'HEAPF32', 'HEAPU8']

    def test_shared_output_preserves_existing_ym2612_and_ym2203_build_info(self):
        self.assert_shared_output_preserves(['ym2612', 'ym2203'])


class Ym2610bSdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ym2610b'
    exports = YM2610B_EXPORTS
    runtime_methods = ['cwrap', 'HEAPF32', 'HEAPU8']
    trim_glue = True

    def test_shared_output_preserves_all_three_existing_build_records(self):
        self.assert_shared_output_preserves(['ym2612', 'ym2203', 'ym2608'])


class Ym2151SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ym2151'
    exports = YM2151_EXPORTS
    trim_glue = True
    assertions = False
    vendor_sources = ['vendor/ymfm/ymfm_opm.cpp']
    core_header = 'vendor/ymfm/ymfm_opm.h'

    def test_shared_output_preserves_all_four_existing_build_records(self):
        self.assert_shared_output_preserves(['ym2612', 'ym2203', 'ym2608', 'ym2610b'])


class Oki6258SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'okim6258'
    exports = OKIM6258_EXPORTS
    trim_glue = True
    assertions = False
    vendor_sources = ['vendor/mame-okim6258/okim6258.cpp']
    core_header = 'vendor/mame-okim6258/okim6258.h'
    include_directories = ['vendor/ymfm', 'vendor/mame-okim6258']
    support_sources = []
    extra_tamper_dependencies = ('vendor/ymfm/chip_state.h',)

    def test_shared_output_preserves_all_five_existing_build_records(self):
        self.assert_shared_output_preserves(['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151'])


class Ym2413SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ym2413'
    exports = YM2413_EXPORTS
    core_header = 'vendor/ymfm/ymfm_opl.h'

    def test_shared_output_preserves_all_six_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258'])


class Ym3526SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ym3526'
    exports = YM3526_EXPORTS
    assertions = False
    vendor_sources = ['vendor/ymfm/ymfm_opl.cpp', 'vendor/ymfm/ymfm_adpcm.cpp',
                      'vendor/ymfm/ymfm_pcm.cpp']
    core_header = 'vendor/ymfm/ymfm_opl.h'
    support_sources = [*SdkBuildRouteMixin.support_sources, 'vendor/ymfm/ymfm.h',
                       'vendor/ymfm/ymfm_fm.h', 'vendor/ymfm/ymfm_adpcm.h',
                       'vendor/ymfm/ymfm_pcm.h']

    def test_shared_output_preserves_all_seven_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258', 'ym2413'])


class Ym3812SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ym3812'
    exports = YM3812_EXPORTS
    assertions = False
    vendor_sources = ['vendor/ymfm/ymfm_opl.cpp', 'vendor/ymfm/ymfm_adpcm.cpp',
                      'vendor/ymfm/ymfm_pcm.cpp']
    core_header = 'vendor/ymfm/ymfm_opl.h'
    support_sources = [*SdkBuildRouteMixin.support_sources, 'vendor/ymfm/ymfm.h',
                       'vendor/ymfm/ymfm_fm.h', 'vendor/ymfm/ymfm_adpcm.h',
                       'vendor/ymfm/ymfm_pcm.h']

    def test_shared_output_preserves_all_eight_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526'])


if __name__ == '__main__':
    unittest.main()
