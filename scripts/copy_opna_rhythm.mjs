// Explicit allowlist: never include caller-supplied ROMs from the repository root.
import {copyFile, mkdir, readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateRhythmRom} from '../assets/opna-rhythm/generate.mjs';

export async function copyOpnaRhythm(stage, runtimeDir = 'js') {
  const source = fileURLToPath(new URL('../assets/opna-rhythm/', import.meta.url));
  const name = 'tetorica_ym2608_adpcm_rom.bin';
  const rom = fileURLToPath(new URL('../web/' + name, import.meta.url));
  const bytes = await readFile(rom);
  if (!bytes.equals(Buffer.from(generateRhythmRom()))) throw new Error('Regenerate the Tetorica rhythm ROM before packaging');
  const target = resolve(stage, 'assets/opna-rhythm');
  await mkdir(target, {recursive: true});
  await mkdir(resolve(stage, runtimeDir), {recursive: true});
  await copyFile(rom, resolve(stage, runtimeDir, name));
  for (const file of ['LICENSE', 'README.md', 'generate.mjs']) {
    await copyFile(join(source, file), join(target, file));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/copy_opna_rhythm.mjs STAGE');
  await copyOpnaRhythm(process.argv[2]);
}
