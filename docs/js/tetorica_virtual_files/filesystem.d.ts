export declare const CHECKPOINT_ROOT = "/.tet.ss";
/** True only for the reserved root checkpoint tree. @param {string} path */
export declare function isCheckpointPath(path: string): boolean;
export type VirtualFile = {
    path: string;
    revision: number;
    type: 'text';
    data: string;
} | {
    path: string;
    revision: number;
    type: 'binary';
    data: Uint8Array;
};
export type StoredFile = {
    path: string;
    type: 'text';
    data: string;
} | {
    path: string;
    type: 'binary';
    data: Uint8Array;
};
export type Snapshot = {
    version: 1;
    files: StoredFile[];
    directories: string[];
};
export type FileCheckpoint = {
    snapshot: Snapshot;
    revisions: Record<string, number>;
    scope: object;
};
/** Memory filesystem. Reads return copies; replace/restore validate before committing.
 * @param {Array<{path:string,data:string|Uint8Array|ArrayBuffer}>} [entries]
 * @param {{autoCheckpoint?:boolean}} [options] */
export declare function createVirtualFileSystem(entries?: Array<{
    path: string;
    data: string | Uint8Array | ArrayBuffer;
}>, { autoCheckpoint }?: {
    autoCheckpoint?: boolean;
}): {
    /** One-way file/folder mirror, preserving the absolute source path under
     * syncRoot. The default root is /.tet.ss; arbitrary roots are ordinary
     * files, not automatically hidden or Git-ignored. Unlike checkpoint set,
     * sync does not manage .gitignore or trigger automatic checkpoint capture.
     * Root sync excludes its destination tree to prevent recursive backups.
     * Only virtual paths are supported; external storage URIs are reserved.
     * @param {string} sourcePath
     * @param {{syncRoot?:string}} [options]
     * @returns {Promise<{sourcePath:string,destinationPath:string,changed:boolean}>} */
    sync(sourcePath: string, options?: {
        syncRoot?: string;
    }): Promise<{
        sourcePath: string;
        destinationPath: string;
        changed: boolean;
    }>;
    /** Persistent per-file checkpoints, separate from transactional checkpoint(). */
    checkpoints: {
        readonly auto: boolean;
        /** The setting belongs to this instance, not its snapshots. @param {boolean} enabled */
        setAuto(enabled: boolean): void;
        /** @param {string} path @returns {VirtualFile|null} */
        get(path: string): VirtualFile | null;
        /** @param {string} path */
        has(path: string): boolean;
        /** False when no checkpoint exists. @param {string} path */
        isModified(path: string): boolean;
        /** Set the single persistent checkpoint; storage sync and Undo are independent.
         * @param {string} path @param {{expectedRevision?:number}} [options] @returns {VirtualFile} */
        set(path: string, { expectedRevision }?: {
            expectedRevision?: number;
        }): VirtualFile;
        /** Update multiple existing file checkpoints in one validated commit.
         * @param {string[]} paths @returns {VirtualFile[]} */
        setMany(paths: string[]): VirtualFile[];
        /** Restore current from its checkpoint without advancing that checkpoint.
         * @param {string} path @param {{expectedRevision?:number}} [options] @returns {VirtualFile} */
        revert(path: string, { expectedRevision }?: {
            expectedRevision?: number;
        }): VirtualFile;
    };
    /** @param {()=>void} listener */
    onDidChange(listener: () => void): () => boolean;
    /** Files only, for compatibility. Use stat() to test directories. @param {string} path */
    has(path: string): boolean;
    /** @param {string} path @returns {VirtualFile|null} */
    get(path: string): VirtualFile | null;
    /** @returns {VirtualFile[]} */
    list(): VirtualFile[];
    listDirectories(): string[];
    /** Last revision, including deleted paths; zero means never present. @param {string} path */
    getRevision(path: string): number;
    /** @param {string} path @returns {{type:'file'|'directory',size:number,revision:number}} */
    stat(path: string): {
        type: 'file' | 'directory';
        size: number;
        revision: number;
    };
    /** @param {string} [path] */
    readdir(path?: string): string[];
    /** @param {string} path @param {{recursive?:boolean}} [options] */
    mkdir(path: string, { recursive }?: {
        recursive?: boolean;
    }): void;
    /** Exact replacement by default. Editing transactions opt into auto capture.
     * @param {Array<{path:string,data:string|Uint8Array|ArrayBuffer}>} entries @param {string[]} [dirs]
     * @param {{checkpointChanges?:boolean}} [options] */
    replace(entries: Array<{
        path: string;
        data: string | Uint8Array | ArrayBuffer;
    }>, dirs?: string[], options?: {
        checkpointChanges?: boolean;
    }): void;
    /** @returns {Snapshot} */
    snapshot(): Snapshot;
    /** In-memory checkpoint, bound to this store. @returns {FileCheckpoint} */
    checkpoint(): FileCheckpoint;
    /** @param {Snapshot} snapshot */
    restore(snapshot: Snapshot): void;
    /** @param {string} path @param {string|Uint8Array|ArrayBuffer} data @param {{expectedRevision?:number}} [options] */
    writeFile(path: string, data: string | Uint8Array | ArrayBuffer, { expectedRevision }?: {
        expectedRevision?: number;
    }): void;
    /** Write a group atomically without copying unrelated file data.
     * @param {Array<{path:string,data:string|Uint8Array|ArrayBuffer,expectedRevision?:number}>} entries
     * @param {{checkpointChanges?:boolean}} [options] */
    writeFiles(entries: Array<{
        path: string;
        data: string | Uint8Array | ArrayBuffer;
        expectedRevision?: number;
    }>, { checkpointChanges }?: {
        checkpointChanges?: boolean;
    }): void;
    /** @param {string} path @param {string} text @param {{expectedRevision?:number}} [options] */
    writeText(path: string, text: string, options?: {
        expectedRevision?: number;
    }): void;
    /** @param {string} path @param {Uint8Array|ArrayBuffer} bytes @param {{expectedRevision?:number}} [options] */
    writeBinary(path: string, bytes: Uint8Array | ArrayBuffer, options?: {
        expectedRevision?: number;
    }): void;
    /** @param {string} path */
    delete(path: string): boolean;
    /** @param {string} path @param {{recursive?:boolean}} [options] */
    remove(path: string, { recursive }?: {
        recursive?: boolean;
    }): void;
    /** @param {string} [currentPath] */
    createFileReader(currentPath?: string): import("./reader.js").VirtualFileReader;
};
/** Atomic copy/move, including empty directories; application policies are external.
 * @param {ReturnType<typeof createVirtualFileSystem>} fs @param {string} source @param {string} destination @param {{copy?:boolean}} [options] */
export declare function transferVirtualFiles(fs: ReturnType<typeof createVirtualFileSystem>, source: string, destination: string, { copy }?: {
    copy?: boolean;
}): {
    from: string;
    to: string;
}[];
