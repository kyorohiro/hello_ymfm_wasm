/** Available inside files executed with the Playground Shell's js command.
 * File operations are asynchronous and share the editor's live project.
 */
declare module 'tetorica:shell' {
  export type VirtualFile =
    | {path: string; type: 'text'; data: string}
    | {path: string; type: 'binary'; data: Uint8Array};
  export type CommandResult = {code: number; stdout: string; stderr: string};
  export interface ShellFiles {
    get(path: string): Promise<VirtualFile | null>;
    has(path: string): Promise<boolean>;
    stat(path: string): Promise<{type: 'file' | 'directory'; size: number}>;
    readdir(path?: string): Promise<string[]>;
    list(): Promise<VirtualFile[]>;
    listDirectories(): Promise<string[]>;
    snapshot(): Promise<{version: 1; files: VirtualFile[]; directories: string[]}>;
    readFile(path: string, options?: {type?: 'text'}): Promise<string>;
    readFile(path: string, options: {type: 'json'}): Promise<unknown>;
    readFile(path: string, options: {type: 'binary'}): Promise<Uint8Array>;
    readFile(path: string, options: {type: 'arrayBuffer'}): Promise<ArrayBuffer>;
    writeFile(path: string, data: string | Uint8Array | ArrayBuffer): Promise<void>;
    writeText(path: string, text: string): Promise<void>;
    writeBinary(path: string, bytes: Uint8Array | ArrayBuffer): Promise<void>;
    mkdir(path: string, options?: {recursive?: boolean}): Promise<void>;
    delete(path: string): Promise<boolean>;
    remove(path: string, options?: {recursive?: boolean}): Promise<void>;
    rename(from: string, to: string): Promise<{from: string; to: string}[]>;
    copy(from: string, to: string): Promise<{from: string; to: string}[]>;
  }
  export const fs: ShellFiles;
  export const shell: {
    /** Current shell directory, refreshed after execute(). */
    readonly cwd: string;
    execute(source: string | string[]): Promise<CommandResult>;
  };
  /** Arguments following the entry file. */
  export const args: readonly string[];
  /** Directory at the start of this execution. */
  export const cwd: string;
  export const console: Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'>;
}
