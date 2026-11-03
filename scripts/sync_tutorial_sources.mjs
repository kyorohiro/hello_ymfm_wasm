#!/usr/bin/env node
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const tutorialNames = ['ex01_hello_world.cpp', 'ex02_ym2612.cpp', 'ex03_beep.cpp'];
const usage = `Usage: node scripts/sync_tutorial_sources.mjs [--check | --help]

Copy the three canonical examples/cpp/tutorials/*.cpp files to docs/tutorials/.
--check never writes and rejects missing or stale public download mirrors.`;

export async function syncTutorialSources({root = repositoryRoot, check = false} = {}) {
  // Read every canonical file before writing any public copy.
  const sources = await Promise.all(tutorialNames.map(async name => ({
    name,
    bytes: await readFile(path.join(root, 'examples/cpp/tutorials', name)),
  })));
  const changed = [];
  for (const source of sources) {
    const relativePath = `docs/tutorials/${source.name}`;
    let current;
    try {
      current = await readFile(path.join(root, relativePath));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (current?.equals(source.bytes)) continue;
    if (check) {
      throw new Error(`Tutorial source mirror ${current ? 'stale' : 'missing'}: ${relativePath}. Run node scripts/sync_tutorial_sources.mjs`);
    }
    changed.push({...source, relativePath});
  }
  if (!check && changed.length) {
    await mkdir(path.join(root, 'docs/tutorials'), {recursive: true});
    for (const source of changed) {
      await writeFile(path.join(root, source.relativePath), source.bytes);
    }
  }
  return {count: sources.length, changed: changed.map(source => source.relativePath)};
}

export async function runTutorialSourceCommand(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write(usage + '\n');
    return;
  }
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--check')) {
    throw new Error(usage);
  }
  const check = argv[0] === '--check';
  const result = await syncTutorialSources({check});
  process.stdout.write(check
    ? `Tutorial source mirrors verified: ${result.count} files.\n`
    : `Tutorial source mirrors synchronized: ${result.changed.length} files changed.\n`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTutorialSourceCommand().catch(error => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
