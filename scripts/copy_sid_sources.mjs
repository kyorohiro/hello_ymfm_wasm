#!/usr/bin/env node
// Preserve the original SID compilation sources and readable module layout.
import {cp, mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {syncSidArtifacts} from './sid_artifacts.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function copySidSources(stage) {
  await syncSidArtifacts({check: true});
  await mkdir(join(stage, 'sources'), {recursive: true});
  await cp(join(root, 'docs/sources/sid'), join(stage, 'sources/sid'), {recursive: true});
  await mkdir(join(stage, 'licenses/chips-m6581'), {recursive: true});
  for (const file of ['LICENSE', 'README.md', 'PATCHES.md'])
    await cp(join(root, 'third_party/chips-m6581', file), join(stage, 'licenses/chips-m6581', file));
  await writeFile(join(stage, 'sources/SID.md'), '# C64 SID / MOS 6581\n\nSee [the matching SID source kit](sid/README.md) for original source, marked patches, licenses, Native host and standalone WASM rebuild recipe. The core is a 6581 approximation under zlib; the Tetorica wrapper is BSD-3-Clause. It is separate from the fixed SDK snapshot. Browser modules remain readable under js/.\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: copy_sid_sources.mjs STAGE');
  await copySidSources(resolve(process.argv[2]));
}
