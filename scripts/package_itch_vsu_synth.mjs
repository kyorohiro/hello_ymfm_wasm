// SPDX-License-Identifier: BSD-3-Clause
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { version as esbuildVersion } from 'esbuild';
import { copyReadableModules } from './copy_readable_modules.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = 'synth-vsu';
const slug = 'tetorica-vsu-synth';
const home = 'https://kyorohiro.github.io/hello_ymfm_wasm/';
const icon = 'tetorica_vsu_synth.webp';

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

export async function packageVsuSynth({ version = 'dev', releaseDir = join(root, 'release') } = {}) {
	if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version)) throw new Error('Invalid package version.');
	releaseDir = resolve(releaseDir);
	const output = join(releaseDir, `itch_vsu_synth_${version}`);
	await mkdir(releaseDir, { recursive: true });
	try {
		await lstat(output);
		throw new Error(`Release directory already exists: ${output}`);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
	const stage = await mkdtemp(join(releaseDir, `.itch-vsu-${version}-`));
	const web = join(stage, 'web'), source = join(stage, 'source'), archives = join(stage, 'archives');
	const htmlName = `${slug}-html.zip`, sourceName = `${slug}-source.zip`;
	try {
		const entries = ['synth.js', 'synth.css', 'files.css', 'worklet.js', 'vgm-presets-worker.js', 'vgm-seek-worker.js'];
		const { modules } = await copyReadableModules({ root, stage: web, entries: entries.map(name => `docs/${app}/${name}`), factories: [] });
		for (const { path, sourcePath } of modules) await copy(join(web, path), join(source, sourcePath));
		for (const [input, path] of [
			['LICENSE', 'LICENSE'],
			[`docs/${icon}`, icon],
			[`docs/${app}/vsu.wasm`, `${app}/vsu.wasm`],
			['docs/playground/vendor/fflate-LICENSE', 'playground/vendor/fflate-LICENSE'],
			['packages/virtual-files/LICENSE', 'licenses/tetorica-virtual-files/LICENSE'],
		]) {
			await copy(join(root, input), join(source, input));
			await copy(join(source, input), join(web, path));
		}

		const htmlPath = `docs/${app}/index.html`;
		await copy(join(root, htmlPath), join(source, htmlPath));
		const html = (await readFile(join(source, htmlPath), 'utf8'))
			.replace('href="../index.html"', `href="${home}"`);
		await writeFile(join(web, app, 'index.html'), html);
		await writeFile(join(web, 'index.html'), html.replaceAll(`../${icon}`, `./${icon}`).replace(
			/\b(href|src)="\.\/(synth\.(?:css|js)|files\.css)([?#][^"]*)?"/g,
			`$1="./${app}/$2$3"`,
		));
		await writeFile(join(web, 'README.md'), `# Tetorica VSU Synth

Serve this directory over HTTPS or localhost and open index.html.
For itch.io, upload ${htmlName} as the playable HTML project.
Play the Virtual Boy sound chip from Keyboard or Code, or import a VGM file to explore its voices.
The editable JavaScript and CSS ship with the browser app. The C++ audio core and build script are in ${sourceName}.
`);

		const appFiles = await readdir(join(root, 'docs', app));
		for (const path of [
			`docs/${app}/README.md`,
			...appFiles.filter(name => name.endsWith('.test.mjs')).map(name => `docs/${app}/${name}`),
			'tetorica_src/native/vsu/vsu.cpp',
			'tetorica_src/native/vsu/vsu.h',
			'test/runtime/vsu-native.test.mjs',
			'scripts/build_vsu.sh',
			'scripts/copy_readable_modules.mjs',
			'scripts/package_itch_vsu_synth.mjs',
		]) await copy(join(root, path), join(source, path));
		await writeFile(join(source, 'package.json'), JSON.stringify({
			name: slug, private: true, type: 'module', license: 'BSD-3-Clause',
			devDependencies: { esbuild: esbuildVersion },
			scripts: { build: 'sh scripts/build_vsu.sh', test: `node --test docs/${app}/*.test.mjs test/runtime/vsu-native.test.mjs`, pack: 'node scripts/package_itch_vsu_synth.mjs' },
		}, null, 2) + '\n');
		await writeFile(join(source, 'README.md'), `# Tetorica VSU Synth source

See [the Synth guide](docs/${app}/README.md) for the hardware controls and Code API.
Run \`python3 -m http.server --directory docs 8000\` and open
[the Synth](http://localhost:8000/${app}/) to use or edit the browser app.
The checked-in WASM is included, and the browser uses the JavaScript and CSS directly.

Install Emscripten and run \`npm run build\` to rebuild \`docs/${app}/vsu.wasm\`.
The same C++ core can be compiled for native callers using \`tetorica_src/native/vsu/vsu.h\`.
Run \`npm test\` to check the browser code and WASM. To generate itch.io ZIPs,
run \`npm install\` and then \`npm run pack -- VERSION\`.
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
	if (extra.length) throw new Error('Usage: node scripts/package_itch_vsu_synth.mjs [VERSION]');
	const result = await packageVsuSynth({ version });
	console.log(Object.values(result).join('\n'));
}
