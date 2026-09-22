import {isOpl, extractOplNotes} from './opl_notes.js';
import {scoreVoices,groupSelectedScoreChannels} from './score_groups.js';
import {extractOpl3Notes} from './ymf262_notes.js';
import {extractNesNotes} from './nes_notes.js';
import { Ym2612VGM } from '../js/ym2612vgm.js?v=ym2610-vgm-2';
import { extractOpnNotes, midiChipKind } from './vgm_notes.js?v=midi-onset-1';
import { extractOpmNotes } from './opm_notes.js';
import { extractToneNotes } from './tone_notes.js?v=ym2610-vgm-2';
import { extractOpllNotes } from './ym2413_notes.js';
import { extractGameboyNotes } from './gameboy_notes.js';

// Syntax: https://lilypond.org/doc/v2.24/Documentation/notation/writing-pitches
//         https://lilypond.org/doc/v2.24/Documentation/notation/writing-rhythms
const quoted = value => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\x00-\x1f]/g, ' ') + '"';
export function lilyPitch(midi) {
  const octave = Math.floor(midi / 12) - 4; // MIDI 48 = c; middle C (60) = c'.
  return ['c','cis','d','dis','e','f','fis','g','gis','a','ais','b'][midi % 12]
    + (octave >= 0 ? "'".repeat(octave) : ','.repeat(-octave));
}

/** One monophonic staff per extracted channel, with a shared absolute beat grid. */
export function createLilyPondScore(channels, totalSamples, { bpm = 120, fileName = 'VGM', warnings = [] } = {}) {
  if (!Number.isInteger(bpm) || bpm < 4 || bpm > 999) throw new RangeError('BPM must be an integer from 4 to 999');
  const tick = sample => Math.round(sample * bpm * 4 / (44100 * 60));
  const end = Math.max(16, Math.ceil(tick(totalSamples) / 16) * 16);
  if (!Number.isSafeInteger(end) || end > 1000000) throw new RangeError('Score is too long');
  let noteCount = 0, skippedNotes = 0;
  const staves = channels.map((channel, index) => {
    const pitches = [], bodies=[];
    for (const voiceNotes of scoreVoices(channel,bpm)) {
    const merged = [];
    for (const n of voiceNotes) {
      if (n.end <= n.start) continue;
      const pitch = n.midi === null || !Number.isFinite(n.midi) ? null : Math.round(n.midi);
      const previous = merged.at(-1);
      if (previous && pitch !== null && previous.pitch === pitch && previous.key === n.key && previous.end === n.start) previous.end = n.end;
      else merged.push({ ...n, pitch });
    }
    let cursor = 0;
    const tokens = [];
    function append(pitch, until) {
      while (cursor < until) {
        // Split at beat-aligned power-of-two boundaries, including bar lines.
        const length = [16,8,4,2,1].find(n => cursor % n === 0 && n <= until - cursor);
        cursor += length;
        tokens.push(`${pitch === null ? 'r' : lilyPitch(pitch)}${16 / length}${pitch !== null && cursor < until ? '~' : ''}`);
        if (cursor % 16 === 0) tokens.push('|\n');
      }
    }
    for (const n of merged) {
      const start = Math.min(end, Math.max(cursor, tick(n.start)));
      const finish = Math.min(end, tick(n.end));
      if (finish <= start) { skippedNotes++; continue; }
      if(n.sourceChannel)tokens.push('% source-channel: '+String(n.sourceChannel).replace(/[\r\n]/g,' ')+'\n');
      append(null, start);
      if (n.pitch === null || n.pitch < 0 || n.pitch > 127) { skippedNotes++; append(null, finish); }
      else { noteCount++; pitches.push(n.pitch); append(n.pitch, finish); }
    }
    append(null, end);
    bodies.push(tokens.join(' '));
    }
    pitches.sort((a,b) => a-b);
    const clef = pitches.length && pitches[Math.floor(pitches.length / 2)] < 60 ? 'bass' : 'treble';
    return `  \\new Staff \\with { instrumentName = ${quoted(channel.name ?? `CH${index + 1}`)} } {
    \\clef ${clef} \\time 4/4 \\tempo 4 = ${bpm}
    ${bodies.length===1?bodies[0]:'<< '+bodies.map(body=>'\\new Voice { '+body+' }').join(' ')+' >>'} \\bar "|."
  }`;
  });
  if (!staves.length) throw new Error('No supported channels for LilyPond export');
  const notices = [
    'Editable transcription: manual BPM, assumed 4/4, sixteenth-note grid; not an original score.',
    'Semitone base pitches only; PCM, noise, timbres, LFO, bends and audible release are not reproduced.',
    'Unknown pitches become rests; sub-grid intervals may disappear. Final bar is padded with rests.',
    'Same-key, same-rounded-pitch intervals are merged; distinct key events remain separate.',
    'No automatic key signature, meter, tempo, pickup or triplet detection. VGM loop is not expanded.',
    ...warnings, `${skippedNotes} intervals omitted or replaced by rests.`,
  ];
  const text = `\\version "2.24.3"\n\\language "nederlands"\n`
    + notices.map(s => `% ${String(s).replace(/[\r\n]/g, ' ')}`).join('\n')
    + `\n\\header { title = ${quoted(fileName)} subtitle = "VGM transcription (quantized)" }\n`
    + `\\score {\n\\new StaffGroup <<\n${staves.join('\n')}\n>>\n\\layout {}\n}\n`;
  return { text, noteCount, skippedNotes, warnings: notices };
}

export function analyzeLilyPondSource(source) {
  const header = new Ym2612VGM(source).header;
  const kind = header.ymf262Clock & 0x3fffffff ? 'ymf262' : header.ym2151Clock & 0x3fffffff ? 'ym2151' : midiChipKind(header);
  if (!kind) throw new Error('LilyPond requires YMF262 / YM3526 / YM3812 / OPN / YM2151 / AY-3-8910 / YM2413 / PSG / Game Boy DMG notes');
  const fm = isOpl(kind) ? extractOplNotes(source) : kind === 'ymf262' ? extractOpl3Notes(source) : kind === 'ym2151' ? extractOpmNotes(source) : kind === 'psg' || kind === 'ay8910' || kind === 'ym2413' || kind === 'nes' || kind === 'gameboy' ? { channels: [], warnings: new Map() } : extractOpnNotes(source);
  const tones = kind === 'nes' ? extractNesNotes(source) : kind === 'gameboy' ? extractGameboyNotes(source) : extractToneNotes(source, kind);
  const opll = (header.ym2413Clock & 0x3fffffff) ? extractOpllNotes(source) : { channels: [], warnings: new Map(), time: 0 };
  const warnings = new Map([...(fm.warnings ?? []), ...tones.warnings, ...opll.warnings]);
  if (['ym2203','ym2608','ym2610'].includes(kind)) warnings.delete('SSG writes omitted');
  if (header.psgClock & 0x3fffffff) warnings.delete('PSG writes omitted');
  const channels = [
    ...fm.channels.map((ch, i) => ({ ...ch, name: `${kind.toUpperCase()} CH${i + 1}` })), ...tones.channels, ...opll.channels,
  ];
  return { channels, time: Math.max(tones.time, opll.time), warnings: [...warnings].map(([s, info]) => `${s} (${info.count})`), tempo: suggestLilyPondTempo(channels) };
}

// Rank integer BPMs by how closely distinct key-on intervals fit a sixteenth grid.
// This is a notation aid, not beat/meter detection; half/double tempo can be ambiguous.
export function suggestLilyPondTempo(channels) {
  const intervals = [];
  for (const channel of channels) {
    const starts = [];
    let previousKey;
    for (const n of channel.notes) {
      if (n.midi === null || !Number.isFinite(n.midi) || n.end <= n.start) continue;
      if (n.key !== previousKey) starts.push(n.start);
      previousKey = n.key;
    }
    // Bound work on long recordings; include intervals across the whole channel.
    const stride = Math.max(1, Math.ceil(starts.length / 512));
    for (let i = 1; i < starts.length; i += stride) {
      for (const back of [1, 2, 4]) {
        if (i < back) continue;
        const seconds = (starts[i] - starts[i-back]) / 44100;
        if (seconds >= 0.08 && seconds <= 4) intervals.push(seconds);
      }
    }
  }
  if (intervals.length < 8) return { bpm: 120, estimated: false, candidates: [] };
  const ranks = [];
  for (let bpm = 70; bpm <= 180; bpm++) {
    const error = intervals.reduce((sum, seconds) => {
      const ticks = seconds * bpm / 15;
      return sum + Math.abs(ticks - Math.round(ticks));
    }, 0) / intervals.length;
    ranks.push({ bpm, error });
  }
  ranks.sort((a,b) => (a.error + Math.abs(a.bpm-120)*0.00002) - (b.error + Math.abs(b.bpm-120)*0.00002));
  if (ranks[0].error > 0.09) return { bpm: 120, estimated: false, candidates: [] };
  const candidates = [];
  for (const entry of ranks) {
    if (entry.error > 0.09 || candidates.some(bpm => Math.abs(bpm-entry.bpm)<4)) continue;
    candidates.push(entry.bpm);
    if (candidates.length === 3) break;
  }
  return { bpm: ranks[0].bpm, estimated: true, candidates };
}

export function exportAnalysisLilyPond(source, options = {}) {
  return exportLilyPondAnalysis(analyzeLilyPondSource(source), options);
}
export function exportLilyPondAnalysis(analysis, options = {}) {
  const selected = options.channelIndices;
  if (selected !== undefined && (!Array.isArray(selected) || selected.some(i => !Number.isInteger(i) || i < 0 || i >= analysis.channels.length))) {
    throw new Error('Invalid channel selection');
  }
  const channels = analysis.channels.filter((_ch, i) => selected === undefined || selected.includes(i));
  if (!channels.length) throw new Error('Select at least one channel');
  return createLilyPondScore(groupSelectedScoreChannels(analysis.channels,channels,options.groups), analysis.time, { ...options, warnings: analysis.warnings });
}
