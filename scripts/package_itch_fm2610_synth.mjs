// SPDX-License-Identifier: BSD-3-Clause
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { version as esbuildVersion } from 'esbuild';
import { copyReadableModules } from './copy_readable_modules.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = 'synth-fm2610';
const slug = 'tetorica-fm2610-synth';
const home = 'https://kyorohiro.github.io/hello_ymfm_wasm/';
const icon = 'tetorica_fm2610_synth.webp';
const sdk = 'third_party/tetorica-soundchip-native';
const coreFactory = 'docs/generated/ym2610b_wasm.js';
const coreWasm = 'docs/generated/ym2610b_wasm.wasm';
const factoryScript = 'scripts/package_itch_fm2610_synth.mjs';
const packageTest = 'scripts/package_itch_fm2610_synth.test.mjs';
const sampleTests = [
  'test/runtime/fm2610_adpcm_a_kit.test.mjs',
  'test/runtime/fm2610_adpcm_b_sample_document.test.mjs',
];

async function copy(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

function zip(stage, output, browser) {
  execFileSync('python3', ['-c', `
from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
root = Path(sys.argv[1])
files = sorted(path for path in root.rglob('*') if path.is_file())
if sys.argv[3] == 'true' and (len(files) > 1000 or root / 'index.html' not in files):
    sys.exit('Playable ZIP needs a root index.html and at most 1,000 files.')
with ZipFile(sys.argv[2], 'w', compression=ZIP_DEFLATED) as archive:
    for path in files:
        info = ZipInfo(path.relative_to(root).as_posix())
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
with ZipFile(sys.argv[2]) as archive:
    bad_file = archive.testzip()
    if bad_file is not None:
        sys.exit(f'Could not verify archive member: {bad_file}')
`, stage, output, String(browser)], { stdio: 'inherit' });
}

async function copyNativeSource(source) {
  const ymfm = `${sdk}/vendor/ymfm`;
  const effects = 'tetorica_src/native/audio_effect';
  const [ymfmFiles, effectFiles] = await Promise.all([readdir(join(root, ymfm)), readdir(join(root, effects))]);
  for (const path of [
    `${sdk}/scripts/build_ym2610b_wasm.sh`,
    `${sdk}/wasm/ym2610b_wasm.cpp`,
    `${sdk}/wasm/opn_state.h`,
    `${sdk}/wasm/ymfm_wasm_interface.h`,
    ...ymfmFiles.filter(name => /\.(?:h|ipp|cpp)$/.test(name)).map(name => `${ymfm}/${name}`),
    'scripts/build_native_audio_effect.sh',
    ...effectFiles.filter(name => /\.[ch]$/.test(name)).map(name => `${effects}/${name}`),
  ]) await copy(join(root, path), join(source, path));
}

/** Stage only the standalone app, the browser graph and matching build sources. */
export async function packageFm2610Synth({ version = 'dev', releaseDir = join(root, 'release') } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version)) throw new Error('Invalid package version.');
  releaseDir = resolve(releaseDir);
  const output = join(releaseDir, `itch_fm2610_synth_${version}`);
  await mkdir(releaseDir, { recursive: true });
  try {
    await lstat(output);
    throw new Error(`Release directory already exists: ${output}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const stage = await mkdtemp(join(releaseDir, `.itch-fm2610-${version}-`));
  const web = join(stage, 'web'), source = join(stage, 'source'), archives = join(stage, 'archives');
  const htmlName = `${slug}-html.zip`, sourceName = `${slug}-source.zip`;
  try {
    const appFiles = await readdir(join(root, 'docs', app));
    const tests = [...sampleTests,
      ...appFiles.filter(name => name.endsWith('.test.mjs')).sort().map(name => `docs/${app}/${name}`)];
    const entries = [
      ...appFiles.filter(name => /[-_]worker\.js$/.test(name)).sort().map(name => `docs/${app}/${name}`),
      `docs/${app}/synth.js`, `docs/${app}/synth.css`,
      'docs/js/ym2610b-worklet.js', 'docs/js/vgm-output-worklet.js', 'docs/js/native-fx-worklet.js',
    ];
    const { modules } = await copyReadableModules({ root, stage: web, entries, factories: [coreFactory] });
    for (const { path, sourcePath } of modules) await copy(join(web, path), join(source, sourcePath));
    for (const [input, path] of [
      ['LICENSE', 'LICENSE'],
      [`${sdk}/LICENSE`, 'licenses/tetorica-soundchip-native/LICENSE'],
      [`${sdk}/vendor/ymfm/LICENSE`, 'licenses/ymfm/LICENSE'],
      [`docs/${icon}`, icon],
      [coreFactory, 'generated/ym2610b_wasm.js'],
      [coreWasm, 'generated/ym2610b_wasm.wasm'],
      ['docs/js/native_audio_effect.wasm', 'js/native_audio_effect.wasm'],
      ['docs/playground/vendor/fflate-LICENSE', 'playground/vendor/fflate-LICENSE'],
      ['docs/playground/tetorica-playground-globals.d.ts', 'playground/tetorica-playground-globals.d.ts'],
      ['packages/virtual-files/LICENSE', 'licenses/tetorica-virtual-files/LICENSE'],
    ]) {
      await copy(join(root, input), join(source, input));
      await copy(join(source, input), join(web, path));
    }

    const htmlPath = `docs/${app}/index.html`;
    await copy(join(root, htmlPath), join(source, htmlPath));
    const html = (await readFile(join(source, htmlPath), 'utf8'))
      .replace('href="../index.html"', `href="${home}"`)
      .replace('href="../playground/index.html?mode=neogeo-b"', `href="${home}playground/index.html?mode=neogeo-b"`);
    await writeFile(join(web, app, 'index.html'), html);
    await writeFile(join(web, 'index.html'), html.replaceAll(`../${icon}`, `./${icon}`).replace(
      /\b(href|src)="\.\/(synth\.(?:css|js))([?#][^"]*)?"/g,
      `$1="./${app}/$2$3"`,
    ));
    await writeFile(join(web, 'README.md'), `# Tetorica FM2610 Synth

Serve this directory over HTTPS or localhost and open index.html.
Upload ${htmlName} as a playable HTML project on itch.io.
Play YM2610 or YM2610B with the keyboard and JavaScript, load your own samples and VGM files, and manage sounds in Files.
The Code panel loads Monaco completion when online and provides a textarea when the editor service is unavailable.
The browser app includes editable JavaScript and CSS. The native audio sources and build recipes are in ${sourceName}.
`);

    await copyNativeSource(source);
    for (const path of ['scripts/copy_readable_modules.mjs', 'scripts/check_synth_package.mjs', factoryScript, packageTest, ...tests]) {
      await copy(join(root, path), join(source, path));
    }
    if (appFiles.includes('README.md')) await copy(join(root, 'docs', app, 'README.md'), join(source, 'docs', app, 'README.md'));
    await writeFile(join(source, 'package.json'), JSON.stringify({
      name: slug, private: true, type: 'module', license: 'BSD-3-Clause',
      devDependencies: { esbuild: esbuildVersion },
      scripts: {
        'build:wasm': `sh ${sdk}/scripts/build_ym2610b_wasm.sh "$PWD/docs/generated"`,
        test: `node --test ${tests.join(' ')} ${packageTest}`,
        pack: `node ${factoryScript}`,
      },
    }, null, 2) + '\n');
    await writeFile(join(source, 'README.md'), `# Tetorica FM2610 Synth source

Run \`python3 -m http.server --directory docs 8000\` and open
[the Synth](http://localhost:8000/${app}/) to use or edit the browser app.
The checked-in audio WASM is included. The app runs directly from its JavaScript and CSS modules.

With Emscripten installed, run \`npm run build:wasm\` to rebuild the YM2610/YM2610B files under \`docs/generated/\`.
To rebuild the shared effects module, run \`sh scripts/build_native_audio_effect.sh build/effects\` and copy
\`build/effects/gain.wasm\` to \`docs/js/native_audio_effect.wasm\`.
The matching C and C++ sources and their licenses are included.

Run \`npm install\` and \`npm test\` to check the package. To generate itch.io ZIPs, run \`npm run pack -- VERSION\`.
`);

    await mkdir(archives);
    zip(web, join(archives, htmlName), true);
    zip(source, join(archives, sourceName), false);
    const checksums = [];
    for (const name of [htmlName, sourceName]) {
      const digest = createHash('sha256').update(await readFile(join(archives, name))).digest('hex');
      checksums.push(`${digest}  ${name}\n`);
    }
    await writeFile(join(archives, 'SHA256SUMS'), checksums.join(''));
    await rename(archives, output);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return { html: join(output, htmlName), source: join(output, sourceName), checksums: join(output, 'SHA256SUMS') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [version, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error(`Usage: node ${factoryScript} [VERSION]`);
  const result = await packageFm2610Synth({ version });
  console.log(Object.values(result).join('\n'));
}
