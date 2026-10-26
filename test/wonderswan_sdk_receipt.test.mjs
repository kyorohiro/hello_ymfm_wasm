import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,copyFile,rm,mkdir,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyWonderSwanBuildReceipt} from '../scripts/check_wonderswan_core.mjs';
import {parseWonderSwanParityArguments,validateWonderSwanParityPaths} from '../scripts/check_wonderswan_wasm_sdk.mjs';

const generated=new URL('../docs/generated/',import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'wonderswan receipt '));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const common=JSON.parse(await readFile(new URL('build-info.json',generated),'utf8'));
  const record=common.artifacts.find(entry=>entry.id==='wonderswan');
  assert(record,'Built SDK WonderSwan receipt is required');
  const receipt={schemaVersion:1,artifacts:[record]};
  for(const name of ['wonderswan_wasm.js','wonderswan_wasm.wasm'])
    await copyFile(new URL(name,generated),join(directory,name));
  const save=()=>writeFile(join(directory,'build-info.json'),JSON.stringify(receipt));
  await save();return {directory,record,save};
}

test('real SDK recipe and output audit accepts a single built WonderSwan artifact',async t=>{
  const {directory}=await fixture(t);
  const result=await verifyWonderSwanBuildReceipt(directory);
  assert.equal(result.scope,'pinned-sdk');assert.equal(result.sourceInputsVerified,true);
  assert(result.coreDirectory.endsWith('tetorica-soundchip-native/vendor/mame-wonderswan'));
});

test('output mutation fails the receipt audit before generated JS is imported',async t=>{
  const {directory}=await fixture(t);
  await writeFile(join(directory,'wonderswan_wasm.js'),'throw new Error("must not execute");');
  await assert.rejects(verifyWonderSwanBuildReceipt(directory),/wonderswan_wasm.js receipt size|wonderswan_wasm.js receipt SHA/);
});

test('a recomputed fingerprint cannot hide a forged or missing pinned recipe input',async t=>{
  const {directory,record,save}=await fixture(t);
  const original=structuredClone(record.sourceFiles);
  record.sourceFiles[0].sha256='0'.repeat(64);
  record.sourceFingerprint=hash(JSON.stringify(record.sourceFiles));await save();
  await assert.rejects(verifyWonderSwanBuildReceipt(directory),/complete pinned SDK build input inventory/);
  record.sourceFiles=original.slice(1);record.sourceFingerprint=hash(JSON.stringify(record.sourceFiles));await save();
  await assert.rejects(verifyWonderSwanBuildReceipt(directory),/complete pinned SDK build input inventory/);
});

test('parity command rejects ambiguous directories and overwriting receipt/PCM inputs',()=>{
  assert.throws(()=>parseWonderSwanParityArguments(['--legacy-dir','/a','--sdk-dir','/a']),/distinct build/);
  assert.throws(()=>parseWonderSwanParityArguments(['--legacy-dir','/a','--sdk-dir','/b','--out','/b/build-info.json']),/overwrite/);
  assert.throws(()=>parseWonderSwanParityArguments(['--legacy-dir','/a','--legacy-dir','/c','--sdk-dir','/b']),/Duplicate/);
});

async function pathFixture(t){
  const directory=await mkdtemp(join(tmpdir(),'wonderswan paths '));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const legacy=join(directory,'legacy'),sdk=join(directory,'sdk');
  await mkdir(legacy);await mkdir(sdk);
  const argumentsFor=out=>({'--legacy-dir':legacy,'--sdk-dir':sdk,...(out?{'--out':out}:{})});
  return {directory,legacy,sdk,argumentsFor};
}

test('canonical path guard rejects directory aliases and nested inputs without loading a module',async t=>{
  const {directory,legacy,argumentsFor}=await pathFixture(t);
  const alias=join(directory,'legacy alias');await symlink(legacy,alias,'dir');
  await assert.rejects(validateWonderSwanParityPaths({...argumentsFor(),'--sdk-dir':alias}),/nonoverlapping.*symlink/);
  const nested=join(legacy,'nested');await mkdir(nested);
  await assert.rejects(validateWonderSwanParityPaths({...argumentsFor(),'--sdk-dir':nested}),/nonoverlapping/);
});

test('canonical report guard handles absent parents below a symlink to an input',async t=>{
  const {directory,legacy,argumentsFor}=await pathFixture(t);
  const alias=join(directory,'input alias');await symlink(legacy,alias,'dir');
  await assert.rejects(validateWonderSwanParityPaths(argumentsFor(join(alias,'absent','parents','report.json'))),/outside both input/);
  await assert.rejects(validateWonderSwanParityPaths(argumentsFor(join(legacy,'other-name.json'))),/outside both input/);
});

test('report symlinks, existing files and pinned/current source destinations are protected',async t=>{
  const {directory,argumentsFor}=await pathFixture(t);
  const existing=join(directory,'existing.json');await writeFile(existing,'preserve');
  const alias=join(directory,'report.json');await symlink(existing,alias,'file');
  await assert.rejects(validateWonderSwanParityPaths(argumentsFor(alias)),/must not be a symlink/);
  await assert.rejects(validateWonderSwanParityPaths(argumentsFor(existing)),/already exists/);
  assert.equal(await readFile(existing,'utf8'),'preserve');
  const missingAlias=join(directory,'dangling.json');await symlink(join(directory,'absent.json'),missingAlias,'file');
  await assert.rejects(validateWonderSwanParityPaths(argumentsFor(missingAlias)),/must not be a symlink/);
  const source=fileURLToPath(new URL('../scripts/check_wonderswan_wasm_sdk.mjs',import.meta.url));
  const before=await readFile(source);
  await assert.rejects(validateWonderSwanParityPaths(argumentsFor(source)),/already exists/);
  assert.deepEqual(await readFile(source),before);
  const pinned=fileURLToPath(new URL('../third_party/tetorica-soundchip-native/wasm/wonderswan_wasm.cpp',import.meta.url));
  await assert.rejects(validateWonderSwanParityPaths(argumentsFor(pinned)),/pinned SDK source/);
});

test('optional report and fresh external report with absent parents stay usable',async t=>{
  const {directory,legacy,sdk,argumentsFor}=await pathFixture(t);
  assert.deepEqual(await validateWonderSwanParityPaths(argumentsFor()),
    {'--legacy-dir':await realpath(legacy),'--sdk-dir':await realpath(sdk)});
  const out=join(directory,'new','subdirectory','report.json');
  assert.equal((await validateWonderSwanParityPaths(argumentsFor(out)))['--out'],
    join(await realpath(directory),'new','subdirectory','report.json'));
});

test('CLI exits on unsafe paths before attempting receipts, generated JS or PCM',async t=>{
  // These directories deliberately contain no modules or receipts. Getting a
  // path-guard error proves the CLI checks paths before it enters the backend.
  const {directory,legacy,sdk}=await pathFixture(t);
  const alias=join(directory,'alias');await symlink(legacy,alias,'dir');
  const script=fileURLToPath(new URL('../scripts/check_wonderswan_wasm_sdk.mjs',import.meta.url));
  for(const [sdkPath,out,expected] of [[alias,null,/nonoverlapping build directories/],
    [sdk,join(alias,'missing','report.json'),/outside both input directories/],
    [sdk,script,/already exists/]]){
    assert.throws(()=>execFileSync(process.execPath,[script,'--legacy-dir',legacy,'--sdk-dir',sdkPath,
      ...(out?['--out',out]:[])],{encoding:'utf8',stdio:'pipe'}),
    error=>error.status===1&&expected.test(error.stderr)&&!error.stderr.includes('ENOENT'));
  }
});
