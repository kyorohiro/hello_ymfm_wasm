// DX7 VCED/VMEM layout: Yamaha PLG150-DX MIDI Data Format, pp. 50, 54–56:
// https://usa.yamaha.com/files/download/other_assets/1/318161/PLG150DXE.pdf
// Operator order and packing agree with msfa's Apache-2.0 patch.cc:
// https://github.com/google/music-synthesizer-for-android/blob/master/app/src/main/jni/patch.cc

const VOICE_BYTES = 155;
const PACKED_BYTES = 128;
const BANK_VOICES = 32;
const OPERATOR_MAX = [99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 3, 3, 7, 3, 7, 99, 1, 31, 99, 14];
const COMMON_MAX = [99, 99, 99, 99, 99, 99, 99, 99, 31, 7, 1, 99, 99, 99, 99, 1, 5, 7, 48];

function byteView(input, description, expectedLength) {
  let bytes;
  if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    throw new TypeError(`${description} must be an ArrayBuffer or ArrayBuffer view.`);
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new RangeError(`${description} must contain exactly ${expectedLength} bytes; received ${bytes.length}.`);
  }
  return bytes;
}

function validateSevenBit(bytes, description) {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] > 127) {
      throw new RangeError(`${description} byte ${i} is not a 7-bit MIDI value.`);
    }
  }
}

function validateVoice(input) {
  const data = byteView(input, 'Unpacked DX7 voice', VOICE_BYTES);
  validateSevenBit(data, 'Unpacked DX7 voice');
  for (let i = 0; i < 145; i++) {
    const max = i < 126 ? OPERATOR_MAX[i % 21] : COMMON_MAX[i - 126];
    if (data[i] > max) {
      throw new RangeError(`DX7 voice parameter ${i} must be between 0 and ${max}; received ${data[i]}.`);
    }
  }
  return data;
}

/** Unpack one 128-byte VMEM voice. Returns an independent 155-byte VCED array. */
export function unpackVoice(input) {
  const packed = byteView(input, 'Packed DX7 voice', PACKED_BYTES);
  validateSevenBit(packed, 'Packed DX7 voice');
  const data = new Uint8Array(VOICE_BYTES);
  for (let op = 0; op < 6; op++) {
    const p = op * 17;
    const d = op * 21;
    // Reject nonzero reserved bits rather than silently changing the original patch.
    if ((packed[p + 11] & 0x70) || (packed[p + 13] & 0x60) || (packed[p + 15] & 0x40)) {
      throw new RangeError(`Packed DX7 operator ${6 - op} contains nonzero reserved bits.`);
    }
    data.set(packed.subarray(p, p + 11), d);
    data[d + 11] = packed[p + 11] & 3;
    data[d + 12] = (packed[p + 11] >> 2) & 3;
    data[d + 13] = packed[p + 12] & 7;
    data[d + 14] = packed[p + 13] & 3;
    data[d + 15] = packed[p + 13] >> 2;
    data[d + 16] = packed[p + 14];
    data[d + 17] = packed[p + 15] & 1;
    data[d + 18] = packed[p + 15] >> 1;
    data[d + 19] = packed[p + 16];
    data[d + 20] = packed[p + 12] >> 3;
  }
  if (packed[111] & 0x70) throw new RangeError('Packed DX7 voice contains nonzero oscillator-sync reserved bits.');
  data.set(packed.subarray(102, 111), 126);
  data[135] = packed[111] & 7;
  data[136] = packed[111] >> 3;
  data.set(packed.subarray(112, 116), 137);
  data[141] = packed[116] & 1;
  data[142] = (packed[116] >> 1) & 7;
  data[143] = packed[116] >> 4;
  data.set(packed.subarray(117, 128), 144);
  validateVoice(data);
  return data;
}

/** Pack one 155-byte VCED voice. No values are clamped or normalized. */
export function packVoice(input) {
  const data = validateVoice(input);
  const packed = new Uint8Array(PACKED_BYTES);
  for (let op = 0; op < 6; op++) {
    const p = op * 17;
    const d = op * 21;
    packed.set(data.subarray(d, d + 11), p);
    packed[p + 11] = data[d + 11] | (data[d + 12] << 2);
    packed[p + 12] = data[d + 13] | (data[d + 20] << 3);
    packed[p + 13] = data[d + 14] | (data[d + 15] << 2);
    packed[p + 14] = data[d + 16];
    packed[p + 15] = data[d + 17] | (data[d + 18] << 1);
    packed[p + 16] = data[d + 19];
  }
  packed.set(data.subarray(126, 135), 102);
  packed[111] = data[135] | (data[136] << 3);
  packed.set(data.subarray(137, 141), 112);
  packed[116] = data[141] | (data[142] << 1) | (data[143] << 4);
  packed.set(data.subarray(144, 155), 117);
  return packed;
}

function checksum(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return (-sum) & 127;
}

function decodeName(data) {
  let name = '';
  for (let i = 145; i < 155; i++) {
    // Keep original 7-bit bytes in data, but do not expose control characters in UI labels.
    name += data[i] < 32 || data[i] === 127 ? ' ' : String.fromCharCode(data[i]);
  }
  return name.trimEnd();
}

/** Parse exactly one Yamaha DX7 1-voice or 32-voice bank bulk-dump message. */
export function parseSysex(input) {
  const source = byteView(input, 'DX7 SysEx');
  if (source.length !== 163 && source.length !== 4104) {
    throw new RangeError('DX7 SysEx must contain exactly 163 bytes (1 voice) or 4104 bytes (32 voices).');
  }
  // Validate a stable snapshot, also when a supplied view has shared backing memory.
  const bytes = new Uint8Array(source);
  if (bytes[0] !== 0xf0 || bytes[1] !== 0x43 || bytes[2] > 15 || bytes[bytes.length - 1] !== 0xf7) {
    throw new Error('Invalid Yamaha DX7 SysEx header, bulk-dump substatus, or end marker.');
  }
  const bank = bytes.length === 4104;
  const size = bank ? 4096 : VOICE_BYTES;
  if (bytes[3] !== (bank ? 9 : 0) || bytes[4] !== (size >> 7) || bytes[5] !== (size & 127)) {
    throw new Error('DX7 SysEx format and declared payload length do not match the message.');
  }
  const payload = bytes.subarray(6, 6 + size);
  validateSevenBit(payload, 'DX7 SysEx payload');
  if (bytes[6 + size] > 127 || checksum(payload) !== bytes[6 + size]) {
    throw new Error('Invalid DX7 SysEx checksum.');
  }
  const voices = [];
  if (bank) {
    for (let i = 0; i < BANK_VOICES; i++) {
      const packedData = payload.slice(i * PACKED_BYTES, (i + 1) * PACKED_BYTES);
      const data = unpackVoice(packedData);
      voices.push({ name: decodeName(data), data, packedData });
    }
  } else {
    const data = new Uint8Array(validateVoice(payload));
    voices.push({ name: decodeName(data), data, packedData: packVoice(data) });
  }
  return { voices, format: bank ? 'bank' : 'voice', channel: bytes[2] };
}

function encodeMessage(payload, format, options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('DX7 SysEx options must be an object.');
  }
  const channel = options.channel === undefined ? 0 : options.channel;
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) {
    throw new RangeError('DX7 SysEx channel must be an integer between 0 and 15.');
  }
  const message = new Uint8Array(payload.length + 8);
  message.set([0xf0, 0x43, channel, format, payload.length >> 7, payload.length & 127]);
  message.set(payload, 6);
  message[message.length - 2] = checksum(payload);
  message[message.length - 1] = 0xf7;
  return message;
}

/** Encode one unpacked 155-byte voice as a DX7 1-voice bulk dump. */
export function createVoiceSysex(data, options = {}) {
  return encodeMessage(validateVoice(data), 0, options);
}

/** Encode exactly 32 unpacked 155-byte voices as a DX7 bank bulk dump. */
export function createBankSysex(voices, options = {}) {
  if (!Array.isArray(voices) || voices.length !== BANK_VOICES) {
    throw new RangeError('A DX7 bank must contain exactly 32 unpacked voices.');
  }
  const payload = new Uint8Array(BANK_VOICES * PACKED_BYTES);
  for (let i = 0; i < BANK_VOICES; i++) payload.set(packVoice(voices[i]), i * PACKED_BYTES);
  return encodeMessage(payload, 9, options);
}

/** An original, simple one-carrier sine voice, not a third-party DX7 preset. */
export function createInitVoice(name = 'INIT SINE') {
  if (typeof name !== 'string' || name.length > 10 || /[^\x20-\x7e]/.test(name)) {
    throw new TypeError('The init voice name must contain at most 10 printable ASCII characters.');
  }
  const data = new Uint8Array(VOICE_BYTES);
  for (let op = 0; op < 6; op++) {
    const d = op * 21;
    data.set([99, 99, 99, 70, 99, 99, 99, 0], d);
    data[d + 16] = op === 5 ? 85 : 0; // Wire order is OP6 ... OP1.
    data[d + 18] = 1; // Ratio 1.00.
    data[d + 20] = 7; // Neutral detune.
  }
  data.fill(99, 126, 130);
  data.fill(50, 130, 134); // Pitch EG stays at the neutral level.
  data[134] = 31; // Algorithm 32: six parallel carriers, only OP1 audible.
  data[136] = 1;
  data[144] = 24; // No transpose.
  data.fill(32, 145);
  for (let i = 0; i < name.length; i++) data[145 + i] = name.charCodeAt(i);
  return data;
}
