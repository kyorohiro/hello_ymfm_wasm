import {Ym2612VGM} from '../js/ym2612vgm.js';
import {isOpl, describeOplNotes} from './opl_notes.js';
import {applyOpl3Write, describeOpl3Notes} from './ymf262_notes.js';
import {createStoredZipBytes} from './stored_zip.js';

export const SBI_CHIPS = ['ym3526', 'ym3812', 'y8950', 'ymf262', 'ymf278b'];
export const SBI_NOTICE = 'Static melodic FM voices only. Rhythm, CSM, ADPCM/PCM, pan, global vibrato/tremolo depth, clock and performance are not saved. TL is preserved without volume normalization.';
const slots = [0,1,2,8,9,10,16,17,18];

function notes(registers, kind) {
  return isOpl(kind) ? describeOplNotes(registers, 3579545) : describeOpl3Notes(registers, 14318180, kind);
}

// DOS SBI: 52 bytes. UNIX 4OP SBI: 60 bytes (two 11-byte voices + padding).
// Layout verified against OPL3BankEditor format_sb_ibk.cpp and Furnace loadSBI.
export function createSbi(registers, kind, channel, name = 'OPL voice') {
  if (!SBI_CHIPS.includes(kind)) throw new Error('Unsupported SBI chip');
  const count = isOpl(kind) ? 9 : 18;
  if (!Number.isInteger(channel) || channel < 0 || channel >= count) throw new RangeError('Invalid SBI channel');
  if (registers.length < (count === 9 ? 256 : 512)) throw new RangeError('Incomplete OPL register state');
  const note = notes(registers, kind)[channel];
  if (note.slave || note.percussion || note.csm) throw new Error('Select a melodic channel (the leading channel for 4op) outside CSM mode');
  return encodeSbi(registers, kind, channel, name, note.paired);
}

function encodeSbi(registers, kind, channel, name, paired) {
  const fourOp = !!paired, bytes = new Uint8Array(fourOp ? 60 : 52);
  bytes.set(fourOp ? [52,79,80,26] : [83,66,73,26]);
  // ASCII names avoid legacy importer encoding differences; leave the final bytes zero.
  const title = String(name).replace(/[^\x20-\x7e]/g, '_').slice(0, 30);
  bytes.set(new TextEncoder().encode(title), 4);
  const bank = channel >= 9 ? 256 : 0, local = channel % 9;
  const feedback = registers[bank + 0xc0 + local] & 14;
  const waveMask = isOpl(kind) ? (kind === 'ym3812' && registers[1] & 32 ? 3 : 0) : (registers[0x105] & 1 ? 7 : 3);
  for (let pair = 0; pair < (fourOp ? 2 : 1); pair++) {
    const ch = local + pair * 3, offset = bank + slots[ch], start = 36 + pair * 11;
    for (const [i, base] of [0x20,0x40,0x60,0x80,0xe0].entries()) {
      const mask = base === 0xe0 ? waveMask : 255;
      bytes[start + i*2] = registers[base + offset] & mask;
      bytes[start + i*2 + 1] = registers[base + offset + 3] & mask;
    }
    // The second pair's hardware feedback is unused in 4op. Mirror the leading
    // feedback there because Furnace's 4OP importer reads it from the second pair.
    bytes[start + 10] = feedback | (registers[bank + 0xc0 + ch] & 1);
  }
  return bytes;
}

function scanSbi(source, atSample) {
  if (atSample !== undefined && (!Number.isSafeInteger(atSample) || atSample < 0)) throw new RangeError('Invalid SBI snapshot sample');
  const parser = new Ym2612VGM(source, {logger:null});
  const families = [...SBI_CHIPS, 'ym2413','ym2151','ym2203','ym2608','ym2610','ym2612'].filter(k => parser.header[k+'Clock']);
  const kind = families[0];
  if (families.length !== 1 || !SBI_CHIPS.includes(kind) || parser.header[kind+'Clock'] & 0xc0000000)
    throw new Error('SBI requires one non-dual, non-variant OPL FM chip');
  const registers = new Uint8Array(isOpl(kind) ? 256 : 512);
  const seen = Array.from({length:isOpl(kind) ? 9 : 18}, () => new Set()), patches = [];
  let sample = 0;
  function capture(keyedOnly) {
    for (const [channel, note] of notes(registers, kind).entries()) {
      if (note.slave || note.percussion || note.csm || (keyedOnly && !note.keyOn)) continue;
      const data = encodeSbi(registers, kind, channel, '', note.paired);
      const signature = Array.from(data).join(',');
      if (keyedOnly && seen[channel].has(signature)) continue;
      seen[channel].add(signature);
      const label = `CH${channel+1}_${String(seen[channel].size).padStart(3,'0')}`;
      patches.push({name:label+'.sbi', channel, sample, fourOp:!!note.paired, data:encodeSbi(registers, kind, channel, label, note.paired)});
    }
  }
  for (;;) {
    const event = parser.step();
    if (event.type === 'end') {
      if (atSample !== undefined && sample < atSample) throw new RangeError('SBI snapshot time exceeds track end');
      break;
    }
    if (event.type === 'wait') {
      sample += event.samples;
      if (atSample !== undefined && sample > atSample) break;
      continue;
    }
    if (event.type !== kind+'-write') continue;
    if (event.chipIndex) throw new Error('Second chip SBI export is not supported');
    if (event.port === 2) continue; // OPL4 PCM is not an FM voice.
    if (isOpl(kind)) registers[event.register] = event.value;
    else applyOpl3Write(registers, event.register, event.value, event.port);
    // Match the OPM extractor: key-on states and parameter changes while keyed.
    if (atSample === undefined) capture(true);
  }
  if (atSample !== undefined) { sample = atSample; capture(false); }
  return patches;
}

export const extractSbiPatches = source => scanSbi(source);
export const snapshotSbiPatches = (source, atSample = 0) => scanSbi(source, atSample);
export function exportSbiSnapshot(source, {atSeconds, channel} = {}) {
  if (!Number.isFinite(atSeconds) || atSeconds < 0 || !Number.isSafeInteger(Math.floor(atSeconds * 44100)))
    throw new RangeError('SBI snapshot time must be finite and nonnegative');
  if (!Number.isInteger(channel) || channel < 1 || channel > 18)
    throw new RangeError('SBI snapshot channel must be a 1-based integer from 1 to 18');
  const sample = Math.floor(atSeconds * 44100);
  const patches = snapshotSbiPatches(source, sample);
  const patch = patches.find(p => p.channel === channel - 1);
  if (!patch) throw new RangeError('Unavailable SBI channel: select a melodic channel (the leading channel for 4op) outside CSM mode');
  return {bytes:patch.data, sample, channel, warnings:[SBI_NOTICE]};
}
export function exportSbiZip(source) {
  const patches = extractSbiPatches(source);
  if (!patches.length) throw new Error('No keyed melodic OPL tones found for SBI export');
  return {bytes:createStoredZipBytes(patches), count:patches.length, warnings:[SBI_NOTICE]};
}
