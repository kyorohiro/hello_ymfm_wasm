/** Resolve a shipped asset without importing browser-only runtime modules.
 * Browser bundlers must preserve/copy the package payload and may pass its public URL.
 * The returned URL is file: in Node, and HTTP(S) in a directly served browser module.
 */
export function runtimeAssetUrl(path, baseUrl = import.meta.url) {
  if (typeof path !== 'string' || !/^[\w./-]+$/.test(path) || path.startsWith('/') || path.split('/').includes('..')) {
    throw new TypeError('Expected a relative package asset path');
  }
  return new URL(path, baseUrl);
}
