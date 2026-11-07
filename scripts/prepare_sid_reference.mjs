// SPDX-License-Identifier: BSD-3-Clause
// Builds a separate GPL verification executable; never changes application artifacts.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, mkdtemp, readFile, writeFile, copyFile, rename, access, chmod} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = data => createHash('sha256').update(data).digest('hex');
const recordsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const SID_REFERENCE_PINS = Object.freeze({
  libsidplayfp:Object.freeze({name:'libsidplayfp', version:'3.1.2', revision:'b1e8f1deedf41d343123319237c0d008d72cbea7',
    url:'https://github.com/libsidplayfp/libsidplayfp/releases/download/v3.1.2/libsidplayfp-3.1.2.tar.gz',
    sha256:'6d16c20e523ac4d3e385531dafe247a830b59bcb4eb73a557f15cf4e7ae6da84', license:'GPL-2.0-or-later'}),
  libresidfp:Object.freeze({name:'libresidfp', version:'1.2.3', revision:'32c8525418a643eaed8dfafa3d7039e250050cfa',
    url:'https://github.com/libsidplayfp/libresidfp/releases/download/v1.2.3/libresidfp-1.2.3.tar.gz',
    sha256:'e9b53a984ca708c3e8d9139eb6aad6141f73ffc22d70a020f7966803f4e2f76d', license:'GPL-2.0-or-later'})
});
const serialReceiptPath = 'third_party/sid-reference/serial-filter-tables.json';
const serialReceiptSha = '2ee576ae0030e5b9fc007d4d2fc62eeb1a8982be56e6756efd7aa58bc69e074c';
const sourceInputs = ['test/helpers/sid_player_reference.cpp', 'scripts/prepare_sid_reference.mjs',
  serialReceiptPath, 'third_party/sid-reference/serial-filter-tables.patch'];
const commonFlags = ['--disable-shared', '--enable-static', '--disable-tests'];
const cxxFlags = '-O2 -std=c++17';
async function record(path) { const bytes = await readFile(path); return {bytes:bytes.length, sha256:sha(bytes)}; }
async function run(command, args, cwd, env = process.env) {
  try { return await exec(command, args, {cwd, env, maxBuffer:16 * 1024 * 1024, timeout:300000}); }
  catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n');
    throw new Error(`${command} failed${detail ? ':\n' + detail.slice(-14000) : ': ' + error.message}`, {cause:error});
  }
}
async function archive(pin, cache, offline) {
  const path = join(cache, `${pin.name}-${pin.version}.tar.gz`);
  try {
    if ((await record(path)).sha256 !== pin.sha256) throw new Error(`Pinned source archive hash mismatch: ${path}`);
    return path;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (offline) throw new Error(`Missing pinned source archive in offline mode: ${path}`);
  // curl follows official GitHub's release redirect; the pinned SHA must still match.
  const temporary = path + '.download';
  await run('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '120', pin.url, '-o', temporary], root);
  if ((await record(temporary)).sha256 !== pin.sha256) throw new Error(`Downloaded source hash mismatch: ${pin.name}`);
  await rename(temporary, path);
  return path;
}
async function inputRecords() {
  return Object.fromEntries(await Promise.all(sourceInputs.map(async path => [path, await record(join(root, path))])));
}
async function serialReceipt() {
  const bytes = await readFile(join(root, serialReceiptPath));
  if (sha(bytes) !== serialReceiptSha) throw new Error('SID reference serial initialization receipt mismatch');
  const receipt = JSON.parse(bytes);
  if (!recordsEqual(await record(join(root, receipt.diff.path)), {bytes:receipt.diff.bytes, sha256:receipt.diff.sha256}))
    throw new Error('SID reference serial initialization diff mismatch');
  return {path:serialReceiptPath, sha256:serialReceiptSha, ...receipt};
}
// The downloaded source archive stays untouched. Only its fresh build copy is
// changed, after both complete original file hashes have matched the receipt.
export async function applySidReferenceSerialTables(sourceDirectory) {
  const receipt = await serialReceipt(), pending = [];
  for (const file of receipt.files) {
    const path = join(sourceDirectory, file.path), original = await readFile(path);
    if (!recordsEqual({bytes:original.length, sha256:sha(original)}, file.before))
      throw new Error(`Pinned original filter initialization differs: ${file.path}`);
    const names = file.tables;
    const before = '#ifdef HAVE_JTHREADS\n    using sidThread = std::jthread;\n#else\n    using sidThread = std::thread;\n#endif\n\n'
      + names.map(name => `    sidThread thd${name}(filter${name});\n`).join('')
      + '\n#ifndef HAVE_JTHREADS\n' + names.map(name => `    thd${name}.join();\n`).join('') + '#endif';
    const after = '    // Tetorica external reference only: stable table initialization avoids\n'
      + '    // sharing Randomnoise.index across worker threads. DSP loops are unchanged.\n'
      + names.map(name => `    filter${name}();`).join('\n');
    const text = original.toString('utf8');
    if (text.split(before).length !== 2) throw new Error(`Expected one filter initialization block: ${file.path}`);
    const changed = Buffer.from(text.replace(before, after));
    if (!recordsEqual({bytes:changed.length, sha256:sha(changed)}, file.after))
      throw new Error(`Prepared filter initialization hash differs: ${file.path}`);
    pending.push({path, changed});
  }
  for (const {path, changed} of pending) await writeFile(path, changed);
  return receipt;
}

export async function prepareSidReference({workDir = join(root, 'build/sid-reference'), offline = false, force = false, check = false} = {}) {
  workDir = resolve(workDir);
  const binary = join(workDir, 'sid-player-reference' + (process.platform === 'win32' ? '.exe' : ''));
  const manifestPath = join(workDir, 'sid-reference-build.json');
  const cache = join(workDir, 'cache');
  await mkdir(cache, {recursive:true});
  const inputs = await inputRecords();
  const patch = await serialReceipt();
  const compilerVersion = (await run(process.env.CXX || 'c++', ['--version'], root)).stdout.trim();
  const build = {platform:process.platform, arch:process.arch, cxx:process.env.CXX || 'c++', cxxFlags,
    compilerVersion,
    configure:{libresidfp:commonFlags, libsidplayfp:[...commonFlags, '--without-exsid', '--without-usbsid']}};
  const archivePaths = {};
  for (const [name, pin] of Object.entries(SID_REFERENCE_PINS)) archivePaths[name] = await archive(pin, cache, offline || check);
  if (!force) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (!recordsEqual(manifest.inputs, inputs) || !recordsEqual(manifest.upstreams, SID_REFERENCE_PINS) || !recordsEqual(manifest.patch, patch)
          || !recordsEqual(manifest.build, build) || !recordsEqual(manifest.binary, await record(binary)))
        throw new Error('SID reference build is stale; rerun prepare_sid_reference.mjs');
      await access(binary, constants.X_OK);
      return {binary, manifest, manifestPath};
    } catch (error) { if (check) throw error; }
  } else if (check) throw new Error('--force and --check cannot be combined');
  const directory = await mkdtemp(join(workDir, 'build-'));
  const prefix = join(directory, 'install');
  for (const path of Object.values(archivePaths)) {
    const listing = (await run('tar', ['-tzf', path], directory)).stdout.trim().split('\n');
    if (listing.some(name => name.startsWith('/') || name.split('/').includes('..')))
      throw new Error('Unsafe path in pinned source archive');
    await run('tar', ['-xzf', path], directory);
  }
  await applySidReferenceSerialTables(join(directory, 'libresidfp-1.2.3'));
  const env = {...process.env, CXX:build.cxx, CXXFLAGS:cxxFlags,
    PKG_CONFIG_PATH:join(prefix, 'lib/pkgconfig')};
  for (const name of ['libresidfp', 'libsidplayfp']) {
    const source = join(directory, `${name}-${SID_REFERENCE_PINS[name].version}`);
    await run('./configure', [...build.configure[name], '--prefix=' + prefix], source, env);
    await run('make', ['-j4', 'install'], source, env);
  }
  const output = join(directory, 'sid-player-reference');
  const compileArgs = ['-std=c++17', '-O2', '-pthread', '-DHAVE_CONFIG_H',
    '-I' + join(directory, 'libsidplayfp-3.1.2/src'), '-I' + join(prefix, 'include'),
    join(root, 'test/helpers/sid_player_reference.cpp'),
    join(prefix, 'lib/libsidplayfp.a'), join(prefix, 'lib/libresidfp.a'), '-o', output];
  await run(build.cxx, compileArgs, directory, env);
  await copyFile(output, binary);
  await chmod(binary, 0o755);
  await access(binary, constants.X_OK);
  const manifest = {schemaVersion:1, product:'Tetorica external SID reference', license:'GPL-2.0-or-later',
    upstreams:SID_REFERENCE_PINS, patch, inputs, build, binary:await record(binary)};
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return {binary, manifest, manifestPath};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (const arg of process.argv.slice(2)) {
    if (arg === '--offline') options.offline = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--check') options.check = true;
    else if (arg.startsWith('--work-dir=')) options.workDir = arg.slice(11);
    else throw new Error('Usage: node scripts/prepare_sid_reference.mjs [--work-dir=PATH] [--offline] [--force|--check]');
  }
  const result = await prepareSidReference(options);
  console.log(JSON.stringify({...result, passed:true}, null, 2));
}
