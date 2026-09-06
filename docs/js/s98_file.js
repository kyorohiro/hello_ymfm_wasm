// S98 register logs are normalized to VGM for the analyzer's existing pipeline.
// Format reference: https://github.com/ValleyBell/libvgm/blob/master/player/s98player.cpp
export function looksLikeS98(source) {
  const b = source instanceof Uint8Array ? source : new Uint8Array(source);
  return b.length >= 3 && b[0] === 0x53 && b[1] === 0x39 && b[2] === 0x38;
}

export function convertS98ToVgm(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const fail = (message) => { throw new Error(`S98: ${message}`); };
  if (!looksLikeS98(bytes) || bytes.length < 0x20) fail("invalid or truncated header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset) => view.getUint32(offset, true);
  const version = bytes[3] - 0x30;
  if (version < 0 || version > 3) fail(`unsupported version ${version}`);
  if (u32(0x0c)) fail("compressed files are not supported");
  const numerator = version === 0 ? 10 : u32(4) || 10;
  const denominator = version < 2 ? 1000 : u32(8) || 1000;
  const tagOffset = u32(0x10);
  const dataOffset = u32(0x14);
  const loopOffset = u32(0x18);
  if (dataOffset < 0x20 || dataOffset >= bytes.length) fail("invalid data offset");
  if (tagOffset && (tagOffset < 0x20 || tagOffset >= bytes.length)) fail("invalid tag offset");
  const dataEnd = tagOffset > dataOffset ? tagOffset : bytes.length;
  if (loopOffset && (loopOffset < dataOffset || loopOffset >= dataEnd)) fail("invalid loop offset");
  const devices = [];
  if (version >= 2) {
    const count = version === 3 ? u32(0x1c) : Infinity;
    let offset = 0x20;
    for (let index = 0; index < count; index++, offset += 16) {
      if (offset + 16 > dataOffset) fail("truncated device table");
      const type = u32(offset);
      if (version === 2 && type === 0) break;
      devices.push({ type, clock: u32(offset + 4), pan: version === 3 ? u32(offset + 8) : 0 });
    }
  }
  if (!devices.length) devices.push({ type: 4, clock: 7987200, pan: 0 });
  if (devices.length !== 1) fail("multiple devices are not supported; use one YM2203, YM2608 or YM2612");
  const device = devices[0];
  const config = { 2: [0x55, 0x44, "YM2203"], 3: [0x52, 0x2c, "YM2612"], 4: [0x56, 0x48, "YM2608"] }[device.type];
  if (!config) fail(`unsupported device type ${device.type}; supported: YM2203, YM2608, YM2612`);
  if (!device.clock || device.clock >= 0x40000000) fail("invalid device clock");
  if (device.pan) fail("device-level panning is not supported");
  const output = new Array(0x100).fill(0);
  let ticks = 0n;
  let samples = 0;
  let loopVgmOffset = 0;
  let loopSamples = 0;
  let ended = false;
  const wait = (amount) => {
    ticks += BigInt(amount);
    const next = ticks * BigInt(numerator) * 44100n / BigInt(denominator);
    if (next > 0xffffffffn) fail("duration exceeds the VGM sample limit");
    let remaining = Number(next) - samples;
    samples = Number(next);
    while (remaining > 0) {
      const chunk = Math.min(remaining, 65535);
      output.push(0x61, chunk & 255, chunk >>> 8);
      remaining -= chunk;
    }
  };
  for (let pos = dataOffset; pos < dataEnd;) {
    if (pos === loopOffset) { loopVgmOffset = output.length; loopSamples = samples; }
    const command = bytes[pos++];
    if (command === 0xfd) { output.push(0x66); ended = true; break; }
    if (command === 0xff) { wait(1); continue; }
    if (command === 0xfe) {
      let value = 0;
      let factor = 1;
      let b;
      do {
        if (pos >= dataEnd || factor > 2 ** 28) fail("invalid variable-length wait");
        b = bytes[pos++];
        value += (b & 127) * factor;
        factor *= 128;
      } while (b & 128);
      wait(value + 2);
      continue;
    }
    if (command > 1 || (device.type === 2 && command === 1)) fail(`invalid device/port command ${command}`);
    if (pos + 2 > dataEnd) fail("truncated register write");
    output.push(config[0] + command, bytes[pos++], bytes[pos++]);
  }
  if (!ended) fail("missing end command");
  if (loopOffset && !loopVgmOffset) fail("loop offset is not a command boundary");
  if (loopOffset && samples === loopSamples) fail("loop has no sample duration");
  const vgm = Uint8Array.from(output);
  const header = new DataView(vgm.buffer);
  const put = (offset, value) => header.setUint32(offset, value, true);
  vgm.set([0x56, 0x67, 0x6d, 0x20]);
  put(4, vgm.length - 4);
  put(8, 0x171);
  put(0x34, 0x100 - 0x34);
  put(config[1], device.clock);
  put(0x18, samples);
  if (loopOffset) { put(0x1c, loopVgmOffset - 0x1c); put(0x20, samples - loopSamples); }
  let tag = "";
  if (tagOffset) {
    let end = bytes.indexOf(0, tagOffset);
    if (end < 0) end = bytes.length;
    tag = new TextDecoder(version === 3 ? "utf-8" : "shift_jis").decode(bytes.subarray(tagOffset, end));
  }
  return {
    buffer: vgm.buffer,
    sourceHeader: { format: `S98${version}`, numerator, denominator, dataOffset, loopOffset, tagOffset, devices, tag },
  };
}
