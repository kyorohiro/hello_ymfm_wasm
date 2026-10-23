/** Applied S-DSP voices. The owning tab supplies snapshots; this panel never polls. */
let panelSequence = 0;
export function createPlaygroundSnesVoicePanel({root,invoke,onKeyboardTargetChange=()=>{},onError=()=>{}}) {
  const doc=root.ownerDocument??globalThis.document,win=doc.defaultView??globalThis,panel=++panelSequence;
  let state=null,selected=0,connected=false,visible=true,disposed=false,epoch=0,sequence=0,targetEpoch=0,keyboardActive=false,target,timer=null;
  const held=new Map(),listeners=[];
  const make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const listen=(n,type,fn)=>{n.addEventListener(type,fn);listeners.push(()=>n.removeEventListener(type,fn));};
  function button(parent,text,name,fn){const n=make('button','',text);n.type='button';n.dataset.chipAction=name;if(fn)listen(n,'click',fn);parent.appendChild(n);return n;}
  function field(parent,label){const n=make('label','chip-field');n.appendChild(make('span','chip-field-label',label));parent.appendChild(n);return n;}
  function set(n,value){if(doc.activeElement!==n)n.value=value===null||value===undefined?'':String(value);}
  function report(error){status.textContent=error?.message??String(error);status.dataset.error='true';onError(error);}
  async function command(method,args=[]){if(!connected||disposed)return;const token=epoch;try{const value=await invoke(method,args);if(!disposed&&token===epoch){status.textContent='';delete status.dataset.error;}return value;}catch(error){if(!disposed&&token===epoch)report(error);}}
  const patch=value=>command('setPreset',[selected,value]);
  function number(parent,label,name,min,max,change){const n=make('input');n.type='number';n.min=String(min);n.max=String(max);n.step='1';n.dataset.chipControl=name;field(parent,label).appendChild(n);
    listen(n,'change',()=>{const v=Number(n.value);if(!n.value.trim()||!Number.isInteger(v)||v<min||v>max){n.setCustomValidity('Enter an integer within the displayed range.');n.reportValidity?.();return;}n.setCustomValidity('');change?.(v);});return n;}
  const channels=make('div','chip-channel-list');channels.setAttribute('aria-label','SNES voice');root.appendChild(channels);
  const buttons=Array.from({length:8},(_,ch)=>{const n=button(channels,`Voice ${ch+1}`,`snes-channel-${ch}`,()=>{if(selected===ch)return;releaseAll();selected=ch;updateTarget();update(state);});n.dataset.chipChannel=String(ch);return n;});
  const timeline=make('p','subtext');timeline.dataset.chipOutput='snes-timeline';root.appendChild(timeline);
  const instrument=make('fieldset','chip-editor-body');instrument.disabled=true;root.appendChild(instrument);
  const card=make('section','chip-section');card.appendChild(make('h3','','Selected BRR voice'));instrument.appendChild(card);
  const fields=make('div','chip-fields');card.appendChild(fields);
  const gate=make('output');gate.dataset.chipOutput='snes-gate';field(fields,'Gate (last KON / KOFF)').appendChild(gate);
  const sample=make('select');sample.dataset.chipControl='snes-sample';field(fields,'Uploaded sample').appendChild(sample);let sampleSignature='';
  listen(sample,'change',()=>{if(sample.value!=='')void patch({sample:Number(sample.value)});});
  const pitch=number(fields,'PITCH (4096 = source rate)','snes-pitch',0,16383,v=>patch({pitch:v}));
  const volumeLeft=number(fields,'Left volume','snes-volume-left',-128,127,v=>patch({volumeLeft:v}));
  const volumeRight=number(fields,'Right volume','snes-volume-right',-128,127,v=>patch({volumeRight:v}));
  const adsr1=number(fields,'ADSR1 (bit 7 enables ADSR)','snes-adsr1',0,255,v=>patch({adsr1:v}));
  const adsr2=number(fields,'ADSR2','snes-adsr2',0,255,v=>patch({adsr2:v}));
  const gain=number(fields,'GAIN (when ADSR is disabled)','snes-gain',0,255,v=>patch({gain:v}));
  const metadata=make('p','subtext');metadata.dataset.chipOutput='snes-sample';card.appendChild(metadata);
  const audition=make('div','chip-fields');card.appendChild(audition);
  const midi=number(audition,'Audition MIDI note','snes-audition-midi',0,127);midi.value='60';
  const actions=make('div','chip-actions');audition.appendChild(actions);
  const hold=button(actions,'Hold to play','snes-hold');
  button(actions,'Play 1 second','snes-play',()=>{releaseSource('preview');const id=start(selected,Number(midi.value),'preview');if(id)timer=win.setTimeout(()=>{timer=null;end(id);},1000);});
  button(actions,'Release','snes-release',releaseAll);
  const keyboard=button(actions,'Use Keyboard','snes-keyboard',()=>{if(!connected||state?.timeline?.loaded)return;keyboardActive=true;updateTarget();});
  const code=make('pre','chip-memory-ranges');code.dataset.chipOutput='snes-code';card.appendChild(code);
  const status=make('p','chip-editor-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.appendChild(status);
  root.appendChild(make('p','subtext','Upload BRR with loadBRR() and explicit tuning before auditioning. Values show applied DSP settings; the gate is not a measured audio level. Timeline playback uses captured RAM and has no editable keyboard instrument.'));
  function start(channel,note,source,externalId,token){if(!connected||disposed||state?.timeline?.loaded||!Number.isInteger(note)||note<0||note>127)return null;const id=`snes-panel:${panel}:${++sequence}`;held.set(id,{channel,source,externalId,token});void command('auditionOn',[channel,note,id]);return id;}
  function end(id){const voice=held.get(id);if(!voice)return;held.delete(id);void command('auditionOff',[voice.channel,id]);}
  function releaseSource(source){for(const[id,voice]of held)if(voice.source===source)end(id);if(source==='preview'&&timer!==null){win.clearTimeout(timer);timer=null;}if(source==='hold')hold.setAttribute('aria-pressed','false');}
  function releaseAll(){for(const id of [...held.keys()])end(id);if(timer!==null){win.clearTimeout(timer);timer=null;}hold.setAttribute('aria-pressed','false');}
  function updateTarget(){const channel=selected,token=++targetEpoch;target={owner:'snes-voice-panel',name:`SNES · Voice ${channel+1}`,
    noteOn(event){if(!keyboardActive||token!==targetEpoch||typeof event?.id!=='string')return;for(const[id,v]of held)if(v.externalId===event.id&&v.token===token)end(id);start(channel,event.midi,'keyboard',event.id,token);},
    noteOff(event){for(const[id,v]of held)if(v.source==='keyboard'&&v.externalId===event?.id&&v.token===token)end(id);},
    allNotesOff(){for(const[id,v]of held)if(v.source==='keyboard'&&v.token===token)end(id);}};
    keyboard.setAttribute('aria-pressed',String(keyboardActive));if(keyboardActive)onKeyboardTargetChange(target);}
  listen(hold,'pointerdown',event=>{if(!visible||!connected||event.button!==undefined&&event.button!==0)return;event.preventDefault();releaseSource('hold');if(start(selected,Number(midi.value),'hold'))hold.setAttribute('aria-pressed','true');if(event.pointerId!==undefined)try{hold.setPointerCapture(event.pointerId);}catch{}});
  listen(hold,'keydown',event=>{if(!visible||!connected||event.repeat||![' ','Enter'].includes(event.key))return;event.preventDefault();releaseSource('hold');if(start(selected,Number(midi.value),'hold'))hold.setAttribute('aria-pressed','true');});
  for(const type of ['pointerup','pointercancel','lostpointercapture','blur'])listen(hold,type,()=>releaseSource('hold'));
  listen(hold,'keyup',event=>{if([' ','Enter'].includes(event.key))releaseSource('hold');});
  listen(win,'blur',releaseAll);listen(doc,'visibilitychange',()=>{if(doc.hidden)releaseAll();});
  function update(next){if(disposed||!next)return;state=next;const v=state.channels?.[selected]??{},samples=state.samples??[],loaded=!!state.timeline?.loaded;
    if(loaded)releaseAll();instrument.disabled=!connected||loaded;buttons.forEach((n,ch)=>{n.disabled=!connected;n.setAttribute('aria-pressed',String(ch===selected));});
    timeline.textContent=loaded?`Timeline · ${state.timeline.playing?'Playing':state.timeline.ended?'Ended':'Paused'} · ${state.timeline.positionFrames??0} / ${state.timeline.totalFrames??0} native frames. Call reset() to return to instruments.`:'S-DSP · 32,000 Hz · 8 physical voices';
    const options=[['','Unassigned'],...samples.map(s=>[String(s.id),`Sample ${s.id} · ${s.frames} samples`])],signature=JSON.stringify(options);
    if(signature!==sampleSignature){sampleSignature=signature;sample.replaceChildren(...options.map(([value,text])=>{const n=make('option','',text);n.value=value;return n;}));}
    set(sample,v.sample);set(pitch,v.pitch);set(volumeLeft,v.volumeLeft);set(volumeRight,v.volumeRight);set(adsr1,v.adsr1);set(adsr2,v.adsr2);set(gain,v.gain);gate.textContent=v.active?'On':'Off';
    const s=samples.find(s=>s.id===v.sample);metadata.textContent=s?`${s.byteLength} BRR bytes · RAM ${s.startAddress} · Root ${Number(s.rootFrequencyHz).toFixed(3)} Hz · Base PITCH ${s.basePitch} · ${s.loop?'Loop':'One shot'}`:'No BRR sample is assigned to this voice.';
    code.textContent=`snes.setPreset(${selected}, ${JSON.stringify({sample:v.sample,adsr1:v.adsr1,adsr2:v.adsr2,gain:v.gain,volumeLeft:v.volumeLeft,volumeRight:v.volumeRight,pitch:v.pitch})});`;
  }
  function setConnected(value){if(disposed)return;const next=!!value;if(!next){releaseAll();if(keyboardActive)onKeyboardTargetChange(null);keyboardActive=false;targetEpoch++;}if(next!==connected)epoch++;connected=next;instrument.disabled=!next||!!state?.timeline?.loaded;for(const b of buttons)b.disabled=!next;}
  updateTarget();return {update,setConnected,releaseAll,getSelectedChannel:()=>selected,getNoteTarget:()=>target,
    setVisible(value){visible=!!value;if(!visible){releaseSource('hold');releaseSource('preview');}},
    setKeyboardActive(value){if(!value&&keyboardActive){releaseSource('keyboard');keyboardActive=false;targetEpoch++;keyboard.setAttribute('aria-pressed','false');}},
    dispose(){if(disposed)return;setConnected(false);disposed=true;for(const remove of listeners)remove();}};
}
