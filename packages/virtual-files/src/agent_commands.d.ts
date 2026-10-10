/** Commands for bounded inspection and exact edits. Patterns are literal, not host expressions.
 * @param {(name:string,command:import('./shell.js').Command)=>void} register
 * @param {(operation:string,paths:string[])=>void} authorize */
export declare function registerAgentCommands(register: (name: string, command: import('./shell.js').Command) => void, authorize: (operation: string, paths: string[]) => void): {
    clearSnapshots(): void;
};
