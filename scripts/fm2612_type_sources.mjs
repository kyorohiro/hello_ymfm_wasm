import {readFile, writeFile} from 'node:fs/promises';
import {basename} from 'node:path';

// Supply missing destructured-option shapes during declaration inference.
// Restore the original staged JavaScript when TypeScript finishes or fails.
const annotations = {
  'ay8910_timed_state.js': [
    ['export function createAyTimedSnapshot(',
      '/** @param {any} state\n' +
      ' * @param {{instanceId: string | number, clock: number, type?: number, flags?: number, frame: number, sampleRate: number}} [options]\n' +
      ' */'],
  ],
  'playground_performance_queue.js': [
    ['  function clearPattern(',
      '  /** @param {string} name\n' +
      '   * @param {{session?: number, owner?: string}} [scope]\n' +
      '   */'],
    ['  function cancelPatternOwner(',
      '  /** @param {string} owner\n' +
      '   * @param {{session?: number}} [scope]\n' +
      '   */'],
    ['  function commitPatterns(',
      '  /** @param {any} changes\n' +
      '   * @param {{session: number, owner: string, dryRun?: boolean}} [context]\n' +
      '   * @param {(message: any) => void} [reply]\n' +
      '   */'],
  ],
};

/** Infer declarations with local import URLs and complete option types. */
export async function withFm2612DeclarationSources(files, emit) {
  const originals = [];
  try {
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      let typedSource = source.replace(/(\.m?js)\?[^'"\s]+(?=['"])/g, '$1');
      for (const [signature, comment] of annotations[basename(file)] ?? []) {
        if (!typedSource.includes(signature)) {
          throw new Error(`Missing declaration annotation target in ${file}: ${signature.trim()}`);
        }
        typedSource = typedSource.replace(signature, `${comment}\n${signature}`);
      }
      if (typedSource !== source) {
        originals.push([file, source]);
        await writeFile(file, typedSource);
      }
    }
    return await emit();
  } finally {
    for (const [file, source] of originals) await writeFile(file, source);
  }
}
