import {Ym2612VGM} from '../js/ym2612vgm.js';
import {detectVgmImport} from './playground_vgm_import.js';

/** Full OPNA Write export. All register/data events keep their original order. */
export function exportYm2608FullVgm(buffer, {mode = 'write', writeMemoryFile} = {}) {
  if (mode !== 'write') throw new Error('YM2608 full import currently supports Write only');
  const parser = new Ym2612VGM(buffer, {logger: null});
  const detection = detectVgmImport(parser.header);
  if (!detection.supported || detection.chip !== 'ym2608' || detection.chips.length !== 1) throw new Error('Expected single YM2608 VGM');
  const clock = parser.header.ym2608Clock & 0x3fffffff;
  if (clock < 100000 || clock > 20000000) throw new Error('Unsupported YM2608 clock');
  const events = [], blocks = []; let time = 0;
  for (;;) {
    const opcode = parser.bytes[parser.position];
    if (![0x56, 0x57, 0x61, 0x62, 0x63, 0x66, 0x67].includes(opcode) && !(opcode >= 0x70 && opcode <= 0x7f)) throw new Error('YM2608 import supports direct writes, waits and ADPCM-B blocks only');
    if (opcode === 0x67 && parser.bytes[parser.position + 2] !== 0x81) throw new Error('Unsupported YM2608 data block');
    const event = parser.step();
    if (event.type === 'end') break;
    if (event.type === 'wait') { time += event.samples; continue; }
    if (event.chipIndex) throw new Error('Dual YM2608 is unsupported');
    if (event.type === 'ym2608-adpcm-b-data') {
      event.block = blocks.length; blocks.push(event.data);
    } else if (event.type !== 'ym2608-write') throw new Error(`Unsupported YM2608 event: ${event.type}`);
    events.push({...event, time});
  }
  if (!events.length || !time) throw new Error('YM2608 stream must contain events and a positive duration');
  const lines = ['// YM2608 FM + SSG + rhythm + ADPCM-B. Write timing; entire stream repeats.',
    '// Rhythm uses the bundled ROM. Memory and register commands share one ordered port.',
    'const opna = await useSoundChip("ym2608");', `await opna.setClock(${clock});`];
  blocks.forEach((data, i) => {
    const path = writeMemoryFile?.(data);
    lines.push(path ? `const memory${i} = new Uint8Array(await file(${JSON.stringify(path)}, {type: "arrayBuffer"}));` : `const memory${i} = new Uint8Array([${data.join(',')}]);`);
  });
  lines.push(
    'liveLoop("ym2608", async () => {',
    '  const pendingMemory = new Set();',
    '  let memoryError;',
    '  function sendMemory(result) {',
    '    const pending = Promise.resolve(result).then(',
    '      () => { pendingMemory.delete(pending); },',
    '      error => { pendingMemory.delete(pending); memoryError ??= error; }',
    '    );',
    '    pendingMemory.add(pending);',
    '  }',
    '  opna.resetRegisters(); // Hardware reset without Synth setup writes.'
  );
  let previous = 0;
  for (const event of events) {
    if (event.time > previous) lines.push('  if (memoryError) throw memoryError;', `  await sleepSamples(${event.time - previous}, 44100);`, '  if (memoryError) throw memoryError;');
    previous = event.time;
    if (event.type === 'ym2608-adpcm-b-data') lines.push(`  sendMemory(opna.adpcm.loadMemory(memory${event.block}, ${event.offset}));`);
    else lines.push(`  opna.write(${event.port}, 0x${event.register.toString(16).padStart(2, '0')}, 0x${event.value.toString(16).padStart(2, '0')});`);
  }
  if (time > previous) lines.push(`  await sleepSamples(${time - previous}, 44100);`);
  lines.push('  await Promise.all(pendingMemory);', '  if (memoryError) throw memoryError;', '});', '');
  return lines.join('\n');
}
