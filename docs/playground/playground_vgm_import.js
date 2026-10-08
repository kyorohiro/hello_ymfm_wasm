import {ym2203HighOperation} from './ym2203_high.js';
import {exportRf5c164Vgm} from './rf5c164_vgm_export.js?v=megacd-loops-2';
export {exportRf5c164Vgm} from './rf5c164_vgm_export.js?v=megacd-loops-2';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {maybeDecodeVgmFile} from '../js/vgm_file.js';
import {looksLikeS98, convertS98ToVgm} from '../js/s98_file.js';

const OPN = ['ym2203', 'ym2608', 'ym2610', 'ym2612'];
export function detectVgmImport(header) {
  const chips = Object.entries(header).filter(([key, value]) => key.endsWith('Clock') && (value & 0x3fffffff)).map(([key]) => key.slice(0, -5));
  const opn = chips.filter(chip => OPN.includes(chip));
  const rf5c164 = header.rf5c164Clock === 12500000 && (opn.length === 0 || (opn.length === 1 && opn[0] === 'ym2612'));
  const base = {chips, rf5c164, family: null, supported: false, message: ''};
  if (!chips.length) return {...base, message: 'No supported chip clock was found.'};
  if (opn.length === 1) {
    const chip = opn[0];
    if (header[chip + 'Clock'] & 0x40000000) return {...base, message: 'Dual OPN-chip conversion is not supported.'};
    const omittedChips = chips.filter(name => name !== chip && !(chip === 'ym2612' && name === 'psg') && !(rf5c164 && name === 'rf5c164'));
    const label = name => name === 'gameBoyDmg' ? 'Game Boy DMG' : name.toUpperCase();
    const psgNotice = chip === 'ym2612' && (header.psgClock & 0x40000000) ? ' Dual PSG is unsupported; turn off Include PSG to import FM/DAC only.' : '';
    const omitted = omittedChips.length ? ` ${omittedChips.map(label).join(' + ')} will be omitted.` : '';
    const scope = chip === 'ym2612'
      ? 'YM2612 FM will be imported; DAC and PSG follow their Include options. PSG playback requires the YM2612 Playground chip (3579545 Hz PSG; other source clocks may change pitch/noise rates).'
      : `${label(chip)} FM only; SSG, rhythm and ADPCM are omitted.`;
    return {...base, family: 'opn', supported: true, chip, omittedChips,
      message: `${scope}${omitted}${psgNotice}${rf5c164 ? ' Include RF5C164 enables Schedule / Write / High with liveLoop (Schedule applies to FM/DAC/PSG; RF5C164 uses Write). FM channel splitting and DAC options remain available. RF5C164 uses one shared register/RAM loop.' : ''} Select the matching Playground chip for native FM playback, or YM2612 for FM translation.`};
  }
  if (rf5c164 && chips.every(chip => ['rf5c164','psg'].includes(chip))) {
    return {...base, family:'rf5c164', supported:true, chip:'ym2612', message:'RF5C164 register and RAM conversion: Write / High, liveLoop, asynchronous timing. Schedule uses Write for RF5C164; accompanying FM/DAC/PSG are scheduled. Optional PSG requires the YM2612 Playground chip.'};
  }
  if (chips.some(chip => header[chip + 'Clock'] & 0x40000000)) return {...base, message: 'Dual-chip conversion is not supported.'};
  if (chips.length === 1 && chips[0] === 'gameBoyDmg') {
    if ((header.gameBoyDmgClock & 0x3fffffff) !== 4194304) return {...base, message: 'Game Boy conversion requires the standard 4194304 Hz clock.'};
    return {...base, family: 'gameboy', supported: true, message: 'All four channels. Register order and VGM sample waits are preserved for one pass; loops are not repeated. Playback uses asynchronous waits, not sample-accurate scheduling.'};
  }

  if (chips.length === 1 && chips[0] === 'nesApu') {
    if ((header.nesApuClock & 0x3fffffff) !== 1789773) return {...base, message: 'NES conversion requires the standard NTSC 1789773 Hz clock; PAL is not supported.'};
    const fds = !!(header.nesApuClock & 0x80000000);
    return {...base, family: 'nes', supported: true, fds, message: 'NES APU' + (fds ? ' + FDS' : '') + ': all channels and DMC RAM uploads. One pass; loops are not repeated. Playback uses asynchronous waits and RAM acknowledgements, not sample-accurate scheduling.'};
  }

  return {...base, message: chips.length > 1 ? 'This chip combination cannot be converted. No files will be changed.' : 'Conversion for this chip is not supported.'};
}

export async function prepareVgmImport(file) {
  const decoded = await maybeDecodeVgmFile(await file.arrayBuffer());
  const buffer = looksLikeS98(decoded) ? convertS98ToVgm(decoded).buffer : decoded;
  const vgm = new Ym2612VGM(buffer, {logger: null});
  let detection = detectVgmImport(vgm.header);
  // Validate the complete Game Boy stream before presenting conversion as available.
  if (detection.family === 'gameboy') {
    try { readGameboyEvents(buffer); }
    catch (error) { detection = {...detection, supported: false, message: error.message}; }
  }
  if (detection.family === 'nes') {
    try { readNesEvents(buffer, detection.fds); }
    catch (error) { detection = {...detection, supported: false, message: error.message}; }
  }
  if (detection.family === 'rf5c164') {
    try { exportRf5c164Vgm(buffer, {loop:false}); }
    catch (error) { detection = {...detection, supported:false, message:error.message}; }
  }
  return {buffer, vgm, detection};
}

function readGameboyEvents(buffer) {
  const warnings = [];
  const parser = new Ym2612VGM(buffer, {logger: {warn: message => warnings.push(message)}});
  const events = [];
  let time = 0;
  for (;;) {
    const command = parser.bytes[parser.position];
    if (![0xb3, 0x61, 0x62, 0x63, 0x66].includes(command) && !(command >= 0x70 && command <= 0x7f)) {
      throw new Error('Game Boy conversion supports direct register writes and waits only; this stream contains other commands.');
    }
    const event = parser.step();
    if (warnings.length) throw new Error(`Cannot preserve this Game Boy stream: ${warnings[0]}`);
    if (event.type === 'end') break;
    if (event.type === 'wait') { time += event.samples; continue; }
    if (event.type !== 'gameboy-dmg-write' || event.chipIndex || event.register > 0x2f) throw new Error(`Unsupported event in Game Boy stream: ${event.type}.`);
    events.push({...event, time});
  }
  if (!events.length) throw new Error('No Game Boy register writes were found.');
  return {events, time};
}

const hex = n => '0x' + n.toString(16).padStart(2, '0');
function describe(register, value, state) {
  const base = register < 5 ? 0 : register < 10 ? 5 : register < 15 ? 10 : 15;
  const channel = base / 5 + 1;
  if ([2, 7, 17].includes(register)) return `CH${channel} envelope: initial volume ${value >> 4}, ${value & 8 ? 'up' : 'down'}, period ${value & 7} (${value & 7 ? (value & 7) * 1000 / 64 + ' ms/step' : 'automatic change disabled'}); no retrigger`;
  if ([1, 6].includes(register)) return `CH${channel} duty ${[12.5,25,50,75][value >> 6]}%; length load ${value & 63}`;
  if (register === 0) return `CH1 sweep: period ${(value >> 4) & 7}, ${value & 8 ? 'down' : 'up'}, shift ${value & 7}`;
  if (register === 18) return `CH4 noise: divisor ${value & 7}, shift ${value >> 4}, width ${value & 8 ? 7 : 15}`;
  if (register === 22) return `APU power ${value & 128 ? 'ON' : 'OFF'}`;
  if (register === 10) return `CH3 DAC ${value & 128 ? 'ON' : 'OFF'}`;
  if (register === 12) return `CH3 output level ${[0,100,50,25][(value >> 5) & 3]}%`;
  if (register >= 32) return `wave RAM samples ${(register - 32) * 2}/${(register - 32) * 2 + 1}: ${value >> 4}, ${value & 15}; direct write (no added stop)`;
  if ([3,4,8,9,13,14].includes(register)) {
    const n = state[base + 3] | ((state[base + 4] & 7) << 8);
    return `CH${channel} written pitch ${(4194304 / ((channel === 3 ? 64 : 32) * (2048 - n))).toFixed(3)} Hz` + ([4,9,14].includes(register) ? `; trigger ${!!(value & 128)}, length enabled ${!!(value & 64)}` : '; no retrigger');
  }
  if (register === 19) return `CH4 trigger ${!!(value & 128)}, length enabled ${!!(value & 64)}`;
  if (register === 20) return `master volume L ${(value >> 4) & 7}, R ${value & 7}; VIN bits preserved`;
  if (register === 21) return 'channel routing (low nibble right, high nibble left)';
  return `register ${hex(0xff10 + register)}`;
}

// Only replace a write when the API emits exactly the same register bytes.
// state mirrors Synth's sent-register shadow, including cleared trigger bits.
function highOperation(event, next, state) {
  const {register: r, value: v, time} = event;
  if (!(state[22] & 128)) return null;
  if ([2,7,17].includes(r)) {
    const target = r === 17 ? 'noise' : 'pulse';
    const ch = r === 17 ? '' : `${r === 2 ? 0 : 1}, `;
    return {code: `gb.${target}.setEnvelope(${ch}{volume: ${v >> 4}, direction: '${v & 8 ? 'up' : 'down'}', period: ${v & 7}});`};
  }
  if ([1,6].includes(r) && (v & 63) === (state[r] & 63)) return {code: `gb.pulse.setDuty(${r === 1 ? 0 : 1}, ${[0.125,0.25,0.5,0.75][v >> 6]});`};
  if (r === 0 && (v & 128) === (state[0] & 128)) return {code: `gb.pulse.setSweep({direction: '${v & 8 ? 'down' : 'up'}', period: ${(v >> 4) & 7}, shift: ${v & 7}});`};
  if (r === 18) return {code: `gb.noise.setParameters({divisor: ${v & 7}, shift: ${v >> 4}, width: ${v & 8 ? 7 : 15}});`};
  if (r === 12 && (v & ~0x60) === (state[r] & ~0x60)) return {code: `gb.wave.setLevel(${[0,1,0.5,0.25][(v >> 5) & 3]});`};
  if (r === 20 && (v & 0x88) === (state[r] & 0x88)) return {code: `gb.setMasterVolume(${(v >> 4) & 7}, ${v & 7});`};
  if (r === 21) {
    for (let ch = 0; ch < 4; ch++) if (((v ^ state[r]) & ~(0x11 << ch)) === 0) return {code: `gb.setPan(${ch}, ${!!(v & (16 << ch))}, ${!!(v & (1 << ch))});`};
  }
  if ([3,8,13].includes(r) && next?.register === r + 1 && next.time === time &&
      !(next.value & 128) && (next.value & 0x78) === (state[r + 1] & 0x78)) {
    const n = v | ((next.value & 7) << 8);
    const hz = 4194304 / ((r === 13 ? 64 : 32) * (2048 - n));
    return {code: r === 13 ? `gb.wave.setFrequency(${hz});` : `gb.pulse.setFrequency(${r === 3 ? 0 : 1}, ${hz});`, paired: true};
  }
  return null;
}

export function exportGameboyVgm(buffer, {mode = 'raw'} = {}) {
  if (!['raw', 'readable', 'high'].includes(mode)) throw new Error('Unknown Game Boy conversion mode.');
  const detection = detectVgmImport(new Ym2612VGM(buffer, {logger: null}).header);
  if (!detection.supported || detection.family !== 'gameboy') throw new Error(detection.message || 'Expected Game Boy VGM.');
  const {events, time} = readGameboyEvents(buffer);
  const lines = [
    '// Game Boy VGM: one pass, original register order and 44100 Hz sample waits.',
    '// Asynchronous waits are not sample-accurate audio scheduling.',
    '// Envelope/sweep evolve in the chip. Comments describe writes, not internal live state.',
    "const gb = await createSoundChip('gameboy');", 'try {',
    '  gb.reset(); // Replay original power/setup writes without injecting initialize defaults.',
  ];
  const state = new Uint8Array(48);
  let previous = 0;
  const track = event => {
    if (event.register === 22 && !(event.value & 128)) state.fill(0, 0, 23);
    state[event.register] = [4,9,14,19].includes(event.register) ? event.value & 127 : event.value;
  };
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.time > previous) lines.push(`  await sleepSamples(${event.time - previous}, 44100);`);
    previous = event.time;
    const op = mode === 'high' ? highOperation(event, events[i + 1], state) : null;
    track(event);
    if (op?.paired) track(events[++i]);
    const comment = mode === 'raw' ? '' : ` // t=${(event.time / 44100).toFixed(6)}s (sample ${event.time}): ${describe(event.register, event.value, state)}`;
    const code = op?.code ?? `gb.writeRegister(${hex(event.register)}, ${hex(event.value)});`;
    lines.push(`  ${code}${comment}`);
    if (mode === 'high' && event.register === 22 && (event.value & 128)) {
      lines.push('  gb.adoptRegisterState(); // Use original setup; no added writes or reset.');
    }
  }
  if (time > previous) lines.push(`  await sleepSamples(${time - previous}, 44100);`);
  lines.push('} finally {', '  gb.dispose();', '}', '');
  return lines.join('\n');
}


/** Bind the imported FM code to the selected default FM without changing its timeline.
 * Native YM2608 still uses its implicit default FM API: useSoundChip('ym2608')
 * would create an additional chip and would not retarget write/play/DAC helpers.
 */
export function addVgmSoundChipSetup(source, detection, selectedChip) {
  if (detection.family !== 'opn' || !['ym2612', 'ym2203', 'ym2610'].includes(selectedChip)) return source;
  return `const fm = await useSoundChip(${JSON.stringify(selectedChip)});\n\n` + source;
}


/** Full single-chip YM2203 raw import, including SSG. Uses the additional-chip API. */
export function exportYm2203FullVgm(buffer, {mode = 'write'} = {}) {
  if (!['write', 'schedule', 'high'].includes(mode)) throw new Error('YM2203 supports Write, Schedule and High');
  const parser = new Ym2612VGM(buffer, {logger: null});
  const detection = detectVgmImport(parser.header);
  if (!detection.supported || detection.chip !== 'ym2203' || detection.chips.length !== 1) throw new Error('Expected single YM2203 VGM');
  const clock = parser.header.ym2203Clock & 0x3fffffff;
  if (clock < 100000 || clock > 20000000) throw new Error('Unsupported YM2203 clock');
  const events = []; let time = 0;
  for (;;) {
    const opcode = parser.bytes[parser.position];
    if (![0x55, 0x61, 0x62, 0x63, 0x66].includes(opcode) && !(opcode >= 0x70 && opcode <= 0x7f)) throw new Error('YM2203 import supports register writes and waits only');
    const event = parser.step();
    if (event.type === 'end') break;
    if (event.type === 'wait') time += event.samples;
    else if (event.type === 'ym2203-write') events.push([time, event.register, event.value]);
  }
  if (!events.length || !time) throw new Error('YM2203 stream must contain writes and a positive duration');
  const lines = ['// YM2203 FM + SSG. Repeats the entire stream in one shared chip loop.',
    'const opn = await useSoundChip("ym2203");', `await opn.setClock(${clock});`];
  if (mode === 'schedule') {
    lines.push(`const writes = ${JSON.stringify(events)};`, 'liveLoop("ym2203", async () => {', '  opn.reset();', `  await opn.scheduleRegisters(writes, ${time});`, '});');
  } else {
    lines.push('// Write uses Playground waits; Schedule executes writes on the audio thread.', 'liveLoop("ym2203", async () => {', '  opn.reset();');
    let previous = 0;
    const registers = new Uint8Array(256);
    for (let index = 0; index < events.length; index++) {
      const [sample, register, value] = events[index];
      if (sample > previous) lines.push(`  await sleepSamples(${sample - previous}, 44100);`);
      const operation = mode === 'high' ? ym2203HighOperation(events, index, registers) : null;
      lines.push('  ' + (operation?.code ?? `opn.write(0, ${hex(register)}, ${hex(value)});`));
      const count = operation?.count ?? 1;
      for (let offset = 0; offset < count; offset++) {
        const [, r, v] = events[index + offset]; registers[r] = v;
      }
      index += count - 1; previous = sample;
    }
    if (time > previous) lines.push(`  await sleepSamples(${time - previous}, 44100);`);
    lines.push('});');
  }
  return lines.join('\n') + '\n';
}

/** Native CPU address corresponding to a packed VGM NES/FDS offset. */
function nesAddress(register, fds) {
  if (register <= 0x17) return 0x4000 + register;
  if (!fds) throw new Error('FDS writes require the NES FDS header flag.');
  if (register === 0x3f) return 0x4023;
  if (register >= 0x20 && register <= 0x2a) return 0x4080 + register - 0x20;
  if (register >= 0x40 && register <= 0x7f) return 0x4000 + register;
  throw new Error(`Unsupported NES/FDS register: ${hex(register)}.`);
}
function readNesEvents(buffer, fds) {
  const warnings = [];
  const parser = new Ym2612VGM(buffer, {logger: {warn: message => warnings.push(message)}});
  const events = []; let time = 0, writes = 0;
  for (;;) {
    const command = parser.bytes[parser.position];
    if (![0xb4, 0x67, 0x61, 0x62, 0x63, 0x66].includes(command) && !(command >= 0x70 && command <= 0x7f)) {
      throw new Error('NES conversion supports NES/FDS writes, NES RAM blocks and waits only.');
    }
    const event = parser.step();
    if (warnings.length) throw new Error(`Cannot preserve this NES stream: ${warnings[0]}`);
    if (event.type === 'end') break;
    if (event.type === 'wait') {time += event.samples; continue;}
    if (event.chipIndex || !['nes-apu-write', 'nes-apu-data'].includes(event.type)) throw new Error(`Unsupported NES event: ${event.type}.`);
    if (event.type === 'nes-apu-write') {event.address = nesAddress(event.register, fds); writes++;}
    events.push({...event, time});
  }
  if (!writes) throw new Error('No NES/FDS register writes were found.');
  return {events, time};
}
function describeNes(event, state) {
  const {address: r, value: v} = event;
  if (r >= 0x4040 && r <= 0x407f) return `FDS wave RAM sample ${r - 0x4040}: ${v & 63}`;
  if ([0x4000, 0x4004].includes(r)) return `pulse ${(r - 0x4000) / 4 + 1}: duty ${[12.5, 25, 50, 75][v >> 6]}%, ${v & 16 ? 'constant volume' : 'envelope period'} ${v & 15}, length halt/envelope loop ${!!(v & 32)}`;
  if ([0x4001, 0x4005].includes(r)) return `pulse sweep: enabled ${!!(v & 128)}, period ${(v >> 4) & 7}, negate ${!!(v & 8)}, shift ${v & 7}`;
  if (r === 0x4008) return `triangle linear counter ${v & 127}, control ${!!(v & 128)}`;
  if (r === 0x400e) return `noise period index ${v & 15}, short mode ${!!(v & 128)}`;
  if (r === 0x4010) return `DMC rate index ${v & 15}, loop ${!!(v & 64)}, IRQ ${!!(v & 128)}`;
  if (r === 0x4012) return `DMC sample address ${hex(0xc000 + v * 64)}`;
  if (r === 0x4013) return `DMC sample length ${v * 16 + 1} bytes`;
  if (r === 0x4015) return 'APU channel enables / DMC start-stop';
  if (r === 0x4017) return `frame counter: ${v & 128 ? 5 : 4}-step, IRQ inhibited ${!!(v & 64)}`;
  if (r === 0x4023) return `FDS I/O enable ${!!(v & 2)}`;
  if (r === 0x4080) return `FDS volume: ${v & 128 ? 'direct gain' : 'envelope speed'} ${v & 63}`;
  if ([0x4082, 0x4083].includes(r)) return `FDS frequency step ${state[0x82] | ((state[0x83] & 15) << 8)}, wave halt ${!!(state[0x83] & 128)}`;
  if (r >= 0x4084 && r <= 0x4088) return 'FDS modulation / envelope register';
  if (r === 0x4089) return `FDS master scale ${v & 3}, wave RAM write enable ${!!(v & 128)}`;
  return `native register ${hex(r)}`;
}
// Each substitution emits exactly the original bytes, in the original order.
function nesHighOperation(event, next, state) {
  const {address: r, value: v} = event;
  if ([0x4000, 0x4004].includes(r)) {
    const duty = [0.125, 0.25, 0.5, 0.75][v >> 6], channel = (r - 0x4000) / 4;
    if ((v & 0x30) === 0x30) return {code: `nes.pulse.setVoice(${channel}, {duty: ${duty}, volume: ${v & 15}});`, count: 1};
    if (!(v & 16)) return {code: `nes.pulse.setVoice(${channel}, {duty: ${duty}, envelope: {period: ${v & 15}, loop: ${!!(v & 32)}}});`, count: 1};
  }
  if (!next || next.type !== 'nes-apu-write' || next.time !== event.time) return null;
  if ([0x4002, 0x4006, 0x400a].includes(r) && next.address === r + 1 && (next.value & 0xf8) === 8) {
    const channel = (r - 0x4002) / 4, period = v | ((next.value & 7) << 8);
    if (period >= (channel === 2 ? 2 : 8)) return {code: `nes.setFrequency(${channel}, ${1789773 / ((channel === 2 ? 32 : 16) * (period + 1))});`, count: 2};
  }
  if (r === 0x4082 && next.address === 0x4083 && (next.value & 0xf0) === (state[0x83] & 0xc0)) {
    const step = v | ((next.value & 15) << 8);
    if (step) return {code: `nes.setFrequency(5, ${step * 1789773 / 4194304});`, count: 2};
  }
  if (r === 0x400c && (v & 0xf0) === 0x30 && next.address === 0x400e && !(next.value & 0x70)) {
    return {code: `nes.noise.setVoice({volume: ${v & 15}, period: ${next.value & 15}, shortMode: ${!!(next.value & 128)}});`, count: 2};
  }
  return null;
}
/** NES APU + optional FDS, including arbitrary DMC RAM uploads. */
export function exportNesVgm(buffer, {mode = 'raw'} = {}) {
  if (!['raw', 'readable', 'high'].includes(mode)) throw new Error('Unknown NES conversion mode.');
  const detection = detectVgmImport(new Ym2612VGM(buffer, {logger: null}).header);
  if (!detection.supported || detection.family !== 'nes') throw new Error(detection.message || 'Expected NES VGM.');
  const {events, time} = readNesEvents(buffer, detection.fds);
  const lines = ['// NES APU' + (detection.fds ? ' + FDS' : '') + ': one pass, original write order and 44100 Hz sample waits.',
    '// Asynchronous waits and RAM acknowledgements are not sample-accurate audio scheduling.',
    '// Comments describe register writes, not live envelope/sweep state.',
    `const nes = await createSoundChip('nes', {fds: ${detection.fds}});`, 'try {',
    '  nes.resetRegisters(); // Native reset, without Synth voice defaults.'];
  const state = new Uint8Array(0x90); let previous = 0;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.time > previous) lines.push(`  await sleepSamples(${event.time - previous}, 44100);`);
    if (event.type === 'nes-apu-data') {
      lines.push(`  await nes.loadMemory(Uint8Array.from(${JSON.stringify([...event.data])}), ${hex(event.offset)});`);
    } else {
      const operation = mode === 'high' ? nesHighOperation(event, events[i + 1], state) : null;
      const count = operation?.count ?? 1;
      for (let j = 0; j < count; j++) {
        const item = events[i + j]; state[item.address - 0x4000] = item.value;
        if (mode !== 'raw') lines.push(`  // ${item.time} samples: ${describeNes(item, state)}`);
      }
      lines.push('  ' + (operation?.code ?? `nes.writeRegister(${hex(event.address)}, ${hex(event.value)});`));
      i += count - 1;
    }
    previous = event.time;
  }
  if (time > previous) lines.push(`  await sleepSamples(${time - previous}, 44100);`);
  lines.push('} finally { nes.dispose(); }');
  return lines.join('\n') + '\n';
}
