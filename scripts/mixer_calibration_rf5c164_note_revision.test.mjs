// Calibration provenance and PCM arrays only. No AudioContext/audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {restoreMixerCalibrationRf5c164NoteRevision as restore,RF5C164_NOTE_REVISION_BASE_COMMIT as commit,
  RF5C164_NOTE_REVISION_RECEIPT_PATH as receiptPath,RF5C164_NOTE_REVISION_RECEIPT_OBJECT_SHA256 as pin,
  RF5C164_NOTE_REVISION_SOURCE_PATHS as paths,RF5C164_NOTE_REVISION_REPORT_PATHS as reports} from './mixer_calibration_rf5c164_note_revision.mjs';
import {assertMixerCalibrationSourceFreshness} from './mixer_calibration_sources.mjs';
import {RF5C164Synth} from '../tetorica_src/runtime/rf5c164synth.js';
import {sampleBytes} from '../tetorica_src/runtime/rf5c164_pcm.js';
import {Rf5c164} from '../tetorica_src/runtime/rf5c164.js';
import factory from '../docs/generated/rf5c164_wasm.js';

const read=path=>readFile(new URL('../'+path,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(await read(receiptPath));

test('all 44 exact known after sources reconstruct complete pre-feature bodies and retain original reports/gains',async()=>{
  assert.equal(sha(JSON.stringify(receipt)),pin);assert.equal(receipt.baseCommit,commit);
  assert.equal(paths.length,44);assert.deepEqual(Object.keys(receipt.sources).sort(),[...paths].sort());
  for(const path of paths) {
    const current=await read('docs/'+path),entry=receipt.sources[path];
    assert.equal(current.length,entry.after.bytes,path);assert.equal(sha(current),entry.after.sha256,path);
    const before=restore(path,current);assert.notEqual(before,current,path);
    assert.equal(before.length,entry.before.bytes,path);assert.equal(sha(before),entry.before.sha256,path);
    assert.equal(assertMixerCalibrationSourceFreshness({path,bytes:current,record:entry.before}),'rf5c164-note-api',path);
    assert.equal(restore(path,before),before,'already pre-feature bytes remain unchanged');
  }
  for(const path of reports) {
    const bytes=await read(path),report=JSON.parse(bytes);assert.equal(bytes.length,receipt.reports[path].bytes,path);assert.equal(sha(bytes),receipt.reports[path].sha256,path);
    for(const [source,record]of Object.entries(report.sources)){
      const current=await read('docs/'+source);assert.doesNotThrow(()=>assertMixerCalibrationSourceFreshness({path:source,bytes:current,record,report}),source);
    }
    assert.deepEqual(await read(path),bytes,'source validation cannot rewrite the measurement');
  }
});

test('later body/cache/import edits and unknown paths cannot borrow this exact revision',async()=>{
  for(const path of paths) {
    const current=await read('docs/'+path),sameLength=Buffer.from(current);sameLength[Math.floor(current.length/2)]^=1;
    for(const changed of [sameLength,Buffer.concat([current,Buffer.from('\n')]),Buffer.from(current.toString().replace('rf5c164-notes-1','rf5c164-notes-2'))]) {
      if(changed.equals(current))continue;
      assert.equal(restore(path,changed),changed,path);
      assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes:changed,record:receipt.sources[path].before}),/remeasure/,path);
    }
  }
  const bytes=await read('docs/js/rf5c164synth.js'),record=receipt.sources['js/rf5c164synth.js'].before;
  for(const path of ['js/other.js','js/rf5c164_notes.js','generated/rf5c164_wasm.wasm','js/soundchip_mixer_presets.js']) {
    assert.equal(restore(path,bytes),bytes,path);assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes,record}),/remeasure/,path);
  }
});

test('changing only the new note helper or the receipt fails the independently pinned dependency audit',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'rf-note-revision-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const modulePath=join(directory,'scripts/mixer_calibration_rf5c164_note_revision.mjs'),jsonPath=join(directory,receiptPath),notePath=join(directory,'docs/js/rf5c164_notes.js');
  await mkdir(dirname(modulePath),{recursive:true});await mkdir(dirname(jsonPath),{recursive:true});await mkdir(dirname(notePath),{recursive:true});
  await writeFile(modulePath,await read('scripts/mixer_calibration_rf5c164_note_revision.mjs'));await writeFile(jsonPath,await read(receiptPath));
  const notes=await read('docs/js/rf5c164_notes.js');await writeFile(notePath,notes);
  const isolated=await import(pathToFileURL(modulePath)),path='js/rf5c164synth.js',current=await read('docs/'+path);
  assert.equal(sha(isolated.restoreMixerCalibrationRf5c164NoteRevision(path,current)),receipt.sources[path].before.sha256);
  await writeFile(notePath,Buffer.concat([notes,Buffer.from('\n')]));
  assert.throws(()=>isolated.restoreMixerCalibrationRf5c164NoteRevision(path,current),/added note helper changed/,'a dependency absent from old measurements is still mandatory');
  await writeFile(notePath,notes);const changed=structuredClone(receipt);changed.sources[path].after.sha256='0'.repeat(64);await writeFile(jsonPath,JSON.stringify(changed));
  const untrusted=await import(pathToFileURL(modulePath).href+'?changed-receipt');
  assert.throws(()=>untrusted.restoreMixerCalibrationRf5c164NoteRevision(path,current),/independently pinned SHA/);
});

test('the reconstructed old RF class and current raw API emit identical register traces and real WASM stereo arrays',async()=>{
  const before=restore('js/rf5c164synth.js',await read('docs/js/rf5c164synth.js'));
  const OldSynth=vm.runInNewContext(before.toString().replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\nRF5C164Synth;',
    {sampleBytes,Uint8Array,ArrayBuffer,Math,Number,RangeError,TypeError});
  const wasmBinary=await read('docs/generated/rf5c164_wasm.wasm');
  for(const sampleRate of [44100,48000]) {
    const make=async Type=>{
      const chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate}),writes=[];
      const api=new Type({transport:{write:(register,value)=>{writes.push([register,value]);chip.writeRegister(register,value);},loadMemory:(...args)=>chip.loadMemory(...args),reset:()=>chip.reset()}});
      return {api,chip,writes};
    };
    const old=await make(OldSynth),current=await make(RF5C164Synth),both=[old,current];
    const render=frames=>assert.deepEqual(current.chip.generateStereo(frames),old.chip.generateStereo(frames),`raw PCM ${sampleRate}/${frames}`);
    try {
      for(const {api}of both) {
        api.reset();const bank=new Uint8Array(65536).fill(255);
        for(let ch=0;ch<8;ch++)for(let i=0;i<256;i++){const value=.6*Math.sin(i*Math.PI*2/256);bank[ch*512+i]=Math.round(Math.abs(value)*126)|(value>=0?128:0);}
        api.loadMemory(bank);
        for(let ch=0;ch<8;ch++){api.setChannel(ch,{start:ch*512,loopStart:ch*512,step:1800+ch*333,volume:24,pan:{left:15-ch,right:ch+1}});api.keyOn(ch);}
      }
      for(const frames of [1,127,513,4096])render(frames);
      for(const {api}of both){api.setPitch(2,65535);api.keyOff(5);api.setChannel(0,{volume:77,pan:{left:0,right:15}});api.keyOn(7);api.writeRegister(7,0x8f);api.writeRegister(2,33);api.writeRegister(3,17);}
      render(1537);
      for(const {api}of both)api.writeRegister(7,0x0f);render(137);
      for(const {api}of both){api.writeRegister(7,0xc7);api.writeRegister(8,0x55);}render(3071);
      for(const {api}of both){api.reset();api.setChannel(7,{start:0,loopStart:0,step:2048,volume:91,pan:{left:15,right:15}});api.keyOn(7);}render(4097);
      assert.deepEqual(current.writes,old.writes,'private note tracking cannot change any legacy raw register write');
      for(const address of [0,255,256,512,1024,4095,65535])assert.equal(current.chip.readMemory(address),old.chip.readMemory(address));
    } finally {current.chip.dispose();old.chip.dispose();}
  }
});
