// SPDX-License-Identifier: BSD-3-Clause
const seconds=value=>`${Number(value??0).toFixed(2)} s`;
/** Stable rows preserve keyboard focus; polling never adopts an instrument. */
export function createSpcLiveInspector({root,onCapture,onSave,onError=()=>{}}) {
  const doc=root.ownerDocument,cleanups=[],rows=[];let disposed=false,busy=false,state=null,sequence=0;
  const make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  root.className='sdsp-spc-live';root.append(make('h3','Playback channels'));
  const description=make('p','Updates about 5 times / second. ENVX / OUTX show sampled activity, not every note. Load sound captures fresh RAM / DSP and uses the Echo / PMON import options below.');description.className='sdsp-help';root.append(description);
  const stamp=make('p','Play or seek SPC to inspect playback channels.');stamp.id='spcLivePosition';root.append(stamp);
  const scroll=make('div');scroll.className='sdsp-spc-live-scroll';const table=make('table');table.setAttribute('aria-label','SPC playback channel state');scroll.append(table);root.append(scroll);
  const head=make('thead'),header=make('tr');for(const label of ['CH','Activity','Level','L / R','PITCH','Sample','Sound']){const th=make('th',label);th.scope='col';header.append(th);}head.append(header);table.append(head);
  const body=make('tbody');table.append(body);
  const status=make('p','Your edited instrument is kept until Load sound.');status.id='spcLiveStatus';status.setAttribute('role','status');root.append(status);
  const save=make('button','Save current sound as…');save.id='spcLiveSaveSound';save.type='button';save.hidden=true;
  if(onSave){root.append(save);const click=()=>{save.blur();try{onSave();}catch(error){onError(error);}};save.addEventListener('click',click);cleanups.push(()=>save.removeEventListener('click',click));}
  for(let index=0;index<8;index++) {
    const tr=make('tr');tr.dataset.liveChannel=String(index);const label=make('th',`CH${index+1}`);label.scope='row';tr.append(label);
    const cells=['Activity','Level','L / R','PITCH','Sample'].map(label=>{const td=make('td','—');td.dataset.label=label;tr.append(td);return td;});
    const action=make('td'),button=make('button','Load sound');button.type='button';button.dataset.liveCapture=String(index);button.setAttribute('aria-label',`Load current SPC CH${index+1} sound`);action.append(button);tr.append(action);body.append(tr);
    const click=async()=>{
      button.blur();if(disposed||busy||!state?.inspection||state.busy)return;
      const token=++sequence;busy=true;update(state);text(status,`Capturing CH${index+1}…`);status.dataset.error='false';
      try{const message=await onCapture(index);if(!disposed&&token===sequence){text(status,message);save.hidden=!onSave;}}
      catch(error){if(!disposed&&token===sequence){text(status,error.name==='AbortError'?'Capture cancelled. Current instrument kept.':`Capture failed: ${error.message}. Current instrument kept.`);status.dataset.error=String(error.name!=='AbortError');if(error.name!=='AbortError')onError(error);}}
      finally{if(!disposed&&token===sequence){busy=false;update(state);}}
    };
    button.addEventListener('click',click);cleanups.push(()=>button.removeEventListener('click',click));rows.push({tr,cells,button});
  }
  function update(next){
    if(disposed)return;state=next;const snapshot=state.inspection;save.disabled=busy;
    text(stamp,snapshot?`${state.playing?'Live':state.busy?'Updating':'Frozen'} · ${seconds(snapshot.positionSeconds)}${state.inspectionError?' · Inspection unavailable: '+state.inspectionError:''}`:'Play or seek SPC to inspect playback channels.');
    for(let index=0;index<8;index++){
      const {tr,cells,button}=rows[index],voice=snapshot?.voices[index],muted=Boolean(state.muteMask&(1<<index));button.disabled=busy||!voice||state.busy||Boolean(state.inspectionError);
      tr.dataset.active=String(Boolean(voice?.active));tr.dataset.muted=String(muted);
      const values=voice?[`${voice.active?'Active':'Idle'}${muted?' · Muted':''}`,`ENVX ${voice.envx} / OUTX ${voice.outx}`,`${voice.volumeLeft} / ${voice.volumeRight}`,String(voice.pitch),`${voice.noise?'Noise '+snapshot.noiseClock+' · ':''}SRCN ${voice.sourceNumber}${voice.pitchModulation?' · PMON':''}${voice.echo?' · Echo':''}`]:Array(5).fill('—');
      cells.forEach((cell,i)=>text(cell,values[i]));
    }
  }
  return{update,dispose(){disposed=true;sequence++;for(const cleanup of cleanups)cleanup();root.replaceChildren();}};
}
