/**
 * Playground compatibility entry point for the runtime-owned noise API.
 */
export function createPlaygroundNoiseApi(megaDrive) {
  if (megaDrive?.noise) return megaDrive.noise;
  if (megaDrive?.audio?.createNoiseApi) {
    return megaDrive.audio.createNoiseApi();
  }

  // Keeps lightweight MegaDrive test doubles usable until audio is initialized.
  return {
    create() {
      throw new Error("noise.create() requires MegaSynth to be initialized first");
    },
    stopAll() {},
  };
}
