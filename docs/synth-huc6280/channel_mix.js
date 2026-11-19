// SPDX-License-Identifier: BSD-3-Clause
// Session listening state, independent of presets, registers and file drafts.
export function readHuc6280ChannelMask(value) {
  if (!Number.isInteger(value) || value < 0 || value > 63) throw RangeError('HuC6280 channel mask must be an integer 0..63');
  return value;
}

/** Publish only accepted output changes. UI clicks do not acquire audio. */
export function createHuc6280ChannelMix({applyMask=async()=>{}}={}) {
  if(typeof applyMask!=='function')throw TypeError('Channel mix needs an apply callback');
  let mask=0,busy=false,disposed=false,tail=Promise.resolve();
  const listeners=new Set();
  const read=()=>({channelMuteMask:mask,channelEnabled:Array.from({length:6},(_,ch)=>!(mask&(1<<ch))),busy});
  const emit=()=>{for(const callback of listeners)callback(read());};
  function setChannelEnabled(channel,enabled) {
    if(!Number.isInteger(channel)||channel<0||channel>5)throw RangeError('HuC6280 channel must be CH1–CH6');
    if(typeof enabled!=='boolean')throw TypeError('Channel enabled must be boolean');
    if(disposed)return Promise.reject(Error('Channel mix is closed'));
    const task=tail.then(async()=>{
      if(disposed)throw Error('Channel mix is closed');
      const next=enabled?mask&~(1<<channel):mask|(1<<channel);
      if(next===mask)return read();
      busy=true;emit();
      try {await applyMask(next,mask);mask=next;}
      finally {busy=false;if(!disposed)emit();}
      return read();
    });
    tail=task.catch(()=>{});return task;
  }
  return {read,setChannelEnabled,onChange(callback){listeners.add(callback);return()=>listeners.delete(callback);},
    dispose(){disposed=true;listeners.clear();}};
}

/** All existing render routes accept the same logical six-channel mask. A
 * private paused audition translates it to its own physical channels. */
export async function applyHuc6280ChannelMask(mask,previous,{author,audition,song,onRollbackError=()=>{}}={}) {
  readHuc6280ChannelMask(mask);readHuc6280ChannelMask(previous);
  const changed=[];
  try {
    for(const route of [author,audition,song])if(route){
      // Include the attempted route: a rejected command may have changed a
      // native channel before its own rollback encountered an error.
      changed.push(route);await route.setChannelMuteMask(mask);
    }
  } catch(error) {
    const failures=[];
    for(const route of changed.reverse())try{await route.setChannelMuteMask(previous);}catch(failure){failures.push(failure);}
    if(failures.length)onRollbackError(new AggregateError([error,...failures],'Channel output update failed; an audio route could not be restored.'));
    throw error;
  }
}

export function setupHuc6280ChannelMix({mix,document:doc=globalThis.document,onError=()=>{}}={}) {
  const root=doc.getElementById('hucSongChannels'),buttons=Array.from({length:6},(_,ch)=>doc.getElementById(`hucSongChannel${ch+1}Toggle`)),listeners=[];
  function render(state){
    if(root){root.hidden=false;root.dataset.channelMuteMask=String(state.channelMuteMask);root.setAttribute('aria-busy',String(state.busy));}
    buttons.forEach((button,ch)=>{if(!button)return;const enabled=state.channelEnabled[ch];
      button.textContent=`CH ${ch+1} · ${enabled?'On':'Off'}`;button.disabled=state.busy;
      button.setAttribute('aria-pressed',String(enabled));button.setAttribute('aria-label',`HuC6280 CH${ch+1} output ${enabled?'On':'Off'}`);
    });
  }
  function listen(node,event,callback){node.addEventListener(event,callback);listeners.push(()=>node.removeEventListener(event,callback));}
  buttons.forEach((button,ch)=>{if(!button)return;
    listen(button,'pointerdown',event=>{if(event.button===0)event.preventDefault();});
    listen(button,'click',()=>{button.blur();void mix.setChannelEnabled(ch,!mix.read().channelEnabled[ch]).catch(onError);});
  });
  const unsubscribe=mix.onChange(render);render(mix.read());
  return {dispose(){unsubscribe();listeners.forEach(remove=>remove());}};
}
