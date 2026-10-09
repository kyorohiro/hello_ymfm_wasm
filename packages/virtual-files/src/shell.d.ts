/** Quotes and escapes only. No JavaScript evaluation or host shell invocation.
 * @param {string} source @returns {string[]} */
export declare function parseCommand(source: string): string[];
export type CommandResult = {
    code: number;
    stdout: string;
    stderr: string;
};
export type ExecuteOptions = {
    signal?: AbortSignal;
    stdin?: string;
    fs?: ReturnType<typeof import('./filesystem.js').createVirtualFileSystem>;
};
export type CommandContext = {
    execute: (source: string | string[], options?: ExecuteOptions) => Promise<CommandResult>;
    assertActive: () => void;
    fs: ReturnType<typeof import('./filesystem.js').createVirtualFileSystem>;
    args: string[];
    cwd: string;
    resolve: (path: string) => string;
    signal?: AbortSignal;
    stdin: string;
};
export type Command = (context: CommandContext) => string | void | CommandResult | Promise<string | void | CommandResult>;
/** @typedef {{code:number,stdout:string,stderr:string}} CommandResult */
/** @typedef {{signal?:AbortSignal,stdin?:string,fs?:ReturnType<typeof import('./filesystem.js').createVirtualFileSystem>}} ExecuteOptions */
/** @typedef {{execute:(source:string|string[],options?:ExecuteOptions)=>Promise<CommandResult>,assertActive:()=>void,fs:ReturnType<typeof import('./filesystem.js').createVirtualFileSystem>,args:string[],cwd:string,resolve:(path:string)=>string,signal?:AbortSignal,stdin:string}} CommandContext */
/** @typedef {(context:CommandContext)=>string|void|CommandResult|Promise<string|void|CommandResult>} Command */
/** @param {{fs:ReturnType<typeof import('./filesystem.js').createVirtualFileSystem>,cwd?:string,authorize?:(operation:string,paths:string[])=>void}} options */
export declare function createShell({ fs, cwd, authorize }: {
    fs: ReturnType<typeof import('./filesystem.js').createVirtualFileSystem>;
    cwd?: string;
    authorize?: (operation: string, paths: string[]) => void;
}): {
    readonly cwd: string;
    dispose(): void;
    /** @param {string} name @param {Command} command */
    register(name: string, command: Command): void;
    /** Commands in one shell execute in order. Context.execute dispatches nested commands directly.
     * @param {string|string[]} source @param {ExecuteOptions} [options] @returns {Promise<CommandResult>} */
    execute(source: string | string[], options?: ExecuteOptions): Promise<CommandResult>;
};
