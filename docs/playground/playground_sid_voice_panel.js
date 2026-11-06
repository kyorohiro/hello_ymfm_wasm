const numberText = (value, digits = 0) => Number.isFinite(value)
  ? Number(value.toFixed(digits)).toLocaleString('en-US', {maximumFractionDigits:digits}) : '—';
const hex = (value, width = 2) => Number.isInteger(value)
  ? value.toString(16).toUpperCase().padStart(width, '0') : '—';

/** Read-only view of applied SID state. Opening it never writes to the chip. */
export function createPlaygroundSidVoicePanel({root} = {}) {
  const doc = root.ownerDocument ?? globalThis.document;
  let connected = false, disposed = false;
  const make = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const section = title => {
    const node = make('section', 'chip-section');
    node.appendChild(make('h3', '', title)); root.appendChild(node); return node;
  };
  const output = (parent, label, name) => {
    const field = make('div', 'chip-field');
    field.appendChild(make('span', 'chip-field-label', label));
    const value = make('output', '', '—'); value.dataset.chipOutput = `sid-${name}`;
    field.appendChild(value); parent.appendChild(field); return value;
  };
  const fields = parent => {
    const node = make('div', 'chip-fields'); parent.appendChild(node); return node;
  };
  const status = make('p', 'subtext', 'Waiting for an applied SID state.');
  status.dataset.chipOutput = 'sid-status'; status.setAttribute('role', 'status'); root.appendChild(status);
  root.appendChild(make('p', 'subtext', 'SID 6581 approximation · Web Audio prototype. Edit voices and the shared filter in Code. This inspector has no audition or keyboard controls.'));
  const voices = Array.from({length:3}, (_, index) => {
    const node = section(`Voice ${index + 1} · channel ${index}`), values = fields(node);
    node.dataset.sidVoice = String(index);
    return {
      node,
      gate:output(values, 'Gate / test', `${index}-gate`),
      waveform:output(values, 'Waveform', `${index}-waveform`),
      frequency:output(values, 'Frequency / register', `${index}-frequency`),
      pulse:output(values, 'Pulse width (0–4095)', `${index}-pulse`),
      adsr:output(values, 'ADSR codes (0–15)', `${index}-adsr`),
      modulation:output(values, `Sync / ring · from voice ${index === 0 ? 3 : index}`, `${index}-modulation`),
      envelope:output(values, 'Applied envelope (0–255)', `${index}-envelope`),
    };
  });
  const shared = section('One shared SID filter'), sharedFields = fields(shared);
  const filter = {
    mode:output(sharedFields, 'Mode', 'filter-mode'),
    cutoff:output(sharedFields, 'Cutoff code (0–2047)', 'filter-cutoff'),
    resonance:output(sharedFields, 'Resonance (0–15)', 'filter-resonance'),
    routing:output(sharedFields, 'Filter input voices', 'filter-routing'),
    volume:output(sharedFields, 'Hardware volume (0–15)', 'filter-volume'),
    voice3off:output(sharedFields, 'Voice 3 direct output', 'filter-voice3off'),
  };
  shared.appendChild(make('p', 'subtext', 'Low-pass keeps lower frequencies; high-pass keeps higher frequencies; band-pass keeps a middle band. Notch combines low-pass and high-pass. Cutoff is a hardware code, not Hz. All routed voices share the same cutoff and resonance. With mode Off, routed voices have no filter output; routing 0 keeps all voices dry.'));
  const registers = make('details', 'chip-advanced');
  registers.appendChild(make('summary', '', 'Authored register shadow · 32 bytes'));
  registers.appendChild(make('p', 'subtext', 'These are the last applied write-side settings. Most SID read addresses do not return these values; this is not hardware register readback. Raw writes may select no waveform or combined waveforms.'));
  const bytes = make('pre', 'chip-memory-ranges', '—'); bytes.dataset.chipOutput = 'sid-registers'; registers.appendChild(bytes);
  root.appendChild(registers);

  function update(state) {
    if (disposed || !state) return;
    status.textContent = `${state.model ?? '6581'} approximation · ${numberText(state.clock)} Hz · ${state.initialized ? 'initialized' : 'not initialized'}${connected ? '' : ' · disconnected'}`;
    voices.forEach((view, index) => {
      const voice = state.channels?.[index] ?? {};
      view.node.dataset.sounding = String(Boolean(voice.gate && !voice.test));
      view.gate.textContent = `${voice.gate ? 'On' : 'Off'} / ${voice.test ? 'Test on (oscillator reset)' : 'Test off'}`;
      view.waveform.textContent = voice.waveform === 'combined'
        ? `Combined: ${(voice.waveforms ?? []).join(' + ') || `bits 0x${hex(voice.waveformBits, 1)}`}`
        : voice.waveform ?? '—';
      view.frequency.textContent = `${numberText(voice.frequency, 3)} Hz / 0x${hex(voice.frequencyRegister, 4)}`;
      view.pulse.textContent = numberText(voice.pulseWidth);
      view.adsr.textContent = [voice.attack,voice.decay,voice.sustain,voice.release].map(value => numberText(value)).join(' / ');
      view.modulation.textContent = `${voice.sync ? 'Sync on' : 'Sync off'} / ${voice.ring ? 'Ring on' : 'Ring off'}`;
      view.envelope.textContent = numberText(voice.envelope);
    });
    const current = state.filter ?? {};
    filter.mode.textContent = current.mode === 'combined' ? `Combined · mode bits 0x${hex(current.modeBits, 1)}` : current.mode ?? '—';
    filter.cutoff.textContent = numberText(current.cutoff);
    filter.resonance.textContent = numberText(current.resonance);
    const routed = [0,1,2].filter(index => (current.routing ?? 0) & (1 << index)).map(index => index + 1);
    filter.routing.textContent = `${routed.length ? routed.join(', ') : 'None'} · mask ${numberText(current.routing)}`;
    filter.volume.textContent = numberText(current.volume);
    filter.voice3off.textContent = current.voice3off ? 'Off · oscillator still runs; filtered path remains available' : 'On';
    const raw = Array.from(state.registers ?? []).slice(0,32);
    bytes.textContent = Array.from({length:Math.ceil(raw.length / 8)}, (_, row) =>
      `$${hex(row * 8)}: ${raw.slice(row * 8, row * 8 + 8).map(value => hex(value)).join(' ')}`).join('\n') || '—';
  }
  return {
    update,
    setConnected(value) {if (!disposed) connected = Boolean(value);},
    getSelectedChannel:() => 0,
    getAuditionAvailability:() => false,
    setVisible() {}, releaseAll() {}, setKeyboardActive() {},
    dispose() {disposed = true; connected = false;},
  };
}
