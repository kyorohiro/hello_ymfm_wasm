/**
 * @file Browser / Node.js / Worker 共通。DOM・Web Audio・WASM・他のチップへの依存なし。
 * ゲームでは必要なローダーだけを登録する。各呼び出しは新しいチップを返す。
 */
/**
 * @template {Record<string, (options?: any) => any>} T
 * @param {T} loaders チップ名と非同期生成関数。登録時には実行しない。
 * @returns {<K extends keyof T>(name: K, options?: Parameters<T[K]>[0]) => Promise<Awaited<ReturnType<T[K]>>>}
 */
export function createSoundChipFactory(loaders) {
  const registered = new Map(Object.entries(loaders));
  return async (name, options) => {
    const loader = registered.get(name);
    if (typeof loader !== 'function') throw new Error(`Unknown sound chip: ${String(name)}`);
    return loader(options);
  };
}
