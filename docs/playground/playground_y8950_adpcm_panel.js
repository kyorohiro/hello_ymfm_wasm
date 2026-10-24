/** Applied Y8950 ADPCM state. Only explicit edits and gestures send commands. */
const LIMIT=0x200000;
let sequence=0;
export function createPlaygroundY8950AdpcmPanel({root,invoke,loadSample,openSampleEditor,
  onSelect=()=>{},onKeyboardTargetChange=()=>{},onError=()=>{}}){
  const doc=root.ownerDocument??globalThis.document,win=doc.defaultView??globalThis,listeners=[],held=new Map(),panelId=++sequence;
  let state=null,connected=false,visible=true,disposed=false,keyboardActive=false,connectionEpoch=0,bindingEpoch=0,pressSequence=0,target,holdPress=null,timer=null;
  let loading=false,loadSequence=0,loadController=null,waveSignature='';
  const make=(tag,className,text)=>{const n=doc.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
  const listen=(n,type,handler)=>{n.addEventListener(type,handler);listeners.push(()=>n.removeEventListener(type,handler));};
  const body=make('fieldset','chip-section');body.disabled=true;body.dataset.y8950Adpcm='';body.appendChild(make('h3','','ADPCM · one mono sample voice'));root.appendChild(body);
  const field=(parent,label,node)=>{const n=make('label','chip-field');n.appendChild(make('span','chip-field-label',label));n.appendChild(node);parent.appendChild(n);return node;};
  const row=()=>{const n=make('div','chip-fields');body.appendChild(n);return n;};
  function report(error){if(disposed)return;status.textContent=error?.message??String(error);status.dataset.error='true';onError(error);}
  async function command(method,args=[]){if(!connected||disposed)return;const epoch=connectionEpoch;try{const result=await invoke(method,args);if(connected&&!disposed&&epoch===connectionEpoch){status.textContent='';delete status.dataset.error;}return result;}catch(error){if(connected&&!disposed&&epoch===connectionEpoch)report(error);}}
  function number(parent,label,name,min,max,step,change){const n=field(parent,label,make('input'));n.type='number';n.min=String(min);if(max!==undefined)n.max=String(max);n.step=String(step);n.dataset.chipControl=`y8950-adpcm-${name}`;listen(n,'change',()=>{const v=Number(n.value);if(!n.value.trim()||!Number.isFinite(v)||v<min||max!==undefined&&v>max||step!== 'any'&&(!Number.isInteger(v)||v%step)){n.setCustomValidity('Use a value within the displayed range and alignment.');n.reportValidity?.();return;}n.setCustomValidity('');onSelect();change(v);});return n;}
  function button(parent,text,name,callback){const n=make('button','',text);n.type='button';n.dataset.chipAction=`y8950-adpcm-${name}`;if(callback)listen(n,'click',callback);parent.appendChild(n);return n;}
  const info=row(),memory=field(info,'Loaded RAM',make('output')),gate=field(info,'Applied playback',make('output'));
  memory.dataset.chipOutput='y8950-adpcm-memory';gate.dataset.chipOutput='y8950-adpcm-gate';
  const material=row();
  const edit=button(material,'Open Sample Editor…','sample-editor',async()=>{
    if(!connected||!visible||disposed||loading||!openSampleEditor||!loadSample)return;
    const address=Number(start.value);if(!Number.isInteger(address)||address<0||address>=LIMIT||address%32){start.setCustomValidity('Use a sample start aligned to 32 bytes.');start.reportValidity?.();return;}
    onSelect();releaseAll();const epoch=connectionEpoch,token=++loadSequence,controller=loadController=new AbortController();loading=true;syncEnabled();status.textContent='Edit audio, then choose Use audio to load it into Y8950.';delete status.dataset.error;
    const current=()=>!disposed&&connected&&visible&&epoch===connectionEpoch&&token===loadSequence&&!controller.signal.aborted;
    try{const pcm=await openSampleEditor({title:'Y8950 ADPCM sample',target:'adpcm-b'},{signal:controller.signal});if(!pcm||!current())return;
      await loadSample(pcm,{address,...(typeof pcm.name==='string'?{name:pcm.name}:{}),signal:controller.signal});controller.signal.throwIfAborted();if(current()){status.textContent=adpcm().volume>0?'ADPCM sample loaded. Hold to play or Use Keyboard.':'ADPCM sample loaded. Increase Volume above 0, then Hold to play or Use Keyboard.';delete status.dataset.error;}
    }catch(error){if(current()&&error?.name!=='AbortError')report(error);}finally{if(token===loadSequence){loading=false;loadController=null;syncEnabled();}}
  });
  body.appendChild(make('p','subtext','Sample Editor provides file input, microphone recording, trimming and gain. Loading audio replaces RAM at Sample start and stops the ADPCM decoder; FM keeps playing.'));
  const wave=make('canvas','chip-sample-waveform chip-oki-waveform');wave.width=800;wave.height=150;wave.dataset.chipControl='y8950-adpcm-waveform';wave.setAttribute('role','img');wave.setAttribute('aria-label','Decoded Y8950 ADPCM waveform for the configured sample range');body.appendChild(wave);
  const ranges=row(),start=number(ranges,'Sample start (bytes, 32 aligned)','start',0,LIMIT-32,32,()=>sendRange()),end=number(ranges,'Sample end (exclusive, 32 aligned)','end',32,LIMIT,32,()=>sendRange());
  const settings=row(),delta=number(settings,'Delta-N','delta',1,65535,1,n=>command('adpcm.setDeltaN',[n])),rate=number(settings,'Playback rate (Hz)','rate',0.001,undefined,'any',n=>command('adpcm.setPlaybackRate',[n])),volume=number(settings,'Volume (0–255)','volume',0,255,1,n=>command('adpcm.setVolume',[n]));
  const repeat=field(settings,'Repeat configured range',make('input'));repeat.type='checkbox';repeat.dataset.chipControl='y8950-adpcm-repeat';listen(repeat,'change',()=>{onSelect();void command('adpcm.setRepeat',[repeat.checked]);});
  const actions=make('div','chip-actions');body.appendChild(actions);
  const hold=button(actions,'Hold to play','hold'),preview=button(actions,'Play 1 second','play',()=>{if(!visible)return;onSelect();releaseSource('preview');const id=startNote('preview');if(id)timer=win.setTimeout(()=>{timer=null;endNote(id);},1000);});
  button(actions,'Release','release',()=>releaseAll());
  const keyboard=button(actions,'Use Keyboard','keyboard',()=>{if(!ready())return;onSelect();keyboardActive=true;updateTarget();status.textContent='Y8950 ADPCM is connected to the Guitar Keyboard. Every key triggers this sample at its configured rate.';delete status.dataset.error;});
  body.appendChild(make('p','subtext','One voice: each press retriggers the configured range. Keyboard keys act as sample pads at the same playback rate; notes do not transpose the sample. Delta-N changes pitch and duration together. Changing Repeat during playback retriggers the decoder. Y8950 ADPCM is mono.'));
  const status=make('p','chip-editor-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.appendChild(status);
  const adpcm=()=>state?.adpcm??{};
  function ready(){const a=adpcm(),size=a.memorySize??state?.adpcmMemorySize??0;return connected&&!disposed&&!loading&&size>0&&(a.validRange??(Number.isInteger(a.start)&&Number.isInteger(a.end)&&a.start>=0&&a.end>a.start&&a.end<=size))&&a.deltaN>0;}
  function syncEnabled(){body.disabled=!connected||loading;hold.disabled=preview.disabled=keyboard.disabled=!ready();edit.disabled=!openSampleEditor||!loadSample||loading;}
  function sendRange(){const a=Number(start.value),b=Number(end.value),valid=Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>a&&b<=LIMIT&&a%32===0&&b%32===0;for(const n of [start,end])n.setCustomValidity(valid?'':'Use a nonempty range aligned to 32 bytes.');if(!valid){start.reportValidity?.();return;}void command('adpcm.setSample',[{start:a,end:b}]);}
  function startNote(source,externalId,epoch){if(!ready()||!visible&&source!=='keyboard')return null;const id=`y8950-adpcm-panel:${panelId}:${++pressSequence}`;held.set(id,{source,externalId,epoch});void command('auditionOn',['adpcm',60,id]);return id;}
  function endNote(id){if(!held.has(id))return;held.delete(id);void command('auditionOff',['adpcm',id]);}
  function releaseSource(source){for(const [id,entry]of held)if(entry.source===source)endNote(id);if(source==='preview'&&timer!==null){win.clearTimeout(timer);timer=null;}if(source==='hold'){holdPress=null;hold.setAttribute('aria-pressed','false');}}
  function cancelLoad(){if(!loadController)return;loadController.abort(new DOMException('ADPCM editor target changed','AbortError'));loadController=null;loadSequence++;loading=false;syncEnabled();}
  function releasePlayback(){for(const id of [...held.keys()])endNote(id);if(timer!==null){win.clearTimeout(timer);timer=null;}holdPress=null;hold.setAttribute('aria-pressed','false');}
  function releaseAll(){cancelLoad();releasePlayback();}
  function updateTarget(){const epoch=++bindingEpoch;target={owner:'y8950-adpcm-panel',name:'Y8950 · ADPCM sample trigger',
    noteOn(event){if(!keyboardActive||!connected||epoch!==bindingEpoch||typeof event?.id!=='string')return;for(const [id,entry]of held)if(entry.source==='keyboard'&&entry.externalId===event.id&&entry.epoch===epoch)endNote(id);startNote('keyboard',event.id,epoch);},
    noteOff(event){for(const [id,entry]of held)if(entry.source==='keyboard'&&entry.externalId===event?.id&&entry.epoch===epoch)endNote(id);},
    allNotesOff(){for(const [id,entry]of held)if(entry.source==='keyboard'&&entry.epoch===epoch)endNote(id);}};keyboard.setAttribute('aria-pressed',String(keyboardActive));if(keyboardActive)onKeyboardTargetChange(target);}
  function holdStart(event){if(!visible||!connected||event.type==='pointerdown'&&event.button!==undefined&&event.button!==0||event.type==='keydown'&&(event.repeat||![' ','Enter'].includes(event.key)))return;event.preventDefault();onSelect();releaseSource('hold');const id=startNote('hold');if(!id)return;holdPress={id,pointerId:event.pointerId,key:event.key};hold.setAttribute('aria-pressed','true');if(event.pointerId!==undefined)try{hold.setPointerCapture(event.pointerId);}catch{}}
  function holdEnd(event){if(!holdPress||event.pointerId!==undefined&&event.pointerId!==holdPress.pointerId||event.type==='keyup'&&event.key!==holdPress.key)return;releaseSource('hold');}
  listen(hold,'pointerdown',holdStart);listen(hold,'keydown',holdStart);for(const name of ['pointerup','pointercancel','lostpointercapture','keyup'])listen(hold,name,holdEnd);
  listen(hold,'blur',()=>releaseSource('hold'));listen(win,'blur',releasePlayback);listen(doc,'visibilitychange',()=>{if(doc.hidden)releaseAll();});
  function draw(){if(!visible||!state)return;const a=adpcm(),points=a.waveform??a.sample?.waveform,signature=JSON.stringify([points,a.start,a.end,a.memorySize,state.adpcmMemorySize]);if(signature===waveSignature)return;waveSignature=signature;const ctx=wave.getContext?.('2d');if(!ctx)return;const w=wave.width,h=wave.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#101820';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#34444e';ctx.beginPath();ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();if(!points?.length){ctx.fillStyle='#b5c2cc';ctx.font='13px sans-serif';ctx.fillText('Waveform unavailable for this RAM range. Load audio to preview it.',12,25);return;}ctx.strokeStyle='#7bbcf7';ctx.lineWidth=2;ctx.beginPath();points.forEach((point,i)=>{const v=Number.isFinite(point)?Math.max(-1,Math.min(1,point)):0,x=i/Math.max(1,points.length-1)*w,y=h/2-v*(h/2-12);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
  const value=(node,next)=>{if(doc.activeElement!==node)node.value=next==null||typeof next==='number'&&!Number.isFinite(next)?'':String(next);};
  function update(snapshot){if(disposed||!snapshot)return;state=snapshot;const a=adpcm(),size=a.memorySize??snapshot.adpcmMemorySize??0;value(start,a.start??0);value(end,a.end??32);value(delta,a.deltaN??0);value(rate,a.playbackRate??(a.deltaN??0)*(snapshot.clock??3579545)/(72*65536));value(volume,a.volume??0);if(doc.activeElement!==repeat)repeat.checked=!!a.repeat;memory.textContent=`${a.sampleName?`${a.sampleName} · `:''}${Number(size).toLocaleString('en-US')} / 2,097,152 bytes`;gate.textContent=`${a.playing?'Gate on':'Gate off'}${snapshot.held?.includes('adpcm')?' · Keyboard held':''}`;syncEnabled();draw();}
  function setConnected(next){if(disposed)return;next=!!next;if(!next){releaseAll();if(keyboardActive){keyboardActive=false;onKeyboardTargetChange(null);}bindingEpoch++;keyboard.setAttribute('aria-pressed','false');}if(next!==connected)connectionEpoch++;connected=next;syncEnabled();}
  updateTarget();
  return{update,setConnected,releaseAll,releasePlayback,getNoteTarget:()=>target,
    setVisible(next){visible=!!next;if(!visible){cancelLoad();releaseSource('hold');releaseSource('preview');}else{waveSignature='';draw();}},
    setKeyboardActive(next){if(!next&&keyboardActive){keyboardActive=false;bindingEpoch++;releaseSource('keyboard');keyboard.setAttribute('aria-pressed','false');}},
    dispose(){if(disposed)return;setConnected(false);disposed=true;for(const remove of listeners)remove();}};
}
