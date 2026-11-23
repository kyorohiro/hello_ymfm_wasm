// SPDX-License-Identifier: BSD-3-Clause
import { scanVsuVgmPresets } from './vgm-presets.js';

self.onmessage = async ({ data: { writes, durationTicks, limit } }) => {
  try {
    const response = await fetch(new URL('./vsu.wasm?v=vsu-live', import.meta.url));
    if (!response.ok) throw new Error('Unable to load the VSU core (HTTP ' + response.status + ').');
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
    const presets = scanVsuVgmPresets(instance.exports, { writes, durationTicks }, { limit });
    self.postMessage({ presets });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
