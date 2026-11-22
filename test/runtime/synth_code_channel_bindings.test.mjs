import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaygroundCodeRuntime } from '../../docs/js/playground_code_runtime.js';
import { createSmsGearCodeProject } from '../../docs/synth-smsgear/code_project.js';
import { createSnesCodeProject } from '../../docs/synth-snes/code_project.js';

for (const [chip, channels, makeProject, saved] of [
  ['snes', [7, 8], createSnesCodeProject, false],
  ['ym2413', [7, 8, 9], createSmsGearCodeProject, true],
]) {
  test(`${chip} Code channel constants are available at runtime and through pg`, async () => {
    const source = `log(${channels.map(channel => `CH${channel}, pg.CH${channel}`).join(', ')});`;
    const project = makeProject({ starterCode: source });
    const lines = [];
    const runtime = createPlaygroundCodeRuntime({
      supportedSoundChips: [chip], ensureReady: async () => {}, now: () => 0,
      useSoundChip: async () => ({}), onLog: line => lines.push(line),
      prepareSource: saved ? project.prepareSavedSource : project.prepareSource,
    });
    try {
      await runtime.run(source);
      assert.deepEqual(lines, [channels.flatMap(channel => [channel - 1, channel - 1]).join(' ')]);
    } finally { await runtime.stop(); }
  });
}
