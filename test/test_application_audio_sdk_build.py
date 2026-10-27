"""Check fixed-SDK compiler routing/guards; actual PCM parity is a separate test."""
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
class ApplicationAudioSdkBuildTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='application-audio-sdk-route-')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name)
        self.root = self.work / 'standalone application'
        self.root.mkdir()
        shutil.copytree(ROOT / SDK, self.root / SDK)
        scripts = self.root / 'scripts'
        scripts.mkdir()
        for name in ('import_soundchip_sdk.py', 'build_cdda_wasm.sh', 'build_msm5205_wasm.sh'):
            shutil.copyfile(ROOT / 'scripts' / name, scripts / name)
        shutil.copyfile(ROOT / 'third_party/soundchip-sdk.json', self.root / 'third_party/soundchip-sdk.json')
        self.compiler = self.work / 'compiler wrapper.py'
        self.log = self.work / 'compiler.jsonl'
        self.compiler.write_text('#!' + sys.executable + '\n' + '''
import json, os
from pathlib import Path
import sys
if '--version' in sys.argv:
    print('Recording EMCC fixture; no synthesis performed')
else:
    with open(os.environ['APPLICATION_AUDIO_COMPILER_LOG'], 'a') as output:
        output.write(json.dumps({'arguments': sys.argv[1:], 'cwd': str(Path.cwd())}) + '\\n')
    target = Path(sys.argv[sys.argv.index('-o') + 1])
    target.write_bytes(b'opaque fixture compiler output')
''')
        self.compiler.chmod(0o755)
        self.environment = {**os.environ, 'EMCC': str(self.compiler),
                            'APPLICATION_AUDIO_COMPILER_LOG': str(self.log)}

    def invoke(self, name, *arguments):
        return subprocess.run(['sh', str(self.root / 'scripts' / f'build_{name}_wasm.sh'), *arguments],
                              cwd=self.work, env=self.environment, capture_output=True, text=True)

    def test_both_wrappers_compile_only_pinned_sources_and_honor_emcc_and_output_paths(self):
        for name in ('cdda', 'msm5205'):
            with self.subTest(name=name):
                self.assertTrue((self.root / SDK / f'vendor/tetorica-{name}/{name}_pcm.c').is_file())
                output = self.work / ('custom output ' + name)
                result = self.invoke(name, str(output))
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertFalse((self.root / 'native').exists(), 'No local native source mirror is supplied')
                records = [json.loads(line) for line in self.log.read_text().splitlines()]
                args = records[-1]['arguments']
                self.assertEqual(set(arg for arg in args if arg.endswith('.c')), {
                    str(self.root / SDK / f'vendor/tetorica-{name}/{name}_pcm.c'),
                    str(self.root / SDK / f'wasm/{name}_wasm.c')})
                self.assertIn('-I' + str(self.root / SDK / f'vendor/tetorica-{name}'), args)
                for flag in ('-std=c11', '-O2', '-ffp-contract=off', '-sSTANDALONE_WASM=1',
                             '-sALLOW_MEMORY_GROWTH=0', '-sINITIAL_MEMORY=131072', '-sSTACK_SIZE=16384'):
                    self.assertIn(flag, args)
                self.assertIn(f'-Wl,--export={name}_wasm_init', args)
                self.assertIn(f'-Wl,--export={name}_wasm_render', args)
                self.assertEqual(args[args.index('-o') + 1], str(output / f'{name}_wasm.wasm'))
                self.assertIn(f'{name}_wasm.wasm', (output / f'{name}_wasm.js').read_text())
                receipt = json.loads((output / 'build-info.json').read_text())['artifacts'][0]
                self.assertEqual(receipt['id'], name)
                self.assertEqual(receipt['format'], 'standalone-audio-wasm')
                self.assertEqual(receipt['compiler']['command'], str(self.compiler))
                self.assertEqual(len(receipt['sourceFiles']), 4)

    def test_default_output_stays_in_web_generated(self):
        result = self.invoke('cdda')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.root / 'web/generated/cdda_wasm.js').is_file())
        self.assertTrue((self.root / 'web/generated/cdda_wasm.wasm').is_file())

    def test_modified_sdk_is_rejected_before_invoking_a_compiler_or_creating_outputs(self):
        target = self.root / SDK / 'vendor/ymfm/ymfm.h'
        target.write_bytes(target.read_bytes() + b'\nmodified source\n')
        output = self.work / 'must not be created'
        for name in ('cdda', 'msm5205'):
            with self.subTest(name=name):
                result = self.invoke(name, str(output))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('hash/size mismatch', result.stderr)
                self.assertFalse(self.log.exists())
                self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
