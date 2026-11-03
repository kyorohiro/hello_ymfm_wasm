#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {checkRuntimeArtifacts, listRuntimeArtifactFiles, syncRuntimeArtifacts} from './runtime_artifacts.mjs';

const usage = `Usage: node scripts/sync_runtime_artifacts.mjs [--check | --import-existing | --list]
       [--only ID ...] [--root REPOSITORY]

Default: verify tetorica_src/runtime/generated SDK receipts and NativeFX ABI, refresh the
runtime catalog, then copy canonical bytes to docs and legacy import paths.
--check never writes and rejects missing/stale canonical files or mirrors.
--import-existing explicitly imports the verified docs/generated set once;
existing canonical outputs and special aliases must agree before any write.
--list prints canonical output paths (including metadata), one per line.
--only selects artifact mirrors; the complete canonical set is always checked.
No compilation, network access or SDK modification is performed.`;

export function parseRuntimeArtifactArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help') {
      if (argv.length !== 1) throw new Error('--help must stand alone');
      return {help: true};
    }
    if (['--check', '--import-existing', '--list'].includes(argument)) {
      if (options.mode) throw new Error('Choose only one of --check, --import-existing or --list');
      options.mode = argument.slice(2); continue;
    }
    if (!['--only', '--root'].includes(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    if (argument === '--only') (options.ids ??= []).push(value);
    else {
      if (options.root) throw new Error('Duplicate --root');
      options.root = path.resolve(value);
    }
  }
  if (options.mode === 'import-existing' && options.ids) throw new Error('--import-existing cannot be combined with --only');
  return options;
}

export async function runRuntimeArtifactCommand(argv = process.argv.slice(2)) {
  const {mode, help, ...options} = parseRuntimeArtifactArguments(argv);
  if (help) { process.stdout.write(usage + '\n'); return; }
  if (mode === 'list') {
    const files = await listRuntimeArtifactFiles(options);
    process.stdout.write(files.map(entry => entry.canonical).join('\n') + '\n'); return;
  }
  const result = mode === 'check' ? await checkRuntimeArtifacts(options)
    : await syncRuntimeArtifacts({...options, importExisting: mode === 'import-existing'});
  process.stdout.write(mode === 'check'
    ? `Runtime artifacts verified: ${result.sdkBuildCount} SDK builds, ${result.outputCount} outputs, ${result.mirrorCount} mirrors.\n`
    : `Runtime artifacts ${result.imported ? 'imported and synchronized' : 'synchronized'}: ${result.changed.length} files changed.\n`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRuntimeArtifactCommand().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
