// Request-based SNES note-ish views over a captured SPC performance. This module
// does not execute, modify or export audio. Display positions use VGM's 44,100-Hz
// ticks; captured event clocks remain 1,024,000-Hz SPC clocks in state histories.
const CLOCK_RATE = 1024000, DISPLAY_RATE = 44100;
const PROVISIONAL_HZ = 440 * 2 ** ((60 - 69) / 12);
const EVENT_TYPES = new Set(['noteOn','noteOff','pitch','volume','instrument','dsp']);
const signed = value => value << 24 >> 24;
const integer = (value,min,max) => Number.isSafeInteger(value) && value >= min && value <= max;

function validate(performance, references) {
  if (performance?.version !== 1 || performance.clockRate !== CLOCK_RATE
    || !integer(performance.durationClocks,102400,600 * CLOCK_RATE)
    || !(performance.initialDsp instanceof Uint8Array) || performance.initialDsp.length !== 128
    || !Array.isArray(performance.events) || performance.events.length > 20000
    || !Array.isArray(performance.samples) || performance.samples.length > 256
    || !Array.isArray(performance.warnings)) throw new TypeError('Invalid readable SPC performance');
  let bytes = 0, previous = 0;
  for (const [id,sample] of performance.samples.entries()) {
    if (sample.id !== id || !(sample.brr instanceof Uint8Array) || !sample.brr.length || sample.brr.length % 9
      || !integer(sample.sourceNumber,0,255)
      || (sample.loop && (!integer(sample.loopStartSamples,0,sample.brr.length / 9 * 16 - 1)
        || sample.loopStartSamples % 16))) throw new TypeError('Invalid readable SPC BRR asset');
    bytes += sample.brr.length;
  }
  if (bytes > 64512) throw new RangeError('Readable SPC assets exceed SNES sample RAM');
  for (const event of performance.events) {
    if (!integer(event.clock,previous,performance.durationClocks) || !EVENT_TYPES.has(event.type)
      || (event.type !== 'dsp' && !integer(event.channel,0,7))
      || (event.sampleId !== undefined && (!integer(event.sampleId,0,255) || !performance.samples[event.sampleId]))) {
      throw new TypeError('Invalid readable SPC event');
    }
    previous = event.clock;
    if (event.type === 'dsp') {
      if (!integer(event.register,0,127) || !integer(event.value,0,255)) throw new TypeError('Invalid SPC DSP event');
    } else if (event.type === 'noteOn' || event.type === 'pitch') {
      if (!integer(event.pitch,0,16383)) throw new TypeError('Invalid SPC PITCH');
    }
    if (event.type === 'noteOn' || event.type === 'instrument') {
      const preset = event.type === 'noteOn' ? event.preset : event;
      if (!preset || !['adsr1','adsr2','gain'].every(key => integer(preset[key],0,255))
        || !integer(event.sourceNumber,0,255)
        || (event.type === 'noteOn' && (!integer(preset.volumeLeft,-128,127) || !integer(preset.volumeRight,-128,127)
          || (!event.keyOffHeld && event.sampleId === undefined)))) throw new TypeError('Invalid SPC voice event');
    }
    if (event.type === 'volume' && (!integer(event.volumeLeft,-128,127) || !integer(event.volumeRight,-128,127))) {
      throw new TypeError('Invalid SPC volume event');
    }
  }
  if (!Array.isArray(references) || references.length > performance.samples.length) throw new TypeError('Expected at most one SNES pitch reference per BRR version');
  const chosen = new Map();
  for (const reference of references) {
    if (!reference || !integer(reference.sampleId,0,255) || !performance.samples[reference.sampleId]
      || !Number.isFinite(reference.referenceHz) || reference.referenceHz <= 0
      || !['estimated','manual'].includes(reference.kind)
      || (reference.confidence !== undefined && !['high','low','none'].includes(reference.confidence))) throw new TypeError('Invalid SNES pitch reference');
    if (chosen.has(reference.sampleId)) throw new TypeError('Duplicate SNES pitch reference');
    chosen.set(reference.sampleId,reference);
  }
  return chosen;
}

/** Convert an already captured performance to cloneable note intervals and state
 * histories. References declare each BRR version's fundamental at native 32 kHz
 * / PITCH 4096; missing references explicitly use provisional C4. Callers decide
 * which estimates are reliable enough to select. No EG, release, BRR-END or
 * modulation simulation is attempted. keyOn is a request/enabling approximation.
 */
export function buildSnesNoteAnalysis(performance, {references = []} = {}) {
  const chosen = validate(performance,references), warnings = new Map();
  const warn = text => {const key = String(text); warnings.set(key,{count:(warnings.get(key)?.count ?? 0) + 1});};
  for (const warning of performance.warnings) warn(warning);
  warn('SNES note-ish shows key requests and base pitch, not guaranteed audible notes. Envelope progression, BRR END, release tails, echo, interpolation and aliasing are not reconstructed.');
  warn('BRR has no musical root metadata. Estimated fundamentals may have octave errors; provisional C4 is an assigned reference, not an original note.');
  if (performance.controlStepMs > 0) warn(`Controls are sampled at ${performance.controlStepMs} ms; key-on/off timing is retained.`);
  const samples = performance.samples.map(sample => {
    const reference = chosen.get(sample.id);
    return {id:sample.id,sourceNumber:sample.sourceNumber,byteLength:sample.brr.length,
      loop:!!sample.loop,loopStartSamples:sample.loopStartSamples ?? null,
      referenceHz:reference?.referenceHz ?? PROVISIONAL_HZ,referenceKind:reference?.kind ?? 'provisional',
      confidence:reference?.confidence ?? 'none'};
  });
  const dsp = performance.initialDsp;
  let masterLeft = signed(dsp[0x0c]), masterRight = signed(dsp[0x1c]);
  let noiseMask = dsp[0x3d], modulationMask = dsp[0x2d], flags = dsp[0x6c];
  const voices = Array.from({length:8},(_,channel) => {
    const base = channel << 4;
    return {channel,sourceNumber:dsp[base + 4],sampleId:null,pitch:dsp[base + 2] | (dsp[base + 3] & 63) << 8,
      adsr1:dsp[base + 5],adsr2:dsp[base + 6],gain:dsp[base + 7],
      volumeLeft:signed(dsp[base]),volumeRight:signed(dsp[base + 1]),held:false,trigger:0,inferred:false};
  });
  const channels = voices.map((voice,index) => ({name:`SNES Voice ${index + 1}`,notes:[],active:null,states:[]}));
  const displayTime = clock => clock * DISPLAY_RATE / CLOCK_RATE;

  function describe(voice) {
    const {channel,pitch,sampleId} = voice, sample = samples[sampleId];
    const noise = !!(noiseMask & (1 << channel));
    const pitchModulation = channel > 0 && !!(modulationMask & (1 << channel));
    const stereoEnabled = (voice.volumeLeft !== 0 && masterLeft !== 0) || (voice.volumeRight !== 0 && masterRight !== 0);
    const silentGain = !(voice.adsr1 & 0x80) && !(voice.gain & 0x80) && voice.gain === 0;
    let reason = flags & 0x80 ? 'reset' : !voice.held ? 'key-off' : flags & 0x40 ? 'muted'
      : !stereoEnabled ? 'zero-volume' : silentGain ? 'zero-gain' : noise ? 'noise'
      : sampleId === null ? 'unassigned-sample' : pitch === 0 ? 'zero-pitch' : null;
    let keyOn = voice.held && !(flags & 0xc0) && stereoEnabled && !silentGain;
    let midi = null, frequencyHz = null;
    if (keyOn && !noise) {
      if (sample && pitch > 0) {
        const candidate = 69 + 12 * Math.log2(sample.referenceHz / 440) + 12 * Math.log2(pitch / 4096);
        if (Number.isFinite(candidate) && Math.round(candidate) >= 0 && Math.round(candidate) <= 127) {
          midi = candidate; frequencyHz = sample.referenceHz * pitch / 4096;
          reason = pitchModulation ? 'pitch-modulation-base' : sample.referenceKind === 'provisional' ? 'provisional-reference' : null;
        } else {keyOn = false; reason = 'outside-midi-range';}
      } else keyOn = false;
    }
    return {name:`SNES Voice ${channel + 1}`,channel,type:noise ? 'Noise' : 'BRR',midi,keyOn,
      held:voice.held,trigger:voice.trigger,key:voice.trigger,pitch,freq:pitch,frequencyHz,hz:frequencyHz,
      sourceNumber:voice.sourceNumber,sampleId,referenceHz:sample?.referenceHz ?? null,
      referenceKind:sample?.referenceKind ?? null,confidence:sample?.confidence ?? 'none',
      noise,pitchModulation,inferred:voice.inferred,reason,
      volumeLeft:voice.volumeLeft,volumeRight:voice.volumeRight,available:true};
  }

  function close(channel,clock,endReason) {
    if (channel.active && displayTime(clock) > channel.active.start) channel.notes.push({...channel.active,end:displayTime(clock),endReason});
    channel.active = null;
  }
  function sync(index,clock,reason) {
    const channel = channels[index], descriptor = describe(voices[index]), active = channel.active;
    const identity = ['midi','key','sampleId','sourceNumber','pitch','referenceKind','referenceHz','inferred','pitchModulation'];
    if (active && (!descriptor.keyOn || !Number.isFinite(descriptor.midi)
      || identity.some(key => active[key] !== descriptor[key]))) close(channel,clock,reason);
    if (!channel.active && descriptor.keyOn && Number.isFinite(descriptor.midi)) {
      channel.active = {start:displayTime(clock),...Object.fromEntries(identity.map(key => [key,descriptor[key]])),
        frequencyHz:descriptor.frequencyHz,freshOnset:reason === 'noteOn'};
    }
    const previous = channel.states.at(-1);
    if (!previous || Object.keys(descriptor).some(key => previous[key] !== descriptor[key])) channel.states.push({clock,...descriptor});
  }
  const syncAll = (clock,reason) => {for (let index = 0; index < 8; index++) sync(index,clock,reason);};
  syncAll(0,'initial');
  for (const event of performance.events) {
    if (event.type === 'dsp') {
      if (event.register === 0x0c) masterLeft = signed(event.value);
      else if (event.register === 0x1c) masterRight = signed(event.value);
      else if (event.register === 0x3d) noiseMask = event.value;
      else if (event.register === 0x2d) modulationMask = event.value;
      else if (event.register === 0x6c) {
        flags = event.value;
        if (flags & 0x80) for (const voice of voices) voice.held = false;
      } else continue;
      syncAll(event.clock,'global'); continue;
    }
    const voice = voices[event.channel];
    if (event.type === 'noteOn') {
      const preset = event.preset;
      for (const key of ['adsr1','adsr2','gain','volumeLeft','volumeRight']) voice[key] = preset[key];
      if (voice.sourceNumber !== event.sourceNumber && event.sampleId === undefined) voice.sampleId = null;
      voice.sourceNumber = event.sourceNumber; voice.pitch = event.pitch;
      if (event.sampleId !== undefined) voice.sampleId = event.sampleId;
      voice.held = !event.keyOffHeld && !(flags & 0x80);
      if (voice.held) {voice.trigger++; voice.inferred = !!event.inferred;}
      if (event.inferred) warn('Initially active voices are inferred from the SPC snapshot; their original note-on times and envelope phases are unknown.');
    } else if (event.type === 'noteOff') voice.held = false;
    else if (event.type === 'pitch') voice.pitch = event.pitch;
    else if (event.type === 'volume') {voice.volumeLeft = event.volumeLeft; voice.volumeRight = event.volumeRight;}
    else if (event.type === 'instrument') {
      if (voice.sourceNumber !== event.sourceNumber && event.sampleId === undefined) voice.sampleId = null;
      voice.sourceNumber = event.sourceNumber;
      for (const key of ['adsr1','adsr2','gain']) voice[key] = event[key];
      if (event.sampleId !== undefined) voice.sampleId = event.sampleId;
    }
    sync(event.channel,event.clock,event.type);
  }
  for (const channel of channels) close(channel,performance.durationClocks,'end');
  return {version:1,clockRate:CLOCK_RATE,displayRate:DISPLAY_RATE,durationClocks:performance.durationClocks,
    durationSeconds:performance.durationClocks / CLOCK_RATE,time:displayTime(performance.durationClocks),channels,samples,warnings};
}

/** Return independent current-state descriptors at elapsed playback seconds.
 * At/after the captured endpoint the state is unavailable, rather than a claim
 * that the original song is silent. No extrapolation or playback mutation occurs.
 */
export function describeSnesAt(analysis, seconds) {
  if (!Number.isFinite(seconds)) throw new RangeError('SNES note-ish position must be finite seconds');
  if (!analysis || analysis.clockRate !== CLOCK_RATE || !Array.isArray(analysis.channels) || analysis.channels.length !== 8) throw new TypeError('Expected SNES note analysis');
  const clock = Math.max(0,seconds) * CLOCK_RATE;
  return analysis.channels.map(channel => {
    const states = channel.states;
    let low = 0, high = states.length;
    while (low < high) {const middle = Math.floor((low + high) / 2); if (states[middle].clock <= clock) low = middle + 1; else high = middle;}
    const state = states[Math.max(0,low - 1)], {clock:ignored,...descriptor} = state;
    return clock >= analysis.durationClocks ? {...descriptor,keyOn:false,held:false,midi:null,frequencyHz:null,hz:null,available:false,reason:'outside-analysis'} : {...descriptor};
  });
}
