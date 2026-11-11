// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Passive PSF voice activity, driven only by existing audible-frame snapshots.

/** Create one stable set of physical-channel buttons. ENV is a native envelope
 * register, not an output level; silent PMON sources can still be active.
 */
export function createPsfChannelActivity({element,onSelect}={}) {
  if(!element?.ownerDocument?.createElement||typeof onSelect!=='function')
    throw new TypeError('PSF channel activity requires an element and selection callback');
  const buttons=[],listeners=[];
  let selected=0,shown=false,disposed=false;
  const attribute=(node,name,value)=>{if(node.getAttribute(name)!==value)node.setAttribute(name,value);};
  const data=(node,name,value)=>{if(node.dataset[name]!==value)node.dataset[name]=value;};
  function select(voice) {
    selected=Number.isInteger(voice)&&voice>=0&&voice<24?voice:null;
    for(let index=0;index<24;index++)attribute(buttons[index],'aria-pressed',String(index===selected));
  }
  for(let index=0;index<24;index++) {
    const button=element.ownerDocument.createElement('button');
    button.type='button';button.className='spu-psf-channel';button.dataset.psfChannel=String(index);
    // Never replace this text node during snapshots or selection changes.
    button.textContent=String(index+1);
    const clicked=()=>{
      try {
        if(disposed||!shown||selected===index)return;
        select(index);onSelect(index);
      } finally {button.blur();}
    };
    button.addEventListener('click',clicked);listeners.push(()=>button.removeEventListener('click',clicked));
    buttons.push(button);element.appendChild(button);
  }
  function update({visible=false,voice=0,liveState=null,waiting=false,error=false}={}) {
    if(disposed)return;
    shown=Boolean(visible);if(element.hidden===shown)element.hidden=!shown;
    select(voice);
    const channels=liveState?.channels;
    let ready=shown&&!waiting&&!error&&Array.isArray(channels)&&channels.length>=24;
    if(ready)for(let index=0;index<24;index++) {
      const value=channels[index];
      if(!value||typeof value.active!=='boolean'||typeof value.gate!=='boolean'||
        !Number.isInteger(value.envelope)||value.envelope<0||value.envelope>0xffff){ready=false;break;}
    }
    data(element,'ready',String(ready));
    for(let index=0;index<24;index++) {
      const button=buttons[index],value=ready?channels[index]:null;
      const envelope=value?.envelope??0,gate=Boolean(value?.gate),active=Boolean(value?.active);
      // The native core may be active before its envelope has risen above 0.
      // Preserve that flag separately from the visible ENV-gated indicator.
      const lit=active&&envelope>0;
      data(button,'available',String(ready));data(button,'active',String(active));
      data(button,'lit',String(lit));
      data(button,'gate',String(gate));data(button,'env',String(envelope));
      const ratio=String(Math.max(0,Math.min(1,envelope/32767)));
      if(button.style.getPropertyValue('--spu-channel-env')!==ratio)button.style.setProperty('--spu-channel-env',ratio);
      const description=ready?`CH ${index+1} · Gate ${gate?'On':'Off'} · Core active ${active?'Yes':'No'} · ENV ${envelope}`:
        `CH ${index+1} · Gate unavailable · Core active unavailable · ENV unavailable`;
      attribute(button,'aria-label',description);attribute(button,'title',description);
    }
  }
  update();
  return {update,dispose() {
    if(disposed)return;
    update({visible:false,voice:selected});disposed=true;
    for(const remove of listeners)remove();
    for(const button of buttons)button.remove();
  }};
}
