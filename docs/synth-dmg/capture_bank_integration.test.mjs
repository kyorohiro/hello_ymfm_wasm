// Exercise the actual application Capture rollback with deferred DSP replies.
// Native bank restoration is covered separately by channel_instrument.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createDefaultPreset,readPreset} from './preset.js';
import {createGameboyChannelBank,readGameboyChannelBank} from './channel_bank.js';

const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const start=source.indexOf('async function performCaptureSongVoice('),end=source.indexOf('\nfunction isSongActive()',start);
assert(start>=0&&end>start);
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({delayRestore=false,delayBank=false,pendingDraft=false}={}){
  const capture=deferred(),restore=deferred(),bankAck=deferred(),calls=[],commands=[],optionsSeen=[];
  let current=true;
  const original=createDefaultPreset(),originalBank=createGameboyChannelBank(original);
  originalBank[0].pulse.duty=.25;originalBank[1].pulse.duty=.75;originalBank[2].wave.samples.fill(4);
  const captured=readPreset(original);captured.name='Captured';captured.source='noise';captured.noise.volume=9;
  const working=readPreset(original);if(pendingDraft){working.name='Unsaved Wave';working.source='wave';}
  const realm={readPreset,readGameboyChannelBank,disposed:false,preset:working,playbackPreset:readPreset(original),channelBank:readGameboyChannelBank(originalBank),revision:0,applySequence:0,
    async stopAudition(){},renderChannelView(){},readVoices(state){realm.channelBank=readGameboyChannelBank(state.channelPresets);},
    async applyPreset(next,options={}){
      const sequence=++realm.applySequence,index=calls.length;calls.push(next.name);optionsSeen.push(options);
      realm.preset=readPreset(options.displayPreset??next);realm.playbackPreset=readPreset(next);realm.channelBank=createGameboyChannelBank(next);
      if(index===0)await capture.promise;
      else if(index===1&&delayRestore)await restore.promise;
      return sequence===realm.applySequence&&(options.isCurrent?.()??true);
    },
    audio:{async command(method,args){commands.push({method,args});if(delayBank)await bankAck.promise;return {channelPresets:readGameboyChannelBank(args[0])};}},
    codeHost:{files:{async saveCapturedSound(next,{apply,isCurrent}){return await apply(next,{isCurrent})!==false&&isCurrent();}}}};
  vm.createContext(realm);vm.runInContext(source.slice(start,end),realm);
  return {realm,calls,commands,optionsSeen,originalBank,captured,restore,bankAck,
    begin:()=>realm.performCaptureSongVoice({preset:captured},{isCurrent:()=>current}),
    cancel(){current=false;capture.resolve();}};
}

test('Capture cancelled after author publication restores distinct CH sounds even when its load ACK is rejected',async()=>{
  const f=fixture(),pending=f.begin();await tick();f.cancel();assert.equal(await pending,false);
  assert.equal(f.calls.length,2);assert.equal(f.realm.preset.name,createDefaultPreset().name);
  assert.deepEqual(f.realm.channelBank,f.originalBank);assert.equal(f.commands[0].method,'loadChannelBank');
});

test('a newer full preset supersedes a delayed Capture rollback without receiving its old CH bank',async()=>{
  const f=fixture({delayRestore:true}),pending=f.begin();await tick();f.cancel();await tick();assert.equal(f.calls.length,2);
  const newer=createDefaultPreset();newer.name='Newer';newer.pulse.volume=3;await f.realm.applyPreset(newer);
  f.restore.resolve();assert.equal(await pending,false);assert.equal(f.commands.length,0);
  assert.deepEqual(f.realm.channelBank,createGameboyChannelBank(newer));
});

test('a late channel-bank ACK from rollback cannot repaint a newer committed instrument',async()=>{
  const f=fixture({delayBank:true}),pending=f.begin();await tick();f.cancel();await tick();assert.equal(f.commands.length,1);
  const newer=createDefaultPreset();newer.name='Newer';newer.pulse.volume=4;await f.realm.applyPreset(newer);
  f.bankAck.resolve();assert.equal(await pending,false);assert.equal(f.realm.preset.name,'Newer');
  assert.deepEqual(f.realm.channelBank,createGameboyChannelBank(newer));
});

test('cancelled explicit Capture restores accepted audio and a separate unsaved author drawing',async()=>{
  const f=fixture({pendingDraft:true}),pending=f.begin();await tick();f.cancel();assert.equal(await pending,false);
  assert.equal(f.realm.preset.name,'Unsaved Wave');assert.equal(f.realm.preset.source,'wave');
  assert.equal(f.realm.playbackPreset.name,'Pulse');assert.equal(f.realm.playbackPreset.source,'pulse');
  assert(f.optionsSeen.every(options=>options.record===false&&options.applyAudio===true),'the Files transaction alone commits its documents');
  assert.deepEqual(f.realm.channelBank,f.originalBank);
});
