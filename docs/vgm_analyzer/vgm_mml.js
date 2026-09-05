import { quantizeNotes, writeMml } from "./vgm_mml_music.js";
import { Ym2612VGM } from "../js/ym2612vgm.js";

/** Analysis dialect: o4 c%480, with 480 ticks per quarter. Not driver-compatible MML. */
export function exportAnalysisMml(source, { bpm = 120, fileName = "VGM" } = {}) {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("BPM must be a finite positive number");
  let time = 0;
  const warnings = new Map();
  const warn = (message) => {
    const entry = warnings.get(message) ?? { count: 0, first: time, last: time };
    entry.count++;
    entry.last = time;
    warnings.set(message, entry);
  };
  const parser = new Ym2612VGM(source, { logger: { warn } });
  const clock = parser.header.ym2612Clock & 0x3fffffff;
  if (!clock) throw new Error("Analysis MML currently supports YM2612 FM only");
  if (parser.header.ym2612Clock & 0x40000000) warn("Dual YM2612: only the first chip is converted");
  let mode = 0;
  let dac = false;
  let highLatch = 0;
  const patches = new Map();
  const channels = Array.from({ length: 6 }, () => ({ fnum: 0, block: 0, mask: 0, active: null, cursor: 0, patch: {}, lines: [], notes: [], serial: 0 }));
  function finish(ch, endReason = "split") {
    if (!ch.active) return;
    const n = ch.active;
    ch.notes.push({ ...n, end: time, endReason });
    ch.cursor = time;
    ch.active = null;
  }
  function begin(ch, index) {

    const patch = JSON.stringify(Object.fromEntries(Object.entries(ch.patch).sort()));
    if (!patches.has(patch)) patches.set(patch, patches.size + 1);
    const id = patches.get(patch);

    const hz = ch.fnum * clock * 2 ** (ch.block - 1) / (144 * 2 ** 20);
    const midi = hz > 0 ? 69 + 12 * Math.log2(hz / 440) : NaN;
    const rounded = Math.round(midi);
    const uncertain = ch.mask !== 15 || (index === 2 && mode !== 0) || (index === 5 && dac) || !Number.isFinite(midi);
    const token = uncertain ? "?" : `o${Math.floor(rounded / 12) - 1} ${["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"][((rounded % 12) + 12) % 12]}`;
    if (uncertain) warn("Unknown pitch intervals (?) include partial KEY masks, CH3 special mode, DAC mode or zero FNUM");
    ch.active = { start: time, token, midi: uncertain ? null : midi, preset: id, key: ch.serial, info: `fnum=${ch.fnum} block=${ch.block} cents=${Number.isFinite(midi) ? ((midi - rounded) * 100).toFixed(2) : "unknown"}` };
  }
  function write(register, value, port = 0) {
    if (port === 0 && register === 0x2a) { warn("DAC samples omitted"); return; }
    if (port === 0 && (register === 0x27 || register === 0x2b)) {
      const index = register === 0x27 ? 2 : 5;
      const ch = channels[index];
      finish(ch);
      if (register === 0x27) mode = value & 0xc0;
      else dac = Boolean(value & 0x80);
      ch.lines.push(`; sample=${time} mode register=0x${register.toString(16)} value=0x${value.toString(16)}`);
      if (ch.mask) begin(ch, index);
      return;
    }
    if (port === 0 && register === 0x28) {
      const index = (value & 3) + ((value & 4) ? 3 : 0);
      if ((value & 3) === 3) { warn("Invalid KEY channel omitted"); return; }
      const ch = channels[index];
      finish(ch, value >> 4 ? "retrigger" : "keyOff");
      ch.mask = value >> 4;
      ch.serial++;
      if (ch.mask) begin(ch, index);
      return;
    }
    const slot = register & 3;
    const index = slot + port * 3;
    if (slot < 3 && register >= 0xa4 && register <= 0xa6) { highLatch = value; return; }
    if (slot < 3 && register >= 0xa0 && register <= 0xa2) {
      const ch = channels[index];
      if (ch.active) ch.lines.push(`; sample=${time} pitch change during KEY ON (bend), interval split`);
      finish(ch);
      ch.fnum = ((highLatch & 7) << 8) | value;
      ch.block = (highLatch >> 3) & 7;
      if (ch.mask) begin(ch, index);
      return;
    }
    if (slot < 3 && ((register >= 0x30 && register <= 0x9f) || (register >= 0xb0 && register <= 0xb6))) {
      const ch = channels[index];
      ch.patch[(register - slot).toString(16)] = value;
      if (ch.active) ch.lines.push(`; sample=${time} sounding patch write reg=0x${register.toString(16)} value=0x${value.toString(16)}`);
      return;
    }
    warn(`Unconverted YM2612 register port=${port} reg=0x${register.toString(16)}`);
  }
  const targets = { writeRegister: write, psg: { write: () => warn("PSG writes omitted") } };
  while (true) {
    const event = parser.playStep(targets);
    if (event.type === "wait") parser.consumeWait(targets, event.samples, n => { time += n; });
    else if (event.type === "end") break;
    else if (["ym2203-write", "ym2608-write", "ym2610-write"].includes(event.type)) warn(`${event.type} omitted`);
  }
  for (const ch of channels) {
    if (ch.active) ch.lines.push("; KEY still on at VGM end; interval truncated");
    finish(ch, "vgmEnd");

  }
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
  if (parser.header.loopOffset) header.push(`; Loop: file offset=${parser.header.loopOffset}, header loopSamples=${parser.header.loopSamples}; not expanded`);
  for (const [message, entry] of warnings) header.push(`; WARNING (${entry.count}, samples=${entry.first}..${entry.last}): ${message}`);
  for (const [patch, id] of patches) header.push(`; @${id} raw registers: ${patch}`);
  return header.join("\n") + "\n\n" + channels.map((ch, i) => `; CH${i + 1}\n${writeMml(quantizeNotes(ch.notes, time, bpm))}\n${ch.lines.join("\n")}`).join("\n\n") + "\n";
}
