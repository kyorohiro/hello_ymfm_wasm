// SPDX-License-Identifier: BSD-3-Clause
// Link a separate GPL raw-bus oracle using an existing local pinned install.
// Never downloads/builds the libraries or changes the legacy PSID reference CLI.
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SID_REFERENCE_PINS} from './prepare_sid_reference.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const cacheRoot = join(root, 'build/sid-reference');
const patchPath = 'third_party/sid-reference/serial-filter-tables.json';
const patchSha = '2ee576ae0030e5b9fc007d4d2fc62eeb1a8982be56e6756efd7aa58bc69e074c';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function record(path) {
  const bytes = await readFile(path);
  return {bytes:bytes.length, sha256:hash(bytes)};
}
function inside(parent, path) {
  const rel = relative(parent, path);
  return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel);
}
async function run(command, args) {
  try { return await exec(command, args, {cwd:root, timeout:120000, maxBuffer:4 * 1024 * 1024}); }
  catch (error) { throw new Error(`${command} failed: ${(error.stderr || error.message).slice(-10000)}`, {cause:error}); }
}
async function inspectPrefix(prefix, patch) {
  prefix = await realpath(prefix);
  if (!inside(await realpath(cacheRoot), prefix)) throw new Error('Reference install must be inside build/sid-reference');
  const source = join(dirname(prefix), 'libresidfp-' + SID_REFERENCE_PINS.libresidfp.version);
  const library = join(prefix, 'lib/libresidfp.a');
  const files = {};
  for (const file of patch.files) {
    const path = join(source, file.path), current = await record(path);
    if (!same(current, file.after)) throw new Error(`Reference cache lacks pinned serial-table initialization: ${path}`);
    files[relative(root, path)] = current;
  }
  const versionPath = join(prefix, 'include/residfp/sidversion.h');
  const version = await readFile(versionPath, 'utf8');
  if (!/#define LIBRESIDFP_VERSION_MAJ 1\b/.test(version) || !/#define LIBRESIDFP_VERSION_MIN 2\b/.test(version)
      || !/#define LIBRESIDFP_VERSION_LEV 3\b/.test(version)) throw new Error('Reference install must be libresidfp 1.2.3');
  for (const name of ['residfp.h', 'residfp_defs.h', 'sidversion.h']) {
    const path = join(prefix, 'include/residfp', name); files[relative(root, path)] = await record(path);
  }
  files[relative(root, library)] = await record(library);
  const pc = join(prefix, 'lib/pkgconfig/libresidfp.pc'); files[relative(root, pc)] = await record(pc);
  return {prefix, source, library, files, modified:(await stat(library)).mtimeMs};
}

/** Existing cache only. An explicit prefix is useful for reproducing the exact
 * same linked-library record after another independent reference build exists. */
export async function prepareSid8580Reference({prefix, workDir = cacheRoot, force = false, check = false} = {}) {
  if (force && check) throw new Error('--force and --check cannot be combined');
  const patchBytes = await readFile(join(root, patchPath));
  if (hash(patchBytes) !== patchSha) throw new Error('Pinned serial-table receipt changed');
  const patch = JSON.parse(patchBytes);
  const diff = await record(join(root, patch.diff.path));
  if (!same(diff, {bytes:patch.diff.bytes, sha256:patch.diff.sha256})) throw new Error('Pinned serial-table patch changed');
  const pin = SID_REFERENCE_PINS.libresidfp;
  const archive = join(cacheRoot, 'cache', `${pin.name}-${pin.version}.tar.gz`);
  const archiveRecord = await record(archive);
  if (archiveRecord.sha256 !== pin.sha256) throw new Error('Pinned libresidfp archive is absent or differs');

  let install;
  if (prefix) install = await inspectPrefix(resolve(prefix), patch);
  else {
    const candidates = [];
    for (const entry of await readdir(cacheRoot, {withFileTypes:true})) {
      if (!entry.isDirectory() || !entry.name.startsWith('build-')) continue;
      try { candidates.push(await inspectPrefix(join(cacheRoot, entry.name, 'install'), patch)); }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code) && !error.message.includes('lacks pinned serial-table')) throw error; }
    }
    candidates.sort((a, b) => b.modified - a.modified || a.prefix.localeCompare(b.prefix));
    install = candidates[0];
    if (!install) throw new Error('No existing serial-initialized libresidfp 1.2.3 install. Prepare the separate legacy reference first, then rerun this cache-only builder.');
  }
  workDir = resolve(workDir);
  await mkdir(workDir, {recursive:true});
  const binary = join(workDir, process.platform === 'win32' ? 'sid8580-reference.exe' : 'sid8580-reference');
  const manifestPath = join(workDir, 'sid8580-reference-build.json');
  const inputs = {};
  for (const path of ['test/helpers/sid8580_reference.cpp', 'scripts/prepare_sid8580_reference.mjs',
    'scripts/prepare_sid_reference.mjs', patchPath, patch.diff.path]) inputs[path] = await record(join(root, path));
  const compiler = process.env.CXX || 'c++';
  const flags = ['-std=c++17', '-O2', '-ffp-contract=off', '-pthread'];
  const provenance = {
    pin, archive:{path:relative(root, archive), ...archiveRecord},
    serialTables:{receipt:patchPath, sha256:patchSha, diff},
    install:{prefix:relative(root, install.prefix), files:install.files},
    note:'Existing local static install reused; its library/header bytes and pinned serial-source edits are recorded. This does not attest a new library rebuild.'
  };
  const build = {platform:process.platform, arch:process.arch, compiler,
    compilerVersion:(await run(compiler, ['--version'])).stdout.trim(), flags};
  if (!force) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (!same(manifest.inputs, inputs) || !same(manifest.provenance, provenance) || !same(manifest.build, build)
          || !same(manifest.binary, await record(binary))) throw new Error('SID8580 reference build is stale');
      await access(binary, constants.X_OK);
      return {binary, manifestPath, manifest};
    } catch (error) { if (check) throw error; }
  }
  const temporary = await mkdtemp(join(workDir, 'sid8580-build-'));
  const output = join(temporary, 'sid8580-reference');
  await run(compiler, [...flags, '-I' + join(install.prefix, 'include'), join(root, 'test/helpers/sid8580_reference.cpp'), install.library, '-o', output]);
  await copyFile(output, binary); await chmod(binary, 0o755);
  const manifest = {format:'tetorica-sid8580-reference-build', version:1, license:'GPL-2.0-or-later',
    purpose:'External raw-bus reference only; not linked or shipped with application/runtime', inputs, provenance, build,
    binary:await record(binary)};
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return {binary, manifestPath, manifest};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; ++i) {
    const argument = process.argv[i];
    if (argument === '--check') options.check = true;
    else if (argument === '--force') options.force = true;
    else if (argument === '--prefix' || argument === '--work-dir') {
      const value = process.argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${argument} needs a path`);
      options[argument === '--prefix' ? 'prefix' : 'workDir'] = value;
    } else throw new Error('Usage: node scripts/prepare_sid8580_reference.mjs [--prefix EXISTING_INSTALL] [--work-dir OUTPUT] [--check|--force]');
  }
  const result = await prepareSid8580Reference(options);
  console.log(JSON.stringify({passed:true, binary:result.binary, manifestPath:result.manifestPath,
    linkedInstall:result.manifest.provenance.install.prefix, binarySha256:result.manifest.binary.sha256}, null, 2));
}
