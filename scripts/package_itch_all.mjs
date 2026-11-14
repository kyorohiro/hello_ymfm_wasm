// SPDX-License-Identifier: BSD-3-Clause
// One version, one build of each canonical product, two distribution selections.
import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {copyFile, lstat, mkdir, open, readFile, unlink, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const usage = 'Usage: sh scripts/package_itch_all[_for_run].sh VERSION';
async function exists(path) {
  try {await lstat(path); return true;} catch (error) {if(error.code === 'ENOENT') return false; throw error;}
}
async function regularFile(path) {
  const info = await lstat(path);
  assert(info.isFile() && !info.isSymbolicLink(), 'Expected a regular file: ' + path);
}
async function fileRecord(path) {
  await regularFile(path);
  const bytes = await readFile(path);
  return {bytes: bytes.length, sha256: hash(bytes)};
}

export function createItchBatchPlan({root = repository, version, forRun = false} = {}) {
  assert(typeof version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version),
    'Specify a VERSION of 1–80 letters, numbers, dots, underscores, + or -, starting with a letter or number.\n' + usage);
  assert.equal(typeof forRun, 'boolean', 'forRun must be boolean.');
  root = resolve(root);
  const release = join(root, 'release');
  const specs = [
    ['2a03', '2a03_synth', `tetorica_2a03_synth_${version}_itch.zip`],
    ['dmg', 'dmg_synth', `tetorica_dmg_synth_${version}_itch.zip`],
    ['huc6280', 'huc6280_synth', `tetorica_huc6280_synth_${version}_itch.zip`],
    ['scsp', 'scsp_synth', `tetorica_scsp_synth_${version}_itch.zip`],
    ['sid', 'sid_synth', `tetorica_sid_synth_${version}_itch.zip`],
    ['snes', 'snes_synth', `tetorica_sdsp_synth_${version}_itch.zip`],
    ['spu', 'spu_synth', `tetorica_spu_synth_${version}_itch.zip`],
    ['synth', 'synth', `hello_ymfm_wasm_${version}_itch_synth.zip`],
    ['vgm-analyzer', 'vgm_analyzer', `hello_ymfm_wasm_${version}_itch_vgm_analyzer.zip`],
    ['playground', 'playground', `hello_ymfm_wasm_${version}_itch_playground.zip`],
  ];
  const products = specs.map(([id, script, name]) => ({id, script: `scripts/package_itch_${script}.sh`,
    archives: [{product: id, name, browserPlayable: id !== 'playground'}]}));
  products.at(-1).archives.push({product: 'playground', name: `hello_ymfm_wasm_${version}_itch_playground_for_run.zip`, browserPlayable: true});
  return {root, version, forRun, release, products, archives: products.flatMap(p => p.archives),
    selected: products.map(p => p.id === 'playground' ? p.archives[forRun ? 1 : 0] : p.archives[0]),
    collection: join(release, `itch_all_${version}${forRun ? '_for_run' : ''}`),
    receipt: join(release, `itch_all_${version}.json`),
    logs: join(release, `itch_all_${version}_logs`), lock: join(release, `.itch_all_${version}.lock`),
    collections: [join(release, `itch_all_${version}`), join(release, `itch_all_${version}_for_run`)],
    legacyStages: ['synth', 'vgm_analyzer', 'playground'].map(id => join(release, `itch_${id}_${version}`))
      .concat(join(release, `itch_playground_${version}_for_run`))};
}

async function runPackage({root, script, version, log}) {
  const output = await open(log, 'wx');
  try {
    await new Promise((resolveDone, reject) => {
      const child = spawn('sh', [script, version], {cwd: root, stdio: ['ignore', output.fd, output.fd]});
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 ? resolveDone() : reject(Error(`exit ${code ?? signal}`)));
    });
  } finally {await output.close();}
}

async function preflight(plan) {
  for (const path of [...plan.archives.map(a => join(plan.release, a.name)), ...plan.legacyStages,
    ...plan.collections, plan.logs]) {
    if (await exists(path)) throw Error(`Batch output already exists: ${path}\nUse a new VERSION. No product build was started.`);
  }
  for (const product of plan.products) await regularFile(join(plan.root, product.script));
}

// Validate the actual ZIPs before advertising a completed batch. Child builders
// retain their own runtime, source-provenance and browser hosting checks.
function checkZips(plan) {
  execFileSync('python3', ['-c', String.raw`
import stat,sys,zipfile
for path in sys.argv[1:]:
 with zipfile.ZipFile(path) as z:
  assert z.testzip() is None, 'ZIP CRC failure: '+path
  names=set()
  for info in z.infolist():
   name=info.orig_filename
   assert name and '\\' not in name and not any(ord(c)<32 or ord(c)==127 for c in name), 'Unsafe ZIP name'
   assert not name.startswith('/') and ':' not in name.split('/')[0], 'Absolute ZIP path'
   assert all(p not in ('','.','..') for p in name.rstrip('/').split('/')), 'Unsafe ZIP path'
   assert name not in names, 'Duplicate ZIP name'
   assert not stat.S_ISLNK(info.external_attr>>16), 'ZIP symlink'
   names.add(name)
  assert 'index.html' in names and not z.getinfo('index.html').is_dir(), 'Missing root index.html: '+path
`, ...plan.archives.map(a => join(plan.release, a.name))], {stdio: ['ignore', 'pipe', 'pipe']});
}

async function verifyBatch(plan) {
  await regularFile(plan.receipt);
  const receipt = JSON.parse(await readFile(plan.receipt, 'utf8'));
  assert.equal(receipt.schemaVersion, 1, 'Unknown batch receipt format');
  assert.equal(receipt.kind, 'itch-batch-artifacts');
  assert.equal(receipt.version, plan.version);
  assert.deepEqual(receipt.artifacts?.map(({product, name, browserPlayable}) => ({product, name, browserPlayable})),
    plan.archives, 'Batch artifact plan changed');
  for (const artifact of receipt.artifacts) {
    assert.deepEqual(await fileRecord(join(plan.release, artifact.name)),
      {bytes: artifact.bytes, sha256: artifact.sha256}, 'Batch artifact changed: ' + artifact.name);
  }
  return receipt;
}

async function collect(plan, receipt) {
  const artifacts = plan.selected.map(selected => receipt.artifacts.find(a => a.name === selected.name));
  const manifest = {schemaVersion: 1, kind: 'itch-batch-collection', version: plan.version,
    variant: plan.forRun ? 'for_run' : 'download', artifacts};
  const checksums = artifacts.map(a => `${a.sha256}  ${a.name}\n`).join('');
  const guide = `Tetorica itch packages — ${plan.version}\n\n` +
    `Variant: ${plan.forRun ? 'browser upload' : 'normal distribution'}\n` +
    'Upload each product ZIP to its own itch project. This folder is not an app ZIP.\n' +
    (plan.forRun ? 'The Playground ZIP is the browser-playable _for_run build.\n' :
      'The Playground ZIP is the full downloadable source kit. Use the _for_run collection for browser hosting.\n') +
    'Other products use the same ZIP bytes in both collections.\n' +
    'manifest.json and SHA256SUMS identify this immutable shared version.\n';
  if (await exists(plan.collection)) {
    const info = await lstat(plan.collection);
    assert(info.isDirectory() && !info.isSymbolicLink(), 'Collection must be a real directory');
    await regularFile(join(plan.collection, 'manifest.json'));
    assert.deepEqual(JSON.parse(await readFile(join(plan.collection, 'manifest.json'), 'utf8')), manifest, 'Collection manifest changed');
    for (const artifact of artifacts) assert.deepEqual(await fileRecord(join(plan.collection, artifact.name)),
      {bytes: artifact.bytes, sha256: artifact.sha256}, 'Collected ZIP changed: ' + artifact.name);
    for (const [name, expected] of [['SHA256SUMS', checksums], ['README.txt', guide]]) {
      await regularFile(join(plan.collection, name));
      assert.equal(await readFile(join(plan.collection, name), 'utf8'), expected, 'Collection metadata changed: ' + name);
    }
    return artifacts;
  }
  await mkdir(plan.collection);
  for (const artifact of artifacts) {
    await copyFile(join(plan.release, artifact.name), join(plan.collection, artifact.name), constants.COPYFILE_EXCL);
    assert.deepEqual(await fileRecord(join(plan.collection, artifact.name)),
      {bytes: artifact.bytes, sha256: artifact.sha256}, 'Collected ZIP copy mismatch');
  }
  await writeFile(join(plan.collection, 'SHA256SUMS'), checksums, {flag: 'wx'});
  await writeFile(join(plan.collection, 'README.txt'), guide, {flag: 'wx'});
  await writeFile(join(plan.collection, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  return artifacts;
}

export async function packageAllItch({root = repository, version, forRun = false, runCommand = runPackage} = {}) {
  const plan = createItchBatchPlan({root, version, forRun});
  await mkdir(plan.release, {recursive: true});
  const info = await lstat(plan.release);
  assert(info.isDirectory() && !info.isSymbolicLink(), 'Release must be a real directory');
  let lock;
  try {lock = await open(plan.lock, 'wx');}
  catch (error) {if(error.code === 'EEXIST') throw Error('This VERSION is already being packaged (or has an interrupted lock): ' + plan.lock); throw error;}
  try {
    const reused = await exists(plan.receipt);
    let receipt;
    if (reused) {
      receipt = await verifyBatch(plan);
      console.log('Reusing verified itch batch: ' + version);
    } else {
      await preflight(plan);
      await mkdir(plan.logs);
      for (const [index, product] of plan.products.entries()) {
        const log = join(plan.logs, product.id + '.log');
        console.log(`[${index + 1}/${plan.products.length}] ${product.id} ${version}`);
        try {await runCommand({root: plan.root, script: join(plan.root, product.script), version, log, product: product.id});}
        catch (error) {throw Error(`Packaging failed: ${product.id} (${error.message}).\nLog: ${log}\nCompleted outputs were kept; no success receipt was written.`, {cause: error});}
      }
      for (const artifact of plan.archives) await regularFile(join(plan.release, artifact.name));
      checkZips(plan);
      receipt = {schemaVersion: 1, kind: 'itch-batch-artifacts', version, builtAt: new Date().toISOString(),
        artifacts: await Promise.all(plan.archives.map(async artifact => ({...artifact, ...await fileRecord(join(plan.release, artifact.name))})))};
      await writeFile(plan.receipt, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
    }
    const artifacts = await collect(plan, receipt);
    return {version, forRun, reused, collection: plan.collection, receipt: plan.receipt, artifacts};
  } finally {await lock.close(); await unlink(plan.lock);}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), forRun = args[0] === '--for-run';
    if (forRun) args.shift();
    if (args.length !== 1) throw Error(usage);
    const result = await packageAllItch({version: args[0], forRun});
    console.log(`Created ${result.artifacts.length} ${result.forRun ? 'browser upload' : 'normal distribution'} packages: ${result.collection}`);
    console.log('Version: ' + result.version);
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
