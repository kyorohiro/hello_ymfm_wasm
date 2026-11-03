/** Browser / Worker / Node: SPC state and ID666/xid6 metadata, without emulation.
 * Format reference: https://snesmusic.org/files/spc_file_format.txt
 * Tag bytes are retained because legacy text encoding and the unmarked
 * text/binary ID666 layouts cannot always be determined automatically.
 */
export const SPC_SAMPLE_RATE = 32000;
export const SPC_MIN_FILE_SIZE = 0x10180;
export const SPC_FILE_SIZE = 0x10200;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const SIGNATURE = 'SNES-SPC700 Sound File Data';

function inputBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('SPC input must be an ArrayBuffer or typed array');
}
function ascii(bytes) { return Array.from(bytes, c => String.fromCharCode(c)).join(''); }
function decodeText(bytes, encoding) {
  const end = bytes.indexOf(0), data = end < 0 ? bytes : bytes.subarray(0, end);
  if (encoding) return new TextDecoder(encoding).decode(data).trim();
  try { return new TextDecoder('utf-8', {fatal:true}).decode(data).trim(); }
  catch { return new TextDecoder('windows-1252').decode(data).trim(); }
}
function decimal(bytes) {
  const value = ascii(bytes).replace(/\0/g, '').trim();
  return /^\d+$/.test(value) ? Number(value) : value === '' ? undefined : null;
}
function unsigned(bytes, offset, count) {
  let value = 0;
  for (let i = 0; i < count; i++) value += bytes[offset + i] * 2 ** (8 * i);
  return value;
}
function readId666(bytes, {textEncoding, id666Format}, warnings) {
  const raw = bytes.slice(0x2e, 0x100), metadata = {};
  if (bytes[0x23] === 0x1b) return {present:false, raw, metadata};
  const textLength = decimal(bytes.subarray(0xa9, 0xac));
  const textFade = decimal(bytes.subarray(0xac, 0xb1));
  const date = bytes.subarray(0x9e, 0xa9);
  const dateTextLike = [...date].every(c => c === 0 || c === 32 || c === 47 || (c >= 48 && c <= 57));
  const textLike = textLength !== null && textFade !== null && dateTextLike;
  const ambiguous = textLike && !date.some(c => c !== 0 && c !== 32);
  const layout = id666Format === 'auto' ? (textLike ? 'text' : 'binary') : id666Format;
  if (ambiguous && id666Format === 'auto') warnings.push('ID666 text/binary layout is ambiguous; assumed text. Pass id666Format to override.');
  for (const [key, offset, size] of [['title',0x2e,32], ['game',0x4e,32], ['dumper',0x6e,16], ['comment',0x7e,32]]) {
    metadata[key] = decodeText(bytes.subarray(offset, offset + size), textEncoding);
  }
  if (layout === 'text') {
    metadata.artist = decodeText(bytes.subarray(0xb1, 0xd1), textEncoding);
    metadata.dumpDate = decodeText(date, textEncoding);
    if (textLength !== null && textLength !== undefined) metadata.playSeconds = textLength;
    if (textFade !== null && textFade !== undefined) metadata.fadeSeconds = textFade / 1000;
    metadata.mutedChannels = bytes[0xd1];
    metadata.emulator = bytes[0xd2];
  } else {
    metadata.artist = decodeText(bytes.subarray(0xb0, 0xd0), textEncoding);
    metadata.dumpDate = unsigned(bytes, 0x9e, 4) || undefined;
    metadata.playSeconds = unsigned(bytes, 0xa9, 3);
    metadata.fadeSeconds = unsigned(bytes, 0xac, 4) / 1000;
    metadata.mutedChannels = bytes[0xd0];
    metadata.emulator = bytes[0xd1];
  }
  return {present:true, layout, ambiguous:ambiguous && id666Format === 'auto', raw, metadata};
}
const XID_TEXT = new Map([[1,'title'],[2,'game'],[3,'artist'],[4,'dumper'],[7,'comment'],[0x10,'soundtrack'],[0x13,'publisher']]);
const XID_INLINE = new Map([[6,'emulator'],[0x11,'disc'],[0x12,'track'],[0x14,'year'],[0x34,'mutedChannels'],[0x35,'loopCount']]);
const XID_TICKS = new Map([[0x30,'introSeconds'],[0x31,'loopSeconds'],[0x32,'endSeconds'],[0x33,'fadeSeconds']]);
function readXid6(bytes, encoding, warnings) {
  const tags = [], metadata = {};
  if (bytes.length <= SPC_FILE_SIZE) return {present:false, tags, metadata};
  const tail = bytes.subarray(SPC_FILE_SIZE);
  if (tail.length < 8 || ascii(tail.subarray(0, 4)) !== 'xid6') {
    warnings.push('Unrecognized SPC trailing data was preserved.');
    return {present:false, tags, metadata};
  }
  const declaredSize = unsigned(tail, 4, 4), end = Math.min(tail.length, declaredSize + 8);
  if (declaredSize > tail.length - 8) warnings.push('Truncated xid6 chunk; only complete fields were read.');
  if (declaredSize < tail.length - 8) warnings.push('Data after xid6 was preserved.');
  let cursor = 8;
  while (cursor + 4 <= end && tags.length < 4096) {
    const offset = cursor, id = tail[cursor], type = tail[cursor + 1], length = unsigned(tail, cursor + 2, 2);
    cursor += 4;
    const size = type === 0 ? 0 : length;
    if (cursor + size > end) {warnings.push('Truncated xid6 field; remaining bytes were preserved.'); break;}
    const data = tail.slice(cursor, cursor + size);
    let value = type === 0 ? length : type === 1 ? decodeText(data, encoding) : type === 4 && size === 4 ? unsigned(data, 0, 4) : undefined;
    if (id === 0x32 && type === 4 && size === 4 && value >= 0x80000000) value -= 0x100000000;
    if (type === 4 && size !== 4) warnings.push(`Invalid xid6 integer size for tag ${id}.`);
    tags.push({id, type, length, value, bytes:tail.slice(offset, cursor + size)});
    if (XID_TEXT.has(id) && type === 1) metadata[XID_TEXT.get(id)] = value;
    else if (XID_INLINE.has(id) && type === 0) metadata[XID_INLINE.get(id)] = value;
    else if (XID_TICKS.has(id) && type === 4 && size === 4) {
      metadata[XID_TICKS.get(id)] = value / 64000;
    } else if (id === 5 && type === 4 && size === 4) metadata.dumpDate = value;
    else if (id === 0x36 && type === 4 && size === 4) metadata.amplification = value / 65536;
    cursor += size;
    const padding = (4 - (cursor & 3)) & 3;
    if (padding && cursor + padding <= end) {
      if (tail.subarray(cursor, cursor + padding).every(value => value === 0)) cursor += padding;
      else warnings.push('Unpadded xid6 field accepted.');
    }
  }
  if (tags.length === 4096 && cursor < end) warnings.push('xid6 field limit reached; remaining metadata bytes were preserved.');
  if (cursor !== end) warnings.push('Incomplete xid6 field or padding was preserved.');
  return {present:true, declaredSize, tags, metadata, raw:tail.slice(0, end)};
}
/** Parse a copied, immutable-by-convention SPC image. CPU/RAM/DSP arrays are
 * independent of the input and originalBytes. No source is fetched or executed.
 * ID666 has no layout/encoding flag: use id666Format/textEncoding if automatic
 * text/binary or UTF-8/Windows-1252 detection is unsuitable. xid6 overrides
 * corresponding ID666 display fields; both raw tags and unknown tails remain.
 * Durations are seconds; xid6 integer times use 64,000 ticks per second.
 * @param {ArrayBuffer|ArrayBufferView} input
 * @param {{textEncoding?:string,id666Format?:'auto'|'text'|'binary'}} [options]
 */
export function parseSpcFile(input, {textEncoding, id666Format = 'auto'} = {}) {
  if (!['auto','text','binary'].includes(id666Format)) throw new TypeError('Invalid ID666 layout');
  if (textEncoding) new TextDecoder(textEncoding);
  const source = inputBytes(input);
  if (source.length > MAX_FILE_BYTES) throw new RangeError('SPC exceeds the 16 MiB file limit');
  if (source.length < SPC_MIN_FILE_SIZE) throw new RangeError('Truncated SPC: RAM and DSP registers are required');
  if (ascii(source.subarray(0, SIGNATURE.length)) !== SIGNATURE || source[0x21] !== 0x1a || source[0x22] !== 0x1a || ![0x1a,0x1b].includes(source[0x23])) {
    throw new TypeError('Invalid SNES-SPC700 file signature');
  }
  const originalBytes = source.slice(), warnings = [];
  if (source.length < SPC_FILE_SIZE) warnings.push('Short SPC image: optional extra RAM is unavailable.');
  const id666 = readId666(originalBytes, {textEncoding, id666Format}, warnings);
  const xid6 = readXid6(originalBytes, textEncoding, warnings);
  const metadata = {...id666.metadata, ...xid6.metadata};
  // A loop length alone has no finite total. Do not invent a repeat count.
  if (metadata.loopCount !== undefined && (metadata.introSeconds !== undefined || metadata.loopSeconds !== undefined || metadata.endSeconds !== undefined)) {
    metadata.playSeconds = Math.max(0, (metadata.introSeconds ?? 0) + (metadata.loopSeconds ?? 0) * metadata.loopCount + (metadata.endSeconds ?? 0));
  }
  if (metadata.playSeconds !== undefined) metadata.durationSeconds = metadata.playSeconds + (metadata.fadeSeconds ?? 0);
  return {
    format:'spc', originalBytes, version:source[0x24],
    cpu:{pc:unsigned(source,0x25,2), a:source[0x27], x:source[0x28], y:source[0x29], psw:source[0x2a], sp:source[0x2b]},
    ram:source.slice(0x100, 0x10100), dsp:source.slice(0x10100, 0x10180),
    extraRam:source.length >= SPC_FILE_SIZE ? source.slice(0x101c0, SPC_FILE_SIZE) : null,
    metadata, id666, xid6, warnings,
  };
}
