const NOTE_NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const noteName=hz=>{if(!Number.isFinite(hz)||hz<=0)return '';const midi=Math.round(69+12*Math.log2(hz/440));return `${NOTE_NAMES[(midi%12+12)%12]}${Math.floor(midi/12)-1}`;};
const identifier=name=>typeof name==='string'&&/^[A-Za-z_$][\w$]*$/.test(name)?name:'pokey';
const audctl=state=>state?.audctl??state?.registers?.[8]??0;
let sequence=0;

/** Copy the selected physical voice and its shared timer configuration. A
 * joined lower channel configures the upper channel that owns its tone. */
export function pokeyVoiceCode(state,channel=0,apiName=state?.apiName===undefined?'pokey':state.apiName,instanceId=state?.instanceId){
  const selected=state?.channels?.[channel];if(!selected)return '';
  const api=apiName===null?'chip':identifier(apiName),control=audctl(state),owner=selected.helper?channel+1:channel,voice=state.channels[owner]??selected;
  const selectedId=JSON.stringify(String(instanceId??'selected')).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const lines=apiName===null?[`// Bind chip to the selected POKEY instance ${selectedId}.`]:[];
  if(selected.helper)lines.push(`// CH${channel+1} is a timer helper; CH${owner+1} owns this joined tone.`);
  lines.push(`${api}.keyOff(${owner}); // Configure this physical voice silently.`,
    `${api}.setBaseClock('${control&1?'15khz':'64khz'}'); // Shared AUDCTL settings.`,
    `${api}.setPoly9(${Boolean(control&128)});`,
    `${api}.setJoined(0, ${Boolean(control&16)});`,`${api}.setJoined(1, ${Boolean(control&8)});`,
    `${api}.setHighClock(0, ${Boolean(control&64)});`,`${api}.setHighClock(2, ${Boolean(control&32)});`);
  lines.push(`${api}.writeRegister(8, ${control}); // Chip-wide AUDCTL, including high-pass routing; affects other voices.`);
  const skctl=state.skctl??state.registers?.[15];if(Number.isInteger(skctl))lines.push(`${api}.writeRegister(15, ${skctl}); // Chip-wide SKCTL controls timers and serial/two-tone modes.`);
  lines.push(`${api}.setVolume(${owner}, ${voice.configuredVolume??voice.volume??0});`,`${api}.setDistortion(${owner}, ${voice.distortion??0});`,`${api}.setVolumeOnly(${owner}, ${Boolean(voice.volumeOnly)});`);
  if(Number.isFinite(voice.frequency)&&voice.frequency>0)lines.push(`${api}.setFrequency(${owner}, ${voice.frequency});`);
  lines.push(`// ${api}.noteOn(${owner}, 'A4');`,`// ${api}.keyOff(${owner});`);return lines.join('\n');
}

export function createPlaygroundPokeyVoicePanel({root,invoke,onKeyboardTargetChange=()=>{},onError=()=>{},apiName='pokey',instanceId}={}){
  const doc=root.ownerDocument??globalThis.document,win=doc.defaultView??globalThis,panelId=++sequence,listeners=[],held=new Map();
  let state=null,channel=0,connected=false,visible=true,disposed=false,keyboardActive=false,connectionEpoch=0,bindingEpoch=0,pressSequence=0,commandSequence=0,target,holdPress=null,timer=null;
  const make=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,handler)=>{node.addEventListener(type,handler);listeners.push(()=>node.removeEventListener(type,handler));};
  const fields=parent=>{const node=make('div','chip-fields');parent.appendChild(node);return node;};
  const field=(parent,label)=>{const node=make('label','chip-field');node.appendChild(make('span','chip-field-label',label));parent.appendChild(node);return node;};
  const value=(node,next)=>{if(doc.activeElement!==node)node.value=next==null||typeof next==='number'&&!Number.isFinite(next)?'':String(next);};
  const checked=(node,next)=>{if(doc.activeElement!==node)node.checked=Boolean(next);};
  const voice=()=>state?.channels?.[channel]??{};
  const busy=()=>Boolean(state?.timeline?.playing||state?.timeline?.preparing||(state?.pendingTimelines??state?.timeline?.pendingTimelines??0)>0);
  const auditionAvailable=()=>!disposed&&!busy()&&!voice().helper;
  const canAudition=()=>connected&&auditionAvailable();
  const hardwareName=()=>identifier(state?.apiName??apiName)==='pokey2'?'POKEY2':'POKEY';
  function button(parent,label,action,name){const node=make('button','',label);node.type='button';if(name)node.dataset.chipAction=`pokey-${name}`;if(action)listen(node,'click',action);parent.appendChild(node);return node;}
  async function command(method,args=[]){
    if(!connected||disposed||busy()&&method!=='auditionOff')return;const epoch=connectionEpoch,binding=bindingEpoch,request=++commandSequence;
    const current=()=>!disposed&&connected&&epoch===connectionEpoch&&binding===bindingEpoch&&request===commandSequence;
    try{const result=await invoke(method,args);if(current()){status.textContent='';delete status.dataset.error;}return result;}
    catch(error){if(current()){status.textContent=error.message??String(error);status.dataset.error='true';onError(error);}}
  }
  function number(parent,label,name,max,change,{min=0,step=1,readOnly=false}={}){
    const node=make('input');Object.assign(node,{type:'number',min:String(min),step:String(step),readOnly});if(max!==undefined)node.max=String(max);node.dataset.chipControl=`pokey-${name}`;field(parent,label).appendChild(node);
    if(!readOnly)listen(node,'change',()=>{const n=Number(node.value);if(!node.value.trim()||!Number.isFinite(n)||n<min||max!==undefined&&n>max||step===1&&!Number.isInteger(n)){node.setCustomValidity('Enter a value within the displayed range.');node.reportValidity?.();return;}node.setCustomValidity('');change?.(n);});return node;
  }
  function checkbox(parent,label,name,change){const node=make('input');node.type='checkbox';node.dataset.chipControl=`pokey-${name}`;field(parent,label).appendChild(node);listen(node,'change',()=>change(node.checked));return node;}
  function section(title){const node=make('section','chip-section');node.appendChild(make('h3','',title));body.appendChild(node);return node;}
  const body=make('fieldset','chip-editor-body');body.disabled=true;root.appendChild(body);
  const timelineStatus=make('p','subtext');timelineStatus.dataset.chipOutput='pokey-timeline';root.appendChild(timelineStatus);
  const channels=make('div','chip-channel-list');channels.setAttribute('aria-label','POKEY physical channel');body.appendChild(channels);
  const channelButtons=Array.from({length:4},(_,index)=>{const node=button(channels,`CH${index+1}`,()=>selectChannel(index));node.dataset.chipChannel=String(index);return node;});
  const selected=section('Selected POKEY voice'),common=fields(selected);
  const gate=make('output');gate.dataset.chipOutput='pokey-gate';field(common,'Applied output').appendChild(gate);
  const volume=number(common,'Configured volume (0 silent / 15 loud)','volume',15,n=>command('setVolume',[channel,n]));
  const distortion=number(common,'Distortion (AUDC 0–7)','distortion',7,n=>command('setDistortion',[channel,n]));
  const volumeOnly=checkbox(common,'Volume-only DAC','volume-only',enabled=>command('setVolumeOnly',[channel,enabled]));
  const frequency=number(common,'Timer frequency (Hz)','frequency',undefined,n=>{if(!voice().helper)void command('setFrequency',[channel,n]);},{min:0.001,step:'any'});
  const period=number(common,'Applied timer period (AUDF)','period',undefined,null,{readOnly:true});
  const note=make('input');note.type='text';note.placeholder='A4';note.dataset.chipControl='pokey-note';field(common,'Timer note').appendChild(note);listen(note,'change',()=>{if(!voice().helper&&note.value.trim())void command('setNote',[channel,note.value.trim()]);});
  const mode=make('p','subtext');mode.dataset.chipOutput='pokey-mode';selected.appendChild(mode);
  const audition=fields(selected),midi=number(audition,'Audition MIDI note','audition-midi',127);midi.value='69';
  const auditionNote=()=>midi.value.trim()?Number(midi.value):NaN;
  const actions=make('div','chip-actions');audition.appendChild(actions);
  const hold=button(actions,'Hold to play',null,'hold');
  const play=button(actions,'Play 1 second',()=>{if(!visible||!canAudition())return;releaseSource('preview');const id=startNote(auditionNote(),'preview');if(id)timer=win.setTimeout(()=>{timer=null;endNote(id);},1000);},'play');
  button(actions,'Release',releaseAll,'release');
  const keyboard=button(actions,'Use Keyboard',()=>{if(!canAudition())return;keyboardActive=true;updateTarget();status.textContent=`${hardwareName()} CH${channel+1} is connected to the Guitar Keyboard.`;},'keyboard');
  const auditionHelp=make('p','subtext');selected.appendChild(auditionHelp);
  const shared=section('Shared clock and polynomial'),sharedFields=fields(shared);
  const clock=make('output');clock.dataset.chipOutput='pokey-clock';field(sharedFields,'Physical chip clock (Hz)').appendChild(clock);
  const baseClock=make('select');baseClock.dataset.chipControl='pokey-base-clock';for(const [key,label]of [['64khz','64 kHz (divider 28)'],['15khz','15 kHz (divider 114)']]){const option=make('option','',label);option.value=key;baseClock.appendChild(option);}field(sharedFields,'Base clock').appendChild(baseClock);
  listen(baseClock,'change',()=>{if(['64khz','15khz'].includes(baseClock.value))sharedCommand('setBaseClock',[baseClock.value]);});
  const poly9=checkbox(sharedFields,'Use 9-bit polynomial (otherwise 17-bit)','poly9',enabled=>sharedCommand('setPoly9',[enabled]));
  const joins=[0,1].map(pair=>checkbox(sharedFields,`Join CH${pair*2+1} + CH${pair*2+2}`,'joined-'+pair,enabled=>sharedCommand('setJoined',[pair,enabled])));
  const highs=[0,2].map(lower=>checkbox(sharedFields,`High clock for CH${lower+1} / joined pair`,'high-clock-'+lower,enabled=>sharedCommand('setHighClock',[lower,enabled])));
  const sharedInfo=make('p','subtext');sharedInfo.dataset.chipOutput='pokey-shared-info';shared.appendChild(sharedInfo);
  shared.appendChild(make('p','subtext','Clock, polynomial, and joined-pair settings are shared hardware controls. Changing them releases panel auditions. The upper physical channel owns a joined tone; its lower channel supplies the timer.'));
  const advanced=make('details','chip-advanced');advanced.appendChild(make('summary','','Voice JavaScript and applied registers'));root.appendChild(advanced);
  const code=make('textarea','chip-voice-code');code.readOnly=true;code.rows=14;code.dataset.chipControl='pokey-code';advanced.appendChild(code);
  button(advanced,'Copy voice JavaScript',async()=>{try{await win.navigator.clipboard.writeText(code.value);}catch{code.focus?.();code.select?.();}},'copy');
  const registers=make('pre','chip-memory-ranges');registers.dataset.chipOutput='pokey-registers';advanced.appendChild(registers);
  const status=make('p','chip-editor-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.appendChild(status);
  function startNote(midiNote,source,externalId,epoch){if(!canAudition()||!Number.isInteger(midiNote)||midiNote<0||midiNote>127)return null;const id=`pokey-panel:${panelId}:${++pressSequence}`;held.set(id,{channel,source,externalId,epoch,connection:connectionEpoch});void command('auditionOn',[channel,midiNote,id]);return id;}
  function endNote(id){const entry=held.get(id);if(!entry)return;held.delete(id);if(entry.connection===connectionEpoch)void command('auditionOff',[entry.channel,id]);}
  function releaseSource(source){for(const [id,entry]of held)if(entry.source===source)endNote(id);if(source==='preview'&&timer!==null){win.clearTimeout(timer);timer=null;}if(source==='hold'){holdPress=null;hold.setAttribute('aria-pressed','false');}}
  function releaseAll(){for(const id of [...held.keys()])endNote(id);if(timer!==null){win.clearTimeout(timer);timer=null;}holdPress=null;hold.setAttribute('aria-pressed','false');}
  function sharedCommand(method,args){releaseAll();void command(method,args);}
  function updateTarget(){
    const selectedChannel=channel,epoch=++bindingEpoch;
    target={owner:'pokey-voice-panel',name:`${hardwareName()} · CH${channel+1}`,
      noteOn(event){if(!keyboardActive||!canAudition()||epoch!==bindingEpoch||typeof event?.id!=='string')return;for(const[id,entry]of held)if(entry.source==='keyboard'&&entry.externalId===event.id&&entry.epoch===epoch)endNote(id);startNote(event.midi,'keyboard',event.id,epoch);},
      noteOff(event){for(const[id,entry]of held)if(entry.source==='keyboard'&&entry.externalId===event?.id&&entry.epoch===epoch&&entry.channel===selectedChannel)endNote(id);},
      allNotesOff(){for(const[id,entry]of held)if(entry.source==='keyboard'&&entry.epoch===epoch)endNote(id);}};
    keyboard.setAttribute('aria-pressed',String(keyboardActive));if(keyboardActive)onKeyboardTargetChange(target);
  }
  function selectChannel(next){if(channel===next)return;releaseAll();channel=next;if(voice().helper&&keyboardActive){keyboardActive=false;onKeyboardTargetChange(null);}updateTarget();if(state)update(state);}
  function holdStart(event){if(!visible||!canAudition()||event.type==='pointerdown'&&event.button!==undefined&&event.button!==0||event.type==='keydown'&&(event.repeat||![' ','Enter'].includes(event.key)))return;event.preventDefault();releaseSource('hold');const id=startNote(auditionNote(),'hold');if(!id)return;holdPress={id,pointerId:event.pointerId,key:event.key};hold.setAttribute('aria-pressed','true');if(event.pointerId!==undefined)try{hold.setPointerCapture(event.pointerId);}catch{}}
  function holdEnd(event){if(!holdPress||event.pointerId!==undefined&&event.pointerId!==holdPress.pointerId||event.type==='keyup'&&event.key!==holdPress.key)return;releaseSource('hold');}
  listen(hold,'pointerdown',holdStart);listen(hold,'keydown',holdStart);for(const type of ['pointerup','pointercancel','lostpointercapture','keyup'])listen(hold,type,holdEnd);
  listen(hold,'blur',()=>releaseSource('hold'));listen(win,'blur',releaseAll);listen(doc,'visibilitychange',()=>{if(doc.hidden)releaseAll();});
  function update(snapshot){
    if(disposed||!snapshot)return;const wasHelper=voice().helper,wasBusy=busy();state=snapshot;const ch=voice(),control=audctl(state),name=hardwareName(),isBusy=busy();
    if(ch.helper&&!wasHelper||isBusy&&!wasBusy){releaseAll();if(keyboardActive){keyboardActive=false;onKeyboardTargetChange(null);}updateTarget();}
    body.disabled=!connected||isBusy;
    timelineStatus.textContent=state.timeline?.playing?'Timeline playing · controls are read-only. Use Stop to edit.':state.timeline?.preparing?'Timeline preparing · controls are read-only. Use Stop to edit.':isBusy?'Timeline commands pending · controls are read-only. Use Stop to edit.':state.timeline?.loaded?'Prepared timeline ready. Voice edits are available.':'';
    target.name=`${name} · CH${channel+1}`;channels.setAttribute('aria-label',`${name} physical channel`);code.setAttribute('aria-label',`${name} voice JavaScript`);
    channelButtons.forEach((node,index)=>{const item=state.channels?.[index]??{};node.setAttribute('aria-pressed',String(channel===index));node.dataset.sounding=String(Boolean(item.active&&!item.helper));node.title=item.helper?`Timer helper for CH${index+2}`:`${item.joined?'Joined · ':''}${item.highClock?'High clock · ':''}${noteName(item.frequency)}`;});
    gate.textContent=`${ch.helper?`Timer helper · CH${channel+2} owns the joined tone`:ch.active?'Enabled':'Silent'} · applied volume ${ch.volume??'—'} · configured volume ${ch.configuredVolume??ch.volume??'—'}`;
    value(volume,ch.configuredVolume??ch.volume);value(distortion,ch.distortion);checked(volumeOnly,ch.volumeOnly);value(frequency,Number.isFinite(ch.frequency)?Number(ch.frequency.toFixed(6)):null);value(period,ch.period);value(note,noteName(ch.frequency));
    frequency.disabled=note.disabled=hold.disabled=play.disabled=keyboard.disabled=midi.disabled=Boolean(ch.helper);
    mode.textContent=[`Distortion ${ch.distortion??'—'}`,ch.type,ch.reason,ch.volumeOnly?'Volume-only DAC':null,ch.joined?(ch.helper?'Joined timer helper':'Joined upper voice'):null,ch.highClock?'High clock':null,ch.highPass?'High-pass filtered':null,Number.isInteger(ch.filterClockFor)?`Filter clock for CH${ch.filterClockFor+1}`:null].filter(Boolean).join(' · ');
    auditionHelp.textContent=ch.helper?`CH${channel+1} supplies the timer for CH${channel+2}. Select CH${channel+2} to tune or audition this joined pair.`:'MIDI pitch sets the timer rate. Distortion, volume-only, and shared AUDCTL settings determine the resulting sound. Configured volume 0 stays silent during audition.';
    clock.textContent=Number.isFinite(state.clock)?state.clock.toLocaleString('en-US'):'—';value(baseClock,state.baseClock??(control&1?'15khz':'64khz'));checked(poly9,state.poly9??Boolean(control&128));joins.forEach((node,index)=>checked(node,Boolean(control&(index?8:16))));highs.forEach((node,index)=>checked(node,Boolean(control&(index?32:64))));
    const skctl=state.skctl??state.registers?.[15];sharedInfo.textContent=`AUDCTL 0x${Number(control).toString(16).padStart(2,'0')}${skctl===undefined?'':` · SKCTL 0x${Number(skctl).toString(16).padStart(2,'0')}`}${state.running===undefined?'':state.running?' · running':' · timers held in reset'}`;
    value(code,pokeyVoiceCode(state,channel,state.apiName===undefined?apiName:state.apiName,state.instanceId??instanceId));registers.textContent=Array.from(state.registers??[],(n,index)=>`${index.toString(16).padStart(2,'0')}: ${Number(n).toString(16).padStart(2,'0')}`).join('  ');
  }
  function setConnected(next){if(disposed)return;next=Boolean(next);if(!next){releaseAll();if(keyboardActive){keyboardActive=false;onKeyboardTargetChange(null);}bindingEpoch++;keyboard.setAttribute('aria-pressed','false');}if(next!==connected)connectionEpoch++;connected=next;body.disabled=!next||busy();}
  updateTarget();
  return {update,setConnected,releaseAll,getSelectedChannel:()=>channel,getNoteTarget:()=>target,getAuditionAvailability:auditionAvailable,
    setVisible(next){visible=Boolean(next);if(!visible){releaseSource('hold');releaseSource('preview');}},
    setKeyboardActive(next){if(!next&&keyboardActive){keyboardActive=false;releaseSource('keyboard');bindingEpoch++;keyboard.setAttribute('aria-pressed','false');}},
    dispose(){if(disposed)return;setConnected(false);disposed=true;for(const remove of listeners)remove();}};
}
