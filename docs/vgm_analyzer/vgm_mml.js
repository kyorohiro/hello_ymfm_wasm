import { quantizeNotes, writeMml } from "./vgm_mml_music.js";
import { extractYm2612Notes } from "./vgm_notes.js";

/** Analysis dialect: o4 c%480, with 480 ticks per quarter. Not driver-compatible MML. */
export function exportAnalysisMml(source, { bpm = 120, fileName = "VGM" } = {}) {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("BPM must be a finite positive number");
  const { channels, time, clock, parserHeader, warnings, patches } = extractYm2612Notes(source);
  const header = [
    "; VGM Analyzer analysis MML — not compatible with a specific MML driver",
    `; Source: ${String(fileName).replace(/[\r\n]/g, " ")}`,
    `; YM2612 clock=${clock}Hz duration=${time} samples; timestamps use 44100Hz`,
    "; BPM is a manual conversion value, not an estimate. Quarter=480 ticks; %N=ticks; ?=unknown pitch.",
    "; Pitch is the base FNUM pitch; operator multipliers/detune and modulation are not resolved.\n; KEY OFF marks the register operation, not the end of the audible release. Octave: MIDI 60 = o4 c.",
    "; Bend splits do not imply retriggering. Patch IDs contain observed raw registers, not complete driver voices.",
    "; > raises / < lowers octave; lN=default length; dot=dotted; ^=tie; qN=gate percent (default 100, once per tied note).",
    `t${bpm}`,
  ];
  if (parserHeader.loopOffset) header.push(`; Loop: file offset=${parserHeader.loopOffset}, header loopSamples=${parserHeader.loopSamples}; not expanded`);
  for (const [message, entry] of warnings) header.push(`; WARNING (${entry.count}, samples=${entry.first}..${entry.last}): ${message}`);
  for (const [patch, id] of patches) header.push(`; @${id} raw registers: ${patch}`);
  return header.join("\n") + "\n\n" + channels.map((ch, i) => `; CH${i + 1}\n${writeMml(quantizeNotes(ch.notes, time, bpm))}\n${ch.lines.join("\n")}`).join("\n\n") + "\n";
}
