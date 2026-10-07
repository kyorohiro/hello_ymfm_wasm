import { createVgmPresetFiles } from '../playground/playground_vgm_presets.js';
import { parseTfi } from '../js/tfi.js';
import { parseVgi } from '../js/vgi.js';
import { looksLikeGzip, maybeDecodeVgmFile } from '../js/vgm_file.js';
import { looksLikeS98, convertS98ToVgm } from '../js/s98_file.js';
import { Ym2612VGM } from '../js/ym2612vgm.js';
import { extractOpmPatches } from '../vgm_analyzer/opm_export.js';
import { convertOpmToTfi } from '../vgm_analyzer/opm_tfi.js';

export const OPM_IMPORT_NOTICE = 'YM2151 → YM2612 is an approximate conversion. DT2, LFO/AM, noise, pan and operator key masks are not retained; envelope/detune timing is not compensated for clock differences.';

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
  if (looksLikeS98(bytes) || /\.s98$/i.test(filename)) {
    bytes = new Uint8Array(convertS98ToVgm(bytes).buffer);
  }
  const isVgm = bytes[0] === 0x56 && bytes[1] === 0x67 &&
    bytes[2] === 0x6d && bytes[3] === 0x20;
  if (isVgm || compressed || /\.(vgm|vgz|s98)$/i.test(filename)) {
    if (!isVgm) throw new Error('Invalid VGM/VGZ file: VGM header not found.');
    const entries = createVgmPresetFiles(bytes, filename).map(file => ({
      label: file.path.split('/').pop().replace(/\.tfi$/i, ''),
      preset: parseTfi(file.data),
    }));
    const parser = new Ym2612VGM(bytes, {logger: null});
    if (parser.header.ym2151Clock) {
      for (const patch of extractOpmPatches(bytes, {includeSnapshots: true})) {
        const converted = convertOpmToTfi(patch.snapshot, patch.channel);
        entries.push({
          label: `ym2151_${patch.name.replace(/\.opm$/i, '')} → YM2612`,
          preset: parseTfi(converted.data),
          notice: OPM_IMPORT_NOTICE,
        });
      }
    }
    return entries;
  }
  if (!/\.(tfi|vgi)$/i.test(filename)) {
    throw new Error('Unsupported file format. Choose VGM, VGZ, S98, TFI, or VGI.');
  }
  if (bytes.length !== 42 && bytes.length !== 43) {
    throw new Error('Invalid TFI/VGI file: expected 42 bytes (TFI) or 43 bytes (VGI).');
  }
  // As in the original loader, size distinguishes TFI from VGI even if renamed.
  return [{ label: filename, preset: bytes.length === 43 ? parseVgi(bytes) : parseTfi(bytes) }];
}
