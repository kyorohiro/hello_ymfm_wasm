// Package-private store access. Public reads always copy binary contents.
/** @typedef {import('./filesystem.js').StoredFile} StoredFile */
/** @typedef {{files:Map<string,StoredFile>,directories:Set<string>}} StoreState */
/** @type {WeakMap<object,{read:()=>StoreState,publish:(state:StoreState,notify?:boolean)=>boolean,notify:()=>void}>} */
export const fileStores=new WeakMap();

/** @param {StoredFile|undefined} a @param {StoredFile|undefined} b */
export function sameStoredFile(a,b) {
  return a===b||!!a&&!!b&&a.type===b.type&&(a.data===b.data||
    a.type==='binary'&&b.type==='binary'&&a.data.length===b.data.length&&a.data.every((value,index)=>value===b.data[index]));
}
/** @param {StoreState} a @param {StoreState} b */
export function sameStoreState(a,b) {
  return a.files.size===b.files.size&&a.directories.size===b.directories.size&&
    [...a.files].every(([path,file])=>sameStoredFile(file,b.files.get(path)))&&
    [...a.directories].every(path=>b.directories.has(path));
}
