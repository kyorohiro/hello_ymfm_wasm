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
 * @param {Array<{path:string,data:string|Uint8Array|ArrayBuffer}>} [entries] */
export declare function createVirtualFileSystem(entries?: Array<{
    path: string;
    data: string | Uint8Array | ArrayBuffer;
}>): {
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
    /** @param {Array<{path:string,data:string|Uint8Array|ArrayBuffer}>} entries @param {string[]} [dirs] */
    replace(entries: Array<{
        path: string;
        data: string | Uint8Array | ArrayBuffer;
    }>, dirs?: string[]): void;
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
