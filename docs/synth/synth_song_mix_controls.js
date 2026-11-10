/** Shared inline Mixer tab; selecting it is owned by the chip-view controls. */
export function setupSynthSongMixControls({preview}) {
  const button = document.getElementById('synthSongMixButton');
  const buttons = [button,document.getElementById('synthCodeMixerButton')].filter(Boolean);
  const panel = document.getElementById('synthSongMixPanel');
  const list = document.getElementById('synthSongMixChannels');
  const referenceOptions = document.getElementById('synthSongMixReferenceOptions');
  const channelStatus = document.getElementById('synthSongMixChannelStatus');
  const reset = document.getElementById('synthSongMixReset');
  const rows = new Map(), volumes = new Map();
  const listeners=[];
  const listen=(node,type,callback)=>{node.addEventListener(type,callback);listeners.push(()=>node.removeEventListener(type,callback));};
  let structure = '', signature = '', lastMix, disposed=false;
  function createVolume(group, section) {
    const label = document.createElement('label');
    label.className = 'synth-song-mix-volume';
    const name = document.createElement('span');
    name.textContent = 'Volume';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '380';
    // Canonical gains carry six decimal places: retain all four fractional
    // percent digits instead of rounding a freshly loaded System level.
    input.step = '0.0001';
    input.id = 'synthSongGroupVolume-' + group.id;
    input.dataset.songGroupVolume = group.id;
    input.setAttribute('aria-label', group.label + ' volume, 0 to 380 percent');
    const value = document.createElement('output');
    value.htmlFor = input.id;
    value.dataset.songGroupVolumeValue = group.id;
    input.addEventListener('input', () => {if(!disposed)preview.setGroupVolume(group.id, Number((Number(input.value) / 100).toFixed(6)));});
    input.addEventListener('keydown', event => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const step = event.shiftKey ? 10 : 1;
      const deltas = {ArrowLeft:-step, ArrowDown:-step, ArrowRight:step, ArrowUp:step, PageDown:-10, PageUp:10};
      const value = Number(input.value);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 380
        : Object.hasOwn(deltas, event.key) ? Math.max(0, Math.min(380, value + deltas[event.key])) : null;
      if (next === null) return;
      event.preventDefault();
      input.value = next.toFixed(4);
      input.dispatchEvent(new Event('input', {bubbles:true}));
    });
    label.append(name, input, value);
    section.append(label);
    volumes.set(group.id, {input, value});
  }
  function createChannel(channel, section) {
    const row = document.createElement('div');
    row.className = 'synth-song-mix-channel';
    row.dataset.songMixChannel = channel.id;
    const label = document.createElement('span');
    label.textContent = channel.label;
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'toolbar-button';
    control.dataset.songMute = channel.id;
    control.addEventListener('pointerdown', event => event.preventDefault());
    control.addEventListener('click', () => {
      if(disposed)return;
      const current = preview.getState().mix.channels.find(value => value.id === channel.id);
      if (current) preview.setChannelMuted(channel.id, !current.muted);
      control.blur();
    });
    row.append(label, control);
    section.append(row);
    rows.set(channel.id, {row, control});
  }
  function update(mix) {
    if (disposed || mix === lastMix) return;
    lastMix = mix;
    const channels = mix?.channels ?? [], groups = mix?.groups ?? [];
    if(referenceOptions)referenceOptions.hidden=!mix?.referenceActive;
    const next = JSON.stringify([
      groups.map(group => [group.id, group.label, group.volume !== undefined]),
      channels.map(channel => [channel.id, channel.groupId, channel.group, channel.label]),
    ]);
    const structureChanged = next !== structure;
    if (structureChanged) {
      structure = next;
      signature = '';
      rows.clear();
      volumes.clear();
      list.replaceChildren();
      for (const group of groups) {
        const section = document.createElement('fieldset');
        const title = document.createElement('legend');
        title.textContent = group.label;
        section.append(title);
        if (group.volume !== undefined) createVolume(group, section);
        for (const channel of channels) if (channel.groupId === group.id) createChannel(channel, section);
        list.append(section);
      }
    }
    const state = JSON.stringify([channels.map(channel => channel.muted), groups.map(group => group.volume)]);
    if (state === signature) return;
    signature = state;
    const muted = channels.filter(channel => channel.muted).length;
    for(const trigger of buttons) {
      // Chip-view selection owns aria-selected / is-selected on the Mixer tab.
      trigger.dataset.mixChanged=String(Boolean(mix?.changed));
    }
    if(channelStatus)channelStatus.textContent=muted?`${muted} of ${channels.length} channels off`:`${channels.length} channels on`;
    reset.disabled = !mix?.changed;
    for (const channel of channels) {
      const entry = rows.get(channel.id);
      entry.row.classList.toggle('is-muted', channel.effectiveMuted);
      entry.control.textContent=channel.muted?'Off':'On';
      entry.control.title=`Turn ${channel.muted?'on':'off'} ${channel.group} ${channel.label}`;
      entry.control.setAttribute('aria-label',entry.control.title);
      entry.control.setAttribute('aria-pressed',String(!channel.muted));
      entry.control.classList.toggle('is-selected',!channel.muted);
    }
    for (const group of groups) {
      const control = volumes.get(group.id);
      if (!control) continue;
      const percent = Number((group.volume * 100).toFixed(4));
      const text = Number(percent.toFixed(1)) + '%';
      if (Number(control.input.value) !== percent) control.input.value = String(percent);
      control.input.style.setProperty('--mix-volume-position', (percent / 380 * 100) + '%');
      control.input.dataset.boosted = String(percent > 100);
      control.input.title = group.label + ' source volume: ' + percent + '% (gain ' + group.volume + '; 100% = 1x)';
      control.input.setAttribute('aria-valuetext', percent + ' percent, source gain ' + group.volume);
      if (control.value.textContent !== text) control.value.textContent = text;
    }
  }
  for(const trigger of buttons) {
    listen(trigger,'pointerdown',event=>event.preventDefault());
  }
  const codeButton=document.getElementById('synthCodeMixerButton');
  if(codeButton)listen(codeButton,'click',()=>{
    const expand=document.getElementById('synthCodeExpandButton');
    if(expand?.getAttribute('aria-pressed')==='true')expand.click();
    button.click();
    document.getElementById('synthChipMixer')?.scrollIntoView?.({block:'nearest'});
  });
  listen(reset,'pointerdown',event=>event.preventDefault());
  listen(reset,'click',()=>{preview.resetMix();reset.blur();});
  const navigationKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  const keys = event => {
    // Keep performance letters available with a focused volume slider. Native
    // slider navigation and button activation must not reach page shortcuts.
    if (event.key === ' ' || event.key === 'Enter' ||
      event.target.matches?.('input[type="range"]') && navigationKeys.has(event.key)) event.stopPropagation();
  };
  listen(panel,'keydown',keys);
  for(const trigger of buttons)listen(trigger,'keydown',keys);
  // Legacy transport reset callers can close a popover; the inline tab stays
  // selected until the user chooses another chip tab.
  return {update, close(){}, dispose() {
    if(disposed)return;disposed=true;
    for(const remove of listeners)remove();
  }};
}
