import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scanSidPlayerCorpus} from '../scripts/check_sid_player_hvsc.mjs';
import {PSID_MAX_FILE_BYTES} from '../tetorica_src/runtime/sid_psid.js';
import {createSidReferenceFixture} from './fixtures/sid-reference/fixture.mjs';

test('optional metadata scan uses a local synthetic corpus, reports first rejection rules and copies no program data',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'sid-metadata-audit-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const root=join(directory,'music'),out=join(directory,'report.json');
  const fixture=createSidReferenceFixture('tone'),multiple=createSidReferenceFixture('melody-filter');
  new DataView(multiple.bytes.buffer).setUint16(14,3);new DataView(multiple.bytes.buffer).setUint16(16,2);
  const cia=fixture.bytes.slice(),rsid=fixture.bytes.slice();
  new DataView(cia.buffer).setUint32(18,1);rsid.set(new TextEncoder().encode('RSID'));
  for(const path of ['GAMES/A/tone.sid','MUSICIANS/A/Someone/multi.sid','DEMOS/cia.sid','DEMOS/rsid.sid','DEMOS/large.sid','DOCUMENTS/HVSC.txt'])await mkdir(join(root,path,'..'),{recursive:true});
  await writeFile(join(root,'GAMES/A/tone.sid'),fixture.bytes);
  await writeFile(join(root,'MUSICIANS/A/Someone/multi.sid'),multiple.bytes);
  await writeFile(join(root,'DEMOS/cia.sid'),cia);await writeFile(join(root,'DEMOS/rsid.sid'),rsid);
  await writeFile(join(root,'DEMOS/large.sid'),new Uint8Array(PSID_MAX_FILE_BYTES+1));
  await writeFile(join(root,'DOCUMENTS/HVSC.txt'),'Example collection\n    Release 85\n');
  await writeFile(join(root,'ignored.bin'),fixture.bytes);await symlink(join(root,'GAMES/A/tone.sid'),join(root,'ignored-link.sid'));
  const report=await scanSidPlayerCorpus({root,out});
  assert.equal(report.total,5);assert.equal(report.supported,3);assert.equal(report.rejected,2);
  assert.equal(report.supportedMultipleSongs,1);assert.equal(report.supportedTotalSongs,5);assert.equal(report.corpus.versionHint,'Release 85');
  assert.deepEqual(report.categories.DEMOS,{total:3,supported:1,rejected:2});
  assert.equal(Object.values(report.rejections).reduce((sum,value)=>sum+value,0),2);
  assert(!Object.keys(report.rejections).some(reason=>reason.includes('CIA')));assert(Object.keys(report.rejections).some(reason=>reason.includes('RSID')));assert(Object.keys(report.rejections).some(reason=>reason.includes('PSID_LIMIT')));
  assert.equal(report.candidates.length,2);assert.equal(report.candidates[1].songs,3);
  assert(report.candidates.every(candidate=>candidate.rawRomCallPatterns===0&&candidate.sha256.length===64));
  assert(report.candidates.every(candidate=>!('program' in candidate)&&!('originalBytes' in candidate)));
  assert.deepEqual(JSON.parse(await readFile(out,'utf8')),report);
  assert.deepEqual(await readFile(join(root,'GAMES/A/tone.sid')),Buffer.from(fixture.bytes));
});

test('optional metadata scan requires an explicit local root and a bounded candidate count',async()=>{
  await assert.rejects(scanSidPlayerCorpus(),TypeError);
  for(const candidateCount of [0,-1,51,Infinity,'10',1.5])await assert.rejects(scanSidPlayerCorpus({root:'.',candidateCount}),RangeError);
});
