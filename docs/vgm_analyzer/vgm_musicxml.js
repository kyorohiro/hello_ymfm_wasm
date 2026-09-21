import {scoreVoices} from './score_groups.js';
// MusicXML 4.0 partwise. The independent trial uses the same 1/16 grid as .ly export.
const xml = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function createMusicXmlScore(channels, totalSamples, {bpm = 120, fileName = 'VGM', warnings = []} = {}) {
  if (!Number.isInteger(bpm) || bpm < 4 || bpm > 999) throw new RangeError('BPM must be an integer from 4 to 999');
  const tick = sample => Math.round(sample * bpm * 4 / (44100 * 60));
  const end = Math.max(16, Math.ceil(tick(totalSamples) / 16) * 16);
  if (!Number.isSafeInteger(end) || end > 1000000) throw new RangeError('Score is too long');
  if (!channels.length) throw new Error('Select at least one channel');
  let noteCount = 0, skippedNotes = 0;
  const parts = channels.map((ch, index) => {
    const pitches = [], measures = Array.from({length: end / 16}, () => []);
    for (const [voiceIndex, voiceNotes] of scoreVoices(ch,bpm).entries()) {
    if(voiceIndex)for(const m of measures)m.push('<backup><duration>16</duration></backup>');
    const merged=[];
    let physical=null;
    for (const n of voiceNotes) {
      if (!Number.isFinite(n.start) || !Number.isFinite(n.end)) throw new Error('Invalid note time');
      if (n.end <= n.start) continue;
      const pitch = n.midi === null || !Number.isFinite(n.midi) ? null : Math.round(n.midi);
      const prev = merged.at(-1);
      if (prev && pitch !== null && prev.pitch === pitch && prev.key === n.key && prev.end === n.start) prev.end = n.end;
      else merged.push({...n, pitch});
    }
    let cursor = 0;
    function append(pitch, until) {
      let continuation = false;
      while (cursor < until) {
        const length = [16,8,4,2,1].find(n => cursor % n === 0 && n <= until - cursor);
        const ties = pitch === null ? [] : [...(continuation ? ['stop'] : []), ...(cursor + length < until ? ['start'] : [])];
        const pc = pitch === null ? 0 : pitch % 12;
        const step = ['C','C','D','D','E','F','F','G','G','A','A','B'][pc];
        const alter = [1,3,6,8,10].includes(pc) ? '<alter>1</alter>' : '';
        measures[Math.floor(cursor / 16)].push(`<note>${pitch === null ? '<rest/>' : `<pitch><step>${step}</step>${alter}<octave>${Math.floor(pitch / 12) - 1}</octave></pitch>`}<duration>${length}</duration>${ties.map(t => `<tie type="${t}"/>`).join('')}<voice>${voiceIndex+1}</voice><type>${{16:'whole',8:'half',4:'quarter',2:'eighth',1:'16th'}[length]}</type>${ties.length || physical ? `<notations>${physical ? `<other-notation type="single" print-object="no">${xml(physical)}</other-notation>` : ''}${ties.map(t => `<tied type="${t}"/>`).join('')}</notations>` : ''}</note>`);
        cursor += length; continuation = true;
      }
    }
    for (const n of merged) {
      const start = Math.min(end, Math.max(cursor, tick(n.start))), finish = Math.min(end, tick(n.end));
      if (finish <= start) { skippedNotes++; continue; }
      physical=null; append(null, start); physical=n.sourceChannel??null;
      if (n.pitch === null || n.pitch < 0 || n.pitch > 127) { skippedNotes++; append(null, finish); }
      else { noteCount++; pitches.push(n.pitch); append(n.pitch, finish); }
    }
    physical=null; append(null, end);
    }
    pitches.sort((a,b) => a-b);
    const bass = pitches.length && pitches[Math.floor(pitches.length / 2)] < 60;
    return `<part id="P${index+1}">${measures.map((notes, i) => `<measure number="${i+1}">${i === 0 ? `<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>${bass ? 'F' : 'G'}</sign><line>${bass ? 4 : 2}</line></clef></attributes>${index === 0 ? `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>` : ''}` : ''}${notes.join('')}${i === measures.length - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : ''}</measure>`).join('\n')}</part>`;
  });
  const notices = ['Quantized transcription; manual BPM, assumed 4/4, 1/16 grid. Not an original score.', 'PCM, noise, timbres, modulation and audible release are omitted. Unknown pitches become rests; sub-grid intervals may disappear. Final bar is padded. VGM loop is not expanded.', ...warnings, `${skippedNotes} intervals omitted or replaced by rests.`];
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${xml(fileName)}</work-title></work><identification><encoding><software>VGM Analyzer MusicXML trial</software><encoding-description>${xml(notices.join('\n'))}</encoding-description></encoding></identification><part-list>${channels.map((ch,i) => `<score-part id="P${i+1}"><part-name>${xml(ch.name ?? `CH${i+1}`)}</part-name></score-part>`).join('')}</part-list>${parts.join('\n')}</score-partwise>`;
  return {text, noteCount, skippedNotes, warnings: notices};
}
