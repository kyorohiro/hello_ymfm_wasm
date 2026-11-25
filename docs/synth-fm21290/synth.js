// SPDX-License-Identifier: BSD-3-Clause
import {buildKeyboard, createFretboardLayout, createFretboardState, findLayoutEntry,
  renderFretboardControls, setFretPosition, setInstrument, setStringWindowIndex}
  from '../synth/synth_keyboard.js';
import {createInitVoice,parseSysex,createVoiceSysex,createBankSysex} from '../js/msfa_dx7/src/sysex.js';
import {presetToVoice,voiceToPreset} from '../js/msfa_dx7/src/preset.js';
import {createDx7Audio} from '../js/playground_dx7_audio.js';
import {createDx7Client} from '../js/playground_dx7.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {parseMidiFile} from '../js/midi_file.js';
import {createSynthOutputVisualizer} from '../synth/synth_output_visualizer.js';
import {createOperatorEnvelopes} from './operator_envelopes.js';
import {createParamControl} from '../synth/synth_controls.js';
import {createOperatorEditor} from './operator_editor.js';
import {renderRouting} from './routing.js?v=inline-routing-2';
import {validateTrace} from './register_trace.js';
import {EVENT,integer,validRegister} from './chip.js';
import {createMsfaNotes} from './msfa_notes.js';
import {createMidiApi} from '../js/playground_midi.js';
import {pitchBendWord,createPartPlayer,partScore,partSource,playbackRegion} from './midi_part.js';
import {createNoteOutput} from './midi_output.js';
import {createInstrument} from './instrument.js';
import {createVirtualFileSystem} from '../js/tetorica_virtual_files/filesystem.js';
import {createVirtualFileReader} from '../js/tetorica_virtual_files/reader.js';
import {renderFileTree} from '../playground/playground_file_tree.js';
import {createSynthProjectStore} from '../synth/synth_project_store.js';
import {readProject,textPath,projectPath,defaultWheel,exportSession,importSession} from './session.js';
import {setupSynthMenu} from '../synth/synth_menu.js';
import {setupSynthMonacoEditor} from '../synth/synth_monaco_editor.js';
import {selectFM21290Declarations} from './code_declarations.js';
import {glassSteps,glassPatch,scoreExample} from './examples.js';

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
let draftStore=null,draftTimer=null,draftReady=false,draftSaving=false,draftDirty=false,draftRevision=0;
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
      const mixer=context.createGain(),master=context.createGain();
      mixer.connect(master);master.connect(context.destination);
      const owner={context,mixer,master};
      if(isChip()){
        await context.audioWorklet.addModule(new URL('./worklet.js',import.meta.url));
        owner.node=new AudioWorkletNode(context,'tetorica-fm21290',{numberOfInputs:0,outputChannelCount:[1]});
        owner.node.connect(mixer);
        owner.node.port.onmessage=({data})=>{
          if(data.recorded){
            savedTrace=data.recorded;
            traceControls('idle',data.full?'Event limit reached.':'Recording finished.');
            inspectTrace();
          }
          if(data.replayDone)traceControls('idle','Replay stopped.');
          if(data.error){report(data.error);if(traceMode==='replay')traceControls('idle','Replay failed.');}
          if(data.modulation)el('modBytes').textContent=data.modulation.map(n=>n.toString(16).padStart(2,'0')).join(' ');
          if(audio===owner && data.voice && data.voice.ch===physicalChannel){
            const v=data.voice;
            el('voiceState').textContent='Algorithm '+v.algorithm+' · FB '+v.feedback+' · Pitch 0x'+v.pitch.toString(16).padStart(4,'0')+
              ' · OP1–6 output bytes '+v.levels.map(n=>n.toString(16).padStart(2,'0')).join(' ')+' · EG stages '+v.stages.join(' ');
          }
          if(data.slots && audio===owner)updateChannelStates(data.slots);
        };
      }else{
        owner.endpoint=await createDx7Audio(context,mixer);
        owner.dx=createDx7Client(owner.endpoint.port,owner.endpoint);
        owner.notes=createMsfaNotes(owner.dx,{
          on:(slot,source,n,v)=>noteOutput.on(slot,sendChannel(source),n,v),
          off:slot=>noteOutput.off(slot),
        });
        await owner.dx.loadSysex(createVoiceSysex(voices[selected]));
      }
      for(const id of ['master','mixer'])owner[id].gain.value=Number(el(id).value)/100;
      monitor.connect(context,[master]);audio=owner;
      if(owner.node){if(physicalChannel>=0)owner.node.port.postMessage({inspectCh:physicalChannel});applyChipPatch();if(wheelBend!==null)sendBend();}
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
  held.clear();for(const key of el('keys').querySelectorAll('.pressed'))key.classList.remove('pressed');
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
  manualWheel.value=Number(el('modPosition').value);setModPosition(null,manualWheel.value);draftChanged();
});
for(const id of ['modRange','modPitch','modAmp','modBias'])on(id,'change',()=>{
  const input=el('modRange');
  if(!input.checkValidity()||input.value==='')input.value=manualWheel.range;
  manualWheel.range=Number(input.value);
  manualWheel.assign=Number(el('modPitch').checked)+2*el('modAmp').checked+4*el('modBias').checked;
  sendModWheel();draftChanged();
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
let files=createVirtualFileSystem([{path:'/index.js',data:glassSteps},...scoreExample]);
let activePath='/index.js',selectedFile=activePath;
const expanded=new Map();
const runnable=()=>/\.m?js$/i.test(activePath);
const currentBank=()=>createBankSysex(voices,{channel:sysexChannel});
const projectReader={get(path){
  if(path==='/bank.syx')return {type:'binary',data:currentBank()};
  if(path==='/song.mid')return songBytes?{type:'binary',data:songBytes}:null;
  if(path===activePath)return {type:'text',data:el('code').value};
  return files.get(path);
}};
function storeEditor(){
  const text=el('code').value;
  if(text!==files.get(activePath).data)files.writeText(activePath,text);
}
function showEditor(path){
  selectedFile=activePath=path;codeEditor.setSource(files.get(path).data,path);el('activeFile').textContent=path;
  el('run').disabled=!runnable();el('apply').disabled=!runnable()||!runtime.getState().running;
  el('partCode').disabled=!runnable()||!el('part').value;
  renderFiles();draftChanged();
}
function projectFileList(){
  const list=[];
  for(const dir of files.listDirectories()){
    if(dir!=='/')list.push({path:dir,type:'directory'});
    for(const name of files.readdir(dir)){
      const path=(dir==='/'?'':dir)+'/'+name;
      if(files.has(path))list.push({path});
    }
  }
  list.push({path:'/bank.syx'});
  if(songBytes)list.push({path:'/song.mid'});
  return list;
}
function renderFiles(){
  renderFileTree(el('filesTree'),projectFileList(),{expanded,selectedPath:selectedFile,onOpen:path=>openProjectFile(path).catch(report)});
}
async function openProjectFile(path){
  storeEditor();
  if(textPath(path)){editFile(path);return;}
  const bytes=projectReader.get(path).data;
  if(/\.syx$/i.test(path))await loadVoiceFile(bytes);
  else if(/\.midi?$/i.test(path)){const next=parseMidiFile(bytes);stopSong();selectSong(next,bytes);}
  else {download(path.split('/').pop(),bytes);return;}
  selectBinaryFile(path);
}
const extraChannels=Array.from({length:10},(_,i)=>'CH'+(i+7));
const runtime=createPlaygroundCodeRuntime({
  readFile:(path,options,entry)=>createVirtualFileReader(projectReader,entry.path)(path,options),
  prepareSource:source=>'const '+extraChannels.map((name,i)=>name+'='+(i+6)).join(',')+
    '; Object.assign(pg,{'+extraChannels.join(',')+'});\n{\n'+source+'\n}',
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
  onState:s=>{el('apply').disabled=!runnable()||!s.running;el('log').textContent=s.status;},
});
function selectOperator(next){
  op=next;render();
}
function changeOperator(number,patch,stage){
  op=number;edit({operators:{[number]:patch}},stage).catch(report);
}
const updateOperators=createOperatorEditor({toolbar:el('operatorGroups'),host:el('operatorTable'),selectOperator,change:changeOperator});
const updateEnvelopes=createOperatorEnvelopes(el('opEnvelopes'),next=>{
  const group=el('operatorGroups').querySelector('[data-group="Envelope"]');
  if(group.getAttribute('aria-pressed')!=='true')group.click();
  if(next!==op)selectOperator(next);
},changeOperator);
function renderOperators(p,stage){
  updateOperators(p.operators,op);
  updateEnvelopes(p.operators,op,stage);
}
function numericControl(host,label,max,onChange,formatValue=String,min=0){
  const control=createParamControl({label,min,max,step:1,value:0,showLabel:false,formatValue,
    onChange:async value=>{try{await onChange(value);}catch(error){report(error);}}});
  const [minus,value,plus]=control.element.querySelectorAll('button');
  minus.setAttribute('aria-label','Decrease '+label);plus.setAttribute('aria-label','Increase '+label);
  value.title=label+' · drag left or right';
  value.onkeydown=event=>{
    if(event.key!=='ArrowLeft' && event.key!=='ArrowRight')return;
    event.preventDefault();event.stopPropagation();
    (event.key==='ArrowLeft'?minus:plus).click();
  };
  host.append(control.element);
  return control;
}
const algorithmControl=numericControl(el('algorithm'),'Algorithm',31,value=>edit({algorithm:value}),value=>String(value+1));
const feedbackControl=numericControl(el('feedback'),'Feedback',7,value=>edit({feedback:value}));
const pitchControls={rates:[],levels:[]},lfoControls={};
function render() {
  draftChanged();
  const p=preset();
  el('bank').replaceChildren(...voices.map((v,i)=>option((i+1)+' · '+voiceToPreset(v).name,i)));
  el('bank').value=selected;algorithmControl.updateVisual(p.algorithm);feedbackControl.updateVisual(p.feedback);el('name').value=p.name;
  el('oscSync').setAttribute('aria-pressed',String(p.oscillatorSync));
  el('oscSync').textContent=p.oscillatorSync?'ON':'OFF';
  for(const key of Object.keys(p.lfo)){
    if(key==='sync'){
      el('lfo-sync').setAttribute('aria-pressed',String(p.lfo.sync));
      el('lfo-sync').textContent=p.lfo.sync?'ON':'OFF';
    }else lfoControls[key].updateVisual(p.lfo[key]);
  }
  for(const key of ['rates','levels'])p.pitchEnvelope[key].forEach((value,i)=>{
    pitchControls[key][i].updateVisual(value);
  });
  renderRouting(el('ops'),p,op,selectOperator);
  renderOperators(p);
}
async function edit(patch,stage){
  voices[selected]=presetToVoice(patch,voices[selected]);
  const operatorsOnly=Object.keys(patch).length===1 && patch.operators;
  if(operatorsOnly){
    renderOperators(preset(),stage);
    for(const button of el('ops').querySelectorAll('button'))button.setAttribute('aria-pressed',String(Number(button.dataset.op)===op));
    draftChanged();
  }else render();
  if(audio?.dx && operatorsOnly){
    await audio.dx.setOperators(Object.entries(patch.operators).map(([op,params])=>[Number(op),params]));
  }else if(audio?.dx && patch.feedback!==undefined)await audio.dx.setFeedback(patch.feedback);
  else await applyVoice();
}
function download(name,bytes){const url=URL.createObjectURL(new Blob([bytes]));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function parameterField(root,title){
  const host=document.createElement('div');
  host.className='voice-parameter';host.textContent=title;root.append(host);
  return host;
}
const waveforms=['Triangle','Saw down','Saw up','Square','Sine','Sample & hold'];
for(const [key,title,max] of [
  ['waveform','Waveform',5],['speed','Speed',99],['delay','Delay',99],
  ['pitchModDepth','Pitch depth',99],['pitchModSensitivity','Pitch sensitivity',7],['ampModDepth','Amplitude depth',99],
]){
  const host=parameterField(el('lfo'),title);
  lfoControls[key]=numericControl(host,'LFO '+title,max,value=>edit({lfo:{[key]:value}}),
    key==='waveform'?value=>waveforms[value]:String);
}
const syncButton=document.createElement('button');
syncButton.type='button';syncButton.id='lfo-sync';syncButton.setAttribute('aria-label','LFO key sync');
syncButton.onclick=()=>edit({lfo:{sync:!preset().lfo.sync}}).catch(report);
parameterField(el('lfo'),'Key sync').append(syncButton);
for(const key of ['rates','levels']){
  for(let i=0;i<4;i++){
    const label=(key==='rates'?'R':'L')+(i+1);
    const host=parameterField(el('pitchEg'),label);
    pitchControls[key].push(numericControl(host,'Pitch envelope '+label,99,value=>{
      const values=preset().pitchEnvelope[key].slice();values[i]=value;
      return edit({pitchEnvelope:{[key]:values}});
    }));
  }
}
let physicalChannel=-1;
for(let channel=-1;channel<16;channel++){
  const button=document.createElement('button');
  button.textContent=channel<0?'AUTO':'CH'+(channel+1);
  button.onclick=()=>{
    physicalChannel=channel;refreshChannels();
    el('voiceState').textContent='';
    if(channel>=0)audio?.node?.port.postMessage({inspectCh:channel});
  };
  el('channels').append(button);
}
function updateChannelStates(slots=[]){
  for(let i=0;i<16;i++){
    const button=el('channels').children[i+1];
    const state=['idle','release','on'][slots[i]??0];
    if(button.dataset.state===state)continue;
    button.dataset.state=state;
    button.title='CH'+(i+1)+' · '+state;
    button.setAttribute('aria-description',state);
  }
}
function refreshChannels(){
  Array.from(el('channels').children,(button,index)=>{
    button.disabled=!isChip() && index>0;
    button.setAttribute('aria-pressed',String(index===(isChip()?physicalChannel+1:0)));
  });
  el('voiceState').hidden=!isChip() || physicalChannel<0;
}
on('bank','change',async()=>{stopSong();selected=Number(el('bank').value);render();await applyVoice();});
on('oscSync','click',()=>edit({oscillatorSync:!preset().oscillatorSync}));
on('name','change',()=>edit({name:el('name').value}));
on('engine','change',async()=>{
  el('engine').disabled=true;el('modPosition').disabled=el('modControls').disabled=wheel.disabled=true;releaseWheel();
  try{if(opening)await opening;await runtime.stop();stopSong();silence();monitor.disconnect();audio?.dx?.dispose();audio?.endpoint?.dispose();await audio?.context.close();audio=null;
    refreshChannels();updateTabs();trace.length=0;updateChannelStates();el('voiceState').textContent='';render();
  }finally{el('engine').disabled=false;el('modPosition').disabled=el('modControls').disabled=wheel.disabled=!isChip();}
});
for(const id of ['master','mixer'])on(id,'input',()=>{
  el(id+'Value').textContent=el(id).value+'%';
  if(audio)audio[id].gain.value=Number(el(id).value)/100;
  draftChanged();
});
on('saveVoice','click',()=>download(preset().name+'.syx',createVoiceSysex(voices[selected],{channel:sysexChannel})));
on('saveBank','click',()=>download('FM21290-bank.syx',createBankSysex(voices,{channel:sysexChannel})));
on('saveCode','click',()=>download(activePath.split('/').pop(),el('code').value));
let selectedScore=[];
function selectPart(){
  draftChanged();
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
  selectPart();el('playMidi').disabled=!el('part').value;el('partCode').disabled=!runnable()||!el('part').value;renderFiles();
}
on('newFile','click',()=>{
  const name=el('newPath').value.trim();
  const path=projectPath(name.startsWith('/')?name:'/'+name);
  if(!textPath(path))throw Error('Choose a .js, .mjs, .json or .txt file.');
  if(files.has(path))throw Error('File already exists: '+path);
  storeEditor();files.writeText(path,path.endsWith('.json')?'{}':'');
  el('newPath').value='';showNewFile(false);editFile(path);
});
on('saveSession','click',()=>{
  storeEditor();
  download('FM21290.cassette.zip',exportSession({bank:currentBank(),selected,code:files.get('/index.js').data,
    entries:files.list().filter(f=>f.path!=='/index.js'),directories:files.listDirectories(),activePath,song:songBytes,wheel:manualWheel}));
});
async function loadVoiceFile(bytes){
  const dump=parseSysex(bytes);stopSong();sysexChannel=dump.channel;
  if(dump.format==='bank'){voices.splice(0,32,...dump.voices.map(v=>v.data));selected=0;}
  else voices[selected]=dump.voices[0].data;
  render();await applyVoice();
}
function replaceProject(next){
  voices.splice(0,32,...next.dump.voices.map(v=>v.data));selected=next.selected;sysexChannel=next.dump.channel;
  files=next.fs;expanded.clear();
  restoreModWheel(next.wheel);selectSong(next.midi,next.song);showEditor(next.activePath);render();
}
for(const id of ['importVoice','importMidi','importCassette'])on(id,'change',async()=>{
  const f=el(id).files[0];el(id).value='';if(!f)return;
  const bytes=new Uint8Array(await f.arrayBuffer());
  if(id==='importCassette'){
    const next=await importSession(bytes);
    await runtime.stop();stopSong();silence();
    replaceProject(next);await applyVoice();
    return;
  }
  const isVoice=id==='importVoice';
  if(!(isVoice?/\.syx$/i:/\.midi?$/i).test(f.name))throw Error(isVoice?'Choose a DX7 SysEx (.syx) file.':'Choose a MIDI (.mid or .midi) file.');
  const folder=isVoice?'voices':'songs';
  const base='/'+folder+'/'+f.name;
  let path=projectPath(base),n=2;
  while(files.has(path))path=base.replace(/(\.[^./]+)$/,' ('+(n++)+')$1');
  storeEditor();
  if(isVoice)await loadVoiceFile(bytes);
  else{
    const next=parseMidiFile(bytes);stopSong();selectSong(next,bytes);setFiles(true);
  }
  files.writeBinary(path,bytes);expanded.set('/'+folder,true);selectBinaryFile(path);
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
const codeEditor=setupSynthMonacoEditor({
  textarea:el('code'),editorHost:el('codeEditorHost'),editorNote:el('editorNote'),
  chip:'fm21290',transformDeclarations:selectFM21290Declarations,declarationsOnly:true,
  visible:()=>!el('codePanel').hidden,whenReady:()=>{},getPath:()=>activePath,
  listFiles:()=>projectFileList().filter(f=>f.type!=='directory' && textPath(f.path)).map(f=>files.get(f.path)),
  openFile:openProjectFile,
  onEdit:draftChanged,run:apply=>el(apply?'apply':'run').click(),
});
function setFiles(open){
  el('filesPanel').hidden=!open;
  el('workspace').classList.toggle('with-files',open);
  el('filesToggle').setAttribute('aria-expanded',String(open));
}
const panelNames={chipPanel:'YM21290',registers:'Register',mixerPanel:'Mixer',keyboardPanel:'Keyboard',codePanel:'Code'};
const soundIds=['chipPanel','registers','mixerPanel'];
const inputIds=['keyboardPanel','codePanel'];
let codeMode=false,soundTab='chipPanel',inputTab='keyboardPanel',fullTab='codePanel';
function selectPanel(id){
  if(codeMode)fullTab=id;
  else if(inputIds.includes(id))inputTab=id;
  else soundTab=id;
  updateTabs();draftChanged();
}
function displayTabs(root,ids,current){
  const list=el(root);
  for(const id of ids){
    let tab=el('tab-'+id);
    if(!tab){
      tab=document.createElement('button');tab.id='tab-'+id;tab.textContent=panelNames[id];
      tab.setAttribute('role','tab');tab.setAttribute('aria-controls',id);
      tab.onclick=()=>selectPanel(id);
      tab.onkeydown=event=>{
        const tabs=Array.from(tab.parentElement.querySelectorAll('button:not([hidden])'));
        const index=tabs.indexOf(tab);
        const next={ArrowLeft:(index+tabs.length-1)%tabs.length,ArrowRight:(index+1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
        if(next===undefined)return;
        event.preventDefault();tabs[next].click();tabs[next].focus();
      };
    }
    const position=ids.indexOf(id);
    if(list.children[position]!==tab)list.insertBefore(tab,list.children[position]??null);
    tab.hidden=id==='registers'&&!isChip();
    tab.tabIndex=id===current?0:-1;tab.setAttribute('aria-selected',String(id===current));
    const panel=el(id),host=el(root==='mainTabs'?'mainPanels':'inputPanels');
    if(panel.parentElement!==host)host.append(panel);
    panel.hidden=id!==current;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);
  }
}
function updateTabs(){
  if(!isChip()){
    if(soundTab==='registers')soundTab='chipPanel';
    if(fullTab==='registers')fullTab='chipPanel';
  }
  displayTabs('mainTabs',codeMode?['codePanel',...soundIds,'keyboardPanel']:soundIds,codeMode?fullTab:soundTab);
  if(!codeMode)displayTabs('inputTabs',inputIds,inputTab);
  el('inputTabs').hidden=el('inputPanels').hidden=codeMode;
  if(!el('codePanel').hidden)codeEditor.layout();
}
function setView(code){
  codeMode=code;
  el('codeView').setAttribute('aria-pressed',String(code));
  el('synthView').setAttribute('aria-pressed',String(!code));
  updateTabs();
}
function selectBinaryFile(path){
  selectedFile=path;renderFiles();
  if(/\.syx$/i.test(path)){
    selectPanel('chipPanel');
    if(matchMedia('(max-width: 760px)').matches)setFiles(false);
  }
  draftChanged();
}
function showNewFile(open){
  el('newEntry').hidden=!open;el('showNewFile').setAttribute('aria-expanded',String(open));
  if(open){
    const field=el('newPath');
    if(!field.value){
      let n=1;
      while(files.has('/score'+n+'.js'))n++;
      field.value='/score'+n+'.js';
    }
    field.focus();field.select();
  }
}
on('showNewFile','click',()=>showNewFile(el('newEntry').hidden));
function editFile(path){
  showEditor(path);selectPanel('codePanel');
  if(matchMedia('(max-width: 760px)').matches)setFiles(false);
  el('codePanel').scrollIntoView({block:'start'});codeEditor.focus();draftChanged();
}
on('filesToggle','click',()=>{setFiles(el('filesPanel').hidden);draftChanged();});
for(const [id,code] of [['codeView',true],['synthView',false]])on(id,'click',()=>{
  setView(code);
  draftChanged();
});
setFiles(!matchMedia('(max-width: 760px)').matches);setView(false);
setupSynthMenu({document,window});
el('synthMenuPanel').addEventListener('click',event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(action==='newPath'){
    setFiles(true);showNewFile(true);draftChanged();el('filesPanel').scrollIntoView({block:'start'});el(action).focus({preventScroll:true});
  }else if(action){
    if(!event.detail)el('synthMenuButton').focus({preventScroll:true});
    el(action).click();
  }
});
on('enableEditor','click',async()=>{
  const button=el('enableEditor');button.disabled=true;
  try{button.hidden=await codeEditor.load();if(button.hidden)codeEditor.focus();}
  finally{button.disabled=false;}
});
on('partCode','click',()=>{files.writeText(activePath,partSource(selectedScore));editFile(activePath);});
showEditor('/index.js');
for(const action of ['run','apply'])on(action,'click',async()=>{
  try{await runtime[action](el('code').value,{path:activePath});}
  catch(error){if(error?.name!=='AbortError' || error.message!=='Run stopped')throw error;}
});
on('stop','click',()=>runtime.stop());
let savedTrace=null,traceMode='idle';
function traceControls(mode,message){
  traceMode=mode;
  const busy=mode!=='idle';
  el('engine').disabled=busy;
  el('modPosition').disabled=el('modControls').disabled=wheel.disabled=!isChip()||mode==='replay'||mode==='starting';
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
const fretboard=createFretboardState();
let keyboardOctave=0;
let layout;
async function press(id,pad,button){
  if(document.querySelector('main').inert || held.has(id) || pad.midi<0 || pad.midi>127)return;
  const entry={button,note:pad.midi,ch:isChip()?physicalChannel:-1,started:false};
  held.set(id,entry);
  try{
    await ensureAudio();
    if(held.get(id)!==entry)return;
    noteOn(entry.note,100,entry.ch,entry);entry.started=true;button.classList.add('pressed');
  }catch(error){held.delete(id);report(error);}
}
function release(id){
  const entry=held.get(id);held.delete(id);
  if(!entry?.started)return;
  noteOff(entry.note,entry.ch,entry);
  if(![...held.values()].some(e=>e.started && e.button===entry.button))entry.button.classList.remove('pressed');
}
function rebuildKeyboard(){
  for(const id of [...held.keys()])release(id);
  layout=createFretboardLayout({state:fretboard,octave:keyboardOctave});
  renderFretboardControls({state:fretboard,instrumentRoot:el('instruments'),positionRoot:el('positions'),stringWindowRoot:el('strings'),
    onInstrumentChange:id=>{setInstrument(fretboard,id);rebuildKeyboard();},
    onPositionPresetSelect:fret=>{setFretPosition(fretboard,fret);rebuildKeyboard();},
    onStringWindowChange:index=>{setStringWindowIndex(fretboard,index);rebuildKeyboard();}});
  buildKeyboard({root:el('keys'),rowDefs:layout.rowDefs,layoutEntries:layout.entries,showPitch:false,
    onPointerDown:(event,pad,button)=>press(event.pointerId,pad,button),
    onPointerUp:event=>release(event.pointerId),onPointerCancel:event=>release(event.pointerId)});
}
const octaveControl=numericControl(el('octaveControl'),'Keyboard octave',3,value=>{
  if(keyboardOctave===value)return;
  keyboardOctave=value;
  octaveDown.disabled=value===-3;
  octaveUp.disabled=value===3;
  rebuildKeyboard();
},value=>value>0?'+'+value:String(value),-3);
const [octaveDown,octaveValue,octaveUp]=octaveControl.element.querySelectorAll('button');
octaveDown.id='octaveDown';octaveValue.id='octaveValue';octaveUp.id='octaveUp';
rebuildKeyboard();refreshChannels();updateChannelStates();
// Mouse adjustments should return typing to Code, or playing to the fretboard.
// Ranges reached with Tab retain their native arrow-key behavior.
let rangeGesture=null;
document.addEventListener('pointerdown',event=>{
  if(!event.isPrimary || event.button!==0 || !event.target.matches('input[type=range]'))return;
  rangeGesture={range:event.target,id:event.pointerId,editor:el('codePanel').contains(document.activeElement)
    && document.activeElement.closest('textarea,.monaco-editor,[contenteditable]')};
});
function finishRangeGesture(event){
  if(rangeGesture?.id!==event.pointerId)return;
  const {range,editor}=rangeGesture;rangeGesture=null;
  if(document.activeElement!==range)return;
  if(editor && !el('codePanel').hidden)codeEditor.focus();
  else range.blur();
}
window.addEventListener('pointerup',finishRangeGesture);
window.addEventListener('pointercancel',finishRangeGesture);
window.addEventListener('keydown',e=>{
  if(document.querySelector('main').inert || e.defaultPrevented || e.isComposing || e.repeat || e.altKey || e.target.closest('#synthMenu[open]') ||
    e.target.closest('input:not([type=range]),select,textarea,[contenteditable],.monaco-editor'))return;
  if(e.ctrlKey || e.metaKey){
    if(e.key==='Enter'){
      e.preventDefault();el(e.shiftKey?'apply':'run').click();
    }
    return;
  }
  const pad=findLayoutEntry(layout.entries,e.key.toLowerCase());
  if(pad){press(e.code,pad,el('keys').querySelector('[data-key="'+pad.key+'"]'));return;}
  if(el('keyboardPanel').hidden || e.target.closest('input,button[role=tab],#filesPanel'))return;
  if(e.key==='ArrowLeft'||e.key==='ArrowRight')
    setFretPosition(fretboard,Math.min(24,fretboard.horizontalFretPosition+(e.key==='ArrowRight'?1:-1)));
  else if(e.key==='ArrowUp'||e.key==='ArrowDown')
    setStringWindowIndex(fretboard,fretboard.stringWindowIndex+(e.key==='ArrowUp'?1:-1));
  else return;
  e.preventDefault();rebuildKeyboard();
});
window.addEventListener('keyup',e=>release(e.code));
window.addEventListener('blur',()=>{for(const id of [...held.keys()])release(id);});
const canvas=el('scope'),ctx=canvas.getContext('2d');
let scopeMode='waveform';
const scopeButtons=el('scopeModes').querySelectorAll('button');
for(const button of scopeButtons){
  button.addEventListener('mousedown',event=>event.preventDefault());
  button.onclick=()=>{
    scopeMode=button.dataset.scope;
    for(const choice of scopeButtons)choice.setAttribute('aria-pressed',String(choice===button));
    canvas.setAttribute('aria-label','Output '+scopeMode);
  };
}
new ResizeObserver(([entry])=>{
  canvas.width=Math.max(1,Math.round(entry.contentRect.width));
  canvas.height=Math.max(1,Math.round(entry.contentRect.height));
}).observe(canvas);
function draw(){monitor.draw(canvas,ctx,scopeMode);el('trace').textContent=trace.join('\n');requestAnimationFrame(draw);}
function draftChanged(){
  if(!draftReady)return;
  draftDirty=true;draftRevision++;
  el('draftStatus').textContent='Saving locally…';
  if(draftTimer===null)draftTimer=setTimeout(saveDraft,200);
}
function captureDraft(){
  storeEditor();
  return {selected,op,activePath,selectedFile,codeView:codeMode,soundTab,inputTab,fullTab,filesOpen:!el('filesPanel').hidden,wheel:manualWheel,bank:currentBank(),song:songBytes,
      ...files.snapshot(),engine:el('engine').value,master:Number(el('master').value),mixer:Number(el('mixer').value),
      part:el('part').value,from:el('midiFrom').valueAsNumber,until:el('midiUntil').valueAsNumber,loop:el('midiLoop').checked};
}
// The IndexedDB transaction may be cancelled by navigation. Keep a tab-local
// copy only while there are edits awaiting a successful commit.
const journalKey='tetorica-fm21290-pending';
function protectDraft(){
  if(!draftReady || (!draftDirty && !draftSaving))return;
  try{
    sessionStorage.setItem(journalKey,JSON.stringify(captureDraft(),(_key,value)=>{
      if(!(value instanceof Uint8Array))return value;
      let raw='';
      for(let i=0;i<value.length;i+=32768)raw+=String.fromCharCode(...value.subarray(i,i+32768));
      return {base64:btoa(raw)};
    }));
  }catch(error){
    el('draftStatus').textContent='Pending edits need a local save or Cassette export. '+error.message;
  }
  void saveDraft();
}
function pendingDraft(){
  let text;
  try{text=sessionStorage.getItem(journalKey);}catch{return null;}
  return text?JSON.parse(text,(_key,value)=>typeof value?.base64==='string'?
    Uint8Array.from(atob(value.base64),char=>char.charCodeAt(0)):value):null;
}
async function saveDraft(){
  clearTimeout(draftTimer);draftTimer=null;
  if(!draftDirty || draftSaving)return;
  draftSaving=true;
  const revision=draftRevision;
  draftDirty=false;
  try{
    if(!await draftStore.write(captureDraft()))throw Error('IndexedDB unavailable');
    if(revision===draftRevision){
      try{sessionStorage.removeItem(journalKey);}catch{}
      el('draftStatus').textContent='Saved locally';
    }
  }catch(error){
    if(revision===draftRevision){
      draftDirty=true;
      el('draftStatus').textContent='Local save failed. Export Cassette to keep your edits. '+error.message;
    }
  }finally{
    draftSaving=false;
    if(draftDirty && revision!==draftRevision)void saveDraft();
  }
}
async function restoreDraft(){
  const main=document.querySelector('main');
  try{
    if(!window.indexedDB)throw Error('IndexedDB unavailable');
    draftStore=createSynthProjectStore({name:'tetorica-fm21290-synth-project'});
    const decode=draft=>readProject(draft,draft.bank,draft.song,draft.files,draft.directories);
    let draft,next,pending=false,journalError=null;
    try{
      draft=pendingDraft();
      if(draft){next=decode(draft);pending=true;}
    }catch(error){journalError=error;}
    if(!pending){
      draft=await draftStore.read();
      if(draft)next=decode(draft);
      else if(journalError)throw journalError;
    }
    if(next){
      if(Number.isInteger(draft.op)&&draft.op>=1&&draft.op<=6)op=draft.op;
      el('engine').value=draft.engine==='msfa'?'msfa':'chip';
      for(const id of ['master','mixer']){
        if(Number.isInteger(draft[id]) && draft[id]>=0 && draft[id]<=380)el(id).value=draft[id];
        el(id+'Value').textContent=el(id).value+'%';
      }
      el('modPosition').disabled=el('modControls').disabled=wheel.disabled=!isChip();refreshChannels();
      replaceProject(next);
      if(projectFileList().some(f=>f.path===draft.selectedFile && f.type!=='directory')){selectedFile=draft.selectedFile;renderFiles();}
      if(soundIds.includes(draft.soundTab))soundTab=draft.soundTab;
      if(inputIds.includes(draft.inputTab))inputTab=draft.inputTab;
      if(draft.fullTab==='voicePanel')fullTab='chipPanel';
      else if(Object.hasOwn(panelNames,draft.fullTab))fullTab=draft.fullTab;
      setView(draft.codeView??(activePath!=='/index.js'));
      if(typeof draft.filesOpen==='boolean')setFiles(draft.filesOpen);
      if(next.midi?.parts.some(p=>p.notes && p.key===draft.part)){
        el('part').value=draft.part;selectPart();
        if(Number.isFinite(draft.from)&&Number.isFinite(draft.until)&&draft.from>=0&&
            draft.from<draft.until&&draft.until<=selectedScore.at(-1)[0]){
          el('midiFrom').value=draft.from;el('midiUntil').value=draft.until;el('midiLoop').checked=draft.loop===true;
        }
      }
    }
    el('draftStatus').textContent=draft?'Local project restored':'Local autosave ready';
    if(journalError)el('draftStatus').textContent='Restored last IndexedDB save. Pending edits could not be read.';
    draftReady=true;
    if(pending){draftChanged();await saveDraft();}
  }catch(error){
    el('draftStatus').textContent='Local recovery unavailable. Use Export Cassette. '+error.message;
  }finally{
    try{
      const path='/examples/return-steps.js';
      if(files.has('/examples/glass-echo/play.js') && !files.has(path) && !files.listDirectories().includes(path)){
        const response=await fetch(new URL('./examples/return-steps.js',import.meta.url));
        if(!response.ok)throw Error('Could not load Return Steps ('+response.status+')');
        files.writeText(path,await response.text());renderFiles();
      }
    }catch(error){report(error);}
    main.inert=false;
  }
}
for(const id of ['midiFrom','midiUntil','midiLoop'])el(id).addEventListener('input',draftChanged);
window.addEventListener('pagehide',protectDraft);
document.addEventListener('visibilitychange',()=>{if(document.hidden)protectDraft();});
render();draw();void restoreDraft();
