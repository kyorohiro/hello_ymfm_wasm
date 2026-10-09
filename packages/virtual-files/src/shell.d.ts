/** Quotes and escapes only. No JavaScript evaluation or host shell invocation.
 * @param {string} source @returns {string[]} */
export declare function parseCommand(source: string): string[];
export type CommandResult = {
    code: number;
    stdout: string;
    stderr: string;
};
export type CommandContext = {
    fs: ReturnType<typeof import('./filesystem.js').createVirtualFileSystem>;
    args: string[];
    cwd: string;
    resolve: (path: string) => string;
    signal?: AbortSignal;
    stdin: string;
};
export type Command = (context: CommandContext) => string | void | CommandResult | Promise<string | void | CommandResult>;
/** @typedef {{code:number,stdout:string,stderr:string}} CommandResult */
/** @typedef {{fs:ReturnType<typeof import('./filesystem.js').createVirtualFileSystem>,args:string[],cwd:string,resolve:(path:string)=>string,signal?:AbortSignal,stdin:string}} CommandContext */
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
    /** Commands in one shell execute in order, including cwd changes.
     * @param {string} source @param {{signal?:AbortSignal,stdin?:string}} [options] @returns {Promise<CommandResult>} */
    execute(source: string, { signal, stdin }?: {
        signal?: AbortSignal;
        stdin?: string;
    }): Promise<CommandResult>;
};
