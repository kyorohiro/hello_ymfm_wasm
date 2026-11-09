/** A small, non-modal mixer: opening it never moves the instrument controls. */
export function setupSynthSongMixControls({preview}) {
  const button=document.getElementById('synthSongMixButton');
  const panel=document.getElementById('synthSongMixPanel');
  const list=document.getElementById('synthSongMixChannels');
  const reset=document.getElementById('synthSongMixReset');
  let structure='', signature='';
  function close() {panel.hidden=true;button.setAttribute('aria-expanded','false');}
  function position() {
    const bounds=button.getBoundingClientRect(),margin=8;
    const width=Math.min(340,innerWidth-margin*2);
    panel.style.width=`${width}px`;
    panel.style.left=`${Math.max(margin,Math.min(bounds.left,innerWidth-width-margin))}px`;
    panel.style.top=`${Math.min(bounds.bottom+6,Math.max(margin,innerHeight-200))}px`;
    panel.style.maxHeight=`${Math.max(100,innerHeight-parseFloat(panel.style.top)-margin)}px`;
  }
  function update(mix) {
    const channels=mix?.channels??[];
    const next=JSON.stringify(channels.map(channel=>[channel.id,channel.group,channel.label]));
    if(next!==structure) {
      structure=next;list.replaceChildren();signature='';
      if(!channels.length)list.textContent='Play a VGM to show its channels.';
      let group=null,section=null;
      for(const channel of channels) {
        if(group!==channel.group) {
          group=channel.group;section=document.createElement('fieldset');
          const title=document.createElement('legend');title.textContent=group;
          section.append(title);list.append(section);
        }
        const row=document.createElement('div');row.className='synth-song-mix-channel';row.dataset.songMixChannel=channel.id;
        const label=document.createElement('span');label.textContent=channel.label;row.append(label);
        for(const kind of ['mute','solo']) {
          const control=document.createElement('button');control.type='button';control.className='toolbar-button';
          control.dataset[kind==='mute'?'songMute':'songSolo']=channel.id;
          control.textContent=kind==='mute'?'M':'S';
          control.title=`${kind==='mute'?'Mute':'Solo'} ${group} ${channel.label}`;
          control.setAttribute('aria-label',control.title);
          control.addEventListener('pointerdown',event=>event.preventDefault());
          control.addEventListener('click',()=>{
            const current=preview.getState().mix.channels.find(value=>value.id===channel.id);
            if(kind==='mute')preview.setChannelMuted(channel.id,!current.muted);
            else preview.setChannelSolo(channel.id,!current.solo);
            control.blur();
          });
          row.append(control);
        }
        section.append(row);
      }
    }
    const state=JSON.stringify(channels.map(channel=>[channel.muted,channel.solo,channel.effectiveMuted]));
    if(state===signature)return;
    signature=state;
    const muted=channels.filter(channel=>channel.muted).length;
    button.textContent=mix?.hasSolo?'Mix · Solo':muted?`Mix · ${muted} muted`:'Mix';
    reset.disabled=!mix?.changed;
    for(const channel of channels) {
      const row=[...list.querySelectorAll('[data-song-mix-channel]')].find(node=>node.dataset.songMixChannel===channel.id);
      row.classList.toggle('is-muted',channel.effectiveMuted);
      for(const kind of ['mute','solo']) {
        const control=row.querySelector(`[data-song-${kind}]`),pressed=channel[kind==='mute'?'muted':'solo'];
        control.setAttribute('aria-pressed',String(pressed));
        control.classList.toggle('is-selected',pressed);
      }
    }
    if(!panel.hidden)position();
  }
  button.addEventListener('pointerdown',event=>event.preventDefault());
  button.addEventListener('click',()=>{
    panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));
    if(!panel.hidden)position();button.blur();
  });
  reset.addEventListener('pointerdown',event=>event.preventDefault());
  reset.addEventListener('click',()=>{preview.resetMix();reset.blur();});
  const outside=event=>{if(!panel.contains(event.target)&&!button.contains(event.target))close();};
  const escape=event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();close();button.focus();}};
  const scroll=()=>{if(!panel.hidden)close();};
  const keys=event=>{if(event.key==='Escape')escape(event);event.stopPropagation();};
  panel.addEventListener('keydown',keys);button.addEventListener('keydown',keys);
  document.addEventListener('pointerdown',outside);
  document.addEventListener('keydown',escape);
  window.addEventListener('resize',scroll);
  window.addEventListener('scroll',scroll);
  return {update,close,dispose(){close();document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',scroll);window.removeEventListener('scroll',scroll);}};
}
