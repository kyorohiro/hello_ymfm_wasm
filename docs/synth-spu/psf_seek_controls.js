// SPDX-License-Identifier: BSD-3-Clause
// Seeking is committed on release; moving the slider never renders a machine.
export function parsePsfTagTime(value) {
  if(typeof value!=='string'||/[\r\n]/.test(value))return null;
  const parts=value.trim().split(':');
  if(parts.length>3||!parts.length||!/^\d+(?:\.\d+)?$/.test(parts.at(-1))||parts.slice(0,-1).some(part=>!/^\d+$/.test(part)))return null;
  const numbers=parts.map(Number);
  if(parts.length>1&&numbers.at(-1)>=60||parts.length===3&&numbers[1]>=60)return null;
  const seconds=numbers.reduce((total,part)=>total*60+part,0);
  return Number.isFinite(seconds)&&seconds>=0&&seconds<=Number.MAX_SAFE_INTEGER?seconds:null;
}
export function psfSeekRange(tags,positionSeconds=0,maxSeconds=1800) {
  const cap=Number.isFinite(maxSeconds)&&maxSeconds>0?maxSeconds:1800;
  const length=parsePsfTagTime(tags?.get?.('length')),fade=parsePsfTagTime(tags?.get?.('fade'));
  const hint=length===null?null:length+(fade??0);
  if(hint>0)return {maxSeconds:Math.min(cap,hint),hintSeconds:hint,kind:hint>cap?'limit':'tags'};
  return {maxSeconds:Math.min(cap,Math.max(300,Math.ceil((Math.max(0,positionSeconds)+30)/60)*60)),hintSeconds:null,kind:'window'};
}
const time=seconds=>{const whole=Math.max(0,Math.floor(seconds||0));return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}`;};

export function setupPsfSeekControls({document:doc=globalThis.document,read,seek,cancelSeek,getTags=()=>null,onError=()=>{}}={}) {
  const range=doc.getElementById('psfSongSeek'),position=doc.getElementById('psfSongPosition'),
    progress=doc.getElementById('psfSeekProgress'),cancel=doc.getElementById('psfSeekCancel'),root=doc.getElementById('psfSongPlayer');
  if(!range||!position||!progress||!cancel||!root)throw new Error('PSF seek controls are missing');
  const cleanups=[],navigation=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown']);
  let latest=null,draft=null,heldMaximum=null,disposed=false,operation=0;
  const listen=(node,event,fn)=>{node.addEventListener(event,fn);cleanups.push(()=>node.removeEventListener(event,fn));};
  function resetDraft(){draft=null;heldMaximum=null;}
  function paint(state) {
    const bounds=psfSeekRange(getTags(),state.positionSeconds,state.seekMaxSeconds),maximum=heldMaximum??bounds.maxSeconds;
    const selected=draft??state.seekTargetSeconds??state.positionSeconds??0,value=Math.max(0,Math.min(maximum,selected));
    range.disabled=!state.canSeek||state.seeking;
    range.max=String(maximum);
    if(Number(range.value)!==value)range.value=String(value);
    range.setAttribute('aria-valuetext',`${time(value)}; ${bounds.kind==='window'?'duration unknown':bounds.kind==='limit'?'seek limit':'range from PSF tags'}`);
    range.title=`Release to seek. Arrows: 1 second; Shift: 10 seconds. ${bounds.kind==='window'?'Duration unknown; the bar uses an expanding five-minute window.':bounds.kind==='limit'?'The seek range is limited to '+time(state.seekMaxSeconds)+'.':'Range from length + fade tags; playback does not automatically end or fade at this time.'}`;
    const label=bounds.kind==='window'?'?':`${time(maximum)} (${bounds.kind==='limit'?'limit':'tag'})`;
    const text=`${time(selected)} / ${label}`;if(position.textContent!==text)position.textContent=text;
    position.dataset.seconds=String(state.positionSeconds??0);
    position.title=bounds.hintSeconds!==null?`PSF length + fade hint: ${time(bounds.hintSeconds)}. This does not set the playback end.`:'PSF duration is unknown.';
    progress.hidden=cancel.hidden=!state.seeking;
    progress.value=state.seekTargetSeconds>0?Math.min(1,(state.seekProgressSeconds??0)/state.seekTargetSeconds):0;
    progress.title=state.seekMessage||`Prepared ${time(state.seekProgressSeconds)} / ${time(state.seekTargetSeconds)}`;
    cancel.disabled=!state.canCancelSeek;
    for(const [key,value]of Object.entries({seeking:Boolean(state.seeking),seekTarget:state.seekTargetSeconds??'',seekProgress:state.seekProgressSeconds??0,seekRangeKind:bounds.kind}))root.dataset[key]=String(value);
  }
  function update(state) {
    if(disposed)return;
    if(latest?.selection?.entry!==state.selection?.entry||state.starting||state.seeking&&!latest?.seeking)resetDraft();
    latest=state;paint(state);
  }
  function preview() {
    if(range.disabled||!latest)return;
    heldMaximum??=Number(range.max);draft=Number(range.value);paint(latest);
  }
  async function commit() {
    if(disposed)return;
    if(range.disabled||draft===null){resetDraft();if(latest)paint(latest);return;}
    const target=draft,ticket=++operation;resetDraft();
    try {await seek(target);}
    catch(error){if(!disposed&&ticket===operation&&error?.name!=='AbortError')onError(error);}
    finally{if(!disposed&&ticket===operation)update(read());}
  }
  listen(range,'pointerdown',event=>{if(event.button===undefined||event.button===0)heldMaximum=Number(range.max);});
  listen(range,'input',preview);
  listen(range,'change',()=>{void commit();});
  listen(range,'pointerup',()=>{void commit();});
  listen(range,'pointercancel',()=>{resetDraft();if(latest)paint(latest);});
  listen(range,'blur',()=>{void commit();});
  listen(range,'keydown',event=>{
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();resetDraft();if(latest)paint(latest);return;}
    if(event.key===' '||event.key==='Enter'){event.preventDefault();event.stopPropagation();return;}
    if(!navigation.has(event.key)||range.disabled)return;
    event.preventDefault();event.stopPropagation();heldMaximum??=Number(range.max);
    const step=event.shiftKey?10:1,delta={ArrowLeft:-step,ArrowDown:-step,ArrowRight:step,ArrowUp:step,PageDown:-10,PageUp:10}[event.key];
    range.value=String(Math.max(0,Math.min(heldMaximum,event.key==='Home'?0:event.key==='End'?heldMaximum:Number(range.value)+delta)));preview();
  });
  listen(range,'keyup',event=>{if(navigation.has(event.key)){event.stopPropagation();void commit();}});
  listen(cancel,'click',()=>{resetDraft();operation++;cancel.blur();void Promise.resolve(cancelSeek()).catch(onError);});
  update(read());
  return {update,dispose(){disposed=true;operation++;for(const cleanup of cleanups)cleanup();},cancelDraft(){resetDraft();if(latest)paint(latest);}};
}
