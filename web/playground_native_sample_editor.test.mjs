import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createNativeSampleEditorAudio} from './playground_native_sample_editor.js';
import {encodeWav} from './wav.js';
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)};};
const ticks=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const pcm=()=>({sampleRate:16000,channels:[Float32Array.from({length:1600},(_,i)=>.4*Math.sin(i/8))],loopEnabled:true,loopStartFrame:12,loopEndFrame:1400});
async function fixture(override=()=>undefined){
 const calls=[],errors=[];let session=0;const status=()=>({session,sampleRate:48000,frame:0,running:true});
 const synth=new NativeGenesisSynth({invoke:async(command,args)=>{calls.push({command,args});const value=override(command,args);if(value!==undefined)return value;if(command==='native_genesis_start')session++;return status();},onError:error=>errors.push(error)});
 await synth.start();calls.length=0;return {synth,calls,errors,commands:()=>calls.filter(call=>call.command==='native_genesis_commands').flatMap(call=>call.args.commands)};
}
test('Native Sample Editor decodes PCM WAV without Web Audio and previews through a disposable Native sample bank',async t=>{
 const f=await fixture();t.after(()=>f.synth.close());let decodes=0;const adapter=createNativeSampleEditorAudio(f.synth,{decodeAudio:async()=>{decodes++;throw Error('Unexpected compressed decoder');}});
 const source=pcm(),wav=encodeWav(source);const decoded=await adapter.decodeAudio(wav);assert.equal(decodes,0);assert.equal(f.synth.audioContext,null);assert.equal(decoded.sampleRate,16000);assert.equal(decoded.channels[0].length,1600);
 const preview=await adapter.playPreview(source),upload=f.calls.find(call=>call.command==='native_genesis_media_load'),play=f.commands().find(command=>command.type==='sample-play');
 assert.equal(upload.args.kind,'sample');assert.equal(play.name,upload.args.name);assert.equal(play.loop,true);assert.equal(play.loopStart,12/16000);assert.equal(play.loopEnd,1400/16000);
 await preview.stop();await f.synth.serial;assert.equal(f.synth.sample.list().length,0);assert(f.calls.some(call=>call.command==='native_genesis_media_remove'&&call.args.name===play.name));assert(f.commands().some(command=>command.type==='sample-stop'&&command.name===play.name));assert.deepEqual(f.errors,[]);
});
for(const mode of ['abort','Stop'])test(`Native Sample Editor ${mode} during accepted upload cleans the late bank and sends no playback`,async t=>{
 const gate=deferred();let block=true;const f=await fixture(command=>command==='native_genesis_media_load'&&block?gate.promise:undefined);t.after(()=>f.synth.close());
 const adapter=createNativeSampleEditorAudio(f.synth),controller=new AbortController(),pending=adapter.playPreview(pcm(),{signal:controller.signal}),rejected=assert.rejects(pending,{name:'AbortError'});
 await ticks();assert(f.calls.some(call=>call.command==='native_genesis_media_load'));const stopped=mode==='Stop'?f.synth.stopNativeAudio():undefined;if(mode==='abort')controller.abort();
 gate.resolve({});block=false;await rejected;await stopped;await f.synth.serial;
 assert.equal(f.commands().filter(command=>command.type==='sample-play').length,0);assert.equal(f.synth.sample.list().length,0);assert(f.calls.some(call=>call.command==='native_genesis_media_remove'));assert.deepEqual(f.errors,[]);
});
test('Native Sample Editor superseding an accepted preview cannot unload the replacement bank',async t=>{
 const gate=deferred();let block=true;const f=await fixture(command=>command==='native_genesis_media_load'&&block?gate.promise:undefined);t.after(()=>f.synth.close());const adapter=createNativeSampleEditorAudio(f.synth);
 const old=adapter.playPreview(pcm()),rejected=assert.rejects(old,{name:'AbortError'});await ticks();const replacement=adapter.playPreview(pcm());gate.resolve({});block=false;await rejected;
 const current=await replacement;await f.synth.serial;const plays=f.commands().filter(command=>command.type==='sample-play');assert.equal(plays.length,1);assert.deepEqual(f.synth.sample.list(),[plays[0].name]);await current.stop();await f.synth.serial;assert.equal(f.synth.sample.list().length,0);assert.deepEqual(f.errors,[]);
});
test('Native Sample Editor decode finishing after Stop cannot become a new-generation sample upload',async t=>{
 const f=await fixture();t.after(()=>f.synth.close());const gate=deferred(),adapter=createNativeSampleEditorAudio(f.synth,{decodeAudio:()=>gate.promise});
 const pending=adapter.decodeAudio(new Uint8Array(12)),rejected=assert.rejects(pending,{name:'AbortError'});await ticks();await f.synth.stopNativeAudio();gate.resolve(pcm());await rejected;assert(!f.calls.some(call=>call.command==='native_genesis_media_load'));
});
test('Native Sample Editor natural completion releases its temporary bank',async t=>{
 const f=await fixture();t.after(()=>f.synth.close());const adapter=createNativeSampleEditorAudio(f.synth);await adapter.playPreview({...pcm(),channels:[new Float32Array(32)],loopEnabled:false});await new Promise(resolve=>setTimeout(resolve,45));await f.synth.serial;assert.equal(f.synth.sample.list().length,0);assert(f.calls.some(call=>call.command==='native_genesis_media_remove'));
});
