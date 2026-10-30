/** Initial applied SCSP slot inspector. PCM / envelope editing is authored in JS. */
export function createPlaygroundScspVoicePanel({root,invoke,onSelectedChannelChange=()=>{},onError=()=>{}}) {
  const doc=root.ownerDocument,make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  let state=null,selected=0,connected=false,visible=true,disposed=false,held=null,sequence=0;
  const channels=make('div');channels.className='chip-channel-list';channels.setAttribute('aria-label','SCSP slot');root.append(channels);
  const buttons=Array.from({length:32},(_,slot)=>{
    const button=make('button',`Slot ${slot+1}`);button.type='button';button.dataset.scspSlot=String(slot);
    button.addEventListener('click',()=>{release();selected=slot;update(state);onSelectedChannelChange();button.blur();});channels.append(button);return button;
  });
  const memory=make('p'),voice=make('pre'),noteLabel=make('label','MIDI note '),note=make('input');note.type='number';note.min='0';note.max='127';note.value='69';noteLabel.append(note);
  const hold=make('button','Hold to play');hold.type='button';hold.dataset.chipAction='scsp-hold';
  const hint=make('p','Original PCM is ready after Prepare audio. Keyboard selects any of the 32 physical slots. PCM and envelope edits currently use JavaScript. DSP / FM / SSF are not exposed here.');hint.className='subtext';
  root.append(memory,voice,noteLabel,hold,hint);
  function release(){const entry=held;held=null;if(entry)void invoke('auditionOff',[entry.slot,entry.id]).catch(error=>{if(!disposed)onError(error);});}
  function press(event){
    if(!connected||!visible||disposed||held)return;event.preventDefault();
    const midi=Number(note.value);if(!note.value.trim()||!Number.isInteger(midi)||midi<0||midi>127){note.reportValidity();return;}
    const entry={slot:selected,id:`scsp-panel-${Date.now()}-${++sequence}`};held=entry;if(event.pointerId!==undefined)hold.setPointerCapture?.(event.pointerId);
    void invoke('auditionOn',[entry.slot,midi,entry.id]).catch(error=>{if(held===entry)held=null;if(!disposed)onError(error);});
  }
  hold.addEventListener('pointerdown',press);
  hold.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)&&!event.repeat)press(event);});
  hold.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();release();}});
  const visibility=()=>{if(doc.hidden)release();};
  doc.defaultView?.addEventListener('blur',release);doc.addEventListener('visibilitychange',visibility);
  for(const event of ['pointerup','pointercancel','lostpointercapture'])hold.addEventListener(event,release);
  function update(next){state=next;const v=state?.channels?.[selected];
    buttons.forEach((button,i)=>{button.setAttribute('aria-pressed',String(i===selected));});
    memory.textContent=state?`Sample RAM: ${state.ramUsedBytes.toLocaleString()} / 524,288 bytes · ${state.samples.length} PCM samples`:'';
    const text=v?JSON.stringify({slot:selected+1,sample:v.sample?.id??null,frequencyHz:v.frequencyHz,totalLevel:v.totalLevel,directLevel:v.directLevel,pan:v.pan,envelope:v.envelope,requestedGate:v.gate},null,2):'Prepare audio to inspect SCSP slots.';if(voice.textContent!==text)voice.textContent=text;
    hold.disabled=!connected||!v?.sample;
  }
  update(null);
  return {update,releaseAll:release,getSelectedChannel:()=>selected,setConnected(value){connected=value;if(!value)release();update(state);},setVisible(value){visible=value;if(!value)release();},dispose(){if(disposed)return;release();disposed=true;doc.defaultView?.removeEventListener('blur',release);doc.removeEventListener('visibilitychange',visibility);root.replaceChildren();}};
}
