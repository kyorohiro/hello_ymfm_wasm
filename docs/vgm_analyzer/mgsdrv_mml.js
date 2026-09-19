import { Ym2612VGM } from '../js/ym2612vgm.js?v=ym2610-vgm-2';
import { extractToneNotes } from './tone_notes.js?v=ym2610-vgm-2';
import { quantizeSixteenthNotes } from './vgm_mml_music.js?v=sixteenth-1';
import { describeYm2413 } from './ym2413_monitor.js';

// MGSDRV (MSX music driver) MML export. Reference:
// https://z80.msx.click/index.php?title=MGSDRV_MML_11
// PSG tracks 1-3, FM tracks 9-h (9-sound mode, #opll_mode 0). Rhythm mode is
// not modeled: only Bass Drum (a normal 2op FM voice in rhythm mode) keeps a
// base pitch, Snare/Hi-hat/Tom/Top Cymbal are omitted with a warning.
const NOTE_TOKENS = ['c','c+','d','d+','e','f','f+','g','g+','a','a+','b'];
// Matches the proven table already used for the real OPNAvoid/MUCOM88 drivers
// in vgm_mml.js: no dotted whole note, and ties repeat the pitch/rest letter
// with "&" as separate space-joined tokens (single glued tokens are rejected).
const LENGTHS = [[1920,'1'],[1440,'2.'],[960,'2'],[720,'4.'],[480,'4'],[360,'8.'],[240,'8'],[120,'16']];

/** Emit one space-separated token per tied length chunk, e.g. "a1&a2". */
function pushDurationTokens(tokens, pitchOrRest, ticks) {
  let remaining = ticks;
  for (const [value, token] of LENGTHS) while (remaining >= value) {
    remaining -= value;
    tokens.push(`${pitchOrRest}${token}${remaining ? '&' : ''}`);
  }
}

// MGSC requires the track id on every physical line, not just the first
// (a continuation line with no track id is parsed as "invalid track number").
function wrapLines(trackId, tokens) {
  const lines = []; let line = trackId;
  for (const token of tokens) {
    if (line.length + 1 + token.length > 88) { lines.push(line); line = trackId; }
    line += ' ' + token;
  }
  lines.push(line);
  return lines.join('\n');
}

/** presetOf(event) => voice id, or omit to never emit @ instrument switches (PSG tracks). */
function renderTrack(trackId, events, presetOf) {
  // v defaults to 0 (silent) until set; range is documented as 0-5, not 0-15.
  const tokens = ['v5'];
  let octave, preset;
  for (const e of events) {
    if (e.type === 'rest' || e.midi === null) { pushDurationTokens(tokens, 'r', e.end - e.start); continue; }
    if (presetOf) {
      const p = presetOf(e);
      if (p !== preset) { preset = p; tokens.push(`@${p}`); }
    }
    const rounded = Math.round(e.midi);
    const next = Math.floor(rounded / 12) - 1;
    if (octave === undefined) tokens.push(`o${next}`);
    else if (next === octave + 1) tokens.push('>');
    else if (next === octave - 1) tokens.push('<');
    else if (next !== octave) tokens.push(`o${next}`);
    octave = next;
    pushDurationTokens(tokens, NOTE_TOKENS[((rounded % 12) + 12) % 12], e.end - e.start);
  }
  return wrapLines(trackId, tokens);
}

function opllOperatorFields(base) {
  return { am: (base >> 7) & 1, vb: (base >> 6) & 1, eg: (base >> 5) & 1, kr: (base >> 4) & 1, mt: base & 15 };
}

// Custom (user) instrument snapshot from registers 0x00-0x07. Real OPLL hardware
// has no per-operator detune; DT is always 0 to match the documented @v example.
function readCustomVoice(regs) {
  const mod = { ...opllOperatorFields(regs[0]), ar: (regs[4] >> 4) & 15, dr: regs[4] & 15,
    sl: (regs[6] >> 4) & 15, rr: regs[6] & 15, kl: (regs[2] >> 6) & 3, dt: 0 };
  const car = { ...opllOperatorFields(regs[1]), ar: (regs[5] >> 4) & 15, dr: regs[5] & 15,
    sl: (regs[7] >> 4) & 15, rr: regs[7] & 15, kl: (regs[3] >> 6) & 3, dt: 0 };
  return { tl: regs[2] & 0x3f, fb: regs[3] & 7, mod, car };
}

function formatCustomVoice(slot, voice) {
  const op = o => `${o.ar}, ${o.dr}, ${o.sl}, ${o.rr}, ${o.kl}, ${o.mt}, ${o.am}, ${o.vb}, ${o.eg}, ${o.kr}, ${o.dt}`;
  return `@v${slot} = {\n  ;       TL FB\n          ${voice.tl}, ${voice.fb},\n  ;       AR DR SL RR KL MT AM VB EG KR DT\n           ${op(voice.mod)},\n           ${op(voice.car)} }`;
}

function extractOpllVoiceNotes(source, clock) {
  const parser = new Ym2612VGM(source);
  const regs = new Uint8Array(0x40);
  let time = 0;
  const channels = Array.from({ length: 9 }, () => ({ active: null, notes: [], serial: 0 }));
  let rhythmActive = false;
  function update() {
    const state = describeYm2413(regs, clock);
    if (state.rhythmEnabled) rhythmActive = true;
    state.channels.forEach((ch, i) => {
      const c = channels[i];
      if (ch.isRhythmChannel && ch.channel !== 6) {
        if (c.active) { c.notes.push({ ...c.active, end: time }); c.active = null; }
        return;
      }
      const voiceKey = ch.instrument === 0 ? `custom:${regs.slice(0, 8).join(',')}` : `rom:${ch.instrument}`;
      if (c.active && ch.keyOn && c.active.midi === ch.midi && c.active.voiceKey === voiceKey) return;
      const wasOn = Boolean(c.active);
      if (c.active) { c.notes.push({ ...c.active, end: time }); c.active = null; }
      if (ch.keyOn && ch.midi !== null) {
        if (!wasOn) c.serial++;
        c.active = { start: time, midi: ch.midi, key: c.serial, voiceKey,
          voice: ch.instrument === 0 ? readCustomVoice(regs) : { rom: ch.instrument } };
      }
    });
  }
  const targets = { ym2413: { writeRegister: (register, value) => {
    if (register < regs.length) regs[register] = value;
    update();
  } } };
  while (true) {
    const event = parser.playStep(targets);
    if (event.type === 'wait') parser.consumeWait(targets, event.samples, n => { time += n; });
    else if (event.type === 'end') break;
  }
  for (const c of channels) if (c.active) c.notes.push({ ...c.active, end: time });
  return { channels, time, rhythmActive };
}

export function exportMgsdrvMml(source, { bpm = 120, fileName = 'VGM' } = {}) {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError('BPM must be a finite positive number');
  const header = new Ym2612VGM(source).header;
  const hasAy = Boolean(header.ay8910Clock & 0x3fffffff);
  const hasOpll = Boolean(header.ym2413Clock & 0x3fffffff);
  if (!hasAy && !hasOpll) throw new Error('MGSDRV MML requires AY-3-8910 / YM2149 and/or YM2413');

  const psg = hasAy ? extractToneNotes(source, 'ay8910') : null;
  const opll = hasOpll ? extractOpllVoiceNotes(source, header.ym2413Clock & 0x3fffffff) : null;
  const time = Math.max(psg?.time ?? 0, opll?.time ?? 0);

  const customVoices = new Map(); // json fields -> slot number (15-31)
  function customSlot(voice) {
    const key = JSON.stringify(voice);
    if (!customVoices.has(key)) {
      if (customVoices.size >= 17) throw new Error('MGSDRV MML supports at most 17 custom OPLL voice definitions');
      customVoices.set(key, 15 + customVoices.size);
    }
    return customVoices.get(key);
  }
  // quantizeSixteenthNotes only carries the "preset" field through, so resolve
  // each note's MGSDRV voice id (ROM 0-14 or custom slot 15-31) up front.
  if (opll) for (const ch of opll.channels) for (const note of ch.notes) {
    note.preset = note.voice.rom !== undefined ? note.voice.rom - 1 : customSlot(note.voice);
  }

  const lines = [
    '; VGM Analyzer analysis MML for MGSDRV (MSX music driver)',
    `; Source: ${String(fileName).replace(/[\r\n]/g, ' ')}`,
    '; Base-pitch transcription, quantized to a minimum of 1/16. Not a lossless VGM conversion.',
    '; PSG noise/envelope hardware effects and OPLL vibrato/tremolo/sustain are not reproduced.',
  ];
  if (opll?.rhythmActive) lines.push('; Rhythm mode: Snare/Hi-hat/Tom/Top Cymbal are omitted; only Bass Drum keeps a base pitch. Exported as 9-sound FM (#opll_mode 0), not rhythm mode.');
  if (header.loopOffset) lines.push('; VGM loop is not expanded; one pass is exported.');
  lines.push('#opll_mode 0', `#tempo ${Math.round(bpm)}`, '');

  let noteCount = 0;
  if (psg) {
    psg.channels.forEach((ch, i) => {
      const events = quantizeSixteenthNotes(ch.notes, time, bpm);
      noteCount += events.filter(e => e.type === 'note' && e.midi !== null).length;
      lines.push(`; PSG CH ${'ABC'[i]}`, renderTrack(String(i + 1), events, null), '');
    });
  }
  if (opll) {
    const voiceLines = [];
    const trackLines = [];
    Array.from({ length: 9 }, (_, i) => i).forEach((i) => {
      const trackId = i === 0 ? '9' : 'abcdefgh'[i - 1];
      const events = quantizeSixteenthNotes(opll.channels[i].notes, time, bpm);
      noteCount += events.filter(e => e.type === 'note' && e.midi !== null).length;
      trackLines.push(`; FM CH ${i + 1}`, renderTrack(trackId, events, e => e.preset), '');
    });
    for (const [key, slot] of customVoices) voiceLines.push(formatCustomVoice(slot, JSON.parse(key)), '');
    lines.push(...voiceLines, ...trackLines);
  }
  if (!noteCount) throw new Error('No convertible AY-3-8910 / YM2413 base-pitch notes found');
  return lines.join('\n') + '\n';
}
