import { createVirtualFileSystem } from './filesystem.js';
export type TextPatch = {
    path: string;
    expectedRevision?: number;
    type?: 'replace';
    oldText: string;
    newText: string;
    expect?: number;
} | {
    path: string;
    expectedRevision?: number;
    type: 'create';
    text: string;
} | {
    path: string;
    expectedRevision?: number;
    type: 'delete';
    expectedText: string;
};
/** @typedef {{path:string,expectedRevision?:number,type?:'replace',oldText:string,newText:string,expect?:number}|{path:string,expectedRevision?:number,type:'create',text:string}|{path:string,expectedRevision?:number,type:'delete',expectedText:string}} TextPatch */
/** Stage every operation, then commit once. Failed validation never writes to the live store.
 * @param {ReturnType<typeof createVirtualFileSystem>} fs
 * @param {TextPatch[]} edits
 * @param {{cwd?:string,dryRun?:boolean,authorize?:(operation:string,paths:string[])=>void,assertActive?:()=>void}} [options] */
export declare function applyTextPatch(fs: ReturnType<typeof createVirtualFileSystem>, edits: TextPatch[], { cwd, dryRun, authorize, assertActive }?: {
    cwd?: string;
    dryRun?: boolean;
    authorize?: (operation: string, paths: string[]) => void;
    assertActive?: () => void;
}): {
    applied: boolean;
    changes: ({
        path: string;
        type: "create";
        matches: number;
        beforeRevision: any;
        revision: number;
    } | {
        path: string;
        type: "delete";
        matches: number;
        beforeRevision: any;
        revision: number;
    } | {
        path: string;
        type: "replace";
        matches: number;
        beforeRevision: any;
        revision: number;
    })[];
};
export type SnapshotChange = {
    path: string;
    status: 'added' | 'removed' | 'modified';
    beforeType: 'text' | 'binary' | 'directory' | null;
    afterType: 'text' | 'binary' | 'directory' | null;
    hunk?: string;
    hunkTruncated?: boolean;
};
/** @typedef {{path:string,status:'added'|'removed'|'modified',beforeType:'text'|'binary'|'directory'|null,afterType:'text'|'binary'|'directory'|null,hunk?:string,hunkTruncated?:boolean}} SnapshotChange */
/** Compare validated snapshots, including binary changes and empty directories.
 * Text excerpts are bounded review output, not an executable unified patch.
 * @param {import('./filesystem.js').Snapshot} before
 * @param {import('./filesystem.js').Snapshot} after
 * @param {{path?:string}} [options]
 * @returns {SnapshotChange[]} */
export declare function diffSnapshots(before: import('./filesystem.js').Snapshot, after: import('./filesystem.js').Snapshot, { path }?: {
    path?: string;
}): SnapshotChange[];
/** Undo only the paths changed between two live-store checkpoints. Unrelated
 * edits are retained; any conflict prevents the entire commit.
 * @param {ReturnType<typeof createVirtualFileSystem>} fs
 * @param {import('./filesystem.js').FileCheckpoint} before
 * @param {import('./filesystem.js').FileCheckpoint} after
 * @param {{path?:string,dryRun?:boolean,authorize?:(operation:string,paths:string[])=>void,assertActive?:()=>void}} [options] */
export declare function undoFileChanges(fs: ReturnType<typeof createVirtualFileSystem>, before: import('./filesystem.js').FileCheckpoint, after: import('./filesystem.js').FileCheckpoint, { path, dryRun, authorize, assertActive }?: {
    path?: string;
    dryRun?: boolean;
    authorize?: (operation: string, paths: string[]) => void;
    assertActive?: () => void;
}): {
    applied: boolean;
    total: number;
    changes: {
        path: string;
        status: 'added' | 'removed' | 'modified';
        beforeType: 'text' | 'binary' | 'directory' | null;
        afterType: 'text' | 'binary' | 'directory' | null;
    }[];
    conflicts: {
        path: string;
        reason: string;
    }[];
    totalConflicts: number;
    truncated: boolean;
};
