// Verify an already-packed distribution without rebuilding or using game data.
// Usage: node scripts/check_vgm_spc_package.mjs ./tetorica-vgm-VERSION.tgz
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, readdir, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createSyntheticSpc} from '../web/spc_test_fixture.mjs';
import {captureSpcPerformance} from '../web/spc_performance.js';
import {buildSnesNoteAnalysis} from '../docs/vgm_analyzer/snes_notes.js';
import factory from '../docs/generated/spc_wasm.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Pass an existing tetorica-vgm .tgz; this check does not rebuild it.');
const tarball = resolve(process.argv[2]);
await stat(tarball);
const directory = await mkdtemp(join(tmpdir(), 'tetorica-vgm-spc-package-'));
const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd:directory, encoding:'utf8', maxBuffer:16 * 1024 * 1024, ...options,
});
const success = result => {
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
};
try {
  await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}\n');
  success(run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--cache', join(directory, 'npm-cache'), tarball]));
  const require = createRequire(join(directory, 'package.json'));
  const api = await import(pathToFileURL(require.resolve('tetorica-vgm')).href);
  const spc = await import(pathToFileURL(require.resolve('tetorica-vgm/spc')).href);
  for (const name of ['isSpcSource', 'analyzeSpcSource', 'exportSpcAnalysis', 'listSpcScoreChannels']) {
    assert.equal(typeof api[name], 'function', `Main export ${name}`);
    assert.equal(api[name], spc[name], `Subpath export ${name}`);
  }
  const installed = join(directory, 'node_modules/tetorica-vgm');
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  const cli = (...args) => run(process.execPath, [join(installed, manifest.bin['tetorica-vgm']), ...args]);
  assert.equal(success(cli('--version')).trim(), manifest.version);
  assert.match(manifest.version, /^\d+\.\d+\.\d+/);

  // The LGPL core, source and build recipe must travel with the tarball.
  for (const path of [
    'docs/generated/spc_wasm.js', 'docs/generated/spc_wasm.wasm',
    'sources/wasm/spc_wasm.cpp', 'sources/scripts/build_spc_wasm.sh',
    'sources/third_party/snes-spc/snes_spc/SNES_SPC.cpp',
    'sources/third_party/snes-spc/LICENSE', 'sources/SNES-SPC.md',
    'licenses/snes-spc/LICENSE', 'licenses/snes-spc/README.md',
  ]) assert((await stat(join(installed, path))).size > 0, `Packed ${path}`);
  assert.match(await readFile(join(installed, 'sources/SNES-SPC.md'), 'utf8'), /LGPL-2\.1-or-later/);
  assert.match(await readFile(join(installed, 'licenses/snes-spc/LICENSE'), 'utf8'), /GNU LESSER GENERAL PUBLIC LICENSE/);
  // Check static relative module imports independently of module evaluation.
  let checkedModules = 0;
  async function checkImports(path) {
    for (const entry of await readdir(path, {withFileTypes:true})) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await checkImports(file);
      else if (/\.[cm]?js$/.test(entry.name)) {
        checkedModules++;
        const source = await readFile(file, 'utf8');
        for (const match of source.matchAll(/(?:^|\n)\s*(?:import\s+(?:[^;\n]*?\s+from\s*)?|export\s+[^;\n]*?\s+from\s*)["'](\.[^"']+)["']/g)) {
          await stat(resolve(dirname(file), match[1].split(/[?#]/)[0]));
        }
      }
    }
  }
  await checkImports(join(installed, 'cli'));
  await checkImports(join(installed, 'docs'));
  await checkImports(join(installed, 'web'));

  const bytes = createSyntheticSpc();
  const original = bytes.slice();
  assert.equal(api.isSpcSource(bytes), true);
  assert.equal(api.isSpcSource(new Uint8Array(32)), false);
  // Extension deliberately differs: SPC detection must use the file signature.
  const input = join(directory, 'authored-spc.bin');
  const references = [{sampleId:0, note:'C4', cents:0}];
  const referenceFile = join(directory, 'references.json');
  await writeFile(input, bytes);
  await writeFile(referenceFile, JSON.stringify(references));
  const options = {durationSeconds:.5, controlStepMs:20, references};
  const flags = ['--spc-seconds', '.5', '--spc-control-step-ms', '20', '--spc-references', referenceFile];
  const analysis = await api.analyzeSpcSource(bytes, options);
  assert.deepEqual(bytes, original, 'Analysis preserves input');
  assert.equal(analysis.durationSeconds, .5);
  assert.equal(analysis.channels.length, 8);
  assert.equal(analysis.channels[0].notes[0].midi, 60);
  assert(analysis.warnings.every(warning => typeof warning === 'string'));
  // Same shared browser capture and note model, with no package internals imported.
  const performance = await captureSpcPerformance(bytes, {
    ...options, moduleFactory:factory,
    moduleOptions:{wasmBinary:await readFile(join(root, 'docs/generated/spc_wasm.wasm'))},
  });
  const expected = buildSnesNoteAnalysis(performance, {
    references:[{sampleId:0, referenceHz:440 * 2 ** (-9 / 12), kind:'manual'}],
  });
  assert.deepEqual(analysis.channels.map(channel => channel.notes), expected.channels.map(channel => channel.notes));
  assert.deepEqual(JSON.parse(success(cli('analyze', input, '--json', ...flags))), JSON.parse(JSON.stringify(analysis)));
  const channels = api.listSpcScoreChannels(analysis);
  assert.equal(channels.channels.length, 8);
  assert.equal(channels.channels[0].id, 'snes-voice-1');
  assert(channels.channels[0].noteCount > 0);
  assert.deepEqual(JSON.parse(success(cli('score-channels', input, '--json', ...flags))), channels);
  const support = JSON.parse(success(cli('support', input, '--json', ...flags)));
  for (const format of ['midi', 'musicxml', 'lilypond']) {
    assert.equal(support.exports[format].status, 'available', `SPC ${format} support`);
  }
  assert.equal(support.render.status, 'unsupported', 'SPC WAV rendering is outside this release');

  for (const format of ['midi', 'musicxml', 'lilypond']) {
    const output = join(directory, `output.${format}`);
    const result = api.exportSpcAnalysis(analysis, {format, bpm:120, fileName:basename(input)});
    const expectedBytes = Buffer.from(result.bytes ?? result.text);
    success(cli('export', input, '--format', format, '--bpm', '120', '--output', output, ...flags));
    assert.deepEqual(await readFile(output), expectedBytes, `CLI/API ${format}`);
    if (format === 'midi') assert.equal(expectedBytes.subarray(0,4).toString(), 'MThd');
    else if (format === 'musicxml') assert.match(expectedBytes.toString(), /<step>C<\/step><octave>4<\/octave>/);
    else assert.match(expectedBytes.toString(), /SPC transcription/);
    // Existing output remains intact after overwrite refusal or invalid options.
    assert.equal(cli('export', input, '--format', format, '--bpm', '120', '--output', output, ...flags).status, 1);
    assert.deepEqual(await readFile(output), expectedBytes);
    success(cli('export', input, '--format', format, '--bpm', '120', '--output', output, '--force', ...flags));
    assert.deepEqual(await readFile(output), expectedBytes);
  }
  const selectedOutput = join(directory, 'selected.musicxml');
  const selected = api.exportSpcAnalysis(analysis, {format:'musicxml', bpm:120, channels:['snes-voice-1'], fileName:basename(input)});
  success(cli('export', input, '--format', 'musicxml', '--bpm', '120', '--channels', 'snes-voice-1', '--output', selectedOutput, ...flags));
  assert.deepEqual(await readFile(selectedOutput), Buffer.from(selected.text));

  const invalidReference = join(directory, 'bad-references.json');
  await writeFile(invalidReference, JSON.stringify([{sampleId:99, note:'C4'}]));
  const failedOutput = join(directory, 'must-not-exist');
  const failures = [
    ['export', input, '--format', 'midi', '--output', failedOutput, '--spc-seconds', 'NaN'],
    ['export', input, '--format', 'midi', '--output', failedOutput, '--spc-seconds', '.5', '--spc-references', invalidReference],
    ['export', input, '--format', 'tfi', '--output', failedOutput, ...flags],
    ['export', input, '--format', 'musicxml', '--output', failedOutput, '--channels', 'bad', ...flags],
    ['render', input, '--output', failedOutput],
    ['to-json', input, '--output', failedOutput],
  ];
  for (const args of failures) {
    const failure = cli(...args);
    assert.equal(failure.status, 1, `Expected rejection: ${args.join(' ')}\n${failure.stderr}`);
    assert.equal(failure.stdout, '');
    await assert.rejects(stat(failedOutput), {code:'ENOENT'});
  }
  const invalidInput = join(directory, 'invalid.spc');
  await writeFile(invalidInput, 'Invalid SPC data');
  assert.equal(cli('analyze', invalidInput, '--json').status, 1);

  // VGM and S98 command paths still work from the same installed tarball.
  for (const name of ['psg-tone.vgm', 's98-ym2203.s98']) {
    const source = join(root, 'test/fixtures', name);
    const summary = JSON.parse(success(cli('analyze', source, '--json')));
    assert.equal(summary.schemaVersion, 1);
    assert(summary.chips.length > 0);
  }
  const vgm = join(root, 'test/fixtures/psg-tone.vgm');
  const vgmOutput = join(directory, 'vgm.mid');
  success(cli('export', vgm, '--format', 'midi', '--output', vgmOutput));
  const vgmExpected = api.exportSource(await api.readSourceDocument(vgm), {format:'midi', fileName:basename(vgm)});
  assert.deepEqual(await readFile(vgmOutput), Buffer.from(vgmExpected.bytes));
  console.log(`tetorica-vgm ${manifest.version}: isolated offline package check passed (${checkedModules} modules; SPC analysis, tuning, MIDI, MusicXML, LilyPond, CLI validation, VGM/S98 regression).`);
} finally {
  await rm(directory, {recursive:true, force:true});
}
