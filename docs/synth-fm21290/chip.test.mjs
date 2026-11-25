import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Fm21290, MODE, ALGORITHM, EVENT} from './chip.js';
import {createInstrument} from './instrument.js';
import {glassPatch} from './examples.js';
import {presetToVoice,voiceToPreset} from '../js/msfa_dx7/src/preset.js';
import {createDX7} from '../js/msfa_dx7/src/index.js';

function setup(patch={}) {
  const core=new Fm21290(48000), trace=[];
  const api=createInstrument((address,data)=>{core.writeRegister(address,data);trace.push([core.frame,address,data]);});
  api.setPatch(voiceToPreset(presetToVoice(patch)));
  const render=n=>{const pcm=new Float32Array(n);core.renderInto(pcm);return pcm;};
  return {core,api,trace,render};
}
test('operator envelope edit values reach EGS in wire order and release to silence',()=>{
  const {core,api,render}=setup({operators:{1:{envelope:{levels:[99,19,20,0],rates:[99,99,99,99]}}}});
  assert.deepEqual([...core.reg.slice(0x74,0x78)],[0,40,39,63]);
  api.keyOn(0,69);render(4800);api.keyOff(0);render(4800);
  assert.equal(core.voices[0].active,false);
  assert.ok(render(256).every(sample=>sample===0));
});
test('firmware broadcast and die-derived individual A-register select',()=>{
  const {core}=setup();
  core.writeRegister(MODE,0x30);core.writeRegister(ALGORITHM,0xff);
  core.writeRegister(MODE,15);core.writeRegister(ALGORITHM,12);
  assert.deepEqual([...core.algorithms],[...Array(15).fill(255),12]);
});
test('key events, CH isolation and replay across render boundaries',()=>{
  const {core,api,trace,render}=setup(glassPatch);
  api.keyOn(0,48);api.keyOn(15,72);
  const a=render(3200);
  api.keyOff(0);
  assert.equal(core.voices[0].held,false);assert.equal(core.voices[15].held,true);
  const b=render(2000);assert.ok(a.some(v=>v!==0));
  const replay=new Fm21290(48000), output=new Float32Array(5200);
  for(const [frame,addr,value] of trace){
    replay.renderInto(output.subarray(replay.frame,frame));replay.writeRegister(addr,value);
  }
  replay.renderInto(output.subarray(replay.frame));
  assert.deepEqual(output,Float32Array.from([...a,...b]));
});
test('16 held slots, bounded allocator, independent gates, all 32 routes finite',()=>{
  const {api,trace,core,render}=setup(glassPatch);
  for(let ch=0;ch<16;ch++)assert.equal(api.noteOn(50+ch),ch);
  const count=trace.length;assert.equal(api.noteOn(80),undefined);assert.equal(trace.length,count);
  api.noteOff(57);assert.equal(api.noteOn(80),7);
  assert.deepEqual(trace.at(-1).slice(1),[EVENT,29]);
  for(let algorithm=0;algorithm<32;algorithm++){
    core.writeRegister(ALGORITHM,algorithm*8+7);
    const pcm=render(500);assert.ok(pcm.every(Number.isFinite));assert.ok(pcm.some(x=>Math.abs(x)>0.0001));
  }
});
test('INIT A4 fundamental against the vendored MSFA renderer',async()=>{
  const {api,render}=setup();api.noteOn(69,127);
  const wasmBytes=await readFile(new URL('../js/msfa_dx7/wasm/msfa.wasm',import.meta.url));
  const ref=await createDX7({sampleRate:48000,wasmBytes});
  try {
    ref.setPreset({});ref.noteOn(69,127);
    function hz(pcm){let crossings=0;for(let i=24001;i<48000;i++)if(pcm[i-1]<=0&&pcm[i]>0)crossings++;return crossings*2;}
    const custom=hz(render(48000)),msfa=hz(ref.render(48000));
    assert.ok(Math.abs(custom-440)<=2 && Math.abs(custom-msfa)<=2,`custom ${custom} Hz / MSFA ${msfa} Hz`);
  }finally{ref.dispose();}
});
test('Cassette round trip preserves original bank, selected slot, code and MIDI',async()=>{
  const {exportSession,importSession}=await import('./session.js');
  const {createBankSysex}=await import('../js/msfa_dx7/src/sysex.js');
  const voices=Array.from({length:32},(_,i)=>presetToVoice({name:'PATCH '+i}));
  const bank=createBankSysex(voices,{channel:11});
  const song=Uint8Array.of(77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,4,0,255,47,0);
  const next=await importSession(exportSession({bank,selected:24,code:'// example',song}));
  assert.equal(next.selected,24);assert.equal(next.code,'// example');assert.deepEqual(next.song,song);
  assert.deepEqual(createBankSysex(next.dump.voices.map(v=>v.data),{channel:next.dump.channel}),bank);
});
test('keyboard rate scaling saturates at rate 63 and pitch bend preserves it',()=>{
  const {core,api}=setup({operators:{1:{rateScaling:7}}});
  api.keyOn(0,93);
  const voice=core.voices[0], idx=20; // OP1, stage 1
  core.writeRegister(0x3040+idx,62);
  const scaled=voice.decay[idx];
  core.writeRegister(0x3040+idx,63);
  assert.equal(voice.decay[idx],scaled);
  core.writeRegister(0x3040+idx,32);
  const beforeBend=voice.decay[idx];
  assert.ok(beforeBend>scaled);
  core.writeRegister(0x30f2,8);
  assert.equal(voice.decay[idx],beforeBend);
  core.writeRegister(0x30e5,0);
  assert.ok(voice.decay[idx]>beforeBend);
});

test('MIDI velocity and output level produce firmware attenuation bytes on the selected CH',()=>{
  const {api,core}=setup({operators:{1:{outputLevel:85,velocitySensitivity:4}}});
  for(const [velocity,expected] of [[32,82],[35,82],[64,61],[96,45],[127,35]]) {
    api.keyOn(3,69,velocity);
    assert.equal(core.reg[0xd3],expected);
    assert.equal(core.reg[0xd0],255);
  }
  api.setPatch(voiceToPreset(presetToVoice({operators:{1:{outputLevel:99,velocitySensitivity:7}}})));
  assert.equal(core.reg[0xd3],4);
  api.setPatch(voiceToPreset(presetToVoice({operators:{1:{outputLevel:0,velocitySensitivity:0}}})));
  assert.equal(core.reg[0xd3],255);
  api.keyOn(3,69,0);
  assert.equal(core.voices[3].held,false);
});

test('v1.8 keyboard scaling writes the four curves on opposite sides of the breakpoint',()=>{
  const notes=[0,36,54,55,56,57,58,59,60,61,72,84,127];
  for(const [leftCurve,rightCurve,expected] of [
    [0,1,[175,117,87,83,83,83,83,83,83,85,89,95,255]],
    [1,0,[113,87,83,83,83,83,93,93,93,105,139,185,255]],
    [2,3,[53,79,83,83,83,83,73,73,73,61,27,15,15]],
    [3,2,[15,49,79,83,83,83,83,83,83,81,77,71,15]],
  ]) {
    const keyboardScaling={breakpoint:40,leftDepth:32,rightDepth:71,leftCurve,rightCurve};
    const {api,core}=setup({operators:{1:{outputLevel:65,keyboardScaling}}});
    const actual=notes.map(note=>{api.keyOn(9,note,127);return core.reg[0xd9];});
    assert.deepEqual(actual,expected);
    assert.equal(core.reg[0xd0],255);
  }
});

test('extreme breakpoints and unsigned transpose follow v1.8 lookup addressing',()=>{
  const keyboardScaling={breakpoint:0,leftDepth:99,rightDepth:99,leftCurve:1,rightCurve:1};
  const patch={operators:{1:{outputLevel:65,keyboardScaling}}};
  const {core,api}=setup(patch);
  api.keyOn(0,127,127);
  assert.equal(core.reg[0xd0],97);
  const highPitch=core.reg.slice(0,2);
  api.setPatch(voiceToPreset(presetToVoice({...patch,transpose:23})));
  api.keyOn(0,0,127);
  assert.deepEqual(core.reg.slice(0,2),highPitch);
  assert.equal(core.reg[0xd0],97);
  keyboardScaling.breakpoint=99;
  api.setPatch(voiceToPreset(presetToVoice(patch)));
  api.keyOn(0,0,127);
  assert.equal(core.reg[0xd0],113);
});

test('poly note-off scans physical slots from zero, including after allocator wrap',()=>{
  const {api,trace}=setup();
  for(let ch=0;ch<15;ch++){api.noteOn(50);api.noteOff(50);}
  assert.equal(api.noteOn(69),15);
  assert.equal(api.noteOn(69),0);
  trace.length=0;
  api.noteOn(69,0);api.noteOff(69);api.noteOff(69);
  assert.deepEqual(trace.map(row=>row.slice(1)),[[EVENT,2],[EVENT,62]]);
});

test('sustain defers individual gates, permits slot reuse and preserves replacement notes',()=>{
  const {api,trace,core}=setup();
  api.setSustain(true);
  for(let i=0;i<16;i++)api.noteOn(69);
  trace.length=0;
  api.noteOff(69);api.noteOff(69);api.noteOff(69);
  assert.equal(trace.length,0);
  assert.equal(api.noteOn(72),0);
  trace.length=0;
  api.setSustain(false);api.setSustain(false);
  assert.deepEqual(trace.map(row=>row.slice(1)),[[EVENT,6],[EVENT,10]]);
  assert.ok(core.voices[0].held && core.voices[3].held);
  api.setSustain(true);
  api.keyOff(0);
  assert.equal(core.voices[0].held,false);
  api.allNotesOff();api.noteOn(60);api.noteOff(60);
  assert.ok(core.voices.every(v=>!v.held));
});

test('idle phase on a physical slot advances through silence and pitch writes',()=>{
  function onset(sync,gaps,octaveUp=false){
    const {core,api,render}=setup({oscillatorSync:sync});
    api.keyOn(15,69);render(3001);api.keyOff(15);render(12000);
    assert.equal(core.voices[15].active,false);
    // Raise the idle pitch by one octave, then keyOn restores A4.
    if(octaveUp)core.writeRegister(0x301e,0x6a);
    for(const gap of gaps)assert.ok(render(gap).every(x=>x===0));
    api.keyOn(15,69);
    return render(8);
  }
  const free=onset(false,[]), halfTurn=onset(false,[600]);
  assert.ok(Math.max(...free.map(Math.abs))>0.0001);
  for(let i=0;i<free.length;i++)assert.ok(Math.abs(free[i]+halfTurn[i])<1e-7);
  assert.deepEqual(halfTurn,onset(false,[127,473]));
  assert.deepEqual(free,onset(false,[600],true)); // 11 complete turns at 880 Hz
  const synced=onset(true,[]);
  assert.equal(synced[0],0);
  assert.deepEqual(synced,onset(true,[600]));
});

test('sync restarts oscillator phase but retains model feedback on an immediate retrigger',()=>{
  for(const feedback of [0,7]){
    const {api,core,render}=setup({algorithm:31,feedback,oscillatorSync:true,
      operators:{1:{outputLevel:0},6:{outputLevel:78}}});
    api.keyOn(0,69);render(3021);
    const voice=core.voices[0], history=[voice.previous,voice.feedback];
    api.keyOff(0);api.keyOn(0,69);
    assert.deepEqual([...voice.phase],Array(6).fill(0));
    assert.deepEqual([voice.previous,voice.feedback],history);
    const first=render(1)[0];
    if(feedback)assert.ok(Math.abs(first)>0.0001);
    else assert.equal(first,0);
    api.keyOff(0);render(16000);assert.equal(voice.active,false);
    api.keyOn(0,69);
    assert.equal(render(1)[0],0);
  }
});
