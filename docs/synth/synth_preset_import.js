import { createVgmPresetFiles } from '../playground/playground_vgm_presets.js';
import { parseTfi } from '../js/tfi.js';
import { parseVgi } from '../js/vgi.js';
import { looksLikeGzip, maybeDecodeVgmFile } from '../js/vgm_file.js';

// Use the same key-on snapshots and deduplication as Playground's VGM import.
export async function readPresetFile(bytes, filename) {
  const compressed = looksLikeGzip(bytes);
  if (compressed) {
    try {
      bytes = new Uint8Array(await maybeDecodeVgmFile(bytes));
    } catch (error) {
      throw new Error(`Could not decompress VGZ: ${error.message}`);
    }
  }
  const isVgm = bytes[0] === 0x56 && bytes[1] === 0x67 &&
    bytes[2] === 0x6d && bytes[3] === 0x20;
  if (isVgm || compressed || /\.(vgm|vgz)$/i.test(filename)) {
    if (!isVgm) throw new Error('Invalid VGM/VGZ file: VGM header not found.');
    return createVgmPresetFiles(bytes, filename).map(file => ({
      label: file.path.split('/').pop().replace(/\.tfi$/i, ''),
      preset: parseTfi(file.data),
    }));
  }
  if (!/\.(tfi|vgi)$/i.test(filename)) {
    throw new Error('Unsupported file format. Choose VGM, VGZ, TFI, or VGI.');
  }
  if (bytes.length !== 42 && bytes.length !== 43) {
    throw new Error('Invalid TFI/VGI file: expected 42 bytes (TFI) or 43 bytes (VGI).');
  }
  // As in the original loader, size distinguishes TFI from VGI even if renamed.
  return [{ label: filename, preset: bytes.length === 43 ? parseVgi(bytes) : parseTfi(bytes) }];
}
