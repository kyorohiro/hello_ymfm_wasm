import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboyInstrument} from './instrument.js';
import {createGameboyCodeClient} from './code_endpoint.js';
import {createGameboySongAudition} from './song_audition.js';
import {createGameboyRegisterState} from './song_state.js';
import {createDmgSongFixture} from '../../test/helpers/dmg_synth_song_fixture.mjs';

const wasmBinary=await readFile(new URL('../generated/gameboy_apu_wasm.wasm',import.meta.url));
function snapshot(){
  const state=createGameboyRegisterState();
  for(const {writes}of createDmgSongFixture().events.slice(0,1))for(let i=0;i<writes.length;i+=3)state.write(writes[i+1],writes[i+2]);
  state.write(0,0x22);return state.snapshot(6000);
}
async function setup(t,channel=0){
  const core=await GameboyApu.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000}),instrument=new GameboyInstrument(core);
  const author=instrument.read().preset;author.source='wave';author.wave.samples=Array.from({length:32},(_,i)=>i%2?3:13);author.pan={left:false,right:true};instrument.loadPreset(author);
  const writes=[],original=core.writeRegister.bind(core);core.writeRegister=(...args)=>{writes.push(args);return original(...args);};
  const calls=[],outputs=[],owners=[];let generation=0,owner=null,holdMethod=null,releaseMethod=null,holdBegin=false,releaseBegin=null;
  const engine={context:{},codeFadeNode:{gain:{value:1}},async getGameboyClient(){
    if(owner&&!owner.closed)return owner.promise;
    const metadata=instrument.beginCode(),item={generation:++generation,closed:false,released:null,metadata,expected:null};owner=item;owners.push(item);
    const saved=core.saveState();item.expected=core.generateStereo(1024);core.loadState(saved);
    const current=()=>owner===item&&!item.closed;
    const client=createGameboyCodeClient({metadata,isCurrent:current,
      ownsOutput:()=>current()||owner===null&&item.released===generation,
      invoke(method,args){
        calls.push([method,...args]);
        const apply=()=>instrument.code(metadata.session,method,args);
        if(method===holdMethod){holdMethod=null;return new Promise((resolve,reject)=>{releaseMethod=()=>{try{resolve(apply());}catch(error){reject(error);}};});}
        return Promise.resolve().then(apply);
      },
      async dispose(){
        if(!current()){const error=new Error('stale');error.name='AbortError';throw error;}
        item.closed=true;calls.push(['dispose']);instrument.code(metadata.session,'dispose',[]);
        if(owner===item){owner=null;item.released=++generation;}
      },
    });
    item.client=client;
    item.promise=holdBegin?new Promise(resolve=>{holdBegin=false;releaseBegin=()=>resolve(client);}):Promise.resolve(client);
    return item.promise;
  }};
  let selected={key:`source:6000:${channel}`,snapshot:snapshot(),channel};
  const createOutput=({getContext,getGain})=>{
    const output={events:[],async fadeOut(){const gain=getGain();this.events.push(['fade',Boolean(getContext()),Boolean(gain)]);if(gain)gain.gain.value=0;},
      open(options){const gain=getGain();this.events.push(['open',Boolean(gain),options]);if(gain)gain.gain.value=1;},
      dispose(){const gain=getGain();this.events.push(['dispose',Boolean(gain)]);if(gain)gain.gain.value=0;}};
    outputs.push(output);return output;
  };
  const audition=createGameboySongAudition({ensureAudio:async()=>engine,getAudio:()=>engine,getSelection:()=>selected,createOutput});
  t.after(async()=>{await audition.dispose();instrument.dispose();});
  return{core,instrument,engine,audition,writes,calls,outputs,owners,author,
    select(ch){selected={key:`source:6000:${ch}`,snapshot:snapshot(),channel:ch};},clearSelection(){selected=null;},
    block(method){holdMethod=method;},blockBegin(){holdBegin=true;},
    get blocked(){return Boolean(releaseMethod||releaseBegin);},release(){const callback=releaseMethod??releaseBegin;releaseMethod=releaseBegin=null;callback?.();},
    async externalCode(){instrument.stop();if(owner)owner.closed=true;owner=null;generation++;return engine.getGameboyClient();},
  };
}
async function until(check){for(let i=0;i<100;i++){if(check())return;await Promise.resolve();}assert.fail('Expected asynchronous preparation boundary');}

for(const channel of [0,1,2,3])test(`paused CH${channel+1} uses one editor APU, configures the selected source, and restores the native author checkpoint`,async t=>{
  const f=await setup(t,channel),before=f.instrument.read(),handle=f.core.handle;
  assert.deepEqual(await f.audition.noteOn('key',60),{channel,stolenId:null});
  const live=f.instrument.observeCode();assert(live);assert.equal(f.core.handle,handle);assert.deepEqual(f.instrument.read(),before);
  assert.equal(f.audition.read().heldCount,1);assert.equal(f.audition.read().soundingCount,1);
  const pcm=f.instrument.generateStereo(4096);assert(pcm.left.every(Number.isFinite));assert(pcm.right.every(Number.isFinite));
  assert(pcm.left.some(value=>Math.abs(value)>.0001));assert(pcm.right.some(value=>Math.abs(value)>.0001));
  const dacs=[live.registers[2]&0xf8,live.registers[7]&0xf8,live.registers[10]&128,live.registers[17]&0xf8];
  assert(dacs[channel]);for(let ch=0;ch<4;ch++)if(ch!==channel)assert.equal(dacs[ch],0,'unselected source DAC stays off');
  if(channel===0)assert.equal(live.voice[0],0x22);else assert.equal(live.voice[0],0,'CH2/Wave/Noise do not inherit CH1 Sweep');
  if(channel===2)assert.deepEqual(live.registers.slice(32),snapshot().registers.slice(32));
  if(channel===3){assert.equal(live.voice[18],snapshot().voice[18]);assert(!f.calls.some(call=>call[0]==='setFrequency'));}
  await f.audition.noteOff('key');assert.equal(f.audition.read().soundingCount,0);assert.equal(f.engine.codeFadeNode.gain.value,0);
  await f.audition.stop();assert.equal(f.instrument.observeCode(),null);assert.deepEqual(f.instrument.read(),before);
  assert.deepEqual(f.core.generateStereo(1024),f.owners[0].expected,'all native envelope/clock/Wave RAM state is restored exactly');
  assert.equal(f.engine.codeFadeNode.gain.value,1,'only the restored neutral author route reopens');
  assert.deepEqual(f.outputs[0].events.at(-1),['dispose',false],'disposing our fader cannot close the reopened author');
});

test('newest key wins on the same physical channel; stale Key Up and out-of-range replacement cannot stop it',async t=>{
  const f=await setup(t,1);await f.audition.noteOn('old',60);assert.deepEqual(await f.audition.noteOn('new',64),{channel:1,stolenId:'old'});
  const count=f.calls.length;assert.equal(await f.audition.noteOff('old'),false);assert.equal(f.calls.length,count);
  assert.throws(()=>f.audition.noteOn('bad',0),/frequency range/);assert.equal(f.audition.read().heldCount,1);assert.equal(f.audition.read().soundingCount,1);
  assert.equal(f.owners.length,1);await f.audition.noteOff('new');assert.equal(f.audition.read().soundingCount,0);
});

test('releasing a quickly cancelled replacement and release-all cannot orphan the stolen predecessor Gate',async t=>{
  const f=await setup(t,0);await f.audition.noteOn('old',60);
  const pending=f.audition.noteOn('quick',64),up=f.audition.noteOff('quick');
  assert.equal(await pending,null);await up;assert.equal(f.audition.read().soundingCount,0);
  assert.equal(f.instrument.observeCode().registers[2]&0xf8,0);
  await f.audition.noteOn('again',60);const queued=f.audition.noteOn('replacement',67);const all=f.audition.allNotesOff();
  assert.equal(await queued,null);await all;assert.equal(f.audition.read().soundingCount,0);assert.equal(f.instrument.observeCode().registers[2]&0xf8,0);
});

test('Pitch changes only frequency registers without a new trigger; Noise accepts all MIDI keys and ignores musical Pitch',async t=>{
  const pulse=await setup(t,0);await pulse.audition.noteOn('tone',60);pulse.writes.length=0;
  await pulse.audition.setPitch(2);assert(pulse.writes.length>0);assert(pulse.writes.every(([reg,value])=>[3,4].includes(reg)&&(reg!==4||!(value&128))));
  assert.equal(pulse.audition.read().pitch,2);assert.equal(pulse.audition.read().soundingCount,1);
  const noise=await setup(t,3);await noise.audition.noteOn('low',0);await noise.audition.noteOff('low');
  assert.deepEqual(await noise.audition.noteOn('high',127),{channel:3,stolenId:null});
  noise.writes.length=0;await noise.audition.setPitch(2);assert.deepEqual(noise.writes,[]);assert.equal(noise.audition.read().pitch,0);
  assert.equal(noise.instrument.observeCode().voice[18],snapshot().voice[18]);
});

test('a bent lowest Pulse key rejects before changing a lease, and an invalid bend preserves the held note and old Pitch',async t=>{
  const f=await setup(t,0);await f.audition.setPitch(-2);
  assert.throws(()=>f.audition.noteOn('too-low',36),/frequency range/);
  assert.equal(f.owners.length,0);assert.equal(f.audition.read().heldCount,0);
  await f.audition.setPitch(0);await f.audition.noteOn('low-C2',36);
  const before=f.instrument.observeCode(),writes=f.writes.length;
  assert.throws(()=>f.audition.setPitch(-2),/frequency range/);
  assert.equal(f.audition.read().pitch,0);assert.equal(f.audition.read().soundingCount,1);
  assert.equal(f.writes.length,writes);assert.deepEqual(f.instrument.observeCode(),before);
});

test('Key Up before a delayed begin/configuration reply never triggers a note and restores the author',async t=>{
  for(const boundary of ['begin','wave.stopAndSetWaveform']){
    const f=await setup(t,2);if(boundary==='begin')f.blockBegin();else f.block(boundary);
    const pending=f.audition.noteOn('fast',60);await until(()=>f.blocked);const up=f.audition.noteOff('fast');
    f.release();assert.equal(await pending,null);await up;
    assert(!f.calls.some(call=>call[0]==='keyOn'));assert.equal(f.instrument.observeCode(),null);assert.deepEqual(f.instrument.read().preset,f.author);
    assert.equal(f.audition.read().active,false);
  }
});

test('selection/Stop fences delayed requests, and an old cleanup cannot fade, release or reopen a newer Code owner',async t=>{
  const f=await setup(t,2);f.block('wave.stopAndSetWaveform');const pending=f.audition.noteOn('old',60);await until(()=>f.blocked);
  f.select(3);const stopping=f.audition.stop();f.release();assert.equal(await pending,null);await stopping;
  assert(!f.calls.some(call=>call[0]==='keyOn'));
  await f.audition.noteOn('noise',60);
  const newer=await f.externalCode();await newer.pulse.noteOn(1,'E4');
  f.engine.codeFadeNode.gain.value=.75;const before=f.instrument.observeCode(),writes=f.writes.length;
  await f.audition.stop();assert.equal(f.engine.codeFadeNode.gain.value,.75);assert.equal(f.writes.length,writes);
  assert.deepEqual(f.instrument.observeCode(),before);assert(newer.isCurrent());await newer.dispose();
});
