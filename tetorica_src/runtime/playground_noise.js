/**
 * @file playground_noise.js
 * 実行環境: Browser / Node.js
 * 依存: 注入された音声オブジェクトの noise API。実際の再生にはその音声バックエンドが必要。
 */
/**
 * Playground compatibility entry point for the runtime-owned noise API.
 * @template {{create: (...args: unknown[]) => unknown, stopAll: () => void}} Noise
 * @param {{noise?: Noise, audio?: {createNoiseApi?: () => Noise}} | null} megaDrive Audio owner.
 * @returns Existing noise API, lazily created API, or a placeholder that rejects create until initialized.
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
