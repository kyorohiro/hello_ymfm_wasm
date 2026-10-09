export type VirtualFileReader = {
    (path: string, options?: {
        type?: 'text';
    }): Promise<string>;
    (path: string, options: {
        type: 'arrayBuffer';
    }): Promise<ArrayBuffer>;
    (path: string, options: {
        type: 'json';
    }): Promise<unknown>;
};
/** @typedef {{(path:string,options?:{type?:'text'}):Promise<string>; (path:string,options:{type:'arrayBuffer'}):Promise<ArrayBuffer>; (path:string,options:{type:'json'}):Promise<unknown>}} VirtualFileReader */
/** @param {{get(path:string):import('./filesystem.js').VirtualFile|null}} fileSystem
 * @param {string} currentPath @returns {VirtualFileReader} */
export declare function createVirtualFileReader(fileSystem: {
    get(path: string): import('./filesystem.js').VirtualFile | null;
}, currentPath: string): VirtualFileReader;
