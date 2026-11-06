#!/usr/bin/env node
// Preserve original source modules and paths; no bundling or minification.
import {cp, mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {syncSidArtifacts} from './sid_artifacts.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = resolve(process.argv[2] ?? join(root, 'release/sid-lab-preview'));
await syncSidArtifacts({check: true});
// Refuse to merge a previous package, so deleted files cannot linger in a ZIP.
await mkdir(dirname(target), {recursive: true});
await mkdir(target);
await mkdir(join(target, 'playground'), {recursive: true});
await mkdir(join(target, 'js')); await mkdir(join(target, 'generated')); await mkdir(join(target, 'sources'));
await cp(join(root, 'docs/playground/sid-lab'), join(target, 'playground/sid-lab'), {recursive: true});
for (const file of ['sid.js', 'sid_test_instrument.js']) await cp(join(root, 'docs/js', file), join(target, 'js', file));
await cp(join(root, 'docs/generated/sid'), join(target, 'generated/sid'), {recursive: true});
await cp(join(root, 'docs/sources/sid'), join(target, 'sources/sid'), {recursive: true});
await cp(join(root, 'LICENSE'), join(target, 'LICENSE'));
await cp(join(root, 'docs/issues/todo_sid_01.md'), join(target, 'sources/sid/TODO.md'));
// The full Playground is not part of this lab ZIP. Keep the navigation working
// without changing the source lab's original relative links and imports.
await writeFile(join(target, 'playground/index.html'), '<!doctype html><meta charset="utf-8"><title>Tetorica Playground</title><p><a href="https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html">Open the full Tetorica Playground</a></p>\n');
await mkdir(join(target, 'issues'));
await cp(join(root, 'docs/issues/todo_sid_01.md'), join(target, 'issues/todo_sid_01.md'));
await writeFile(join(target, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=playground/sid-lab/index.html"><title>Tetorica SID register lab</title><a href="playground/sid-lab/index.html">Open SID register lab</a>\n');
const zip = target + '.zip';
// A new ZIP is required just like a new stage directory (zip otherwise appends).
try { await readFile(zip); throw new Error(`ZIP already exists: ${zip}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
execFileSync('zip', ['-q', '-r', '-D', zip, '.'], {cwd: target});
console.log(`SID lab with readable source: ${zip}`);
