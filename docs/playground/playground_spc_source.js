import {parseSpcFile} from '../js/spc_file.js';
import {exportBrrSample} from '../js/snes_brr.js';
import {noteToHz} from '../js/soundchip_pitch.js';
import {scanSpcBrrCandidates} from '../vgm_analyzer/spc_brr_candidates.js';

const MAX_INSTRUMENT_BYTES = 65536 - 0x400;
const DEFAULT_VOICE = {adsr1:0x8f, adsr2:0xe0, gain:127, volumeLeft:90, volumeRight:90, pitch:4096};
const json = value => JSON.stringify(value, null, 2) + '\n';
const quote = value => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function stem(name) {
  const value = String(name ?? 'spc').replace(/\.spc$/i, '')
    .replace(/[\\/\x00-\x1f\x7f:*?"<>|]/g, '_').replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 100) || 'spc';
  return ['.git', '.tet.ss', 'sys'].includes(value) ? `_${value}` : value;
}

function safeDirectory(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value === '/' || /[\\\x00-\x1f\x7f:]/.test(value)) {
    throw new TypeError('SPC import directory must be an absolute Virtual Files folder path');
  }
  const parts = value.split('/').slice(1);
  if (parts.some(part => !part || part === '.' || part === '..' || ['.git', '.tet.ss', 'sys'].includes(part))) {
    throw new TypeError('SPC import directory contains an unsafe or reserved path');
  }
  return value;
}

/** Allocate a new folder without replacing an existing imported project.
 * existingPaths contains file paths, including files inside existing folders.
 * directoryPaths additionally reserves empty folders without treating ancestors
 * such as /spc as files that would block the ordinary /spc/<name> destination.
 */
export function allocateSpcImportDirectory(name, existingPaths = [], directoryPaths = []) {
  const paths = new Set(existingPaths);
  const directories = new Set(directoryPaths);
  let root = '/spc', rootSuffix = 2;
  while (paths.has(root)) root = `/spc-${rootSuffix++}`;
  const base = `${root}/${stem(name)}`;
  let directory = base, suffix = 2;
  const occupied = candidate => [...paths, ...directories].some(path => path === candidate || path.startsWith(`${candidate}/`));
  while (occupied(directory)) directory = `${base}-${suffix++}`;
  return safeDirectory(directory);
}

function importReason(sample) {
  if (sample.brr.byteLength > MAX_INSTRUMENT_BYTES) {
    return `This BRR needs ${sample.brr.byteLength} bytes; a fresh SNES instrument has ${MAX_INSTRUMENT_BYTES} bytes after its sample directory. Use Song playback for this SPC.`;
  }
  if (sample.loop && !sample.loopResolved) {
    return 'The BRR loop points outside the extracted blocks or between block boundaries. Use Song playback; this loop cannot be relocated safely into an instrument.';
  }
  return null;
}

/** Read one SPC snapshot and enumerate its current RAM samples. No emulation,
 * audio initialization, network access or source-code execution occurs here.
 * Scan bounds/progress/cancellation are the same as the Analyzer scanner.
 */
export async function prepareSpcImport(bytes, name = 'original.spc', scanOptions = {}) {
  const spc = parseSpcFile(bytes);
  const scan = await scanSpcBrrCandidates({ram:spc.ram, dsp:spc.dsp, nativeFrames:0}, scanOptions);
  const candidates = scan.samples.map(sample => {
    const reason = importReason(sample);
    return {...sample, id:`srcn-${sample.sourceNumber}`, importable:reason === null, importReason:reason};
  });
  return {name:String(name), spc, metadata:spc.metadata, candidates, scan,
    warnings:[...spc.warnings, ...scan.warnings]};
}

function findSelection(prepared, selection) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new TypeError('Expected a selected BRR candidate');
  const {candidateId, sourceNumber, voiceIndex, referenceNote = 'C4'} = selection;
  if (candidateId === undefined && sourceNumber === undefined) throw new TypeError('Select a candidateId or sourceNumber');
  if (sourceNumber !== undefined && (!Number.isInteger(sourceNumber) || sourceNumber < 0 || sourceNumber > 255)) throw new RangeError('sourceNumber must be an integer from 0 to 255');
  const candidate = prepared.candidates.find(value => (candidateId === undefined || value.id === candidateId)
    && (sourceNumber === undefined || value.sourceNumbers.includes(sourceNumber)));
  if (!candidate) throw new RangeError('Selected BRR candidate does not exist in this SPC snapshot');
  const reason = importReason(candidate);
  if (reason) throw new RangeError(reason);
  let voice;
  if (voiceIndex !== undefined && voiceIndex !== null) {
    if (!Number.isInteger(voiceIndex) || voiceIndex < 0 || voiceIndex > 7) throw new RangeError('voiceIndex must be an integer from 0 to 7');
    voice = candidate.voices.find(value => value.index === voiceIndex);
    if (!voice) throw new RangeError('The selected Voice does not reference this BRR candidate');
  } else if (voiceIndex === undefined) {
    voice = candidate.voices[0];
  }
  // Explicitly assigned tuning, never an inferred sample fundamental.
  noteToHz(referenceNote);
  const preset = Object.fromEntries(Object.keys(DEFAULT_VOICE).map(key => [key, voice?.[key] ?? DEFAULT_VOICE[key]]));
  const basePitch = preset.pitch > 0 ? preset.pitch : 4096;
  const label = `srcn-${String(candidate.sourceNumber).padStart(3, '0')}${voice ? `-voice-${voice.index + 1}` : '-raw'}`;
  return {candidate, voice, referenceNote, preset, basePitch, label};
}

function songSource() {
  return `// SPC song playback: runs the original SPC700 program and S-DSP state.
// This is an SPC player, not a conversion of the song into JavaScript notes.
// Playback continues after this script finishes. Use toolbar STOP to stop it.
const spc = await useSoundChip('spc');
await spc.loadSPC(await file('./original.spc', {type:'arrayBuffer'}));
await spc.play();
`;
}

const DSP_LABELS = new Map([[0x0c,'Master volume L'],[0x1c,'Master volume R'],[0x2c,'Echo volume L'],
  [0x3c,'Echo volume R'],[0x4c,'Key on mask'],[0x5c,'Key off mask'],[0x6c,'Flags / noise clock'],
  [0x7c,'End flags'],[0x0d,'Echo feedback'],[0x2d,'Pitch modulation mask'],[0x3d,'Noise mask'],
  [0x4d,'Echo mask'],[0x5d,'Sample directory'],[0x6d,'Echo address'],[0x7d,'Echo delay']]);
const VOICE_LABELS = ['Volume L','Volume R','Pitch low','Pitch high','Sample number','ADSR1','ADSR2','GAIN','ENVX','OUTX'];
const hex = (value, width = 2) => `0x${value.toString(16).padStart(width, '0')}`;
function dspLabel(register) {
  if (DSP_LABELS.has(register)) return DSP_LABELS.get(register);
  if ((register & 15) < VOICE_LABELS.length) return `Voice ${(register >> 4) + 1} ${VOICE_LABELS[register & 15]}`;
  return (register & 15) === 15 ? `Echo FIR ${(register >> 4)}` : 'DSP';
}

function validateTrace(trace) {
  if (trace?.version !== 1 || trace.clockRate !== 1024000 || !Number.isSafeInteger(trace.durationClocks)
    || trace.durationClocks < 102400 || trace.durationClocks > 600 * 1024000 || trace.durationClocks % 32
    || !(trace.initialState?.ram instanceof Uint8Array) || trace.initialState.ram.length !== 65536
    || !(trace.initialState.dsp instanceof Uint8Array) || trace.initialState.dsp.length !== 128
    || trace.initialState.outputDelayFrames !== 4 || !(trace.events instanceof Uint32Array)
    || trace.events.length % 4 || trace.events.length > 4_000_000) throw new TypeError('Invalid SPC conversion trace');
  let previous = 0;
  for (let i = 0; i < trace.events.length; i += 4) {
    const clock = trace.events[i], kind = trace.events[i + 1], address = trace.events[i + 2], value = trace.events[i + 3];
    if (clock < previous || clock > trace.durationClocks || kind > 1 || address > (kind ? 65535 : 127) || value > 255) {
      throw new RangeError('Invalid SPC conversion event');
    }
    previous = clock;
  }
}

function javascriptSource(trace) {
  const lines = [
    '// Recorded SPC song: edit the timed DSP and RAM writes below.',
    '// Each row: clock, kind (0 = DSP register, 1 = RAM byte), address, value.',
    '// 1,024,000 clocks/second, 32 clocks/native sample. This clock is independent of BPM.',
    '// Clock positions preserve the original DSP execution order, including sub-sample writes.',
    '// BRR/directory changes, echo, noise and pitch modulation are retained.',
    '// This is a finite captured interval; original note names and loops are not inferred.',
    '// Initial RAM includes the original BRR samples. Original SPC is kept for reference.',
    'const snes = await createSoundChip(\'snes\');', 'try {',
    '  const events = new Uint32Array([',
  ];
  for (let i = 0; i < trace.events.length; i += 4) {
    const clock = trace.events[i], kind = trace.events[i + 1], address = trace.events[i + 2], value = trace.events[i + 3];
    lines.push(`    ${clock}, ${kind}, ${hex(address, kind ? 4 : 2)}, ${hex(value)},${kind ? '' : ` // ${dspLabel(address)}`}`);
  }
  lines.push('  ]);', '  await snes.prepareTimeline({', '    version: 1,', '    clockRate: 1024000,',
    `    durationClocks: ${trace.durationClocks}, // ${(trace.durationClocks / 1024000).toFixed(6)} seconds`,
    '    initialState: {',
    '      ram: new Uint8Array(await file(\'./initial.ram.bin\', {type:\'arrayBuffer\'})),',
    '      dsp: new Uint8Array(await file(\'./initial.dsp.bin\', {type:\'arrayBuffer\'})),',
    `      outputDelayFrames: ${trace.initialState.outputDelayFrames},`, '    },', '    events,', '  });',
    '  await snes.playTimeline(); // Waits for the captured interval to finish; toolbar STOP cancels.',
    '} finally {', '  snes.dispose();', '}', '');
  return lines.join('\n');
}

function instrumentSource({candidate, voice, referenceNote, basePitch, label}) {
  const loop = candidate.loop ? `,\n    loopStartSamples: ${candidate.loopStartSamples}` : '';
  return `// BRR instrument from SRCN ${candidate.sourceNumbers.join(', ')}${voice ? `, captured Voice ${voice.index + 1}` : ', no captured Voice settings'}.
// The reference note below is assigned by you; BRR does not contain a root note.
// basePitch maps that assigned note to ${basePitch} in the hardware PITCH register.
// The initial demo restores the captured PITCH exactly, including a silent 0.
// ADSR1/ADSR2/GAIN are raw S-DSP register values, not seconds.
// Echo, noise, pitch modulation and the song's later parameter changes are omitted.
const snes = await createSoundChip('snes');
try {
  const referenceNote = ${quote(referenceNote)};
  const sample = await snes.loadBRR(await file(${quote(`./samples/${label}.brr`)}, {type:'arrayBuffer'}), {
    rootNote: referenceNote,
    basePitch: ${basePitch}${loop}
  });
  /** @type {Omit<PlaygroundSnesChannelState, 'sample'>} */
  const voicePreset = await file(${quote(`./presets/${label}.json`)}, {type:'json'});
  snes.setPreset(0, {...voicePreset, sample});
  snes.setPitch(0, voicePreset.pitch);
  // For notes instead of the captured pitch, try snes.setNote(0, referenceNote).
  snes.keyOn(0);
  await sleep(1); // seconds of held note
  snes.keyOff(0);
  await sleep(1); // seconds for the hardware release
} finally {
  snes.dispose();
}
`;
}

/** Construct new Virtual Files entries. Callers allocate a nonexisting directory
 * and write the complete plan only after validation succeeds. Original SPC bytes
 * are always retained. Each instrument script uses a fresh independent DSP, so
 * individually fitting samples cannot exhaust one shared instrument RAM.
 * voiceIndex:null explicitly requests the default voice; undefined selects the
 * first captured Voice when one exists. entryPath is the first selected script.
 */
export function buildSpcImportFiles(prepared, {mode, directory, selected = [], trace} = {}) {
  if (!prepared?.spc?.originalBytes || !Array.isArray(prepared.candidates)) throw new TypeError('Expected a prepared SPC import');
  if (!['song', 'instruments', 'javascript'].includes(mode)) throw new TypeError('SPC import mode must be song, instruments or javascript');
  if (mode === 'javascript') validateTrace(trace);
  safeDirectory(directory);
  if (!Array.isArray(selected) || selected.length > 256) throw new TypeError('selected must be an array of at most 256 BRR candidates');
  const selections = mode === 'instruments' ? selected.map(value => findSelection(prepared, value)) : [];
  if (mode === 'instruments' && !selections.length) throw new RangeError('Select at least one importable BRR candidate');
  const files = [
    {path:`${directory}/original.spc`, type:'binary', data:prepared.spc.originalBytes.slice()},
    {path:`${directory}/sourceinfo.json`, type:'text', data:json({format:'tetorica-spc-import', schemaVersion:1,
      sourceName:prepared.name, mode, metadata:prepared.metadata, warnings:prepared.warnings,
      scan:{directory:prepared.scan.directory, summary:prepared.scan.summary, rejected:prepared.scan.rejected},
      ...(mode === 'javascript' ? {conversion:{version:trace.version, clockRate:trace.clockRate,
        durationClocks:trace.durationClocks, durationSeconds:trace.durationClocks / trace.clockRate,
        eventCount:trace.events.length / 4, nativeSampleRate:32000,
        outputDelayFrames:trace.initialState.outputDelayFrames}} : {}),
      limitation:mode === 'javascript' ? 'Finite recorded DSP/RAM execution; original note names and loop structure are not inferred. Tag fade is not applied.'
        : 'BRR candidates describe this saved RAM snapshot, not every instrument used during the song.'})},
  ];
  if (mode === 'javascript') {
    const entryPath = `${directory}/index.js`;
    files.push({path:`${directory}/initial.ram.bin`, type:'binary', data:trace.initialState.ram.slice()},
      {path:`${directory}/initial.dsp.bin`, type:'binary', data:trace.initialState.dsp.slice()},
      {path:entryPath, type:'text', data:javascriptSource(trace)});
    return {files, entryPath, directory, mode};
  }
  if (mode === 'song') {
    const entryPath = `${directory}/index.js`;
    files.push({path:entryPath, type:'text', data:songSource()});
    return {files, entryPath, directory, mode};
  }
  const names = new Set();
  let entryPath;
  for (const selection of selections) {
    const {candidate, voice, referenceNote, preset, basePitch, label} = selection;
    if (names.has(label)) throw new TypeError('The same BRR candidate and Voice was selected more than once');
    names.add(label);
    const scriptPath = `${directory}/${label}.js`;
    entryPath ??= scriptPath;
    const {metadata} = exportBrrSample(candidate);
    Object.assign(metadata, {sourceNumbers:[...candidate.sourceNumbers], sourceEntries:candidate.sourceEntries.map(value => ({...value})),
      selectedVoiceIndex:voice?.index ?? null, assignedReferenceNote:referenceNote, assignedBasePitch:basePitch,
      tuning:'User-assigned reference note; not inferred from BRR or the captured Voice PITCH.'});
    files.push(
      {path:scriptPath, type:'text', data:instrumentSource(selection)},
      {path:`${directory}/samples/${label}.brr`, type:'binary', data:candidate.brr.slice()},
      {path:`${directory}/samples/${label}.metadata.json`, type:'text', data:json(metadata)},
      {path:`${directory}/presets/${label}.json`, type:'text', data:json(preset)},
    );
  }
  return {files, entryPath, directory, mode};
}
