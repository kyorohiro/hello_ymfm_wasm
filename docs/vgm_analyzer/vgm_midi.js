import { extractYm2612Notes } from './vgm_notes.js';

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
  const { channels, time, warnings: extractionWarnings, parserHeader } = extractYm2612Notes(source);
  const warnings = ['YM2612 FM notes only; PSG, PCM and FM timbres are not reproduced.',
    'Base FNUM pitch rounded to semitones; bends become note changes. Velocity is fixed at 100.'];
  for (const [message, entry] of extractionWarnings) warnings.push(`${message} (${entry.count})`);
  if (parserHeader.loopOffset) warnings.push('VGM loop is not expanded; one pass is exported.');
  const tick = sample => Math.round(sample * 1000000 * PPQN / (44100 * tempo));
  let noteCount = 0, skippedNotes = 0;
  const tracks = channels.map((channel, index) => {
    const notes = [];
    for (const n of channel.notes) {
      if (n.end <= n.start) continue;
      const pitch = n.midi === null ? null : Math.round(n.midi);
      if (pitch === null || !Number.isFinite(pitch) || pitch < 0 || pitch > 127) { skippedNotes++; continue; }
      const previous = notes.at(-1);
      // Keep a held note across same-semitone FNUM writes, but preserve KEY retriggers.
      if (previous && previous.key === n.key && previous.end === n.start && previous.pitch === pitch) previous.end = n.end;
      else notes.push({ ...n, pitch });
    }
    const events = [
      { tick: 0, order: -2, bytes: textMeta(3, `YM2612 CH${index+1}`) },
      { tick: 0, order: -1, bytes: [0xc0 | index, 0] },
    ];
    for (const n of notes) {
      const start = tick(n.start), end = tick(n.end);
      if (end <= start) { skippedNotes++; continue; }
      events.push({tick:start,order:1,bytes:[0x90 | index,n.pitch,100]},
        {tick:end,order:0,bytes:[0x80 | index,n.pitch,0]});
      noteCount++;
    }
    return track(events, tick(time));
  });
  if (!noteCount) throw new Error('No convertible YM2612 FM notes found');
  if (skippedNotes) warnings.push(`${skippedNotes} unknown, out-of-range or sub-tick note intervals omitted.`);
  const conductor = track([
    {tick:0,order:0,bytes:textMeta(3,String(fileName).replace(/[\r\n]/g,' '))},
    {tick:0,order:1,bytes:meta(0x51,[tempo >>> 16 & 255,tempo >>> 8 & 255,tempo & 255])},
    {tick:0,order:2,bytes:textMeta(1,'Manual tempo; original timing retained without grid quantization.')},
    ...warnings.map(message=>({tick:0,order:3,bytes:textMeta(1,message)})),
  ],tick(time));
  const header = new Uint8Array([...utf8('MThd'), ...be32(6), ...be16(1), ...be16(7), ...be16(PPQN)]);
  return { bytes: concat([header,conductor,...tracks]), noteCount, skippedNotes, warnings, ppqn:PPQN, tempo };
}
