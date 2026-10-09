/** Resolve from a directory; the filesystem root is a valid result.
 * @param {string} path @param {string} [cwd] @returns {string} */
export declare function resolvePath(path: string, cwd?: string): string;
/** Resolve relative to a file, as used by imports and the Playground file() helper.
 * @param {string} path @param {string} [basePath] @returns {string} */
export declare function normalizeVirtualPath(path: string, basePath?: string): string;
/** @param {string} path */
export declare const dirname: (path: string) => string;
