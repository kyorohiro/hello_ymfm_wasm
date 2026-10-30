// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectPsfFolder,runPsfInspection} from './inspect_psf_banks.mjs';
import {createPsfFixture,makePsf} from '../test/helpers/spu_psf_fixture.mjs';

async function folder(t) {
  const dir=await mkdtemp(join(tmpdir(),'inspect-psf-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));return dir;
}
async function fixtureFolder(t) {
  const dir=await folder(t),fixture=createPsfFixture();
  for(const file of fixture.files) {
    const path=join(dir,file.webkitRelativePath);
    await mkdir(dirname(path),{recursive:true});await writeFile(path,Buffer.from(await file.arrayBuffer()));
  }
  await writeFile(join(dir,'README.txt'),'ignored');return {dir,fixture};
}

test('folder inspection retains MiniPSF relative dependencies, all banks and sparse Tone IDs without sample payloads',async t=>{
  const {dir,fixture}=await fixtureFolder(t),report=await inspectPsfFolder(dir);
  assert.deepEqual(report.summary,{withBanks:1,withoutBanks:0,errors:0});
  assert.equal(report.files.length,3);assert.equal(report.entriesScanned,1);
  const result=report.results[0];assert.equal(result.entry,'Demo/track.minipsf');
  assert.deepEqual(result.loadedFiles,['Demo/lib/Bank.psflib','Demo/track.minipsf','Demo/patch.psflib']);
  assert.deepEqual(result.banks.map(b=>b.address),['0x80010000','0x80020000']);
  assert.deepEqual(result.banks[0].firstPlayableTone,{listIndex:0,program:3,tone:0,sample:1});
  assert.equal(result.banks[0].tones,3);assert.equal(result.banks[0].playableTones,3);
  assert.equal(report.files.find(f=>f.path.endsWith('Bank.psflib')).sha256,createHash('sha256').update(fixture.library).digest('hex'));
  assert(!JSON.stringify(report).includes('adpcm'));assert(!JSON.stringify(report).includes(dir));
  assert.deepEqual(await inspectPsfFolder(dir),report,'Reports are deterministic');
});

test('per-entry dependency failure and valid no-bank result are distinct and do not prevent scanning other entries',async t=>{
  const {dir,fixture}=await fixtureFolder(t);
  await writeFile(join(dir,'good.psf'),fixture.standalone);
  await writeFile(join(dir,'missing.minipsf'),fixture.mini);
  await writeFile(join(dir,'empty.psf'),makePsf(new Uint8Array(16)));
  const report=await inspectPsfFolder(dir);
  assert.deepEqual(report.summary,{withBanks:2,withoutBanks:1,errors:1});
  assert.equal(report.results.find(r=>r.entry==='empty.psf').status,'no-bank');
  assert.match(report.results.find(r=>r.entry==='missing.minipsf').error,/missing PSFLib/);
  const selected=await inspectPsfFolder(dir,{entry:'Demo\\track.minipsf'});
  assert.equal(selected.entriesInSet,4);assert.equal(selected.entriesScanned,1);
  await assert.rejects(inspectPsfFolder(dir,{entry:'absent.psf'}),/Unknown PSF entry/);
});

test('unsupported sample makes its Tones unavailable while the bank and first playable Tone remain visible',async t=>{
  const dir=await folder(t),{createVabFixture}=await import('../test/helpers/spu_vab_fixture.mjs');
  const {vab,vh}=createVabFixture();vab[vh.length+16]=0xf0;
  await writeFile(join(dir,'bank.psf'),makePsf(vab));
  const bank=(await inspectPsfFolder(dir)).results[0].banks[0];
  assert.equal(bank.playableTones,1);assert.equal(bank.unavailableTones,2);
  assert.deepEqual(bank.firstPlayableTone,{listIndex:2,program:11,tone:0,sample:2});
  assert.equal(bank.unavailableReasons[0].tones,2);
});

test('symbolic links to files and directories are ignored instead of importing outside the selected set',async t=>{
  const dir=await folder(t),outside=await folder(t),{standalone}=createPsfFixture();
  await writeFile(join(dir,'local.psf'),standalone);await writeFile(join(outside,'foreign.psf'),standalone);
  await symlink(join(outside,'foreign.psf'),join(dir,'foreign.psf'));await symlink(outside,join(dir,'foreign-dir'));
  assert.deepEqual((await inspectPsfFolder(dir)).files.map(f=>f.path),['local.psf']);
  await assert.rejects(inspectPsfFolder(join(dir,'foreign-dir')),/Expected a directory/);
});

test('input budgets and CRC validation reject invalid sets before returning a partial compatibility report',async t=>{
  const dir=await folder(t),{standalone}=createPsfFixture(),bad=standalone.slice();bad[12]^=1;
  await writeFile(join(dir,'bad.psf'),bad);await assert.rejects(inspectPsfFolder(dir),/CRC/);
  await writeFile(join(dir,'bad.psf'),Buffer.alloc(4*1024*1024+1));await assert.rejects(inspectPsfFolder(dir),/4 MiB/);
  await rm(join(dir,'bad.psf'));await assert.rejects(inspectPsfFolder(dir),/select 1/);
});

test('CLI writes metadata JSON and uses an error exit for partial failures, while no-bank is a successful inspection',async t=>{
  const {dir,fixture}=await fixtureFolder(t),out=join(dir,'report.json'),messages=[],errors=[];
  const io={stdout:s=>messages.push(s),stderr:s=>errors.push(s)};
  assert.equal(await runPsfInspection([dir,'--out',out],io),0);
  assert.deepEqual(JSON.parse(await readFile(out,'utf8')),JSON.parse(messages.pop()));
  await writeFile(join(dir,'missing.minipsf'),fixture.mini);
  assert.equal(await runPsfInspection([dir],io),1);assert.equal(JSON.parse(messages.pop()).summary.errors,1);
  await writeFile(join(dir,'empty.psf'),makePsf(new Uint8Array(16)));
  assert.equal(await runPsfInspection([dir,'--entry','empty.psf'],io),0);
  assert.equal(JSON.parse(messages.pop()).results[0].status,'no-bank');assert.deepEqual(errors,[]);
});

test('CLI help and invalid arguments do not overwrite PSF input files',async t=>{
  const {dir,fixture}=await fixtureFolder(t),io={stdout:()=>{},stderr:()=>{}};
  assert.equal(await runPsfInspection(['--help'],io),0);
  for(const args of [[],[dir,'--entry'],[dir,'--bad','x'],[dir,'--out','a','--out','b']])assert.equal(await runPsfInspection(args,io),1);
  const input=join(dir,'Demo/track.minipsf');
  assert.equal(await runPsfInspection([dir,'--out',input],io),1);
  assert.deepEqual(await readFile(input),Buffer.from(fixture.mini));
});
