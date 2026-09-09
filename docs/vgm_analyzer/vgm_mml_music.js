/** Musical timing is independent of the VGM parser. All endpoints share sample zero. */
export function quantizeNotes(source, totalSamples, bpm) {
  const scale = bpm * 480 / (44100 * 60);
  // 32nd-note grid; at most 10% of a cell AND 10ms.
  const tolerance = Math.min(6, 441 * scale);
  const raw = sample => sample * scale;
  const snap = sample => {
    const value = raw(sample), nearest = Math.round(value / 60) * 60;
    return Math.abs(nearest - value) <= tolerance ? nearest : Math.round(value);
  };
  const notes = [];
  for (const item of source) {
    const prev = notes.at(-1);
    // Never merge a new KEY event, an unknown pitch, or a semitone crossing.
    if (prev && prev.key === item.key && prev.end === item.start && prev.preset === item.preset &&
        prev.midi !== null && item.midi !== null && Math.round(prev.midi) === Math.round(item.midi) &&
        Math.abs(prev.midi - item.midi) <= 0.2) {
      prev.end = item.end;
      prev.sources.push(item);
    } else notes.push({ ...item, sources: [item] });
  }
  const gates = new Map();
  // Require three consecutive, regular intervals, gaps <=100ms and <=25%.
  for (let i = 0; i + 3 < notes.length; i++) {
    const group = notes.slice(i, i + 3).map((n, j) => {
      const next = notes[i + j + 1];
      const interval = next.start - n.start;
      return { n, next, interval, gap: next.start - n.end, ratio: (n.end - n.start) / interval };
    });
    if (!group.every(g => g.interval > 0 && g.gap > 0 && g.gap <= 4410 && g.ratio >= 0.75 && g.ratio < 1 &&
        g.n.key !== g.next.key && g.n.midi !== null)) continue;
    const base = group[0];
    if (!group.every(g => Math.abs(g.interval - base.interval) <= base.interval * 0.05 && Math.abs(g.ratio - base.ratio) <= 0.03)) continue;
    for (let j = 0; j < 3; j++) gates.set(i + j, Math.round(group[j].ratio * 100));
  }
  const events = [];
  let cursor = 0;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    let start = Math.max(cursor, snap(n.start));
    const logicalEnd = gates.has(i) ? notes[i + 1].start : n.end;
    let end = snap(logicalEnd);
    if (end <= start && logicalEnd > n.start) {
      start = Math.max(cursor, Math.round(raw(n.start)));
      end = Math.max(start, Math.round(raw(logicalEnd)));
    }
    if (start > cursor) events.push({ type: 'rest', start: cursor, end: start });
    events.push({ type: 'note', start, end: Math.max(start, end), gate: gates.get(i) ?? 100,
      midi: n.midi === null ? null : Math.round(n.midi), preset: n.preset, sources: n.sources,
      startErrorSamples: start / scale - n.start, endErrorSamples: end / scale - logicalEnd,
      gateErrorSamples: (start + (end - start) * (gates.get(i) ?? 100) / 100) / scale - n.end });
    cursor = Math.max(start, end);
  }
  const end = Math.max(cursor, snap(totalSamples));
  if (end > cursor) events.push({ type: 'rest', start: cursor, end });
  return events;
}

function length(ticks, sixteenth = false) {
  if(sixteenth) {
    if(!Number.isInteger(ticks)||ticks<=0||ticks%120!==0)throw new RangeError("Duration must be a positive multiple of a sixteenth");
    const values=[[2880,'1.'],[1920,'1'],[1440,'2.'],[960,'2'],[720,'4.'],[480,'4'],[360,'8.'],[240,'8'],[120,'16']];
    const parts=[];
    for(const [value,token] of values)while(ticks>=value){parts.push(token);ticks-=value;}
    return parts.join('^');
  }
  for (const denominator of [1, 2, 4, 8, 16, 32]) {
    if (ticks === 1920 / denominator) return String(denominator);
    if (ticks === 2880 / denominator) return `${denominator}.`;
  }
  // Limit ties to two terms; irregular timing stays explicit.
  for (const a of [1920, 960, 480, 240, 120, 60]) {
    const b = ticks - a;
    if ([1920, 960, 480, 240, 120, 60].includes(b)) return `${1920 / a}^${1920 / b}`;
  }
  return `%${ticks}`;
}

/** Writer consumes musical endpoints only; raw samples are used solely in detail comments. */
export function writeMml(events, { sixteenth = false, details: includeDetails = true } = {}) {
  const counts = new Map();
  for (const e of events) {
    const value = length(e.end - e.start, sixteenth);
    if (/^\d+$/.test(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  const defaultLength = best?.[1] >= 3 ? best[0] : null;
  const tokens = defaultLength ? [`l${defaultLength}`] : [];
  const details = [];
  let octave, preset, gate = 100, noteId = 0;
  for (const e of events) {
    let duration = length(e.end - e.start, sixteenth);
    if (duration === defaultLength) duration = '';
    if (e.type === 'rest') { tokens.push(`r${duration}`); continue; }
    noteId++;
    if (e.preset !== preset) { preset = e.preset; tokens.push(`@${preset}`); }
    if (e.gate !== gate) { gate = e.gate; tokens.push(`q${gate}`); }
    let pitch = '?';
    if (e.midi !== null) {
      const next = Math.floor(e.midi / 12) - 1;
      if (octave !== next) tokens.push(next === octave + 1 ? '>' : next === octave - 1 ? '<' : `o${next}`);
      octave = next;
      pitch = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'][((e.midi % 12) + 12) % 12];
    }
    tokens.push(pitch + duration);
    if (!includeDetails) continue;
    details.push(`; N${noteId} ticks=${e.start}..${e.end} gate=${e.gate}% errors(samples): start=${e.startErrorSamples.toFixed(2)} end=${e.endErrorSamples.toFixed(2)} keyOff=${e.gateErrorSamples.toFixed(2)}`);
    for (const s of e.sources) details.push(`; N${noteId} start=${s.start} samples=${s.end - s.start} end=${s.end} reason=${s.endReason ?? "unknown"} key=${s.key} ${s.info}`);
  }
  const lines = [];
  let line = '';
  for (const token of tokens) {
    if (line.length + token.length > 88) { lines.push(line); line = ''; }
    line += (line ? ' ' : '') + token;
  }
  if (line) lines.push(line);
  if (!includeDetails) return lines.join('\n');
  return lines.join('\n') + '\n\n; Details (N numbers follow notes in the body)\n' + details.join('\n');
}

/** Strict sixteenth-note transcription. Colliding sub-grid notes use the
 * longer source interval (later interval wins ties), without shifting the song. */
export function quantizeSixteenthNotes(source, totalSamples, bpm) {
  if(!Number.isFinite(bpm)||bpm<=0)throw new RangeError('Invalid BPM');
  const scale=bpm*480/(44100*60),cell=120;
  const snap=s=>Math.max(0,Math.round(s*scale/cell)*cell);
  const merged=[];
  for(let i=0;i<source.length;i++){
    let n=source[i],next=source[i+1];
    if(n.freshOnset && n.endReason==='pitch' && n.end-n.start<=8 &&
       next?.key===n.key && next.start===n.end && Number.isFinite(next.midi)){
      n={...next,start:n.start};i++;
    }
    if(n.end<=n.start)continue;
    const previous=merged.at(-1);
    if(previous && previous.key===n.key && previous.preset===n.preset &&
       previous.end===n.start && Number.isFinite(previous.midi) && Number.isFinite(n.midi) &&
       Math.round(previous.midi)===Math.round(n.midi)){
      previous.end=n.end;previous.sources.push(n);
    }else merged.push({...n,sources:[n]});
  }
  const selected=[];
  for(const n of merged){
    const candidate={n,start:snap(n.start),end:Math.max(snap(n.start)+cell,snap(n.end))};
    const previous=selected.at(-1);
    if(previous && candidate.start<previous.end){
      if(candidate.start===previous.start){
        if(n.end-n.start < previous.n.end-previous.n.start)continue;
        selected.pop();
      }else previous.end=candidate.start;
    }
    selected.push(candidate);
  }
  const events=[];let cursor=0;
  for(const {n,start,end} of selected){
    if(start>cursor)events.push({type:'rest',start:cursor,end:start});
    events.push({type:'note',start,end,gate:100,midi:Number.isFinite(n.midi)?Math.round(n.midi):null,
      preset:n.preset??1,sources:n.sources,
      startErrorSamples:start/scale-n.start,endErrorSamples:end/scale-n.end,
      gateErrorSamples:end/scale-n.end});
    cursor=end;
  }
  const end=Math.max(cursor,snap(totalSamples));
  if(end>cursor)events.push({type:'rest',start:cursor,end});
  return events;
}
