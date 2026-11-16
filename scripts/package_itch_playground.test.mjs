// Verify the actual dependency graph selected by the full Playground packager.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {init, parse} from '../docs/playground/vendor/es-module-lexer.js';

test('Playground includes the complete AY Main, Worker and audio processor module graph', async () => {
  await init();
  const script = await readFile(new URL('./package_itch_playground.sh', import.meta.url), 'utf8');
  const match = script.match(/\nRUNTIME_FILES="([\s\S]*?)"/);
  assert(match, 'the reviewed runtime copy list must be present');
  const included = new Set(match[1].trim().split(/\s+/));
  const root = new URL('../docs/js/', import.meta.url);
  const pending = [
    'native_genesis_extra_ay8910.js', 'native_genesis_msx.js', 'playground_ay8910.js',
    'playground_ay8910_worklet.js', 'playground_runtime.js', 'playground_logic_worker.js',
  ];
  const visited = new Set();
  while (pending.length) {
    const name = pending.pop();
    if (visited.has(name)) continue;
    visited.add(name);
    assert(included.has(name), `missing shipped runtime dependency: ${name}`);
    const file = new URL(name, root), source = await readFile(file, 'utf8');
    for (const {n: specifier} of parse(source)[0]) {
      if (!specifier?.startsWith('.')) continue;
      const target = new URL(specifier.split(/[?#]/)[0], file);
      // Vendor subdirectories have independent component copiers. This list
      // ships the authored top-level runtime modules, including both threads.
      if (new URL('.', target).href === root.href && target.pathname.endsWith('.js')) {
        pending.push(basename(target.pathname));
      }
    }
  }
});
