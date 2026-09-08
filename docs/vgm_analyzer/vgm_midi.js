import { extractToneNotes } from './tone_notes.js?v=ym2610-vgm-2';
import { Ym2612VGM } from '../js/ym2612vgm.js?v=ym2610-vgm-2';
import { extractOpnNotes, midiChipKind } from './vgm_notes.js?v=ym2610-vgm-2';

const PPQN = 960;
const utf8 = text => new TextEncoder().encode(text);
const be16 = n => [n >>> 8 & 255, n & 255];
const be32 = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
function vlq(n) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 0x0fffffff) throw new RangeError('MIDI delta time is out of range');
  const bytes = [n & 127];
  while ((n = Math.floor(n / 128))) bytes.unshift((n & 127) | 128);
  return bytes;
}
function meta(type, data) { return [255, type, ...vlq(data.length), ...data]; }
function textMeta(type, text) { return meta(type, utf8(text)); }
function track(events, end) {
  events.sort((a,b) => a.tick - b.tick || a.order - b.order);
  const data = []; let cursor = 0;
  for (const event of events) {
    data.push(...vlq(event.tick - cursor), ...event.bytes);
    cursor = event.tick;
  }
  data.push(...vlq(Math.max(cursor, end) - cursor), 255, 47, 0);
  return new Uint8Array([...utf8('MTrk'), ...be32(data.length), ...data]);
}
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n,p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** SMF type 1. Tempo is manual; tick rounding is not musical quantization. */
export function exportAnalysisMidi(source, { bpm = 120, fileName = 'VGM' } = {}) {
  const tempo = Math.round(60000000 / bpm);
  if (!Number.isFinite(bpm) || bpm <= 0 || tempo < 1 || tempo > 0xffffff) {
    throw new RangeError('BPM must fit the MIDI tempo range (approximately 3.58–60000000)');
  }
  const parserHeader = new Ym2612VGM(source).header;
  const chipKind = midiChipKind(parserHeader);
  if (!chipKind) throw new Error('MIDI requires YM2612 / YM2203 / YM2608 or PSG');
  const fm = chipKind === 'psg' ? {channels:[],warnings:new Map()} : extractOpnNotes(source);
  const tones = extractToneNotes(source, chipKind);
  const channels = [...fm.channels, ...tones.channels];
  const time = tones.time;
  const chipName = chipKind === 'ym2610' && (parserHeader.ym2610Clock & 0x80000000) ? 'YM2610B' : chipKind.toUpperCase();
  const extractionWarnings = new Map([...fm.warnings, ...tones.warnings]);
  if (['ym2203','ym2608','ym2610'].includes(chipKind)) extractionWarnings.delete('SSG writes omitted');
  if (parserHeader.psgClock & 0x3fffffff) extractionWarnings.delete('PSG writes omitted');
  const warnings = ['FM and SSG/PSG tone notes; PCM, noise and original timbres are not reproduced.',
    'Pitch changes become Pitch Bend. Chip LFO and SSG envelope phase are not synthesized. Velocity is fixed at 100.'];
  for (const [message, entry] of extractionWarnings) warnings.push(`${message} (${entry.count})`);
  if (parserHeader.loopOffset) warnings.push('VGM loop is not expanded; one pass is exported.');
  const tick = sample => Math.round(sample * 1000000 * PPQN / (44100 * tempo));
  let noteCount = 0, skippedNotes = 0, bendCount = 0;
  const bendRanges = [];
  const tracks = channels.map((channel, index) => {
    const midiChannel = index >= 9 ? index + 1 : index;
    const notes = [];
    for (const n of channel.notes) {
      if (n.end <= n.start) continue;
      const pitch = n.midi === null ? null : Math.round(n.midi);
      if (pitch === null || !Number.isFinite(pitch) || pitch < 0 || pitch > 127) { skippedNotes++; continue; }
      const previous = notes.at(-1);
      // The extractor splits pitches for MML; restore each continuous KEY interval for MIDI.
      if (previous && previous.key === n.key && previous.end === n.start) {
        previous.end = n.end;
        previous.pitches.push({ sample: n.start, midi: n.midi });
      } else notes.push({ ...n, pitch, pitches: [{ sample: n.start, midi: n.midi }] });
    }
    let excursion = 0;
    for (const n of notes) for (const point of n.pitches) excursion = Math.max(excursion, Math.abs(point.midi - n.pitch));
    // Positive MIDI bend ends at 8191, negative at -8192. Leave room at both ends.
    const requiredRange = Math.max(2, Math.ceil(excursion * 8192 / 8191));
    const range = Math.min(127, requiredRange);
    bendRanges.push(range);
    if (requiredRange > 127) warnings.push(`${chipName} CH${index+1}: pitch bend exceeds 127 semitones and is clipped.`);
    const bend = delta => Math.max(0, Math.min(16383, Math.round(8192 + delta * 8192 / range)));
    const bendBytes = value => [0xe0 | midiChannel, value & 127, value >>> 7];
    const events = [
      { tick: 0, order: -2, bytes: textMeta(3, channel.name ?? `${chipName} CH${index+1}`) },
      { tick: 0, order: -1, bytes: [0xc0 | midiChannel, 0] },
    ];
    // RPN 0: Pitch Bend Sensitivity, followed by RPN null to finish data entry.
    for (const [controller, value] of [[101,0],[100,0],[6,range],[38,0],[101,127],[100,127]]) {
      events.push({ tick: 0, order: -1, bytes: [0xb0 | midiChannel, controller, value] });
    }
    events.push({ tick: 0, order: -1, bytes: bendBytes(8192) });
    for (const n of notes) {
      const start = tick(n.start), end = tick(n.end);
      if (end <= start) { skippedNotes++; continue; }
      // Several writes may round to one MIDI tick; only the last pitch at that tick matters.
      const points = new Map();
      for (const point of n.pitches) {
        const at = tick(point.sample);
        if (at < end) points.set(at, bend(point.midi - n.pitch));
      }
      let previousBend = null;
      for (const [at, value] of points) {
        if (value === previousBend) continue;
        events.push({tick:at,order:1,bytes:bendBytes(value)});
        previousBend = value;
        bendCount++;
      }
      events.push({tick:start,order:2,bytes:[0x90 | midiChannel,n.pitch,100]},
        {tick:end,order:0,bytes:[0x80 | midiChannel,n.pitch,0]});
      noteCount++;
    }
    events.push({tick:tick(time),order:3,bytes:bendBytes(8192)});
    return track(events, tick(time));
  });
  if (!noteCount) throw new Error(`No convertible ${chipName} FM / tone notes found`);
  if (skippedNotes) warnings.push(`${skippedNotes} unknown, out-of-range or sub-tick note intervals omitted.`);
  const conductor = track([
    {tick:0,order:0,bytes:textMeta(3,String(fileName).replace(/[\r\n]/g,' '))},
    {tick:0,order:1,bytes:meta(0x51,[tempo >>> 16 & 255,tempo >>> 8 & 255,tempo & 255])},
    {tick:0,order:2,bytes:textMeta(1,'Manual tempo; original timing retained without grid quantization.')},
    ...warnings.map(message=>({tick:0,order:3,bytes:textMeta(1,message)})),
  ],tick(time));
  const header = new Uint8Array([...utf8('MThd'), ...be32(6), ...be16(1), ...be16(tracks.length + 1), ...be16(PPQN)]);
  return { chipKind, chipName, bytes: concat([header,conductor,...tracks]), noteCount, skippedNotes, bendCount, bendRanges, warnings, ppqn:PPQN, tempo };
}
