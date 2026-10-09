export type VirtualFile = {
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
    files: VirtualFile[];
    directories: string[];
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
    /** @param {string} path @returns {{type:'file'|'directory',size:number}} */
    stat(path: string): {
        type: 'file' | 'directory';
        size: number;
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
    /** @param {Snapshot} snapshot */
    restore(snapshot: Snapshot): void;
    /** @param {string} path @param {string|Uint8Array|ArrayBuffer} data */
    writeFile(path: string, data: string | Uint8Array | ArrayBuffer): void;
    /** @param {string} path @param {string} text */
    writeText(path: string, text: string): void;
    /** @param {string} path @param {Uint8Array|ArrayBuffer} bytes */
    writeBinary(path: string, bytes: Uint8Array | ArrayBuffer): void;
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
