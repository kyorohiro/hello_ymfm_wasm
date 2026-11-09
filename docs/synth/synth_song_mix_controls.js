/** A small, non-modal mixer: opening it never moves the instrument controls. */
export function setupSynthSongMixControls({preview}) {
  const button = document.getElementById('synthSongMixButton');
  const panel = document.getElementById('synthSongMixPanel');
  const list = document.getElementById('synthSongMixChannels');
  const reset = document.getElementById('synthSongMixReset');
  const rows = new Map(), volumes = new Map();
  let structure = '', signature = '', lastMix;

  function close() {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }
  function position() {
    const bounds = button.getBoundingClientRect(), margin = 8;
    const width = Math.min(340, innerWidth - margin * 2);
    panel.style.width = width + 'px';
    panel.style.left = Math.max(margin, Math.min(bounds.left, innerWidth - width - margin)) + 'px';
    panel.style.top = Math.min(bounds.bottom + 6, Math.max(margin, innerHeight - 200)) + 'px';
    panel.style.maxHeight = Math.max(100, innerHeight - parseFloat(panel.style.top) - margin) + 'px';
  }
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
    input.addEventListener('input', () => preview.setGroupVolume(group.id, Number((Number(input.value) / 100).toFixed(6))));
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
    control.textContent = 'Mute';
    control.title = 'Mute ' + channel.group + ' ' + channel.label;
    control.setAttribute('aria-label', control.title);
    control.addEventListener('pointerdown', event => event.preventDefault());
    control.addEventListener('click', () => {
      const current = preview.getState().mix.channels.find(value => value.id === channel.id);
      if (current) preview.setChannelMuted(channel.id, !current.muted);
      control.blur();
    });
    row.append(label, control);
    section.append(row);
    rows.set(channel.id, {row, control});
  }
  function update(mix) {
    if (mix === lastMix) return;
    lastMix = mix;
    const channels = mix?.channels ?? [], groups = mix?.groups ?? [];
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
      if (!channels.length) list.textContent = 'Play a VGM to show its channels.';
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
    const caption = muted ? 'Mix · ' + muted + ' muted' : 'Mix';
    const captionChanged = button.textContent !== caption;
    if (captionChanged) button.textContent = caption;
    button.classList.toggle('is-selected', Boolean(mix?.changed));
    reset.disabled = !mix?.changed;
    for (const channel of channels) {
      const entry = rows.get(channel.id);
      entry.row.classList.toggle('is-muted', channel.effectiveMuted);
      entry.control.setAttribute('aria-pressed', String(channel.muted));
      entry.control.classList.toggle('is-selected', channel.muted);
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
    if (!panel.hidden && (structureChanged || captionChanged)) position();
  }
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) position();
    button.blur();
  });
  reset.addEventListener('pointerdown', event => event.preventDefault());
  reset.addEventListener('click', () => {preview.resetMix(); reset.blur();});
  const outside = event => {if (!panel.contains(event.target) && !button.contains(event.target)) close();};
  const escape = event => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      close();
      button.focus();
    }
  };
  const scroll = () => {if (!panel.hidden) close();};
  const navigationKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  const keys = event => {
    if (event.key === 'Escape') {escape(event); event.stopPropagation();}
    // Keep performance letters available with a focused volume slider. Native
    // slider navigation and button activation must not reach page shortcuts.
    else if (event.key === ' ' || event.key === 'Enter' ||
      event.target.matches?.('input[type="range"]') && navigationKeys.has(event.key)) event.stopPropagation();
  };
  panel.addEventListener('keydown', keys);
  button.addEventListener('keydown', keys);
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  window.addEventListener('resize', scroll);
  window.addEventListener('scroll', scroll);
  return {update, close, dispose() {
    close();
    panel.removeEventListener('keydown', keys);
    button.removeEventListener('keydown', keys);
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', escape);
    window.removeEventListener('resize', scroll);
    window.removeEventListener('scroll', scroll);
  }};
}
