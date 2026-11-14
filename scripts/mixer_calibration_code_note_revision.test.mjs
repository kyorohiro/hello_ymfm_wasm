// Actual runtime and deterministic fake ports; never constructs audio devices.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createPlaygroundCodeRuntime as current} from '../tetorica_src/runtime/playground_code_runtime.js';
import {CODE_NOTE_REVISION_PATHS as paths,CODE_NOTE_REVISION_RECEIPT_PATH as path,
  CODE_NOTE_REVISION_RECEIPT_OBJECT_SHA256 as pin,restoreMixerCalibrationCodeNoteRevision as restore} from './mixer_calibration_code_note_revision.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(path));
const beforeBytes=restore(paths[0],read(paths[0]));
const beforeSource=beforeBytes.toString().replace(/from '(\.\/[^']+)'/g,(_all,relative)=>`from '${new URL('../tetorica_src/runtime/'+relative,import.meta.url).href}'`);
const {createPlaygroundCodeRuntime:previous}=await import('data:text/javascript;base64,'+Buffer.from(beforeSource).toString('base64'));
const turns=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
function fixture(create,options={}) {
  const calls=[],timers=new Map();let serial=0,time=0;
  const client={noteOn:async(...args)=>calls.push(['noteOn',...args]),keyOn:async(...args)=>calls.push(['keyOn',...args]),noteOff:async(...args)=>calls.push(['noteOff',...args]),keyOff:async(...args)=>calls.push(['keyOff',...args]),releaseNote:async(...args)=>calls.push(['releaseNote',...args])};
  client.wave={keyOn:async()=>calls.push(['wave.keyOn']),keyOff:async()=>calls.push(['wave.keyOff'])};
  const runtime=create({ensureReady:async()=>{},now:()=>time,useSoundChip:async()=>client,supportedSoundChips:['ym2612'],
    stopSoundChips:async()=>calls.push(['hostStop']),guardExecution:false,realm:{},createTaskChannel:()=>null,
    setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:time+ms/1000});return id;},clearTimer:id=>timers.delete(id),...options});
  async function advance(seconds) {
    time+=seconds;
    for(let n=0;n<100;n++) {
      await turns();const next=[...timers].sort(([,a],[,b])=>a.at-b.at).find(([,timer])=>timer.at<=time);
      if(!next)return;timers.delete(next[0]);next[1].fn();
    }
    throw Error('Unbounded test timer dispatch');
  }
  return {client,runtime,calls,timers,advance};
}
async function defaultProbe(create) {
  const f=fixture(create);
  try {
    await f.runtime.run(`const chip=await useSoundChip('ym2612');context.keep=17;
      liveLoop('old',async()=>{await chip.noteOn(CH1,'C4');await sleep(10);});
      liveLoop('other',async()=>{await chip.keyOn(CH2);await sleep(10);});`);await f.advance(0.5);
    await f.runtime.apply(`const chip=await useSoundChip('ym2612');liveLoop('old',async()=>{await sleep(10);});
      liveLoop('new',async()=>{await chip.noteOn(CH1,'E4');await sleep(10);});`);await f.advance(0.5);
    await f.runtime.apply(`stopLoop('old');liveLoop('new',async()=>{await sleep(10);});`);await turns();
    await f.runtime.apply(`stopLoop('other');stopLoop('new');`);await turns();
    await f.runtime.apply(`const chip=await useSoundChip('ym2612');await chip.noteOn(CH3,'G4');await chip.releaseNote(CH3);await chip.noteOff('invalid');`);
    const context=f.runtime.getContext(),result={calls:[...f.calls],state:f.runtime.getState(),keep:context.keep};
    await f.runtime.stop();result.stoppedCalls=[...f.calls];result.stopped=f.runtime.getState();return result;
  }finally{await f.runtime.dispose?.();}
}

test('exact two runtime bodies restore the prior VAB dependencies without changing either historical receipt',()=>{
  assert.equal(sha(JSON.stringify(receipt)),pin);assert.equal(read(path).toString(),JSON.stringify(receipt,null,2)+'\n');
  assert.deepEqual(read(paths[0]),read(paths[1]));
  const old=JSON.parse(read('docs/issues/ps1_vab_public_api_source_revision_01.json'));
  for(const path of paths) {
    const bytes=read(path),original=restore(path,bytes),entry=receipt.sources[path];
    assert.notEqual(original,bytes);assert.equal(original.length,entry.before.bytes);assert.equal(sha(original),entry.before.sha256);
    assert.deepEqual(entry.before,old.relatedSources[path].after);assert.equal(restore(path,original),original);
    const changed=Buffer.from(bytes);changed[Math.floor(changed.length/2)]^=1;
    for(const future of [changed,Buffer.concat([bytes,Buffer.from('\n')]),Buffer.from(bytes.toString().replace('resolveNoteTarget(target,key,args)','resolveNoteTarget(target,key,[])'))])assert.equal(restore(path,future),future);
    for(const other of ['__proto__','js/playground_code_runtime.js','generated/huc6280_wasm.wasm','docs/js/other.js'])assert.equal(restore(other,bytes),bytes);
  }
});

test('default callback retains actual runtime Run/Apply, physical Gate ownership, Stop Loop and Stop behavior',async()=>{
  const before=await defaultProbe(previous),after=await defaultProbe(current);
  assert.deepEqual(after,before);assert.equal(after.keep,17);
  assert(after.calls.some(call=>call[0]==='noteOff'&&call[1]===0));
  assert(after.calls.some(call=>call[0]==='noteOff'&&call[1]===1));
});

test('explicit alias resolver protects a newer physical Gate and releases its current owner once',async()=>{
  let f;f=fixture(current,{resolveNoteTarget:(target,_method,args)=>target===f.client.wave?{target:f.client,channel:2}:Number.isInteger(args[0])?{target,channel:args[0]}:null});
  try {
    await f.runtime.run(`const chip=await useSoundChip('ym2612');liveLoop('old',async()=>{await chip.wave.keyOn();await sleep(10);});`);await f.advance(0.5);
    await f.runtime.apply(`const chip=await useSoundChip('ym2612');liveLoop('old',async()=>{await sleep(10);});liveLoop('new',async()=>{await chip.noteOn(CH3,'E4');await sleep(10);});`);await f.advance(0.5);
    const before=f.calls.length;await f.runtime.apply(`stopLoop('old');liveLoop('new',async()=>{await sleep(10);});`);await turns();
    assert.equal(f.calls.length,before,'an older alias cannot release a replacement Gate: '+JSON.stringify(f.calls));
    await f.runtime.apply(`stopLoop('new');`);await turns();
    assert.deepEqual(f.calls.at(-1),['noteOff',2]);
  }finally{await f.runtime.stop();}
});
