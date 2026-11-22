// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('Analyzer copied JS manifest resolves the shared SPC and timed chip entries without external files', async t => {
  const script = await readFile(new URL('./package_itch_vgm_analyzer.sh', import.meta.url), 'utf8');
  const manifest = /\nJS_FILES="\n([\s\S]*?)\n"/.exec(script);
  assert(manifest, 'The Analyzer package declares its copied JavaScript files');
  const files = manifest[1].trim().split(/\s+/);
  const temporary = await mkdtemp(join(tmpdir(), 'analyzer-spc-manifest-'));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  await writeFile(join(temporary, 'package.json'), '{"type":"module"}\n');
  await mkdir(join(temporary, 'js'));
  await Promise.all(files.map(name => copyFile(
    new URL('../docs/js/' + name, import.meta.url), join(temporary, 'js', name),
  )));

  const spc = await import(pathToFileURL(join(temporary, 'js/spc.js')));
  assert.equal(spc.SPC_SAMPLE_RATE, 32000);
  assert.equal(typeof spc.SpcCore, 'function');
  assert.equal(typeof spc.SnesDspCore, 'function');
  assert.equal(typeof spc.prepareSpcTimeline, 'function');

  const worker = await import(pathToFileURL(join(temporary, 'js/playground_worker_chip.js')));
  assert.equal(typeof worker.createWorkerChip, 'function');
});
