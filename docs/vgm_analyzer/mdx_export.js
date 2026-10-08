import {prepareMxdrvScore} from './opm_mml.js?v=mdx-1';

// Binary layout and opcodes: vampirefrog/mdxtools/docs/MDX.md.
// Matches mml2mdr's FM-only output: 9 tracks, 48 clocks/quarter, 27-byte voices.
let sjisCharacters;
function shiftJisTitle(value) {
  const title = String(value).replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 120) || 'VGM';
  const bytes = [];
  let replaced = false;
  for (const character of title) {
    const code = character.codePointAt(0);
    if (code < 128) {bytes.push(code); continue;}
    if (!sjisCharacters) {
      sjisCharacters = new Map();
      const decoder = new TextDecoder('shift_jis', {fatal: true});
      const add = codes => {
        try {const text = decoder.decode(Uint8Array.from(codes)); if ([...text].length === 1 && !sjisCharacters.has(text)) sjisCharacters.set(text, codes);}
        catch {} // Unassigned Shift_JIS byte pairs.
      };
      for (let i = 0xa1; i <= 0xdf; i++) add([i]);
      for (let lead = 0x81; lead <= 0xfc; lead++) {
        if (lead > 0x9f && lead < 0xe0) continue;
        for (let trail = 0x40; trail <= 0xfc; trail++) if (trail !== 0x7f) add([lead, trail]);
      }
    }
    const encoded = sjisCharacters.get(character);
    if (encoded) bytes.push(...encoded);
    else {bytes.push(63); replaced = true;}
  }
  return {bytes, replaced};
}

/** FM transcription shared with MXDRV MML, compiled directly to MDX bytes.
 * No PCM/PDX and no external compiler are required. */
export function exportMdx(source, {bpm = 120, fileName = 'VGM'} = {}) {
  const {parts, voices, used, ids, timer, actualBpm, playable} = prepareMxdrvScore(source, {bpm});
  let omitted = 0;
  const tracks = parts.map(events => {
    const bytes = [0xff, timer, 0xf8, 8, 0xfb, 15, 0xfc, 3];
    let preset = null, previous = null;
    for (const event of events) {
      const active = playable(event);
      if (event.type === 'note' && !active) omitted++;
      if (active && event.preset !== preset) {bytes.push(0xfd, ids.get(event.preset)); preset = event.preset;}
      if (active && previous && playable(previous) && previous.end === event.start &&
          previous.sources.at(-1).key === event.sources[0].key && previous.preset === event.preset) bytes.push(0xf7);
      let duration = (event.end - event.start) / 10; // score PPQN 480 -> MDX PPQN 48.
      if (!Number.isSafeInteger(duration) || duration <= 0) throw new RangeError('Invalid MDX duration');
      while (duration > 0) {
        if (bytes.length > 65535) throw new RangeError('MDX track exceeds the 16-bit offset limit; shorten the source');
        const count = Math.min(duration, active ? 256 : 128);
        if (active) {
          bytes.push(0x80 + event.midi - 15, count - 1);
          if (duration > count) bytes.push(0xf7);
        } else bytes.push(count - 1);
        duration -= count;
      }
      previous = event;
    }
    bytes.push(0xf1, 0);
    return bytes;
  });
  // The ninth track P is present, with no PCM notes or PDX filename.
  tracks.push([0xf1, 0]);
  const voiceBytes = [];
  for (const voice of used) {
    const patch = voices[voice];
    voiceBytes.push(ids.get(voice), (patch.feedback << 3) | patch.algorithm, 15);
    const operators = [0, 2, 1, 3].map(index => patch.operators[index]);
    for (const pack of [
      op => (op.dt1 << 4) | op.mul, op => op.tl, op => (op.ks << 6) | op.ar,
      op => (op.am << 7) | op.d1r, op => (op.dt2 << 6) | op.d2r, op => (op.d1l << 4) | op.rr,
    ]) for (const operator of operators) voiceBytes.push(pack(operator));
  }
  const title = shiftJisTitle(fileName);
  const header = [...title.bytes, 13, 10, 26, 0];
  const table = new Uint8Array(20), view = new DataView(table.buffer);
  let offset = table.length;
  for (let i = 0; i < tracks.length; i++) {
    if (offset > 65535) throw new RangeError('MDX track offsets exceed the 16-bit limit; shorten the source');
    view.setUint16(2 + i * 2, offset);
    offset += tracks[i].length;
  }
  if (offset > 65535) throw new RangeError('MDX voice offset exceeds the 16-bit limit; shorten the source');
  view.setUint16(0, offset);
  const bytes = new Uint8Array(header.length + offset + voiceBytes.length);
  bytes.set(header); bytes.set(table, header.length);
  let position = header.length + table.length;
  for (const track of tracks) {bytes.set(track, position); position += track.length;}
  bytes.set(voiceBytes, position);
  const warnings = [
    'FM A–H transcription only; PCM/PDX and other chips are not included.',
    'Timing is quantized to a sixteenth-note grid; pitches are rounded to semitones; audible release is not transcribed.',
    'CH8 noise, partial operator keys and CSM are omitted. Live register changes, pan and LFO are not replayed; loops are not expanded.',
    'Source base pitch is transposed to nominal MDX tuning; envelopes and detune can differ at the target 4 MHz clock.',
    `Requested BPM ${bpm}; MDX @t${timer} is approximately ${actualBpm.toFixed(4)} BPM.`,
  ];
  if (omitted) warnings.push(`${omitted} out-of-range note intervals were replaced by rests.`);
  if (title.replaced) warnings.push('Characters unavailable in Shift_JIS were replaced with ? in the title.');
  return {bytes, extension: 'mdx', mimeType: 'application/octet-stream', warnings, voiceCount: used.length, bpm: actualBpm};
}
