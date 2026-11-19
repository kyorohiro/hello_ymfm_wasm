export type Snapshot = import('./filesystem.js').Snapshot;
export type StoreState = import('./filesystem_internal.js').StoreState;
export type WorkspaceSnapshot = {
    version: 1;
    working: Snapshot;
    saved: Snapshot;
    autoSave: boolean;
};
/** An optional two-version memory workspace. Saved is an accepted-content
 * baseline, not evidence of a browser/database/disk write.
 * @param {Array<{path:string,data:string|Uint8Array|ArrayBuffer}>} [entries]
 * @param {{autoSave?:boolean}} [options] */
export declare function createVirtualFileWorkspace(entries?: Array<{
    path: string;
    data: string | Uint8Array | ArrayBuffer;
}>, { autoSave }?: {
    autoSave?: boolean;
}): {
    working: {
        sync(sourcePath: string, options?: {
            syncRoot?: string;
        }): Promise<{
            sourcePath: string;
            destinationPath: string;
            changed: boolean;
        }>;
        checkpoints: {
            readonly auto: boolean;
            setAuto(enabled: boolean): void;
            get(path: string): import("./filesystem.js").VirtualFile | null;
            has(path: string): boolean;
            isModified(path: string): boolean;
            set(path: string, { expectedRevision }?: {
                expectedRevision?: number;
            }): import("./filesystem.js").VirtualFile;
            setMany(paths: string[]): import("./filesystem.js").VirtualFile[];
            revert(path: string, { expectedRevision }?: {
                expectedRevision?: number;
            }): import("./filesystem.js").VirtualFile;
        };
        onDidChange(listener: () => void): () => boolean;
        has(path: string): boolean;
        get(path: string): import("./filesystem.js").VirtualFile | null;
        list(): import("./filesystem.js").VirtualFile[];
        listDirectories(): string[];
        getRevision(path: string): number;
        stat(path: string): {
            type: 'file' | 'directory';
            size: number;
            revision: number;
        };
        readdir(path?: string): string[];
        mkdir(path: string, { recursive }?: {
            recursive?: boolean;
        }): void;
        replace(entries: Array<{
            path: string;
            data: string | Uint8Array | ArrayBuffer;
        }>, dirs?: string[], options?: {
            checkpointChanges?: boolean;
        }): void;
        snapshot(): import("./filesystem.js").Snapshot;
        checkpoint(): import("./filesystem.js").FileCheckpoint;
        restore(snapshot: import("./filesystem.js").Snapshot): void;
        writeFile(path: string, data: string | Uint8Array | ArrayBuffer, { expectedRevision }?: {
            expectedRevision?: number;
        }): void;
        writeFiles(entries: Array<{
            path: string;
            data: string | Uint8Array | ArrayBuffer;
            expectedRevision?: number;
        }>, { checkpointChanges }?: {
            checkpointChanges?: boolean;
        }): void;
        writeText(path: string, text: string, options?: {
            expectedRevision?: number;
        }): void;
        writeBinary(path: string, bytes: Uint8Array | ArrayBuffer, options?: {
            expectedRevision?: number;
        }): void;
        delete(path: string): boolean;
        remove(path: string, { recursive }?: {
            recursive?: boolean;
        }): void;
        createFileReader(currentPath?: string): import("./reader.js").VirtualFileReader;
    };
    saved: Readonly<{
        has: (path: string) => boolean;
        get: (path: string) => import("./filesystem.js").VirtualFile | null;
        list: () => import("./filesystem.js").VirtualFile[];
        stat: (path: string) => {
            type: 'file' | 'directory';
            size: number;
            revision: number;
        };
        getRevision: (path: string) => number;
        listDirectories: () => string[];
        readdir: (path?: string) => string[];
        snapshot: () => import("./filesystem.js").Snapshot;
        onDidChange: (listener: () => void) => () => boolean;
        createFileReader: (currentPath?: string) => import("./reader.js").VirtualFileReader;
    }>;
    readonly autoSave: boolean;
    /** Enabling Auto saves outstanding working changes immediately. @param {boolean} value */
    setAutoSave(value: boolean): boolean;
    /** Save a file, directory subtree, or deletion into the saved baseline. @param {string} path */
    save(path: string): boolean;
    saveMany: (paths: string[]) => boolean;
    saveAll(): boolean;
    /** Discard working edits, including creations/deletions, for this subtree. @param {string} path */
    discard(path: string): boolean;
    discardMany: (paths: string[]) => boolean;
    isDirty(path?: string): boolean;
    getDirtyPaths: (path?: string) => string[];
    /** Content-only snapshots contain both versions; revisions are session-local.
     * @returns {WorkspaceSnapshot} */
    snapshot(): WorkspaceSnapshot;
    /** Validate both versions before publishing either. @param {WorkspaceSnapshot} snapshot */
    restore(snapshot: WorkspaceSnapshot): boolean;
    /** One event per meaningful workspace commit; no external storage is used.
     * @param {()=>void} listener */
    onDidChange(listener: () => void): () => boolean;
};
