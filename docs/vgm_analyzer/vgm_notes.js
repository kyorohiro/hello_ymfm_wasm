import { Ym2612VGM } from "../js/ym2612vgm.js?v=ym2610-vgm-2";

/** Extract unquantized FM note intervals in 44100 Hz sample time. */
export function midiChipKind(header) {
  return ['ym2612', 'ym2608', 'ym2203', 'ym2610'].find(kind => (header[`${kind}Clock`] & 0x3fffffff) > 0) ?? ((header.psgClock & 0x3fffffff) ? 'psg' : null);
}

export function extractYm2612Notes(source) {
  return extractOpnNotes(source, { chipKind: 'ym2612' });
}

export function extractOpnNotes(source, { chipKind = null } = {}) {
  let time = 0;
  const warnings = new Map();
  const warn = (message) => {
    const entry = warnings.get(message) ?? { count: 0, first: time, last: time };
    entry.count++;
    entry.last = time;
    warnings.set(message, entry);
  };
  const parser = new Ym2612VGM(source, { logger: { warn } });
  chipKind ??= midiChipKind(parser.header);
  if (!['ym2612', 'ym2203', 'ym2608', 'ym2610'].includes(chipKind)) throw new Error('MIDI supports YM2612 / YM2203 / YM2608 FM');
  const chipName = chipKind === "ym2610" && (parser.header.ym2610Clock & 0x80000000) ? "YM2610B" : chipKind.toUpperCase();
  const clock = parser.header[`${chipKind}Clock`] & 0x3fffffff;
  if (!clock) throw new Error(`Note extraction requires ${chipName} FM`);
  if (parser.header[`${chipKind}Clock`] & 0x40000000) warn(`Dual ${chipName}: only the first chip is converted`);
  for (const other of ['ym2612','ym2203','ym2608','ym2610']) {
    if (other !== chipKind && (parser.header[`${other}Clock`] & 0x3fffffff)) warn(`${other.toUpperCase()} FM omitted; exporting ${chipName}`);
  }
  const channelCount = chipKind === 'ym2203' ? 3 : 6;
  let prescale = 6;
  let sixChannelMode = chipKind !== 'ym2608';
  let mode = 0;
  let dac = false;
  let highLatch = 0;
  const patches = new Map();
  const channels = Array.from({ length: channelCount }, () => ({ fnum: 0, block: 0, mask: 0, active: null, cursor: 0, patch: {}, lines: [], notes: [], serial: 0 }));
  function finish(ch, endReason = "split") {
    if (!ch.active) return;
    const n = ch.active;
    ch.notes.push({ ...n, end: time, endReason });
    ch.cursor = time;
    ch.active = null;
  }
  function begin(ch, index) {
    if (chipKind === "ym2610" && !(parser.header.ym2610Clock & 0x80000000) && [0,3].includes(index)) return;
    if (index >= 3 && !sixChannelMode) return;

    const patch = JSON.stringify(Object.fromEntries(Object.entries(ch.patch).sort()));
    if (!patches.has(patch)) patches.set(patch, patches.size + 1);
    const id = patches.get(patch);

    const hz = ch.fnum * clock * 2 ** (ch.block - 1) / (prescale * channelCount * 4 * 2 ** 20);
    const midi = hz > 0 ? 69 + 12 * Math.log2(hz / 440) : NaN;
    const rounded = Math.round(midi);
    const uncertain = ch.mask !== 15 || (index === 2 && mode !== 0) || (index === 5 && dac) || !Number.isFinite(midi);
    const token = uncertain ? "?" : `o${Math.floor(rounded / 12) - 1} ${["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"][((rounded % 12) + 12) % 12]}`;
    if (uncertain) warn("Unknown pitch intervals (?) include partial KEY masks, CH3 special mode, DAC mode or zero FNUM");
    ch.active = { start: time, token, midi: uncertain ? null : midi, preset: id, key: ch.serial, info: `fnum=${ch.fnum} block=${ch.block} cents=${Number.isFinite(midi) ? ((midi - rounded) * 100).toFixed(2) : "unknown"}` };
  }
  function write(register, value, port = 0) {
    if (chipKind !== 'ym2612') {
      if (chipKind !== "ym2610" && port === 0 && register >= 0x2d && register <= 0x2f) {
        const next = register === 0x2d ? 6 : register === 0x2f ? 2 : prescale === 6 ? 3 : prescale;
        if (next !== prescale) {
          channels.forEach(ch => finish(ch));
          prescale = next;
          channels.forEach((ch,i) => { if (ch.mask) begin(ch,i); });
        }
        return;
      }
      if (chipKind === 'ym2608' && port === 0 && register === 0x29) {
        channels.slice(3).forEach(ch => finish(ch));
        sixChannelMode = Boolean(value & 0x80);
        channels.forEach((ch,i) => { if (i >= 3 && ch.mask) begin(ch,i); });
        return;
      }
      if ((port === 0 && register < 0x20) || (port === 1 && register < 0x30)) {
        warn(port === 0 && register < 0x10 ? 'SSG writes omitted' : 'ADPCM writes omitted');
        return;
      }
    }
    if (chipKind === 'ym2612' && port === 0 && register === 0x2a) { warn("DAC samples omitted"); return; }
    if (port === 0 && (register === 0x27 || (chipKind === 'ym2612' && register === 0x2b))) {
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
      const index = (value & 3) + ((chipKind !== 'ym2203' && (value & 4)) ? 3 : 0);
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
    warn(`Unconverted ${chipName} register port=${port} reg=0x${register.toString(16)}`);
  }
  const targets = { [chipKind]: { writeRegister: write }, psg: { write: () => warn("PSG writes omitted") } };
  if (chipKind === 'ym2610') targets.ym2610.loadAdpcmRom = () => warn('ADPCM ROM samples omitted');
  if (chipKind === 'ym2608') targets.ym2608.loadAdpcmBMemory = () => warn('ADPCM-B samples omitted');
  while (true) {
    const event = parser.playStep(targets);
    if (event.type === "wait") parser.consumeWait(targets, event.samples, n => { time += n; });
    else if (event.type === "end") break;
    else if (["ym2612-write", "ym2203-write", "ym2608-write", "ym2610-write"].includes(event.type) && event.type !== `${chipKind}-write`) warn(`${event.type} omitted`);
  }
  for (const ch of channels) {
    if (ch.active) ch.lines.push("; KEY still on at VGM end; interval truncated");
    finish(ch, "vgmEnd");

  }
  return { chipKind, chipName, channels, time, clock, parserHeader: parser.header, warnings, patches };
}
