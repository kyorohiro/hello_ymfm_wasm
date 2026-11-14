// SPDX-License-Identifier: BSD-3-Clause
const displayTime=value=>{const seconds=Math.max(0,Math.floor(value||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
const navigation=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End']);
/** Preview scrubs locally; commit once on release, keyup or blur. */
export function setupSnesSongSeekControls({player,range,time,document:doc=globalThis.document,onError=()=>{}}){
 let state=null,draft=null,editing=false,held=0,painted=0,operation=0,disposed=false;const cleanups=[];
 const listen=(node,type,fn)=>{node.addEventListener(type,fn);cleanups.push(()=>node.removeEventListener(type,fn));};
 function cancelDraft(){draft=null;editing=false;operation++;}
 function paint(){
  if(!state)return;
  const maximum=Math.min(3600,Math.max(state.source?.durationSeconds||3600,state.positionSeconds));
  range.disabled=!state.loaded||state.mode==='loading';range.max=String(maximum);
  painted=Math.max(0,Math.min(maximum,draft??(editing?held:state.seekTargetSeconds??state.positionSeconds)));
  if(Number(range.value)!==painted)range.value=String(painted);
  range.style.setProperty('--seek-position',`${maximum?painted/maximum*100:0}%`);
  const duration=state.source?.durationSeconds,label=duration?`${displayTime(duration)} (tag)`:'—';
  const text=`${displayTime(painted)} / ${label}`;if(time.textContent!==text)time.textContent=text;
  range.setAttribute('aria-valuetext',duration?`${displayTime(painted)} of ${displayTime(duration)} (tag)`:`${displayTime(painted)}; duration unknown`);
  range.title=range.disabled?'Load an SPC to seek.':'Release to seek; arrows: 1 second, Shift: 10 seconds; Escape: cancel. SPC duration tags are advisory.';
 }
 function update(next){if(disposed)return;if(state&&(next.source?.id!==state.source?.id||next.mode==='loading'||next.mode==='stopped'&&state.mode!=='stopped'))cancelDraft();state=next;paint();}
 function preview(){if(disposed||!state||range.disabled)return;draft=Number(range.value);held=draft;paint();}
 async function commit(){
  if(disposed||draft===null||range.disabled)return;const target=draft,ticket=++operation;draft=null;editing=false;
  try{await player.seek(target);}catch(error){if(!disposed&&ticket===operation&&error.name!=='AbortError')onError(error);}
  finally{if(!disposed&&ticket===operation)update(player.read());}
 }
 listen(range,'pointerdown',()=>{if(range.disabled)return;editing=true;held=Number(range.value);});
 listen(range,'input',preview);
 listen(range,'change',()=>{if(draft===null&&Number(range.value)!==painted)preview();void commit();});
 listen(range,'pointerup',()=>{editing=false;if(draft!==null)void commit();else paint();});
 listen(range,'pointercancel',()=>{cancelDraft();paint();});
 listen(range,'keydown',event=>{
  if(event.metaKey||event.ctrlKey||event.altKey)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelDraft();paint();return;}
  if(event.key===' '||event.key==='Enter'){event.preventDefault();event.stopPropagation();return;}
  if(!navigation.has(event.key)||range.disabled)return;event.preventDefault();event.stopPropagation();
  const step=event.shiftKey?10:1,deltas={ArrowLeft:-step,ArrowDown:-step,ArrowRight:step,ArrowUp:step,PageDown:-10,PageUp:10},maximum=Number(range.max);
  const target=event.key==='Home'?0:event.key==='End'?maximum:Number(range.value)+deltas[event.key];
  editing=true;range.value=String(Math.max(0,Math.min(maximum,target)));preview();
 });
 listen(range,'keyup',event=>{if(!navigation.has(event.key))return;event.stopPropagation();editing=false;void commit();});
 listen(range,'blur',()=>{editing=false;if(draft!==null)void commit();});
 // A background tab must not retain an unfinished drag or key repeat.
 listen(doc,'visibilitychange',()=>{if(doc.hidden){cancelDraft();paint();}});
 update(player.read());return{update,cancelDraft(){cancelDraft();paint();},dispose(){disposed=true;cancelDraft();for(const cleanup of cleanups)cleanup();}};
}
