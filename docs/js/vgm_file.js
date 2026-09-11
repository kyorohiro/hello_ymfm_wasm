/**
 * @param {ArrayBuffer | Uint8Array} source
 * @returns {Uint8Array}
 */
function toBytes(source) {
  if (source instanceof Uint8Array) {
    return source;
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  throw new Error("VGM source must be an ArrayBuffer or Uint8Array");
}

// GD3 v1.00: https://vgmrips.net/wiki/GD3_Specification
export const VGM_METADATA_FIELDS = [
  ["trackName", "Track"], ["trackNameOriginal", "Track (original language)"],
  ["gameName", "Game"], ["gameNameOriginal", "Game (original language)"],
  ["systemName", "System"], ["systemNameOriginal", "System (original language)"],
  ["author", "Composer / Author"], ["authorOriginal", "Composer / Author (original language)"],
  ["releaseDate", "Release date"], ["creator", "VGM creator"], ["notes", "Notes"],
];

/** Read optional GD3 metadata from decompressed VGM bytes. Invalid tags return null. */
export function parseVgmMetadata(source) {
  const bytes = toBytes(source);
  if (bytes.length < 0x40) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x206d6756) return null;
  const relativeOffset = view.getUint32(0x14, true);
  if (!relativeOffset) return null;
  const offset = 0x14 + relativeOffset;
  if (offset < 0x40 || offset + 12 > bytes.length) return null;
  if (view.getUint32(offset, true) !== 0x20336447 ||
      view.getUint32(offset + 4, true) !== 0x100) return null;
  const length = view.getUint32(offset + 8, true);
  const end = offset + 12 + length;
  if (length % 2 || end > bytes.length) return null;
  const decoder = new TextDecoder("utf-16le");
  const metadata = {};
  let cursor = offset + 12;
  for (const [key] of VGM_METADATA_FIELDS) {
    const start = cursor;
    while (cursor + 2 <= end && view.getUint16(cursor, true) !== 0) cursor += 2;
    if (cursor + 2 > end) return null;
    metadata[key] = decoder.decode(bytes.subarray(start, cursor));
    cursor += 2;
  }
  return metadata;
}

/**
 * @param {ArrayBuffer | Uint8Array} source
 * @returns {boolean}
 */
export function looksLikeGzip(source) {
  const bytes = toBytes(source);
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * @param {ArrayBuffer | Uint8Array} source
 * @returns {Promise<ArrayBuffer>}
 */
export async function maybeDecodeVgmFile(source) {
  const bytes = toBytes(source);

  if (!looksLikeGzip(bytes)) {
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );
  }

  if (typeof DecompressionStream !== "function") {
    throw new Error("VGZ requires browser gzip support via DecompressionStream.");
  }

  const stream = new Blob([bytes]).stream().pipeThrough(
    new DecompressionStream("gzip")
  );
  return await new Response(stream).arrayBuffer();
}
