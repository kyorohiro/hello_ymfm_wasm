"""Check the offline build route with a recording compiler, not audio synthesis."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SDK_PATH = Path('third_party/tetorica-soundchip-native')
ARTIFACTS = ('ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg', 'rf5c164', 'pwm32x', 'huc6280', 'gameboy_apu', 'nesapu',
             'spc', 'segapcm', 'k051649', 'ym3438', 'ymf276', 'ymf288', 'ymf278b',
             'nuked_opn2')
IMPORT_SCRIPT = Path('scripts/import_soundchip_sdk.py')
RECEIPT = Path('third_party/soundchip-sdk.json')
YM2612_EXPORTS = [
    '_ym2612_create', '_ym2612_destroy', '_ym2612_reset', '_ym2612_write',
    '_ym2612_read', '_ym2612_read_status', '_ym2612_get_irq',
    '_ym2612_sample_rate', '_ym2612_generate',
    '_ym2612_generate_with_internal_envelope', '_ym2612_save_state',
    '_ym2612_load_state', '_malloc', '_free',
]
OPN_VARIANT_EXPORTS = [
    '_opn_create', '_opn_destroy', '_opn_reset', '_opn_write', '_opn_read',
    '_opn_read_status', '_opn_get_irq', '_opn_sample_rate', '_opn_generate',
    '_malloc', '_free',
]
NUKED_OPN2_EXPORTS = [
    '_ym2612_create', '_ym2612_destroy', '_ym2612_reset', '_ym2612_write',
    '_ym2612_read', '_ym2612_read_status', '_ym2612_get_irq',
    '_ym2612_sample_rate', '_ym2612_generate',
    '_ym2612_generate_with_internal_envelope', '_malloc', '_free',
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
YMF262_EXPORTS = [
    '_ymf262_create', '_ymf262_destroy', '_ymf262_reset', '_ymf262_write',
    '_ymf262_read', '_ymf262_read_status', '_ymf262_get_irq',
    '_ymf262_sample_rate', '_ymf262_generate', '_ymf262_set_mute_mask',
    '_malloc', '_free',
]
YMF278B_EXPORTS = [
    '_ymf278b_create', '_ymf278b_destroy', '_ymf278b_reset', '_ymf278b_write',
    '_ymf278b_read', '_ymf278b_read_status', '_ymf278b_get_irq',
    '_ymf278b_sample_rate', '_ymf278b_set_fm_mute_mask',
    '_ymf278b_set_pcm_mute_mask', '_ymf278b_generate', '_ymf278b_load_memory',
    '_ymf278b_clear_memory', '_malloc', '_free',
]
Y8950_EXPORTS = [
    '_y8950_set_mute_mask', '_y8950_create', '_y8950_destroy', '_y8950_reset',
    '_y8950_write', '_y8950_read', '_y8950_read_status', '_y8950_get_irq',
    '_y8950_sample_rate', '_y8950_generate', '_y8950_load_memory',
    '_y8950_clear_memory', '_malloc', '_free',
]
AY8910_EXPORTS = [
    '_ay8910_create', '_ay8910_destroy', '_ay8910_reset', '_ay8910_write',
    '_ay8910_read', '_ay8910_sample_rate', '_ay8910_set_mute_mask',
    '_ay8910_generate', '_malloc', '_free',
]
SEGAPSG_EXPORTS = [
    '_segapsg_create', '_segapsg_destroy', '_segapsg_reset', '_segapsg_write',
    '_segapsg_set_mute_mask', '_segapsg_set_stereo', '_segapsg_sample_rate',
    '_segapsg_generate', '_segapsg_save_state', '_segapsg_load_state',
    '_malloc', '_free',
]
RF5C164_EXPORTS = [
    '_rf5c164_create', '_rf5c164_destroy', '_rf5c164_reset', '_rf5c164_write',
    '_rf5c164_sample_rate', '_rf5c164_generate', '_rf5c164_clear_memory',
    '_rf5c164_write_memory', '_rf5c164_read_memory', '_rf5c164_read',
    '_rf5c164_load', '_rf5c164_bank', '_rf5c164_save_state',
    '_rf5c164_load_state', '_malloc', '_free',
]
PWM32X_EXPORTS = [
    '_pwm32x_create', '_pwm32x_destroy', '_pwm32x_reset', '_pwm32x_write',
    '_pwm32x_read', '_pwm32x_generate', '_pwm32x_set_clock', '_pwm32x_set_gain',
    '_pwm32x_set_output_mode', '_pwm32x_set_muted', '_pwm32x_tick',
    '_pwm32x_configure_timer', '_pwm32x_active', '_pwm32x_get', '_pwm32x_set',
    '_pwm32x_fifo_count', '_pwm32x_fifo_get', '_pwm32x_fifo_set',
    '_pwm32x_state_size', '_pwm32x_save_state', '_pwm32x_load_state',
    '_malloc', '_free',
]
HUC6280_EXPORTS = [
    '_huc6280_create', '_huc6280_destroy', '_huc6280_reset', '_huc6280_mute',
    '_huc6280_write', '_huc6280_generate', '_malloc', '_free',
]
GAMEBOY_APU_EXPORTS = [
    '_gameboy_apu_create', '_gameboy_apu_destroy', '_gameboy_apu_reset',
    '_gameboy_apu_write', '_gameboy_apu_sample_rate', '_gameboy_apu_set_mute_mask',
    '_gameboy_apu_generate', '_gameboy_apu_save_state', '_gameboy_apu_load_state',
    '_malloc', '_free',
]
NESAPU_EXPORTS = [
    '_native_nes_create', '_native_nes_destroy', '_native_nes_reset',
    '_native_nes_stop', '_native_nes_write', '_native_nes_enable',
    '_native_nes_load', '_native_nes_set_mute', '_native_nes_set_clock',
    '_native_nes_sample', '_native_nes_get_state', '_native_nes_read_memory',
    '_nesapu_generate', '_nesapu_state_size', '_nesapu_state_field_count',
    '_nesapu_state_offset', '_malloc', '_free',
]
SPC_EXPORTS = [
    '_spc_create', '_spc_destroy', '_spc_error', '_spc_load', '_spc_restart',
    '_spc_render', '_spc_left_ptr', '_spc_right_ptr', '_spc_native_frames',
    '_spc_set_mute_mask', '_spc_snapshot_ptr', '_spc_load_ram',
    '_spc_write_dsp', '_spc_read_dsp', '_spc_trace_begin', '_spc_trace_finish',
    '_spc_trace_initial_ptr', '_spc_trace_events_ptr', '_spc_trace_event_count',
    '_spc_ram_read_begin', '_spc_ram_read_finish', '_spc_ram_read_mask_ptr',
    '_spc_observer_begin', '_spc_observer_stop', '_spc_observer_ptr',
    '_spc_observer_drain', '_spc_observer_lost', '_spc_observer_registers_ptr',
    '_spc_load_timeline', '_spc_restart_timeline', '_spc_timeline_total_frames',
    '_malloc', '_free',
]
SEGAPCM_EXPORTS = [
    '_segapcm_create', '_segapcm_destroy', '_segapcm_reset', '_segapcm_write',
    '_segapcm_load_memory', '_segapcm_clear_memory', '_segapcm_sample_rate',
    '_segapcm_set_mute_mask', '_segapcm_generate', '_segapcm_save_state',
    '_segapcm_load_state', '_malloc', '_free',
]
K051649_EXPORTS = [
    '_k051649_create', '_k051649_destroy', '_k051649_reset', '_k051649_write',
    '_k051649_sample_rate', '_k051649_set_mute_mask', '_k051649_generate',
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
    incoming_module_api = ['wasmBinary']
    language_standard = 'c++14'
    compiler_variable = 'EMXX'
    environments = 'web,worker,node,shell'
    export_all = True
    trim_glue = False
    assertions = True
    vendor_sources = YMFM_SOURCES
    core_header = 'vendor/ymfm/ymfm_opn.h'
    include_directories = ['vendor/ymfm']
    quoted_header_directories = ()
    floating_point_flags = []
    additional_behavior_flags = []
    compile_definitions = []
    wrapper_source = None
    support_sources = ['wasm/ymfm_wasm_interface.h', 'vendor/ymfm/ymfm_fm.ipp',
                       'vendor/ymfm/chip_state.h']
    extra_manifest_headers = ('vendor/ymfm/chip_state.h',)
    extra_tamper_dependencies = ()
    verify_quoted_header_dependencies = False
    disabled_optional_includes = {}

    @property
    def build_script(self):
        return Path('scripts/build_' + self.artifact + '_wasm.sh')

    @property
    def sources(self):
        wrapper = self.wrapper_source or 'wasm/' + self.artifact + '_wasm.cpp'
        return [wrapper, *self.vendor_sources]

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
    log.write(json.dumps({'cwd': os.getcwd(), 'args': args,
                         'compiler': Path(sys.argv[0]).name}) + '\\n')
if args == ['--version']:
    print('Fake Emscripten SDK build-route test 1.0')
else:
    output = Path(args[args.index('-o') + 1])
    output.write_text('// fake compiler output; not a synthesis test \\t  \\n')
    output.with_suffix('.wasm').write_bytes(b'\\x00asm\\x01\\x00\\x00\\x00')
''')
        compiler.chmod(0o755)
        c_compiler = compiler.with_name('fake emcc')
        shutil.copyfile(compiler, c_compiler)
        c_compiler.chmod(0o755)
        self.log = self.work / 'compiler calls.jsonl'
        self.environment = {**os.environ, 'PATH': str(tools), 'EMXX': str(compiler),
                            'EMCC': str(c_compiler),
                            'SDK_FAKE_COMPILER_LOG': str(self.log),
                            'PYTHONDONTWRITEBYTECODE': '1'}
        self.assertIsNone(shutil.which('git', path=self.environment['PATH']))
        self.assertIsNone(shutil.which('em++', path=self.environment['PATH']))
        self.assertIsNone(shutil.which('emcc', path=self.environment['PATH']))
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
        expected_compiler = Path(self.environment[self.compiler_variable]).name
        self.assertEqual(compile_call['compiler'], expected_compiler)
        self.assertEqual(version_call['compiler'], expected_compiler)
        arguments = compile_call['args']
        self.assertEqual([value for value in arguments
                          if Path(value).suffix in ('.c', '.cc', '.cpp')], self.sources)
        self.assertEqual([value for value in arguments if value.startswith('-I')],
                         ['-I' + name for name in self.include_directories])
        for name in self.sources:
            self.assertTrue((self.sdk / name).is_file())
        # The wrapper/core headers must resolve with the actual SDK include
        # search path, including the separate MAME adaptation when selected.
        manifest = json.loads((self.sdk / 'RELEASE-MANIFEST.json').read_text())
        for header in (self.core_header, *self.extra_manifest_headers):
            self.assertTrue(any((self.sdk / directory / Path(header).name).is_file()
                                for directory in (*self.include_directories,
                                                  *self.quoted_header_directories)), header)
            # Full snapshot integrity also covers dependencies omitted by a
            # recipe's historical catalog-based build-info input list.
            self.assertEqual(manifest['files'][header]['sha256'],
                             sha256((self.sdk / header).read_bytes()))
        if self.verify_quoted_header_dependencies:
            # Follow every quoted include from each actual translation unit;
            # nested upstream headers must resolve from the recipe's paths.
            pending = list(self.sources)
            visited = set()
            while pending:
                source = pending.pop()
                if source in visited:
                    continue
                visited.add(source)
                text = (self.sdk / source).read_text()
                for include in re.findall(r'^\s*#\s*include\s*"([^"]+)"', text, re.M):
                    macro = self.disabled_optional_includes.get((source, include))
                    if macro:
                        self.assertRegex(text, r'#ifdef\s+' + re.escape(macro)
                                         + r'\s*#include\s*"' + re.escape(include)
                                         + r'"\s*#endif')
                        self.assertFalse(any(value == '-D' + macro
                                             or value.startswith('-D' + macro + '=')
                                             for value in arguments), macro)
                        continue
                    candidates = [Path(source).parent / include,
                                  *(Path(directory) / include
                                    for directory in self.include_directories)]
                    dependency = next((path.as_posix() for path in candidates
                                       if (self.sdk / path).is_file()), None)
                    self.assertIsNotNone(dependency, source + ': ' + include)
                    self.assertEqual(manifest['files'][dependency]['sha256'],
                                     sha256((self.sdk / dependency).read_bytes()))
                    pending.append(dependency)
        for flag in ('-O2', '-sMODULARIZE=1',
                     '-sEXPORT_ES6=1', '-sENVIRONMENT=' + self.environments,
                     '-sALLOW_MEMORY_GROWTH=1'):
            self.assertIn(flag, arguments)
        self.assertEqual([value for value in arguments if value.startswith('-std=')],
                         ['-std=' + self.language_standard])
        self.assertEqual([value for value in arguments if value.startswith('-D')],
                         self.compile_definitions)
        self.assertEqual([value for value in arguments if value.startswith('-ffp-contract=')],
                         self.floating_point_flags)
        self.assertEqual([value for value in arguments
                          if value in ('-fwrapv', '-fno-strict-aliasing', '-fexceptions')
                          or value.startswith('-sDISABLE_EXCEPTION_CATCHING=')],
                         self.additional_behavior_flags)
        self.assertEqual([value for value in arguments if value.startswith('-sEXPORT_ALL=')],
                         ['-sEXPORT_ALL=1'] if self.export_all else [])
        self.assertEqual([value for value in arguments if value.startswith('-sASSERTIONS=')],
                         ['-sASSERTIONS=1'] if self.assertions else [])
        for flag, expected in (('-sEXPORTED_FUNCTIONS=', self.exports),
                               ('-sEXPORTED_RUNTIME_METHODS=', self.runtime_methods),
                               ('-sINCOMING_MODULE_JS_API=', self.incoming_module_api)):
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
            'command': self.environment[self.compiler_variable],
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
                     self.sources[0], self.build_script.as_posix()):
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


class Ymf262SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ymf262'
    exports = YMF262_EXPORTS
    assertions = False
    vendor_sources = ['vendor/ymfm/ymfm_opl.cpp', 'vendor/ymfm/ymfm_adpcm.cpp',
                      'vendor/ymfm/ymfm_pcm.cpp']
    core_header = 'vendor/ymfm/ymfm_opl.h'
    support_sources = [*SdkBuildRouteMixin.support_sources, 'vendor/ymfm/ymfm.h',
                       'vendor/ymfm/ymfm_fm.h', 'vendor/ymfm/ymfm_adpcm.h',
                       'vendor/ymfm/ymfm_pcm.h']

    def test_shared_output_preserves_all_nine_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812'])


class Y8950SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'y8950'
    exports = Y8950_EXPORTS
    assertions = False
    runtime_methods = ['cwrap', 'HEAPF32', 'HEAPU8']
    vendor_sources = ['vendor/ymfm/ymfm_opl.cpp', 'vendor/ymfm/ymfm_adpcm.cpp',
                      'vendor/ymfm/ymfm_pcm.cpp']
    core_header = 'vendor/ymfm/ymfm_opl.h'
    support_sources = [*SdkBuildRouteMixin.support_sources, 'vendor/ymfm/ymfm.h',
                       'vendor/ymfm/ymfm_fm.h', 'vendor/ymfm/ymfm_adpcm.h',
                       'vendor/ymfm/ymfm_pcm.h']

    def test_shared_output_preserves_all_ten_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262'])


class Ay8910SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ay8910'
    exports = AY8910_EXPORTS
    language_standard = 'c++17'
    export_all = False
    assertions = False
    vendor_sources = ['vendor/mame-ay8910/ay8910.cpp']
    core_header = 'vendor/mame-ay8910/ay8910.h'
    include_directories = ['vendor/mame-ay8910']
    support_sources = []
    extra_manifest_headers = ()

    def test_shared_output_preserves_all_eleven_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950'])


class SegaPsgSdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'segapsg'
    exports = SEGAPSG_EXPORTS
    vendor_sources = ['vendor/ymfm/segapsg.cpp']
    core_header = 'vendor/ymfm/segapsg.h'
    support_sources = ['vendor/ymfm/chip_state.h']

    def test_shared_output_preserves_all_twelve_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910'])


class Rf5c164SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'rf5c164'
    exports = RF5C164_EXPORTS
    runtime_methods = ['cwrap', 'HEAPF32', 'HEAPU8']
    vendor_sources = ['vendor/mame-rf5c164/rf5c164.cpp']
    core_header = 'vendor/mame-rf5c164/rf5c164.h'
    include_directories = ['vendor/ymfm', 'vendor/mame-rf5c164']
    # This pinned historical catalog omits the real chip_state.h dependency;
    # full-manifest checks and the explicit corruption case still protect it.
    support_sources = []
    extra_tamper_dependencies = ('vendor/ymfm/chip_state.h',)

    def test_shared_output_preserves_all_thirteen_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg'])


class Pwm32xSdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'pwm32x'
    exports = PWM32X_EXPORTS
    runtime_methods = ['cwrap', 'HEAPU8', 'HEAPU16', 'HEAPF32']
    export_all = False
    assertions = False
    floating_point_flags = ['-ffp-contract=off']
    vendor_sources = []
    core_header = 'wasm/pwm32x_core.h'
    include_directories = []
    quoted_header_directories = ('wasm',)
    support_sources = []
    extra_manifest_headers = ()

    def test_shared_output_preserves_all_fourteen_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg', 'rf5c164'])


class Huc6280SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'huc6280'
    exports = HUC6280_EXPORTS
    assertions = False
    vendor_sources = ['vendor/mame-huc6280/huc6280.cpp']
    core_header = 'vendor/mame-huc6280/huc6280.h'
    include_directories = ['vendor/mame-huc6280']
    support_sources = []
    extra_manifest_headers = ()

    def test_shared_output_preserves_all_fifteen_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg', 'rf5c164', 'pwm32x'])


class GameboyApuSdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'gameboy_apu'
    exports = GAMEBOY_APU_EXPORTS
    language_standard = 'c++17'
    export_all = False
    assertions = False
    vendor_sources = ['vendor/mame-gameboy/gameboy_apu.cpp']
    core_header = 'vendor/mame-gameboy/gameboy_apu.h'
    include_directories = ['vendor/mame-gameboy']
    support_sources = []
    extra_manifest_headers = ()

    def test_shared_output_preserves_all_sixteen_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg', 'rf5c164', 'pwm32x', 'huc6280'])


class NesApuSdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'nesapu'
    exports = NESAPU_EXPORTS
    runtime_methods = ['cwrap', 'HEAPU8', 'HEAPU32', 'HEAPF32', 'HEAPF64']
    incoming_module_api = ['wasmBinary', 'locateFile', 'print', 'printErr', 'noInitialRun']
    language_standard = 'c++17'
    export_all = False
    assertions = False
    floating_point_flags = ['-ffp-contract=off']
    additional_behavior_flags = ['-fwrapv', '-fno-strict-aliasing', '-fexceptions',
                                 '-sDISABLE_EXCEPTION_CATCHING=0']
    vendor_sources = ['vendor/tetorica-nes/nes_core.cpp']
    core_header = 'vendor/tetorica-nes/nes_core.h'
    include_directories = ['vendor/tetorica-nes']
    support_sources = []
    extra_manifest_headers = ()

    def test_shared_output_preserves_all_seventeen_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg', 'rf5c164', 'pwm32x', 'huc6280', 'gameboy_apu'])


class SpcSdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'spc'
    exports = SPC_EXPORTS
    runtime_methods = ['HEAPU8', 'HEAPF32', 'UTF8ToString']
    export_all = False
    trim_glue = True
    vendor_sources = ['vendor/snes-spc/snes_spc/' + name for name in (
        'SNES_SPC.cpp', 'SNES_SPC_misc.cpp', 'SNES_SPC_state.cpp', 'SPC_DSP.cpp')]
    core_header = 'vendor/snes-spc/snes_spc/SNES_SPC.h'
    include_directories = ['vendor/snes-spc/snes_spc']
    support_sources = ['vendor/snes-spc/snes_spc/' + name for name in (
        'SPC_CPU.h', 'SPC_DSP.h', 'blargg_common.h', 'blargg_config.h',
        'blargg_endian.h', 'blargg_source.h')]
    extra_manifest_headers = tuple(support_sources)
    extra_tamper_dependencies = (*vendor_sources, *support_sources,
                                 'vendor/snes-spc/LICENSE',
                                 'vendor/snes-spc/license.txt')
    verify_quoted_header_dependencies = True
    disabled_optional_includes = {
        ('vendor/snes-spc/snes_spc/blargg_config.h', 'config.h'): 'HAVE_CONFIG_H',
    }

    def test_shared_output_preserves_all_eighteen_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg', 'rf5c164', 'pwm32x', 'huc6280', 'gameboy_apu', 'nesapu'])


class SegaPcmSdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'segapcm'
    exports = SEGAPCM_EXPORTS
    runtime_methods = ['cwrap', 'HEAPF32', 'HEAPU8']
    language_standard = 'c++17'
    export_all = False
    assertions = False
    trim_glue = True
    vendor_sources = ['vendor/mame-segapcm/segapcm.cpp']
    core_header = 'vendor/mame-segapcm/segapcm.h'
    include_directories = ['vendor/ymfm', 'vendor/mame-segapcm']
    # The historical catalog omits this actual nested header dependency;
    # full-manifest checks and explicit corruption still protect it.
    support_sources = []
    extra_tamper_dependencies = ('vendor/ymfm/chip_state.h',)
    verify_quoted_header_dependencies = True

    def test_shared_output_preserves_all_nineteen_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg', 'rf5c164', 'pwm32x', 'huc6280', 'gameboy_apu', 'nesapu',
             'spc'])


class K051649SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'k051649'
    exports = K051649_EXPORTS
    language_standard = 'c++17'
    export_all = False
    assertions = False
    vendor_sources = ['vendor/mame-k051649/k051649.cpp']
    core_header = 'vendor/mame-k051649/k051649.h'
    include_directories = ['vendor/mame-k051649']
    # Preserve upstream provenance in the recorded inputs; these files are
    # not translation units or dependencies of the standalone adaptation.
    support_sources = ['vendor/mame-k051649/upstream/k051649.cpp',
                       'vendor/mame-k051649/upstream/k051649.h']
    extra_manifest_headers = ()
    extra_tamper_dependencies = (*vendor_sources, *support_sources,
                                 'vendor/mame-k051649/LICENSE',
                                 'vendor/mame-k051649/README.md')
    verify_quoted_header_dependencies = True

    def test_shared_output_preserves_all_twenty_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg', 'rf5c164', 'pwm32x', 'huc6280', 'gameboy_apu', 'nesapu',
             'spc', 'segapcm'])


class OpnVariantSdkBuildRouteMixin(SdkBuildRouteMixin):
    exports = OPN_VARIANT_EXPORTS
    incoming_module_api = ['wasmBinary', 'locateFile']
    export_all = False
    assertions = False
    wrapper_source = 'wasm/opn_variant_wasm.cpp'
    quoted_header_directories = ('wasm',)
    vendor_sources = ['vendor/ymfm/ymfm_opn.cpp', 'vendor/ymfm/ymfm_adpcm.cpp',
                      'vendor/ymfm/ymfm_ssg.cpp']
    support_sources = ['wasm/ymfm_wasm_interface.h', 'vendor/ymfm/ymfm.h',
                       'vendor/ymfm/ymfm_fm.h', 'vendor/ymfm/ymfm_fm.ipp',
                       'vendor/ymfm/ymfm_adpcm.h', 'vendor/ymfm/ymfm_ssg.h',
                       'scripts/build_opn_variant_wasm.sh']
    extra_manifest_headers = tuple(support_sources[:6])
    extra_tamper_dependencies = (*vendor_sources, *support_sources,
                                 'LICENSE', 'LICENSES.md', 'vendor/ymfm/LICENSE')
    verify_quoted_header_dependencies = True


class Ym3438SdkBuildTests(OpnVariantSdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ym3438'
    compile_definitions = ['-DOPN_VARIANT=ym3438']

    def test_shared_output_preserves_all_twenty_one_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg', 'rf5c164', 'pwm32x', 'huc6280', 'gameboy_apu', 'nesapu',
             'spc', 'segapcm', 'k051649'])


class Ymf276SdkBuildTests(OpnVariantSdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ymf276'
    compile_definitions = ['-DOPN_VARIANT=ymf276']

    def test_shared_output_preserves_all_twenty_two_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg', 'rf5c164', 'pwm32x', 'huc6280', 'gameboy_apu', 'nesapu',
             'spc', 'segapcm', 'k051649', 'ym3438'])


class Ymf288SdkBuildTests(OpnVariantSdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ymf288'
    compile_definitions = ['-DOPN_VARIANT=ymf288', '-DOPN_HAS_SSG']

    def test_shared_output_preserves_all_twenty_three_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg', 'rf5c164', 'pwm32x', 'huc6280', 'gameboy_apu', 'nesapu',
             'spc', 'segapcm', 'k051649', 'ym3438', 'ymf276'])


class Ymf278bSdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'ymf278b'
    exports = YMF278B_EXPORTS
    assertions = False
    runtime_methods = ['cwrap', 'HEAPF32', 'HEAPU8']
    vendor_sources = ['vendor/ymfm/ymfm_opl.cpp', 'vendor/ymfm/ymfm_adpcm.cpp',
                      'vendor/ymfm/ymfm_pcm.cpp']
    core_header = 'vendor/ymfm/ymfm_opl.h'
    quoted_header_directories = ('wasm',)
    support_sources = ['wasm/ymfm_wasm_interface.h', 'vendor/ymfm/ymfm.h',
                       'vendor/ymfm/ymfm_fm.h', 'vendor/ymfm/ymfm_fm.ipp',
                       'vendor/ymfm/ymfm_adpcm.h', 'vendor/ymfm/ymfm_pcm.h']
    extra_manifest_headers = tuple(support_sources[1:])
    extra_tamper_dependencies = (*vendor_sources, *support_sources,
                                 'LICENSE', 'LICENSES.md', 'vendor/ymfm/LICENSE')
    verify_quoted_header_dependencies = True

    def test_shared_output_preserves_all_twenty_four_existing_build_records(self):
        self.assert_shared_output_preserves(
            ['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'ym2151', 'okim6258',
             'ym2413', 'ym3526', 'ym3812', 'ymf262', 'y8950', 'ay8910',
             'segapsg', 'rf5c164', 'pwm32x', 'huc6280', 'gameboy_apu', 'nesapu',
             'spc', 'segapcm', 'k051649', 'ym3438', 'ymf276', 'ymf288'])


class NukedOpn2SdkBuildTests(SdkBuildRouteMixin, unittest.TestCase):
    artifact = 'nuked_opn2'
    exports = NUKED_OPN2_EXPORTS
    language_standard = 'c11'
    compiler_variable = 'EMCC'
    environments = 'web,worker,shell,node'
    wrapper_source = 'wasm/nuked_opn2_wasm.c'
    vendor_sources = ['vendor/nuked-opn2/ym3438.c']
    core_header = 'vendor/nuked-opn2/ym3438.h'
    include_directories = ['vendor/nuked-opn2']
    support_sources = []
    extra_manifest_headers = ()
    extra_tamper_dependencies = (*vendor_sources, 'vendor/nuked-opn2/LICENSE',
                                 'vendor/nuked-opn2/README.md', 'LICENSE',
                                 'LICENSES.md')
    verify_quoted_header_dependencies = True

    def test_c_recipe_and_receipt_use_emcc_when_emxx_is_unavailable(self):
        self.environment['EMXX'] = str(self.work / 'unavailable C++ compiler')
        result = self.build('C compiler output')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        compile_call, version_call = self.calls()
        self.assertEqual(compile_call['compiler'], 'fake emcc')
        self.assertIn('-std=c11', compile_call['args'])
        self.assertEqual(version_call['compiler'], 'fake emcc')
        info = json.loads((self.caller / 'C compiler output' / 'build-info.json').read_text())
        self.assertEqual(info['artifacts'][0]['compiler']['command'], self.environment['EMCC'])

    def test_shared_output_preserves_all_twenty_five_existing_build_records(self):
        self.assert_shared_output_preserves(list(ARTIFACTS[:-1]))


if __name__ == '__main__':
    unittest.main()
