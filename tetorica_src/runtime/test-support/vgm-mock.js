/**
 * @file vgm-mock.js
 * 実行環境: Node.js のテスト用（ヘルパー自体は Browser でも使用可能）
 * 依存: JavaScript のデータ処理。DOM・Web Audio への依存なし。
 */
// Test-only VGM envelope: commands and expected traces stay explicit in tests.
export function vgmBytes(commands) {
  const bytes = new Uint8Array(0x100 + commands.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x56, 0x67, 0x6d, 0x20]);
  view.setUint32(4, bytes.length - 4, true);
  view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 0xcc, true);
  bytes.set(commands, 0x100);
  return bytes;
}

export function mockChips() {
  const trace = [], warnings = [], registry = new Map();
  let sample = 0;
  const record = (chip, instance, method, args) => trace.push({sample, chip, instance, method, args});
  const targets = {};
  for (const chip of ['psg','ay8910','ym2413','ym2151','ym2203','ym2608','ym2610','ym2612','ym3526','ym3812','y8950','ymf262','ymf278b','pwm','rf5c164']) {
    const target = {
      writeRegister(register, value, port = 0) { record(chip, 0, 'register', [port, register, value]); },
      write(value) { record(chip, 0, 'write', [value]); },
      writeMemory(offset, value) { record(chip, 0, 'memory-write', [offset, value]); },
      loadSampleMemory(data, offset, size) { record(chip, 0, 'samples', [offset, size, [...data]]); },
      loadAdpcmBMemory(data, offset, size) { record(chip, 0, 'adpcm-b', [offset, size, [...data]]); },
      loadAdpcmRom(type, data, offset, size) { record(chip, 0, 'adpcm-rom', [type, offset, size, [...data]]); },
      loadBankedMemory(data, offset) { record(chip, 0, 'banked-memory', [offset, [...data]]); },
    };
    targets[chip] = target;
    registry.set(`${chip}:0`, target);
  }
  return {
    trace, warnings, targets,
    logger: {warn: message => warnings.push(message)},
    resolveChip(type, index) {
      const target = registry.get(`${type}:${index}`);
      if (!target) throw new Error(`Unregistered mock chip ${type}:${index}`);
      return target;
    },
    run(parser, {splitWait = Infinity} = {}) {
      if (!(splitWait > 0)) throw new Error('Invalid wait partition');
      // Bound event traversal so broken end handling fails rather than hangs.
      for (let steps = 0; !parser.ended; steps++) {
        if (steps >= 10000) throw new Error('VGM did not terminate');
        const event = parser.playStep(targets);
        if (event.type === 'wait') {
          for (let remaining = event.samples; remaining > 0;) {
            const count = Math.min(remaining, splitWait);
            parser.consumeWait(targets, count, elapsed => { sample += elapsed; });
            remaining -= count;
          }
        }
      }
      return trace;
    },
    clear() { sample = 0; trace.length = 0; warnings.length = 0; },
    get sample() { return sample; },
  };
}
