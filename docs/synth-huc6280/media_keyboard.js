// SPDX-License-Identifier: BSD-3-Clause
// Monophonic software triggers over the existing authored media source.
const isAbort=error=>error?.name==='AbortError';
const identity=id=>{if(typeof id!=='string'||!id.length||id.length>128)throw TypeError('Media key identity must contain 1..128 characters');};
export const MEDIA_KEYBOARD_RELEASE_SECONDS=.008;

export function createPceMediaKeyboard({kind,source,onUpdate=()=>{}}={}){
  if(!['msm5205','cdda'].includes(kind)||!source||['read','play','stopIfPlaybackGeneration'].some(name=>typeof source[name]!=='function')||typeof onUpdate!=='function')
    throw TypeError('Media keyboard requires a media kind and its shared source');
  let disposed=false,note=null,error='';
  const state=()=>source.read();
  const matches=(item,value=state())=>Boolean(item&&value.sourceId===item.sourceId&&value.playbackGeneration===item.generation);
  function refresh(){if(note&&!matches(note))note=null;}
  function read(){
    refresh();
    return{kind,heldNotes:note?[note.id]:[],heldCount:note?1:0,activeId:note?.id??null,
      ownsPlayback:Boolean(note),pending:Boolean(note?.pending),disposed,error};
  }
  const emit=()=>{if(!disposed)try{onUpdate(read());}catch{}};
  const unsubscribe=typeof source.subscribe==='function'?source.subscribe(()=>{refresh();emit();}):()=>{};
  function retire(options){
    const previous=note;note=null;emit();
    if(!previous||!matches(previous))return Promise.resolve(false);
    try{return Promise.resolve(source.stopIfPlaybackGeneration(previous.generation,options)).catch(reason=>{if(isAbort(reason))return false;throw reason;});}
    catch(reason){return isAbort(reason)?Promise.resolve(false):Promise.reject(reason);}
  }
  function press(id,midi=60){
    identity(id);if(!Number.isInteger(midi)||midi<0||midi>127)throw RangeError('Media key must be MIDI 0..127');
    if(disposed)return Promise.reject(Error('Media keyboard is disposed'));
    refresh();if(note?.id===id)return note.promise??Promise.resolve(false);
    const value=state();
    if(!value.asset||kind==='cdda'&&(!value.track||value.selectedTrack==null))return Promise.reject(Error(`Load ${kind==='cdda'?'a CD-DA track':'an MSM5205 sample'} before playing the keyboard`));
    if(!Number.isSafeInteger(value.playbackGeneration)||value.playbackGeneration<0)throw Error('Media source does not expose playback ownership');
    void retire().catch(()=>{});
    const before=state(),item=note={id,midi,sourceId:before.sourceId,generation:before.playbackGeneration+1,pending:true,promise:null};
    error='';let playing;
    try{playing=kind==='cdda'?source.play(before.selectedTrack,{offset:0}):source.play();}
    catch(reason){note=null;error=reason?.message??String(reason);emit();return Promise.reject(reason);}
    item.promise=Promise.resolve(playing).then(()=>{
      if(note!==item||!matches(item))return false;
      item.pending=false;emit();return true;
    }).catch(reason=>{
      if(note!==item)return false;
      note=null;if(isAbort(reason)){emit();return false;}
      error=reason?.message??String(reason);emit();throw reason;
    });
    // Event handlers may intentionally ignore the returned promise; callers
    // that await it still receive current request failures.
    void item.promise.catch(()=>{});emit();return item.promise;
  }
  function release(id){identity(id);if(note?.id!==id)return Promise.resolve(false);return retire({releaseSeconds:MEDIA_KEYBOARD_RELEASE_SECONDS});}
  function cancel(){error='';return retire();}
  async function dispose(){if(disposed)return;const pending=retire();disposed=true;unsubscribe();await pending;}
  // UI handoff retires only the keyboard's latest playback, including a start
  // waiting for audio readiness. It never stops an already newer UI/Code Play.
  return{press,release,cancel,relinquish:cancel,read,dispose};
}
