import test from 'node:test';
import assert from 'node:assert/strict';
import {createFm2608GuardAudio} from '../../test/helpers/fm2608_adpcm_guard_audio.mjs';
import {createFm2608CodeClient} from './code_client.js';
import {FM2608_ADPCM_RELEASE_SECONDS} from './adpcm_noteoff_guard.js';
import {waveShape,encodeBase64} from './preset.js';
import {encodeAdpcmB} from '../js/adpcm_b_sample.js';

function maximumJump(before,after) {
  let previous = before.at(-1), result = 0;
  for (const value of after) {result = Math.max(result,Math.abs(value-previous)); previous = value;}
  return result;
}
async function sineProfile(rate,hold,kind) {
  const f=await createFm2608GuardAudio(rate);
  try {
    await f.audio.noteOn('adpcm',0,60);const before=f.render(hold).left;
    if(kind==='current')f.audio.noteOff('adpcm',0);
    if(kind==='linear64') {
      for(let step=1;step<=64;step++) {
        const commands=[{type:'write',port:1,register:11,value:Math.round(192*(1-step/64))}];
        if(step===64)commands.push({type:'write',port:1,register:0,value:1},{type:'write',port:1,register:11,value:192});
        assert(f.queue.receive({performance:{session:1,owner:'old-linear-reference',time:hold/rate+128/rate+.008*step/64},commands}));
      }
    }
    return{before,after:f.render(1024).left,volume:f.audio.capturePreset().adpcm.volume};
  }finally{await f.dispose();}
}
function envelopeError(actual,reference,frames,cosine) {
  let power=0,diffPower=0,previous=0;
  const length=128+frames+5;
  for(let i=0;i<length;i++){
    const p=Math.max(0,Math.min(1,(i-128)/frames)),gain=cosine?(1+Math.cos(p*Math.PI))/2:1-p;
    const error=actual[i]-reference[i]*gain;
    power+=error*error;diffPower+=(error-previous)**2;previous=error;
  }
  return{rms:Math.sqrt(power/length),differenceRms:Math.sqrt(diffPower/length)};
}
for(const rate of[44100,48000])test(`real Sine ${rate}Hz smooth release lowers zipper error and reaches zero before Stop`,async()=>{
  const old=[],current=[],frames=Math.round(rate*FM2608_ADPCM_RELEASE_SECONDS);
  for(const hold of[Math.round(rate*.001),Math.round(rate*.004),Math.round(rate*.0137),Math.round(rate*.137),rate+1]) {
    const reference=await sineProfile(rate,hold,'reference'),linear=await sineProfile(rate,hold,'linear64'),smooth=await sineProfile(rate,hold,'current');
    assert.deepEqual(smooth.before,reference.before);assert.deepEqual(linear.before,reference.before);
    assert.equal(smooth.volume,192,'fading never changes the authored/captured volume');
    old.push(envelopeError(linear.after,reference.after,frames,false));
    current.push(envelopeError(smooth.after,reference.after,frames,true));
    assert(smooth.after.subarray(128+frames-2).every(value=>value===0),'the decoder stop and nominal restore are already silent');
  }
  const worst=(rows,key)=>Math.max(...rows.map(row=>row[key]));
  assert(worst(current,'rms')<worst(old,'rms')*.30,'worst error against the ideal smooth envelope falls by at least70%');
  assert(worst(current,'differenceRms')<worst(old,'differenceRms')*.50,'rapid error changes from coarse volume steps fall by at least50%');
});
async function release(rate,hold,guarded,shape='sine') {
  const f = await createFm2608GuardAudio(rate);
  try {
    if (shape !== 'sine') {
      const preset=f.audio.getPreset(),sampleRate=preset.adpcm.sampleRate;
      const encoded=encodeAdpcmB({channels:[Float32Array.from(waveShape(shape))],sampleRate},sampleRate);
      preset.adpcm.data=encodeBase64(encoded.bytes);preset.adpcm.end=encoded.bytes.length;
      await f.audio.applyPreset(preset);
    }
    await f.audio.noteOn('adpcm',0,60); const before = f.render(hold).left;
    const at = f.frame; f.writes.length=0;
    if (guarded) f.audio.noteOff('adpcm',0); else f.chip.adpcm.keyOff();
    const after = f.render(1024).left;
    return {before,after,jump:maximumJump(before,after),writes:f.writes.slice(),at};
  } finally {await f.dispose();}
}
for (const rate of [44100,48000]) test(`real ADPCM ${rate}Hz short/long notes retain pre-release PCM and reduce the worst stop discontinuity`,async() => {
  const values = [];
  for (const hold of [Math.round(rate*.001),Math.round(rate*.004),Math.round(rate*.0137),Math.round(rate*.1),rate+1]) {
    const raw = await release(rate,hold,false), guarded = await release(rate,hold,true);
    assert.deepEqual(guarded.before,raw.before,'attack/held sample PCM stays unchanged');
    assert(guarded.after.subarray(800).every(value => value===0),'bounded release always reaches silence');
    const stops = guarded.writes.filter(value => value.port===1&&value.register===0&&value.value===1);
    assert.equal(stops.length,1);assert.equal(stops[0].frame,hold+128+Math.round(FM2608_ADPCM_RELEASE_SECONDS*rate));
    assert.deepEqual(guarded.writes.slice(-3).map(({register,value}) => [register,value]),[[11,0],[0,1],[11,192]]);
    assert.equal(raw.writes[0].frame,hold);assert.deepEqual(raw.writes[0],{port:1,register:0,value:1,frame:hold});
    values.push({hold,raw:raw.jump,guarded:guarded.jump});
  }
  const rawWorst=Math.max(...values.map(value=>value.raw)),guardedWorst=Math.max(...values.map(value=>value.guarded));
  assert(guardedWorst<rawWorst*.25,'worst release discontinuity falls by at least75%');
});
for (const rate of [44100,48000]) test(`real generated Triangle ${rate}Hz release has no former repeat-reset burst`,async() => {
  let rawWorst=0,stopWorst=0;
  for (const hold of [Math.round(rate*.001),Math.round(rate*.004),Math.round(rate*.0137),Math.round(rate*.137),rate+1]) {
    const raw=await release(rate,hold,false,'triangle'),guarded=await release(rate,hold,true,'triangle');
    assert.deepEqual(guarded.before,raw.before,'release guard must not attenuate or replace held PCM');
    assert(guarded.before.some(value=>Math.abs(value)>.1),'the generated Triangle stays audible');
    // Repeat decoding resets predictor state. The software cycle now starts at
    // a zero crossing; an ordinary fade must not retain the old ~0.2 FS reset
    // impulse during its scheduling lead or its short release window.
    assert(guarded.jump<.04,'release window contains only ordinary waveform motion and bounded level steps');
    const stop=128+Math.round(FM2608_ADPCM_RELEASE_SECONDS*rate);
    const endJump=maximumJump(guarded.after.subarray(stop-4,stop-2),guarded.after.subarray(stop-2,stop+3));
    rawWorst=Math.max(rawWorst,raw.jump);stopWorst=Math.max(stopWorst,endJump);
    assert(guarded.after.subarray(stop+2).every(value=>value===0));
    assert.deepEqual(guarded.writes.slice(-3).map(({register,value})=>[register,value]),[[11,0],[0,1],[11,192]],'physical fade does not change the canonical level or raw stop');
  }
  assert(stopWorst<rawWorst*.04,'actual decoder-stop edge is below4% of the worst raw stop, separately from normal signal slope');
});
test('real rapid Off/On cancels every old ramp/stop and fresh native samples match the raw retrigger',async() => {
  const a=await createFm2608GuardAudio(),b=await createFm2608GuardAudio();
  try {
    for(const f of[a,b]){await f.audio.noteOn('adpcm',0,60);f.render(4800);}
    a.audio.noteOff('adpcm',0);
    for(const f of[a,b])f.render(240);
    for(const f of[a,b])await f.audio.noteOn('adpcm',0,67);
    a.writes.length=0;
    const actual=a.render(2048),expected=b.render(2048);
    // The unchanged native interpolation pipeline carries one pre-retrigger
    // output sample. It contains the old attenuated voice, not a stale stop.
    for(const side of['left','right']) {
      assert(Number.isFinite(actual[side][0]));
      assert.deepEqual(actual[side].subarray(1),expected[side].subarray(1));
    }
    assert(!a.writes.some(value=>value.register===0&&value.value===1),'old stop cannot reach the retrigger');
    assert.equal(a.audio.capturePreset().adpcm.volume,192);
  } finally {await a.dispose();await b.dispose();}
});
test('real release capture/volume edit/preset/session retirement never saves fade levels or stops a newer owner',async() => {
  const f=await createFm2608GuardAudio();
  try {
    await f.audio.noteOn('adpcm',0,60);f.render(4000);f.audio.noteOff('adpcm',0);f.render(260);
    assert.equal(f.audio.capturePreset().adpcm.volume,192);assert.equal(f.chip.adpcm.registers[11],192);
    f.chip.adpcm.setVolume(99);assert.equal(f.audio.capturePreset().adpcm.volume,99);f.render(1024);
    assert.equal(f.writes.filter(value=>value.register===11).at(-1).value,99);
    await f.audio.noteOn('adpcm',0,60);f.audio.noteOff('adpcm',0);
    const preset=f.audio.getPreset();preset.adpcm.volume=87;await f.audio.applyPreset(preset);
    let current=true;const old=createFm2608CodeClient(f.chip,{isCurrent:()=>current});old.client.adpcm.keyOn({repeat:true});old.client.adpcm.noteOff();
    current=false;old.release();const next=createFm2608CodeClient(f.chip);next.client.adpcm.keyOn({repeat:true});
    f.writes.length=0;const pcm=f.render(2048).left;assert(pcm.some(value=>Math.abs(value)>.001));
    assert(!f.writes.some(value=>value.register===0&&value.value===1));assert.equal(f.audio.capturePreset().adpcm.volume,87);
    assert.throws(()=>old.client.adpcm.noteOff(),{name:'AbortError'});
  } finally {await f.dispose();}
});
test('real one-shot natural end is retained and high-level release does not retrigger it',async() => {
  const f=await createFm2608GuardAudio();
  try {
    const preset=f.audio.getPreset();preset.adpcm.repeat=false;await f.audio.applyPreset(preset);await f.audio.noteOn('adpcm',0,60);
    f.render(4800);f.writes.length=0;f.audio.noteOff('adpcm',0);const tail=f.render(1024).left;
    assert(tail.every(value=>value===0));assert(!f.writes.some(value=>value.register===0&&value.value&128));assert.equal(f.audio.capturePreset().adpcm.repeat,false);
  } finally {await f.dispose();}
});
