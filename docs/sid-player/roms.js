// SPDX-License-Identifier: BSD-3-Clause
// User-provided firmware is kept in memory, never stored or uploaded.
export const C64_ROM_SIZES = Object.freeze({chars: 4096, basic: 8192, kernal: 8192});
const bytesOf = value => value instanceof ArrayBuffer ? new Uint8Array(value)
  : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;

/** Check sizes, not firmware identity or compatibility. Custom ROMs are allowed.
 * All returned bytes are detached copies, including views into larger buffers.
 */
export function copyRomSet(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Choose Character, BASIC and KERNAL ROM files first');
  const result = {};
  for (const [kind, size] of Object.entries(C64_ROM_SIZES)) {
    const bytes = bytesOf(value[kind]);
    if (!bytes || bytes.length !== size) throw new RangeError(`${kind === 'chars' ? 'Character' : kind.toUpperCase()} ROM must be exactly ${size.toLocaleString()} bytes`);
    result[kind] = Uint8Array.from(bytes);
  }
  return result;
}

export function concatenateRoms(value) {
  const roms = copyRomSet(value), result = new Uint8Array(20480);
  let offset = 0;
  for (const kind of ['chars', 'basic', 'kernal']) {result.set(roms[kind], offset); offset += roms[kind].length;}
  return result;
}

/** Read a selected file only after its exact byte length is known. */
export async function readRomFile(file, kind) {
  const size = C64_ROM_SIZES[kind];
  if (!size) throw new RangeError('Unknown C64 ROM type');
  if (!file || file.size !== size) throw new RangeError(`${kind === 'chars' ? 'Character' : kind.toUpperCase()} ROM must be exactly ${size.toLocaleString()} bytes`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== size) throw new RangeError('ROM file size changed while reading');
  return bytes;
}
