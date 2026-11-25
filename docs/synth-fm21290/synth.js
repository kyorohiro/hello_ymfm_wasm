// SPDX-License-Identifier: BSD-3-Clause
import {createInitVoice,parseSysex,createVoiceSysex,createBankSysex} from '../js/msfa_dx7/src/sysex.js';
import {presetToVoice,voiceToPreset} from '../js/msfa_dx7/src/preset.js';
import {createDx7Audio} from '../js/playground_dx7_audio.js';
import {createDx7Client} from '../js/playground_dx7.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {parseMidiFile} from '../js/midi_file.js';
import {createSynthOutputVisualizer} from '../synth/synth_output_visualizer.js';
import {renderRouting} from './routing.js';
import {validateTrace} from './register_trace.js';
import {EVENT,integer,validRegister} from './chip.js';
import {createMsfaNotes} from './msfa_notes.js';
import {createMidiApi} from '../js/playground_midi.js';
import {pitchBendWord,createPartPlayer,partScore,partSource,playbackRegion} from './midi_part.js';
import {createNoteOutput} from './midi_output.js';
import {createInstrument} from './instrument.js';
import {defaultWheel,exportSession,importSession} from './session.js';
import {glassSteps,glassPatch} from './examples.js';

const el = id => document.getElementById(id);
const voices = Array.from({length:32},(_,i)=>createInitVoice('INIT '+(i+1)));
voices[0] = presetToVoice(glassPatch);
let selected=0, op=1, sysexChannel=0, audio=null, opening=null, midi=null, songBytes=null, songEpoch=0, songTimer=null;
const held = new Map(), trace=[], writes=[];
const monitor = createSynthOutputVisualizer({background:'#182408',grid:'#374b1c',labels:'#bbc99d',trace:'#b4ed6c',waveformMinRange:1/64});
const preset = () => voiceToPreset(voices[selected]);
const option = (text,value) => new Option(text,value);
const report = error => {el('status').textContent=error.message ?? String(error);};
function on(id,event,fn) { el(id).addEventListener(event,e=>Promise.resolve().then(()=>fn(e)).catch(report)); }
function writeRegister(address,value) {
  validRegister(address);
  integer(value,0,255,'register byte');
  writes.push([address,value]);
  trace.push(address.toString(16).padStart(4,'0')+'  '+value.toString(16).padStart(2,'0'));
  if(trace.length>12)trace.shift();
}
let midiAccess=null;
const noteOutput=createNoteOutput(error=>{
  el('midiPort').value='';el('midiStatus').textContent=error.message;
});
const sendChannel=owner=>owner?.midiChannel??Number(el('sendChannel').value);
el('sendChannel').append(...Array.from({length:16},(_,i)=>option(i+1,i)));
function listPorts(){
  const selected=el('midiPort').value;
  const outputs=[...midiAccess.outputs.values()].filter(port=>port.state==='connected');
  el('midiPort').replaceChildren(option('Off',''),...outputs.map(port=>option(port.name||port.id,port.id)));
  const current=outputs.find(port=>port.id===selected);
  el('midiPort').value=current?.id??'';
  noteOutput.select(current??null);
  el('midiStatus').textContent=outputs.length?'':'No MIDI output devices found.';
}
on('connectMidi','click',async()=>{
  if(!navigator.requestMIDIAccess)throw Error('Web MIDI is unavailable in this browser.');
  midiAccess=await navigator.requestMIDIAccess({sysex:false});
  midiAccess.onstatechange=listPorts;listPorts();
});
on('midiPort','change',()=>noteOutput.select(midiAccess?.outputs.get(el('midiPort').value)??null));
window.addEventListener('pagehide',()=>{noteOutput.select(null);el('midiPort').value='';});
const chip=createInstrument(writeRegister,
  (keyOn,basePitch,note,velocity,owner)=>{
    writes.push({keyOn,basePitch});noteOutput.on(keyOn,sendChannel(owner),note,velocity);
  },keyOff=>{writes.push({keyOff});noteOutput.off(keyOff);});
function rawGate(value,owner){
  chip.rawEvent(value,owner);
  if((value&3)===1 || (value&3)===2)noteOutput.off((value>>2)&15);
}
function applyChipPatch(){
  const patch=preset();
  audio.node.port.postMessage({lfo:patch.lfo,pitchEnvelope:patch.pitchEnvelope});
  sendModWheel();chip.setPatch(patch);flush();
}
function flush() {
  if(writes.length && audio?.node) audio.node.port.postMessage({writes:writes.splice(0)});
  else writes.length=0;
}
const isChip=()=>el('engine').value==='chip';
async function ensureAudio() {
  if(opening)return opening;
  if(audio){await audio.context.resume();return audio;}
  opening=(async()=>{
    const context=new AudioContext({sampleRate:48000});
    try {
      await context.resume();
      const master=context.createGain(); master.gain.value=Number(el('master').value)/100; master.connect(context.destination);
      const owner={context,master};
      if(isChip()){
        await context.audioWorklet.addModule(new URL('./worklet.js',import.meta.url));
        owner.node=new AudioWorkletNode(context,'tetorica-fm21290',{numberOfInputs:0,outputChannelCount:[1]});
        owner.node.connect(master);
        owner.node.port.postMessage({inspectCh:Number(el('inspectCh').value)});
        owner.node.port.onmessage=({data})=>{
          if(data.recorded){
            savedTrace=data.recorded;
            traceControls('idle',data.full?'Event limit reached.':'Recording finished.');
            inspectTrace();
          }
          if(data.replayDone)traceControls('idle','Replay stopped.');
          if(data.error){report(data.error);if(traceMode==='replay')traceControls('idle','Replay failed.');}
          if(data.modulation)el('modBytes').textContent=data.modulation.map(n=>n.toString(16).padStart(2,'0')).join(' ');
          if(data.voice && data.voice.ch===Number(el('inspectCh').value)){
            const v=data.voice;
            el('voiceState').textContent='Algorithm '+v.algorithm+' · FB '+v.feedback+' · Pitch 0x'+v.pitch.toString(16).padStart(4,'0')+
              ' · OP1–6 output bytes '+v.levels.map(n=>n.toString(16).padStart(2,'0')).join(' ')+' · EG stages '+v.stages.join(' ');
          }
          if(data.slots)el('slots').textContent=data.slots.map((s,i)=>'CH'+(i+1)+' '+['·','release','on'][s]).join('   ');
        };
      }else{
        owner.endpoint=await createDx7Audio(context,master);
        owner.dx=createDx7Client(owner.endpoint.port,owner.endpoint);
        owner.notes=createMsfaNotes(owner.dx,{
          on:(slot,source,n,v)=>noteOutput.on(slot,sendChannel(source),n,v),
          off:slot=>noteOutput.off(slot),
        });
        await owner.dx.loadSysex(createVoiceSysex(voices[selected]));
      }
      monitor.connect(context,[master]);audio=owner;
      if(owner.node){applyChipPatch();if(wheelBend!==null)sendBend();}
      return owner;
    }catch(error){await context.close();throw error;}
  })();
  try{return await opening;}finally{opening=null;}
}
async function applyVoice(){
  if(audio?.dx)await audio.dx.setPreset(preset());
  if(audio?.node)applyChipPatch();
}
function noteOn(note,velocity=100,ch=-1,owner='code') {
  if(audio?.dx)audio.notes.noteOn(note,velocity,owner);
  else if(ch<0)chip.noteOn(note,velocity,owner);
  else chip.keyOn(ch,note,velocity,owner);
  flush();
}
function noteOff(note,ch=-1,owner='code'){
  if(audio?.dx)audio.notes.noteOff(note,owner);
  else if(ch<0)chip.noteOff(note,owner);
  else chip.keyOff(ch,owner);
  flush();
}
function silence(){
  releaseWheel();
  if(audio?.dx)audio.notes.panic();
  if(audio?.node){chip.allNotesOff();flush();audio.node.port.postMessage({reset:true});applyChipPatch();}
  held.clear();
}
function stopOwner(owner){
  if(audio?.node){chip.stopOwner(owner);flush();}
  else audio?.notes?.stopOwner(owner);
}
let songPart=null,bendOwner=null,partBend=0,wheelBend=null;
function sendBend(){audio?.node?.port.postMessage({bend:wheelBend??partBend});}
function setPartBend(owner,bend){
  partBend=bend;bendOwner=bend===0?null:owner;
  if(wheelBend===null)sendBend();
}
let manualWheel={...defaultWheel},modOwner=null,modValue=manualWheel.value;
function sendModWheel(){
  audio?.node?.port.postMessage({modWheel:{...manualWheel,value:modValue}});
}
function setModPosition(owner,value){
  modOwner=owner;modValue=value;
  el('modPosition').value=value;el('modValue').textContent=value;
  sendModWheel();
}
function restoreModWheel(settings){
  manualWheel={...settings};el('modRange').value=settings.range;
  for(const [i,id] of ['modPitch','modAmp','modBias'].entries())el(id).checked=Boolean(settings.assign&(1<<i));
  setModPosition(null,settings.value);
}
on('modPosition','input',()=>{
  manualWheel.value=Number(el('modPosition').value);setModPosition(null,manualWheel.value);
});
for(const id of ['modRange','modPitch','modAmp','modBias'])on(id,'change',()=>{
  const input=el('modRange');
  if(!input.checkValidity()||input.value==='')input.value=manualWheel.range;
  manualWheel.range=Number(input.value);
  manualWheel.assign=Number(el('modPitch').checked)+2*el('modAmp').checked+4*el('modBias').checked;
  sendModWheel();
});
const codeParts=new Set();
function createMidiPart(collection,signal){
  const owner={};
  const part=createPartPlayer({
    noteOn:(n,v)=>noteOn(n,v,-1,owner),noteOff:n=>noteOff(n,-1,owner),
    setSustain:audio.node?down=>{chip.setSustain(down,owner);flush();}:null,
    setWheel:audio.node?value=>setModPosition(owner,value):null,
    setBend:audio.node?bend=>setPartBend(owner,bend):null,
    stop(){
      signal?.removeEventListener('abort',part.finish);stopOwner(owner);collection?.delete(part);
      if(modOwner===owner)setModPosition(null,manualWheel.value);
      if(bendOwner===owner)setPartBend(null,0);
    },
  });
  signal?.addEventListener('abort',part.finish,{once:true});
  collection?.add(part);
  return part;
}
function stopSong(){
  songEpoch++;clearTimeout(songTimer);songTimer=null;songPart?.finish();songPart=null;
}
let midiVoiceId=0;
const codeMidiNotes=new Map();
function releaseMidiVoice(id){
  const voice=codeMidiNotes.get(id);
  if(!voice)return;
  noteOff(voice.note,-1,voice);codeMidiNotes.delete(id);
}
function codeMidi(clock){
  return createMidiApi((method,[destination,channel,note,value])=>{
    if(method==='noteOn'){
      const id=++midiVoiceId, voice={midiChannel:channel,note};
      noteOn(note,value,-1,voice);codeMidiNotes.set(id,voice);return id;
    }
    if(method==='release')releaseMidiVoice(value);
  },{...clock,outputs:['tetorica-fm21290']});
}
const physicalGates={keyOff(ch){chip.keyOff(ch,'code');flush();}};
const runtime=createPlaygroundCodeRuntime({
  prepareSource:source=>'const '+Array.from({length:10},(_,i)=>'CH'+(i+7)+'='+(i+6)).join(',')+';\n'+source,
  ensureReady:ensureAudio,now:()=>audio?.context.currentTime??0,supportedSoundChips:['dx7','fm21290'],
  useSoundChip(name){
    if(name==='fm21290'&&!audio?.node)throw Error('Select OPS / EGS for physical CH or register writes.');
    const api={noteOn:(n,v)=>noteOn(n,v),noteOff:n=>noteOff(n),
      getPreset:preset, setPreset:async p=>{voices[selected]=presetToVoice(p);render();await applyVoice();},
      setOperator:(op,patch)=>edit({operators:{[op]:patch}}),setFeedback:feedback=>edit({feedback}),
    };
    if(name==='fm21290')Object.assign(api,{
      keyOn(ch,n,v){chip.keyOn(ch,n,v,'code');flush();},keyOff(ch){chip.keyOff(ch,'code');flush();},
      setSustain(down){if(typeof down!=='boolean')throw TypeError('Expected boolean sustain');chip.setSustain(down,'code');flush();},
      writeRegister(a,v){if(a===EVENT)rawGate(v,'code');else writeRegister(a,v);flush();},
    });
    return api;
  },
  resolveNoteTarget:(target,method,args)=>({keyOn:1,keyOff:1}[method]?{target:physicalGates,channel:args[0]}:{target,channel:args[0]}),
  createMidi:codeMidi,createMidiPart:signal=>createMidiPart(codeParts,signal),
  stopSoundChips:()=>{for(const part of codeParts)part.finish();for(const id of codeMidiNotes.keys())releaseMidiVoice(id);stopOwner('code');},onLog:line=>{el('log').textContent=line;},
  onState:s=>{el('apply').disabled=!s.running;el('log').textContent=s.status;},
});
function render() {
  const p=preset();
  el('bank').replaceChildren(...voices.map((v,i)=>option((i+1)+' · '+voiceToPreset(v).name,i)));
  el('bank').value=selected;el('algorithm').value=p.algorithm;el('feedback').value=p.feedback;el('name').value=p.name;
  el('oscSync').checked=p.oscillatorSync;
  for(const key of Object.keys(p.lfo)){
    const control=el('lfo-'+key);
    if(key==='sync')control.checked=p.lfo.sync;
    else control.value=p.lfo[key];
  }
  for(const key of ['rates','levels'])p.pitchEnvelope[key].forEach((value,i)=>{
    el('pitch-'+key+i).value=value;
  });
  renderRouting(el('ops'),el('routeFeedback'),p,op,isChip(),next=>{
    op=next;render();el('ops').querySelector('[aria-pressed=true]').focus({preventScroll:true});
  });
  const params=el('params');params.replaceChildren();
  function field(title,value,max,patch,choices){
    const label=document.createElement('label'),input=document.createElement(choices?'select':'input');
    if(choices)input.append(...choices.map(v=>option(v,v)));
    else {input.type='number';input.min=0;input.max=max;}
    input.value=value;label.append(title,input);params.append(label);
    input.onchange=async()=>{try{await edit({operators:{[op]:patch(choices?input.value:Number(input.value))}});}catch(e){report(e);render();}};
  }
  const o=p.operators[op];
  field('Frequency',o.mode,0,v=>({mode:v}),['ratio','fixed']);
  for(const [k,title,max] of [['outputLevel','Level',99],['coarse','Coarse',31],['fine','Fine',99],['detune','Detune · neutral 7',14],['rateScaling','Rate scaling',7],['ampModSensitivity','AM sensitivity',3],['velocitySensitivity','Velocity sensitivity',7]])
    field(title,o[k],max,v=>({[k]:v}));
  for(const [k,title] of [['breakpoint','Breakpoint'],['leftDepth','Left depth'],['rightDepth','Right depth']])
    field(title,o.keyboardScaling[k],99,v=>({keyboardScaling:{[k]:v}}));
  const curves=['− Linear','− Exponential','+ Exponential','+ Linear'];
  for(const [k,title] of [['leftCurve','Left curve'],['rightCurve','Right curve']])
    field(title,curves[o.keyboardScaling[k]],3,v=>({keyboardScaling:{[k]:curves.indexOf(v)}}),curves);
  for(const k of ['rates','levels'])o.envelope[k].forEach((v,i)=>field((k==='rates'?'R':'L')+(i+1),v,99,x=>{
    const values=o.envelope[k].slice();values[i]=x;return {envelope:{[k]:values}};
  }));
}
async function edit(patch){
  voices[selected]=presetToVoice(patch,voices[selected]);render();
  if(audio?.dx && Object.keys(patch).length===1 && patch.operators){
    await audio.dx.setOperators(Object.entries(patch.operators).map(([op,params])=>[Number(op),params]));
  }else if(audio?.dx && patch.feedback!==undefined)await audio.dx.setFeedback(patch.feedback);
  else await applyVoice();
}
function download(name,bytes){const url=URL.createObjectURL(new Blob([bytes]));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
for(const [key,title,max] of [
  ['waveform','Waveform',5],['speed','Speed',99],['delay','Delay',99],
  ['pitchModDepth','Pitch depth',99],['pitchModSensitivity','Pitch sensitivity',7],['ampModDepth','Amplitude depth',99],
  ['sync','Key sync',1],
]){
  const label=document.createElement('label'), input=document.createElement(key==='waveform'?'select':'input');
  input.id='lfo-'+key;
  if(key==='waveform')input.append(...['Triangle','Saw down','Saw up','Square','Sine','Sample & hold'].map((name,i)=>option(name,i)));
  else if(key==='sync')input.type='checkbox';
  else {input.type='number';input.min=0;input.max=max;}
  label.append(title,input);el('lfo').append(label);
  on(input.id,'change',()=>edit({lfo:{[key]:key==='sync'?input.checked:Number(input.value)}}));
}
for(const key of ['rates','levels']){
  for(let i=0;i<4;i++){
    const label=document.createElement('label'), input=document.createElement('input');
    input.id='pitch-'+key+i;input.type='number';input.min=0;input.max=99;
    label.append((key==='rates'?'R':'L')+(i+1),input);el('pitchEg').append(label);
    on(input.id,'change',()=>{
      const values=preset().pitchEnvelope[key].slice();
      values[i]=Number(input.value);
      return edit({pitchEnvelope:{[key]:values}});
    });
  }
}
el('algorithm').append(...Array.from({length:32},(_,i)=>option(i+1,i)));
el('inspectCh').append(...Array.from({length:16},(_,i)=>option('CH'+(i+1),i)));
on('inspectCh','change',()=>{el('voiceState').textContent='';audio?.node?.port.postMessage({inspectCh:Number(el('inspectCh').value)});});
el('channel').append(option('AUTO',-1),...Array.from({length:16},(_,i)=>option('CH'+(i+1),i)));
on('bank','change',async()=>{stopSong();selected=Number(el('bank').value);render();await applyVoice();});
on('algorithm','change',()=>edit({algorithm:Number(el('algorithm').value)}));
on('oscSync','change',()=>edit({oscillatorSync:el('oscSync').checked}));
on('feedback','change',()=>edit({feedback:Number(el('feedback').value)}));
on('name','change',()=>edit({name:el('name').value}));
on('engine','change',async()=>{
  el('engine').disabled=true;el('modControls').disabled=wheel.disabled=true;releaseWheel();
  try{if(opening)await opening;await runtime.stop();stopSong();silence();monitor.disconnect();audio?.dx?.dispose();audio?.endpoint?.dispose();await audio?.context.close();audio=null;
    el('channel').disabled=!isChip();el('registers').hidden=!isChip();trace.length=0;render();
  }finally{el('engine').disabled=false;el('modControls').disabled=wheel.disabled=!isChip();}
});
on('master','input',()=>{if(audio)audio.master.gain.value=Number(el('master').value)/100;});
on('saveVoice','click',()=>download(preset().name+'.syx',createVoiceSysex(voices[selected],{channel:sysexChannel})));
on('saveBank','click',()=>download('FM21290-bank.syx',createBankSysex(voices,{channel:sysexChannel})));
on('saveCode','click',()=>download('performance.js',el('code').value));
let selectedScore=[];
function selectPart(){
  stopSong();
  selectedScore=el('part').value?partScore(midi,el('part').value):[];
  const duration=selectedScore.at(-1)?.[0]??0;
  el('midiFrom').value=0;el('midiUntil').value=duration;
  el('midiFrom').max=el('midiUntil').max=duration;
  el('midiLoop').checked=false;el('midiLoop').disabled=!duration;
}
on('part','change',selectPart);
function selectSong(next,bytes){
  midi=next;songBytes=bytes;el('song').hidden=!midi;
  el('part').replaceChildren(...(midi?.parts??[]).filter(p=>p.notes).map(p=>option((p.name||'Track '+(p.track+1))+' · MIDI '+p.channel,p.key)));
  selectPart();el('playMidi').disabled=el('partCode').disabled=!el('part').value;
}
on('saveSession','click',()=>download('FM21290.cassette.zip',exportSession({
  bank:createBankSysex(voices,{channel:sysexChannel}),selected,code:el('code').value,song:songBytes,wheel:manualWheel
})));
on('importFile','change',async()=>{
  const f=el('importFile').files[0];el('importFile').value='';if(!f)return;
  if(/\.js$/i.test(f.name)){el('code').value=await f.text();return;}
  const bytes=new Uint8Array(await f.arrayBuffer());
  if(/\.zip$/i.test(f.name)){
    const next=await importSession(bytes);
    await runtime.stop();stopSong();silence();
    voices.splice(0,32,...next.dump.voices.map(v=>v.data));selected=next.selected;sysexChannel=next.dump.channel;
    restoreModWheel(next.wheel);el('code').value=next.code;selectSong(next.midi,next.song);render();await applyVoice();
  }else if(/\.syx$/i.test(f.name)){
    const dump=parseSysex(bytes);stopSong();sysexChannel=dump.channel;
    if(dump.format==='bank'){voices.splice(0,32,...dump.voices.map(v=>v.data));selected=0;}
    else voices[selected]=dump.voices[0].data;
    render();await applyVoice();
  }else{
    const next=parseMidiFile(bytes);stopSong();selectSong(next,bytes);
  }
});
async function playRegion(){
  stopSong();
  const events=playbackRegion(selectedScore,el('midiFrom').valueAsNumber,el('midiUntil').valueAsNumber,isChip());
  const epoch=songEpoch;await ensureAudio();if(epoch!==songEpoch)return;
  const length=events.at(-1)[0];
  let start=audio.context.currentTime,i=0;
  songPart=createMidiPart();
  function tick(){
    if(epoch!==songEpoch)return;
    const now=audio.context.currentTime;
    while(i<events.length && events[i][0]<=now-start){
      const [,method,...args]=events[i++];
      songPart[method](...args);
    }
    if(i===events.length){
      if(!el('midiLoop').checked || length===0){stopSong();return;}
      // Keep deadlines on the audio clock and skip cycles missed by a suspended tab.
      start+=Math.max(1,Math.floor((now-start)/length))*length;
      songPart=createMidiPart();i=0;
    }
    songTimer=setTimeout(tick,Math.max(0,(start+events[i][0]-audio.context.currentTime)*1000));
  }
  tick();
}
on('playMidi','click',playRegion);
for(const id of ['midiFrom','midiUntil'])on(id,'change',()=>{if(songPart)return playRegion();});
on('stopMidi','click',stopSong);
on('partCode','click',()=>{el('code').value=partSource(selectedScore);el('code').focus();});
el('code').value=glassSteps;
for(const action of ['run','apply'])on(action,'click',async()=>{
  try{await runtime[action](el('code').value);}
  catch(error){if(error?.name!=='AbortError' || error.message!=='Run stopped')throw error;}
});
on('stop','click',()=>runtime.stop());
let savedTrace=null,traceMode='idle';
function traceControls(mode,message){
  traceMode=mode;
  const busy=mode!=='idle';
  el('engine').disabled=busy;
  el('modControls').disabled=wheel.disabled=!isChip()||mode==='replay'||mode==='starting';
  el('capture').disabled=busy;
  el('loadTrace').disabled=busy;
  el('endCapture').disabled=mode!=='record';
  el('endReplay').disabled=mode!=='replay';
  el('replayTrace').disabled=busy||!savedTrace;
  el('saveTrace').disabled=!savedTrace;
  el('traceStatus').textContent=message;
}
function showEvents(){
  const start=Number(el('traceIndex').value);
  el('traceEvents').textContent=savedTrace.events.slice(start,start+12).map(([frame,address,value])=>
    frame+'  '+(address===undefined?'reset':address.toString(16).padStart(4,'0')+'  '+value.toString(16).padStart(2,'0'))).join('\n');
}
function inspectTrace(){
  const {events,frames,sampleRate}=savedTrace;
  el('traceStatus').textContent+=' '+events.length+' events · '+frames+' frames · '+sampleRate+' Hz';
  el('traceIndex').max=Math.max(0,events.length-1);
  el('traceIndex').value=0;
  el('traceInspect').hidden=!events.length;
  showEvents();
}
async function prepareTrace(mode){
  if(traceMode!=='idle')return;
  traceControls('starting','Preparing audio…');
  try{
    await ensureAudio();
    if(mode==='replay')validateTrace(savedTrace,audio.context.sampleRate);
    await runtime.stop();
    stopSong();silence();
    if(mode==='record'){
      audio.node.port.postMessage({record:true});
      applyChipPatch();
      traceControls(mode,'Recording register writes…');
    }else{
      audio.node.port.postMessage({replay:savedTrace});
      traceControls(mode,'Replaying register trace…');
    }
  }catch(error){traceControls('idle','');throw error;}
}
on('capture','click',()=>prepareTrace('record'));
on('endCapture','click',()=>{traceControls('finishing','Finishing recording…');audio.node.port.postMessage({endRecord:true});});
on('traceIndex','input',showEvents);
on('saveTrace','click',()=>download('FM21290.trace.json',JSON.stringify(savedTrace)));
on('loadTrace','change',async()=>{
  const file=el('loadTrace').files[0];el('loadTrace').value='';if(!file)return;
  traceControls('loading','Reading trace…');
  try{savedTrace=validateTrace(JSON.parse(await file.text()));}
  finally{traceControls('idle','');}
  inspectTrace();
});
on('replayTrace','click',()=>prepareTrace('replay'));
on('endReplay','click',()=>audio.node.port.postMessage({endReplay:true}));
on('write','click',async()=>{
  await ensureAudio();
  const read=(id,length)=>{const s=el(id).value;if(!new RegExp('^[0-9a-f]{1,'+length+'}$','i').test(s))throw Error('Invalid hex '+id);return parseInt(s,16);};
  const address=read('addr',4),value=read('data',2);
  if(address===EVENT)rawGate(value,'register');else writeRegister(address,value);flush();
});
const wheel=el('pitchWheel');
let wheelPointer=null;
function displayWheel(cents){
  const value=(cents>0?'+':'')+(cents/100).toFixed(2);
  el('wheelValue').textContent=value;
  wheel.setAttribute('aria-valuetext',value+' semitones');
}
function releaseWheel(){
  wheelPointer=null;wheel.value='0';displayWheel(0);
  if(wheelBend!==null){wheelBend=null;sendBend();}
}
wheel.addEventListener('input',()=>{
  if(wheel.disabled)return;
  const cents=Number(wheel.value);
  displayWheel(cents);wheelBend=pitchBendWord(cents/100);
  if(audio?.node)sendBend();else ensureAudio().catch(report);
});
wheel.addEventListener('pointerdown',e=>{if(e.isPrimary && e.button===0)wheelPointer=e.pointerId;});
function releaseWheelPointer(e){if(e.pointerId===wheelPointer)releaseWheel();}
window.addEventListener('pointerup',releaseWheelPointer);
window.addEventListener('pointercancel',releaseWheelPointer);
wheel.addEventListener('lostpointercapture',releaseWheelPointer);
wheel.addEventListener('keyup',e=>{
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Escape'].includes(e.key))releaseWheel();
});
wheel.addEventListener('blur',releaseWheel);
window.addEventListener('blur',releaseWheel);
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseWheel();});
const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B','C'];
const mappings='awsedftgyhujk';
async function press(id,index){
  if(held.has(id))return;
  const note=Math.min(127,(1+Number(el('octave').value))*12+index);
  const entry={note,ch:isChip()?Number(el('channel').value):-1,started:false};held.set(id,entry);
  try{await ensureAudio();if(held.get(id)!==entry)return;noteOn(note,100,entry.ch,entry);entry.started=true;}
  catch(error){held.delete(id);report(error);}
}
function release(id){
  const entry=held.get(id);
  held.delete(id);
  if(!entry?.started)return;
  noteOff(entry.note,entry.ch,entry);
}
names.forEach((name,i)=>{
  const b=document.createElement('button');b.textContent=name;b.title=mappings[i].toUpperCase();if(name.includes('♯'))b.className='black';
  b.onpointerdown=e=>{b.setPointerCapture(e.pointerId);press(e.pointerId,i);};
  b.onlostpointercapture=e=>release(e.pointerId);el('keys').append(b);
});
window.addEventListener('keydown',e=>{const i=mappings.indexOf(e.key);if(i<0||e.key.length!==1||e.repeat||e.ctrlKey||e.metaKey||e.altKey||(e.target!==wheel && e.target!==el('modPosition') && e.target.closest('input,select,textarea')))return;press(e.code,i);});
window.addEventListener('keyup',e=>release(e.code));
window.addEventListener('blur',()=>{for(const id of [...held.keys()])release(id);});
const canvas=el('scope'),ctx=canvas.getContext('2d');
function draw(){monitor.draw(canvas,ctx,el('scopeMode').value.toLowerCase());el('trace').textContent=trace.join('\n');requestAnimationFrame(draw);}
render();draw();
