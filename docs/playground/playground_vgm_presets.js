import { Ym2612VGM } from '../js/ym2612vgm.js';
import { createTfiFromPreset } from '../js/tfi.js';

// Snapshot OPN FM parameters at key-on. TFI does not retain pan, LFO,
// operator key masks, or the subsequent pitch/volume automation.
export function createVgmPresetFiles(buffer, filename, existingPaths = []) {
  const stem = String(filename).replace(/\.(vgm|vgz|s98)$/i, '')
    .replace(/[\\/\x00-\x1f:*?"<>|]/g, '_').replace(/^\.+$|[. ]+$/g, '') || 'vgm';
  const base = `/presets/${stem}`;
  let directory = base;
  let suffix = 2;
  const paths = new Set(existingPaths);
  while (paths.has(directory) || [...paths].some(path => path.startsWith(`${directory}/`))) {
    directory = `${base}-${suffix++}`;
  }
  const states = new Map();
  const files = [];
  const parser = new Ym2612VGM(buffer, { logger: null });
  for (;;) {
    const event = parser.step();
    if (event.type === 'end') break;
    if (!['ym2612-write', 'ym2203-write', 'ym2608-write', 'ym2610-write'].includes(event.type)) continue;
    const chip = event.type.slice(0, -6);
    if (!states.has(chip)) states.set(chip, {
      registers: [new Uint8Array(256), new Uint8Array(256)],
      seen: Array.from({ length: 6 }, () => new Set()),
    });
    const state = states.get(chip);
    const port = event.port ?? 0;
    state.registers[port][event.register] = event.value;
    if (port !== 0 || event.register !== 0x28 || !(event.value & 0xf0)) continue;
    const offset = event.value & 3;
    if (offset === 3) continue;
    const channel = offset + ((event.value & 4) ? 3 : 0);
    if (chip === 'ym2203' && channel >= 3) continue;
    if (chip === 'ym2612' && channel === 5 && (state.registers[0][0x2b] & 0x80)) continue;
    const regs = state.registers[channel >= 3 ? 1 : 0];
    const preset = {
      algorithm: regs[0xb0 + offset] & 7,
      feedback: (regs[0xb0 + offset] >> 3) & 7,
      operators: {},
    };
    [1, 3, 2, 4].forEach((operator, slot) => {
      const address = slot * 4 + offset;
      preset.operators[operator] = {
        multi: regs[0x30 + address] & 15,
        dt: (regs[0x30 + address] >> 4) & 7,
        tl: regs[0x40 + address] & 127,
        rs: regs[0x50 + address] >> 6,
        ar: regs[0x50 + address] & 31,
        d1r: regs[0x60 + address] & 31,
        d2r: regs[0x70 + address] & 31,
        sl: regs[0x80 + address] >> 4,
        rr: regs[0x80 + address] & 15,
        ssg: regs[0x90 + address] & 15,
      };
    });
    const data = createTfiFromPreset(preset);
    const signature = Array.from(data).join(',');
    const seen = state.seen[channel];
    if (seen.has(signature)) continue;
    seen.add(signature);
    files.push({
      path: `${directory}/${chip}_ch${channel + 1}_${String(seen.size).padStart(3, '0')}.tfi`,
      data,
    });
  }
  return files;
}
