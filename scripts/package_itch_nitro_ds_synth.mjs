// SPDX-License-Identifier: BSD-3-Clause
import { execFileSync } from 'node:child_process';
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyReadableModules } from './copy_readable_modules.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = 'synth-nitro-ds';
const icon = 'tetorica_nitro_ds_synth.webp';
const [version = 'dev', ...extra] = process.argv.slice(2);
if (extra.length || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version)) {
	throw new Error('Usage: sh scripts/package_itch_nitro_ds_synth.sh [VERSION]');
}

const release = join(root, 'release');
const archive = join(release, 'tetorica_nitro_ds_synth_' + version + '_itch.zip');

function zip(stage, output) {
	execFileSync('python3', ['-c', `
from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
root = Path(sys.argv[1])
with ZipFile(sys.argv[2], 'w', compression=ZIP_DEFLATED) as archive:
    for file in sorted(root.rglob('*')):
        if not file.is_file():
            continue
        info = ZipInfo(file.relative_to(root).as_posix())
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, file.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
with ZipFile(sys.argv[2]) as archive:
    bad_file = archive.testzip()
    if bad_file is not None:
        sys.exit(f'Could not verify archive member: {bad_file}')
`, stage, output], { stdio: 'inherit' });
}

await mkdir(release, { recursive: true });
try {
	await lstat(archive);
	throw new Error('Archive already exists: ' + archive);
} catch (error) {
	if (error.code !== 'ENOENT') throw error;
}
const stage = await mkdtemp(join(release, 'itch_nitro_ds_synth_' + version + '-'));
const temporaryZip = stage + '.zip';
try {
	await copyReadableModules({
		root,
		stage,
		entries: ['synth.js', 'synth.css', 'nds-worklet.js', '2sf-worker.js']
			.map(name => 'docs/' + app + '/' + name),
		factories: [],
	});
	for (const [source, path] of [
		['LICENSE', 'LICENSE'],
		['docs/' + icon, icon],
		['docs/' + app + '/index.html', app + '/index.html'],
		['docs/playground/tetorica-playground-globals.d.ts', 'playground/tetorica-playground-globals.d.ts'],
		['docs/playground/vendor/fflate-LICENSE', 'playground/vendor/fflate-LICENSE'],
		['packages/virtual-files/LICENSE', 'licenses/tetorica-virtual-files/LICENSE'],
	]) {
		const output = join(stage, path);
		await mkdir(dirname(output), { recursive: true });
		await copyFile(join(root, source), output);
	}
	const html = await readFile(join(stage, app, 'index.html'), 'utf8');
	await writeFile(join(stage, 'index.html'), html
		.replaceAll('../' + icon, './' + icon)
		.replace(/\b(href|src)="(synth\.(?:css|js)(?:\?[^"]*)?)"/g, '$1="./' + app + '/$2"'));

	execFileSync('sh', [
		join(root, 'scripts/nds-2sf/build_skyemu_wasm.sh'), '--release-kit',
		join(stage, 'sources/2sf'), join(stage, app, 'generated'),
	], { stdio: 'inherit' });
	await writeFile(join(stage, 'README.md'), [
		'# Tetorica Nitro DS Synth',
		'',
		'Serve this directory over HTTPS or localhost and open index.html.',
		'For itch.io, upload the ZIP as an HTML playable project.',
		'',
		'Try the Keyboard or the JavaScript examples in Files. Use Menu → Import to open a',
		'2SF folder or select song and library files. 2SF playback supports ROM-boot sets',
		'with standard timing. Supply your own songs and libraries.',
		'',
		'The JavaScript and CSS are copied from the authored files. Edit and reload',
		'the page to try your changes. Monaco can load from its CDN, with a local text',
		'editor available when the CDN is unavailable.',
		'',
		'## Rebuild the shared DS sound renderer',
		'',
		'Install Emscripten, then run from the unpacked ZIP:',
		'',
		'    sh sources/2sf/rebuild.sh synth-nitro-ds/generated/skyemu-2sf.wasm',
		'',
		'The required SkyEmu source, Tetorica adapter and build recipe are in sources/2sf.',
		'See LICENSE and sources/2sf/skyemu-2sf-notices.txt for attribution.',
		'',
	].join('\n'));
	zip(stage, temporaryZip);
	await link(temporaryZip, archive);
} catch (error) {
	await rm(stage, { recursive: true, force: true });
	throw error;
} finally {
	await rm(temporaryZip, { force: true });
}
console.log('ZIP: ' + archive);
console.log('Web root: ' + stage);
