import {readScspAudio,prepareScspPCM} from '../js/scsp_sample.js?v=scsp-pcm-files-1';
import {createOfflineAudioDecoder} from '../js/audio_decode.js';
/** SCSP PCM drafts live in the UI; only explicit Apply allocates sample RAM. */
export function scspVoiceCode(slot,voice,pcm,sample) {
  const options={baseFrequencyHz:sample.rootFrequencyHz,sourceSampleRate:sample.sourceSampleRate,...(sample.loopStartSamples===null?{}:{loopStartSamples:sample.loopStartSamples})};
  const preset={frequencyHz:voice.frequencyHz,totalLevel:voice.totalLevel,directLevel:voice.directLevel,pan:voice.pan,envelope:voice.envelope};
  return `const saturn = await useSoundChip('scsp');\nconst wave = await saturn.loadPCM(new Int${sample.bits}Array(${JSON.stringify(Array.from(pcm))}), ${JSON.stringify(options)});\nsaturn.setPreset(${slot}, {...${JSON.stringify(preset)}, sample:wave});\nsaturn.keyOn(${slot});\n`;
}
export function createPlaygroundScspVoicePanel({root,invoke,onSelectedChannelChange=()=>{},onError=()=>{}}) {
  const doc=root.ownerDocument,make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  let state=null,selected=0,connected=false,visible=true,disposed=false,held=null,sequence=0,draft=null,draftKey='',loadSequence=0,dirty=false,busy=false,drawing=null,recording=null,fileSequence=0;
  const decodeAudio=createOfflineAudioDecoder({getSampleRate:()=>44100});
  const controls=[];
  const guard=fn=>async()=>{try{await fn();}catch(error){if(!disposed)onError(error);}};
  const action=(name,text,fn)=>{const b=make('button',text);b.type='button';b.dataset.chipAction=`scsp-${name}`;b.addEventListener('click',guard(async()=>{try{await fn();}finally{b.blur();}}));controls.push(b);return b;};
  const number=(name,text,min,max,step='1')=>{const label=make('label',text+' '),input=make('input');input.type='number';input.min=String(min);input.max=String(max);input.step=step;input.dataset.chipControl=`scsp-${name}`;label.append(input);controls.push(input);return {label,input};};
  const channels=make('div');channels.className='chip-channel-list';channels.setAttribute('aria-label','SCSP slot');root.append(channels);
  const buttons=Array.from({length:32},(_,slot)=>{
    const button=make('button',`Slot ${slot+1}`);button.type='button';button.dataset.scspSlot=String(slot);
    button.addEventListener('click',()=>{release();selected=slot;draftKey='';update(state);onSelectedChannelChange();button.blur();});channels.append(button);return button;
  });
  const memory=make('p'),summary=make('p'),noteLabel=make('label','MIDI note '),note=make('input');note.type='number';note.min='0';note.max='127';note.value='69';note.addEventListener('change',()=>note.blur());noteLabel.append(note);
  const hold=make('button','Hold to play');hold.type='button';hold.dataset.chipAction='scsp-hold';
  root.append(memory,summary,noteLabel,hold);
  const sampleLabel=make('label','Assigned PCM (next keyOn) '),sampleSelect=make('select');sampleSelect.dataset.chipControl='scsp-sample';sampleLabel.append(sampleSelect);controls.push(sampleSelect);root.append(sampleLabel);
  sampleSelect.addEventListener('change',guard(async()=>{const ch=selected,sample=state.samples.find(s=>s.id===Number(sampleSelect.value));if(!sample)return;await invoke('setPreset',[ch,{sample}]);sampleSelect.blur();}));
  const editor=make('fieldset'),legend=make('legend','PCM waveform');editor.append(legend);root.append(editor);
  const canvas=make('canvas');canvas.width=800;canvas.height=180;canvas.style.width='100%';canvas.style.maxWidth='800px';canvas.style.height='180px';canvas.style.touchAction='none';canvas.style.background='#182126';canvas.setAttribute('aria-label','SCSP PCM waveform; drag to draw, or select a waveform below');canvas.dataset.chipControl='scsp-waveform';editor.append(canvas);
  const shapes=make('div');for(const shape of ['Sine','Triangle','Saw','Square'])shapes.append(action(shape.toLowerCase(),shape,()=>{
    loadSequence++;const pcm=Int16Array.from({length:64},(_,i)=>Math.round(8192*(shape==='Sine'?Math.sin(i*Math.PI/32):shape==='Triangle'?1-4*Math.abs(i/64-.5):shape==='Saw'?i/32-1:i<32?1:-1)));
    draft={pcm,sample:{bits:16,rootFrequencyHz:44100/64,sourceSampleRate:44100,loopStartSamples:0}};syncDraft();markDirty();
  }));editor.append(shapes);
  const tuning=number('root','Root frequency (Hz)',.001,1000000,'any'),rate=number('rate','Source sample rate (Hz)',1,768000,'any'),loop=number('loop','Forward loop start (−1 = one shot)',-1,65534);
  const bitsLabel=make('label','PCM format '),bits=make('select');bits.dataset.chipControl='scsp-bits';for(const value of [8,16]){const opt=make('option',`Signed PCM${value}`);opt.value=String(value);bits.append(opt);}bitsLabel.append(bits);controls.push(bits);
  editor.append(tuning.label,rate.label,loop.label,bitsLabel);
  for(const input of [tuning.input,rate.input,loop.input,bits])input.addEventListener('change',()=>{markDirty();input.blur();});
  const status=make('p');status.setAttribute('role','status');
  const apply=action('apply','Apply PCM to this slot',async()=>{
    if(!draft||!dirty||busy)return;
    for(const input of [tuning.input,rate.input,loop.input])if(!input.value.trim()||!input.reportValidity())return;
    const loopStart=Number(loop.input.value);if(loopStart>=draft.pcm.length)throw new RangeError('Loop start must be before the end of PCM');
    const sourceBits=draft.sample.bits,targetBits=Number(bits.value),Type=targetBits===8?Int8Array:Int16Array;
    const pcm=Type.from(draft.pcm,v=>Math.max(targetBits===8?-128:-32768,Math.min(targetBits===8?127:32767,Math.round(v*2**(targetBits-sourceBits)))));
    const options={baseFrequencyHz:Number(tuning.input.value),sourceSampleRate:Number(rate.input.value),...(loopStart<0?{}:{loopStartSamples:loopStart})};
    const ch=selected,key=draftKey;busy=true;refreshEnabled();
    try{const sample=await invoke('applyPCM',[ch,pcm,options]);if(!disposed&&selected===ch&&draftKey===key){draft={pcm,sample};draftKey=`${ch}:${sample.bankId}:${sample.id}`;dirty=false;syncDraft();status.textContent='PCM applied. Play a new note to hear it.';}}
    finally{busy=false;refreshEnabled();}
  });
  editor.append(apply,status,make('p','Software editor: Apply reuses unshared editor RAM when safe. Held/releasing voices protect their data. Stop scheduled playback before Apply. Other slots and ordinary loadPCM samples are never overwritten. Retired editor sample IDs may expire. Selecting another slot or PCM discards the draft.'));
  const files=make('fieldset');files.append(make('legend','Audio file → PCM selection (software conversion)'));editor.append(files);
  const fileInput=make('input');fileInput.type='file';fileInput.accept='audio/*,.wav,.m4a,.mp3,.ogg,.flac,.aif,.aiff';fileInput.dataset.chipControl='scsp-audio-file';fileInput.setAttribute('aria-label','SCSP audio file');controls.push(fileInput);
  const fileStatus=make('p');fileStatus.setAttribute('role','status');fileStatus.dataset.chipOutput='scsp-file-status';
  const start=number('file-start','Start (seconds)',0,86400,'any'),end=number('file-end','End (seconds)',0,86400,'any'),fileRate=number('file-rate','Selection sample rate (Hz)',1,768000),rootNote=number('file-root','Recorded root MIDI note (manual)',0,127);
  start.input.value='0';fileRate.input.value='44100';rootNote.input.value='69';
  const useSelection=action('use-selection','Use selection in waveform',()=>{
    if(!recording)return;
    for(const input of [start.input,end.input,fileRate.input,rootNote.input])if(!input.value.trim()||!input.reportValidity())return;
    const next=prepareScspPCM(recording,{startSeconds:Number(start.input.value),endSeconds:Number(end.input.value),sourceSampleRate:Number(fileRate.input.value),rootNote:Number(rootNote.input.value),bits:Number(bits.value)});
    loadSequence++;draft=next;syncDraft();markDirty();status.textContent=`${draft.pcm.length.toLocaleString()} mono samples staged. Apply PCM, then play a new note. Root note is manual; no pitch detection.`;
  });
  files.append(fileInput,fileStatus,start.label,end.label,fileRate.label,rootNote.label,useSelection,make('p','WAV and browser-supported audio (up to 64 MiB). The recording stays outside SCSP RAM; select up to 65,535 samples. Stereo channels are averaged, with no automatic normalization. Lower the selection rate for a longer sound. Import and trim do not start playback.'));
  fileInput.addEventListener('change',guard(async()=>{
    const file=fileInput.files?.[0];fileInput.value='';fileInput.blur();if(!file)return;
    const request=++fileSequence;fileStatus.textContent=`Decoding ${file.name}…`;
    try{
      const audio=await readScspAudio(file,{decodeAudio});if(disposed||request!==fileSequence)return;
      recording=audio;const duration=audio.channels[0].length/audio.sampleRate;start.input.value='0';end.input.value=String(Math.min(duration,Math.floor(65535*audio.sampleRate/44100)/audio.sampleRate));fileRate.input.value='44100';
      fileStatus.textContent=`Loaded ${file.name} · ${duration.toFixed(3)} s · ${audio.channels.length} channel(s). Choose a region, then Use selection. The initial selection covers the first ${Number(end.input.value).toFixed(3)} s.`;
    }catch(error){if(!disposed&&request===fileSequence){fileStatus.textContent=`Load failed: ${error.message}. Previous audio and waveform are retained.`;throw error;}}
    finally{refreshEnabled();}
  }));
  for(const item of [start,end,fileRate,rootNote])item.input.addEventListener('change',()=>item.input.blur());
  const eg=make('fieldset');eg.append(make('legend','Envelope — next keyOn'));root.append(eg);
  const envelopeControls={};for(const [key,title,max]of [['attackRate','AR',31],['decay1Rate','D1R',31],['decay2Rate','D2R',31],['decayLevel','DL',31],['releaseRate','RR',31],['keyRateScaling','KRS',15]]){
    const item=number(key,title,0,max);envelopeControls[key]=item.input;eg.append(item.label);
    item.input.addEventListener('change',guard(async()=>{if(!item.input.value.trim()||!item.input.reportValidity())return;await invoke('setEnvelope',[selected,{[key]:Number(item.input.value)}]);item.input.blur();}));
  }
  eg.append(make('p','Hardware codes: larger AR / D1R / D2R / RR are faster. DL sets the decay level; KRS 15 disables key rate scaling. These are register values, not milliseconds.'));
  const mix=make('fieldset');mix.append(make('legend','Live mix'));root.append(mix);const mixControls={};
  for(const [key,title,max]of [['totalLevel','TL attenuation (0 = loudest)',255],['directLevel','Direct level (0 = mute)',7],['pan','Pan (0 = center, 15 = right, 31 = left)',31]]){
    const item=number(key,title,0,max);mixControls[key]=item.input;mix.append(item.label);item.input.addEventListener('change',guard(async()=>{if(!item.input.value.trim()||!item.input.reportValidity())return;await invoke('setMix',[selected,{[key]:Number(item.input.value)}]);item.input.blur();}));
  }
  const code=make('textarea');code.readOnly=true;code.rows=6;code.style.width='100%';code.setAttribute('aria-label','SCSP voice JavaScript');code.dataset.chipOutput='scsp-code';code.hidden=true;
  root.append(action('copy','Copy voice JavaScript',async()=>{
    const ch=selected;const loaded=await invoke('getPCM',[ch]);if(disposed||ch!==selected)return;
    code.value=scspVoiceCode(ch,loaded.voice,loaded.pcm,loaded.sample);code.hidden=false;
    try{await doc.defaultView.navigator.clipboard.writeText(code.value);status.textContent='Applied voice JavaScript copied.';}catch{code.focus();code.select();status.textContent='Select and copy the generated JavaScript below.';}
  }),code);
  function draw(){const ctx=canvas.getContext('2d');if(!ctx)return;ctx.clearRect(0,0,800,180);ctx.strokeStyle='#46616b';ctx.beginPath();ctx.moveTo(0,90);ctx.lineTo(800,90);ctx.stroke();if(!draft)return;ctx.strokeStyle='#63d5dc';ctx.beginPath();const full=draft.sample.bits===8?128:32768;for(let i=0;i<draft.pcm.length;i++){const x=i*800/(draft.pcm.length-1),y=90-draft.pcm[i]/full*85;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();}
  function syncDraft(){if(!draft)return;tuning.input.value=String(draft.sample.rootFrequencyHz);rate.input.value=String(draft.sample.sourceSampleRate);loop.input.value=String(draft.sample.loopStartSamples??-1);bits.value=String(draft.sample.bits);draw();}
  function markDirty(){dirty=true;status.textContent='Unapplied PCM draft';refreshEnabled();draw();}
  function point(event){const r=canvas.getBoundingClientRect(),i=Math.max(0,Math.min(draft.pcm.length-1,Math.round((event.clientX-r.left)/r.width*(draft.pcm.length-1)))),full=draft.sample.bits===8?128:32768,v=Math.round(Math.max(-1,Math.min(1,1-2*(event.clientY-r.top)/r.height))*(full-1));return {i,v};}
  function paint(event){if(!draft||!drawing||event.pointerId!==drawing.id)return;event.preventDefault();const next=point(event),last=drawing.point;for(let i=Math.min(last.i,next.i);i<=Math.max(last.i,next.i);i++)draft.pcm[i]=last.i===next.i?next.v:Math.round(last.v+(next.v-last.v)*(i-last.i)/(next.i-last.i));drawing.point=next;markDirty();}
  canvas.addEventListener('pointerdown',event=>{if(!draft||busy||!connected||event.button!==0)return;drawing={id:event.pointerId,point:point(event)};canvas.setPointerCapture(event.pointerId);paint(event);});canvas.addEventListener('pointermove',paint);
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{drawing=null;});
  function refreshEnabled(){controls.forEach(c=>{c.disabled=!connected||busy;});apply.disabled=!connected||busy||!dirty||!draft;useSelection.disabled=!connected||busy||!recording;hold.disabled=!connected||!state?.channels?.[selected]?.sample;}
  function release(){drawing=null;const entry=held;held=null;if(entry)void invoke('auditionOff',[entry.slot,entry.id]).catch(error=>{if(!disposed)onError(error);});}
  function press(event){
    if(!connected||!visible||disposed||held)return;event.preventDefault();
    const midi=Number(note.value);if(!note.value.trim()||!Number.isInteger(midi)||midi<0||midi>127){note.reportValidity();return;}
    const entry={slot:selected,id:`scsp-panel-${Date.now()}-${++sequence}`};held=entry;if(event.pointerId!==undefined)hold.setPointerCapture?.(event.pointerId);
    void invoke('auditionOn',[entry.slot,midi,entry.id]).catch(error=>{if(held===entry)held=null;if(!disposed)onError(error);});
  }
  hold.addEventListener('pointerdown',press);hold.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)&&!event.repeat)press(event);});hold.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();release();}});
  const visibility=()=>{if(doc.hidden)release();};doc.defaultView?.addEventListener('blur',release);doc.addEventListener('visibilitychange',visibility);
  for(const event of ['pointerup','pointercancel','lostpointercapture'])hold.addEventListener(event,release);
  function update(next){state=next;const v=state?.channels?.[selected];buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===selected)));
    memory.textContent=state?`Sample RAM: ${state.ramUsedBytes.toLocaleString()} / 524,288 bytes · ${state.samples.length} PCM samples`:'';
    summary.textContent=v?`Slot ${selected+1} · ${v.frequencyHz.toFixed(2)} Hz · requested gate ${v.gate?'On':'Off'} (not an EG activity meter)`:'Prepare audio to inspect SCSP slots.';
    const sampleList=state?.samples??[],signature=sampleList.map(s=>`${s.bankId}:${s.id}`).join('|');if(sampleSelect.dataset.signature!==signature){sampleSelect.dataset.signature=signature;sampleSelect.replaceChildren(...sampleList.map(s=>{const opt=make('option',`PCM ${s.id} · ${s.bits}-bit · ${s.length} samples`);opt.value=String(s.id);return opt;}));}sampleSelect.value=String(v?.sample?.id??'');
    for(const [key,input]of Object.entries(envelopeControls))if(doc.activeElement!==input)input.value=String(v?.envelope[key]??'');for(const [key,input]of Object.entries(mixControls))if(doc.activeElement!==input)input.value=String(v?.[key]??'');
    const key=`${selected}:${v?.sample?.bankId}:${v?.sample?.id}`;if(key!==draftKey){draftKey=key;draft=null;dirty=false;drawing=null;code.hidden=true;status.textContent='';const request=++loadSequence;draw();if(v?.sample)void invoke('getPCM',[selected]).then(loaded=>{if(disposed||request!==loadSequence||draftKey!==key)return;draft=loaded;syncDraft();refreshEnabled();}).catch(error=>{if(!disposed&&request===loadSequence)onError(error);});}
    refreshEnabled();
  }
  update(null);
  return {update,releaseAll:release,getSelectedChannel:()=>selected,setConnected(value){connected=value;if(!value)release();update(state);},setVisible(value){visible=value;if(!value)release();},dispose(){if(disposed)return;release();disposed=true;loadSequence++;fileSequence++;recording=null;doc.defaultView?.removeEventListener('blur',release);doc.removeEventListener('visibilitychange',visibility);root.replaceChildren();}};
}
