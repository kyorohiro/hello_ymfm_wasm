import { createVirtualFileSystem } from './filesystem.js';
export type VirtualFS = ReturnType<typeof createVirtualFileSystem>;
export type HttpClient = {
    request: (request: any) => Promise<any>;
};
/** Node-compatible promise filesystem for isomorphic-git. No host files are accessed.
 * @param {VirtualFS} store */
export declare function createGitFileSystem(store: VirtualFS): {
    promises: {
        readFile(path: any, options: any): Promise<string | Uint8Array<any>>;
        writeFile(path: any, data: any): Promise<void>;
        unlink(path: any): Promise<void>;
        readdir(path: any): Promise<string[]>;
        mkdir(path: any): Promise<void>;
        rmdir(path: any): Promise<void>;
        stat(path: any): Promise<{
            size: number;
            mode: number;
            mtimeMs: number;
            ctimeMs: number;
            uid: number;
            gid: number;
            ino: number;
            dev: number;
            isFile: () => boolean;
            isDirectory: () => boolean;
            isSymbolicLink: () => boolean;
        }>;
        lstat(path: any): Promise<{
            size: number;
            mode: number;
            mtimeMs: number;
            ctimeMs: number;
            uid: number;
            gid: number;
            ino: number;
            dev: number;
            isFile: () => boolean;
            isDirectory: () => boolean;
            isSymbolicLink: () => boolean;
        }>;
        readlink(): Promise<never>;
        symlink(): Promise<never>;
        chmod(): Promise<void>;
    };
};
/** @param {string} path */
export declare function isGitPath(path: string): boolean;
/** @param {string} url */
export declare function gitHttpsUrl(url: string): string;
/** Git repositories live entirely inside Virtual Files, including /.git.
 * Operations run on an isolated copy and publish only if the original store
 * has not changed. Cancellation or project replacement cannot publish stale data.
 * @param {{fs:VirtualFS,http?:HttpClient,syncWorkingFiles?:()=>void,beginRemote?:(request:{url:string,operation:string,branch:string,commit:string})=>Promise<{http:HttpClient,close:()=>Promise<void>}>}} options */
export declare function createVirtualGit({ fs, http, beginRemote, syncWorkingFiles }: {
    fs: VirtualFS;
    http?: HttpClient;
    syncWorkingFiles?: () => void;
    beginRemote?: (request: {
        url: string;
        operation: string;
        branch: string;
        commit: string;
    }) => Promise<{
        http: HttpClient;
        close: () => Promise<void>;
    }>;
}): {
    /** @param {string} action @param {any} [args] @param {{signal?:AbortSignal,assertActive?:()=>void}} [guards] */
    execute(action: string, args?: any, guards?: {
        signal?: AbortSignal;
        assertActive?: () => void;
    }): Promise<any>;
};
/** @param {any} shell @param {ReturnType<typeof createVirtualGit>} repository */
export declare function registerGitShell(shell: any, repository: ReturnType<typeof createVirtualGit>): void;
/** @param {any} result */
export declare function formatGitStatus(result: any): string;
