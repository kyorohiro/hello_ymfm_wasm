import {Ym2612VGM, rawCommandLength} from '../js/ym2612vgm.js?v=pokey-vgm-1';

// Bound both a hostile source and expansion of looping/high-rate DAC streams.
// These are conversion limits, not new playback/scheduling capabilities.
export const WONDERSWAN_VGM_IMPORT_LIMITS = Object.freeze({
  sourceBytes: 16 * 1024 * 1024,
  bankBytes: 16 * 1024 * 1024,
  bankCopyBytes: 64 * 1024 * 1024,
  writes: 1000000,
  pcmBytes: 64 * 1024 * 1024,
  timelineBytes: 8 * 1024 * 1024,
  sourceCharacters: 64 * 1024 * 1024,
  recursiveCommands: 256,
  durationSamples: 0xffffffff,
});

const hex = value => `0x${value.toString(16).padStart(2, '0')}`;
const fail = message => { throw new Error(`WonderSwan VGM import: ${message}`); };

function checkHeader(parser) {
  const clocks = Object.entries(parser.header).filter(([key, value]) => key.endsWith('Clock') && (value & 0x3fffffff));
  const rawClock = parser.header.wonderswanClock;
  if (clocks.length !== 1 || clocks[0][0] !== 'wonderswanClock') fail('requires a single WonderSwan chip; mixed-chip files are unsupported.');
  if (rawClock & 0xc0000000) fail('dual chips and clock variant flags are unsupported.');
  const clock = rawClock & 0x3fffffff;
  if (clock < 100000 || clock > 100000000) fail('clock must be 100000..100000000 Hz.');
  // The shared parser exposes only its playable chip clocks. Check the full
  // VGM clock table too, so e.g. an unimplemented POKEY declaration cannot be
  // mistaken for a single-chip file. Offsets follow libvgm VGMPlayer::_CHIPCLK_OFS.
  const clockOffsets = [0x0c,0x10,0x2c,0x30,0x38,0x40,0x44,0x48,0x4c,0x50,0x54,0x58,0x5c,0x60,0x64,0x68,0x6c,0x70,0x74,0x80,0x84,0x88,0x8c,0x90,0x98,0x9c,0xa0,0xa4,0xa8,0xac,0xb0,0xb4,0xb8,0xc0,0xc4,0xc8,0xcc,0xd0,0xd8,0xdc,0xe0,0xe4,0xe8,0xec,0xf0,0xf4,0xf8,0xfc];
  for (const offset of clockOffsets) if (offset !== 0xc0 && offset + 4 <= parser.header.dataOffset && offset + 4 <= parser.bytes.length && parser.view.getUint32(offset, true)) fail(`mixed-chip clock at header ${hex(offset)} is unsupported.`);
  if (0xc0 <= parser.header.dataOffset && parser.bytes.length >= 0xc0 && parser.view.getUint32(0xbc, true)) fail('extra-header clock/volume overrides are unsupported.');
  return clock;
}

/** Validate commands before parser.step() can recursively skip metadata.
 * Keep the existing parser as the sole implementation of timed DAC streams.
 */
function validateCommands(parser) {
  const {bytes, view, header} = parser;
  const declaredEnd = view.getUint32(4, true) + 4;
  const end = declaredEnd === 4 ? bytes.length : declaredEnd;
  if (header.dataOffset < 0xc4 || header.dataOffset >= end || end > bytes.length) fail('invalid data/EOF offset.');
  const configured = new Map(), blocks = new Map(), bankLengths = new Map();
  let position = header.dataOffset, recursive = 0, bankBytes = 0, bankCopyBytes = 0;
  const enough = length => { if (position + length > end) fail('truncated command stream.'); };
  const configuredStream = id => {
    if (id === 255 || !configured.has(id)) fail('DAC stream must first select a WonderSwan target.');
    return configured.get(id);
  };
  while (position < end) {
    const command = bytes[position];
    if (![0xbc, 0xc6, 0x61, 0x62, 0x63, 0x66, 0x67, 0x90, 0x91, 0x92, 0x93, 0x94, 0x95].includes(command) && !(command >= 0x70 && command <= 0x7f)) {
      fail(`unsupported command ${hex(command)}; Hyper Voice, DMA and other chips cannot be converted.`);
    }
    // rawCommandLength reads block/stream lengths, so first require their header.
    enough(command === 0x67 ? 7 : 1);
    const length = rawCommandLength(bytes, view, position);
    enough(length);
    if (command === 0x66) return;
    if (command === 0xbc) {
      if (bytes[position + 1] & 128) fail('second-chip register writes are unsupported.');
      if (bytes[position + 1] > 31) fail('only I/O 0x80..0x9f is supported; Hyper Voice and DMA are unsupported.');
    } else if (command === 0xc6) {
      if (bytes[position + 1] & 128) fail('second-chip RAM writes are unsupported.');
      if ((bytes[position + 1] << 8 | bytes[position + 2]) >= 0x4000) fail('RAM write exceeds 16 KiB.');
    } else if (command === 0x67) {
      if (bytes[position + 1] !== 0x66) fail('invalid data-block marker.');
      if (view.getUint32(position + 3, true) & 0x80000000) fail('second-chip data blocks are unsupported.');
      const bank = bytes[position + 2];
      if (bank >= 0x40) fail('only uncompressed DAC stream data banks are supported; compressed/ROM/RAM blocks cannot be converted.');
      bankBytes += length - 7;
      if (bankBytes > WONDERSWAN_VGM_IMPORT_LIMITS.bankBytes) fail('data banks exceed the 16 MiB conversion limit.');
      const joinedLength = (bankLengths.get(bank) ?? 0) + length - 7;
      bankCopyBytes += joinedLength;
      if (bankCopyBytes > WONDERSWAN_VGM_IMPORT_LIMITS.bankCopyBytes) fail('fragmented data banks exceed the bounded bank-copy work limit.');
      bankLengths.set(bank, joinedLength);
      const list = blocks.get(bank) ?? []; list.push(length - 7); blocks.set(bank, list);
    } else if (command >= 0x90 && command <= 0x95) {
      const id = bytes[position + 1];
      if (command === 0x90) {
        if (id === 255 || bytes[position + 2] !== 0x21) fail('DAC streams must target the first WonderSwan chip (type 0x21); second/mixed targets are unsupported.');
        if (bytes[position + 3] !== 0 || bytes[position + 4] > 31) fail('DAC streams require port 0 and relative I/O 0x00..0x1f; Hyper Voice and DMA are unsupported.');
        configured.set(id, {});
      } else if (command === 0x94 && id === 255) {
        // The one reserved stream ID with a defined meaning: stop all streams.
      } else {
        const stream = configuredStream(id);
        if (command === 0x91) {
          if (bytes[position + 2] >= 0x40 || bytes[position + 3] === 0) fail('invalid DAC bank or zero step size.');
          stream.bank = bytes[position + 2];
        } else if (command === 0x92) {
          stream.frequency = view.getUint32(position + 2, true);
          if (!stream.frequency) fail('DAC stream frequency must be positive.');
        } else if (command === 0x93 || command === 0x95) {
          if (!stream.frequency || stream.bank === undefined || !blocks.has(stream.bank)) fail('DAC stream start requires configured frequency and an existing data bank.');
          if (command === 0x93) {
            const mode = bytes[position + 6];
            if ((mode & ~0x93) || (mode & 15) > 3) fail('unsupported DAC stream length/flag mode.');
            if ((mode & 15) === 0 && !stream.started) fail('DAC resume mode requires an earlier configured stream length.');
          } else {
            if (bytes[position + 4] & ~0x11) fail('unsupported fast DAC stream flags.');
            if (view.getUint16(position + 2, true) >= blocks.get(stream.bank).length) fail('fast DAC stream block does not exist.');
          }
          stream.started = true;
        }
      }
    }
    if (command === 0x67 || command >= 0x90 && command <= 0x95) {
      if (++recursive > WONDERSWAN_VGM_IMPORT_LIMITS.recursiveCommands) fail('too many consecutive metadata commands; cannot safely parse this stream.');
    } else recursive = 0;
    position += length;
  }
  fail('missing end command.');
}

// Keep dense PCM out of object arrays and generated JavaScript. Each byte is
// preceded by its unsigned sample-time delta (base-128 varuint, at most 5 bytes).
// The byte budget also bounds decoder work: every write occupies >= 2 bytes.
function walkWonderSwanVgm(buffer, {packPcm = false, retain = true} = {}) {
  const size = buffer?.byteLength;
  if (!Number.isInteger(size) || size > WONDERSWAN_VGM_IMPORT_LIMITS.sourceBytes) fail('source exceeds the 16 MiB conversion limit or is not binary data.');
  const parser = new Ym2612VGM(buffer, {logger: {warn: message => fail(`cannot preserve this stream: ${message}`)}});
  const clock = checkHeader(parser);
  validateCommands(parser);
  const events = [], chunks = [], state = new Uint8Array(32);
  let time = 0, writes = 0, ordinaryWrites = 0, pcmWrites = 0, pcmBytes = 0, entries = 0, chunk, chunkOffset = 0, run = null, previousPcmTime = 0;
  const appendEvent = event => {
    if (++entries > WONDERSWAN_VGM_IMPORT_LIMITS.writes) fail(packPcm
      ? 'ordinary writes and PCM runs exceed the 1000000-entry conversion limit.'
      : 'expanded stream exceeds the 1000000-write conversion limit.');
    if (packPcm && entries * 32 + pcmBytes > WONDERSWAN_VGM_IMPORT_LIMITS.timelineBytes) fail('prepared timeline exceeds the 8 MiB playback limit.');
    if (retain) events.push(event);
  };
  const appendByte = value => {
    if (++pcmBytes > WONDERSWAN_VGM_IMPORT_LIMITS.pcmBytes) fail('packed Voice PCM exceeds the 64 MiB conversion memory/work limit.');
    if (packPcm && entries * 32 + pcmBytes > WONDERSWAN_VGM_IMPORT_LIMITS.timelineBytes) fail('prepared timeline exceeds the 8 MiB playback limit.');
    if (!retain) return;
    if (!chunk || chunkOffset === chunk.length) { chunk = new Uint8Array(65536); chunks.push(chunk); chunkOffset = 0; }
    chunk[chunkOffset++] = value;
  };
  const capture = (type, address, value) => {
    writes++;
    if (packPcm && type === 'register' && address === 0x89 && (state[16] & 32)) {
      if (!run) {
        run = {type:'pcm', time, offset:pcmBytes, length:0, count:0, endTime:time};
        previousPcmTime = time; appendEvent(run);
      }
      let delta = time - previousPcmTime;
      do { const low = delta % 128; delta = Math.floor(delta / 128); appendByte(low | (delta ? 128 : 0)); } while (delta);
      appendByte(value); pcmWrites++;
      run.count++; run.length = pcmBytes - run.offset; run.endTime = time; previousPcmTime = time;
    } else {
      run = null; ordinaryWrites++;
      appendEvent(retain ? {type, address, value, time} : null);
    }
    if (type === 'register') state[address - 0x80] = value;
  };
  const targets = {wonderswan: {
    writeRegister: (register, value) => capture('register', 0x80 + register, value),
    writeMemory: (address, value) => capture('memory', address, value),
  }};
  for (;;) {
    const previous = parser.position;
    const event = parser.playStep(targets);
    if (parser.position <= previous) fail('parser did not advance.');
    if (event.type === 'end') break;
    if (event.type === 'wait') {
      if (!Number.isInteger(event.samples) || event.samples < 0 || time + event.samples > WONDERSWAN_VGM_IMPORT_LIMITS.durationSamples) fail('invalid or excessive total sample duration.');
      parser.consumeWait(targets, event.samples, samples => { time += samples; });
    } else if (!['wonderswan-write', 'wonderswan-memory-write'].includes(event.type)) fail(`unexpected parsed event ${event.type}.`);
  }
  if (!writes) fail('no register or RAM writes were found.');
  const stats = {time, clock, writes, ordinaryWrites, pcmWrites, pcmBytes};
  if (!retain) return stats;
  if (!packPcm) return {events, time, clock};
  const pcmData = new Uint8Array(pcmBytes);
  let offset = 0;
  for (let index = 0; index < chunks.length; index++) {
    const bytes = index === chunks.length - 1 ? chunks[index].subarray(0, chunkOffset) : chunks[index];
    pcmData.set(bytes, offset); offset += bytes.length;
  }
  return {...stats, events, pcmData};
}

/** Materialize the original one-pass timed trace, optionally packing only
 * authored CH2 Voice PCM. The shared parser remains the sole stream decoder.
 */
export function readWonderSwanVgm(buffer, options = {}) { return walkWonderSwanVgm(buffer, options); }

/** Full bounded preflight without retaining writes or packed PCM bytes. */
export function validateWonderSwanVgm(buffer) { return walkWonderSwanVgm(buffer, {packPcm:true, retain:false}); }

function description(event, state, clock) {
  const {address, value} = event;
  if (event.type === 'memory') return `packed wave RAM; samples ${value & 15}, ${value >> 4} (low nibble first)`;
  if (address <= 0x87) {
    const channel = (address - 0x80) >> 1, period = 2048 - (state[channel * 2] | (state[channel * 2 + 1] & 7) << 8);
    return `CH${channel + 1} written base pitch ${(Math.floor(clock / 128) * 128 / (32 * period)).toFixed(3)} Hz; no added trigger`;
  }
  if (address >= 0x88 && address <= 0x8b) return address === 0x89 && state[16] & 32 ? 'CH2 unsigned 8-bit voice PCM' : `CH${address - 0x87} hardware volume L ${value >> 4}, R ${value & 15}`;
  return ({0x8c:'CH3 signed sweep step', 0x8d:'CH3 sweep time', 0x8e:'CH4 noise type/reset', 0x8f:'wave RAM bank; physical RAM is retained', 0x90:'channel enables and Voice/Sweep/Noise modes', 0x91:'headphone/speaker output control', 0x92:'noise shift register low byte', 0x93:'noise shift register high byte', 0x94:'CH2 voice PCM routing/volume', 0x9e:'stored system volume'})[address] ?? 'original hardware register write';
}

/** Convert a single WonderSwan VGM to an editable, one-pass Playground file.
 * High mode substitutes only operations producing the identical ordered bytes.
 */
export function exportWonderSwanVgm(buffer, {mode = 'raw', writePcmFile} = {}) {
  if (!['raw', 'readable', 'high'].includes(mode)) throw new Error('Unknown WonderSwan conversion mode.');
  const {events, time, clock, pcmData} = readWonderSwanVgm(buffer, {packPcm:true});
  const lines = []; let characters = 0;
  const append = line => {
    characters += line.length + 1;
    if (characters > WONDERSWAN_VGM_IMPORT_LIMITS.sourceCharacters) fail('generated JavaScript exceeds the 64 MiB conversion limit; provide writePcmFile for large Voice PCM.');
    lines.push(line);
  };
  [
    '// WonderSwan VGM: all four channels, wave RAM, Noise, Sweep and unsigned Voice PCM.',
    '// One pass; original register/RAM order and 44100 Hz sample waits. VGM loops are not repeated.',
    '// The complete score is prepared first, then applied at sample boundaries by the audio renderer.',
    '// Edit score.at(sample) and score operations; PCM bytes stay in the accompanying data file.',
  ].forEach(append);
  if (pcmData.length) {
    const path = writePcmFile?.(pcmData);
    append('// CH2 Voice PCM only: unsigned sample delta varuint followed by the original byte.');
    if (!path) {
      // Count before join() so the standalone fallback never allocates an
      // oversized temporary source string for an otherwise valid binary file.
      let inlineCharacters = characters + 'const wsPcm = new Uint8Array([]);'.length;
      for (const value of pcmData) {
        inlineCharacters += value < 10 ? 2 : value < 100 ? 3 : 4;
        if (inlineCharacters > WONDERSWAN_VGM_IMPORT_LIMITS.sourceCharacters) fail('inline Voice PCM exceeds the 64 MiB JavaScript limit; provide writePcmFile.');
      }
    }
    append(path
      ? `const wsPcm = new Uint8Array(await file(${JSON.stringify(path)}, {type: "arrayBuffer"}));`
      : `const wsPcm = new Uint8Array([${pcmData.join(',')}]);`);
    append(`if (wsPcm.length !== ${pcmData.length}) throw new Error('WonderSwan PCM: invalid data length.');`);
    append('const wsPcmRuns = [');
    for (const event of events) if (event.type === 'pcm') append(`  [${event.time}, ${event.offset}, ${event.length}, ${event.count}, ${event.endTime}],`);
    append(']; // [first sample, byte offset, byte length, write count, last sample]');
    [
      "function invalidWsPcm() { throw new Error('WonderSwan PCM: malformed sample deltas or data.'); }",
      'function wsPcmCursor(run) { return {position: run[1], end: run[1] + run[2], remaining: run[3], count: run[3], sample: run[0], last: run[4]}; }',
      'function readWsPcm(cursor) {',
      '  let delta = 0, multiplier = 1, byte;',
      '  for (let index = 0; index < 5; index++) {',
      '    if (cursor.position >= cursor.end) invalidWsPcm();',
      '    byte = wsPcm[cursor.position++];',
      '    if (index === 4 && byte > 15) invalidWsPcm();',
      '    delta += (byte & 127) * multiplier;',
      '    if (!(byte & 128)) { if (index > 0 && !(byte & 127)) invalidWsPcm(); break; }',
      '    multiplier *= 128;',
      '  }',
      '  if (byte & 128 || cursor.remaining === cursor.count && delta !== 0 || cursor.position >= cursor.end) invalidWsPcm();',
      '  cursor.sample += delta; cursor.remaining--;',
      '  if (cursor.sample > cursor.last) invalidWsPcm();',
      '  return wsPcm[cursor.position++];',
      '}',
      'function finishWsPcm(cursor) { if (cursor.position !== cursor.end || cursor.sample !== cursor.last) invalidWsPcm(); }',
      '// Validate every run before creating an owned chip or sending any writes.',
      'for (const run of wsPcmRuns) { const cursor = wsPcmCursor(run); while (cursor.remaining) readWsPcm(cursor); finishWsPcm(cursor); }',
    ].forEach(append);
  }
  [
    "const ws = await createSoundChip('wonderswan');", 'try {',
    `  const score = ws.createTimeline({clock: ${clock}${pcmData.length ? ', pcmData: wsPcm' : ''}});`,
  ].forEach(append);
  if (mode === 'high') append('  score.adoptRegisterState(); // Authoring permission only; no register/RAM writes.');
  const state = new Uint8Array(32); let previous = 0;
  for (let index = 0; index < events.length; index++) {
    const event = events[index], next = events[index + 1];
    if (event.time > previous) append(`  score.at(${event.time});`);
    previous = event.time;
    if (event.type === 'pcm') {
      append(`  score.pcm(${event.offset}, ${event.length}, ${event.count}, ${event.endTime}); // CH2 Voice PCM: ${event.count} original writes, samples ${event.time}..${event.endTime}.`);
      previous = event.endTime;
      continue;
    }
    let code, paired = false;
    if (event.type === 'memory') code = `score.writeMemory(${hex(event.address)}, ${hex(event.value)});`;
    else {
      if (mode === 'high') {
        if (event.address === 0x89 && state[16] & 32) code = `score.writeVoice(${event.value});`;
        else if (event.address >= 0x88 && event.address <= 0x8b) code = `score.setVolume(${event.address - 0x88}, ${event.value >> 4}, ${event.value & 15});`;
        else if (event.address <= 0x86 && !(event.address & 1) && next?.type === 'register' && next.address === event.address + 1 && next.time === event.time && next.value <= 7) {
          const period = 2048 - (event.value | next.value << 8);
          code = `score.setFrequency(${(event.address - 0x80) >> 1}, ${Math.floor(clock / 128) * 128 / (32 * period)});`;
          paired = true;
        }
      }
      code ??= `score.writeRegister(${hex(event.address)}, ${hex(event.value)});`;
      state[event.address - 0x80] = event.value;
      if (paired) { state[next.address - 0x80] = next.value; index++; }
    }
    const comment = mode === 'raw' ? '' : ` // sample ${event.time}: ${description(event, state, clock)}`;
    append(`  ${code}${comment}`);
  }
  append(`  await ws.prepareTimeline(score.finish(${time}));`);
  append('  await ws.playTimeline(); // Wait for audio completion, without JS timers per PCM byte.');
  lines.push('} finally {', '  ws.dispose();', '}', '');
  return lines.join('\n');
}
