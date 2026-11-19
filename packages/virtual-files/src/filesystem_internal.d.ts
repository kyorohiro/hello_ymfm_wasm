export type StoredFile = import('./filesystem.js').StoredFile;
export type StoreState = {
    files: Map<string, StoredFile>;
    directories: Set<string>;
};
/** @typedef {import('./filesystem.js').StoredFile} StoredFile */
/** @typedef {{files:Map<string,StoredFile>,directories:Set<string>}} StoreState */
/** @type {WeakMap<object,{read:()=>StoreState,publish:(state:StoreState,notify?:boolean)=>boolean,notify:()=>void}>} */
export declare const fileStores: WeakMap<object, {
    read: () => StoreState;
    publish: (state: StoreState, notify?: boolean) => boolean;
    notify: () => void;
}>;
/** @param {StoredFile|undefined} a @param {StoredFile|undefined} b */
export declare function sameStoredFile(a: StoredFile | undefined, b: StoredFile | undefined): boolean;
/** @param {StoreState} a @param {StoreState} b */
export declare function sameStoreState(a: StoreState, b: StoreState): boolean;
