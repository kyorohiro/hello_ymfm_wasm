import {Ym2612VGM} from '../js/ym2612vgm.js';

/** Preserve RF5C bank semantics while recording a single RF/FM/PSG timeline. */
export function exportRf5c164Vgm(buffer, {mode = 'write', includeDac = true, includePsg = true, writeMemoryFile} = {}) {
  if (!['write', 'high'].includes(mode)) throw new Error('RF5C164 conversion supports Write or High only.');
  const warnings = [];
  const parser = new Ym2612VGM(buffer, {logger:{warn:m=>warnings.push(m)}});
  const clock = parser.header.rf5c164Clock;
  if ((clock & 0x40000000) || (clock & 0x3fffffff) !== 12500000) throw new Error('RF5C164 conversion requires a single 12500000 Hz chip.');
  if (includePsg && (parser.header.psgClock & 0x40000000)) throw new Error('Dual PSG is unsupported; turn off Include PSG.');
  if (parser.header.ym2612Clock & 0x40000000) throw new Error('Dual YM2612 is unsupported.');
  let bank = 0, time = 0, count = 0;
  const events = [], blocks = [];
  const record = code => events.push({time, code});
  const memory = (data, offset) => {
    const address = bank | offset;
    if (address + data.length > 65536) throw new Error('RF5C164 banked RAM transfer exceeds 64 KiB.');
    const id = blocks.length;
    blocks.push(data.slice());
    record(`sendRf(rf.loadMemory(ram${id}, ${address}));`);
  };
  const targets = {
    rf5c164: {
      writeRegister(r,v) {
        if (r > 8) throw new Error('Unsupported RF5C164 register.');
        if (r === 7 && !(v & 0x40)) bank = (v & 15) << 12;
        count++;record(`sendRf(rf.writeRegister(${r}, ${v}));`);
        Object.assign(events.at(-1), {register:r, value:v});
      },
      writeMemory(offset,value) {count++;memory(Uint8Array.of(value),offset);},
      loadBankedMemory(data,offset) {count++;memory(data,offset);},
    },
    writeRegister(r,v,port=0) {
      if (includeDac || port !== 0 || (r !== 0x2a && r !== 0x2b)) record(`write(${port}, ${r}, ${v});`);
    },
    psg: {write(value) {if (includePsg) record(`psg.write(${value});`);}},
  };
  for (;;) {
    const event = parser.playStep(targets);
    if (event.type === 'wait') parser.consumeWait(targets,event.samples,n=>{time+=n;});
    if (warnings.length) throw new Error(`Cannot convert this stream without loss: ${warnings[0]}`);
    if (event.type === 'end') break;
  }
  if (!count) throw new Error('No RF5C164 operations were found.');
  const lines = [`// RF5C164 ${mode === 'high' ? 'High (exact-write API + raw fallback)' : 'Write'}: one pass. Original 44100 Hz wait units.`,
    '// Async RPC and waits are not sample-accurate scheduling. Use YM2612 Playground for mixed FM/PSG.',
    '// Files are read before playback; chip RAM transfers remain at their original positions.'];
  if (includePsg && parser.header.psgClock && (parser.header.psgClock & 0x3fffffff) !== 3579545) lines.push('// PSG playback uses 3579545 Hz; source clock differs.');
  blocks.forEach((data,i)=>{
    // A single-byte memory write does not need its own project file.
    const path = data.length > 1 ? writeMemoryFile?.(data) : null;
    lines.push(path ? `const ram${i} = new Uint8Array(await file(${JSON.stringify(path)}, {type: "arrayBuffer"}));` : `const ram${i} = new Uint8Array([${data.join(',')}]);`);
  });
  lines.push("const rf = await createSoundChip('rf5c164');",
    '// Send in port order without waiting for each AudioWorklet acknowledgement.',
    'const pendingRf = new Set();',
    'let rfError;',
    'function sendRf(result) {',
    '  const pending = Promise.resolve(result).then(',
    '    () => { pendingRf.delete(pending); },',
    '    error => { pendingRf.delete(pending); rfError ??= error; }',
    '  );',
    '  pendingRf.add(pending);',
    '}',
    'const startedAt = performance.now();',
    'async function waitRfUntil(sample) {',
    '  if (rfError) throw rfError;',
    '  const remaining = sample - (performance.now() - startedAt) * 44.1;',
    '  if (remaining > 0) await sleepSamples(remaining, 44100);',
    '  if (rfError) throw rfError;',
    '}',
    'try {');
  let previous = 0;
  for (const event of (mode === 'high' ? highRfEvents(events) : events)) {
    if (event.time > previous) lines.push(`  await waitRfUntil(${event.time});`);
    previous = event.time;
    lines.push(`  ${event.code} // t=${(event.time / 44100).toFixed(6)}s`);
  }
  if (time > previous) lines.push(`  await waitRfUntil(${time});`);
  lines.push('  await Promise.all(pendingRf);', '  if (rfError) throw rfError;', '} finally {', '  rf.dispose();', '}', '');
  return lines.join('\n');
}

/** Only replace contiguous, same-time sequences emitted exactly by the existing Synth API.
 * Never synthesize a selection, enable, mask toggle or missing byte of a register pair.
 */
function highRfEvents(events) {
  const output = [];
  let mask = 255;
  for (let i = 0; i < events.length;) {
    const event = events[i];
    const at = offset => {
      const next = events[i + offset];
      return next?.time === event.time && next.register !== undefined ? next : null;
    };
    let code, consumed = 1;
    const channel = event.value & 7;
    if (event.register === 7 && event.value === (0xc0 | channel)) {
      const a = at(1), b = at(2);
      if (a?.register === 8 && b?.register === 8 &&
          a.value === (mask | (1 << channel)) && b.value === (mask & ~(1 << channel))) {
        code = `rf.keyOn(${channel})`; consumed = 3;
      } else if (a) {
        if (a.register === 0) { code = `rf.setChannel(${channel}, {volume: ${a.value}})`; consumed = 2; }
        if (a.register === 1) { code = `rf.setChannel(${channel}, {pan: {left: ${a.value & 15}, right: ${a.value >> 4}}})`; consumed = 2; }
        if (a.register === 6) { code = `rf.setChannel(${channel}, {start: ${a.value * 256}})`; consumed = 2; }
        if (b && a.register === 2 && b.register === 3) { code = `rf.setPitch(${channel}, ${a.value | (b.value << 8)})`; consumed = 3; }
        if (b && a.register === 4 && b.register === 5) { code = `rf.setChannel(${channel}, {loopStart: ${a.value | (b.value << 8)}})`; consumed = 3; }
      }
    } else if (event.register === 8) {
      const changed = mask ^ event.value;
      if (changed && !(changed & (changed - 1)) && (event.value & changed)) {
        code = `rf.keyOff(${Math.log2(changed)})`;
      }
    }
    for (let k = 0; k < consumed; k++) {
      if (events[i + k].register === 8) mask = events[i + k].value;
    }
    output.push(code ? {...event, code: `sendRf(${code});`} : event);
    i += consumed;
  }
  return output;
}
