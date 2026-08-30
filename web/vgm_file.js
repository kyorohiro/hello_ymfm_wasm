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
