import {writeFile, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

import {generateRhythmRom} from './synthesis.mjs';
export {VOICES, encodeAdpcmA, synthesizeVoice, generateRhythmRom} from './synthesis.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = new URL('../../web/tetorica_ym2608_adpcm_rom.bin',import.meta.url), bytes = generateRhythmRom();
  if (process.argv.includes('--check')) {
    if (!Buffer.from(bytes).equals(await readFile(target))) throw new Error('Generated rhythm ROM differs from checked-in data');
  } else await writeFile(target,bytes);
  console.log(`${process.argv.includes('--check') ? 'Verified' : 'Wrote'} ${fileURLToPath(target)} (${bytes.length} bytes)`);
  console.log(`SHA-256 ${createHash('sha256').update(bytes).digest('hex')}`);
}
