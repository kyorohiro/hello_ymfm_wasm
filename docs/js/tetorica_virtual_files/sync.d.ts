export type Snapshot = import('./filesystem.js').Snapshot;
export type StoredFile = import('./filesystem.js').StoredFile;
/** @typedef {import('./filesystem.js').Snapshot} Snapshot */
/** @typedef {import('./filesystem.js').StoredFile} StoredFile */
/** Virtual sync does not interpret external storage addresses.
 * @param {string} path */
export declare function resolveSyncPath(path: string): string;
/** Plan a one-way mirror between exact paths in one virtual snapshot.
 * Source may be a file or a directory, including an empty directory. Existing
 * destination-only descendants are removed; everything outside it is retained.
 * A directory is the target itself, never an implicit containing directory.
 * No filesystem is changed. Returned bytes are independent of the input and
 * of their source counterparts. Callers validate/publish the plan atomically.
 * Internal shareUnchanged mode retains validated backing bytes for unaffected
 * files. Its caller must own those bytes and never expose the returned storage
 * directly. Newly mirrored destination bytes are always copied in this mode.
 * @param {Snapshot} snapshot
 * @param {string} source
 * @param {string} destination
 * @param {{exclude?:string[],shareUnchanged?:boolean}} [options] Source exclusions and an internal storage-sharing optimization.
 * @returns {{snapshot:Snapshot,changed:boolean}} */
export declare function planVirtualFileSync(snapshot: Snapshot, source: string, destination: string, { exclude, shareUnchanged }?: {
    exclude?: string[];
    shareUnchanged?: boolean;
}): {
    snapshot: Snapshot;
    changed: boolean;
};
