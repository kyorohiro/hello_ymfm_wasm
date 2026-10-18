// Source generation for editable SPC re-performance; emulation stays in Worker.
const json = value => JSON.stringify(value, null, 2) + '\n';
const quote = value => JSON.stringify(value);
const hex = value => `0x${value.toString(16).padStart(2,'0')}`;
const number = value => Number(value.toFixed(9)).toString();
const GLOBAL_LABELS = new Map([[0x0c,'Master volume L'],[0x1c,'Master volume R'],
  [0x2d,'Pitch modulation mask'],[0x3d,'Noise mask'],[0x6c,'Noise clock / flags; echo disabled']]);
const PRESET_KEYS = ['adsr1','adsr2','gain','volumeLeft','volumeRight'];

function validate(performance) {
  if (performance?.version !== 1 || performance.clockRate !== 1024000
    || !Number.isSafeInteger(performance.durationClocks) || performance.durationClocks < 102400
    || performance.durationClocks > 600 * 1024000 || !(performance.initialDsp instanceof Uint8Array)
    || performance.initialDsp.length !== 128 || !Array.isArray(performance.events)
    || performance.events.length > 20000 || !Array.isArray(performance.samples)
    || performance.samples.length > 256 || !Array.isArray(performance.warnings)) throw new TypeError('Invalid readable SPC performance');
  let previous = 0, total = 0;
  for (const [id,sample] of performance.samples.entries()) {
    if (sample.id !== id || !(sample.brr instanceof Uint8Array) || !sample.brr.length
      || sample.brr.length % 9 || (sample.loop && (!Number.isInteger(sample.loopStartSamples)
        || sample.loopStartSamples < 0 || sample.loopStartSamples % 16
        || sample.loopStartSamples >= sample.brr.length / 9 * 16))) throw new TypeError('Invalid readable SPC BRR asset');
    total += sample.brr.length;
  }
  if (total > 64512) throw new RangeError('Readable SPC assets exceed SNES sample RAM');
  for (const event of performance.events) {
    if (!Number.isSafeInteger(event.clock) || event.clock < previous || event.clock > performance.durationClocks
      || !['noteOn','noteOff','pitch','volume','instrument','dsp'].includes(event.type)
      || (event.type !== 'dsp' && (!Number.isInteger(event.channel) || event.channel < 0 || event.channel > 7))
      || (event.sampleId !== undefined && !performance.samples[event.sampleId])) throw new TypeError('Invalid readable SPC event');
    previous = event.clock;
  }
}

/** Return source and assets without changing Virtual Files. A single physical
 * eight-voice SNES instance keeps channel overlap; all samples are loaded first.
 * This is an editable approximation, not an exact SPC/DSP timeline export.
 */
export function buildSpcSongSource(performance, directory) {
  validate(performance);
  const files = [], presets = [], presetNames = new Map();
  function getPreset(event) {
    const values = Object.fromEntries(PRESET_KEYS.map(key => [key,event.preset[key]]));
    const key = JSON.stringify(values);
    if (presetNames.has(key)) return presetNames.get(key);
    const id = presets.length; presets.push(values); presetNames.set(key,id); return id;
  }
  for (const event of performance.events) if (event.type === 'noteOn' && !event.keyOffHeld) getPreset(event);
  const lines = [
    '// Editable SPC song: approximate re-performance, not identical SPC playback.',
    '// One SNES instance, physical voices 0..7. Times are elapsed seconds, independent of BPM.',
    '// PITCH 4096 plays at the BRR source rate (32,000 Hz); note names cannot be inferred.',
    '// C4 below is your assigned reference note, not a detected musical root.',
    '// ADSR1/ADSR2/GAIN and signed volumes are raw DSP values, not durations.',
    `// Controls keep the last value per ${performance.controlStepMs} ms interval (0 = every distinct value). Key times are retained.`,
    ...performance.warnings.map(warning => `// ${String(warning).replace(/[\r\n]/g,' ')}`),
    'const snes = await createSoundChip(\'snes\');',
    'try {',
  ];
  for (const sample of performance.samples) {
    const label = `sample-${String(sample.id).padStart(3,'0')}-srcn-${String(sample.sourceNumber).padStart(3,'0')}`;
    files.push({path:`${directory}/samples/${label}.brr`,type:'binary',data:sample.brr.slice()});
    const {brr,...metadata} = sample;
    files.push({path:`${directory}/samples/${label}.metadata.json`,type:'text',data:json({
      ...metadata,assignedReferenceNote:'C4',assignedBasePitch:4096,
      tuning:'Assigned reference only; no original note or fundamental is inferred.'})});
    lines.push(`  const sample${sample.id} = await snes.loadBRR(await file(${quote(`./samples/${label}.brr`)}, {type:'arrayBuffer'}), {`,
      `    rootNote: 'C4', basePitch: 4096${sample.loop ? `, loopStartSamples: ${sample.loopStartSamples}` : ''}`, '  });');
  }
  for (const [id,preset] of presets.entries()) {
    const path = `./presets/voice-${String(id).padStart(3,'0')}.json`;
    files.push({path:`${directory}/${path.slice(2)}`,type:'text',data:json(preset)});
    lines.push("  /** @type {Omit<PlaygroundSnesChannelState, 'sample'>} */",
      `  const preset${id} = await file(${quote(path)}, {type:'json'});`);
  }
  for (const [register,label] of GLOBAL_LABELS) {
    const value = register === 0x6c ? performance.initialDsp[register] | 0x20 : performance.initialDsp[register];
    lines.push(`  snes.writeDsp(${hex(register)}, ${hex(value)}); // ${label}`);
  }
  let clock = 0;
  for (const event of performance.events) {
    if (event.clock > clock) lines.push(`  await sleep(${number((event.clock - clock) / performance.clockRate)});`);
    clock = event.clock;
    const channel = event.channel;
    if (event.type === 'noteOn') {
      if (event.keyOffHeld) {
        lines.push(`  // Voice ${channel + 1}: KON while KOFF is held; no sustained note is started.`); continue;
      }
      lines.push(`  // ${number(clock / performance.clockRate)} s · Voice ${channel + 1} · SRCN ${event.sourceNumber}${event.inferred ? ' · inferred initial note (envelope restarts)' : ''}`,
        `  snes.setPreset(${channel}, {...preset${getPreset(event)}, sample: sample${event.sampleId}});`,
        `  snes.setPitch(${channel}, ${event.pitch});`, `  snes.keyOn(${channel});`);
    } else if (event.type === 'noteOff') lines.push(`  snes.keyOff(${channel});`);
    else if (event.type === 'pitch') lines.push(`  snes.setPitch(${channel}, ${event.pitch});`);
    else if (event.type === 'volume') lines.push(`  snes.setChannel(${channel}, {volumeLeft: ${event.volumeLeft}, volumeRight: ${event.volumeRight}});`);
    else if (event.type === 'instrument') lines.push(`  snes.setChannel(${channel}, {adsr1: ${event.adsr1}, adsr2: ${event.adsr2}, gain: ${event.gain}${event.sampleId !== undefined ? `, sample: sample${event.sampleId}` : ''}});`);
    else if (GLOBAL_LABELS.has(event.register)) lines.push(`  snes.writeDsp(${hex(event.register)}, ${hex(event.register === 0x6c ? event.value | 0x20 : event.value)}); // ${GLOBAL_LABELS.get(event.register)}`);
  }
  if (clock < performance.durationClocks) lines.push(`  await sleep(${number((performance.durationClocks - clock) / performance.clockRate)});`);
  lines.push('  snes.allNotesOff();', '} finally {', '  snes.dispose();', '}', '');
  return {files,source:lines.join('\n'),conversion:{kind:'readable',version:1,
    clockRate:performance.clockRate,durationClocks:performance.durationClocks,
    durationSeconds:performance.durationClocks / performance.clockRate,nativeSampleRate:32000,
    ...performance.statistics,eventCount:performance.events.length,controlStepMs:performance.controlStepMs,
    warnings:[...performance.warnings]}};
}
