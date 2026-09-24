/**
 * @file playground_noise.js
 * 実行環境: Browser / Node.js
 * 依存: 注入された音声オブジェクトの noise API。実際の再生にはその音声バックエンドが必要。
 */
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
