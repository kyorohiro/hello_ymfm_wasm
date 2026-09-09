import { quantizeNotes, quantizeSixteenthNotes, writeMml } from "./vgm_mml_music.js?v=sixteenth-1";
import { extractOpnNotes } from "./vgm_notes.js?v=midi-onset-1";

/** Readable FM transcription on a strict sixteenth-note grid.
 * quantization:"raw" retains the previous detailed analysis dialect. */
export function exportAnalysisMml(source, { bpm = 120, fileName = "VGM", quantization = "sixteenth", details = false } = {}) {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("BPM must be a finite positive number");
  if (!["sixteenth", "raw"].includes(quantization)) throw new Error("Unknown MML quantization");
  const { channels, time, clock, chipName, parserHeader, warnings, patches } = extractOpnNotes(source);
  const strict = quantization === "sixteenth";
  const header = [
    "; VGM Analyzer analysis MML — not compatible with a specific MML driver",
    `; Source: ${String(fileName).replace(/[\r\n]/g, " ")}`,
    `; ${chipName} FM clock=${clock}Hz duration=${time} samples; timestamps use 44100Hz`,
    strict ? "; Quantization: minimum 1/16, absolute grid from sample zero. BPM is manual, not detected."
      : "; BPM is manual. Quarter=480 ticks; %N=ticks.",
    "; Pitch is the base FNUM pitch; operator multipliers/detune and modulation are not resolved.",
    "; KEY OFF is not the end of audible release. MIDI 60 = o4 c. ?=unknown pitch.",
    "; > raises / < lowers octave; lN=default length; dot=dotted; ^=tie.",
    strict ? "; Sub-grid notes/gaps are simplified; collisions retain the longer interval (later wins ties). Gate=100."
      : "; qN=gate percent. Original sample details follow notes.",
    "; @N identifies observed register patches, not a portable instrument definition.",
    `t${bpm}`,
  ];
  if (parserHeader.loopOffset) header.push(`; Loop: file offset=${parserHeader.loopOffset}, header loopSamples=${parserHeader.loopSamples}; not expanded`);
  for (const [message, entry] of warnings) header.push(`; WARNING (${entry.count}): ${message}`);
  if (details) for (const [patch, id] of patches) header.push(`; @${id} raw registers: ${patch}`);
  const quantize = strict ? quantizeSixteenthNotes : quantizeNotes;
  return header.join("\n") + "\n\n" + channels.map((ch, i) =>
    `; CH${i + 1}\n${writeMml(quantize(ch.notes, time, bpm), { sixteenth: strict, details })}${details ? "\n"+ch.lines.join("\n") : ""}`
  ).join("\n\n") + "\n";
}

/** OPNAvoid's PMD-style dialect (42-value instruments and A-F FM parts).
 * This is a quantized transcription, not a lossless VGM conversion. */
export function exportOpnavoidMml(source, { bpm = 120, fileName = "VGM" } = {}) {
  if (!Number.isFinite(bpm) || bpm < 34 || bpm > 999) {
    throw new RangeError("OPNAvoid MML requires Export BPM from 34 to 999");
  }
  // Public OPNAvoid compiler emits t as a raw Timer B byte too. Use T
  // explicitly: PMD uses 24 ticks/quarter and a 2304/7987200 s timer step.
  const timerB = Math.round(256 - (60 * 7987200) / (24 * 2304 * bpm));
  const actualBpm = (60 * 7987200) / (24 * 2304 * (256 - timerB));
  const { channels, time, chipName, warnings, patches, parserHeader } = extractOpnNotes(source);
  const parts = channels.map(ch => quantizeSixteenthNotes(ch.notes, time, bpm));
  const playable = e => e.type === "note" && Number.isInteger(e.midi) && e.midi >= 12 && e.midi <= 107;
  const used = new Set(parts.flatMap(events => events.filter(playable).map(e => e.preset)));
  if (!used.size) throw new Error("No FM notes in OPNAvoid's o0-o7 range to export");
  if (used.size > 256) throw new Error("OPNAvoid MML supports at most 256 instrument definitions");
  const ids = new Map([...used].map((id, i) => [id, i]));
  const lines = [
    "; VGM Analyzer MML for OPNAvoid (PMD-style dialect)",
    `; Source: ${String(fileName).replace(/[\r\n]/g, " ")}`,
    `; ${chipName} FM only. Minimum 1/16; manual BPM=${bpm}, not detected.`,
    "; Quantized base FNUM pitch and observed FM patches; modulation and live register changes are not reproduced.",
    "; Unknown/out-of-range pitches become rests. KEY OFF does not include audible release.",
    "; MIDI 60 = o4 c; &=tie; default full gate. SSG/PSG/PCM are omitted.",
    `; Timer B T${timerB}: approximately ${actualBpm.toFixed(3)} BPM (hardware timer rounding).`,
    "; OPNAvoid compatibility does not imply compatibility with every PMD compiler.",
  ];
  if (parserHeader.loopOffset) lines.push("; VGM loop is not expanded.");
  for (const [message, entry] of warnings) lines.push(`; WARNING (${entry.count}): ${message}`);
  const omitted = parts.flat().filter(e => e.type === "note" && !playable(e)).length;
  if (omitted) lines.push(`; WARNING: ${omitted} unknown/out-of-range intervals replaced with rests.`);
  for (const [patch, originalId] of patches) {
    if (!ids.has(originalId)) continue;
    const regs = JSON.parse(patch);
    const get = address => regs[address.toString(16)] ?? 0;
    const values = [get(0xb0) & 7, (get(0xb0) >> 3) & 7];
    // Register offsets are OP1, OP3, OP2, OP4; definitions use OP1..OP4.
    for (const offset of [0, 8, 4, 12]) {
      values.push(get(0x50 + offset) & 31, get(0x60 + offset) & 31,
        get(0x70 + offset) & 31, get(0x80 + offset) & 15, get(0x80 + offset) >> 4,
        get(0x40 + offset) & 127, get(0x50 + offset) >> 6,
        get(0x30 + offset) & 15, (get(0x30 + offset) >> 4) & 7, get(0x60 + offset) >> 7);
    }
    lines.push(`; Observed patch @${originalId}`, `@${ids.get(originalId)} = { ${values.join(", ")} }`);
    if ([0, 4, 8, 12].some(offset => get(0x90 + offset) & 8)) {
      lines.push("; WARNING: SSG-EG operator envelope is not represented in this instrument definition.");
    }
  }
  // OPNAvoid masks each duration to 7 bits. Avoid dotted whole notes (144
  // target ticks): split them into tied notes of at most 96 target ticks.
  const lengths = [[1920, "1"], [1440, "2."], [960, "2"], [720, "4."],
    [480, "4"], [360, "8."], [240, "8"], [120, "16"]];
  parts.forEach((events, index) => {
    if (!events.some(playable)) return;
    const channel = "ABCDEF"[index];
    lines.push("", `; CH${index + 1}`);
    let line = `${channel} T${timerB} V127 p3`, octave, preset;
    const emit = token => {
      if (line.length + token.length > 88) { lines.push(line); line = channel; }
      line += ` ${token}`;
    };
    for (const event of events) {
      const isNote = playable(event);
      let pitch = "r";
      if (isNote) {
        const id = ids.get(event.preset), nextOctave = Math.floor(event.midi / 12) - 1;
        if (id !== preset) { emit(`@${id}`); preset = id; }
        if (octave !== nextOctave) { emit(`o${nextOctave}`); octave = nextOctave; }
        pitch = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"][event.midi % 12];
      }
      let remaining = event.end - event.start;
      for (const [ticks, length] of lengths) while (remaining >= ticks) {
        remaining -= ticks;
        emit(`${pitch}${length}${isNote && remaining ? "&" : ""}`);
      }
    }
    lines.push(line);
  });
  return lines.join("\n") + "\n";
}

/** MUCOM88 MML using its four-line FM voice definition syntax. */
export function exportMucomMml(source, { bpm = 120, fileName = "VGM" } = {}) {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError("MUCOM88 MML requires a positive Export BPM");
  const opna = exportOpnavoidMml(source, { bpm: Math.max(34, Math.min(999, bpm)), fileName });
  const lines = opna.split("\n");
  const result = [
    "; VGM Analyzer MML for MUCOM88",
    `; Source: ${String(fileName).replace(/[\r\n]/g, " ")}`,
    "; YM2612/YM2610 FM transcription, quantized to a minimum of 1/16.",
    `; Tempo T${bpm} is MUCOM88 quarter-notes per minute; SSG/PSG/PCM are omitted.`,
    "; FM voices are generated from observed registers; modulation and live changes are not reproduced.",
  ];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^@(\d+) = \{ ([^}]*) \}$/);
    if (match) {
      const values = match[2].split(", ").map(Number);
      const voice = Number(match[1]);
      result.push(`  @${voice}`, `${values[1]},${values[0]}`);
      for (let op = 0; op < 4; op++) {
        const p = values.slice(2 + op * 10, 12 + op * 10);
        result.push(`${p.slice(0, 9).join(",")} ; OP${op + 1}`);
      }
      continue;
    }
    if (lines[i].startsWith("; VGM Analyzer MML for OPNAvoid") ||
        lines[i].startsWith("; Source:") || lines[i].startsWith("; YM2610 FM only") ||
        lines[i].startsWith("; Quantized base") || lines[i].startsWith("; Unknown/out") ||
        lines[i].startsWith("; MIDI 60") || lines[i].startsWith("; Timer B") ||
        lines[i].startsWith("; OPNAvoid compatibility") || lines[i].startsWith("; WARNING") ||
        lines[i].startsWith("; Observed patch")) continue;
    const channel = lines[i].match(/^([A-F])(?:\s|$)/)?.[1];
    if (channel) {
      const mapped = { A: "A", B: "B", C: "C", D: "H", E: "I", F: "J" }[channel];
      result.push(lines[i].replace(/^([A-F])/, mapped).replace(/\bT\d+/, `T${bpm}`).replace(/\bV127\b/, "v15"));
    } else if (lines[i].trim() && !lines[i].startsWith(";")) result.push(lines[i]);
  }
  return result.join("\n") + "\n";
}
