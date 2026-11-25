// SPDX-License-Identifier: BSD-3-Clause
import {createInitVoice,parseSysex,createVoiceSysex,createBankSysex} from '../js/msfa_dx7/src/sysex.js';
import {presetToVoice,voiceToPreset} from '../js/msfa_dx7/src/preset.js';
import {createDx7Audio} from '../js/playground_dx7_audio.js';
import {createDx7Client} from '../js/playground_dx7.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {parseMidiFile} from '../js/midi_file.js';
import {createSynthOutputVisualizer} from '../synth/synth_output_visualizer.js';
import {dx7CarrierOperators} from '../playground/playground_dx7_voice_panel.js';
import {integer,validRegister} from './chip.js';
import {createInstrument} from './instrument.js';
import {exportSession,importSession} from './session.js';
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
const chip=createInstrument(writeRegister);
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
        owner.node.port.onmessage=({data})=>{
          if(data.error)report(data.error);
          if(data.slots)el('slots').textContent=data.slots.map((s,i)=>'CH'+(i+1)+' '+['·','release','on'][s]).join('   ');
        };
      }else{
        owner.endpoint=await createDx7Audio(context,master);
        owner.dx=createDx7Client(owner.endpoint.port,owner.endpoint);
        await owner.dx.loadSysex(createVoiceSysex(voices[selected]));
      }
      monitor.connect(context,[master]);audio=owner;
      if(owner.node){chip.setPatch(preset());flush();}
      return owner;
    }catch(error){await context.close();throw error;}
  })();
  try{return await opening;}finally{opening=null;}
}
async function applyVoice(){
  if(audio?.dx)await audio.dx.setPreset(preset());
  if(audio?.node){chip.setPatch(preset());flush();}
}
function noteOn(note,velocity=100,ch=-1) {
  if(audio?.dx)audio.dx.noteOn(note,velocity);
  else if(ch<0)chip.noteOn(note,velocity);
  else chip.keyOn(ch,note,velocity);
  flush();
}
function noteOff(note,ch=-1){
  if(audio?.dx)audio.dx.noteOff(note);
  else if(ch<0)chip.noteOff(note);
  else chip.keyOff(ch);
  flush();
}
function silence(){
  if(audio?.dx)audio.dx.panic();
  if(audio?.node){chip.allNotesOff();flush();audio.node.port.postMessage({reset:true});chip.setPatch(preset());flush();}
  held.clear();
}
function stopSong(){songEpoch++;clearTimeout(songTimer);songTimer=null;silence();}
const physicalGates={keyOff(ch){chip.keyOff(ch);flush();}};
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
      keyOn(ch,n,v){chip.keyOn(ch,n,v);flush();},keyOff(ch){chip.keyOff(ch);flush();},
      writeRegister(a,v){writeRegister(a,v);flush();},
    });
    return api;
  },
  resolveNoteTarget:(target,method,args)=>({keyOn:1,keyOff:1}[method]?{target:physicalGates,channel:args[0]}:{target,channel:args[0]}),
  stopSoundChips:silence,onLog:line=>{el('log').textContent=line;},
  onState:s=>{el('apply').disabled=!s.running;el('log').textContent=s.status;},
});
function render() {
  const p=preset();
  el('bank').replaceChildren(...voices.map((v,i)=>option((i+1)+' · '+voiceToPreset(v).name,i)));
  el('bank').value=selected;el('algorithm').value=p.algorithm;el('feedback').value=p.feedback;el('name').value=p.name;
  const carriers=dx7CarrierOperators(p.algorithm);
  el('ops').replaceChildren(...Array.from({length:6},(_,i)=>{
    const b=document.createElement('button');b.textContent='OP'+(i+1)+(carriers.includes(i+1)?' · Out':'');
    b.setAttribute('aria-pressed',String(i+1===op));b.onclick=()=>{op=i+1;render();};return b;
  }));
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
el('algorithm').append(...Array.from({length:32},(_,i)=>option(i+1,i)));
el('channel').append(option('AUTO',-1),...Array.from({length:16},(_,i)=>option('CH'+(i+1),i)));
on('bank','change',async()=>{stopSong();selected=Number(el('bank').value);render();await applyVoice();});
on('algorithm','change',()=>edit({algorithm:Number(el('algorithm').value)}));
on('feedback','change',()=>edit({feedback:Number(el('feedback').value)}));
on('name','change',()=>edit({name:el('name').value}));
on('engine','change',async()=>{
  el('engine').disabled=true;
  try{if(opening)await opening;await runtime.stop();stopSong();monitor.disconnect();audio?.dx?.dispose();audio?.endpoint?.dispose();await audio?.context.close();audio=null;
    el('channel').disabled=!isChip();el('registers').hidden=!isChip();trace.length=0;
  }finally{el('engine').disabled=false;}
});
on('master','input',()=>{if(audio)audio.master.gain.value=Number(el('master').value)/100;});
on('saveVoice','click',()=>download(preset().name+'.syx',createVoiceSysex(voices[selected],{channel:sysexChannel})));
on('saveBank','click',()=>download('FM21290-bank.syx',createBankSysex(voices,{channel:sysexChannel})));
on('saveCode','click',()=>download('performance.js',el('code').value));
function selectSong(next,bytes){
  midi=next;songBytes=bytes;el('song').hidden=!midi;
  el('part').replaceChildren(...(midi?.parts??[]).filter(p=>p.notes).map(p=>option((p.name||'Track '+(p.track+1))+' · MIDI '+p.channel,p.key)));
}
on('saveSession','click',()=>download('FM21290.cassette.zip',exportSession({
  bank:createBankSysex(voices,{channel:sysexChannel}),selected,code:el('code').value,song:songBytes
})));
on('importFile','change',async()=>{
  const f=el('importFile').files[0];el('importFile').value='';if(!f)return;
  if(/\.js$/i.test(f.name)){el('code').value=await f.text();return;}
  const bytes=new Uint8Array(await f.arrayBuffer());
  if(/\.zip$/i.test(f.name)){
    const next=await importSession(bytes);
    await runtime.stop();stopSong();
    voices.splice(0,32,...next.dump.voices.map(v=>v.data));selected=next.selected;sysexChannel=next.dump.channel;
    el('code').value=next.code;selectSong(next.midi,next.song);render();await applyVoice();
  }else if(/\.syx$/i.test(f.name)){
    const dump=parseSysex(bytes);stopSong();sysexChannel=dump.channel;
    if(dump.format==='bank'){voices.splice(0,32,...dump.voices.map(v=>v.data));selected=0;}
    else voices[selected]=dump.voices[0].data;
    render();await applyVoice();
  }else{
    const next=parseMidiFile(bytes);stopSong();selectSong(next,bytes);
  }
});
on('playMidi','click',async()=>{
  stopSong();const epoch=songEpoch;await ensureAudio();if(epoch!==songEpoch)return;
  const events=midi.events.filter(e=>e.part===el('part').value);let i=0;
  const start=audio.context.currentTime;
  const deferred=new Set();let sustained=false;
  function pedal(down){
    sustained=down;
    if(!down){for(const n of deferred)noteOff(n);deferred.clear();}
  }
  function bend(value){
    if(!audio.node)return;
    const raw=Math.round((value-8192)/8192*2*4096/12)&65535;
    writeRegister(0x30f2,raw>>8);writeRegister(0x30f3,raw&255);flush();
  }
  function tick(){
    if(epoch!==songEpoch)return;
    while(i<events.length&&events[i].seconds<=audio.context.currentTime-start){
      const e=events[i++];
      if(e.kind===9&&e.b){
        if(deferred.delete(e.a))noteOff(e.a);
        noteOn(e.a,e.b);
      }else if(e.kind===8||e.kind===9){
        if(sustained)deferred.add(e.a);else noteOff(e.a);
      }else if(e.kind===11&&e.a===64)pedal(e.b>=64);
      else if(e.kind===14)bend(e.a+128*e.b);
    }
    if(i<events.length)songTimer=setTimeout(tick,Math.max(0,(start+events[i].seconds-audio.context.currentTime)*1000));
    else {pedal(false);bend(8192);chip.allNotesOff();flush();audio?.dx?.allNotesOff();}
  }
  tick();
});
on('stopMidi','click',stopSong);
el('code').value=glassSteps;
on('run','click',()=>runtime.run(el('code').value));on('apply','click',()=>runtime.apply(el('code').value));on('stop','click',()=>runtime.stop());
on('write','click',async()=>{
  await ensureAudio();
  const read=(id,length)=>{const s=el(id).value;if(!new RegExp('^[0-9a-f]{1,'+length+'}$','i').test(s))throw Error('Invalid hex '+id);return parseInt(s,16);};
  writeRegister(read('addr',4),read('data',2));flush();
});
const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B','C'];
const mappings='awsedftgyhujk';
async function press(id,index){
  if(held.has(id))return;
  const note=Math.min(127,(1+Number(el('octave').value))*12+index);
  const entry={note,ch:isChip()?Number(el('channel').value):-1,started:false};held.set(id,entry);
  try{await ensureAudio();if(held.get(id)!==entry)return;noteOn(note,100,entry.ch);entry.started=true;}
  catch(error){held.delete(id);report(error);}
}
function release(id){const e=held.get(id);held.delete(id);if(e?.started && ![...held.values()].some(other=>other.started&&(e.ch<0?other.note===e.note:other.ch===e.ch)))noteOff(e.note,e.ch);}
names.forEach((name,i)=>{
  const b=document.createElement('button');b.textContent=name;b.title=mappings[i].toUpperCase();if(name.includes('♯'))b.className='black';
  b.onpointerdown=e=>{b.setPointerCapture(e.pointerId);press(e.pointerId,i);};
  b.onlostpointercapture=e=>release(e.pointerId);el('keys').append(b);
});
window.addEventListener('keydown',e=>{const i=mappings.indexOf(e.key);if(i<0||e.key.length!==1||e.repeat||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea'))return;press(e.code,i);});
window.addEventListener('keyup',e=>release(e.code));
window.addEventListener('blur',()=>{for(const id of [...held.keys()])release(id);});
const canvas=el('scope'),ctx=canvas.getContext('2d');
function draw(){monitor.draw(canvas,ctx,el('scopeMode').value.toLowerCase());el('trace').textContent=trace.join('\n');requestAnimationFrame(draw);}
render();draw();
