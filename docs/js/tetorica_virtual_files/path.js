/** Resolve from a directory; the filesystem root is a valid result.
 * @param {string} path @param {string} [cwd] @returns {string} */
export function resolvePath(path, cwd = '/') {
  if (typeof path !== 'string' || typeof cwd !== 'string' || !cwd.startsWith('/') || path.includes('\\') || path.includes('\0')) throw Error('Invalid virtual path');
  const parts = path.startsWith('/') ? [] : resolvePath(cwd).split('/').filter(Boolean);
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {if (!parts.length) throw Error(`Virtual file path escapes the project: ${path}`);parts.pop();}
    else parts.push(part);
  }
  return '/' + parts.join('/');
}
/** Resolve relative to a file, as used by imports and the Playground file() helper.
 * @param {string} path @param {string} [basePath] @returns {string} */
export function normalizeVirtualPath(path, basePath = '/') {
  return resolvePath(path, basePath.slice(0, basePath.lastIndexOf('/') + 1) || '/');
}
/** @param {string} path */
export const dirname = path => path.slice(0, path.lastIndexOf('/')) || '/';
